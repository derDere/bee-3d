// Sammelstrom: Pollenpartikel steigen vom Blumenfeld auf und fließen in einer weichen Kurve zur Biene;
// Goldpollen leuchten golden und funkeln. Das Kurvenende folgt der Biene.
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { EffectContext } from "../core/effectContext";
import { Palette } from "../core/effectPalette";
import { ParticleLayer, type ParticleSpec } from "../core/particlePool";
import { createPool, firstInactive } from "../core/pooling";
import { TrackedPosition } from "../core/trackedPosition";
import type { PositionSource } from "../effectTypes";
import { BillboardShape, shapeCode } from "../render/billboardBatch";

const MaxStreams = 16;
const MotesPerStream = 72;
const FieldRadius = 0.7;
const TailLag = 0.06;

// Pollenkorn: Startpunkt, Fortschritt, Tempo (1/Flugzeit), Bogenhöhe, Seitenversatz, Zufallswert, lebendig
const SX = 0;
const SY = 1;
const SZ = 2;
const Progress = 3;
const Speed = 4;
const Lift = 5;
const Side = 6;
const Seed = 7;
const Alive = 8;
const Stride = 9;

const GlowCode = shapeCode(BillboardShape.Glow);

const AbsorbSpark: ParticleSpec = {
  layer: ParticleLayer.Glow,
  shape: BillboardShape.Glow,
  param: 2.5,
  lifeMin: 0.1,
  lifeMax: 0.14,
  radiusMin: 0.014,
  radiusMax: 0.018,
  radiusEnd: 0.3,
  color: Palette.pollenMote,
  colorEnd: Palette.transparent,
  drag: 0,
  gravity: 0,
  stretch: 0,
  minPixels: 2,
  fadeIn: 0,
};

const GoldAbsorbSpark: ParticleSpec = { ...AbsorbSpark, color: Palette.goldMote };

/** Ein laufender Sammelstrom (Sammelstrom). */
class CollectStream {
  public active = false;
  private golden = false;
  private duration = 1;
  private age = 0;
  private spawnCredit = 0;
  private spawning = true;
  private readonly field = new Vector3();
  private readonly target = new TrackedPosition();
  private readonly motes = new Float32Array(MotesPerStream * Stride);
  private readonly start = new Vector3();
  private readonly control = new Vector3();
  private readonly head = new Vector3();
  private readonly tail = new Vector3();
  private readonly side = new Vector3();

  public begin(from: Vector3, to: PositionSource, duration: number, golden: boolean): void {
    this.active = this.target.bind(to);
    this.field.copyFrom(from);
    this.duration = duration;
    this.golden = golden;
    this.age = 0;
    this.spawnCredit = 1;
    this.spawning = true;
    this.motes.fill(0);
  }

  public update(dt: number, context: EffectContext): void {
    this.age += dt;
    if (!this.target.update() || this.age >= this.duration) {
      this.spawning = false;
    }
    if (this.spawning) {
      this.spawn(dt, context);
    }
    let alive = 0;
    const m = this.motes;
    const target = this.target.position;
    const color = this.golden ? Palette.goldMote : Palette.pollenMote;
    for (let i = 0; i < MotesPerStream; i++) {
      const o = i * Stride;
      if (m[o + Alive] === 0) {
        continue;
      }
      const progress = m[o + Progress] + dt * m[o + Speed];
      if (progress >= 1) {
        m[o + Alive] = 0;
        context.emitter.single(this.golden ? GoldAbsorbSpark : AbsorbSpark, target, 0, 0, 0);
        continue;
      }
      alive++;
      m[o + Progress] = progress;
      this.curvePoint(o, target, progress, this.head);
      this.curvePoint(o, target, Math.max(0, progress - TailLag), this.tail);
      const seed = m[o + Seed];
      const fade = Math.min(1, progress / 0.1) * Math.min(1, (1 - progress) / 0.12);
      const twinkle = this.golden ? 0.7 + 0.5 * Math.sin(this.age * 25 + seed * 40) : 1;
      context.glow.segment(this.tail, 0.002, this.head, 0.004, color, fade * twinkle, GlowCode, 3, 0.15, 1.5);
      if (this.golden && seed > 0.75) {
        context.glow.dot(this.head, 0.009, color, fade * twinkle * 0.8, shapeCode(BillboardShape.Star, seed), 0.8, 1.8);
      }
    }
    if (!this.spawning && alive === 0) {
      this.deactivate();
    }
  }

  /** Punkt auf der Kurve eines Pollenkorns: vom Startpunkt über einen angehobenen Mittelpunkt zur Biene. */
  private curvePoint(o: number, target: Vector3, progress: number, result: Vector3): void {
    const m = this.motes;
    this.start.set(m[o + SX], m[o + SY], m[o + SZ]);
    const dx = target.x - this.start.x;
    const dz = target.z - this.start.z;
    const distance = Math.sqrt(dx * dx + (target.y - this.start.y) * (target.y - this.start.y) + dz * dz);
    // Seitlicher Versatz quer zur Strecke in der Waagrechten
    const flat = Math.sqrt(dx * dx + dz * dz);
    if (flat > 1e-4) {
      this.side.set(-dz / flat, 0, dx / flat);
    } else {
      this.side.set(1, 0, 0);
    }
    const lift = m[o + Lift] * distance + 0.25;
    const sideways = m[o + Side] * distance;
    this.control.set(
      (this.start.x + target.x) * 0.5 + this.side.x * sideways,
      (this.start.y + target.y) * 0.5 + lift,
      (this.start.z + target.z) * 0.5 + this.side.z * sideways,
    );
    // Weiches Anfahren und Ankommen
    const s = progress * progress * (3 - 2 * progress);
    const inverse = 1 - s;
    const wa = inverse * inverse;
    const wc = 2 * inverse * s;
    const wb = s * s;
    result.set(
      this.start.x * wa + this.control.x * wc + target.x * wb,
      this.start.y * wa + this.control.y * wc + target.y * wb,
      this.start.z * wa + this.control.z * wc + target.z * wb,
    );
  }

  private spawn(dt: number, context: EffectContext): void {
    const random = context.random;
    this.spawnCredit += dt * (this.golden ? 42 : 34);
    const m = this.motes;
    for (let i = 0; i < MotesPerStream && this.spawnCredit >= 1; i++) {
      const o = i * Stride;
      if (m[o + Alive] !== 0) {
        continue;
      }
      this.spawnCredit -= 1;
      const angle = random.next() * Math.PI * 2;
      const radius = Math.sqrt(random.next()) * FieldRadius;
      m[o + SX] = this.field.x + Math.cos(angle) * radius;
      m[o + SY] = this.field.y + random.range(0.02, 0.25);
      m[o + SZ] = this.field.z + Math.sin(angle) * radius;
      m[o + Progress] = 0;
      m[o + Speed] = 1 / random.range(0.9, 1.25);
      m[o + Lift] = random.range(0.12, 0.3);
      m[o + Side] = random.signed() * 0.12;
      m[o + Seed] = random.next();
      m[o + Alive] = 1;
    }
    this.spawnCredit = Math.min(this.spawnCredit, 2);
  }

  public deactivate(): void {
    this.active = false;
    this.target.release();
  }
}

/** Alle Sammelströme (Sammelstrom). */
export class CollectStreams {
  private readonly context: EffectContext;
  private readonly streams: CollectStream[];

  public constructor(context: EffectContext) {
    this.context = context;
    this.streams = createPool(MaxStreams, () => new CollectStream());
  }

  public start(from: Vector3, to: PositionSource, durationSeconds: number, golden: boolean): void {
    firstInactive(this.streams)?.begin(from, to, Math.max(0.2, durationSeconds), golden);
  }

  public update(dt: number): void {
    for (const stream of this.streams) {
      if (stream.active) {
        stream.update(dt, this.context);
      }
    }
  }

  public clear(): void {
    for (const stream of this.streams) {
      stream.deactivate();
    }
  }

  public dispose(): void {
    this.clear();
    this.streams.length = 0;
  }
}
