// server/src/combat.ts — Module in Zyklen, Treffer und Schaden, Einschläge, Tod und Geist (Kampfsystem).
// Der Client meldet nur Absichten (Modul an/aus auf ein Ziel); Ergebnis und Schaden entscheidet der Server.
import { SenderError, t, Range } from "spacetimedb/server";
import { Achievements } from "../../shared/achievements";
import { isNightHours, solarHours } from "../../shared/dayClock";
import { BeeFlags, EntityKinds, EventKinds, FlyStates } from "../../shared/events";
import { FlyTaunts } from "../../shared/quests";
import {
  FlyKinds,
  ModuleSlotCount,
  ModuleSlots,
  NightPollenBonus,
  QueenRespawnSeconds,
  RepairAmount,
  SpitSpeed,
  collectorYield,
  flyInfo,
  gatlingStats,
  laserStats,
  missileDamageFactor,
  moduleCycleSeconds,
  moduleInfo,
  moduleRange,
  patchPollenAt,
  spitHitChance,
  stingerStats,
  turretHitChance,
} from "../../shared/rules";
import { packCell } from "../../shared/world";
import { requirePlayerId } from "./access";
import { currentTick, nowMs, secondsToMs, worldSeconds } from "./clock";
import {
  addScore,
  advanceQuests,
  emit,
  grantAchievement,
  levelsOf,
  requireStats,
  statsOf,
  withEnergySpent,
  type BeeStateRow,
  type PlayerStatsRow,
} from "./progress";
import spacetimedb, { type Ctx } from "./schema";
import { world } from "./world";

/** Art eines verzögerten Einschlags (Einschlagart). */
export const ImpactKinds = { stinger: 1, spit: 2 } as const;

type FlyStateRow = NonNullable<ReturnType<Ctx["db"]["flyState"]["flyId"]["find"]>>;
type ActivationRow = NonNullable<ReturnType<Ctx["db"]["moduleActivation"]["id"]["find"]>>;

// ---------- Modulsteuerung ----------

/** Beendet alle Module eines Spielers sofort und löscht ihre Flags (Module aus). */
export function stopAllModules(ctx: Ctx, playerId: number): void {
  for (const activation of Array.from(ctx.db.moduleActivation.playerId.filter(playerId))) {
    ctx.db.moduleActivation.id.delete(activation.id);
  }
  const bee = ctx.db.beeState.playerId.find(playerId);
  if (bee) {
    const cleared = bee.flags & ~(BeeFlags.boost | BeeFlags.mining | BeeFlags.laserFiring | BeeFlags.gatlingFiring);
    if (cleared !== bee.flags) {
      ctx.db.beeState.playerId.update({ ...bee, flags: cleared });
    }
  }
}

function findActivation(ctx: Ctx, playerId: number, slot: number): ActivationRow | undefined {
  for (const activation of ctx.db.moduleActivation.byPlayerSlot.filter([playerId, slot])) {
    return activation;
  }
  return undefined;
}

/** Schaltet ein Modul auf ein Ziel ein; der erste Zyklus läuft im nächsten Weltakt (Modul an). */
export const activateModule = spacetimedb.reducer(
  { slot: t.u8(), targetKind: t.u8(), targetId: t.u32() },
  (ctx, { slot, targetKind, targetId }) => {
    if (slot >= ModuleSlotCount) {
      throw new SenderError("unknown slot");
    }
    const playerId = requirePlayerId(ctx);
    const bee = ctx.db.beeState.playerId.find(playerId);
    if (!bee || (bee.flags & (BeeFlags.docked | BeeFlags.ghost | BeeFlags.warping)) !== 0) {
      throw new SenderError("modules offline");
    }
    const info = moduleInfo(slot);
    if (info.target === "enemy" && targetKind !== EntityKinds.fly) {
      throw new SenderError("needs enemy target");
    }
    if (info.target === "flowerPatch" && targetKind !== EntityKinds.flowerPatch) {
      throw new SenderError("needs flower target");
    }
    const stats = requireStats(ctx, playerId);
    const range = moduleRange(slot, levelsOf(stats));
    if (info.target !== "self" && targetDistance(ctx, bee, targetKind, targetId) > range + 2) {
      throw new SenderError("out of range");
    }
    if (info.target === "enemy") {
      // Höchstens so viele verschiedene Gegner wie Aufschaltungen (Fühlerantennen)
      const engaged = new Set<number>([targetId]);
      for (const other of ctx.db.moduleActivation.playerId.filter(playerId)) {
        if (other.slot !== slot && other.targetKind === EntityKinds.fly) {
          engaged.add(other.targetId);
        }
      }
      if (engaged.size > statsOf(stats).maxLocks) {
        throw new SenderError("too many targets");
      }
    }
    const existing = findActivation(ctx, playerId, slot);
    const row = {
      playerId,
      slot,
      targetKind: info.target === "self" ? EntityKinds.bee : targetKind,
      targetId: info.target === "self" ? playerId : targetId,
      stopAfterCycle: false,
    };
    if (existing) {
      // Zielwechsel: der laufende Zyklus endet regulär, der nächste trifft das neue Ziel
      ctx.db.moduleActivation.id.update({ ...existing, ...row });
    } else {
      ctx.db.moduleActivation.insert({ id: 0n, nextCycleAtMs: nowMs(ctx), ...row });
    }
  },
);

/** Beendet ein Modul nach dem laufenden Zyklus (Modul aus). */
export const deactivateModule = spacetimedb.reducer({ slot: t.u8() }, (ctx, { slot }) => {
  const playerId = requirePlayerId(ctx);
  const existing = findActivation(ctx, playerId, slot);
  if (existing && !existing.stopAfterCycle) {
    ctx.db.moduleActivation.id.update({ ...existing, stopAfterCycle: true });
  }
});

/** Entfernung der Biene zu einem Ziel; unendlich, wenn es fehlt. */
function targetDistance(ctx: Ctx, bee: BeeStateRow, targetKind: number, targetId: number): number {
  if (targetKind === EntityKinds.fly) {
    const fly = ctx.db.flyState.flyId.find(targetId);
    return fly ? Math.hypot(fly.x - bee.x, fly.y - bee.y, fly.z - bee.z) : Number.POSITIVE_INFINITY;
  }
  if (targetKind === EntityKinds.flowerPatch) {
    const patch = world().patches[targetId];
    if (patch === undefined) {
      return Number.POSITIVE_INFINITY;
    }
    return Math.max(0, Math.hypot(patch.x - bee.x, patch.y - bee.y, patch.z - bee.z) - patch.radius);
  }
  return Number.POSITIVE_INFINITY;
}

// ---------- Zyklen im Weltakt ----------

/** Führt alle fälligen Modulzyklen aus (Teil des Weltakts). */
export function runModuleCycles(ctx: Ctx): void {
  const now = nowMs(ctx);
  const flagsByPlayer = new Map<number, number>();
  for (const activation of Array.from(ctx.db.moduleActivation.iter())) {
    const running = flagsByPlayer.get(activation.playerId) ?? 0;
    if (activation.nextCycleAtMs > now) {
      flagsByPlayer.set(activation.playerId, running | slotFlag(activation.slot));
      continue;
    }
    if (activation.stopAfterCycle) {
      ctx.db.moduleActivation.id.delete(activation.id);
      flagsByPlayer.set(activation.playerId, running);
      continue;
    }
    const continued = runCycle(ctx, activation);
    if (continued) {
      const stats = ctx.db.playerStats.playerId.find(activation.playerId);
      const cycle = stats ? moduleCycleSeconds(activation.slot, levelsOf(stats)) : moduleInfo(activation.slot).cycleSeconds;
      ctx.db.moduleActivation.id.update({ ...activation, nextCycleAtMs: now + secondsToMs(cycle) });
      flagsByPlayer.set(activation.playerId, running | slotFlag(activation.slot));
    } else {
      ctx.db.moduleActivation.id.delete(activation.id);
      flagsByPlayer.set(activation.playerId, running);
    }
  }
  // Sichtbare Modul-Flags an der Bienenzeile nachführen (nur bei Änderung schreiben)
  const moduleFlags = BeeFlags.boost | BeeFlags.mining | BeeFlags.laserFiring | BeeFlags.gatlingFiring;
  for (const [playerId, flags] of flagsByPlayer) {
    const bee = ctx.db.beeState.playerId.find(playerId);
    if (bee && (bee.flags & moduleFlags) !== flags) {
      ctx.db.beeState.playerId.update({ ...bee, flags: (bee.flags & ~moduleFlags) | flags });
    }
  }
}

function slotFlag(slot: number): number {
  switch (slot) {
    case ModuleSlots.laserLeft:
    case ModuleSlots.laserRight:
      return BeeFlags.laserFiring;
    case ModuleSlots.gatling:
      return BeeFlags.gatlingFiring;
    case ModuleSlots.collector:
      return BeeFlags.mining;
    case ModuleSlots.boost:
      return BeeFlags.boost;
    default:
      return 0;
  }
}

/** Ein Zyklus eines Moduls; false beendet das Modul (Ziel weg, außer Reichweite, keine Energie). */
function runCycle(ctx: Ctx, activation: ActivationRow): boolean {
  const bee = ctx.db.beeState.playerId.find(activation.playerId);
  const stats = ctx.db.playerStats.playerId.find(activation.playerId);
  if (!bee || !stats || (bee.flags & (BeeFlags.docked | BeeFlags.ghost | BeeFlags.warping)) !== 0) {
    return false;
  }
  const info = moduleInfo(activation.slot);
  const levels = levelsOf(stats);
  if (info.target !== "self" && targetDistance(ctx, bee, activation.targetKind, activation.targetId) > moduleRange(activation.slot, levels) + 2) {
    return false;
  }
  if (info.pollenCost > 0 && stats.cargo < info.pollenCost) {
    return false;
  }
  const paid = withEnergySpent(ctx, stats, info.energyCost);
  if (paid === undefined) {
    return false;
  }
  const afterCost: PlayerStatsRow = { ...paid, cargo: paid.cargo - info.pollenCost };
  ctx.db.playerStats.playerId.update(afterCost);
  switch (activation.slot) {
    case ModuleSlots.laserLeft:
    case ModuleSlots.laserRight:
      return fireTurret(ctx, bee, afterCost, activation, "laser");
    case ModuleSlots.gatling:
      return fireTurret(ctx, bee, afterCost, activation, "gatling");
    case ModuleSlots.stinger:
      return fireStingers(ctx, bee, afterCost, activation.targetId);
    case ModuleSlots.collector:
      return collectPollen(ctx, bee, afterCost, activation.targetId);
    case ModuleSlots.repair:
      return repairSelf(ctx, bee, afterCost);
    case ModuleSlots.scanner:
      emit(ctx, bee.cell, EventKinds.scan, EntityKinds.bee, bee.playerId, EntityKinds.none, 0);
      return true;
    default:
      return true; // Boost: Wirkung über das Flag, Kosten oben
  }
}

/** Geschwindigkeit einer Biene; ohne frische Pose (älter als zwei Takte) gilt sie als ruhend. */
function beeVelocity(ctx: Ctx, bee: BeeStateRow): { vx: number; vy: number; vz: number } {
  const motion = ctx.db.beeMotion.playerId.find(bee.playerId);
  if (!motion || currentTick(ctx) - bee.tick > 2) {
    return { vx: 0, vy: 0, vz: 0 };
  }
  return { vx: motion.vx, vy: motion.vy, vz: motion.vz };
}

/** Relative Winkelgeschwindigkeit eines Ziels aus Sicht der Biene in rad/s. */
function angularVelocity(ctx: Ctx, bee: BeeStateRow, fly: FlyStateRow): number {
  const motion = beeVelocity(ctx, bee);
  const rx = fly.x - bee.x;
  const ry = fly.y - bee.y;
  const rz = fly.z - bee.z;
  const distance = Math.max(0.5, Math.hypot(rx, ry, rz));
  // Fliegengeschwindigkeit steht in cm/s in fly_state
  const vx = fly.vx / 100 - motion.vx;
  const vy = fly.vy / 100 - motion.vy;
  const vz = fly.vz / 100 - motion.vz;
  const radial = (vx * rx + vy * ry + vz * rz) / distance;
  const speedSquared = vx * vx + vy * vy + vz * vz;
  const transversal = Math.sqrt(Math.max(0, speedSquared - radial * radial));
  return transversal / distance;
}

function fireTurret(ctx: Ctx, bee: BeeStateRow, stats: PlayerStatsRow, activation: ActivationRow, weapon: "laser" | "gatling"): boolean {
  const fly = ctx.db.flyState.flyId.find(activation.targetId);
  if (!fly) {
    return false;
  }
  const levels = levelsOf(stats);
  const turret = weapon === "laser" ? laserStats(levels) : gatlingStats(levels);
  const signature = flyInfo(fly.kind).signatureRadius;
  const distance = Math.hypot(fly.x - bee.x, fly.y - bee.y, fly.z - bee.z);
  const chance = turretHitChance(angularVelocity(ctx, bee, fly), distance, signature, turret);
  let damage = 0;
  let hits = 0;
  for (let shot = 0; shot < turret.shots; shot++) {
    if (ctx.random() < chance) {
      hits++;
      damage += turret.damage * (0.6 + 0.6 * ctx.random());
    }
  }
  if (weapon === "laser") {
    emit(ctx, bee.cell, EventKinds.laserShot, EntityKinds.bee, bee.playerId, EntityKinds.fly, fly.flyId, damage, activation.slot);
  } else {
    emit(ctx, bee.cell, EventKinds.gatlingBurst, EntityKinds.bee, bee.playerId, EntityKinds.fly, fly.flyId, damage * 10, hits);
  }
  if (damage > 0) {
    damageFly(ctx, fly, damage, bee.playerId);
  }
  return true;
}

function fireStingers(ctx: Ctx, bee: BeeStateRow, stats: PlayerStatsRow, flyId: number): boolean {
  const fly = ctx.db.flyState.flyId.find(flyId);
  if (!fly) {
    return false;
  }
  const missile = stingerStats(levelsOf(stats));
  const distance = Math.hypot(fly.x - bee.x, fly.y - bee.y, fly.z - bee.z);
  const flightSeconds = Math.min(missile.flightSeconds, distance / missile.speed + 0.15);
  ctx.db.pendingImpact.insert({
    id: 0n,
    impactAtMs: nowMs(ctx) + secondsToMs(flightSeconds),
    kind: ImpactKinds.stinger,
    sourceId: bee.playerId,
    targetKind: EntityKinds.fly,
    targetId: flyId,
    count: missile.count,
    damage: missile.damage,
  });
  emit(ctx, bee.cell, EventKinds.missileLaunch, EntityKinds.bee, bee.playerId, EntityKinds.fly, flyId, flightSeconds * 100, missile.count);
  return true;
}

function collectPollen(ctx: Ctx, bee: BeeStateRow, stats: PlayerStatsRow, patchId: number): boolean {
  const placement = world().patches[patchId];
  const patch = ctx.db.flowerPatch.patchId.find(patchId);
  if (placement === undefined || !patch) {
    return false;
  }
  const capacity = statsOf(stats).cargoCapacity;
  const space = capacity - stats.cargo - stats.cargoGold;
  if (space <= 0) {
    return false;
  }
  const now = worldSeconds(ctx);
  const available = patchPollenAt(patch.pollen, patch.storedAt, placement.capacity, now);
  if (available <= 0) {
    return false;
  }
  const night = isNightHours(solarHours(now));
  const yieldAmount = Math.floor(collectorYield(levelsOf(stats)) * (night ? NightPollenBonus : 1));
  const amount = Math.min(yieldAmount, available, space);
  ctx.db.flowerPatch.patchId.update({ ...patch, pollen: available - amount, storedAt: now });
  ctx.db.playerStats.playerId.update(
    placement.golden ? { ...stats, cargoGold: stats.cargoGold + amount } : { ...stats, cargo: stats.cargo + amount },
  );
  emit(ctx, bee.cell, EventKinds.collect, EntityKinds.bee, bee.playerId, EntityKinds.flowerPatch, patchId, amount, placement.golden ? 1 : 0);
  addScore(ctx, bee.playerId, 0, 0, amount);
  advanceQuests(ctx, bee.playerId, "pollenCollected", amount, bee.cell);
  if (night) {
    advanceQuests(ctx, bee.playerId, "nightPollen", amount, bee.cell);
  }
  if (placement.golden) {
    advanceQuests(ctx, bee.playerId, "goldPollen", amount, bee.cell);
    grantAchievement(ctx, bee.playerId, Achievements.goldDigger.bit);
  }
  const score = ctx.db.playerScore.playerId.find(bee.playerId);
  if (score && score.pollenTotal >= 1000) {
    grantAchievement(ctx, bee.playerId, Achievements.pollenRoyalty.bit);
  }
  // Weiter, solange Platz in der Ladung und Pollen im Feld bleibt; die Reichweite prüft der nächste Zyklus
  return space - amount > 0 && available - amount > 0;
}

function repairSelf(ctx: Ctx, bee: BeeStateRow, stats: PlayerStatsRow): boolean {
  const maxHp = statsOf(stats).maxHp;
  if (bee.hp >= maxHp) {
    return false;
  }
  const hp = Math.min(maxHp, bee.hp + RepairAmount);
  ctx.db.beeState.playerId.update({ ...bee, hp });
  ctx.db.playerStats.playerId.update({ ...stats, hp });
  emit(ctx, bee.cell, EventKinds.heal, EntityKinds.bee, bee.playerId, EntityKinds.none, 0, hp - bee.hp);
  return hp < maxHp;
}

// ---------- Schaden ----------

/** Zieht einer Fliege Lebenspunkte ab; bei 0 stirbt sie und der Schütze erhält das Kopfgeld. */
export function damageFly(ctx: Ctx, fly: FlyStateRow, damage: number, attackerId: number): void {
  const hp = Math.max(0, Math.round(fly.hp - damage));
  const brain = ctx.db.flyBrain.flyId.find(fly.flyId);
  if (hp > 0) {
    // Angegriffene Fliegen wenden sich dem Angreifer zu
    const target = fly.state === FlyStates.flee ? fly.target : attackerId;
    ctx.db.flyState.flyId.update({ ...fly, hp, target, state: fly.state === FlyStates.flee ? fly.state : FlyStates.chase });
    if (brain) {
      ctx.db.flyBrain.flyId.update({ ...brain, lastHitBy: attackerId, active: true });
    }
    return;
  }
  killFly(ctx, fly, attackerId);
}

function killFly(ctx: Ctx, fly: FlyStateRow, killerId: number): void {
  const info = flyInfo(fly.kind);
  const brain = ctx.db.flyBrain.flyId.find(fly.flyId);
  if (brain && fly.kind === FlyKinds.queen) {
    const nest = ctx.db.nestState.nestId.find(brain.nestId);
    if (nest) {
      ctx.db.nestState.nestId.update({ ...nest, queenRespawnAtMs: nowMs(ctx) + secondsToMs(QueenRespawnSeconds) });
    }
  }
  ctx.db.flyState.flyId.delete(fly.flyId);
  ctx.db.flyBrain.flyId.delete(fly.flyId);
  emit(ctx, fly.cell, EventKinds.flyKilled, EntityKinds.bee, killerId, EntityKinds.fly, fly.flyId, info.bounty, fly.kind);
  const stats = ctx.db.playerStats.playerId.find(killerId);
  if (stats) {
    ctx.db.playerStats.playerId.update({ ...stats, honey: stats.honey + info.bounty });
  }
  addScore(ctx, killerId, info.bounty, 1, 0);
  advanceQuests(ctx, killerId, "anyFlyKill", 1, fly.cell);
  advanceQuests(ctx, killerId, fly.kind === 0 ? "blowflyKill" : fly.kind === 1 ? "brummerKill" : "queenKill", 1, fly.cell);
  grantAchievement(ctx, killerId, Achievements.firstSting.bit);
  if (fly.kind === FlyKinds.queen) {
    grantAchievement(ctx, killerId, Achievements.queenSlayer.bit);
  }
  const score = ctx.db.playerScore.playerId.find(killerId);
  if (score && score.kills >= 100) {
    grantAchievement(ctx, killerId, Achievements.exterminator.bit);
  }
}

/** Zieht einer Biene Lebenspunkte ab; bei 0 wird sie zum Geist und verliert die Ladung (Tod). */
export function damageBee(ctx: Ctx, playerId: number, damage: number, flyId: number): void {
  const bee = ctx.db.beeState.playerId.find(playerId);
  if (!bee || (bee.flags & (BeeFlags.ghost | BeeFlags.docked)) !== 0) {
    return;
  }
  const hp = Math.max(0, Math.round(bee.hp - damage));
  const stats = ctx.db.playerStats.playerId.find(playerId);
  if (hp > 0) {
    ctx.db.beeState.playerId.update({ ...bee, hp });
    if (stats) {
      ctx.db.playerStats.playerId.update({ ...stats, hp });
    }
    return;
  }
  stopAllModules(ctx, playerId);
  const current = ctx.db.beeState.playerId.find(playerId) ?? bee;
  ctx.db.beeState.playerId.update({ ...current, hp: 0, flags: (current.flags | BeeFlags.ghost) & ~BeeFlags.freeLaser });
  if (stats) {
    ctx.db.playerStats.playerId.update({ ...stats, hp: 0, cargo: 0, cargoGold: 0, deaths: stats.deaths + 1 });
  }
  emit(ctx, bee.cell, EventKinds.beeKilled, EntityKinds.fly, flyId, EntityKinds.bee, playerId);
}

// ---------- Einschläge ----------

/** Wendet alle fälligen Einschläge an (Teil des Weltakts). */
export function runImpacts(ctx: Ctx): void {
  const now = nowMs(ctx);
  const due = Array.from(ctx.db.pendingImpact.impactAtMs.filter(new Range({ tag: "unbounded" }, { tag: "included", value: now })));
  for (const impact of due) {
    ctx.db.pendingImpact.id.delete(impact.id);
    if (impact.kind === ImpactKinds.stinger) {
      const fly = ctx.db.flyState.flyId.find(impact.targetId);
      if (!fly) {
        continue;
      }
      const speed = Math.hypot(fly.vx, fly.vy, fly.vz) / 100;
      const stats = ctx.db.playerStats.playerId.find(impact.sourceId);
      const missile = stingerStats(stats ? levelsOf(stats) : levelsOfZero());
      const damage = impact.count * impact.damage * missileDamageFactor(flyInfo(fly.kind).signatureRadius, speed, missile);
      emit(ctx, fly.cell, EventKinds.missileImpact, EntityKinds.bee, impact.sourceId, EntityKinds.fly, fly.flyId, damage * 10, impact.count);
      damageFly(ctx, fly, damage, impact.sourceId);
    } else if (impact.kind === ImpactKinds.spit) {
      const bee = ctx.db.beeState.playerId.find(impact.targetId);
      if (!bee) {
        continue;
      }
      const fly = ctx.db.flyState.flyId.find(impact.sourceId);
      const motion = beeVelocity(ctx, bee);
      const transversal = fly ? transversalSpeed(fly, bee, motion.vx, motion.vy, motion.vz) : 0;
      let damage = 0;
      for (let ball = 0; ball < impact.count; ball++) {
        if (ctx.random() < spitHitChance(transversal)) {
          damage += impact.damage;
        }
      }
      emit(ctx, bee.cell, EventKinds.spitImpact, EntityKinds.fly, impact.sourceId, EntityKinds.bee, bee.playerId, damage * 10, impact.count);
      if (damage > 0) {
        damageBee(ctx, bee.playerId, damage, impact.sourceId);
      }
    }
  }
}

function levelsOfZero() {
  return { lens: 0, gatling: 0, quiver: 0, brush: 0, cargo: 0, wings: 0, armor: 0, antenna: 0, nectar: 0 };
}

function transversalSpeed(fly: FlyStateRow, bee: BeeStateRow, vx: number, vy: number, vz: number): number {
  const rx = bee.x - fly.x;
  const ry = bee.y - fly.y;
  const rz = bee.z - fly.z;
  const distance = Math.max(0.5, Math.hypot(rx, ry, rz));
  const radial = (vx * rx + vy * ry + vz * rz) / distance;
  return Math.sqrt(Math.max(0, vx * vx + vy * vy + vz * vz - radial * radial));
}

/** Eine Fliege spuckt auf eine Biene: Einschlag nach Flugzeit (Spucke). */
export function launchSpit(ctx: Ctx, fly: FlyStateRow, bee: BeeStateRow): void {
  const info = flyInfo(fly.kind);
  const distance = Math.hypot(bee.x - fly.x, bee.y - fly.y, bee.z - fly.z);
  const flightSeconds = distance / SpitSpeed + 0.1;
  ctx.db.pendingImpact.insert({
    id: 0n,
    impactAtMs: nowMs(ctx) + secondsToMs(flightSeconds),
    kind: ImpactKinds.spit,
    sourceId: fly.flyId,
    targetKind: EntityKinds.bee,
    targetId: bee.playerId,
    count: info.spitCount,
    damage: info.spitDamage,
  });
  emit(ctx, fly.cell, EventKinds.spitLaunch, EntityKinds.fly, fly.flyId, EntityKinds.bee, bee.playerId, flightSeconds * 100, info.spitCount);
}

/** Meldet das Aufschalten einer Fliege mit einem Spruch (Fliegenspruch). */
export function announceAggro(ctx: Ctx, fly: FlyStateRow, playerId: number): void {
  emit(ctx, packCell(fly.x, fly.z), EventKinds.aggro, EntityKinds.fly, fly.flyId, EntityKinds.bee, playerId, 0, Math.floor(ctx.random() * FlyTaunts.length));
}

/** Für Prüfungen: die Biene ist ein gültiges Ziel für Fliegen. */
export function isHuntable(bee: BeeStateRow): boolean {
  return (bee.flags & (BeeFlags.ghost | BeeFlags.docked | BeeFlags.warping)) === 0;
}
