import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { BoostSpeedFactor, GhostSpeedFactor, type BeeStats } from "../../../shared/rules";
import { WarpLandingDistance, WarpMinDistance, WarpSpeed, boundaryOverflow, boundaryPressure, clampToWorld } from "../../../shared/world";
import type { WorldIndex } from "../../../shared/worldIndex";

/** Ein Objekt, auf das sich ein Befehl bezieht: Lage, Tempo, Größe (Befehlsziel). */
export interface CommandTarget {
  readonly position: Vector3;
  readonly velocity: Vector3;
  /** Halbmesser des Objekts; Hinfliegen endet davor. */
  readonly radius: number;
}

/** Liefert das aktuelle Befehlsziel oder undefined, wenn es verschwunden ist (Zielquelle). */
export type TargetSource = () => CommandTarget | undefined;

/** Art des laufenden Flugbefehls (Befehlsart). */
export type FlightCommandKind = "idle" | "direction" | "point" | "approach" | "orbit" | "keepRange" | "align" | "warp" | "dock" | "manual";

/** Phase eines Warps (Warpphase). */
export type WarpPhase = "aligning" | "requesting" | "warping" | "landing";

/** Hooks an das Spiel: Server-Anfragen und Ereignisse der Steuerung (Steuerungsereignisse). */
export interface FlightHooks {
  /** Der Warp ist ausgerichtet; das Spiel fragt den Server an und meldet über `warpGranted` zurück. */
  requestWarp(target: Vector3): void;
  /** Andockreichweite erreicht. */
  requestDock(): void;
  /** Kurzer Hinweis an den Spieler (Protokoll). */
  notice(text: string): void;
}

const TurnBlend = 6;
/** Langsamer werden geht schneller als Beschleunigen: Anteil der Trägheit beim Bremsen (bessere Kontrolle). */
const BrakeInertiaShare = 0.6;
/** Mindesttempo beim Anflug, damit exponentielles Abbremsen das Ziel in endlicher Zeit erreicht (m/s). */
const ArrivalSpeed = 0.6;
/** Zusätzliche Reibung beim Bremsen (m/s²): beendet den langsamen Auslauf der Exponentialkurve. */
const BrakeFriction = 0.8;
const OrbitCorrection = 0.8;
const KeepRangeTolerance = 2;
const CollisionClearance = 0.12;
const AlignToleranceCos = Math.cos((12 * Math.PI) / 180);

/**
 * Flugsteuerung der eigenen Biene nach EVE-Vorbild (Flugsteuerung): Der Spieler gibt Befehle, die Biene
 * führt sie träge aus — begrenzte Wendigkeit, Beschleunigung, Höchsttempo. Läuft im festen Spieltakt.
 */
export class FlightController {
  public readonly position = new Vector3();
  public readonly velocity = new Vector3();
  /** Flugrichtung als Einheitsvektor (wohin die Biene schaut). */
  public readonly heading = new Vector3(0, 0, 1);
  public throttle = 0.6;
  public command: FlightCommandKind = "idle";
  public commandLabel = "Hovering";
  public boost = false;
  public ghost = false;
  public docked = false;
  public warpPhase: WarpPhase | undefined;
  /** Seitenneigung für die Darstellung (rad). */
  public bank = 0;
  private stats: BeeStats;
  private readonly world: WorldIndex;
  private readonly hooks: FlightHooks;
  private target: TargetSource | undefined;
  private commandDistance = 0;
  private readonly commandPoint = new Vector3();
  private readonly commandDirection = new Vector3(0, 0, 1);
  private readonly orbitNormal = new Vector3(0, 1, 0);
  private readonly lastTargetPosition = new Vector3();
  private readonly warpTarget = new Vector3();
  private warpGrantedAt = 0;
  private manualYaw = 0;
  private manualPitch = 0;
  private dockRequested = false;
  private time = 0;
  private readonly desiredDirection = new Vector3();
  private readonly scratch = new Vector3();
  private readonly scratch2 = new Vector3();
  private readonly previousHeading = new Vector3(0, 0, 1);

  public constructor(stats: BeeStats, world: WorldIndex, hooks: FlightHooks) {
    this.stats = stats;
    this.world = world;
    this.hooks = hooks;
  }

  public setStats(stats: BeeStats): void {
    this.stats = stats;
  }

  /** Aktuelles Höchsttempo mit Boost und Geist. */
  public get maxSpeed(): number {
    return this.stats.maxSpeed * (this.boost ? BoostSpeedFactor : 1) * (this.ghost ? GhostSpeedFactor : 1);
  }

  public get speed(): number {
    return this.velocity.length();
  }

  public get isWarping(): boolean {
    return this.warpPhase === "warping" || this.warpPhase === "landing";
  }

  // ---------- Befehle ----------

  /** Fliegt in eine Richtung (Doppelklick in den Raum). */
  public flyDirection(direction: Vector3): void {
    this.clearCommand("direction", "Holding course");
    this.commandDirection.copyFrom(direction).normalize();
  }

  /** Fliegt zu einem Punkt und hält dort an (Q-Wählscheibe). */
  public flyToPoint(point: Vector3): void {
    this.clearCommand("point", `To point (${Math.round(Vector3.Distance(point, this.position))} m)`);
    this.commandPoint.copyFrom(point);
  }

  public approach(target: TargetSource, label: string): void {
    this.clearCommand("approach", `Approach: ${label}`);
    this.target = target;
  }

  public orbit(target: TargetSource, distance: number, label: string): void {
    this.clearCommand("orbit", `Orbit ${distance} m: ${label}`);
    this.target = target;
    this.commandDistance = distance;
    const current = target();
    if (current !== undefined) {
      // Bahnebene aus der aktuellen Bewegung, sonst waagrecht
      current.position.subtractToRef(this.position, this.scratch);
      Vector3.CrossToRef(this.scratch, this.velocity.lengthSquared() > 0.5 ? this.velocity : this.heading, this.orbitNormal);
      if (this.orbitNormal.lengthSquared() < 1e-6) {
        this.orbitNormal.set(0, 1, 0);
      }
      this.orbitNormal.normalize();
      if (Math.abs(this.orbitNormal.y) < 0.35) {
        this.orbitNormal.set(0, Math.sign(this.orbitNormal.y || 1), 0);
      }
    }
  }

  public keepRange(target: TargetSource, distance: number, label: string): void {
    this.clearCommand("keepRange", `Keep range ${distance} m: ${label}`);
    this.target = target;
    this.commandDistance = distance;
  }

  public align(target: TargetSource, label: string): void {
    this.clearCommand("align", `Align: ${label}`);
    this.target = target;
  }

  /** Warp zu einem Ziel; mindestens 150 m entfernt. Geister dürfen ohne Mindestabstand heimkehren. */
  public warp(target: TargetSource, label: string, ignoreMinimum = false): boolean {
    const current = target();
    if (current === undefined) {
      return false;
    }
    const distance = Vector3.Distance(current.position, this.position) - current.radius;
    if (distance < WarpMinDistance && !ignoreMinimum) {
      this.hooks.notice(`Too close to warp (at least ${WarpMinDistance} m).`);
      return false;
    }
    this.clearCommand("warp", `Warp: ${label}`);
    this.target = target;
    this.warpPhase = "aligning";
    return true;
  }

  /** Fliegt zum Flugloch eines Bienenstocks und dockt an. */
  public dock(target: TargetSource, label: string): void {
    this.clearCommand("dock", `Dock: ${label}`);
    this.target = target;
    this.dockRequested = false;
  }

  public stop(): void {
    this.clearCommand("idle", "Stopping");
    this.throttle = 0;
  }

  /** Handflug mit Pfeiltasten: Gieren und Neigen in rad/s-Anteilen −1..1. */
  public steer(yaw: number, pitch: number): void {
    if (yaw === 0 && pitch === 0) {
      this.manualYaw = 0;
      this.manualPitch = 0;
      return;
    }
    if (this.command !== "manual") {
      this.clearCommand("manual", "Manual flight");
      if (this.throttle < 0.2) {
        this.throttle = 0.5;
      }
    }
    this.manualYaw = yaw;
    this.manualPitch = pitch;
  }

  /** Der Server hat den Warp freigegeben. */
  public warpGranted(): void {
    if (this.warpPhase === "requesting") {
      this.warpPhase = "warping";
      this.warpGrantedAt = this.time;
    }
  }

  /** Der Server hat den Warp abgelehnt. */
  public warpRejected(reason: string): void {
    if (this.warpPhase !== undefined) {
      this.warpPhase = undefined;
      this.command = "idle";
      this.commandLabel = "Hovering";
      this.hooks.notice(`Warp denied: ${reason}`);
    }
  }

  /** Setzt die Biene auf die Lage des Servers (Einsetzpunkt, Kappung, Abdocken). */
  public teleport(x: number, y: number, z: number): void {
    this.position.set(x, y, z);
    this.velocity.setAll(0);
    if (this.warpPhase !== undefined) {
      this.warpPhase = undefined;
      this.command = "idle";
      this.commandLabel = "Warp interrupted";
    }
  }

  private clearCommand(kind: FlightCommandKind, label: string): void {
    this.command = kind;
    this.commandLabel = label;
    this.target = undefined;
    this.warpPhase = undefined;
    this.dockRequested = false;
    if (kind !== "idle" && kind !== "manual" && this.throttle < 0.05) {
      this.throttle = 1;
    }
  }

  // ---------- Simulation ----------

  public fixedUpdate(dt: number): void {
    this.time += dt;
    if (this.docked) {
      this.velocity.setAll(0);
      return;
    }
    this.previousHeading.copyFrom(this.heading);
    let desiredSpeed = this.throttle * this.maxSpeed;
    const target = this.target?.();
    if (target !== undefined) {
      this.lastTargetPosition.copyFrom(target.position);
    }
    switch (this.command) {
      case "idle":
        desiredSpeed = 0;
        this.desiredDirection.copyFrom(this.heading);
        break;
      case "direction":
        this.desiredDirection.copyFrom(this.commandDirection);
        break;
      case "manual":
        this.steerManual(dt);
        this.desiredDirection.copyFrom(this.heading);
        break;
      case "point":
        desiredSpeed = this.seek(this.commandPoint, 0.5, desiredSpeed);
        if (Vector3.Distance(this.commandPoint, this.position) < 1) {
          this.command = "idle";
          this.commandLabel = "Arrived";
        }
        break;
      case "approach":
        if (target === undefined) {
          this.command = "idle";
          this.commandLabel = "Target lost";
          desiredSpeed = 0;
          break;
        }
        desiredSpeed = this.seek(target.position, target.radius + 0.8, desiredSpeed);
        break;
      case "orbit":
        if (target === undefined) {
          // Beim Orbit fliegt die Biene in der letzten Richtung weiter (EVE)
          this.command = "direction";
          this.commandDirection.copyFrom(this.heading);
          this.commandLabel = "Holding course";
          break;
        }
        this.orbitAround(target);
        break;
      case "keepRange":
        if (target === undefined) {
          // Beim Abstand halten bleibt die Biene stehen (EVE)
          this.command = "idle";
          this.commandLabel = "Target lost";
          desiredSpeed = 0;
          break;
        }
        desiredSpeed = this.keepAt(target, desiredSpeed);
        break;
      case "align":
        if (target === undefined) {
          this.command = "direction";
          this.commandDirection.copyFrom(this.heading);
          break;
        }
        target.position.subtractToRef(this.position, this.desiredDirection).normalize();
        break;
      case "warp":
        desiredSpeed = this.updateWarp(target);
        break;
      case "dock":
        if (target === undefined) {
          this.command = "idle";
          desiredSpeed = 0;
          break;
        }
        desiredSpeed = this.seek(target.position, 2, Math.max(desiredSpeed, this.maxSpeed * 0.8));
        if (!this.dockRequested && Vector3.Distance(target.position, this.position) < target.radius + 40) {
          this.dockRequested = true;
          this.hooks.requestDock();
        }
        break;
    }
    this.integrate(dt, desiredSpeed);
  }

  /** Richtung zum Punkt, Tempo abgebremst vor der Ankunft (Ansteuern). */
  private seek(point: Vector3, stopDistance: number, cruise: number): number {
    point.subtractToRef(this.position, this.desiredDirection);
    const distance = this.desiredDirection.length();
    if (distance > 1e-4) {
      this.desiredDirection.scaleInPlace(1 / distance);
    } else {
      this.desiredDirection.copyFrom(this.heading);
    }
    const remaining = Math.max(0, distance - stopDistance);
    // Exponentielles Abbremsen legt aus Tempo v noch v·τ zurück: Solltempo proportional zur Restdistanz
    const brake = Math.max(ArrivalSpeed, remaining / this.brakeSeconds);
    return Math.min(cruise, brake);
  }

  private orbitAround(target: CommandTarget): void {
    this.position.subtractToRef(target.position, this.scratch);
    const distance = Math.max(0.01, this.scratch.length());
    this.scratch.scaleInPlace(1 / distance);
    // Tangente in der Bahnebene, dazu radiale Korrektur zurück auf den Radius
    Vector3.CrossToRef(this.orbitNormal, this.scratch, this.scratch2);
    this.scratch2.normalize();
    const radial = Math.max(-1, Math.min(1, ((this.commandDistance - distance) / Math.max(4, this.commandDistance)) * 2 * OrbitCorrection));
    this.desiredDirection.copyFrom(this.scratch2).addInPlace(this.scratch.scaleInPlace(radial)).normalize();
  }

  private keepAt(target: CommandTarget, cruise: number): number {
    target.position.subtractToRef(this.position, this.desiredDirection);
    const distance = this.desiredDirection.length();
    if (distance < 1e-4) {
      return 0;
    }
    this.desiredDirection.scaleInPlace(1 / distance);
    const error = distance - this.commandDistance;
    if (Math.abs(error) < KeepRangeTolerance) {
      return 0;
    }
    if (error < 0) {
      this.desiredDirection.negateInPlace(); // zu nah: zurückweichen
    }
    return Math.min(cruise, Math.max(ArrivalSpeed, Math.abs(error) / this.brakeSeconds));
  }

  private updateWarp(target: CommandTarget | undefined): number {
    if (target === undefined && this.warpPhase !== "warping" && this.warpPhase !== "landing") {
      this.warpPhase = undefined;
      this.command = "idle";
      return 0;
    }
    // Nach der Freigabe zählt nur noch der beim Server angemeldete Zielpunkt (Warp-Korridor), nicht das bewegte Ziel
    const committed = this.warpPhase === "warping" || this.warpPhase === "landing";
    const destination = committed ? this.warpTarget : (target?.position ?? this.lastTargetPosition);
    const radius = target?.radius ?? 0;
    destination.subtractToRef(this.position, this.desiredDirection);
    const distance = this.desiredDirection.length();
    this.desiredDirection.scaleInPlace(1 / Math.max(distance, 1e-4));
    const landing = committed ? 0 : radius + WarpLandingDistance;
    switch (this.warpPhase) {
      case "aligning": {
        const aligned = Vector3.Dot(this.heading, this.desiredDirection) > AlignToleranceCos;
        if (aligned && this.speed > this.stats.maxSpeed * 0.75 * (this.ghost ? GhostSpeedFactor : 1)) {
          this.warpPhase = "requesting";
          this.warpTarget.copyFrom(destination).subtractInPlace(this.desiredDirection.scale(landing));
          this.hooks.requestWarp(this.warpTarget);
        }
        return this.maxSpeed;
      }
      case "requesting":
        return this.maxSpeed;
      case "warping": {
        const remaining = distance - landing;
        // Mit Warp-Tempo bis kurz vor das Ziel, dann exponentiell abbremsen
        if (remaining < 120) {
          this.warpPhase = "landing";
        }
        return WarpSpeed;
      }
      case "landing": {
        const remaining = Math.max(0, distance - landing);
        if (remaining < 2 || this.time - this.warpGrantedAt > 30) {
          this.warpPhase = undefined;
          this.command = "idle";
          this.commandLabel = "Warp complete";
          this.throttle = 0;
          return 0;
        }
        return Math.max(4, Math.min(WarpSpeed, remaining * 2.2));
      }
      default:
        return 0;
    }
  }

  /** Zeitkonstante beim Langsamerwerden (Sekunden). */
  private get brakeSeconds(): number {
    return this.stats.inertiaSeconds * BrakeInertiaShare;
  }

  private steerManual(dt: number): void {
    const turn = this.stats.agility * dt;
    if (this.manualYaw !== 0) {
      const angle = this.manualYaw * turn;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const x = this.heading.x * cos + this.heading.z * sin;
      const z = -this.heading.x * sin + this.heading.z * cos;
      this.heading.x = x;
      this.heading.z = z;
    }
    if (this.manualPitch !== 0) {
      const pitch = Math.asin(Math.max(-1, Math.min(1, this.heading.y)));
      const next = Math.max(-1.35, Math.min(1.35, pitch + this.manualPitch * turn));
      const horizontal = Math.max(1e-4, Math.hypot(this.heading.x, this.heading.z));
      const cos = Math.cos(next);
      this.heading.set((this.heading.x / horizontal) * cos, Math.sin(next), (this.heading.z / horizontal) * cos);
    }
    this.heading.normalize();
  }

  private integrate(dt: number, desiredSpeed: number): void {
    const warping = this.warpPhase === "warping" || this.warpPhase === "landing";
    // Drehen mit begrenzter Wendigkeit; im Warp richtet sich die Biene sofort aus
    if (this.command !== "manual") {
      if (this.desiredDirection.lengthSquared() > 0.5) {
        const maxTurn = (warping ? 8 : this.stats.agility) * dt;
        rotateTowards(this.heading, this.desiredDirection, maxTurn, TurnBlend * dt);
      }
    }
    const current = this.velocity.length();
    let nextSpeed: number;
    if (warping) {
      const acceleration = WarpSpeed * 0.9;
      nextSpeed = current < desiredSpeed ? Math.min(desiredSpeed, current + acceleration * dt) : Math.max(desiredSpeed, current - acceleration * 1.6 * dt);
    } else {
      // Trägheit nach EVE: exponentielle Annäherung an das Solltempo, beim Bremsen mit kürzerer Zeitkonstante
      if (current < desiredSpeed) {
        nextSpeed = desiredSpeed + (current - desiredSpeed) * Math.exp(-dt / this.stats.inertiaSeconds);
      } else {
        nextSpeed = Math.max(desiredSpeed, desiredSpeed + (current - desiredSpeed) * Math.exp(-dt / this.brakeSeconds) - BrakeFriction * dt);
      }
    }
    this.heading.scaleToRef(nextSpeed, this.velocity);

    // Grenze: Böen drücken die Biene vor dem Kugelrand zurück
    const pressure = boundaryPressure(this.position.x, this.position.y, this.position.z);
    if (pressure > 0 && !warping) {
      const push = pressure * pressure * 22;
      const length = this.position.length();
      this.velocity.x -= (this.position.x / length) * push * dt * 8;
      this.velocity.y -= (this.position.y / length) * push * dt * 8;
      this.velocity.z -= (this.position.z / length) * push * dt * 8;
    }
    this.position.addInPlace(this.velocity.scale(dt));
    if (boundaryOverflow(this.position.x, this.position.y, this.position.z) > 0) {
      const clamped = clampToWorld(this.position.x, this.position.y, this.position.z);
      this.position.set(clamped.x, clamped.y, clamped.z);
    }
    if (!warping) {
      this.collideWithIslands();
    }
    // Schräglage aus der Drehung um die Hochachse
    const yawRate = signedYawDelta(this.previousHeading, this.heading) / Math.max(dt, 1e-4);
    const targetBank = Math.max(-0.7, Math.min(0.7, -yawRate * 0.35));
    this.bank += (targetBank - this.bank) * Math.min(1, dt * 5);
  }

  /** Schiebt die Biene aus Inselkörpern heraus und lässt sie an der Oberfläche entlanggleiten (Inselkollision). */
  private collideWithIslands(): void {
    const hit = this.world.penetration(this.position.x, this.position.y, this.position.z, CollisionClearance);
    if (hit === undefined) {
      return;
    }
    this.position.y = hit.top + CollisionClearance;
    if (this.velocity.y < 0) {
      this.velocity.y = 0;
    }
  }

  /** Abstand zur Grenze (für Warnungen). */
  public get boundaryDistance(): number {
    return -boundaryOverflow(this.position.x, this.position.y, this.position.z);
  }

  /** Nähe zur Grenze 0..1 (für Böen-Effekte). */
  public get boundaryPressure(): number {
    return boundaryPressure(this.position.x, this.position.y, this.position.z);
  }
}

/** Dreht einen Einheitsvektor um höchstens `maxAngle` zum Ziel (sphärisch), sanft abgedämpft. */
function rotateTowards(current: Vector3, target: Vector3, maxAngle: number, blend: number): void {
  const dot = Math.max(-1, Math.min(1, Vector3.Dot(current, target)));
  const angle = Math.acos(dot);
  if (angle < 1e-5) {
    current.copyFrom(target);
    return;
  }
  const step = Math.min(angle, Math.max(maxAngle * Math.min(1, angle * 4), angle * Math.min(1, blend * 0.2)), maxAngle);
  if (Math.PI - angle < 1e-3) {
    // Ziel genau hinter der Biene: Die Drehebene ist unbestimmt, die Biene wendet seitlich (um die Hochachse).
    const axis = Math.abs(current.y) < 0.99 ? Vector3.UpReadOnly : Vector3.RightReadOnly;
    const side = Vector3.Cross(axis, current).normalize();
    current.scaleInPlace(Math.cos(step)).addInPlace(side.scaleInPlace(Math.sin(step))).normalize();
    return;
  }
  const t = step / angle;
  // Slerp zwischen current und target
  const sinAngle = Math.sin(angle);
  const a = Math.sin((1 - t) * angle) / sinAngle;
  const b = Math.sin(t * angle) / sinAngle;
  current.set(current.x * a + target.x * b, current.y * a + target.y * b, current.z * a + target.z * b).normalize();
}

/** Vorzeichenbehaftete Gieränderung zwischen zwei Richtungen (rad). */
function signedYawDelta(from: Vector3, to: Vector3): number {
  const a = Math.atan2(from.x, from.z);
  const b = Math.atan2(to.x, to.z);
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

