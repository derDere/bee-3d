// Heilung: grünlich-goldenes Funkeln um die Biene und ein weicher Schimmer, der ihr folgt.
import type { EffectContext } from "../core/effectContext";
import { envelope } from "../core/effectMath";
import { Palette } from "../core/effectPalette";
import { createPool, firstInactive } from "../core/pooling";
import { TrackedPosition } from "../core/trackedPosition";
import type { PositionSource } from "../effectTypes";
import { BillboardShape, shapeCode } from "../render/billboardBatch";

const MaxHeals = 24;
const SparklesPerHeal = 24;
const Duration = 1.6;
const SpawnWindow = 1.1;
/** Der Schimmer liegt vor dem Bienenkörper (Tiefenvorzug in m). */
const AuraPull = 0.15;

// Funke: Versatz zur Biene, Steiggeschwindigkeit, Alter, Lebensdauer, Farbmischung, Zufallswert
const OX = 0;
const OY = 1;
const OZ = 2;
const Rise = 3;
const Age = 4;
const Life = 5;
const Mix = 6;
const Seed = 7;
const Stride = 8;

const GlowCode = shapeCode(BillboardShape.Glow);

/** Eine laufende Heilung (Heilfunkeln). */
class HealEffect {
  public active = false;
  private age = 0;
  private spawned = 0;
  private spawnCredit = 0;
  private readonly anchor = new TrackedPosition();
  private readonly sparkles = new Float32Array(SparklesPerHeal * Stride);

  public start(at: PositionSource): void {
    this.active = this.anchor.bind(at);
    this.age = 0;
    this.spawned = 0;
    this.spawnCredit = 1;
  }

  public update(dt: number, context: EffectContext): void {
    this.age += dt;
    if (this.age >= Duration || !this.anchor.update()) {
      this.deactivate();
      return;
    }
    this.spawn(dt, context);
    const anchor = this.anchor.position;
    const aura = envelope(this.age, Duration, 0.15, 0.6) * 0.8;
    context.glow.dot(anchor, 0.17, Palette.healGreen, aura * 0.45, GlowCode, 2.6, 5, AuraPull);
    const green = Palette.healGreen;
    const gold = Palette.healGold;
    const s = this.sparkles;
    for (let i = 0; i < this.spawned; i++) {
      const o = i * Stride;
      const life = s[o + Life];
      const age = s[o + Age] + dt;
      if (age >= life) {
        continue;
      }
      s[o + Age] = age;
      s[o + OY] += s[o + Rise] * dt;
      const mix = s[o + Mix];
      const seed = s[o + Seed];
      const twinkle = Math.sin((Math.PI * age) / life) * (0.65 + 0.35 * Math.sin(age * 30 + seed * 20));
      const radius = 0.012 + 0.012 * seed;
      const x = anchor.x + s[o + OX];
      const y = anchor.y + s[o + OY];
      const z = anchor.z + s[o + OZ];
      context.glow.push(
        x,
        y,
        z,
        radius,
        x,
        y,
        z,
        radius,
        green.r + (gold.r - green.r) * mix,
        green.g + (gold.g - green.g) * mix,
        green.b + (gold.b - green.b) * mix,
        twinkle,
        shapeCode(BillboardShape.Star, seed),
        0.7,
        1,
        1.6,
      );
    }
  }

  private spawn(dt: number, context: EffectContext): void {
    if (this.age > SpawnWindow) {
      return;
    }
    this.spawnCredit += (dt * SparklesPerHeal) / SpawnWindow;
    const random = context.random;
    while (this.spawnCredit >= 1 && this.spawned < SparklesPerHeal) {
      this.spawnCredit -= 1;
      const o = this.spawned * Stride;
      const s = this.sparkles;
      // Startpunkt auf einer Kugelschale um die Biene
      const radius = random.range(0.12, 0.3);
      const z = random.signed();
      const angle = random.next() * Math.PI * 2;
      const ring = Math.sqrt(Math.max(0, 1 - z * z));
      s[o + OX] = Math.cos(angle) * ring * radius;
      s[o + OY] = z * radius * 0.8;
      s[o + OZ] = Math.sin(angle) * ring * radius;
      s[o + Rise] = random.range(0.15, 0.35);
      s[o + Age] = 0;
      s[o + Life] = random.range(0.6, 1);
      s[o + Mix] = random.next();
      s[o + Seed] = random.next();
      this.spawned++;
    }
  }

  public deactivate(): void {
    this.active = false;
    this.anchor.release();
  }
}

/** Alle laufenden Heilungen (Heilfunkeln). */
export class HealSparkles {
  private readonly context: EffectContext;
  private readonly heals: HealEffect[];

  public constructor(context: EffectContext) {
    this.context = context;
    this.heals = createPool(MaxHeals, () => new HealEffect());
  }

  public start(at: PositionSource): void {
    firstInactive(this.heals)?.start(at);
  }

  public update(dt: number): void {
    for (const heal of this.heals) {
      if (heal.active) {
        heal.update(dt, this.context);
      }
    }
  }

  public clear(): void {
    for (const heal of this.heals) {
      heal.deactivate();
    }
  }

  public dispose(): void {
    this.clear();
    this.heals.length = 0;
  }
}
