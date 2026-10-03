// server/src/players.ts — Lebenszyklus der Verbindungen und Reducer der Spieler (Beitreten, Posen, Warp, Summen).
import { SenderError, t } from "spacetimedb/server";
import { BeeFlags, ClientReportableFlags, EntityKinds, EventKinds, NoHive } from "../../shared/events";
import { HiveHeight, hiveDockPoint } from "../../shared/worldgen";
import { WarpMinDistance, WarpSpeed, boundaryOverflow, packCell } from "../../shared/world";
import { assertTrustedCaller, requireFinite, requirePlayerId } from "./access";
import { currentTick, nowMs, worldSeconds } from "./clock";
import { cooldownRow, emit, requireStats, statsOf, unlockQuests } from "./progress";
import spacetimedb, { type Ctx } from "./schema";
import { stopAllModules } from "./combat";
import { world } from "./world";

const NameMaxLength = 24;
const BuzzCooldownMs = 2_000n;
/** Abklingzeit nach dem Ende eines Warps. */
export const WarpCooldownMs = 1_000n;
const NameCooldownMs = 5_000n;
/** Kürzester Abstand zweier angenommener Posen; der Client meldet mit 15 Hz. */
const PoseMinIntervalMs = 30n;

/** Prüft und normalisiert einen Anzeigenamen (Namensprüfung). */
function validateName(raw: string): string {
  // Erst die billige Längenprüfung: sehr lange Eingaben würden sonst beim Zerlegen den Datenbank-Thread binden
  if (raw.length > NameMaxLength * 2) {
    throw new SenderError("invalid name length");
  }
  const name = raw.trim();
  const length = [...name].length;
  if (length === 0 || length > NameMaxLength) {
    throw new SenderError("invalid name length");
  }
  if (!/^[\p{L}\p{N} _.!-]+$/u.test(name)) {
    throw new SenderError("invalid name characters");
  }
  return name;
}

/** Setzt die Biene eines Spielers in die Welt (gespeicherte Lage oder vor den Heimatstock). */
function spawnBee(ctx: Ctx, playerId: number): void {
  if (ctx.db.beeState.playerId.find(playerId)) {
    return;
  }
  const stats = requireStats(ctx, playerId);
  const maxHp = statsOf(stats).maxHp;
  let x = stats.savedX;
  let y = stats.savedY;
  let z = stats.savedZ;
  let flags = stats.savedFlags & (BeeFlags.ghost | BeeFlags.docked);
  const fresh = x === 0 && y === 0 && z === 0;
  if (fresh || boundaryOverflow(x, y, z) > 0) {
    const profile = ctx.db.playerProfile.playerId.find(playerId);
    const home = world().hives[profile?.homeHive ?? 0] ?? world().hives[0];
    if (home === undefined) {
      throw new Error("Welt ohne Bienenstock");
    }
    const point = hiveDockPoint(home, 6);
    x = point.x + (ctx.random() - 0.5) * 4;
    y = point.y + (ctx.random() - 0.5) * 2;
    z = point.z + (ctx.random() - 0.5) * 4;
    flags &= BeeFlags.ghost;
  }
  if ((flags & BeeFlags.docked) !== 0 && stats.dockedHive === NoHive) {
    flags &= ~BeeFlags.docked;
  }
  if ((flags & BeeFlags.docked) === 0 && stats.dockedHive !== NoHive) {
    ctx.db.playerStats.playerId.update({ ...stats, dockedHive: NoHive });
  }
  const hp = (flags & BeeFlags.ghost) !== 0 ? 0 : Math.max(1, Math.min(maxHp, stats.hp));
  ctx.db.beeState.insert({
    playerId,
    cell: packCell(x, z),
    x,
    y,
    z,
    yaw: 0,
    pitch: 0,
    aimYaw: 0,
    aimPitch: 0,
    tick: currentTick(ctx),
    hp,
    maxHp,
    flags,
  });
  ctx.db.beeMotion.insert({ playerId, vx: 0, vy: 0, vz: 0, budget: 0, heldSpeed: 0, heldUntilMs: 0n });
}

/** Speichert Lage und Zustand der Biene und nimmt sie aus der Welt (Abmelden). */
function despawnBee(ctx: Ctx, playerId: number): void {
  const bee = ctx.db.beeState.playerId.find(playerId);
  const stats = ctx.db.playerStats.playerId.find(playerId);
  if (bee && stats) {
    ctx.db.playerStats.playerId.update({ ...stats, savedX: bee.x, savedY: bee.y, savedZ: bee.z, savedFlags: bee.flags, hp: bee.hp });
  }
  stopAllModules(ctx, playerId);
  ctx.db.beeState.playerId.delete(playerId);
  ctx.db.poseInbox.playerId.delete(playerId);
  ctx.db.beeMotion.playerId.delete(playerId);
  ctx.db.warpState.playerId.delete(playerId);
}

// ---------- Lebenszyklus ----------

export const onConnect = spacetimedb.clientConnected((ctx) => {
  assertTrustedCaller(ctx); // Fehler → Verbindung abgelehnt
  const connectionId = ctx.connectionId;
  if (connectionId === null) {
    throw new SenderError("missing connection");
  }
  ctx.db.session.insert({ connectionId, identity: ctx.sender }); // keine Konten hier: läuft auch für jede HTTP-Anfrage
});

export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
  const connectionId = ctx.connectionId;
  if (connectionId === null || !ctx.db.session.connectionId.delete(connectionId)) {
    return;
  }
  for (const _other of ctx.db.session.identity.filter(ctx.sender)) {
    return; // eine weitere Verbindung desselben Spielers ist noch offen
  }
  const entry = ctx.db.account.identity.find(ctx.sender);
  if (entry) {
    despawnBee(ctx, entry.playerId);
  }
});

// ---------- Reducer ----------

/** Legt bei Bedarf Konto, Profil und Stand an und setzt die Biene in die Welt (Beitreten). */
export const join = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
  const clean = validateName(name);
  const entry = ctx.db.account.identity.find(ctx.sender) ?? ctx.db.account.insert({ identity: ctx.sender, playerId: 0, createdAt: ctx.timestamp });
  const playerId = entry.playerId;
  const profile = ctx.db.playerProfile.playerId.find(playerId);
  if (!profile) {
    ctx.db.playerProfile.insert({ playerId, identity: ctx.sender, name: clean, homeHive: 0, isDemo: false });
  } else if (profile.name !== clean) {
    // Umbenennen beim Beitreten nur mit derselben Abklingzeit wie setName: jede Änderung erreicht alle Clients
    const cooldown = cooldownRow(ctx, playerId);
    const now = nowMs(ctx);
    if (now >= cooldown.nextNameAtMs) {
      ctx.db.cooldown.playerId.update({ ...cooldown, nextNameAtMs: now + NameCooldownMs });
      ctx.db.playerProfile.playerId.update({ ...profile, name: clean });
    }
  }
  if (!ctx.db.playerStats.playerId.find(playerId)) {
    ctx.db.playerStats.insert({
      playerId,
      honey: 0,
      cargo: 0,
      cargoGold: 0,
      energy: 100,
      energyAt: worldSeconds(ctx),
      hp: 100,
      lensLevel: 0,
      gatlingLevel: 0,
      quiverLevel: 0,
      brushLevel: 0,
      cargoLevel: 0,
      wingsLevel: 0,
      armorLevel: 0,
      antennaLevel: 0,
      nectarLevel: 0,
      dockedHive: NoHive,
      hivesVisited: 0,
      achievements: 0,
      deaths: 0,
      savedX: 0,
      savedY: 0,
      savedZ: 0,
      savedFlags: 0,
    });
  }
  if (!ctx.db.playerScore.playerId.find(playerId)) {
    ctx.db.playerScore.insert({ playerId, honeyTotal: 0, kills: 0, pollenTotal: 0 });
  }
  unlockQuests(ctx, playerId);
  spawnBee(ctx, playerId);
});

/** Ändert den Anzeigenamen (mit Abklingzeit). */
export const setName = spacetimedb.reducer({ name: t.string() }, (ctx, { name }) => {
  const clean = validateName(name);
  const playerId = requirePlayerId(ctx);
  const cooldown = cooldownRow(ctx, playerId);
  const now = nowMs(ctx);
  if (now < cooldown.nextNameAtMs) {
    throw new SenderError("cooldown");
  }
  ctx.db.cooldown.playerId.update({ ...cooldown, nextNameAtMs: now + NameCooldownMs });
  const profile = ctx.db.playerProfile.playerId.find(playerId);
  if (profile) {
    ctx.db.playerProfile.playerId.update({ ...profile, name: clean });
  }
});

/** Nimmt die zuletzt gemeldete Pose an; der Weltakt übernimmt sie (Posen-Eingang). */
export const reportPose = spacetimedb.reducer(
  { x: t.f32(), y: t.f32(), z: t.f32(), yaw: t.i16(), pitch: t.i16(), aimYaw: t.i16(), aimPitch: t.i16(), clientFlags: t.u8() },
  (ctx, pose) => {
    requireFinite(pose.x, pose.y, pose.z);
    if (boundaryOverflow(pose.x, pose.y, pose.z) > 50) {
      throw new SenderError("pose out of bounds");
    }
    const playerId = requirePlayerId(ctx);
    const bee = ctx.db.beeState.playerId.find(playerId);
    if (!bee) {
      throw new SenderError("not in world");
    }
    if ((bee.flags & BeeFlags.docked) !== 0) {
      return; // angedockt: die Biene sitzt im Stock
    }
    const now = nowMs(ctx);
    const existing = ctx.db.poseInbox.playerId.find(playerId);
    if (existing && now - existing.receivedAtMs < PoseMinIntervalMs) {
      return; // dichter als der Client meldet: nichts schreiben, nichts ins Commit-Log
    }
    const row = { playerId, receivedAtMs: now, ...pose, clientFlags: pose.clientFlags & ClientReportableFlags };
    if (existing) {
      ctx.db.poseInbox.playerId.update(row);
    } else {
      ctx.db.poseInbox.insert(row);
    }
  },
);

/** Summt: ein Ereignis für alle in der Nachbarschaft, mit Abklingzeit (Summen). */
export const buzz = spacetimedb.reducer((ctx) => {
  const playerId = requirePlayerId(ctx);
  const bee = ctx.db.beeState.playerId.find(playerId);
  if (!bee) {
    throw new SenderError("not in world");
  }
  const cooldown = cooldownRow(ctx, playerId);
  const now = nowMs(ctx);
  if (now < cooldown.nextBuzzAtMs) {
    throw new SenderError("cooldown");
  }
  ctx.db.cooldown.playerId.update({ ...cooldown, nextBuzzAtMs: now + BuzzCooldownMs });
  emit(ctx, bee.cell, EventKinds.buzz, EntityKinds.bee, playerId, EntityKinds.none, 0);
});

/**
 * Gibt einen Warp zu einem Punkt frei (Warp): Mindestabstand 150 m; während des Warps erlaubt der
 * Weltakt Warp-Tempo. Module schalten ab. Geister dürfen ohne Mindestabstand zum Heimatstock warpen.
 */
export const beginWarp = spacetimedb.reducer({ x: t.f32(), y: t.f32(), z: t.f32() }, (ctx, target) => {
  requireFinite(target.x, target.y, target.z);
  if (boundaryOverflow(target.x, target.y, target.z) > 0) {
    throw new SenderError("target out of bounds");
  }
  const playerId = requirePlayerId(ctx);
  const bee = ctx.db.beeState.playerId.find(playerId);
  if (!bee || (bee.flags & BeeFlags.docked) !== 0) {
    throw new SenderError("not in space");
  }
  if ((bee.flags & BeeFlags.warping) !== 0 || ctx.db.warpState.playerId.find(playerId)) {
    throw new SenderError("already warping");
  }
  const cooldown = cooldownRow(ctx, playerId);
  const now = nowMs(ctx);
  if (now < cooldown.nextWarpAtMs) {
    throw new SenderError("cooldown");
  }
  const distance = Math.hypot(target.x - bee.x, target.y - bee.y, target.z - bee.z);
  const isGhost = (bee.flags & BeeFlags.ghost) !== 0;
  const profile = ctx.db.playerProfile.playerId.find(playerId);
  const home = world().hives[profile?.homeHive ?? 0];
  const toHome = home !== undefined && Math.hypot(target.x - home.x, target.y - home.y, target.z - home.z) < 60 + HiveHeight;
  if (distance < WarpMinDistance && !(isGhost && toHome)) {
    throw new SenderError("too close");
  }
  stopAllModules(ctx, playerId);
  // Obergrenze des Warps: großzügig, damit langsame Clients (wenige fps) nicht vor der Ankunft gekappt werden;
  // regulär endet der Warp beim Ankommen, die Richtung prüft der Korridor
  const untilMs = now + BigInt(Math.ceil((distance / WarpSpeed) * 1500 + 8000));
  // Die Abklingzeit zählt ab dem spätesten Warp-Ende: kein Verlängern durch erneutes Anfragen
  ctx.db.cooldown.playerId.update({ ...cooldown, nextWarpAtMs: untilMs + WarpCooldownMs });
  ctx.db.warpState.insert({ playerId, untilMs, fromX: bee.x, fromY: bee.y, fromZ: bee.z, toX: target.x, toY: target.y, toZ: target.z });
  ctx.db.beeState.playerId.update({ ...bee, flags: bee.flags | BeeFlags.warping });
  emit(ctx, bee.cell, EventKinds.warp, EntityKinds.bee, playerId, EntityKinds.none, 0, distance / 10);
});
