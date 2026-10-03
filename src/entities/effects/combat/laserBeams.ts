// Laseraugen: leuchtend rote HDR-Strahlen mit hellem Kern, weichem roten Saum und 10-Hz-Flackern wie im
// 2D-Vorbild (laser-flicker). Treffer zeigen Glut und Funken am Ziel, Fehlschüsse streichen knapp vorbei.
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { EffectContext } from "../core/effectContext";
import { clamp01, perpendicularBasis } from "../core/effectMath";
import { Palette } from "../core/effectPalette";
import { createPool } from "../core/pooling";
import { TrackedPosition } from "../core/trackedPosition";
import type { PositionSource } from "../effectTypes";
import { BillboardShape, shapeCode } from "../render/billboardBatch";
import type { ImpactEffects } from "./impactEffects";

const MaxBeams = 48;
/** Saum- und Kernradius am Auge bzw. am Ende (m): sichtbare Breite ~1,5 cm am Auge, leicht aufgefächert. */
const HaloRadiusEye = 0.012;
const HaloRadiusEnd = 0.02;
const CoreRadiusEye = 0.004;
const CoreRadiusEnd = 0.006;
const Attack = 0.05;
const Release = 0.12;
const FlickerHz = 10;
const FlickerDepth = 0.45;
const SparksPerSecond = 45;
/** Reichweite des freien Lasers (optimal + Falloff) und Beginn des Ausblendens. */
const FreeLength = 90;
const FreeFadeStart = 50;
/** Tiefenvorzug des Augenglühens und des Trefferglühens (m). */
const EyePull = 0.03;
const HitPull = 0.5;

const HaloCode = shapeCode(BillboardShape.Glow);
const HaloJointCode = shapeCode(BillboardShape.Glow, 0, false, true);

/** Ein laufender Laserstrahl (Laserstrahl). */
class LaserBeam {
  public active = false;
  public age = 0;
  private free = false;
  private hit = false;
  private endAt = 0;
  private phase = 0;
  private missAngle = 0;
  private missDistance = 0;
  private sparkCredit = 0;
  private impactShown = false;
  private readonly from = new TrackedPosition();
  private readonly to = new TrackedPosition();
  private direction: (() => Vector3 | undefined) | undefined;
  private isActive: (() => boolean) | undefined;
  private readonly start = new Vector3();
  private readonly end = new Vector3();
  private readonly pass = new Vector3();
  private readonly beamDirection = new Vector3();
  private readonly u = new Vector3();
  private readonly v = new Vector3();

  public startTargeted(from: PositionSource, to: PositionSource, duration: number, hit: boolean, phase: number, missAngle: number): void {
    this.reset(phase, missAngle);
    this.free = false;
    this.hit = hit;
    this.endAt = Math.max(0.08, duration);
    this.active = this.from.bind(from) && this.to.bind(to);
  }

  public startFree(from: PositionSource, direction: () => Vector3 | undefined, active: () => boolean, phase: number): void {
    this.reset(phase, 0);
    this.free = true;
    this.hit = false;
    this.endAt = Number.POSITIVE_INFINITY;
    this.direction = direction;
    this.isActive = active;
    this.active = this.from.bind(from);
  }

  private reset(phase: number, missAngle: number): void {
    this.age = 0;
    this.phase = phase;
    this.missAngle = missAngle;
    this.sparkCredit = 0;
    this.impactShown = false;
    this.direction = undefined;
    this.isActive = undefined;
  }

  /** Beendet den Strahl nach einer kurzen Ausblendzeit. */
  private release(seconds: number): void {
    this.endAt = Math.min(this.endAt, this.age + seconds);
  }

  public update(dt: number, context: EffectContext, impacts: ImpactEffects): void {
    this.age += dt;
    if (!this.from.update()) {
      this.release(0.06);
    }
    if (!this.updateGeometry()) {
      this.release(0.1);
    }
    const remaining = this.endAt - this.age;
    if (remaining <= 0) {
      this.deactivate();
      return;
    }
    const envelope = clamp01(this.age / Attack) * clamp01(remaining / Release);
    // Dreieckswelle wie die CSS-Animation 3 px → 5 px → 3 px, dazu leichtes Helligkeitszittern
    const wave = (this.age * FlickerHz + this.phase) % 1;
    const flicker = 1 + FlickerDepth * (1 - Math.abs(wave * 2 - 1));
    const intensity = envelope * (0.9 + 0.1 * Math.sin((this.age * 23 + this.phase * 7) * Math.PI * 2));
    this.draw(context, flicker, intensity);
    if (this.hit && envelope > 0.5) {
      this.emitHitSparks(dt, impacts, envelope);
    }
  }

  /** Berechnet Start, Ende und Vorbeiflugpunkt; false, wenn Ziel oder Richtung fehlen. */
  private updateGeometry(): boolean {
    this.start.copyFrom(this.from.position);
    if (this.free) {
      const direction = this.direction?.();
      if (direction === undefined || !(this.isActive?.() ?? false) || direction.lengthSquared() < 1e-8) {
        return false;
      }
      this.beamDirection.copyFrom(direction).normalize();
      this.start.addToRef(this.beamDirection.scaleToRef(FreeLength, this.end), this.end);
      this.start.addToRef(this.beamDirection.scaleToRef(FreeFadeStart, this.pass), this.pass);
      return true;
    }
    const targetKnown = this.to.update();
    const target = this.to.position;
    target.subtractToRef(this.start, this.beamDirection);
    const distance = this.beamDirection.length();
    if (distance < 1e-4) {
      this.end.copyFrom(target);
      this.pass.copyFrom(target);
      return targetKnown;
    }
    this.beamDirection.scaleInPlace(1 / distance);
    if (this.hit) {
      this.end.copyFrom(target);
      this.pass.copyFrom(target);
      return targetKnown;
    }
    // Fehlschuss: seitlich versetzt am Ziel vorbei, der Versatz pendelt langsam um die Strahlachse
    perpendicularBasis(this.beamDirection, this.u, this.v);
    const angle = this.missAngle + 0.5 * Math.sin(this.age * 1.9 + this.phase * 6);
    const offset = this.missDistance > 0 ? this.missDistance : Math.min(1.4, 0.35 + distance * 0.01);
    this.missDistance = offset;
    this.pass.copyFrom(target);
    this.pass.x += (this.u.x * Math.cos(angle) + this.v.x * Math.sin(angle)) * offset;
    this.pass.y += (this.u.y * Math.cos(angle) + this.v.y * Math.sin(angle)) * offset;
    this.pass.z += (this.u.z * Math.cos(angle) + this.v.z * Math.sin(angle)) * offset;
    this.pass.subtractToRef(this.start, this.beamDirection);
    const passDistance = this.beamDirection.length();
    this.beamDirection.scaleInPlace(1 / Math.max(passDistance, 1e-4));
    const overshoot = Math.max(25, passDistance * 0.8);
    this.beamDirection.scaleToRef(passDistance + overshoot, this.end).addInPlace(this.start);
    return targetKnown;
  }

  private draw(context: EffectContext, flicker: number, intensity: number): void {
    const glow = context.glow;
    const passIsEnd = this.hit && !this.free;
    if (passIsEnd) {
      glow.segment(this.start, HaloRadiusEye * flicker, this.end, HaloRadiusEnd * flicker, Palette.laserHalo, intensity, HaloCode, 2.2, 1, 3.2);
      glow.segment(this.start, CoreRadiusEye * flicker, this.end, CoreRadiusEnd * flicker, Palette.laserCore, intensity, HaloCode, 5, 1, 1.1);
    } else {
      // Zwei Stücke mit Naht am Vorbeiflugpunkt: voll bis dorthin, danach zum Ende hin ausblendend
      const total = Vector3.Distance(this.start, this.end);
      const fraction = total > 1e-4 ? Vector3.Distance(this.start, this.pass) / total : 1;
      const haloPass = (HaloRadiusEye + (HaloRadiusEnd - HaloRadiusEye) * fraction) * flicker;
      const corePass = (CoreRadiusEye + (CoreRadiusEnd - CoreRadiusEye) * fraction) * flicker;
      glow.segment(this.start, HaloRadiusEye * flicker, this.pass, haloPass, Palette.laserHalo, intensity, HaloJointCode, 2.2, 1, 3.2);
      glow.segment(this.end, HaloRadiusEnd * flicker, this.pass, haloPass, Palette.laserHalo, intensity, HaloJointCode, 2.2, 0, 3.2);
      glow.segment(this.start, CoreRadiusEye * flicker, this.pass, corePass, Palette.laserCore, intensity, HaloJointCode, 5, 1, 1.1);
      glow.segment(this.end, CoreRadiusEnd * flicker, this.pass, corePass, Palette.laserCore, intensity, HaloJointCode, 5, 0, 1.1);
    }
    glow.dot(this.start, 0.016 * flicker, Palette.laserEye, intensity, HaloCode, 2.5, 2.2, EyePull);
    if (passIsEnd) {
      // Das Strahlende liegt im Ziel: Glühen rückt vor dessen Oberfläche
      const pulse = 0.85 + 0.3 * Math.sin(this.age * 31 + this.phase * 5);
      glow.dot(this.end, 0.09 * pulse, Palette.laserHitGlow, intensity, HaloCode, 2.2, 5, HitPull);
      glow.dot(this.end, 0.03 * flicker, Palette.laserHitCore, intensity, HaloCode, 4, 2, HitPull);
    }
  }

  private emitHitSparks(dt: number, impacts: ImpactEffects, envelope: number): void {
    if (!this.impactShown) {
      this.impactShown = true;
      impacts.laserHit(this.end, 0.6, this.beamDirection);
    }
    this.sparkCredit += dt * SparksPerSecond * envelope;
    const count = Math.floor(this.sparkCredit);
    if (count > 0) {
      this.sparkCredit -= count;
      impacts.laserSparks(this.end, count, this.beamDirection);
    }
  }

  public deactivate(): void {
    this.active = false;
    this.missDistance = 0;
    this.from.release();
    this.to.release();
    this.direction = undefined;
    this.isActive = undefined;
  }
}

/** Alle Laserstrahlen (Laseraugen). */
export class LaserBeams {
  private readonly context: EffectContext;
  private readonly impacts: ImpactEffects;
  private readonly beams: LaserBeam[];

  public constructor(context: EffectContext, impacts: ImpactEffects) {
    this.context = context;
    this.impacts = impacts;
    this.beams = createPool(MaxBeams, () => new LaserBeam());
  }

  /** Strahl auf ein Ziel: Treffer endet am Ziel, Fehlschuss streicht knapp vorbei. */
  public fire(from: PositionSource, to: PositionSource, durationSeconds: number, hit: boolean): void {
    const random = this.context.random;
    this.acquire().startTargeted(from, to, durationSeconds, hit, random.next(), random.next() * Math.PI * 2);
  }

  /** Strahl ins Leere entlang einer Richtung, solange `active()` wahr ist. */
  public fireFree(from: PositionSource, direction: () => Vector3 | undefined, active: () => boolean): void {
    this.acquire().startFree(from, direction, active, this.context.random.next());
  }

  public update(dt: number): void {
    for (const beam of this.beams) {
      if (beam.active) {
        beam.update(dt, this.context, this.impacts);
      }
    }
  }

  /** Anzahl laufender Strahlen. */
  public get activeCount(): number {
    let count = 0;
    for (const beam of this.beams) {
      if (beam.active) {
        count++;
      }
    }
    return count;
  }

  /** Freier Platz oder der älteste Strahl. */
  private acquire(): LaserBeam {
    let oldest = this.beams[0];
    for (const beam of this.beams) {
      if (!beam.active) {
        return beam;
      }
      if (beam.age > oldest.age) {
        oldest = beam;
      }
    }
    oldest.deactivate();
    return oldest;
  }

  public clear(): void {
    for (const beam of this.beams) {
      beam.deactivate();
    }
  }

  public dispose(): void {
    this.clear();
    this.beams.length = 0;
  }
}
