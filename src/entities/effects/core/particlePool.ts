// Partikelpool für Funken, Spritzer, Rauch und Glitzern: ballistische CPU-Partikel in einem
// verschachtelten Float32Array (Entfernen durch Tausch mit dem letzten Eintrag, keine Allokationen).
import type { BillboardBatch, BillboardShape } from "../render/billboardBatch";
import { shapeCode } from "../render/billboardBatch";
import type { FxColor } from "./effectPalette";
import type { EffectRandom } from "./effectRandom";

/** Zielstapel eines Partikels (Partikelebene). */
export const ParticleLayer = { Glow: 0, Matter: 1 } as const;
export type ParticleLayer = (typeof ParticleLayer)[keyof typeof ParticleLayer];

/** Beschreibung einer Partikelart (Partikelart). */
export interface ParticleSpec {
  readonly layer: ParticleLayer;
  readonly shape: BillboardShape;
  /** Formparameter des Shaders (Schärfe, Ringdicke, Zerfaserung, Eigenleuchten, Strahlstärke). */
  readonly param: number;
  readonly lifeMin: number;
  readonly lifeMax: number;
  readonly radiusMin: number;
  readonly radiusMax: number;
  /** Endradius als Vielfaches des Startradius. */
  readonly radiusEnd: number;
  readonly color: FxColor;
  /** Optionale zweite Startfarbe; jedes Partikel mischt zufällig zwischen beiden. */
  readonly colorAlt?: FxColor;
  readonly colorEnd: FxColor;
  /** Luftwiderstand in 1/s. */
  readonly drag: number;
  /** Schwerkraft in m/s² (positiv nach unten, negativ = Auftrieb). */
  readonly gravity: number;
  /** Bewegungsunschärfe in Sekunden: Schweif = Geschwindigkeit · stretch; 0 = runder Punkt. */
  readonly stretch: number;
  readonly minPixels: number;
  /** Anteil der Lebensdauer zum Einblenden (0 = sofort sichtbar). */
  readonly fadeIn: number;
  /** Tiefenvorzug in Metern (mit sizeScale skaliert): Blitze im Inneren eines Ziels liegen über dessen Oberfläche. */
  readonly depthPull?: number;
}

const X = 0;
const Y = 1;
const Z = 2;
const VX = 3;
const VY = 4;
const VZ = 5;
const Age = 6;
const Life = 7;
const Radius0 = 8;
const Radius1 = 9;
const Color0 = 10;
const Color1 = 14;
const Drag = 18;
const Gravity = 19;
const Stretch = 20;
const Code = 21;
const Param = 22;
const MinPixels = 23;
const FadeIn = 24;
const Layer = 25;
const DepthPull = 26;
const Stride = 27;

/** Pool ballistischer Effektpartikel (Partikelpool). */
export class ParticlePool {
  public readonly capacity: number;
  private readonly data: Float32Array;
  private readonly random: EffectRandom;
  private live = 0;

  public constructor(capacity: number, random: EffectRandom) {
    this.capacity = capacity;
    this.random = random;
    this.data = new Float32Array(capacity * Stride);
  }

  /** Anzahl lebender Partikel. */
  public get count(): number {
    return this.live;
  }

  /**
   * Erzeugt ein Partikel; `sizeScale` skaliert den Radius, `intensity` die Startfarbe (Helligkeit bzw. Deckkraft).
   * Liefert false, wenn der Pool voll ist.
   */
  public emit(spec: ParticleSpec, x: number, y: number, z: number, vx: number, vy: number, vz: number, sizeScale = 1, intensity = 1): boolean {
    if (this.live >= this.capacity) {
      return false;
    }
    const random = this.random;
    const d = this.data;
    const o = this.live * Stride;
    d[o + X] = x;
    d[o + Y] = y;
    d[o + Z] = z;
    d[o + VX] = vx;
    d[o + VY] = vy;
    d[o + VZ] = vz;
    d[o + Age] = 0;
    d[o + Life] = random.range(spec.lifeMin, spec.lifeMax);
    const radius = random.range(spec.radiusMin, spec.radiusMax) * sizeScale;
    d[o + Radius0] = radius;
    d[o + Radius1] = radius * spec.radiusEnd;
    const start = spec.color;
    const alt = spec.colorAlt ?? start;
    const mixing = spec.colorAlt === undefined ? 0 : random.next();
    d[o + Color0] = start.r + (alt.r - start.r) * mixing;
    d[o + Color0 + 1] = start.g + (alt.g - start.g) * mixing;
    d[o + Color0 + 2] = start.b + (alt.b - start.b) * mixing;
    d[o + Color0 + 3] = (start.a + (alt.a - start.a) * mixing) * intensity;
    const end = spec.colorEnd;
    d[o + Color1] = end.r;
    d[o + Color1 + 1] = end.g;
    d[o + Color1 + 2] = end.b;
    d[o + Color1 + 3] = end.a * intensity;
    d[o + Drag] = spec.drag;
    d[o + Gravity] = spec.gravity;
    d[o + Stretch] = spec.stretch;
    d[o + Code] = shapeCode(spec.shape, random.next());
    d[o + Param] = spec.param;
    d[o + MinPixels] = spec.minPixels;
    d[o + FadeIn] = spec.fadeIn;
    d[o + Layer] = spec.layer;
    d[o + DepthPull] = (spec.depthPull ?? 0) * sizeScale;
    this.live++;
    return true;
  }

  /** Bewegt alle Partikel um dt und schreibt sie in ihre Stapel. */
  public update(dt: number, glow: BillboardBatch, matter: BillboardBatch): void {
    const d = this.data;
    let i = 0;
    while (i < this.live) {
      const o = i * Stride;
      const age = d[o + Age] + dt;
      const life = d[o + Life];
      if (age >= life) {
        this.live--;
        if (i < this.live) {
          const last = this.live * Stride;
          d.copyWithin(o, last, last + Stride);
        }
        continue;
      }
      d[o + Age] = age;
      const u = age / life;
      const damping = 1 / (1 + d[o + Drag] * dt);
      const vx = d[o + VX] * damping;
      const vy = d[o + VY] * damping - d[o + Gravity] * dt;
      const vz = d[o + VZ] * damping;
      d[o + VX] = vx;
      d[o + VY] = vy;
      d[o + VZ] = vz;
      const x = d[o + X] + vx * dt;
      const y = d[o + Y] + vy * dt;
      const z = d[o + Z] + vz * dt;
      d[o + X] = x;
      d[o + Y] = y;
      d[o + Z] = z;

      // Radius wächst bzw. schrumpft schnell zu Beginn, Farbe läuft linear zur Endfarbe
      const growth = 1 - (1 - u) * (1 - u);
      const radius = d[o + Radius0] + (d[o + Radius1] - d[o + Radius0]) * growth;
      const r = d[o + Color0] + (d[o + Color1] - d[o + Color0]) * u;
      const g = d[o + Color0 + 1] + (d[o + Color1 + 1] - d[o + Color0 + 1]) * u;
      const b = d[o + Color0 + 2] + (d[o + Color1 + 2] - d[o + Color0 + 2]) * u;
      let alpha = d[o + Color0 + 3] + (d[o + Color1 + 3] - d[o + Color0 + 3]) * u;
      const fadeIn = d[o + FadeIn];
      if (fadeIn > 0 && u < fadeIn) {
        alpha *= u / fadeIn;
      }
      const batch = d[o + Layer] === ParticleLayer.Matter ? matter : glow;
      const stretch = d[o + Stretch];
      if (stretch > 0) {
        batch.push(x - vx * stretch, y - vy * stretch, z - vz * stretch, radius * 0.35, x, y, z, radius, r, g, b, alpha, d[o + Code], d[o + Param], 0.1, d[o + MinPixels], d[o + DepthPull]);
      } else {
        batch.push(x, y, z, radius, x, y, z, radius, r, g, b, alpha, d[o + Code], d[o + Param], 1, d[o + MinPixels], d[o + DepthPull]);
      }
      i++;
    }
  }

  /** Entfernt alle Partikel. */
  public clear(): void {
    this.live = 0;
  }

  public dispose(): void {
    this.clear();
  }
}
