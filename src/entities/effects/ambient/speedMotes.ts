// Fahrtwind: feine Staub- und Pollenpartikel in einem Würfel um die Kamera, die der Flugrichtung
// entgegenströmen und nach dem Tempo gestreckt werden — der Tempo-Eindruck im leeren Himmel.
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { EffectContext } from "../core/effectContext";
import { clamp01, isFiniteVector, smoothstep } from "../core/effectMath";
import { Palette } from "../core/effectPalette";
import { BillboardShape, shapeCode } from "../render/billboardBatch";

const MaxMotes = 320;
const HalfSize = 6;
const Exposure = 0.026;
const MaxStreak = 2.5;
/** Ab diesem Tempo übernehmen die Warp-Schlieren, die Partikel blenden aus. */
const FadeOutStart = 60;
const FadeOutEnd = 220;
const PollenShare = 0.2;

// Partikel: Versatz zur Kamera (Weltachsen), Größe, Art (0 = Staub, 1 = Pollen)
const OX = 0;
const OY = 1;
const OZ = 2;
const Size = 3;
const Kind = 4;
const Stride = 5;

/** Fahrtwind-Partikel um die Kamera (Fahrtwind). */
export class SpeedMotes {
  private readonly context: EffectContext;
  private readonly motes = new Float32Array(MaxMotes * Stride);
  private readonly direction = new Vector3(0, 0, 1);
  private speed = 0;
  private readonly code = shapeCode(BillboardShape.Glow);

  public constructor(context: EffectContext) {
    this.context = context;
    const random = context.random;
    for (let i = 0; i < MaxMotes; i++) {
      const o = i * Stride;
      this.motes[o + OX] = random.signed() * HalfSize;
      this.motes[o + OY] = random.signed() * HalfSize;
      this.motes[o + OZ] = random.signed() * HalfSize;
      const pollen = random.next() < PollenShare;
      this.motes[o + Size] = pollen ? random.range(0.0025, 0.0035) : random.range(0.0012, 0.0022);
      this.motes[o + Kind] = pollen ? 1 : 0;
    }
  }

  /** Setzt Tempo (m/s) und Flugrichtung (Einheitsvektor). */
  public set(speed: number, direction: Vector3): void {
    this.speed = Number.isFinite(speed) ? Math.max(0, speed) : 0;
    if (isFiniteVector(direction) && direction.lengthSquared() > 1e-8) {
      this.direction.copyFrom(direction).normalize();
    }
  }

  public update(dt: number): void {
    const speed = this.speed;
    if (speed < 0.3) {
      return;
    }
    const visibility = Math.pow(clamp01(speed / 30), 0.8) * (1 - smoothstep(FadeOutStart, FadeOutEnd, speed));
    const d = this.direction;
    const travel = speed * dt;
    const streak = Math.min(MaxStreak, speed * Exposure);
    const camera = this.context.cameraPosition;
    const glow = this.context.glow;
    const span = HalfSize * 2;
    const m = this.motes;
    for (let i = 0; i < MaxMotes; i++) {
      const o = i * Stride;
      // Strömung entgegen der Flugrichtung, danach in den Würfel zurückfalten
      let x = m[o + OX] - d.x * travel;
      let y = m[o + OY] - d.y * travel;
      let z = m[o + OZ] - d.z * travel;
      x -= Math.floor((x + HalfSize) / span) * span;
      y -= Math.floor((y + HalfSize) / span) * span;
      z -= Math.floor((z + HalfSize) / span) * span;
      m[o + OX] = x;
      m[o + OY] = y;
      m[o + OZ] = z;
      if (visibility <= 0.002) {
        continue;
      }
      const distance = Math.sqrt(x * x + y * y + z * z);
      const fade = smoothstep(0.35, 1.1, distance) * (1 - smoothstep(HalfSize * 0.7, HalfSize, distance));
      if (fade <= 0.001) {
        continue;
      }
      const color = m[o + Kind] === 1 ? Palette.motePollen : Palette.moteDust;
      const size = m[o + Size];
      const headX = camera.x + x;
      const headY = camera.y + y;
      const headZ = camera.z + z;
      glow.push(headX + d.x * streak, headY + d.y * streak, headZ + d.z * streak, size * 0.5, headX, headY, headZ, size, color.r, color.g, color.b, visibility * fade * 0.75, this.code, 2.5, 0, 0.7);
    }
  }

  public dispose(): void {
    this.speed = 0;
  }
}
