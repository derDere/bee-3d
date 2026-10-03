// server/src/flies.ts — Fliegen-KI und Nester: Brut, Aktivierung um Spieler, Patrouille, Jagd, Flucht, Heimkehr.
import { isNightHours, solarHours } from "../../shared/dayClock";
import { FlyStates } from "../../shared/events";
import {
  FlyActivationRange,
  FlyKinds,
  FlyLeash,
  NestBlowflies,
  NestBrummers,
  NestRespawnSeconds,
  flyInfo,
  type FlyKind,
} from "../../shared/rules";
import { clampToWorld, encodeAngle, neighbourCells, packCell } from "../../shared/world";
import type { NestPlacement } from "../../shared/worldgen";
import { announceAggro, isHuntable, launchSpit } from "./combat";
import { currentTick, nowMs, secondsToMs, worldSeconds } from "./clock";
import type { BeeStateRow } from "./progress";
import type { Ctx } from "./schema";
import { world, worldIndex } from "./world";

type FlyStateRow = NonNullable<ReturnType<Ctx["db"]["flyState"]["flyId"]["find"]>>;
type FlyBrainRow = NonNullable<ReturnType<Ctx["db"]["flyBrain"]["flyId"]["find"]>>;

/** Zeitschritt der Fliegen-KI (jeder zweite Weltakt). */
export const FlyStepSeconds = 0.1;
const QueenSummonSeconds = 20;
const QueenEscortCap = 6;

function nestOf(nestId: number): NestPlacement | undefined {
  return world().nests[nestId];
}

/** Legt eine neue Fliege am Nest an (Brut). */
export function spawnFly(ctx: Ctx, nest: NestPlacement, kind: FlyKind, near?: { x: number; y: number; z: number }): void {
  const info = flyInfo(kind);
  const origin = near ?? nest;
  const x = origin.x + (ctx.random() - 0.5) * 30;
  const y = origin.y + 4 + ctx.random() * 10;
  const z = origin.z + (ctx.random() - 0.5) * 30;
  const fly = ctx.db.flyState.insert({
    flyId: 0,
    cell: packCell(x, z),
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    kind,
    hp: info.maxHp,
    state: FlyStates.patrol,
    target: 0,
    tick: currentTick(ctx),
  });
  const now = nowMs(ctx);
  ctx.db.flyBrain.insert({
    flyId: fly.flyId,
    nestId: nest.id,
    active: true,
    goalX: x,
    goalY: y,
    goalZ: z,
    orbitSign: ctx.random() < 0.5 ? -1 : 1,
    nextThinkAtMs: now,
    nextSpitAtMs: now + 1500n,
    nextSummonAtMs: now + secondsToMs(QueenSummonSeconds),
    lastHitBy: 0,
  });
}

/** Füllt ein Nest auf: fehlende Brummer, Schmeißfliegen und die Königin (Nachbrut). */
export function refillNest(ctx: Ctx, nest: NestPlacement, all: boolean): void {
  const state = ctx.db.nestState.nestId.find(nest.id);
  if (!state) {
    return;
  }
  const now = nowMs(ctx);
  if (!all && now < state.nextSpawnAtMs) {
    return;
  }
  let blowflies = 0;
  let brummers = 0;
  let queens = 0;
  for (const brain of ctx.db.flyBrain.nestId.filter(nest.id)) {
    const fly = ctx.db.flyState.flyId.find(brain.flyId);
    if (fly?.kind === FlyKinds.blowfly) blowflies++;
    else if (fly?.kind === FlyKinds.brummer) brummers++;
    else if (fly?.kind === FlyKinds.queen) queens++;
  }
  const missing: FlyKind[] = [];
  if (nest.hasQueen && queens === 0 && now >= state.queenRespawnAtMs) missing.push(FlyKinds.queen);
  for (let i = brummers; i < NestBrummers; i++) missing.push(FlyKinds.brummer);
  for (let i = blowflies; i < NestBlowflies; i++) missing.push(FlyKinds.blowfly);
  const toSpawn = all ? missing : missing.slice(0, 1);
  for (const kind of toSpawn) {
    spawnFly(ctx, nest, kind);
  }
  if (toSpawn.length > 0) {
    ctx.db.nestState.nestId.update({ ...state, nextSpawnAtMs: now + secondsToMs(NestRespawnSeconds) });
  }
}

/** Schaltet die Fliegen eines Nests ein oder aus, je nachdem ob Spieler in der Nähe sind (Aktivierung). */
export function updateNestActivity(ctx: Ctx): void {
  const bees = Array.from(ctx.db.beeState.iter()).filter(isHuntable);
  for (const nest of world().nests) {
    const state = ctx.db.nestState.nestId.find(nest.id);
    if (!state) {
      continue;
    }
    const range2 = FlyActivationRange * FlyActivationRange;
    const active = bees.some((bee) => (bee.x - nest.x) ** 2 + (bee.y - nest.y) ** 2 + (bee.z - nest.z) ** 2 < range2);
    if (active !== state.active) {
      ctx.db.nestState.nestId.update({ ...state, active });
      for (const brain of Array.from(ctx.db.flyBrain.nestId.filter(nest.id))) {
        if (brain.active !== active) {
          ctx.db.flyBrain.flyId.update({ ...brain, active });
          const fly = ctx.db.flyState.flyId.find(brain.flyId);
          if (fly && (fly.vx !== 0 || fly.vy !== 0 || fly.vz !== 0)) {
            ctx.db.flyState.flyId.update({ ...fly, vx: 0, vy: 0, vz: 0 });
          }
        }
      }
    }
    refillNest(ctx, nest, false);
  }
}

/** Ein KI-Schritt aller aktiven Fliegen (Teil des Weltakts, 10 Hz). */
export function stepFlies(ctx: Ctx): void {
  const now = nowMs(ctx);
  const tick = currentTick(ctx);
  const night = isNightHours(solarHours(worldSeconds(ctx)));
  for (const brain of Array.from(ctx.db.flyBrain.iter())) {
    if (!brain.active) {
      continue;
    }
    const fly = ctx.db.flyState.flyId.find(brain.flyId);
    const nest = nestOf(brain.nestId);
    if (!fly || nest === undefined) {
      continue;
    }
    stepFly(ctx, fly, brain, nest, now, tick, night);
  }
}

function stepFly(ctx: Ctx, fly: FlyStateRow, brain: FlyBrainRow, nest: NestPlacement, now: bigint, tick: number, night: boolean): void {
  const info = flyInfo(fly.kind);
  let state = fly.state;
  let target = fly.target;
  let hp = fly.hp;
  let { goalX, goalY, goalZ, nextThinkAtMs, nextSpitAtMs, nextSummonAtMs } = brain;
  const homeDistance = Math.hypot(fly.x - nest.x, fly.y - nest.y, fly.z - nest.z);
  const aggro = night ? info.aggroNight : info.aggroDay;

  let targetBee: BeeStateRow | undefined;
  if (state === FlyStates.chase) {
    targetBee = ctx.db.beeState.playerId.find(target) ?? undefined;
    const lost =
      !targetBee ||
      !isHuntable(targetBee) ||
      homeDistance > FlyLeash ||
      Math.hypot(targetBee.x - fly.x, targetBee.y - fly.y, targetBee.z - fly.z) > aggro * 1.6;
    if (lost) {
      state = FlyStates.returnHome;
      target = 0;
      targetBee = undefined;
    } else if (hp < info.maxHp * 0.2 && fly.kind !== FlyKinds.queen) {
      state = FlyStates.flee;
    }
  }

  if (now >= nextThinkAtMs) {
    nextThinkAtMs = now + 500n;
    if (state === FlyStates.patrol || state === FlyStates.returnHome) {
      const found = nearestHuntableBee(ctx, fly, aggro, nest);
      // Höchstens MaxChasersPerBee Fliegen eines Nests jagen dieselbe Biene; die übrigen patrouillieren weiter
      if (found !== undefined && homeDistance < FlyLeash * 0.8 && chasersOf(ctx, nest.id, found.playerId) < MaxChasersPerBee) {
        state = FlyStates.chase;
        target = found.playerId;
        targetBee = found;
        announceAggro(ctx, fly, found.playerId);
      } else if (state === FlyStates.patrol) {
        // Neuer Patrouillenpunkt über der Nest-Insel; am Nest heilen Fliegen langsam
        goalX = nest.x + (ctx.random() - 0.5) * 160;
        goalY = nest.y + 6 + ctx.random() * 30;
        goalZ = nest.z + (ctx.random() - 0.5) * 160;
        if (homeDistance < 80) {
          hp = Math.min(info.maxHp, hp + Math.ceil(info.maxHp * 0.02));
        }
      }
    }
    if (state === FlyStates.returnHome && homeDistance < 30) {
      state = FlyStates.patrol;
    }
    if (state === FlyStates.flee && homeDistance < 20) {
      state = FlyStates.patrol;
      target = 0;
    }
  }

  let speedFactor = 0.45;
  if (state === FlyStates.chase && targetBee !== undefined) {
    // Umkreisen: Ziel liegt auf dem Orbit, ein Stück in Drehrichtung voraus
    const rx = fly.x - targetBee.x;
    const rz = fly.z - targetBee.z;
    const horizontal = Math.max(0.5, Math.hypot(rx, rz));
    const ux = rx / horizontal;
    const uz = rz / horizontal;
    const sign = brain.orbitSign;
    goalX = targetBee.x + ux * info.orbitDistance - uz * sign * info.orbitDistance * 0.7;
    goalZ = targetBee.z + uz * info.orbitDistance + ux * sign * info.orbitDistance * 0.7;
    goalY = targetBee.y + 3 + Math.sin(Number(now % 6283n) / 1000) * 4;
    speedFactor = 1;
    const distance = Math.hypot(targetBee.x - fly.x, targetBee.y - fly.y, targetBee.z - fly.z);
    if (distance <= info.spitRange && now >= nextSpitAtMs) {
      launchSpit(ctx, fly, targetBee);
      nextSpitAtMs = now + secondsToMs(info.spitCooldown * (0.8 + 0.4 * ctx.random()));
    }
    if (fly.kind === FlyKinds.queen && now >= nextSummonAtMs) {
      nextSummonAtMs = now + secondsToMs(QueenSummonSeconds);
      let escorts = 0;
      for (const other of ctx.db.flyBrain.nestId.filter(nest.id)) {
        escorts += other.flyId !== fly.flyId ? 1 : 0;
      }
      if (escorts < NestBlowflies + NestBrummers + QueenEscortCap) {
        spawnFly(ctx, nest, FlyKinds.blowfly, fly);
        spawnFly(ctx, nest, FlyKinds.blowfly, fly);
      }
    }
  } else if (state === FlyStates.flee || state === FlyStates.returnHome) {
    goalX = nest.x;
    goalY = nest.y + 8;
    goalZ = nest.z;
    speedFactor = state === FlyStates.flee ? 1.15 : 0.8;
  }

  // Lenken: gewünschte Geschwindigkeit zum Ziel, träge angenähert
  const dx = goalX - fly.x;
  const dy = goalY - fly.y;
  const dz = goalZ - fly.z;
  const toGoal = Math.max(0.001, Math.hypot(dx, dy, dz));
  const desiredSpeed = info.speed * speedFactor * Math.min(1, toGoal / 6);
  const blend = Math.min(1, 3.5 * FlyStepSeconds);
  const previousVx = fly.vx / CentimetresPerMetre;
  const previousVy = fly.vy / CentimetresPerMetre;
  const previousVz = fly.vz / CentimetresPerMetre;
  let vx = previousVx + ((dx / toGoal) * desiredSpeed - previousVx) * blend;
  let vy = previousVy + ((dy / toGoal) * desiredSpeed - previousVy) * blend;
  let vz = previousVz + ((dz / toGoal) * desiredSpeed - previousVz) * blend;
  let x = fly.x + vx * FlyStepSeconds;
  let y = fly.y + vy * FlyStepSeconds;
  let z = fly.z + vz * FlyStepSeconds;
  const inside = worldIndex().penetration(x, y, z, info.length);
  if (inside !== undefined) {
    y = inside.top + info.length; // aus der Insel nach oben schieben
    vy = Math.max(0, vy);
  }
  const clamped = clampToWorld(x, y, z);
  x = clamped.x;
  y = clamped.y;
  z = clamped.z;

  const speed = Math.hypot(vx, vy, vz);
  const yaw = speed > 0.2 ? encodeAngle(Math.atan2(vx, vz)) : fly.yaw;
  const pitch = speed > 0.2 ? encodeAngle(-Math.asin(Math.max(-1, Math.min(1, vy / speed))) * 0.6) : fly.pitch;
  const moved = Math.hypot(x - fly.x, y - fly.y, z - fly.z) > 0.02;
  if (!moved) {
    vx = 0;
    vy = 0;
    vz = 0;
  }
  const encodedVx = encodeVelocity(vx);
  const encodedVy = encodeVelocity(vy);
  const encodedVz = encodeVelocity(vz);
  const velocityChanged = encodedVx !== fly.vx || encodedVy !== fly.vy || encodedVz !== fly.vz;
  if (moved || velocityChanged || state !== fly.state || target !== fly.target || hp !== fly.hp) {
    ctx.db.flyState.flyId.update({ ...fly, cell: packCell(x, z), x, y, z, vx: encodedVx, vy: encodedVy, vz: encodedVz, yaw, pitch, hp, state, target, tick });
  }
  // Das Gedächtnis nur schreiben, wenn sich etwas darin geändert hat (spart die Hälfte der Fliegen-Schreiblast)
  if (
    goalX !== brain.goalX ||
    goalY !== brain.goalY ||
    goalZ !== brain.goalZ ||
    nextThinkAtMs !== brain.nextThinkAtMs ||
    nextSpitAtMs !== brain.nextSpitAtMs ||
    nextSummonAtMs !== brain.nextSummonAtMs
  ) {
    ctx.db.flyBrain.flyId.update({ ...brain, goalX, goalY, goalZ, nextThinkAtMs, nextSpitAtMs, nextSummonAtMs });
  }
}

/** Zentimeter je Meter für die Geschwindigkeit in fly_state (i16). */
const CentimetresPerMetre = 100;

/** Geschwindigkeit in m/s → i16 in cm/s. */
function encodeVelocity(metresPerSecond: number): number {
  return Math.max(-32767, Math.min(32767, Math.round(metresPerSecond * CentimetresPerMetre)));
}

/** So viele Fliegen eines Nests jagen höchstens gleichzeitig dieselbe Biene. */
const MaxChasersPerBee = 3;

/** Zahl der Fliegen eines Nests, die gerade eine bestimmte Biene jagen. */
function chasersOf(ctx: Ctx, nestId: number, playerId: number): number {
  let count = 0;
  for (const brain of ctx.db.flyBrain.nestId.filter(nestId)) {
    const fly = ctx.db.flyState.flyId.find(brain.flyId);
    if (fly && fly.state === FlyStates.chase && fly.target === playerId) {
      count++;
    }
  }
  return count;
}

/** Nächste jagdbare Biene im Aggro-Radius, die nicht weiter als die Leine vom Nest entfernt ist. */
function nearestHuntableBee(ctx: Ctx, fly: FlyStateRow, aggro: number, nest: NestPlacement): BeeStateRow | undefined {
  let best: BeeStateRow | undefined;
  let bestDistance = aggro;
  for (const cell of neighbourCells(fly.x, fly.z, 1)) {
    for (const bee of ctx.db.beeState.cell.filter(cell)) {
      if (!isHuntable(bee)) {
        continue;
      }
      const distance = Math.hypot(bee.x - fly.x, bee.y - fly.y, bee.z - fly.z);
      const fromNest = Math.hypot(bee.x - nest.x, bee.y - nest.y, bee.z - nest.z);
      if (distance < bestDistance && fromNest < FlyLeash) {
        best = bee;
        bestDistance = distance;
      }
    }
  }
  return best;
}
