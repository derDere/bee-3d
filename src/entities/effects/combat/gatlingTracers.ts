// Pollen-Gatling: schnelle gelb-goldene Leuchtkugeln (~1 cm) mit kurzer Spur, versetzt aus sechs
// Beinpositionen abgefeuert. Treffer folgen dem Ziel und zerplatzen in Pollen, Fehlschüsse fliegen vorbei.
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { EffectContext } from "../core/effectContext";
import { clamp01 } from "../core/effectMath";
import { Palette } from "../core/effectPalette";
import { ParticleLayer, type ParticleSpec } from "../core/particlePool";
import { createPool, firstInactive } from "../core/pooling";
import { TrackedPosition } from "../core/trackedPosition";
import type { PositionSource } from "../effectTypes";
import { BillboardShape, shapeCode } from "../render/billboardBatch";
import type { ImpactEffects } from "./impactEffects";

const MaxBursts = 48;
const MaxBullets = 320;
const BulletSpeed = 70;
const ShotInterval = 0.07;
const MaxShots = 24;
const TrailLength = 0.9;
/** Flugzeit nach dem Vorbeiflug, bevor ein Fehlschuss erlischt. */
const MissCarry = 0.3;
const MaxFlight = 2.5;

const GlowCode = shapeCode(BillboardShape.Glow);

const MuzzleFlash: ParticleSpec = {
  layer: ParticleLayer.Glow,
  shape: BillboardShape.Glow,
  param: 2.5,
  lifeMin: 0.05,
  lifeMax: 0.07,
  radiusMin: 0.016,
  radiusMax: 0.02,
  radiusEnd: 0.5,
  color: Palette.pollenMuzzle,
  colorEnd: Palette.transparent,
  drag: 0,
  gravity: 0,
  stretch: 0,
  minPixels: 2.2,
  fadeIn: 0,
};

/** Eine Leuchtkugel im Flug (Pollenkugel). */
class Bullet {
  public active = false;
  private hit = false;
  private passed = false;
  private age = 0;
  private carry = 0;
  private traveled = 0;
  private readonly target = new TrackedPosition();
  private readonly position = new Vector3();
  private readonly direction = new Vector3();
  private readonly missOffset = new Vector3();
  private readonly aim = new Vector3();
  private readonly tail = new Vector3();

  public launch(origin: Vector3, target: PositionSource, hit: boolean, missOffset: Vector3): void {
    this.active = this.target.bind(target);
    if (!this.active) {
      return;
    }
    this.hit = hit;
    this.passed = false;
    this.age = 0;
    this.carry = MissCarry;
    this.traveled = 0;
    this.position.copyFrom(origin);
    this.missOffset.copyFrom(missOffset);
    this.target.position.subtractToRef(origin, this.direction);
    if (this.direction.lengthSquared() < 1e-8) {
      this.direction.set(0, 0, 1);
    }
    this.direction.normalize();
  }

  public update(dt: number, context: EffectContext, impacts: ImpactEffects): void {
    this.age += dt;
    const step = BulletSpeed * dt;
    if (!this.passed) {
      const known = this.target.update();
      this.aim.copyFrom(this.target.position);
      if (!this.hit || !known) {
        this.aim.addInPlace(this.missOffset);
      }
      this.aim.subtractToRef(this.position, this.tail);
      const distance = this.tail.length();
      if (distance <= step) {
        this.position.copyFrom(this.aim);
        if (this.hit && known) {
          impacts.pollenHit(this.position, 0.5);
          this.deactivate();
          return;
        }
        this.passed = true;
      } else if (distance > 1e-5) {
        this.direction.copyFrom(this.tail).scaleInPlace(1 / distance);
      }
    }
    if (this.passed) {
      this.carry -= dt;
    }
    if (this.carry <= 0 || this.age > MaxFlight) {
      this.deactivate();
      return;
    }
    this.position.addInPlaceFromFloats(this.direction.x * step, this.direction.y * step, this.direction.z * step);
    this.traveled += step;
    const intensity = this.passed ? clamp01(this.carry / MissCarry) : 1;
    const trail = Math.min(TrailLength, this.traveled);
    this.position.subtractToRef(this.direction.scaleToRef(trail, this.tail), this.tail);
    context.glow.segment(this.tail, 0.002, this.position, 0.006, Palette.pollenTracer, intensity, GlowCode, 2.5, 0, 1.8);
    context.glow.dot(this.position, 0.003, Palette.pollenTracerCore, intensity, GlowCode, 4, 1.1);
  }

  public deactivate(): void {
    this.active = false;
    this.target.release();
  }
}

/** Eine laufende Salve: feuert ihre Schüsse versetzt aus den Beinen ab (Gatling-Salve). */
class GatlingBurst {
  public active = false;
  private origins: readonly PositionSource[] = [];
  private target: PositionSource | undefined;
  private shotsLeft = 0;
  private hitsLeft = 0;
  private shotIndex = 0;
  private nextShot = 0;

  public start(origins: readonly PositionSource[], to: PositionSource, shots: number, hits: number): void {
    this.origins = origins;
    this.target = to;
    this.shotsLeft = shots;
    this.hitsLeft = Math.min(hits, shots);
    this.shotIndex = 0;
    this.nextShot = 0;
    this.active = shots > 0 && origins.length > 0;
  }

  /** Rückt die Salve vor und meldet fällige Schüsse an `fire`. */
  public update(dt: number, fire: (origin: PositionSource, target: PositionSource, hit: boolean) => void, random: () => number): void {
    this.nextShot -= dt;
    while (this.active && this.nextShot <= 0) {
      const target = this.target;
      if (target === undefined) {
        this.stop();
        return;
      }
      const hit = random() < this.hitsLeft / this.shotsLeft;
      if (hit) {
        this.hitsLeft--;
      }
      fire(this.origins[this.shotIndex % this.origins.length], target, hit);
      this.shotIndex++;
      this.shotsLeft--;
      this.nextShot += ShotInterval;
      if (this.shotsLeft <= 0) {
        this.stop();
      }
    }
  }

  private stop(): void {
    this.active = false;
    this.origins = [];
    this.target = undefined;
  }
}

/** Alle Gatling-Salven und Leuchtkugeln (Pollen-Gatling). */
export class GatlingTracers {
  private readonly context: EffectContext;
  private readonly impacts: ImpactEffects;
  private readonly bursts: GatlingBurst[];
  private readonly bullets: Bullet[];
  private readonly origin = new Vector3();
  private readonly toTarget = new Vector3();
  private readonly offset = new Vector3();
  private readonly fireShot = (origin: PositionSource, target: PositionSource, hit: boolean): void => this.spawnBullet(origin, target, hit);
  private readonly nextRandom = (): number => this.context.random.next();

  public constructor(context: EffectContext, impacts: ImpactEffects) {
    this.context = context;
    this.impacts = impacts;
    this.bursts = createPool(MaxBursts, () => new GatlingBurst());
    this.bullets = createPool(MaxBullets, () => new Bullet());
  }

  /** Startet eine Salve aus `shots` Kugeln, davon `hits` Treffer. */
  public burst(origins: readonly PositionSource[], to: PositionSource, shots: number, hits: number): void {
    const burst = firstInactive(this.bursts);
    if (burst === undefined) {
      return;
    }
    const shotCount = Math.max(0, Math.min(MaxShots, Math.round(shots)));
    burst.start(origins, to, shotCount, Math.max(0, Math.round(hits)));
  }

  public update(dt: number): void {
    for (const burst of this.bursts) {
      if (burst.active) {
        burst.update(dt, this.fireShot, this.nextRandom);
      }
    }
    for (const bullet of this.bullets) {
      if (bullet.active) {
        bullet.update(dt, this.context, this.impacts);
      }
    }
  }

  private spawnBullet(originSource: PositionSource, target: PositionSource, hit: boolean): void {
    const origin = originSource();
    const aim = target();
    if (origin === undefined || aim === undefined) {
      return;
    }
    const bullet = firstInactive(this.bullets);
    if (bullet === undefined) {
      return;
    }
    this.origin.copyFrom(origin);
    this.computeMissOffset(aim, hit);
    bullet.launch(this.origin, target, hit, this.offset);
    this.context.emitter.single(MuzzleFlash, this.origin, 0, 0, 0);
  }

  /** Seitlicher Versatz eines Fehlschusses: 0,3–0,8 m quer zur Schussrichtung. */
  private computeMissOffset(aim: Vector3, hit: boolean): void {
    if (hit) {
      this.offset.setAll(0);
      return;
    }
    const random = this.context.random;
    aim.subtractToRef(this.origin, this.toTarget);
    random.unitVector(this.offset);
    const length = this.toTarget.length();
    if (length > 1e-5) {
      // Anteil entlang der Schussrichtung entfernen, damit der Versatz quer liegt
      const along = Vector3.Dot(this.offset, this.toTarget) / (length * length);
      this.offset.subtractInPlace(this.toTarget.scaleInPlace(along));
    }
    if (this.offset.lengthSquared() < 1e-8) {
      this.offset.set(0, 1, 0);
    }
    this.offset.normalize().scaleInPlace(random.range(0.3, 0.8));
  }

  public clear(): void {
    for (const bullet of this.bullets) {
      bullet.deactivate();
    }
    for (const burst of this.bursts) {
      burst.active = false;
    }
  }

  public dispose(): void {
    this.clear();
    this.bullets.length = 0;
    this.bursts.length = 0;
  }
}
