// Treffer und Einschläge: Funken, Blitze, Pollenwolken, Schleimspritzer und der Andockblitz —
// als Partikelrezepte im gemeinsamen Partikelpool.
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { EffectContext } from "../core/effectContext";
import { clamp01 } from "../core/effectMath";
import { Palette } from "../core/effectPalette";
import { ParticleLayer, type ParticleSpec } from "../core/particlePool";
import type { ImpactKind } from "../effectTypes";
import { BillboardShape } from "../render/billboardBatch";

const LaserSpark: ParticleSpec = {
  layer: ParticleLayer.Glow,
  shape: BillboardShape.Glow,
  param: 3,
  lifeMin: 0.12,
  lifeMax: 0.32,
  radiusMin: 0.0035,
  radiusMax: 0.006,
  radiusEnd: 0.4,
  color: Palette.laserSpark,
  colorAlt: Palette.laserSparkAlt,
  colorEnd: Palette.laserSparkEnd,
  drag: 1.5,
  gravity: 4,
  stretch: 0.03,
  minPixels: 1.2,
  fadeIn: 0,
};

const LaserFlash: ParticleSpec = {
  layer: ParticleLayer.Glow,
  shape: BillboardShape.Glow,
  param: 2.5,
  lifeMin: 0.08,
  lifeMax: 0.11,
  radiusMin: 0.05,
  radiusMax: 0.07,
  radiusEnd: 1.8,
  color: Palette.laserHitCore,
  colorEnd: { ...Palette.laserHitGlow, a: 0 },
  drag: 0,
  gravity: 0,
  stretch: 0,
  minPixels: 3,
  fadeIn: 0,
  depthPull: 0.5,
};

const LaserEmber: ParticleSpec = {
  ...LaserFlash,
  param: 2,
  lifeMin: 0.25,
  lifeMax: 0.35,
  radiusMin: 0.06,
  radiusMax: 0.08,
  radiusEnd: 0.6,
  color: Palette.laserEmber,
  colorEnd: Palette.transparent,
  minPixels: 2.5,
};

const PollenFlash: ParticleSpec = {
  ...LaserFlash,
  lifeMin: 0.07,
  lifeMax: 0.1,
  radiusMin: 0.03,
  radiusMax: 0.04,
  radiusEnd: 1.6,
  color: Palette.pollenSparkAlt,
  colorEnd: { ...Palette.pollenSpark, a: 0 },
  minPixels: 2.5,
};

const PollenGrain: ParticleSpec = {
  layer: ParticleLayer.Glow,
  shape: BillboardShape.Glow,
  param: 3,
  lifeMin: 0.3,
  lifeMax: 0.6,
  radiusMin: 0.003,
  radiusMax: 0.005,
  radiusEnd: 0.5,
  color: Palette.pollenSpark,
  colorAlt: Palette.pollenSparkAlt,
  colorEnd: Palette.pollenSparkEnd,
  drag: 2.5,
  gravity: 3,
  stretch: 0.02,
  minPixels: 1.1,
  fadeIn: 0,
};

const PollenPuff: ParticleSpec = {
  layer: ParticleLayer.Matter,
  shape: BillboardShape.Puff,
  param: 0.5,
  lifeMin: 0.5,
  lifeMax: 0.8,
  radiusMin: 0.03,
  radiusMax: 0.05,
  radiusEnd: 4,
  color: Palette.pollenDust,
  colorEnd: Palette.pollenDustEnd,
  drag: 3,
  gravity: -0.1,
  stretch: 0,
  minPixels: 1.5,
  fadeIn: 0.08,
  depthPull: 0.2,
};

const ExplosionStar: ParticleSpec = {
  layer: ParticleLayer.Glow,
  shape: BillboardShape.Star,
  param: 0.9,
  lifeMin: 0.12,
  lifeMax: 0.16,
  radiusMin: 0.5,
  radiusMax: 0.6,
  radiusEnd: 1.5,
  color: Palette.explosionFlash,
  colorEnd: { ...Palette.explosionRing, a: 0 },
  drag: 0,
  gravity: 0,
  stretch: 0,
  minPixels: 8,
  fadeIn: 0,
  depthPull: 0.7,
};

const ExplosionFireball: ParticleSpec = {
  ...ExplosionStar,
  shape: BillboardShape.Glow,
  param: 1.8,
  lifeMin: 0.22,
  lifeMax: 0.3,
  radiusMin: 0.32,
  radiusMax: 0.38,
  radiusEnd: 2.2,
  color: Palette.reviveGold,
  colorEnd: Palette.reviveGoldEnd,
  minPixels: 6,
};

const ExplosionRing: ParticleSpec = {
  ...ExplosionStar,
  shape: BillboardShape.Ring,
  param: 0.07,
  lifeMin: 0.28,
  lifeMax: 0.32,
  radiusMin: 0.12,
  radiusMax: 0.12,
  radiusEnd: 11,
  color: Palette.explosionRing,
  colorEnd: Palette.transparent,
  minPixels: 4,
};

const ExplosionSpark: ParticleSpec = {
  ...PollenGrain,
  lifeMin: 0.35,
  lifeMax: 0.85,
  radiusMin: 0.005,
  radiusMax: 0.009,
  radiusEnd: 0.35,
  drag: 2.2,
  gravity: 2.5,
  stretch: 0.035,
  minPixels: 1.3,
};

const ExplosionCloud: ParticleSpec = {
  layer: ParticleLayer.Matter,
  shape: BillboardShape.Puff,
  param: 0.55,
  lifeMin: 1.1,
  lifeMax: 1.7,
  radiusMin: 0.12,
  radiusMax: 0.2,
  radiusEnd: 4,
  color: Palette.explosionSmoke,
  colorEnd: Palette.explosionSmokeEnd,
  drag: 2.4,
  gravity: -0.2,
  stretch: 0,
  minPixels: 2,
  fadeIn: 0.06,
  depthPull: 0.4,
};

const ExplosionGlitter: ParticleSpec = {
  layer: ParticleLayer.Glow,
  shape: BillboardShape.Star,
  param: 0.6,
  lifeMin: 0.8,
  lifeMax: 1.4,
  radiusMin: 0.006,
  radiusMax: 0.012,
  radiusEnd: 0.5,
  color: Palette.pollenSparkAlt,
  colorEnd: Palette.pollenSparkEnd,
  drag: 1.2,
  gravity: 0.4,
  stretch: 0,
  minPixels: 1.2,
  fadeIn: 0,
};

const SlimeFlash: ParticleSpec = {
  ...LaserFlash,
  lifeMin: 0.08,
  lifeMax: 0.12,
  radiusMin: 0.08,
  radiusMax: 0.1,
  radiusEnd: 1.8,
  color: Palette.slimeFlash,
  colorEnd: { ...Palette.slimeGlow, a: 0 },
  minPixels: 3,
};

const SlimeRing: ParticleSpec = {
  ...ExplosionRing,
  param: 0.12,
  lifeMin: 0.2,
  lifeMax: 0.25,
  radiusMin: 0.04,
  radiusMax: 0.04,
  radiusEnd: 8,
  color: Palette.slimeGlow,
  minPixels: 3,
};

const SlimeDroplet: ParticleSpec = {
  layer: ParticleLayer.Matter,
  shape: BillboardShape.Blob,
  param: 0.5,
  lifeMin: 0.45,
  lifeMax: 0.9,
  radiusMin: 0.005,
  radiusMax: 0.012,
  radiusEnd: 0.6,
  color: Palette.slimeDrip,
  colorAlt: Palette.gooGreen,
  colorEnd: Palette.slimeDripEnd,
  drag: 0.8,
  gravity: 9,
  stretch: 0,
  minPixels: 1,
  fadeIn: 0,
};

const SlimeMist: ParticleSpec = {
  ...PollenPuff,
  param: 0.6,
  lifeMin: 0.5,
  lifeMax: 0.9,
  radiusMin: 0.05,
  radiusMax: 0.08,
  radiusEnd: 4,
  color: Palette.slimeMist,
  colorEnd: Palette.slimeMistEnd,
  drag: 2.5,
  gravity: -0.05,
  fadeIn: 0.1,
};

const DockGlow: ParticleSpec = {
  ...LaserFlash,
  param: 2,
  lifeMin: 0.3,
  lifeMax: 0.38,
  radiusMin: 1.2,
  radiusMax: 1.45,
  radiusEnd: 1.4,
  color: { ...Palette.dockWhite, a: 0.8 },
  colorEnd: { ...Palette.dockSpark, a: 0 },
  minPixels: 10,
  depthPull: 1.5,
};

const DockStar: ParticleSpec = {
  ...ExplosionStar,
  param: 1,
  lifeMin: 0.25,
  lifeMax: 0.32,
  radiusMin: 2.6,
  radiusMax: 3,
  radiusEnd: 1.3,
  color: { ...Palette.dockWhite, a: 0.8 },
  minPixels: 14,
  depthPull: 1.5,
};

const DockRing: ParticleSpec = {
  ...ExplosionRing,
  param: 0.05,
  lifeMin: 0.45,
  lifeMax: 0.5,
  radiusMin: 0.5,
  radiusMax: 0.5,
  radiusEnd: 7,
  color: Palette.dockWhite,
  minPixels: 8,
  depthPull: 1.5,
};

const DockSpark: ParticleSpec = {
  ...LaserSpark,
  lifeMin: 0.4,
  lifeMax: 0.8,
  radiusMin: 0.012,
  radiusMax: 0.02,
  color: Palette.dockSpark,
  colorAlt: Palette.dockWhite,
  colorEnd: Palette.dockSparkEnd,
  drag: 1.6,
  gravity: 1,
  stretch: 0.04,
  minPixels: 1.4,
};

/** Treffer- und Einschlageffekte (Einschläge). */
export class ImpactEffects {
  private readonly context: EffectContext;
  private readonly axis = new Vector3();

  public constructor(context: EffectContext) {
    this.context = context;
  }

  /** Treffer nach Art; strength 0..1 skaliert Größe und Helligkeit. */
  public impact(position: Vector3, kind: ImpactKind, strength: number): void {
    const s = clamp01(strength);
    switch (kind) {
      case "laser":
        this.laserHit(position, s);
        break;
      case "pollen":
        this.pollenHit(position, s);
        break;
      case "stinger":
        this.stingerExplosion(position, s);
        break;
      case "spit":
        this.spitSplat(position, s);
        break;
    }
  }

  /** Laser-Treffer: weißheißer Blitz, Glut und rote Funken (optional von `incoming` weg gesprüht). */
  public laserHit(position: Vector3, strength: number, incoming?: Vector3): void {
    const emitter = this.context.emitter;
    const size = 0.7 + 0.6 * strength;
    emitter.single(LaserFlash, position, 0, 0, 0, size);
    emitter.single(LaserEmber, position, 0, 0, 0, size);
    this.laserSparks(position, Math.round(6 + 14 * strength), incoming, 0.7 + 0.5 * strength);
  }

  /** Laserfunken am Auftreffpunkt; `incoming` ist die Strahlrichtung (Funken prallen zurück). */
  public laserSparks(position: Vector3, count: number, incoming: Vector3 | undefined, speedScale = 1): void {
    const emitter = this.context.emitter;
    if (incoming === undefined) {
      emitter.sphere(LaserSpark, position, count, 1.5 * speedScale, 5 * speedScale, 1, 1, 0, 0.3);
      return;
    }
    incoming.scaleToRef(-1, this.axis);
    emitter.cone(LaserSpark, position, count, this.axis, 1.1, 1.5 * speedScale, 5 * speedScale);
  }

  /** Pollenkugel-Treffer: goldener Blitz, Pollenkörner und ein Pollenwölkchen. */
  public pollenHit(position: Vector3, strength: number): void {
    const emitter = this.context.emitter;
    emitter.single(PollenFlash, position, 0, 0, 0, 0.7 + 0.6 * strength);
    emitter.sphere(PollenGrain, position, Math.round(5 + 10 * strength), 1, 3.5, 1, 1, 0, 0.2);
    emitter.sphere(PollenPuff, position, Math.round(1 + 2 * strength), 0.2, 0.6, 0.8 + 0.4 * strength);
  }

  /** Pollen-Explosion einer Stachelrakete (Explosionsradius ~0,8 m). */
  public stingerExplosion(position: Vector3, strength: number): void {
    const emitter = this.context.emitter;
    const size = 0.6 + 0.4 * strength;
    emitter.single(ExplosionStar, position, 0, 0, 0, size);
    emitter.single(ExplosionFireball, position, 0, 0, 0, size);
    emitter.single(ExplosionRing, position, 0, 0, 0, size);
    emitter.sphere(ExplosionSpark, position, Math.round(28 + 22 * strength), 3, 8, 1, 1, 0.05, 0.15);
    emitter.sphere(ExplosionCloud, position, Math.round(5 + 4 * strength), 0.5, 1.6, size, 1, 0.15, 0.1);
    emitter.sphere(ExplosionGlitter, position, 12, 0.5, 2, 1, 1, 0.1, 0.2);
  }

  /** Platschender Schleimtreffer; `incoming` ist die Flugrichtung der Spucke. */
  public spitSplat(position: Vector3, strength: number, incoming?: Vector3): void {
    const emitter = this.context.emitter;
    const size = 0.7 + 0.5 * strength;
    emitter.single(SlimeFlash, position, 0, 0, 0, size);
    emitter.single(SlimeRing, position, 0, 0, 0, size);
    const droplets = Math.round(12 + 16 * strength);
    if (incoming === undefined) {
      emitter.sphere(SlimeDroplet, position, droplets, 1.5, 4.5, 1, 1, 0, 0.45);
    } else {
      // Spritzer fliegen weiter in Flugrichtung und fächern leicht nach oben auf
      this.axis.copyFrom(incoming);
      this.axis.y += 0.35;
      this.axis.normalize();
      emitter.cone(SlimeDroplet, position, droplets, this.axis, 1.2, 1.5, 4.5);
    }
    emitter.sphere(SlimeMist, position, Math.round(2 + 2 * strength), 0.3, 0.8, size);
  }

  /** Andocken/Abdocken: großer warmweißer Lichtblitz am Flugloch mit Ring und Funken. */
  public dockFlash(position: Vector3): void {
    const emitter = this.context.emitter;
    emitter.single(DockGlow, position, 0, 0, 0);
    emitter.single(DockStar, position, 0, 0, 0);
    emitter.single(DockRing, position, 0, 0, 0);
    emitter.sphere(DockSpark, position, 26, 2, 6, 1, 1, 0.4);
  }

  /** Hält keine eigenen Ressourcen: laufende Einschläge sind Partikel des Kontexts. */
  public dispose(): void {
    // Nichts freizugeben; Teil des einheitlichen Lebenszyklus der Effektmodule.
  }
}
