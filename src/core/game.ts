import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import "@babylonjs/core/Rendering/depthRendererSceneComponent";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import "@babylonjs/core/Meshes/instancedMesh";
import "@babylonjs/core/Culling/ray";
import "@babylonjs/core/Animations/animatable";
import "@babylonjs/core/Engines/AbstractEngine/abstractEngine.timeQuery";
import "@babylonjs/core/Engines/Extensions/engine.query";
import { generateWorld, type WorldLayout } from "../../shared/worldgen";
import { WorldIndex } from "../../shared/worldIndex";
import { WorldSeed } from "../../shared/world";
import { isNightHours } from "../../shared/dayClock";
import type { DebugHost } from "../debug/debugApi";
import type { GameplayDebugApi, NetDebugApi, SkyDebugApi, VirtualInput } from "../debug/debugTypes";
import { EffectsSystem } from "../entities/effects/effectsSystem";
import { Hud } from "../hud/hud";
import { createOutdoorLightingAsync, type OutdoorLighting } from "../rendering/lighting";
import { loadCloudNoise } from "../rendering/sky/noise/cloudNoiseLoader";
import { SkySystem } from "../rendering/sky/skySystem";
import type { MistVolume } from "../rendering/sky/cloudRenderer";
import type { AudioApi } from "../systems/audio/audioTypes";
import { AudioSystem } from "../systems/audio/audioSystem";
import { SilentAudio } from "../systems/audio/silentAudio";
import { CameraRig } from "../systems/cameraRig";
import { Logger } from "@babylonjs/core/Misc/logger";
import { HiveViews } from "../world/hiveViews";
import { IslandStreamer, type IslandDetailSettings } from "../world/islandStreamer";
import { GameLoop } from "./gameLoop";
import { Gameplay } from "./gameplay";
import { ModelLibrary } from "./modelLibrary";
import { qualitySettings, type QualitySettings, type QualityTier } from "./quality";
import { SettingsStore } from "./settings";
import { Viewpoints } from "./viewpoints";

/** Nachtleuchten je Blütenart (Materialname Flora_Blossom_<Art>). */
const BlossomGlowColors: Readonly<Record<string, Color3>> = {
  Daisy: new Color3(1, 0.93, 0.62),
  Poppy: new Color3(1, 0.2, 0.08),
  Lupine: new Color3(0.62, 0.32, 1),
  Buttercup: new Color3(1, 0.82, 0.12),
  Bluebell: new Color3(0.35, 0.48, 1),
  Lily: new Color3(1, 0.6, 0.82),
};

/**
 * Spiel (Spiel): besitzt Engine, Szene, Spieltakt und alle Systeme. Aufbaureihenfolge nach Skill
 * babylon-graphics: Kamera → Licht-Stack mit Atmosphäre → danach erst Modelle und PBR-Materialien.
 * Je Frame laufen erst Netz und Spiellogik, dann Kamera, dann Himmel, Welt und Effekte, zuletzt HUD und Ton.
 */
export class Game implements DebugHost {
  public readonly engine: AbstractEngine;
  public readonly scene: Scene;
  public readonly loop: GameLoop;
  public readonly settings: SettingsStore;
  public readonly cameraRig: CameraRig;
  public readonly lighting: OutdoorLighting;
  public readonly sky: SkySystem;
  public readonly layout: WorldLayout;
  public readonly worldIndex: WorldIndex;
  public readonly library: ModelLibrary;
  public readonly islands: IslandStreamer;
  public readonly hives: HiveViews;
  public readonly effects: EffectsSystem;
  public readonly audio: AudioApi;
  private readonly hudRoot: HTMLElement;
  private readonly viewpoints: Viewpoints;
  private gameplayValue: Gameplay | undefined;
  private quality: QualitySettings;
  private readyFlag = false;
  private readonly startedAt = performance.now();
  private readonly blossomColors = new Map<PBRMaterial, Color3>();
  private nightGlow = -1;

  private constructor(
    engine: AbstractEngine,
    scene: Scene,
    hudRoot: HTMLElement,
    quality: QualitySettings,
    settings: SettingsStore,
    cameraRig: CameraRig,
    lighting: OutdoorLighting,
    audio: AudioApi,
  ) {
    this.engine = engine;
    this.scene = scene;
    this.hudRoot = hudRoot;
    this.quality = quality;
    this.settings = settings;
    this.cameraRig = cameraRig;
    this.lighting = lighting;
    this.loop = new GameLoop(engine, scene);
    this.layout = generateWorld(WorldSeed);
    this.worldIndex = new WorldIndex(this.layout);
    this.library = new ModelLibrary(scene);
    this.sky = new SkySystem(scene, cameraRig.camera, lighting, quality, () => this.worldSeconds());
    this.sky.setMistSource((position, amount) => this.mistVolumes(position, amount));
    this.sky.setClearings([...this.layout.nests, ...this.layout.hives].map((site) => ({ x: site.x, y: site.y, z: site.z, radius: 120 })));
    this.sky.setReduceFlashes(settings.value.reduceFlashes);
    this.islands = new IslandStreamer(scene, this.library, this.layout, lighting.shadows, Game.islandDetail(quality), (material) => this.registerBlossom(material));
    this.hives = new HiveViews(scene, this.library, this.layout.hives, lighting.shadows, () => cameraRig.camera.globalPosition);
    this.effects = new EffectsSystem(scene, cameraRig.camera);
    this.audio = audio;
    this.audio.setVolumes(settings.value.masterVolume, settings.value.musicVolume);
    this.viewpoints = new Viewpoints(this.layout, cameraRig, this.sky, this.hives);
  }

  /** Baut das Spiel auf (Szene, Licht, Welt, Spielgeschehen) und lädt die Grundmodelle. */
  public static async createAsync(engine: AbstractEngine, hudRoot: HTMLElement): Promise<Game> {
    registerBuiltInLoaders();
    const settings = new SettingsStore();
    const quality = qualitySettings(Game.initialTier(engine, settings));
    engine.setHardwareScalingLevel(quality.hardwareScaling);
    const scene = new Scene(engine);
    scene.skipPointerMovePicking = true;
    const cameraRig = new CameraRig(scene);
    const [lighting, audio] = await Promise.all([createOutdoorLightingAsync(scene, cameraRig.camera, quality), Game.createAudioAsync()]);
    const game = new Game(engine, scene, hudRoot, quality, settings, cameraRig, lighting, audio);
    await game.loadAsync();
    return game;
  }

  private static islandDetail(quality: QualitySettings): IslandDetailSettings {
    return { range: quality.islandDetailRange, maxIslands: quality.maxDetailedIslands, floraDensity: quality.floraDensity };
  }

  /** Tonsystem mit prozeduralen Klängen; ohne AudioContext läuft das Spiel stumm weiter. */
  private static async createAudioAsync(): Promise<AudioApi> {
    try {
      return await AudioSystem.createAsync();
    } catch (error) {
      Logger.Warn(`Ton nicht verfügbar, das Spiel läuft stumm: ${String(error)}`);
      return new SilentAudio();
    }
  }

  private static initialTier(engine: AbstractEngine, settings: SettingsStore): QualityTier {
    const fromUrl = new URLSearchParams(window.location.search).get("quality");
    if (fromUrl === "low" || fromUrl === "medium" || fromUrl === "high" || fromUrl === "ultra") {
      return fromUrl;
    }
    const stored = settings.value.quality;
    if (stored !== "auto") {
      return stored;
    }
    return engine.isWebGPU ? "high" : "medium";
  }

  private get gameplay(): Gameplay {
    if (this.gameplayValue === undefined) {
      throw new Error("Spielgeschehen noch nicht geladen");
    }
    return this.gameplayValue;
  }

  private async loadAsync(): Promise<void> {
    const noise = loadCloudNoise(WorldSeed);
    await Promise.all([this.islands.initializeAsync(), this.hives.initializeAsync()]);
    this.sky.attachClouds(await noise);
    const canvas = this.engine.getRenderingCanvas();
    if (canvas === null) {
      throw new Error("Zeichenfläche fehlt");
    }
    const gameplay = await Gameplay.createAsync({
      scene: this.scene,
      canvas,
      hudRoot: this.hudRoot,
      loop: this.loop,
      cameraRig: this.cameraRig,
      layout: this.layout,
      world: this.worldIndex,
      library: this.library,
      shadows: this.lighting.shadows,
      sky: this.sky,
      settings: this.settings,
      hives: this.hives,
      effects: this.effects,
      audio: this.audio,
      createHud: (actions, settings) => new Hud(this.hudRoot, actions, settings),
      applyQuality: (tier) => this.chooseQuality(tier),
      nightGlow: () => Math.max(0, this.nightGlow),
      localWorldSeconds: () => (performance.now() - this.startedAt) / 1000,
    });
    this.gameplayValue = gameplay;
    this.loop.addFixed(gameplay);
    this.loop.addFrame(gameplay.beforeCamera);
    this.loop.addFrame(this.cameraRig);
    this.loop.addFrame(this.sky);
    this.loop.addFrame(this.islands);
    this.loop.addFrame(this.hives);
    this.loop.addFrame(this.effects);
    this.loop.addFrame({ frameUpdate: () => this.updateNightGlow() });
    this.loop.addFrame(gameplay.afterCamera);
    this.viewpoints.apply("overview");
  }

  public start(): void {
    this.loop.start();
    void this.scene.whenReadyAsync(true).then(() => {
      let frames = 0;
      const observer = this.scene.onAfterRenderObservable.add(() => {
        frames++;
        if (frames >= 2) {
          this.scene.onAfterRenderObservable.remove(observer);
          this.readyFlag = true;
        }
      });
    });
  }

  /** Gemeinsame Weltzeit in Sekunden: Server-Takt, sonst die lokale Uhr. */
  public worldSeconds(): number {
    return this.gameplayValue?.worldSeconds() ?? (performance.now() - this.startedAt) / 1000;
  }

  /** Qualitätsstufe aus dem Menü; "auto" wählt nach Grafik-API. */
  private chooseQuality(tier: QualityTier | "auto"): void {
    this.settings.update({ quality: tier });
    this.applyQuality(tier === "auto" ? (this.engine.isWebGPU ? "high" : "medium") : tier);
  }

  private registerBlossom(material: PBRMaterial): void {
    // Leuchtfarbe je Blütenart; die Blütenfarbe steckt in den Vertexfarben, die das Emissive nicht färben
    const species = material.name.replace("Flora_Blossom_", "");
    const glow = (BlossomGlowColors[species] ?? new Color3(1, 0.85, 0.95)).scale(1.5);
    this.blossomColors.set(material, glow);
    this.nightGlow = -1;
  }

  /** Blumen und Seerosen leuchten nachts (sanft ein- und ausgeblendet). */
  private updateNightGlow(): void {
    const elevation = this.sky.celestial.sunElevationDeg;
    const glow = Math.min(1, Math.max(0, (-elevation - 2) / 8));
    if (Math.abs(glow - this.nightGlow) < 0.01) {
      return;
    }
    this.nightGlow = glow;
    for (const [material, color] of this.blossomColors) {
      material.emissiveColor.copyFrom(color).scaleInPlace(glow);
      material.emissiveIntensity = 1;
    }
  }

  /** Nebelvolumen an Inseln nahe der Kamera (Morgennebel). */
  private mistVolumes(position: Vector3, amount: number): MistVolume[] {
    const volumes: Array<MistVolume & { distance: number }> = [];
    for (const island of this.worldIndex.islandsNear(position.x, position.z, 1400)) {
      const distance = Math.hypot(island.x - position.x, island.y - position.y, island.z - position.z);
      // Kragen um den Inselkörper unter der Grasnarbe und flacher Dunst über der Wiese; die Detail-Erosion macht ihn fasrig.
      volumes.push({ x: island.x, y: island.top - 3 * island.scale, z: island.z, radius: island.radius * 3 + 25, density: 0.16 * amount, softness: 0.7, flatten: 2.2, distance });
      volumes.push({ x: island.x, y: island.top + 1, z: island.z, radius: island.radius * 2 + 10, density: 0.1 * amount, softness: 0.7, flatten: 3.5, distance: distance + 1 });
    }
    volumes.sort((a, b) => a.distance - b.distance);
    return volumes.slice(0, 16);
  }

  // ---------- DebugHost ----------

  public get isReady(): boolean {
    return this.readyFlag;
  }

  public get isPaused(): boolean {
    return this.loop.isPaused;
  }

  public get qualityTier(): QualityTier {
    return this.quality.tier;
  }

  public get timeOfDay(): number {
    return this.sky.clock.hours;
  }

  public get skyDebug(): SkyDebugApi {
    return {
      listWeathers: () => this.sky.weather.names,
      setWeather: (name: string, blendSeconds = 0) => this.sky.weather.setLocal(name, blendSeconds, this.sky.clock.worldSeconds),
      setTimeScale: (scale: number) => this.sky.clock.setTimeScale(scale),
      skyState: () => ({ ...this.sky.debugState() }),
      triggerLightning: () => this.sky.triggerLightning(),
      triggerRainbow: () => this.sky.triggerRainbow(),
    };
  }

  public get netDebug(): NetDebugApi {
    return {
      state: () => this.gameplay.netState,
      dropConnection: () => this.gameplay.dropConnection(),
    };
  }

  public get gameplayDebug(): GameplayDebugApi {
    const gameplay = this.gameplay;
    return { actions: gameplay.actions, hud: () => gameplay.hudModel() };
  }

  public pause(): void {
    this.loop.setPaused(true);
  }

  public resume(): void {
    this.loop.setPaused(false);
  }

  public advanceFixedSteps(steps: number): Promise<void> {
    return this.loop.advanceFixedSteps(steps);
  }

  public async holdVirtualInput(input: VirtualInput, steps: number): Promise<void> {
    this.gameplay.setVirtualInput(input);
    try {
      await this.loop.advanceFixedSteps(steps);
    } finally {
      this.gameplay.setVirtualInput(undefined);
    }
  }

  public setTimeOfDay(hours: number): void {
    this.sky.clock.setHours(hours);
    this.sky.syncCelestial();
  }

  public viewpointNames(): readonly string[] {
    return this.viewpoints.names;
  }

  public applyViewpoint(name: string): void {
    this.viewpoints.apply(name);
  }

  public startGame(name: string): void {
    this.gameplay.start(name);
  }

  public applyQuality(tier: QualityTier): void {
    this.quality = qualitySettings(tier);
    this.engine.setHardwareScalingLevel(this.quality.hardwareScaling);
    this.lighting.pipeline.samples = this.quality.msaaSamples;
    this.lighting.pipeline.fxaaEnabled = this.quality.fxaa;
    this.lighting.pipeline.bloomEnabled = this.quality.bloom;
    this.sky.applyQuality(this.quality);
    this.islands.setDetail(Game.islandDetail(this.quality));
  }

  public effectNames(): readonly string[] {
    return ["clouds", "cloudTemporal", "haze", "mist", "lightShafts", "stars", "rain", "lightning", "rainbow", "shadows", "bloom", "hud"];
  }

  public setEffectEnabled(name: string, enabled: boolean): void {
    if (this.sky.setEffect(name, enabled)) {
      return;
    }
    if (name === "shadows") {
      this.sky.setShadowsEnabled(enabled);
    } else if (name === "bloom") {
      this.lighting.pipeline.bloomEnabled = enabled;
    } else if (name === "hud") {
      this.hudRoot.style.display = enabled ? "" : "none";
    }
  }

  public snapshotState(): Readonly<Record<string, unknown>> {
    const camera = this.cameraRig.camera.globalPosition;
    return {
      camera: { x: camera.x, y: camera.y, z: camera.z, mode: this.cameraRig.mode },
      world: { islands: this.layout.islands.length, patches: this.layout.patches.length, hives: this.layout.hives.length, nests: this.layout.nests.length, detailedIslands: this.islands.detailedCount },
      night: isNightHours(this.sky.clock.hours),
      ...this.gameplay.snapshot(),
    };
  }
}
