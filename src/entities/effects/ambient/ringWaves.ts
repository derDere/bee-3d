// Ringe und Wellen: Schallringe beim Summen, die Duftwelle des Scanners und der goldene Lichtring der
// Wiederbelebung. Kamerazugewandte Ringe sind ein Billboard, liegende Ringe eine geschlossene Kette
// leuchtender Kapseln, die Wellenschale ein Billboard mit hellem Rand.
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { EffectContext } from "../core/effectContext";
import { clamp01, perpendicularBasis, smoothstep } from "../core/effectMath";
import { Palette, type FxColor } from "../core/effectPalette";
import { createPool, firstInactive } from "../core/pooling";
import { TrackedPosition } from "../core/trackedPosition";
import type { PositionSource } from "../effectTypes";
import { BillboardShape, shapeCode } from "../render/billboardBatch";

const MaxRings = 64;
const MaxSegments = 96;

/** Darstellungsart eines Rings (Ringart). */
const RingStyle = { Facing: 0, Planar: 1, Shell: 2 } as const;
type RingStyle = (typeof RingStyle)[keyof typeof RingStyle];

/** Beschreibung einer Ringart (Ringvorlage). */
interface RingSpec {
  readonly style: RingStyle;
  readonly radiusStart: number;
  /** Ringdicke: relativ zum Radius (kamerazugewandt) bzw. kleinste Halbdicke in Metern (liegend). */
  readonly thickness: number;
  /** Liegend: Halbdicke als Anteil des aktuellen Radius (wächst mit der Welle). */
  readonly relativeThickness: number;
  readonly color: FxColor;
  readonly intensity: number;
  /** Exponent der Ausdehnung: abbremsend (schneller Start) oder beschleunigend (langsamer Start). */
  readonly easePower: number;
  /** Beschleunigt die Ausdehnung: langsam um den Ursprung, dann rasch in die Weite. */
  readonly accelerate: boolean;
  /** Exponent des Verblassens über die Laufzeit. */
  readonly fadePower: number;
  readonly minPixels: number;
  readonly segments: number;
  /** Formparameter: Schärfe (liegend), Füllung (Schale). */
  readonly param: number;
}

const BuzzRing: RingSpec = { style: RingStyle.Facing, radiusStart: 0.1, thickness: 0.07, relativeThickness: 0, color: Palette.buzzRing, intensity: 1, easePower: 1.6, accelerate: false, fadePower: 1.5, minPixels: 6, segments: 0, param: 0 };
const ScanRing: RingSpec = { style: RingStyle.Planar, radiusStart: 0.5, thickness: 0.04, relativeThickness: 0.006, color: Palette.scanViolet, intensity: 1, easePower: 2, accelerate: true, fadePower: 1.2, minPixels: 1.5, segments: 96, param: 4 };
const ScanEcho: RingSpec = { ...ScanRing, relativeThickness: 0.004, intensity: 0.55 };
const ScanShell: RingSpec = { style: RingStyle.Shell, radiusStart: 0.3, thickness: 0, relativeThickness: 0, color: Palette.scanViolet, intensity: 0.7, easePower: 2, accelerate: true, fadePower: 2, minPixels: 4, segments: 0, param: 0.05 };
const ReviveRing: RingSpec = { style: RingStyle.Planar, radiusStart: 0.15, thickness: 0.035, relativeThickness: 0, color: Palette.reviveGold, intensity: 1, easePower: 1.8, accelerate: false, fadePower: 1.3, minPixels: 2, segments: 48, param: 2.5 };

/** Einheitskreis für liegende Ringe (Kosinus, Sinus je Segment). */
const UnitCircle = (() => {
  const table = new Float32Array((MaxSegments + 1) * 2);
  for (let i = 0; i <= MaxSegments; i++) {
    const angle = (i / MaxSegments) * Math.PI * 2;
    table[i * 2] = Math.cos(angle);
    table[i * 2 + 1] = Math.sin(angle);
  }
  return table;
})();

/** Ein laufender Ring (Ringwelle). */
class RingWave {
  public active = false;
  private spec: RingSpec = BuzzRing;
  private delay = 0;
  private age = 0;
  private duration = 1;
  private radiusEnd = 1;
  private thicknessScale = 1;
  private readonly anchor = new TrackedPosition();
  private readonly normal = new Vector3(0, 1, 0);
  private readonly u = new Vector3();
  private readonly v = new Vector3();
  private readonly center = new Vector3();

  public start(spec: RingSpec, delay: number, duration: number, radiusEnd: number, thicknessScale: number): void {
    this.spec = spec;
    this.delay = delay;
    this.age = 0;
    this.duration = Math.max(0.05, duration);
    this.radiusEnd = radiusEnd;
    this.thicknessScale = thicknessScale;
    this.active = true;
    perpendicularBasis(this.normal, this.u, this.v);
  }

  /** Ring folgt einer Positionsquelle. */
  public follow(source: PositionSource): boolean {
    return this.anchor.bind(source);
  }

  /** Ring bleibt an einer festen Position. */
  public fix(position: Vector3): void {
    this.anchor.setFixed(position);
  }

  public update(dt: number, context: EffectContext): void {
    if (this.delay > 0) {
      this.delay -= dt;
      this.anchor.update();
      return;
    }
    this.age += dt;
    if (this.age >= this.duration || !this.anchor.update()) {
      this.deactivate();
      return;
    }
    const spec = this.spec;
    const u = this.age / this.duration;
    const expansion = spec.accelerate ? Math.pow(u, spec.easePower) : 1 - Math.pow(1 - u, spec.easePower);
    const radius = spec.radiusStart + (this.radiusEnd - spec.radiusStart) * expansion;
    const intensity = spec.intensity * Math.pow(1 - u, spec.fadePower) * clamp01(this.age / 0.06);
    this.center.copyFrom(this.anchor.position);
    switch (spec.style) {
      case RingStyle.Facing:
        this.drawFacing(context, radius, intensity);
        break;
      case RingStyle.Planar:
        this.drawPlanar(context, radius, intensity);
        break;
      case RingStyle.Shell:
        this.drawShell(context, radius, intensity);
        break;
    }
  }

  private drawFacing(context: EffectContext, radius: number, intensity: number): void {
    const width = this.spec.thickness * this.thicknessScale;
    const quadRadius = radius / Math.max(0.2, 1 - width);
    context.glow.dot(this.center, quadRadius, this.spec.color, intensity, shapeCode(BillboardShape.Ring), width, this.spec.minPixels);
  }

  private drawPlanar(context: EffectContext, radius: number, intensity: number): void {
    const spec = this.spec;
    const step = Math.max(1, Math.floor(MaxSegments / Math.max(3, spec.segments)));
    const segments = Math.floor(MaxSegments / step);
    const halfWidth = Math.max(spec.thickness, radius * spec.relativeThickness) * this.thicknessScale;
    const code = shapeCode(BillboardShape.Glow, 0, true, true);
    const color = spec.color;
    const alpha = color.a * intensity;
    const c = this.center;
    for (let i = 0; i < segments; i++) {
      const a = i * step * 2;
      const b = i + 1 === segments ? MaxSegments * 2 : (i + 1) * step * 2;
      const ca = UnitCircle[a] * radius;
      const sa = UnitCircle[a + 1] * radius;
      const cb = UnitCircle[b] * radius;
      const sb = UnitCircle[b + 1] * radius;
      context.glow.push(
        c.x + this.u.x * ca + this.v.x * sa,
        c.y + this.u.y * ca + this.v.y * sa,
        c.z + this.u.z * ca + this.v.z * sa,
        halfWidth,
        c.x + this.u.x * cb + this.v.x * sb,
        c.y + this.u.y * cb + this.v.y * sb,
        c.z + this.u.z * cb + this.v.z * sb,
        halfWidth,
        color.r,
        color.g,
        color.b,
        alpha,
        code,
        spec.param,
        1,
        spec.minPixels,
      );
    }
  }

  private drawShell(context: EffectContext, radius: number, intensity: number): void {
    // Von innen ist die Schale unsichtbar: Ausblenden, sobald die Kamera die Welle erreicht
    const distance = Vector3.Distance(context.cameraPosition, this.center);
    const outside = smoothstep(radius * 0.95, radius * 1.25, distance);
    if (outside <= 0) {
      return;
    }
    context.glow.dot(this.center, radius, this.spec.color, intensity * outside, shapeCode(BillboardShape.Shell), this.spec.param, this.spec.minPixels);
  }

  public deactivate(): void {
    this.active = false;
    this.anchor.release();
  }
}

/** Alle Ringe und Wellen (Ringwellen). */
export class RingWaves {
  private readonly context: EffectContext;
  private readonly rings: RingWave[];

  public constructor(context: EffectContext) {
    this.context = context;
    this.rings = createPool(MaxRings, () => new RingWave());
  }

  /** Summen: drei Schallringe, die sich nacheinander um die Biene ausbreiten. */
  public buzz(at: PositionSource): void {
    for (let i = 0; i < 3; i++) {
      const ring = firstInactive(this.rings);
      if (ring === undefined || !ring.follow(at)) {
        return;
      }
      ring.start(BuzzRing, i * 0.12, 0.65, 0.85, 1);
    }
  }

  /** Duftscanner: liegende Welle und Wellenschale bis `radius`. */
  public scan(position: Vector3, radius: number): void {
    const reach = Math.max(1, radius);
    const duration = Math.min(4.5, 1.2 + reach / 900);
    this.startFixed(ScanRing, position, 0, duration, reach, 1);
    this.startFixed(ScanEcho, position, 0.22, duration, reach * 0.92, 1);
    this.startFixed(ScanShell, position, 0, duration, reach, 1);
  }

  /** Wiederbelebung: zwei liegende goldene Lichtringe. */
  public revive(position: Vector3): void {
    this.startFixed(ReviveRing, position, 0, 0.9, 1.6, 1);
    this.startFixed(ReviveRing, position, 0.18, 0.8, 1.1, 0.8);
  }

  private startFixed(spec: RingSpec, position: Vector3, delay: number, duration: number, radiusEnd: number, thicknessScale: number): void {
    const ring = firstInactive(this.rings);
    if (ring === undefined) {
      return;
    }
    ring.fix(position);
    ring.start(spec, delay, duration, radiusEnd, thicknessScale);
  }

  public update(dt: number): void {
    for (const ring of this.rings) {
      if (ring.active) {
        ring.update(dt, this.context);
      }
    }
  }

  public clear(): void {
    for (const ring of this.rings) {
      ring.deactivate();
    }
  }

  public dispose(): void {
    this.clear();
    this.rings.length = 0;
  }
}
