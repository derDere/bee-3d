// server/src/progress.ts — Spielerstand: Upgrade-Stufen, Energie, Quests, Erfolge, Ereignisse.
import { SenderError } from "spacetimedb/server";
import { Quests, questInfo, type QuestCounter } from "../../shared/quests";
import { beeStats, energyAt, upgradeLevelsOf, type BeeStats, type UpgradeKind, type UpgradeLevels } from "../../shared/rules";
import { EventKinds, EntityKinds } from "../../shared/events";
import { worldSeconds } from "./clock";
import type { Ctx } from "./schema";

/** Zeilenform des Spielerstands (Spielerstand). */
export type PlayerStatsRow = NonNullable<ReturnType<Ctx["db"]["playerStats"]["playerId"]["find"]>>;
/** Zeilenform einer heißen Bienenzeile. */
export type BeeStateRow = NonNullable<ReturnType<Ctx["db"]["beeState"]["playerId"]["find"]>>;

const LevelColumns: Readonly<Record<UpgradeKind, keyof PlayerStatsRow>> = {
  lens: "lensLevel",
  gatling: "gatlingLevel",
  quiver: "quiverLevel",
  brush: "brushLevel",
  cargo: "cargoLevel",
  wings: "wingsLevel",
  armor: "armorLevel",
  antenna: "antennaLevel",
  nectar: "nectarLevel",
};

/** Spalte eines Upgrades im Spielerstand. */
export function levelColumn(kind: UpgradeKind): keyof PlayerStatsRow {
  return LevelColumns[kind];
}

/** Upgrade-Stufen aus dem Spielerstand. */
export function levelsOf(stats: PlayerStatsRow): UpgradeLevels {
  return upgradeLevelsOf(stats);
}

/** Abgeleitete Werte der Biene aus dem Spielerstand. */
export function statsOf(stats: PlayerStatsRow): BeeStats {
  return beeStats(levelsOf(stats));
}

/** Abklingzeiten eines Spielers; legt die Zeile bei Bedarf an (Abklingzeiten). */
export function cooldownRow(ctx: Ctx, playerId: number) {
  return (
    ctx.db.cooldown.playerId.find(playerId) ??
    ctx.db.cooldown.insert({ playerId, nextBuzzAtMs: 0n, nextWarpAtMs: 0n, nextNameAtMs: 0n, nextDockAtMs: 0n, lastVisitHive: 255, lastVisitAtMs: 0n })
  );
}

/** Spielerstand eines Spielers; bricht ab, wenn er fehlt. */
export function requireStats(ctx: Ctx, playerId: number): PlayerStatsRow {
  const stats = ctx.db.playerStats.playerId.find(playerId);
  if (!stats) {
    throw new SenderError("no stats");
  }
  return stats;
}

/** Aktuelle Energie (lazy aus Stand und Zeitstempel). */
export function currentEnergy(ctx: Ctx, stats: PlayerStatsRow): number {
  return energyAt(stats.energy, stats.energyAt, statsOf(stats), worldSeconds(ctx));
}

/** Zieht Energie ab und liefert den neuen Stand oder undefined, wenn sie nicht reicht. */
export function withEnergySpent(ctx: Ctx, stats: PlayerStatsRow, amount: number): PlayerStatsRow | undefined {
  const energy = currentEnergy(ctx, stats);
  if (energy < amount) {
    return undefined;
  }
  return { ...stats, energy: energy - amount, energyAt: worldSeconds(ctx) };
}

/** Schreibt ein Ereignis in die Zelle (Ereignis). */
export function emit(
  ctx: Ctx,
  cell: number,
  kind: number,
  sourceKind: number,
  sourceId: number,
  targetKind: number,
  targetId: number,
  value = 0,
  aux = 0,
): void {
  ctx.db.combatEvent.insert({
    cell,
    kind,
    sourceKind,
    sourceId,
    targetKind,
    targetId,
    value: Math.max(0, Math.min(65535, Math.round(value))),
    aux: Math.max(0, Math.min(65535, Math.round(aux))),
  });
}

/** Legt fehlende Quests an, deren Voraussetzung erfüllt ist (Questfreischaltung). */
export function unlockQuests(ctx: Ctx, playerId: number): void {
  const rows = Array.from(ctx.db.questProgress.playerId.filter(playerId));
  const completed = new Set(rows.filter((row) => row.completions > 0).map((row) => row.questId));
  const present = new Set(rows.map((row) => row.questId));
  for (const quest of Quests) {
    if (present.has(quest.id)) {
      continue;
    }
    if (quest.requires === 0 || completed.has(quest.requires)) {
      ctx.db.questProgress.insert({ id: 0n, playerId, questId: quest.id, progress: 0, completions: 0 });
    }
  }
}

/**
 * Zählt einen Questzähler hoch, schließt erreichte Quests ab, zahlt die Belohnung aus und schaltet
 * Folgequests frei (Questfortschritt).
 */
export function advanceQuests(ctx: Ctx, playerId: number, counter: QuestCounter, amount: number, cell: number): void {
  if (amount <= 0) {
    return;
  }
  let reward = 0;
  let unlocked = false;
  for (const row of Array.from(ctx.db.questProgress.playerId.filter(playerId))) {
    const quest = questInfo(row.questId);
    if (quest === undefined || quest.counter !== counter || (!quest.repeatable && row.completions > 0)) {
      continue;
    }
    const progress = row.progress + amount;
    if (progress >= quest.goal) {
      reward += quest.reward;
      unlocked = true;
      ctx.db.questProgress.id.update({ ...row, progress: quest.repeatable ? 0 : quest.goal, completions: row.completions + 1 });
      emit(ctx, cell, EventKinds.questDone, EntityKinds.bee, playerId, EntityKinds.none, 0, quest.reward, quest.id);
    } else {
      ctx.db.questProgress.id.update({ ...row, progress });
    }
  }
  if (reward > 0) {
    const stats = ctx.db.playerStats.playerId.find(playerId);
    if (stats) {
      ctx.db.playerStats.playerId.update({ ...stats, honey: stats.honey + reward });
    }
  }
  if (unlocked) {
    unlockQuests(ctx, playerId);
  }
}

/** Setzt ein Erfolgsbit im Spielerstand (Erfolg). */
export function grantAchievement(ctx: Ctx, playerId: number, bit: number): void {
  const stats = ctx.db.playerStats.playerId.find(playerId);
  if (stats && (stats.achievements & bit) === 0) {
    ctx.db.playerStats.playerId.update({ ...stats, achievements: (stats.achievements | bit) >>> 0 });
  }
}

/** Erhöht die öffentliche Rangliste eines Spielers. */
export function addScore(ctx: Ctx, playerId: number, honey: number, kills: number, pollen: number): void {
  const score = ctx.db.playerScore.playerId.find(playerId);
  if (score) {
    ctx.db.playerScore.playerId.update({
      ...score,
      honeyTotal: score.honeyTotal + honey,
      kills: score.kills + kills,
      pollenTotal: score.pollenTotal + pollen,
    });
  } else {
    ctx.db.playerScore.insert({ playerId, honeyTotal: honey, kills, pollenTotal: pollen });
  }
}
