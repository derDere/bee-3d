// Stachelraketen: kleine dunkle Stachel (~6 cm, eigenes Mesh) mit glühendem Heck und weißer Rauchspur.
// Sie fächern beim Start auf, folgen der Zielposition auf einer Bézier-Kurve und schlagen nach der
// Flugzeit mit einer Pollen-Explosion ein.
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { EffectContext } from "../core/effectContext";
import { clamp01, perpendicularBasis, quadraticBezierToRef } from "../core/effectMath";
import { Palette } from "../core/effectPalette";
import { createPool, firstInactive } from "../core/pooling";
import { TrackedPosition } from "../core/trackedPosition";
import type { PositionSource } from "../effectTypes";
import { BillboardShape, shapeCode } from "../render/billboardBatch";
import { createStingerMesh } from "../render/effectMeshes";
import { MeshBatch } from "../render/meshBatch";
import type { ImpactEffects } from "./impactEffects";
import type { SmokeTrail, SmokeTrails } from "./smokeTrails";

const MaxMissiles = 64;
const MaxVolley = 12;
const LaunchStagger = 0.09;
const SpinRate = 14;
const TailOffset = 0.03;

const GlowCode = shapeCode(BillboardShape.Glow);

/** Eine Stachelrakete (Stachelrakete). */
class StingerMissile {
  public active = false;
  private launched = false;
  private delay = 0;
  private age = 0;
  private flight = 1;
  private fanAngle = 0;
  private spin = 0;
  private readonly from = new TrackedPosition();
  private readonly target = new TrackedPosition();
  private readonly launchPoint = new Vector3();
  private readonly control = new Vector3();
  private readonly position = new Vector3();
  private readonly previous = new Vector3();
  private readonly forward = new Vector3(0, 0, 1);
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly tail = new Vector3();
  private readonly exhaust = new Vector3();
  private trail: SmokeTrail | undefined;

  public prepare(from: PositionSource, to: PositionSource, delay: number, flight: number, fanAngle: number): void {
    this.active = this.from.bind(from) && this.target.bind(to);
    this.launched = false;
    this.delay = delay;
    this.age = 0;
    this.flight = Math.max(0.25, flight);
    this.fanAngle = fanAngle;
    this.spin = fanAngle;
    this.trail = undefined;
  }

  public update(dt: number, context: EffectContext, trails: SmokeTrails, impacts: ImpactEffects, batch: MeshBatch): void {
    if (!this.launched) {
      this.from.update();
      this.target.update();
      this.delay -= dt;
      if (this.delay > 0) {
        return;
      }
      this.launch(trails);
    }
    this.age += dt;
    this.target.update();
    const s = clamp01(this.age / this.flight);
    // Beschleunigend: Anfangstempo 35 %, am Ende 165 % des Mittels
    const progress = 0.35 * s + 0.65 * s * s;
    this.previous.copyFrom(this.position);
    quadraticBezierToRef(this.launchPoint, this.control, this.target.position, progress, this.position);
    this.position.subtractToRef(this.previous, this.tail);
    if (this.tail.lengthSquared() > 1e-10) {
      this.forward.copyFrom(this.tail).normalize();
    }
    if (s >= 1) {
      impacts.stingerExplosion(this.target.position, 1);
      this.trail?.detach();
      this.deactivate();
      return;
    }
    this.spin += SpinRate * dt;
    this.draw(context, batch, dt);
  }

  private launch(trails: SmokeTrails): void {
    this.launched = true;
    this.launchPoint.copyFrom(this.from.position);
    this.position.copyFrom(this.launchPoint);
    this.previous.copyFrom(this.launchPoint);
    // Startrichtung: zum Ziel, aufgefächert um die Zielachse und leicht angehoben
    this.target.position.subtractToRef(this.launchPoint, this.forward);
    const distance = this.forward.length();
    if (distance < 1e-4) {
      this.forward.set(0, 0, 1);
    } else {
      this.forward.scaleInPlace(1 / distance);
    }
    perpendicularBasis(this.forward, this.right, this.up);
    const c = Math.cos(this.fanAngle);
    const sn = Math.sin(this.fanAngle);
    this.control.set(
      this.forward.x * 0.55 + (this.right.x * c + this.up.x * sn) * 0.8,
      this.forward.y * 0.55 + (this.right.y * c + this.up.y * sn) * 0.8 + 0.25,
      this.forward.z * 0.55 + (this.right.z * c + this.up.z * sn) * 0.8,
    );
    this.control.normalize().scaleInPlace(Math.min(30, Math.max(1.5, distance * 0.4))).addInPlace(this.launchPoint);
    this.trail = trails.start(this.launchPoint);
  }

  private draw(context: EffectContext, batch: MeshBatch, dt: number): void {
    perpendicularBasis(this.forward, this.right, this.up);
    const c = Math.cos(this.spin);
    const sn = Math.sin(this.spin);
    const rx = this.right.x * c + this.up.x * sn;
    const ry = this.right.y * c + this.up.y * sn;
    const rz = this.right.z * c + this.up.z * sn;
    const ux = this.up.x * c - this.right.x * sn;
    const uy = this.up.y * c - this.right.y * sn;
    const uz = this.up.z * c - this.right.z * sn;
    const f = this.forward;
    const p = this.position;
    batch.push(p.x, p.y, p.z, rx, ry, rz, ux, uy, uz, f.x, f.y, f.z);

    // Glühendes Heck mit kurzem Abgasstrich, dann Rauch
    this.position.subtractToRef(this.forward.scaleToRef(TailOffset, this.tail), this.tail);
    this.tail.subtractToRef(this.forward.scaleToRef(0.09, this.exhaust), this.exhaust);
    const flicker = 1 + 0.25 * Math.sin(this.age * 90 + this.fanAngle * 13);
    const glow = context.glow;
    glow.dot(this.tail, 0.011 * flicker, Palette.stingerFlame, 1, GlowCode, 3, 2.2);
    glow.segment(this.exhaust, 0.002, this.tail, 0.008, Palette.stingerFlame, 0.6, GlowCode, 3, 0, 1.2);
    this.trail?.feed(this.tail, dt, context.random);
  }

  public deactivate(): void {
    this.active = false;
    this.trail = undefined;
    this.from.release();
    this.target.release();
  }
}

/** Alle Stachelraketen samt Mesh-Stapel (Stachelraketen). */
export class StingerRockets {
  private readonly context: EffectContext;
  private readonly impacts: ImpactEffects;
  private readonly trails: SmokeTrails;
  private readonly batch: MeshBatch;
  private readonly missiles: StingerMissile[];

  public constructor(scene: Scene, context: EffectContext, impacts: ImpactEffects, trails: SmokeTrails, renderingGroupId: number) {
    this.context = context;
    this.impacts = impacts;
    this.trails = trails;
    const mesh = createStingerMesh(scene);
    mesh.renderingGroupId = renderingGroupId;
    this.batch = new MeshBatch(mesh, MaxMissiles);
    this.missiles = createPool(MaxMissiles, () => new StingerMissile());
  }

  /** Mesh-Stapel (für Kennzahlen). */
  public get meshBatch(): MeshBatch {
    return this.batch;
  }

  /** Startet eine Salve; alle Stachel schlagen innerhalb der Flugzeit ein. */
  public volley(from: PositionSource, to: PositionSource, count: number, flightSeconds: number): void {
    const total = Math.max(1, Math.min(MaxVolley, Math.round(count)));
    const flight = Math.max(0.3, flightSeconds);
    const random = this.context.random;
    const baseAngle = random.next() * Math.PI * 2;
    for (let i = 0; i < total; i++) {
      const missile = firstInactive(this.missiles);
      if (missile === undefined) {
        return;
      }
      const delay = Math.min(i * LaunchStagger, flight * 0.3);
      const angle = baseAngle + (i / total) * Math.PI * 2 + random.signed() * 0.3;
      missile.prepare(from, to, delay, flight - delay, angle);
    }
  }

  public update(dt: number): void {
    this.batch.begin();
    for (const missile of this.missiles) {
      if (missile.active) {
        missile.update(dt, this.context, this.trails, this.impacts, this.batch);
      }
    }
    this.batch.end();
  }

  public clear(): void {
    for (const missile of this.missiles) {
      missile.deactivate();
    }
  }

  public dispose(): void {
    this.clear();
    this.batch.dispose();
  }
}
