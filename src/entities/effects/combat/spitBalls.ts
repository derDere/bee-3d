// Spucke der Fliegen: giftgrüne, glänzende Schleimballen (~4 cm) mit grünem Schimmer und tropfender Spur,
// im Bogen zum Ziel; die Königin spuckt einen Fächer. Einschlag nach der Flugzeit mit platschigem Treffer.
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { EffectContext } from "../core/effectContext";
import { clamp01, perpendicularBasis, quadraticBezierToRef } from "../core/effectMath";
import { Palette } from "../core/effectPalette";
import { ParticleLayer, type ParticleSpec } from "../core/particlePool";
import { createPool, firstInactive } from "../core/pooling";
import { TrackedPosition } from "../core/trackedPosition";
import type { PositionSource } from "../effectTypes";
import { BillboardShape, shapeCode } from "../render/billboardBatch";
import type { ImpactEffects } from "./impactEffects";

const MaxBalls = 96;
const MaxVolley = 9;
const BallRadius = 0.02;
const FanStep = 0.22;
const DripsPerSecond = 40;

const BlobCode = shapeCode(BillboardShape.Blob);
const GlowCode = shapeCode(BillboardShape.Glow);

const SlimeDrip: ParticleSpec = {
  layer: ParticleLayer.Matter,
  shape: BillboardShape.Blob,
  param: 0.5,
  lifeMin: 0.45,
  lifeMax: 0.8,
  radiusMin: 0.004,
  radiusMax: 0.007,
  radiusEnd: 0.4,
  color: Palette.slimeDrip,
  colorEnd: Palette.slimeDripEnd,
  drag: 0.6,
  gravity: 9.8,
  stretch: 0,
  minPixels: 0.9,
  fadeIn: 0,
};

/** Ein fliegender Schleimballen (Spuckeballen). */
class SpitBall {
  public active = false;
  private age = 0;
  private flight = 1;
  private phase = 0;
  private dripCredit = 0;
  private readonly target = new TrackedPosition();
  private readonly launchPoint = new Vector3();
  private readonly control = new Vector3();
  private readonly position = new Vector3();
  private readonly previous = new Vector3();
  private readonly direction = new Vector3(0, 0, 1);
  private readonly velocity = new Vector3();
  private readonly back = new Vector3();
  private readonly front = new Vector3();

  public launch(origin: Vector3, to: PositionSource, flight: number, control: Vector3, phase: number): void {
    this.active = this.target.bind(to);
    this.age = 0;
    this.flight = Math.max(0.15, flight);
    this.phase = phase;
    this.dripCredit = 0;
    this.launchPoint.copyFrom(origin);
    this.position.copyFrom(origin);
    this.previous.copyFrom(origin);
    this.control.copyFrom(control);
  }

  public update(dt: number, context: EffectContext, impacts: ImpactEffects): void {
    this.age += dt;
    this.target.update();
    const s = clamp01(this.age / this.flight);
    this.previous.copyFrom(this.position);
    quadraticBezierToRef(this.launchPoint, this.control, this.target.position, s, this.position);
    this.position.subtractToRef(this.previous, this.velocity);
    if (this.velocity.lengthSquared() > 1e-10) {
      this.direction.copyFrom(this.velocity).normalize();
    }
    if (dt > 0) {
      this.velocity.scaleInPlace(1 / dt);
    }
    if (s >= 1) {
      impacts.spitSplat(this.position, 0.8, this.direction);
      this.deactivate();
      return;
    }
    this.draw(context);
    this.drip(dt, context);
  }

  private draw(context: EffectContext): void {
    // Länglicher, wabbelnder Ballen entlang der Flugrichtung, darum ein grüner Schimmer und ein kurzer Schleimstrich
    const wobble = 1 + 0.12 * Math.sin(this.age * 70 + this.phase * 20);
    const radius = BallRadius * wobble;
    this.position.subtractToRef(this.direction.scaleToRef(0.016 / wobble, this.back), this.back);
    this.position.addToRef(this.direction.scaleToRef(0.006, this.front), this.front);
    context.matter.segment(this.back, radius, this.front, radius, Palette.slimeBall, 1, BlobCode, 0.6, 1, 1.6);
    context.glow.dot(this.position, 0.07, Palette.slimeGlow, 1, GlowCode, 2.5, 5);
    this.position.subtractToRef(this.direction.scaleToRef(0.2, this.back), this.back);
    context.glow.segment(this.back, 0.004, this.position, 0.01, Palette.slimeStreak, 0.6, GlowCode, 2.5, 0, 1.2);
  }

  /** Tropfende Spur: kleine Schleimtropfen fallen aus dem Ballen. */
  private drip(dt: number, context: EffectContext): void {
    this.dripCredit += dt * DripsPerSecond;
    const random = context.random;
    while (this.dripCredit >= 1) {
      this.dripCredit -= 1;
      context.particles.emit(
        SlimeDrip,
        this.position.x + random.signed() * 0.01,
        this.position.y - 0.012,
        this.position.z + random.signed() * 0.01,
        this.velocity.x * 0.1 + random.signed() * 0.25,
        this.velocity.y * 0.1 - 0.3 + random.signed() * 0.1,
        this.velocity.z * 0.1 + random.signed() * 0.25,
      );
    }
  }

  public deactivate(): void {
    this.active = false;
    this.target.release();
  }
}

/** Alle Spuckeballen (Spucke). */
export class SpitBalls {
  private readonly context: EffectContext;
  private readonly impacts: ImpactEffects;
  private readonly balls: SpitBall[];
  private readonly origin = new Vector3();
  private readonly forward = new Vector3();
  private readonly side = new Vector3();
  private readonly lift = new Vector3();
  private readonly control = new Vector3();

  public constructor(context: EffectContext, impacts: ImpactEffects) {
    this.context = context;
    this.impacts = impacts;
    this.balls = createPool(MaxBalls, () => new SpitBall());
  }

  /** Spuckt `count` Ballen (ab 2 als Fächer), Einschlag nach `flightSeconds`. */
  public volley(from: PositionSource, to: PositionSource, count: number, flightSeconds: number): void {
    const origin = from();
    const target = to();
    if (origin === undefined || target === undefined) {
      return;
    }
    this.origin.copyFrom(origin);
    target.subtractToRef(this.origin, this.forward);
    const distance = this.forward.length();
    if (distance < 1e-4) {
      return;
    }
    this.forward.scaleInPlace(1 / distance);
    perpendicularBasis(this.forward, this.side, this.lift);
    const total = Math.max(1, Math.min(MaxVolley, Math.round(count)));
    const random = this.context.random;
    for (let i = 0; i < total; i++) {
      const ball = firstInactive(this.balls);
      if (ball === undefined) {
        return;
      }
      // Fächer quer zur Schussrichtung, sanfter Bogen nach oben; alle Bögen enden am Ziel
      const fan = (i - (total - 1) / 2) * FanStep;
      const reach = distance * 0.5;
      this.control.set(
        this.forward.x + this.side.x * fan * 1.6,
        this.forward.y + this.side.y * fan * 1.6,
        this.forward.z + this.side.z * fan * 1.6,
      );
      this.control.normalize().scaleInPlace(reach).addInPlace(this.origin);
      this.control.y += distance * 0.08 + random.range(0, 0.04) * distance;
      ball.launch(this.origin, to, flightSeconds * random.range(0.97, 1), this.control, random.next());
    }
  }

  public update(dt: number): void {
    for (const ball of this.balls) {
      if (ball.active) {
        ball.update(dt, this.context, this.impacts);
      }
    }
  }

  public clear(): void {
    for (const ball of this.balls) {
      ball.deactivate();
    }
  }

  public dispose(): void {
    this.clear();
    this.balls.length = 0;
  }
}
