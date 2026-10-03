// Warp: lange Lichtschlieren in einer Röhre um die Kamera, ausgerichtet auf die Flugrichtung. Sie strömen
// der Kamera entgegen, ihre Zahl, Länge und Helligkeit folgen der Warp-Intensität.
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { EffectContext } from "../core/effectContext";
import { clamp01, isFiniteVector, perpendicularBasis, smoothstep } from "../core/effectMath";
import { Palette } from "../core/effectPalette";
import { BillboardShape, shapeCode } from "../render/billboardBatch";

const MaxStreaks = 150;
const NearAxial = -30;
const SpawnAxialMin = 140;
const SpawnAxialRange = 120;
const RiseRate = 5;
const FallRate = 3;

// Schliere: Abstand entlang der Flugachse, Abstand zur Achse, Winkel, Länge, Helligkeit
const Axial = 0;
const Radial = 1;
const Angle = 2;
const Length = 3;
const Brightness = 4;
const Stride = 5;

/** Lichtschlieren des Warps (Warp-Schlieren). */
export class WarpStreaks {
  private readonly context: EffectContext;
  private readonly streaks = new Float32Array(MaxStreaks * Stride);
  private readonly direction = new Vector3(0, 0, 1);
  private readonly targetDirection = new Vector3(0, 0, 1);
  private readonly u = new Vector3();
  private readonly v = new Vector3();
  private targetIntensity = 0;
  private intensity = 0;
  private readonly code = shapeCode(BillboardShape.Glow);

  public constructor(context: EffectContext) {
    this.context = context;
    for (let i = 0; i < MaxStreaks; i++) {
      this.respawn(i, NearAxial + this.context.random.next() * (SpawnAxialMin + SpawnAxialRange - NearAxial));
    }
  }

  /** Setzt Ziel-Intensität 0..1 und Flugrichtung (Einheitsvektor). */
  public set(intensity: number, direction: Vector3): void {
    this.targetIntensity = clamp01(intensity);
    if (isFiniteVector(direction) && direction.lengthSquared() > 1e-8) {
      this.targetDirection.copyFrom(direction).normalize();
    }
  }

  /** Aktuelle, geglättete Intensität. */
  public get currentIntensity(): number {
    return this.intensity;
  }

  public update(dt: number): void {
    const rate = this.targetIntensity > this.intensity ? RiseRate : FallRate;
    this.intensity += (this.targetIntensity - this.intensity) * (1 - Math.exp(-rate * dt));
    if (this.intensity < 0.005) {
      this.direction.copyFrom(this.targetDirection);
      return;
    }
    Vector3.LerpToRef(this.direction, this.targetDirection, 1 - Math.exp(-8 * dt), this.direction);
    this.direction.normalize();
    perpendicularBasis(this.direction, this.u, this.v);
    const intensity = this.intensity;
    const flow = (60 + 260 * intensity) * dt;
    const visible = Math.ceil(MaxStreaks * Math.min(1, intensity * 1.2));
    const camera = this.context.cameraPosition;
    const d = this.direction;
    const color = Palette.warpStreak;
    const s = this.streaks;
    for (let i = 0; i < MaxStreaks; i++) {
      const o = i * Stride;
      s[o + Axial] -= flow;
      if (s[o + Axial] < NearAxial) {
        this.respawn(i, SpawnAxialMin + this.context.random.next() * SpawnAxialRange);
      }
      if (i >= visible) {
        continue;
      }
      const axial = s[o + Axial];
      const radial = s[o + Radial];
      const angle = s[o + Angle];
      const offsetX = (this.u.x * Math.cos(angle) + this.v.x * Math.sin(angle)) * radial;
      const offsetY = (this.u.y * Math.cos(angle) + this.v.y * Math.sin(angle)) * radial;
      const offsetZ = (this.u.z * Math.cos(angle) + this.v.z * Math.sin(angle)) * radial;
      const headX = camera.x + d.x * axial + offsetX;
      const headY = camera.y + d.y * axial + offsetY;
      const headZ = camera.z + d.z * axial + offsetZ;
      const length = s[o + Length] * (0.3 + 0.7 * intensity);
      // Einblenden in der Ferne, Ausblenden kurz hinter der Kamera
      const fade = smoothstep(SpawnAxialMin + SpawnAxialRange, SpawnAxialMin, axial) * smoothstep(NearAxial, NearAxial + 18, axial);
      const alpha = s[o + Brightness] * Math.pow(intensity, 1.5) * fade;
      this.context.glow.push(headX + d.x * length, headY + d.y * length, headZ + d.z * length, 0.004, headX, headY, headZ, 0.025, color.r, color.g, color.b, alpha, this.code, 2.5, 0, 0.9);
    }
  }

  private respawn(index: number, axial: number): void {
    const random = this.context.random;
    const o = index * Stride;
    const s = this.streaks;
    const spread = random.next();
    s[o + Axial] = axial;
    s[o + Radial] = 2.5 + spread * spread * 16;
    s[o + Angle] = random.next() * Math.PI * 2;
    s[o + Length] = random.range(8, 36);
    s[o + Brightness] = random.range(0.4, 1);
  }

  public dispose(): void {
    this.targetIntensity = 0;
    this.intensity = 0;
  }
}
