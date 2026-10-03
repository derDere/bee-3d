import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { BeeFlags } from "../../../shared/events";
import { NoUpgrades, beeStats, type BeeStats, type UpgradeLevels } from "../../../shared/rules";
import type { WorldIndex } from "../../../shared/worldIndex";
import type { BeeState } from "../../net/bindings/types";
import type { LocalBee } from "../../net/netClient";
import type { ReportedPose } from "../../net/poseReporter";
import type { BeeAvatar } from "../beeAvatar";
import { FlightController, type FlightHooks } from "./flightController";

/** Server-Stand der eigenen Biene, soweit die Darstellung ihn braucht (Bienenzustand). */
export interface BeeCondition {
  readonly hp: number;
  readonly maxHp: number;
  readonly ghost: boolean;
  readonly docked: boolean;
  readonly boost: boolean;
  readonly warping: boolean;
  readonly mining: boolean;
  readonly laserFiring: boolean;
  readonly gatlingFiring: boolean;
}

/**
 * Eigene Biene (Spielerbiene): verbindet Flugsteuerung, Darstellung und Netzschicht. Die Bewegung läuft
 * lokal im festen Takt, die Darstellung interpoliert zwischen den Schritten, der Server korrigiert nur
 * bei Abweichung.
 */
export class PlayerBee implements LocalBee {
  public readonly controller: FlightController;
  public readonly avatar: BeeAvatar;
  /** Darstellungslage zwischen zwei Logikschritten (Kameraziel). */
  public readonly renderPosition = new Vector3();
  /** Zielrichtung der Laseraugen beim freien Zielen (Weltrichtung, Einheitsvektor). */
  public readonly aimDirection = new Vector3(0, 0, 1);
  /** Freies Zielen aktiv (Alt halten bzw. rechter Touch-Stick). */
  public freeAim = false;
  private conditionState: BeeCondition = { hp: 100, maxHp: 100, ghost: false, docked: false, boost: false, warping: false, mining: false, laserFiring: false, gatlingFiring: false };
  private levelsValue: UpgradeLevels = NoUpgrades;
  private statsValue: BeeStats = beeStats(NoUpgrades);
  private readonly previousPosition = new Vector3();
  private readonly pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, aimYaw: 0, aimPitch: 0, clientFlags: 0 };
  private night = false;

  public constructor(avatar: BeeAvatar, world: WorldIndex, hooks: FlightHooks) {
    this.avatar = avatar;
    this.controller = new FlightController(this.statsValue, world, hooks);
  }

  public get position(): Vector3 {
    return this.controller.position;
  }

  public get stats(): BeeStats {
    return this.statsValue;
  }

  public get levels(): UpgradeLevels {
    return this.levelsValue;
  }

  public get condition(): BeeCondition {
    return this.conditionState;
  }

  /** Tempo für die Kamera (Kameraziel). */
  public get speed(): number {
    return this.controller.speed;
  }

  // ---------- LocalBee ----------

  public get reportedPose(): ReportedPose {
    const heading = this.controller.heading;
    const aim = this.freeAim ? this.aimDirection : heading;
    this.pose.x = this.controller.position.x;
    this.pose.y = this.controller.position.y;
    this.pose.z = this.controller.position.z;
    this.pose.yaw = Math.atan2(heading.x, heading.z);
    this.pose.pitch = Math.asin(Math.max(-1, Math.min(1, heading.y)));
    this.pose.aimYaw = Math.atan2(aim.x, aim.z);
    this.pose.aimPitch = Math.asin(Math.max(-1, Math.min(1, aim.y)));
    this.pose.clientFlags = this.freeAim ? BeeFlags.freeLaser : 0;
    return this.pose;
  }

  public get reporting(): boolean {
    return !this.controller.docked;
  }

  public correctTo(x: number, y: number, z: number): void {
    this.controller.teleport(x, y, z);
    this.previousPosition.set(x, y, z);
    this.renderPosition.set(x, y, z);
  }

  // ---------- Server-Stand ----------

  /** Übernimmt die autoritative Zeile (LP, Flags). */
  public applyServerRow(row: BeeState): void {
    const flags = row.flags;
    this.conditionState = {
      hp: row.hp,
      maxHp: row.maxHp,
      ghost: (flags & BeeFlags.ghost) !== 0,
      docked: (flags & BeeFlags.docked) !== 0,
      boost: (flags & BeeFlags.boost) !== 0,
      warping: (flags & BeeFlags.warping) !== 0,
      mining: (flags & BeeFlags.mining) !== 0,
      laserFiring: (flags & BeeFlags.laserFiring) !== 0,
      gatlingFiring: (flags & BeeFlags.gatlingFiring) !== 0,
    };
    this.controller.ghost = this.conditionState.ghost;
    this.controller.boost = this.conditionState.boost;
    this.controller.docked = this.conditionState.docked;
  }

  /** Übernimmt neue Upgrade-Stufen (Tempo, Wendigkeit, LP). */
  public setUpgrades(levels: UpgradeLevels): void {
    if (sameLevels(levels, this.levelsValue)) {
      return;
    }
    this.levelsValue = levels;
    this.statsValue = beeStats(levels);
    this.controller.setStats(this.statsValue);
  }

  /** Lokaler Zustand ohne Server (Erkundungsmodus): Geist und Andocken stehen still. */
  public setOfflineCondition(): void {
    this.conditionState = { ...this.conditionState, hp: this.statsValue.maxHp, maxHp: this.statsValue.maxHp, ghost: false, docked: false };
    this.controller.ghost = false;
    this.controller.docked = false;
  }

  public setNight(night: boolean): void {
    this.night = night;
  }

  // ---------- Takt ----------

  public fixedUpdate(dt: number): void {
    this.previousPosition.copyFrom(this.controller.position);
    this.controller.fixedUpdate(dt);
  }

  public frameUpdate(dt: number, alpha: number): void {
    Vector3.LerpToRef(this.previousPosition, this.controller.position, alpha, this.renderPosition);
    const heading = this.controller.heading;
    const yaw = Math.atan2(heading.x, heading.z);
    const pitch = Math.asin(Math.max(-1, Math.min(1, heading.y)));
    const condition = this.conditionState;
    this.avatar.setVisible(!condition.docked);
    this.avatar.setPose(this.renderPosition, yaw, pitch, this.controller.bank);
    this.avatar.setLook({ night: this.night, laser: condition.laserFiring || this.freeAim, ghost: condition.ghost });
    this.avatar.update(dt, this.controller.speed, this.controller.speed < 0.3);
  }

  public dispose(): void {
    this.avatar.dispose();
  }
}

function sameLevels(a: UpgradeLevels, b: UpgradeLevels): boolean {
  return (Object.keys(a) as Array<keyof UpgradeLevels>).every((key) => a[key] === b[key]);
}
