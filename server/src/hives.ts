// server/src/hives.ts — Bienenstöcke als Stationen: Andocken, Abdocken, Abliefern, Heilstation, Werkstatt, Heimatstock.
import { SenderError, t } from "spacetimedb/server";
import { Achievements } from "../../shared/achievements";
import { BeeFlags, EntityKinds, EventKinds, NoHive } from "../../shared/events";
import { DockRange, HoneyPerGoldPollen, HoneyPerPollen, HpPerHoney, MaxUpgradeLevel, UpgradeCosts, UpgradeKinds, beeStats, type UpgradeKind } from "../../shared/rules";
import { hiveDockPoint, type HivePlacement } from "../../shared/worldgen";
import { packCell } from "../../shared/world";
import { requirePlayerId } from "./access";
import { stopAllModules } from "./combat";
import { addScore, advanceQuests, cooldownRow, emit, grantAchievement, levelColumn, levelsOf, requireStats, statsOf } from "./progress";
import { nowMs } from "./clock";
import spacetimedb, { type Ctx } from "./schema";
import { world } from "./world";

function requireHive(hiveId: number): HivePlacement {
  const hive = world().hives[hiveId];
  if (hive === undefined) {
    throw new SenderError("unknown hive");
  }
  return hive;
}

/** Biene des Aufrufers, angedockt in einem Stock; bricht sonst ab. */
function requireDocked(ctx: Ctx) {
  const playerId = requirePlayerId(ctx);
  const stats = requireStats(ctx, playerId);
  const bee = ctx.db.beeState.playerId.find(playerId);
  if (!bee || (bee.flags & BeeFlags.docked) === 0 || stats.dockedHive === NoHive) {
    throw new SenderError("not docked");
  }
  return { playerId, stats, bee, hive: requireHive(stats.dockedHive) };
}

/** Abklingzeit zwischen Andocken und Abdocken. */
const DockCooldownMs = 1_000n;
/** Ein Besuch zählt je Spieler und Stock höchstens alle 10 Minuten. */
const VisitIntervalMs = 600_000n;

/** Prüft und setzt die Abklingzeit für Andocken und Abdocken; liefert die aktuelle Zeit. */
function takeDockCooldown(ctx: Ctx, playerId: number): bigint {
  const cooldown = cooldownRow(ctx, playerId);
  const now = nowMs(ctx);
  if (now < cooldown.nextDockAtMs) {
    throw new SenderError("cooldown");
  }
  ctx.db.cooldown.playerId.update({ ...cooldown, nextDockAtMs: now + DockCooldownMs });
  return now;
}

/** Dockt am Stock an: Module aus, Geister werden wiederbelebt (Andocken). */
export const dock = spacetimedb.reducer({ hiveId: t.u8() }, (ctx, { hiveId }) => {
  const playerId = requirePlayerId(ctx);
  const hive = requireHive(hiveId);
  const bee = ctx.db.beeState.playerId.find(playerId);
  if (!bee || (bee.flags & BeeFlags.docked) !== 0) {
    throw new SenderError("not in space");
  }
  const distance = Math.hypot(bee.x - hive.x, bee.y - hive.y, bee.z - hive.z);
  if (distance > DockRange + 12) {
    throw new SenderError("too far");
  }
  const now = takeDockCooldown(ctx, playerId);
  stopAllModules(ctx, playerId);
  ctx.db.warpState.playerId.delete(playerId);
  const stats = requireStats(ctx, playerId);
  const maxHp = statsOf(stats).maxHp;
  const wasGhost = (bee.flags & BeeFlags.ghost) !== 0;
  const visited = stats.hivesVisited | (1 << hiveId);
  const firstVisit = (stats.hivesVisited & (1 << hiveId)) === 0;
  ctx.db.playerStats.playerId.update({ ...stats, dockedHive: hiveId, hivesVisited: visited, hp: wasGhost ? maxHp : stats.hp });
  const flags = (bee.flags | BeeFlags.docked) & ~(BeeFlags.ghost | BeeFlags.warping | BeeFlags.boost | BeeFlags.mining | BeeFlags.laserFiring | BeeFlags.gatlingFiring | BeeFlags.freeLaser);
  ctx.db.beeState.playerId.update({ ...bee, x: hive.x, y: hive.y, z: hive.z, cell: hive.cell, flags, hp: wasGhost ? maxHp : bee.hp, maxHp });
  // Öffentliche Besuchszahl: ein Besuch je Spieler, Stock und 10 Minuten, sonst erreicht jedes Andocken alle Clients
  const cooldown = cooldownRow(ctx, playerId);
  if (cooldown.lastVisitHive !== hiveId || now - cooldown.lastVisitAtMs >= VisitIntervalMs) {
    ctx.db.cooldown.playerId.update({ ...cooldown, lastVisitHive: hiveId, lastVisitAtMs: now });
    const state = ctx.db.hiveState.hiveId.find(hiveId);
    if (state) {
      ctx.db.hiveState.hiveId.update({ ...state, visits: state.visits + 1 });
    }
  }
  emit(ctx, hive.cell, EventKinds.dock, EntityKinds.bee, playerId, EntityKinds.hive, hiveId);
  if (wasGhost) {
    emit(ctx, hive.cell, EventKinds.revive, EntityKinds.bee, playerId, EntityKinds.hive, hiveId);
  }
  if (firstVisit) {
    advanceQuests(ctx, playerId, "distinctHives", 1, hive.cell);
  }
  if (bitCount(visited) >= world().hives.length) {
    grantAchievement(ctx, playerId, Achievements.globetrotter.bit);
  }
});

/** Verlässt den Stock vor das Flugloch (Abdocken). */
export const undock = spacetimedb.reducer((ctx) => {
  const { playerId, stats, bee, hive } = requireDocked(ctx);
  takeDockCooldown(ctx, playerId);
  const point = hiveDockPoint(hive, 4);
  ctx.db.playerStats.playerId.update({ ...stats, dockedHive: NoHive });
  ctx.db.beeState.playerId.update({ ...bee, x: point.x, y: point.y, z: point.z, cell: packCell(point.x, point.z), flags: bee.flags & ~BeeFlags.docked });
  ctx.db.poseInbox.playerId.delete(playerId);
  emit(ctx, hive.cell, EventKinds.undock, EntityKinds.bee, playerId, EntityKinds.hive, hive.id);
});

/** Liefert die Ladung ab: Pollen und Goldpollen werden zu Honig (Abliefern). */
export const deposit = spacetimedb.reducer((ctx) => {
  const { playerId, stats, hive } = requireDocked(ctx);
  const pollen = stats.cargo + stats.cargoGold;
  if (pollen === 0) {
    throw new SenderError("cargo empty");
  }
  const honey = stats.cargo * HoneyPerPollen + stats.cargoGold * HoneyPerGoldPollen;
  ctx.db.playerStats.playerId.update({ ...stats, honey: stats.honey + honey, cargo: 0, cargoGold: 0 });
  const state = ctx.db.hiveState.hiveId.find(hive.id);
  if (state) {
    ctx.db.hiveState.hiveId.update({ ...state, honeyDelivered: state.honeyDelivered + honey });
  }
  addScore(ctx, playerId, honey, 0, 0);
  advanceQuests(ctx, playerId, "pollenDelivered", pollen, hive.cell);
});

/** Heilt gegen Honig, so weit der Honig reicht (Heilstation). */
export const repair = spacetimedb.reducer((ctx) => {
  const { stats, bee } = requireDocked(ctx);
  const maxHp = statsOf(stats).maxHp;
  const missing = maxHp - bee.hp;
  if (missing <= 0) {
    return;
  }
  const affordable = Math.min(missing, stats.honey * HpPerHoney);
  if (affordable <= 0) {
    throw new SenderError("no honey");
  }
  const cost = Math.ceil(affordable / HpPerHoney);
  ctx.db.playerStats.playerId.update({ ...stats, honey: stats.honey - cost, hp: bee.hp + affordable });
  ctx.db.beeState.playerId.update({ ...bee, hp: bee.hp + affordable });
});

/** Kauft die nächste Stufe eines Upgrades (Werkstatt). */
export const buyUpgrade = spacetimedb.reducer({ kind: t.string() }, (ctx, { kind }) => {
  if (kind.length > 16 || !UpgradeKinds.includes(kind as UpgradeKind)) {
    throw new SenderError("unknown upgrade");
  }
  const upgrade = kind as UpgradeKind;
  const { stats, bee } = requireDocked(ctx);
  const level = levelsOf(stats)[upgrade];
  if (level >= MaxUpgradeLevel) {
    throw new SenderError("max level");
  }
  const cost = UpgradeCosts[level] ?? Number.POSITIVE_INFINITY;
  if (stats.honey < cost) {
    throw new SenderError("not enough honey");
  }
  const updated = { ...stats, honey: stats.honey - cost, [levelColumn(upgrade)]: level + 1 };
  const maxHp = beeStats(levelsOf(updated)).maxHp;
  const hp = upgrade === "armor" ? Math.min(maxHp, bee.hp + 20) : bee.hp;
  ctx.db.playerStats.playerId.update({ ...updated, hp });
  ctx.db.beeState.playerId.update({ ...bee, hp, maxHp });
});

/** Macht den aktuellen Stock zum Heimatstock (Einsetzpunkt nach dem Login). */
export const setHomeHive = spacetimedb.reducer((ctx) => {
  const { playerId, hive } = requireDocked(ctx);
  const profile = ctx.db.playerProfile.playerId.find(playerId);
  if (profile) {
    ctx.db.playerProfile.playerId.update({ ...profile, homeHive: hive.id });
  }
});

function bitCount(value: number): number {
  let count = 0;
  let rest = value;
  while (rest !== 0) {
    count += rest & 1;
    rest >>>= 1;
  }
  return count;
}
