// Kampf- und Spieleffekte: setzt den Vertrag EffectsApi mit wenigen gemeinsamen Stapeln um. Alle Effekte
// zeichnen in zwei Billboard-Stapel (Materie und Leuchten) und zwei Mesh-Stapel (Stachel, Flügelsplitter),
// zusammen höchstens vier Draw Calls. Transparentes liegt in Rendering-Gruppe 1, Licht entsteht über
// HDR-Farben und Bloom, ohne Lichtquellen je Effekt.
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { CollectStreams } from "./ambient/collectStreams";
import { HealSparkles } from "./ambient/healSparkles";
import { RingWaves } from "./ambient/ringWaves";
import { SpeedMotes } from "./ambient/speedMotes";
import { WarpStreaks } from "./ambient/warpStreaks";
import { GatlingTracers } from "./combat/gatlingTracers";
import { ImpactEffects } from "./combat/impactEffects";
import { LaserBeams } from "./combat/laserBeams";
import { SmokeTrails } from "./combat/smokeTrails";
import { SpitBalls } from "./combat/spitBalls";
import { StingerRockets } from "./combat/stingerRockets";
import { EffectContext } from "./core/effectContext";
import { isFiniteVector } from "./core/effectMath";
import { DeathEffects } from "./creatures/deathEffects";
import { WingFragments } from "./creatures/wingFragments";
import type { EffectsApi, ImpactKind, PositionSource } from "./effectTypes";
import { BillboardBatch } from "./render/billboardBatch";
import { BillboardMaterial } from "./render/billboardMaterial";

/** Rendering-Gruppe aller Effekte: nach Szene und Himmel (Gruppe 0), vor den Volumenwolken nicht verdeckt. */
const EffectsRenderingGroup = 1;
/** Zeichenreihenfolge unter den transparenten Meshes: Splitter, dann Materie, dann Leuchten obenauf. */
const WingAlphaIndex = 1000;
const MatterAlphaIndex = 1001;
const GlowAlphaIndex = 1002;
const GlowCapacity = 6144;
const MatterCapacity = 4096;
const ParticleCapacity = 6000;
const Seed = 0xbee3d;
const MaxStep = 0.1;

/** Kennzahlen der Effekte im letzten Frame (Effekt-Kennzahlen). */
export interface EffectStatistics {
  readonly glowInstances: number;
  readonly matterInstances: number;
  readonly meshInstances: number;
  readonly particles: number;
  readonly beams: number;
  /** Gezeichnete Effekt-Meshes = Draw Calls der Effekte. */
  readonly drawCalls: number;
  /** Seit dem Start verworfene Billboards (volle Stapel). */
  readonly dropped: number;
}

/** Kampf- und Spieleffekte des Spiels (Effektsystem). */
export class EffectsSystem implements EffectsApi {
  private readonly material: BillboardMaterial;
  private readonly matter: BillboardBatch;
  private readonly glow: BillboardBatch;
  private readonly context: EffectContext;
  private readonly impacts: ImpactEffects;
  private readonly lasers: LaserBeams;
  private readonly gatling: GatlingTracers;
  private readonly trails: SmokeTrails;
  private readonly stingers: StingerRockets;
  private readonly spitBalls: SpitBalls;
  private readonly wings: WingFragments;
  private readonly rings: RingWaves;
  private readonly deaths: DeathEffects;
  private readonly heals: HealSparkles;
  private readonly streams: CollectStreams;
  private readonly warp: WarpStreaks;
  private readonly motes: SpeedMotes;
  private disposed = false;

  public constructor(scene: Scene, camera: Camera) {
    this.material = new BillboardMaterial(scene, camera);
    this.matter = new BillboardBatch("fxMatter", scene, this.material.material, {
      capacity: MatterCapacity,
      additive: false,
      alphaIndex: MatterAlphaIndex,
      renderingGroupId: EffectsRenderingGroup,
    });
    this.glow = new BillboardBatch("fxGlow", scene, this.material.material, {
      capacity: GlowCapacity,
      additive: true,
      alphaIndex: GlowAlphaIndex,
      renderingGroupId: EffectsRenderingGroup,
    });
    this.context = new EffectContext(scene, camera, this.glow, this.matter, ParticleCapacity, Seed);
    this.impacts = new ImpactEffects(this.context);
    this.lasers = new LaserBeams(this.context, this.impacts);
    this.gatling = new GatlingTracers(this.context, this.impacts);
    this.trails = new SmokeTrails(this.context);
    this.stingers = new StingerRockets(scene, this.context, this.impacts, this.trails, EffectsRenderingGroup);
    this.spitBalls = new SpitBalls(this.context, this.impacts);
    this.wings = new WingFragments(scene, EffectsRenderingGroup, WingAlphaIndex);
    this.rings = new RingWaves(this.context);
    this.deaths = new DeathEffects(this.context, this.wings, this.rings);
    this.heals = new HealSparkles(this.context);
    this.streams = new CollectStreams(this.context);
    this.warp = new WarpStreaks(this.context);
    this.motes = new SpeedMotes(this.context);
  }

  /** Rückt alle Effekte um dt Sekunden vor und befüllt die Stapel; einmal je Frame nach der Kamera aufrufen. */
  public frameUpdate(dt: number): void {
    if (this.disposed) {
      return;
    }
    const step = Number.isFinite(dt) ? Math.min(MaxStep, Math.max(0, dt)) : 0;
    this.context.beginFrame(step);
    this.glow.begin();
    this.matter.begin();
    this.motes.update(step);
    this.warp.update(step);
    this.lasers.update(step);
    this.gatling.update(step);
    this.stingers.update(step);
    this.trails.update(step);
    this.spitBalls.update(step);
    this.rings.update(step);
    this.heals.update(step);
    this.streams.update(step);
    this.wings.update(step);
    this.context.particles.update(step, this.glow, this.matter);
    this.glow.end();
    this.matter.end();
    this.material.update(this.context.time);
  }

  /** Kennzahlen des letzten Frames. */
  public get statistics(): EffectStatistics {
    const drawCalls =
      Number(this.glow.mesh.isVisible) + Number(this.matter.mesh.isVisible) + Number(this.stingers.meshBatch.mesh.isVisible) + Number(this.wings.meshBatch.mesh.isVisible);
    return {
      glowInstances: this.glow.count,
      matterInstances: this.matter.count,
      meshInstances: this.stingers.meshBatch.count + this.wings.meshBatch.count,
      particles: this.context.particles.count,
      beams: this.lasers.activeCount,
      drawCalls,
      dropped: this.glow.dropped + this.matter.dropped,
    };
  }

  public laserBeam(from: PositionSource, to: PositionSource, durationSeconds: number, hit: boolean): void {
    this.lasers.fire(from, to, finiteOr(durationSeconds, 0.5), hit);
  }

  public freeLaser(from: PositionSource, direction: () => Vector3 | undefined, active: () => boolean): void {
    this.lasers.fireFree(from, direction, active);
  }

  public gatlingBurst(origins: readonly PositionSource[], to: PositionSource, shots: number, hits: number): void {
    this.gatling.burst(origins, to, finiteOr(shots, 0), finiteOr(hits, 0));
  }

  public stingerVolley(from: PositionSource, to: PositionSource, count: number, flightSeconds: number): void {
    this.stingers.volley(from, to, finiteOr(count, 1), finiteOr(flightSeconds, 1));
  }

  public spit(from: PositionSource, to: PositionSource, count: number, flightSeconds: number): void {
    this.spitBalls.volley(from, to, finiteOr(count, 1), finiteOr(flightSeconds, 1));
  }

  public impact(position: Vector3, kind: ImpactKind, strength: number): void {
    if (isFiniteVector(position)) {
      this.impacts.impact(position, kind, finiteOr(strength, 0.5));
    }
  }

  public flyDeath(position: Vector3, size: number): void {
    if (isFiniteVector(position)) {
      this.deaths.flyDeath(position, finiteOr(size, 0.45));
    }
  }

  public beeDeath(position: Vector3): void {
    if (isFiniteVector(position)) {
      this.deaths.beeDeath(position);
    }
  }

  public revive(position: Vector3): void {
    if (isFiniteVector(position)) {
      this.deaths.revive(position);
    }
  }

  public collectStream(from: Vector3, to: PositionSource, durationSeconds: number, golden: boolean): void {
    if (isFiniteVector(from)) {
      this.streams.start(from, to, finiteOr(durationSeconds, 1), golden);
    }
  }

  public buzzRing(at: PositionSource): void {
    this.rings.buzz(at);
  }

  public heal(at: PositionSource): void {
    this.heals.start(at);
  }

  public scanPulse(position: Vector3, radius: number): void {
    if (isFiniteVector(position)) {
      this.rings.scan(position, finiteOr(radius, 100));
    }
  }

  public dockFlash(position: Vector3): void {
    if (isFiniteVector(position)) {
      this.impacts.dockFlash(position);
    }
  }

  public setWarp(intensity: number, direction: Vector3): void {
    this.warp.set(finiteOr(intensity, 0), direction);
  }

  public setSpeedMotes(speed: number, direction: Vector3): void {
    this.motes.set(finiteOr(speed, 0), direction);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.lasers.dispose();
    this.gatling.dispose();
    this.stingers.dispose();
    this.trails.dispose();
    this.spitBalls.dispose();
    this.rings.dispose();
    this.heals.dispose();
    this.streams.dispose();
    this.wings.dispose();
    this.warp.dispose();
    this.motes.dispose();
    this.deaths.dispose();
    this.impacts.dispose();
    this.context.dispose();
    this.glow.dispose();
    this.matter.dispose();
    this.material.dispose();
  }
}

/** Ersetzt nicht endliche Zahlen durch einen Ersatzwert. */
function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
