// Weiße Rauchspuren der Stachelraketen: eine Kette weicher Rauchkapseln zwischen Spurpunkten, die
// auseinanderdriften, wachsen und verblassen. An den Nähten blenden die Kapseln ineinander über.
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { EffectContext } from "../core/effectContext";
import { clamp01 } from "../core/effectMath";
import type { EffectRandom } from "../core/effectRandom";
import { Palette } from "../core/effectPalette";
import { createPool, firstInactive } from "../core/pooling";
import { BillboardShape, shapeCode } from "../render/billboardBatch";

const MaxTrails = 72;
const MaxPoints = 112;
const PointLife = 1.5;
const SpawnInterval = 0.015;
const StartRadius = 0.012;
const GrowRadius = 0.2;
const Drag = 1.6;
const Rise = 0.12;

// Spurpunkt: Position, Driftgeschwindigkeit, Alter, Zufallswert
const PX = 0;
const PY = 1;
const PZ = 2;
const VX = 3;
const VY = 4;
const VZ = 5;
const PAge = 6;
const PSeed = 7;
const PointStride = 8;

/** Eine Rauchspur hinter einem Geschoss (Rauchspur). */
export class SmokeTrail {
  public active = false;
  private attached = false;
  private readonly points = new Float32Array(MaxPoints * PointStride);
  private oldest = 0;
  private count = 0;
  private spawnCredit = 0;
  private headX = 0;
  private headY = 0;
  private headZ = 0;
  private lastX = 0;
  private lastY = 0;
  private lastZ = 0;

  /** Beginnt eine neue Spur am Emitterpunkt. */
  public start(position: Vector3): void {
    this.active = true;
    this.attached = true;
    this.oldest = 0;
    this.count = 0;
    this.spawnCredit = SpawnInterval;
    this.setHead(position);
    this.lastX = position.x;
    this.lastY = position.y;
    this.lastZ = position.z;
  }

  /** Führt die Spur mit dem Emitter mit; legt in festen Abständen neue Punkte ab. */
  public feed(position: Vector3, dt: number, random: EffectRandom): void {
    if (!this.attached) {
      return;
    }
    this.setHead(position);
    this.spawnCredit += dt;
    if (this.spawnCredit < SpawnInterval) {
      return;
    }
    this.spawnCredit = 0;
    const inverse = dt > 1e-5 ? 1 / Math.max(dt, SpawnInterval) : 0;
    // Rauch erbt einen kleinen Teil der Rückwärtsbewegung und quillt zufällig auseinander
    const backX = (this.lastX - position.x) * inverse * 0.06;
    const backY = (this.lastY - position.y) * inverse * 0.06;
    const backZ = (this.lastZ - position.z) * inverse * 0.06;
    this.lastX = position.x;
    this.lastY = position.y;
    this.lastZ = position.z;
    this.addPoint(
      position.x,
      position.y,
      position.z,
      backX + random.signed() * 0.25,
      backY + random.signed() * 0.25 + 0.1,
      backZ + random.signed() * 0.25,
      random.next(),
    );
  }

  /** Löst die Spur vom Emitter; sie verweht danach von selbst. */
  public detach(): void {
    if (this.attached) {
      this.attached = false;
      this.addPoint(this.headX, this.headY, this.headZ, 0, 0.1, 0, 0.5);
    }
  }

  public update(dt: number): void {
    const p = this.points;
    const damping = 1 / (1 + Drag * dt);
    for (let i = 0; i < this.count; i++) {
      const o = ((this.oldest + i) % MaxPoints) * PointStride;
      p[o + VX] *= damping;
      p[o + VY] = p[o + VY] * damping + Rise * dt;
      p[o + VZ] *= damping;
      p[o + PX] += p[o + VX] * dt;
      p[o + PY] += p[o + VY] * dt;
      p[o + PZ] += p[o + VZ] * dt;
      p[o + PAge] += dt;
    }
    while (this.count > 0 && p[this.oldest * PointStride + PAge] >= PointLife) {
      this.oldest = (this.oldest + 1) % MaxPoints;
      this.count--;
    }
    if (!this.attached && this.count === 0) {
      this.active = false;
    }
  }

  /** Schreibt die Kapselkette in den Materie-Stapel. */
  public draw(context: EffectContext): void {
    const p = this.points;
    const matter = context.matter;
    const color = Palette.smokeWhite;
    const segments = this.attached ? this.count : this.count - 1;
    for (let i = 0; i < segments; i++) {
      const a = ((this.oldest + i) % MaxPoints) * PointStride;
      const ageA = p[a + PAge];
      const radiusA = this.radiusAt(ageA) * (0.75 + 0.5 * p[a + PSeed]);
      const alphaA = this.alphaAt(ageA);
      let bx: number;
      let by: number;
      let bz: number;
      let radiusB: number;
      let alphaB: number;
      let seed: number;
      if (i + 1 < this.count) {
        const b = ((this.oldest + i + 1) % MaxPoints) * PointStride;
        bx = p[b + PX];
        by = p[b + PY];
        bz = p[b + PZ];
        radiusB = this.radiusAt(p[b + PAge]) * (0.75 + 0.5 * p[b + PSeed]);
        alphaB = this.alphaAt(p[b + PAge]);
        seed = p[b + PSeed];
      } else {
        // Letztes Stück reicht bis zum Emitter
        bx = this.headX;
        by = this.headY;
        bz = this.headZ;
        radiusB = StartRadius;
        alphaB = this.alphaAt(0.05);
        seed = 0.5;
      }
      if (alphaB <= 0.001 && alphaA <= 0.001) {
        continue;
      }
      // Deckkraft am neueren Ende B, das ältere Ende A über das Verhältnis (Kette mit Nähten an inneren Punkten)
      const code = shapeCode(BillboardShape.Puff, seed, i > 0, i + 1 < segments);
      const fadeA = Math.min(4, alphaA / Math.max(alphaB, 1e-3));
      matter.push(p[a + PX], p[a + PY], p[a + PZ], radiusA, bx, by, bz, radiusB, color.r, color.g, color.b, color.a * alphaB, code, 0.7, fadeA, 1.2);
    }
  }

  private radiusAt(age: number): number {
    const u = clamp01(age / PointLife);
    return StartRadius + GrowRadius * (1 - (1 - u) * (1 - u));
  }

  private alphaAt(age: number): number {
    const u = clamp01(age / PointLife);
    return Math.pow(1 - u, 1.4) * clamp01(age / 0.05 + 0.3);
  }

  private setHead(position: Vector3): void {
    this.headX = position.x;
    this.headY = position.y;
    this.headZ = position.z;
  }

  private addPoint(x: number, y: number, z: number, vx: number, vy: number, vz: number, seed: number): void {
    if (this.count >= MaxPoints) {
      this.oldest = (this.oldest + 1) % MaxPoints;
      this.count--;
    }
    const o = ((this.oldest + this.count) % MaxPoints) * PointStride;
    const p = this.points;
    p[o + PX] = x;
    p[o + PY] = y;
    p[o + PZ] = z;
    p[o + VX] = vx;
    p[o + VY] = vy;
    p[o + VZ] = vz;
    p[o + PAge] = 0;
    p[o + PSeed] = seed;
    this.count++;
  }

  public reset(): void {
    this.active = false;
    this.attached = false;
    this.count = 0;
  }

  public dispose(): void {
    this.reset();
  }
}

/** Pool aller Rauchspuren (Rauchspuren). */
export class SmokeTrails {
  private readonly context: EffectContext;
  private readonly trails: SmokeTrail[];

  public constructor(context: EffectContext) {
    this.context = context;
    this.trails = createPool(MaxTrails, () => new SmokeTrail());
  }

  /** Startet eine Spur oder liefert undefined, wenn alle Spuren belegt sind. */
  public start(position: Vector3): SmokeTrail | undefined {
    const trail = firstInactive(this.trails);
    trail?.start(position);
    return trail;
  }

  public update(dt: number): void {
    for (const trail of this.trails) {
      if (trail.active) {
        trail.update(dt);
        if (trail.active) {
          trail.draw(this.context);
        }
      }
    }
  }

  public clear(): void {
    for (const trail of this.trails) {
      trail.reset();
    }
  }

  public dispose(): void {
    for (const trail of this.trails) {
      trail.dispose();
    }
    this.trails.length = 0;
  }
}
