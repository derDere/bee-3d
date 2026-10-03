// Tod und Wiederkehr: Fliegen platzen mit grün-schwarzen Spritzern, Flügelsplittern und einer Rauchwolke
// (größenabhängig), Bienen leuchten als Geist cyan auf, die Wiederbelebung umgibt sie mit goldenem Licht.
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { RingWaves } from "../ambient/ringWaves";
import type { EffectContext } from "../core/effectContext";
import { Palette } from "../core/effectPalette";
import { ParticleLayer, type ParticleSpec } from "../core/particlePool";
import { BillboardShape } from "../render/billboardBatch";
import type { WingFragments } from "./wingFragments";

/** Bezugsgröße für die Skalierung: Länge einer Schmeißfliege in Metern. */
const BlowflyLength = 0.45;

const FlyPopFlash: ParticleSpec = {
  layer: ParticleLayer.Glow,
  shape: BillboardShape.Glow,
  param: 2.2,
  lifeMin: 0.07,
  lifeMax: 0.1,
  radiusMin: 0.12,
  radiusMax: 0.15,
  radiusEnd: 1.6,
  color: { r: 1.2, g: 3.4, b: 0.5, a: 0.9 },
  colorEnd: { r: 0.4, g: 1.6, b: 0.2, a: 0 },
  drag: 0,
  gravity: 0,
  stretch: 0,
  minPixels: 5,
  fadeIn: 0,
  depthPull: 0.25,
};

const FlyShockRing: ParticleSpec = {
  ...FlyPopFlash,
  shape: BillboardShape.Ring,
  param: 0.05,
  lifeMin: 0.18,
  lifeMax: 0.22,
  radiusMin: 0.1,
  radiusMax: 0.1,
  radiusEnd: 6,
  color: { ...Palette.slimeGlow, a: 0.35 },
  colorEnd: Palette.transparent,
  minPixels: 4,
};

const GooDark: ParticleSpec = {
  layer: ParticleLayer.Matter,
  shape: BillboardShape.Blob,
  param: 0.05,
  lifeMin: 0.7,
  lifeMax: 1.3,
  radiusMin: 0.008,
  radiusMax: 0.02,
  radiusEnd: 0.45,
  color: Palette.gooDark,
  colorEnd: Palette.gooEnd,
  drag: 0.9,
  gravity: 6,
  stretch: 0,
  minPixels: 1.2,
  fadeIn: 0,
};

const GooGreen: ParticleSpec = {
  ...GooDark,
  param: 0.35,
  color: Palette.gooGreen,
  colorAlt: Palette.slimeBall,
};

const DeathMist: ParticleSpec = {
  layer: ParticleLayer.Matter,
  shape: BillboardShape.Puff,
  param: 0.6,
  lifeMin: 0.4,
  lifeMax: 0.6,
  radiusMin: 0.05,
  radiusMax: 0.08,
  radiusEnd: 3.5,
  color: { r: 0.1, g: 0.2, b: 0.05, a: 0.5 },
  colorEnd: Palette.transparent,
  drag: 3,
  gravity: 0,
  stretch: 0,
  minPixels: 1.5,
  fadeIn: 0.1,
  depthPull: 0.15,
};

const DeathSmoke: ParticleSpec = {
  ...DeathMist,
  param: 0.5,
  lifeMin: 1.6,
  lifeMax: 2.6,
  radiusMin: 0.12,
  radiusMax: 0.18,
  radiusEnd: 4,
  color: Palette.deathSmoke,
  colorEnd: Palette.deathSmokeEnd,
  drag: 1.6,
  gravity: -0.25,
  minPixels: 2,
  fadeIn: 0.08,
};

const GhostFlash: ParticleSpec = {
  ...FlyPopFlash,
  param: 2,
  lifeMin: 0.22,
  lifeMax: 0.28,
  radiusMin: 0.28,
  radiusMax: 0.34,
  radiusEnd: 1.5,
  color: { ...Palette.ghostCyan, a: 0.6 },
  colorEnd: { ...Palette.ghostWisp, a: 0 },
  minPixels: 6,
};

const GhostStar: ParticleSpec = {
  ...GhostFlash,
  shape: BillboardShape.Star,
  param: 0.8,
  lifeMin: 0.26,
  lifeMax: 0.32,
  radiusMin: 0.55,
  radiusMax: 0.65,
  radiusEnd: 1.2,
  colorEnd: Palette.transparent,
  minPixels: 10,
  color: { ...Palette.ghostCyan, a: 0.6 },
};

const GhostRing: ParticleSpec = {
  ...GhostFlash,
  shape: BillboardShape.Ring,
  param: 0.045,
  lifeMin: 0.45,
  lifeMax: 0.5,
  radiusMin: 0.12,
  radiusMax: 0.12,
  radiusEnd: 8,
  colorEnd: Palette.transparent,
  minPixels: 5,
  color: { ...Palette.ghostCyan, a: 0.7 },
};

const GhostWisp: ParticleSpec = {
  layer: ParticleLayer.Glow,
  shape: BillboardShape.Glow,
  param: 3,
  lifeMin: 0.9,
  lifeMax: 1.6,
  radiusMin: 0.012,
  radiusMax: 0.025,
  radiusEnd: 0.35,
  color: Palette.ghostWisp,
  colorEnd: Palette.ghostWispEnd,
  drag: 0.8,
  gravity: -0.4,
  stretch: 0.06,
  minPixels: 1.4,
  fadeIn: 0,
};

const GhostAura: ParticleSpec = {
  ...GhostWisp,
  param: 2.2,
  lifeMin: 1.3,
  lifeMax: 1.5,
  radiusMin: 0.3,
  radiusMax: 0.34,
  radiusEnd: 0.8,
  color: { r: 0.5, g: 2, b: 2.6, a: 1 },
  colorEnd: Palette.transparent,
  drag: 0,
  gravity: 0,
  stretch: 0,
  minPixels: 6,
  fadeIn: 0.08,
  depthPull: 0.15,
};

const ReviveFlash: ParticleSpec = {
  ...GhostFlash,
  lifeMin: 0.22,
  lifeMax: 0.28,
  radiusMin: 0.45,
  radiusMax: 0.55,
  radiusEnd: 1.6,
  color: Palette.reviveGold,
  colorEnd: Palette.reviveGoldEnd,
};

const ReviveColumn: ParticleSpec = {
  ...GhostWisp,
  param: 3,
  lifeMin: 0.7,
  lifeMax: 0.8,
  radiusMin: 0.05,
  radiusMax: 0.05,
  radiusEnd: 0.3,
  color: Palette.reviveGold,
  colorEnd: Palette.transparent,
  drag: 0,
  gravity: 0,
  stretch: 0.8,
  minPixels: 2,
};

const ReviveSparkle: ParticleSpec = {
  ...GhostWisp,
  shape: BillboardShape.Star,
  param: 0.7,
  lifeMin: 0.8,
  lifeMax: 1.5,
  radiusMin: 0.015,
  radiusMax: 0.03,
  radiusEnd: 0.4,
  color: Palette.reviveGold,
  colorEnd: Palette.reviveGoldEnd,
  drag: 0.6,
  gravity: -0.6,
  stretch: 0,
  minPixels: 1.6,
};

/** Tod der Fliegen und Bienen, Wiederbelebung (Todeseffekte). */
export class DeathEffects {
  private readonly context: EffectContext;
  private readonly wings: WingFragments;
  private readonly rings: RingWaves;
  private readonly velocity = new Vector3();
  private readonly spawn = new Vector3();

  public constructor(context: EffectContext, wings: WingFragments, rings: RingWaves) {
    this.context = context;
    this.wings = wings;
    this.rings = rings;
  }

  /** Eine Fliege platzt; `size` ist ihre Länge in Metern (Schmeißfliege 0,45, Brummer 0,9, Königin 2,8). */
  public flyDeath(position: Vector3, size: number): void {
    const emitter = this.context.emitter;
    const random = this.context.random;
    const k = Math.max(0.3, size / BlowflyLength);
    const sizeScale = Math.pow(k, 0.8);
    const speedScale = Math.pow(k, 0.5);
    emitter.single(FlyPopFlash, position, 0, 0, 0, sizeScale);
    emitter.single(FlyShockRing, position, 0, 0, 0, k);
    const goo = Math.round(26 * Math.pow(k, 0.6));
    emitter.sphere(GooDark, position, Math.ceil(goo / 2), 1.5 * speedScale, 4.5 * speedScale, Math.pow(k, 0.7), 1, 0.08 * k, 0.3);
    emitter.sphere(GooGreen, position, Math.floor(goo / 2), 1.5 * speedScale, 4.5 * speedScale, Math.pow(k, 0.7), 1, 0.08 * k, 0.3);
    emitter.sphere(DeathMist, position, 3, 0.4 * speedScale, 1.2 * speedScale, k, 1, 0.05 * k);
    emitter.sphere(DeathSmoke, position, Math.round(5 + 3 * speedScale), 0.3 * speedScale, 0.8 * speedScale, Math.pow(k, 0.85), 1, 0.15 * k);
    const shards = Math.min(8, 2 + Math.round(k));
    for (let i = 0; i < shards; i++) {
      random.unitVector(this.velocity);
      this.velocity.scaleInPlace(random.range(1, 2.5) * Math.pow(k, 0.4));
      this.velocity.y += 0.8;
      random.unitVector(this.spawn);
      this.spawn.scaleInPlace(0.1 * k).addInPlace(position);
      this.wings.spawn(this.spawn, this.velocity, random.range(0.06, 0.12) * sizeScale, random.range(1.8, 2.8), random);
    }
  }

  /** Die Biene wird zum Geist: cyanes Aufleuchten mit Ring, Strahlenstern und aufsteigenden Schwaden. */
  public beeDeath(position: Vector3): void {
    const emitter = this.context.emitter;
    emitter.single(GhostFlash, position, 0, 0, 0);
    emitter.single(GhostStar, position, 0, 0, 0);
    emitter.single(GhostRing, position, 0, 0, 0);
    emitter.single(GhostAura, position, 0, 0.12, 0);
    emitter.sphere(GhostWisp, position, 26, 0.3, 1.2, 1, 1, 0.12, 1.5);
  }

  /** Wiederbelebung im Bienenstock: goldener Blitz, liegende Lichtringe, Lichtsäule und Funkeln. */
  public revive(position: Vector3): void {
    const emitter = this.context.emitter;
    emitter.single(ReviveFlash, position, 0, 0, 0);
    this.spawn.copyFrom(position);
    this.spawn.y += 0.6;
    emitter.single(ReviveColumn, this.spawn, 0, 1.5, 0);
    emitter.sphere(ReviveSparkle, position, 30, 0.3, 1, 1, 1, 0.4, 2);
    this.rings.revive(position);
  }

  /** Hält keine eigenen Ressourcen: Partikel, Splitter und Ringe gehören ihren Modulen. */
  public dispose(): void {
    // Nichts freizugeben; Teil des einheitlichen Lebenszyklus der Effektmodule.
  }
}
