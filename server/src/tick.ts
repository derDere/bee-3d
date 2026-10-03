// server/src/tick.ts — Weltakt (20 Hz): Posen übernehmen und prüfen, Module, Einschläge, Fliegen, Nester.
import { Achievements } from "../../shared/achievements";
import { isNightHours, solarHours } from "../../shared/dayClock";
import { BeeFlags, ClientReportableFlags } from "../../shared/events";
import { BoostSpeedFactor, GhostSpeedFactor } from "../../shared/rules";
import {
  BoundaryMargin,
  BoundaryPushZone,
  MaxElapsedTicks,
  MaxWarpSpeed,
  MoveBudgetSeconds,
  WarpLandingDistance,
  SpeedSlack,
  TickHz,
  TickSeconds,
  WorldRadius,
  clampToWorld,
  packCell,
} from "../../shared/world";
import { currentTick, nowMs, worldSeconds } from "./clock";
import { runImpacts, runModuleCycles } from "./combat";
import { stepFlies, updateNestActivity } from "./flies";
import { WarpCooldownMs } from "./players";
import { advanceQuests, grantAchievement, statsOf } from "./progress";
import spacetimedb, { tickTimer, type Ctx } from "./schema";
import { worldIndex } from "./world";

/** Quest „Erster Ausflug“: Abstand zur Grasnarbe, ab dem eine Insel als besucht gilt. */
const IslandVisitDistance = 30;
/**
 * Ab diesem Abstand vom Mittelpunkt gilt der Wolkenrand der Weltkugel als berührt: 50 m tief in der Böenzone.
 * Dorthin kommt jede Biene aus eigener Kraft; die Böen halten sie weiter außen auf.
 */
const EdgeTouchRadius = WorldRadius - BoundaryMargin - BoundaryPushZone + 50;
/** So lange gilt ein höheres Tempo nach Boost- oder Warp-Ende weiter (Auslaufen). */
const SpeedHoldMs = 1_500n;
/** Seitlicher Spielraum um die Warp-Strecke in Metern. */
const WarpCorridor = 25;
/** Ab diesem Abstand zum Ziel endet der Warp auf dem Server. */
const WarpArrivalDistance = WarpLandingDistance + 5;

type WarpRow = NonNullable<ReturnType<Ctx["db"]["warpState"]["playerId"]["find"]>>;

/** Hält eine Pose im Warp-Korridor: nächster Punkt der Strecke plus höchstens WarpCorridor seitlich. */
function constrainToWarp(warp: WarpRow, x: number, y: number, z: number): { x: number; y: number; z: number } {
  const sx = warp.toX - warp.fromX;
  const sy = warp.toY - warp.fromY;
  const sz = warp.toZ - warp.fromZ;
  const lengthSquared = Math.max(1e-6, sx * sx + sy * sy + sz * sz);
  const t = Math.min(1, Math.max(0, ((x - warp.fromX) * sx + (y - warp.fromY) * sy + (z - warp.fromZ) * sz) / lengthSquared));
  const cx = warp.fromX + sx * t;
  const cy = warp.fromY + sy * t;
  const cz = warp.fromZ + sz * t;
  const offset = Math.hypot(x - cx, y - cy, z - cz);
  if (offset <= WarpCorridor) {
    return { x, y, z };
  }
  const k = WarpCorridor / offset;
  return { x: cx + (x - cx) * k, y: cy + (y - cy) * k, z: cz + (z - cz) * k };
}

/** Übernimmt alle Posen-Eingänge in einer Transaktion und kappt zu schnelle Sprünge (Posen). */
function applyPoses(ctx: Ctx, tick: number): void {
  const now = nowMs(ctx);
  for (const pose of Array.from(ctx.db.poseInbox.iter())) {
    ctx.db.poseInbox.playerId.delete(pose.playerId);
    const state = ctx.db.beeState.playerId.find(pose.playerId);
    if (!state || (state.flags & BeeFlags.docked) !== 0) {
      continue;
    }
    let flags = state.flags;
    let warp = ctx.db.warpState.playerId.find(pose.playerId) ?? undefined;
    if (warp && warp.untilMs < now) {
      ctx.db.warpState.playerId.delete(pose.playerId);
      flags &= ~BeeFlags.warping;
      warp = undefined;
    }
    const warping = warp !== undefined && (flags & BeeFlags.warping) !== 0;
    // Tempo dieser Biene: Upgrades, Boost und Geist; höhere Grenzen gelten nach dem Wechsel noch kurz weiter
    const stats = ctx.db.playerStats.playerId.find(pose.playerId);
    const cruise = (stats ? statsOf(stats).maxSpeed : 14) * ((flags & BeeFlags.boost) !== 0 ? BoostSpeedFactor : 1) * ((flags & BeeFlags.ghost) !== 0 ? GhostSpeedFactor : 1);
    const current = warping ? MaxWarpSpeed : cruise;
    const motion = ctx.db.beeMotion.playerId.find(pose.playerId);
    let heldSpeed = motion?.heldSpeed ?? current;
    let heldUntilMs = motion?.heldUntilMs ?? 0n;
    if (current >= heldSpeed || now >= heldUntilMs) {
      heldSpeed = current;
      heldUntilMs = now + SpeedHoldMs;
    }
    const speedLimit = Math.max(current, heldSpeed) * SpeedSlack;
    // Stillstand schreibt keine Zeile; ohne Obergrenze würde er ein Sprungbudget ansammeln.
    const elapsedTicks = Math.min(Math.max(1, tick - state.tick), MaxElapsedTicks);
    // Token-Bucket: das Budget füllt sich mit dem Höchsttempo und fasst eine halbe Sekunde. So gleichen sich
    // Posen aus, die dichter oder lockerer eintreffen, als sie gesendet wurden; der Schnitt bleibt begrenzt.
    const budget = Math.min(speedLimit * MoveBudgetSeconds, (motion?.budget ?? 0) + speedLimit * elapsedTicks * TickSeconds);
    // Im Warp bleibt die Pose im Korridor der freigegebenen Strecke
    const reported = warp !== undefined ? constrainToWarp(warp, pose.x, pose.y, pose.z) : pose;
    const dx = reported.x - state.x;
    const dy = reported.y - state.y;
    const dz = reported.z - state.z;
    const distance = Math.hypot(dx, dy, dz);
    const k = distance > budget ? budget / Math.max(distance, 1e-6) : 1;
    const clamped = clampToWorld(state.x + dx * k, state.y + dy * k, state.z + dz * k);
    if (warp !== undefined && Math.hypot(clamped.x - warp.toX, clamped.y - warp.toY, clamped.z - warp.toZ) < WarpArrivalDistance) {
      // Angekommen: Warp endet sofort, Module und Fliegen-Aufmerksamkeit sind wieder da, der nächste Warp nach der Abklingzeit
      ctx.db.warpState.playerId.delete(pose.playerId);
      flags &= ~BeeFlags.warping;
      const cooldown = ctx.db.cooldown.playerId.find(pose.playerId);
      if (cooldown && cooldown.nextWarpAtMs > now + WarpCooldownMs) {
        ctx.db.cooldown.playerId.update({ ...cooldown, nextWarpAtMs: now + WarpCooldownMs });
      }
    }
    const nextFlags = (flags & ~ClientReportableFlags) | (pose.clientFlags & ClientReportableFlags);
    const unchanged =
      distance * k <= 0.01 &&
      pose.yaw === state.yaw &&
      pose.pitch === state.pitch &&
      pose.aimYaw === state.aimYaw &&
      pose.aimPitch === state.aimPitch &&
      nextFlags === state.flags;
    if (unchanged) {
      continue; // kein Update, kein Commit-Log-Eintrag
    }
    ctx.db.beeState.playerId.update({
      ...state,
      cell: packCell(clamped.x, clamped.z),
      x: clamped.x,
      y: clamped.y,
      z: clamped.z,
      yaw: pose.yaw,
      pitch: pose.pitch,
      aimYaw: pose.aimYaw,
      aimPitch: pose.aimPitch,
      tick,
      flags: nextFlags,
    });
    const seconds = elapsedTicks * TickSeconds;
    // Geschwindigkeit für Tracking und Ausweichen, auf das erlaubte Tempo begrenzt
    let vx = (clamped.x - state.x) / seconds;
    let vy = (clamped.y - state.y) / seconds;
    let vz = (clamped.z - state.z) / seconds;
    const speed = Math.hypot(vx, vy, vz);
    if (speed > speedLimit) {
      const s = speedLimit / speed;
      vx *= s;
      vy *= s;
      vz *= s;
    }
    if (motion) {
      ctx.db.beeMotion.playerId.update({
        playerId: pose.playerId,
        vx: (motion.vx + vx) / 2,
        vy: (motion.vy + vy) / 2,
        vz: (motion.vz + vz) / 2,
        budget: Math.max(0, budget - distance * k),
        heldSpeed,
        heldUntilMs,
      });
    }
    if (Math.hypot(clamped.x, clamped.y, clamped.z) > EdgeTouchRadius) {
      advanceQuests(ctx, pose.playerId, "edgeTouch", 1, packCell(clamped.x, clamped.z));
      grantAchievement(ctx, pose.playerId, Achievements.stormRunner.bit);
    }
  }
}

/** Langsame Prüfungen je Spieler, über die Takte einer Sekunde verteilt (Inselbesuch, Geisterstunde, Warp-Ende). */
function slowChecks(ctx: Ctx, tick: number): void {
  const night = isNightHours(solarHours(worldSeconds(ctx)));
  const now = nowMs(ctx);
  for (const bee of Array.from(ctx.db.beeState.iter())) {
    if (bee.playerId % TickHz !== tick % TickHz) {
      continue;
    }
    const warp = ctx.db.warpState.playerId.find(bee.playerId);
    if (warp && warp.untilMs < now) {
      ctx.db.warpState.playerId.delete(bee.playerId);
      ctx.db.beeState.playerId.update({ ...bee, flags: bee.flags & ~BeeFlags.warping });
      continue;
    }
    if ((bee.flags & BeeFlags.ghost) !== 0 && night) {
      grantAchievement(ctx, bee.playerId, Achievements.ghostHour.bit);
    }
    let firstTripOpen = false;
    for (const quest of ctx.db.questProgress.byPlayerQuest.filter([bee.playerId, 1])) {
      firstTripOpen = quest.completions === 0;
    }
    if (firstTripOpen && (bee.flags & BeeFlags.docked) === 0) {
      for (const island of worldIndex().islandsNear(bee.x, bee.z, IslandVisitDistance)) {
        if (bee.y < island.canopy + IslandVisitDistance && bee.y > island.bottom - IslandVisitDistance) {
          advanceQuests(ctx, bee.playerId, "islandVisit", 1, bee.cell);
          break;
        }
      }
    }
  }
}

/** Der Weltakt: läuft alle 50 ms (Weltakt). */
export const worldTick = spacetimedb.reducer({ onSchedule: tickTimer }, { arg: tickTimer.rowType }, (ctx) => {
  const tick = currentTick(ctx);
  applyPoses(ctx, tick);
  runModuleCycles(ctx);
  runImpacts(ctx);
  if (tick % 2 === 0) {
    stepFlies(ctx);
  }
  slowChecks(ctx, tick);
  if (tick % TickHz === 7) {
    updateNestActivity(ctx);
  }
});
