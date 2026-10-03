import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { DepthRenderer } from "@babylonjs/core/Rendering/depthRenderer";
import { WorldRadius, WorldSeed } from "../../../shared/world";
import type { WeatherOverride } from "../../../shared/weather";
import type { FrameSystem } from "../../core/gameLoop";
import type { QualitySettings } from "../../core/quality";
import { AtmosphereOriginHeightKm, applyGrading, type OutdoorLighting } from "../lighting";
import { CelestialBodies } from "./celestialBodies";
import { CelestialRig } from "./celestial";
import { CloudDensityField } from "./cloudDensityField";
import { CloudDensityProbe } from "./cloudDensityProbe";
import { CloudMedium } from "./cloudMedium";
import { ClearingCount, CloudRenderer, type CloudClearing, type CloudFrameParams, type MistVolume } from "./cloudRenderer";
import { LightningDirector, type LightningTarget, type ThunderListener } from "./lightningDirector";
import { LightShafts } from "./lightShafts";
import type { CloudNoiseData } from "./noise/cloudNoiseData";
import { FarRainLayer, NearRainLayer, RainSystem } from "./rainSystem";
import { RainbowDirector } from "./rainbowDirector";
import { SkyClock } from "./skyClock";
import { SkyKeyframes, type SkyLook, type SkyPhase } from "./skyKeyframes";
import { lerpHue, mix, smoothstep } from "./skyMath";
import { WeatherDirector, type WeatherPreset } from "./weatherDirector";

/** Momentaufnahme von Himmel und Wetter für Debug-API und Prüf-Agenten (Himmelszustand). */
export interface SkyDebugState {
  readonly hours: number;
  readonly phase: SkyPhase;
  readonly sunElevationDeg: number;
  readonly moonElevationDeg: number;
  readonly keyLight: "sun" | "moon";
  readonly keyLightIntensity: number;
  readonly exposureEv: number;
  readonly weather: string;
  readonly weatherBlend: number;
  readonly coverage: number;
  /** Gezeichnete Regenstärke 0..1 (0 bei abgeschaltetem Regen). */
  readonly rainIntensity: number;
  readonly windDirection: readonly [number, number];
  readonly windSpeed: number;
  /** Wolkendichte an der Kamera 0..1 (0 = klare Luft). */
  readonly cameraCloudDensity: number;
  /** Ob gerade ein Blitz läuft. */
  readonly lightningActive: boolean;
  /** Blitze seit dem Start. */
  readonly lightningStrikes: number;
  /** Wirksame Stärke der Sonnen- bzw. Mondstrahlen im Bild (0 = keine). */
  readonly shaftIntensity: number;
  /** Stärke des Regenbogens 0..1 (0 = keiner). */
  readonly rainbowIntensity: number;
}

/** Nebelquellen der Welt: liefert Inseln in Kameranähe (Nebelquelle). */
export type MistSource = (cameraPosition: Vector3, amount: number) => readonly MistVolume[];

export type { CloudClearing, ThunderListener };

const MoonTint = new Color3(0.62, 0.74, 1.0);
/**
 * Übergabe des Hauptlichts: Die Sonne blendet zwischen −8° und −12,5° Sonnenhöhe aus, bei −12° wechselt das Licht
 * zum Mond, der bis −13,5° voll einblendet. Am Wechsel sind beide Lichter etwa gleich schwach, nie beide aus.
 */
const SunFadeStart = -8;
const SunFadeEnd = -12.5;
const HandoffElevation = -12;
const MoonFadeStart = -11;
const MoonFadeEnd = -13.5;
/** Hauptlicht des Vollmonds relativ zur Sonne (π). */
const MoonKeyIntensity = 0.1;
/** Nachts: Untergrenze des Himmelslichts auf Wolken (dunkles Nachtblau, linear) und Zusatzlicht auf Inseln. */
const NightAmbientFloor = Color3.FromHexString("#1C2D57").toLinearSpace();
const NightIslandIrradiance = 0.15;
/** Aufhelllicht von unten (Wolkenmeer) auf Inseln: Stärke am Tag und in der Nacht. */
const FillDayIntensity = 0.3;
const FillNightIntensity = 0.03;
const WindDirection = new Vector3(0.82, 0, 0.57).normalize();
/**
 * Mondstrahlen: Als Hauptlicht ist der Mond sehr schwach, die Nacht wird über die Belichtung lesbar. Die Strahlen
 * gehen vom hellen Mondhof aus und bekommen dafür eine eigene Anhebung; sie bleiben deutlich schwächer als
 * Sonnenstrahlen.
 */
const MoonShaftBoost = 8;
const MoonShaftFactor = 0.7;
/** Weiter Hof der Strahlenquelle: um die Sonne breit, um den Mond schmal (der Nachthimmel bleibt dunkel). */
const SunShaftHalo = 0.3;
const MoonShaftHalo = 0.1;
/** Winkelbreite der hellen Strahlenquelle (rad): die Sonne mit breitem Schein, der Mond eng um seine Scheibe. */
const SunShaftCore = (6 * Math.PI) / 180;
const MoonShaftCore = (2.5 * Math.PI) / 180;
/** Flug durch Wolken: Sättigung (Prozentpunkte) bei voller Dichte an der Kamera; die Belichtung bleibt. */
const InCloudDesaturation = 20;
/** Umgebungslicht der Wolken: Stärke im Shader. */
const CloudAmbientStrength = 2.0;
/** Anhebung der Himmelsstrahlung: Das Blau zwischen den Wolken soll leuchten, auch in der Höhe der Spielwelt. */
const SkyRadianceBoost = 3.4;
/** Gewitter-Tönung: Schiefergrau für Licht, Schatten und Dunst; Farbkorrektur zu kühlen Tönen. */
const CoolTintColor = Color3.FromHexString("#7A8496").toLinearSpace();
const CoolHighlightsHue = 215;
const CoolShadowsHue = 228;
/** Dichte an der Kamera, ab der die Bildschirm-Strahlen ausgeblendet sind (im Medium übernimmt der Raymarcher). */
const ShaftMediumFadeStart = 0.05;
const ShaftMediumFadeEnd = 0.5;
/** Blitzlicht auf den Regentropfen. */
const RainFlashScale = 3;
/** Belichtungsstoß der Blitze am Tag (Anteil); nachts wirkt er voll, weil die Szene dunkel ist. */
const DayFlashFactor = 0.5;

/**
 * Himmel und Wetter (Himmelssystem): Uhr → Himmelsmechanik → Farbskript → Wetter → Blitze → Hauptlicht,
 * Belichtung und Farbkorrektur → Wolken, Dichte an der Kamera, Lichtstrahlen, Regen und Himmelskörper.
 * Läuft einmal je Frame vor dem Rendern.
 */
export class SkySystem implements FrameSystem, LightningTarget {
  public readonly clock: SkyClock;
  public readonly weather = new WeatherDirector();
  public readonly celestial = new CelestialRig();
  private readonly rainbow = new RainbowDirector();
  private readonly keyframes = new SkyKeyframes();
  private readonly scene: Scene;
  private readonly camera: Camera;
  private readonly lighting: OutdoorLighting;
  private readonly bodies: CelestialBodies;
  private clouds: CloudRenderer | undefined;
  private densityField: CloudDensityField | undefined;
  private densityProbe: CloudDensityProbe | undefined;
  private readonly depthRenderer: DepthRenderer;
  private readonly shafts: LightShafts;
  private readonly rain: RainSystem;
  private readonly farRain: RainSystem;
  private readonly lightning: LightningDirector;
  private quality: QualitySettings;
  private mistSource: MistSource | undefined;
  private keyIsMoon = false;
  private exposureEv = 0;
  private hazeEnabled = true;
  private mistEnabled = true;
  private cloudDensityAtCamera = 0;
  private shadowsEnabled = true;
  private clearings: readonly CloudClearing[] = [];
  private readonly nearClearings: CloudClearing[] = [];
  private readonly lightningState = { x: 0, y: 0, z: 0, intensity: 0 };
  private lightningFlashEv = 0;
  private readonly moonTintObserver: Observer<Camera>;
  private readonly lightColor = new Color3();
  private readonly ambientTop = new Color3();
  private readonly ambientBottom = new Color3();
  private readonly hazeColor = new Color3();
  private readonly sunColor = new Color3();
  private readonly shaftColor = new Color3();
  private readonly rainFlash = new Color3();
  private readonly coolFactor = new Color3(1, 1, 1);
  private readonly lightningColor = new Color3(0.75, 0.82, 1.0);
  private readonly up = new Vector3(0, 1, 0);
  private readonly down = new Vector3(0, -1, 0);
  private readonly toLight = new Vector3(0, 1, 0);
  private readonly wind = new Vector3();
  private readonly massOffset = new Vector3();
  private readonly shapeOffset = new Vector3();

  public constructor(scene: Scene, camera: Camera, lighting: OutdoorLighting, quality: QualitySettings, worldSeconds: () => number) {
    this.scene = scene;
    this.camera = camera;
    this.lighting = lighting;
    this.quality = quality;
    this.clock = new SkyClock(worldSeconds);
    this.bodies = new CelestialBodies(scene);
    // Kameraraum-Z, 32 bit, 0 = kein Objekt (Himmel)
    this.depthRenderer = scene.enableDepthRenderer(camera, false, true, undefined, true);
    this.depthRenderer.getDepthMap().updateSamplingMode(1); // NEAREST
    // Mondlicht kühl auf Materialien; der Himmel behält seine physikalische Farbe.
    this.moonTintObserver = lighting.atmosphere.onAfterUpdateVariablesForCameraObservable.add(() => {
      if (this.keyIsMoon) {
        this.lighting.keyLight.diffuse.multiplyInPlace(MoonTint);
        this.lighting.keyLight.specular.multiplyInPlace(MoonTint);
      }
    });
    this.shafts = new LightShafts(scene, camera, lighting.pipeline, this.depthRenderer.getDepthMap(), () => this.cloudTransmittanceTexture(), this.shaftQuality(quality));
    this.rain = new RainSystem(scene, camera, quality.rainDrops, NearRainLayer);
    this.farRain = new RainSystem(scene, camera, quality.rainDrops, FarRainLayer);
    this.lightning = new LightningDirector(scene, camera, this, WorldSeed ^ 0x1f1a);
  }

  /** Startet die Volumenwolken und die CPU-Dichtefunktion, sobald die Rauschdaten aus dem Worker da sind. */
  public attachClouds(noise: CloudNoiseData): void {
    this.clouds?.dispose();
    this.clouds = new CloudRenderer(this.scene, this.camera, this.depthRenderer.getDepthMap(), noise, this.cloudQuality(this.quality));
    this.densityField = new CloudDensityField(noise);
    this.densityProbe = new CloudDensityProbe(this.densityField);
    this.lightning.setDensityField(this.densityField);
  }

  public setMistSource(source: MistSource): void {
    this.mistSource = source;
  }

  /** Wolkenfreie Lichtungen (um Nester und Stöcke); je Frame gehen die nächsten an Raymarcher und Dichtefeld. */
  public setClearings(clearings: readonly CloudClearing[]): void {
    this.clearings = [...clearings];
  }

  /** Effektschalter Schatten: Das Hauptlicht wirft Schatten nur, solange er an ist. */
  public setShadowsEnabled(enabled: boolean): void {
    this.shadowsEnabled = enabled;
  }

  /** Berechnet Sonnen- und Mondstand sofort aus der Uhr, etwa nach einem Zeitsprung der Debug-API. */
  public syncCelestial(): void {
    this.celestial.update(this.clock.hours, this.clock.day);
  }

  public setServerWeather(override: WeatherOverride | undefined): void {
    this.weather.setServerOverride(override);
  }

  /** Blitz für die Wolkenbeleuchtung und den Belichtungsstoß (Blitzsystem). */
  public setLightning(x: number, y: number, z: number, intensity: number, flashEv: number): void {
    this.lightningState.x = x;
    this.lightningState.y = y;
    this.lightningState.z = z;
    this.lightningState.intensity = intensity;
    this.lightningFlashEv = flashEv;
  }

  /** Meldet jeden Blitz mit Ort und Stärke (0..1); undefined meldet ab. Der Donner folgt verzögert nach Entfernung. */
  public setThunderListener(listener: ThunderListener | undefined): void {
    this.lightning.setThunderListener(listener);
  }

  /** Option „Blitze reduzieren“: dämpft Belichtungsstoß, Kanal und Flackern der Blitze. */
  public setReduceFlashes(reduce: boolean): void {
    this.lightning.setReduceFlashes(reduce);
  }

  /** Löst sofort einen Blitz mit sichtbarem Kanal aus (Prüfungen und Vorführung). */
  public triggerLightning(): void {
    this.lightning.trigger();
  }

  /** Lässt sofort einen Regenbogen einblenden (Prüfungen und Vorführung); er braucht die Sonne über dem Horizont. */
  public triggerRainbow(): void {
    this.rainbow.trigger();
  }

  public applyQuality(quality: QualitySettings): void {
    this.quality = quality;
    this.clouds?.applyQuality(this.cloudQuality(quality));
    this.shafts.applyQuality(this.shaftQuality(quality));
    this.rain.setDropCount(quality.rainDrops);
    this.farRain.setDropCount(quality.rainDrops);
  }

  private cloudQuality(quality: QualitySettings) {
    return { downscale: quality.cloudDownscale, steps: quality.cloudSteps, lightSamples: quality.cloudLightSamples, temporal: quality.cloudTemporal };
  }

  private shaftQuality(quality: QualitySettings) {
    return { samples: quality.shaftSamples, msaaSamples: quality.msaaSamples };
  }

  /** Wolkentextur des Frames für die Strahlenmaske, solange die Wolken laufen. */
  private cloudTransmittanceTexture() {
    const clouds = this.clouds;
    return clouds !== undefined && clouds.isEnabled ? clouds.cloudTexture : undefined;
  }

  public get keyLightIsMoon(): boolean {
    return this.keyIsMoon;
  }

  public get cloudRenderer(): CloudRenderer | undefined {
    return this.clouds;
  }

  public get sunMesh() {
    return this.bodies.sun;
  }

  /** Effekte für die Debug-API. */
  public setEffect(name: string, enabled: boolean): boolean {
    switch (name) {
      case "clouds":
        this.clouds?.setEnabled(enabled);
        return true;
      case "cloudTemporal":
        this.clouds?.setTemporal(enabled);
        return true;
      case "stars":
        this.bodies.setStarsEnabled(enabled);
        return true;
      case "haze":
        this.hazeEnabled = enabled;
        return true;
      case "mist":
        this.mistEnabled = enabled;
        return true;
      case "lightShafts":
        this.shafts.setEnabled(enabled);
        return true;
      case "rain":
        this.rain.setEnabled(enabled);
        this.farRain.setEnabled(enabled);
        return true;
      case "lightning":
        this.lightning.setEnabled(enabled);
        return true;
      case "rainbow":
        this.rainbow.setEnabled(enabled);
        return true;
      default:
        return false;
    }
  }

  /** Wolkendichte an der Kamera (für Flug-im-Wolken-Effekte); die Dichtesonde setzt sie je Frame. */
  public setCameraCloudDensity(density: number): void {
    this.cloudDensityAtCamera = density;
  }

  /** Wolkendichte an einem Weltpunkt (CPU, gleiche Formel wie der Shader); 0, solange das Rauschen fehlt. */
  public cloudDensityAt(position: Vector3): number {
    const field = this.densityField;
    return field !== undefined && field.isReady ? field.density(position.x, position.y, position.z) : 0;
  }

  /** Geglättete Wolkendichte an der Kamera 0..1 (0 = klare Luft, 1 = Wolkenkern). */
  public get cameraCloudDensity(): number {
    return this.cloudDensityAtCamera;
  }

  public get look() {
    return this.keyframes.look;
  }

  public frameUpdate(dt: number): void {
    const worldSeconds = this.clock.worldSeconds;
    const hours = this.clock.hours;
    const celestial = this.celestial;
    celestial.update(hours, this.clock.day);
    const look = this.keyframes.evaluate(celestial.sunElevationDeg, celestial.rising);
    this.weather.update(worldSeconds);
    const weather = this.weather.blended;
    this.lightning.update(dt, weather.lightningPerMinute);
    this.rainbow.update(dt, this.weather.state, celestial.sunElevationDeg);

    // Hauptlicht: Übergabe Sonne → Mond bei −12°, beide Seiten dort schwach, aber nie beide aus.
    const light = this.lighting.keyLight;
    const sunElevation = celestial.sunElevationDeg;
    if (sunElevation > HandoffElevation) {
      celestial.toSun.negateToRef(light.direction);
      light.intensity = Math.PI * smoothstep(SunFadeEnd, SunFadeStart, sunElevation) * weather.keyLightFactor;
      this.keyIsMoon = false;
      this.toLight.copyFrom(celestial.toSun);
    } else {
      celestial.toMoon.negateToRef(light.direction);
      const fadeIn = 1 - smoothstep(MoonFadeEnd, MoonFadeStart, sunElevation);
      light.intensity = Math.PI * MoonKeyIntensity * celestial.moonBrightness * fadeIn * Math.max(0.35, weather.keyLightFactor);
      this.keyIsMoon = true;
      this.toLight.copyFrom(celestial.toMoon);
    }
    light.shadowEnabled = this.shadowsEnabled && light.intensity > 0.03 * Math.PI * MoonKeyIntensity && this.toLight.y > 0.02;

    // Belichtung und Farbkorrektur nach Farbskript, Wetter und Blitz
    const nightFactor = 1 - smoothstep(-14, -4, sunElevation);
    const inCloud = this.cloudDensityAtCamera;
    const flashEv = this.lightningFlashEv * (DayFlashFactor + (1 - DayFlashFactor) * nightFactor);
    this.exposureEv = look.exposureEv + weather.exposureEv + flashEv;
    this.scene.imageProcessingConfiguration.exposure = Math.pow(2, this.exposureEv);
    // Leichte Anhebung nur der Himmelsstrahlung: das Blau zwischen den Wolken soll leuchten.
    this.lighting.atmosphere.exposure = look.atmosphereExposure * SkyRadianceBoost;
    // Kühle Wetter-Tönung; nachts ist das Farbskript schon blau und bekommt nur einen Teil davon
    const cool = weather.coolTint * (1 - 0.6 * nightFactor);
    applyGrading(
      this.lighting.curves,
      look.saturation + weather.saturationDelta - inCloud * InCloudDesaturation,
      lerpHue(look.highlightsHue, CoolHighlightsHue, cool),
      look.highlightsDensity + 15 * cool,
      lerpHue(look.shadowsHue, CoolShadowsHue, cool),
      look.shadowsDensity + 30 * cool,
    );

    // Dämmerungsboden: ab Sonnenuntergang (Sonne unter dem Horizont) tragen Nachtblau und Inselaufhellung die Szene
    const twilightFactor = 1 - smoothstep(-6, 2, sunElevation);
    this.updateLightColors(look, weather, twilightFactor);
    this.updateIslandLight(twilightFactor, weather);
    this.updateClouds(look, weather, worldSeconds, dt);
    this.updateShafts(look, weather);
    this.updateRain(dt, weather);
    this.updateBodies(worldSeconds, nightFactor);
  }

  /** Licht der Wolken und Tropfen: Hauptlicht, Himmelslicht von oben und unten, Dunstfarbe. */
  private updateLightColors(look: SkyLook, weather: WeatherPreset, twilightFactor: number): void {
    const light = this.lighting.keyLight;
    const atmosphere = this.lighting.atmosphere;
    const cameraY = this.camera.globalPosition.y;
    // Farbe und Stärke des Hauptlichts, leicht nach Farbskript getönt.
    this.lightColor.copyFrom(light.diffuse).scaleInPlace(light.intensity * 0.95);
    Color3.LerpToRef(Color3.White(), look.cloudTint, 0.45, this.sunColor);
    this.lightColor.multiplyInPlace(this.sunColor);
    // Himmelslicht von oben und unten aus der Atmosphäre; Höhe über dem Atmosphärenboden wie im Addon.
    const radiusKm = 6360 + AtmosphereOriginHeightKm + cameraY / 1000;
    atmosphere.getDiffuseSkyIrradianceToRef(this.toLight, radiusKm, this.up, light.intensity, this.ambientTop);
    atmosphere.getDiffuseSkyIrradianceToRef(this.toLight, radiusKm, this.down, light.intensity, this.ambientBottom);
    // Schattenseiten: blaues Himmelslicht von oben nach der Schattenfarbe des Farbskripts (blau mittags, lavendel
    // am Morgen); von unten ein schwaches, ebenso getöntes Streulicht der beschienenen Wolken darunter.
    Color3.LerpToRef(this.ambientTop, this.ambientTop.multiply(look.cloudShadowTint).scaleInPlace(1.8), 0.8, this.ambientTop);
    const bounce = (0.05 + Math.max(0, this.toLight.y) * 0.08) * 1.6;
    this.ambientBottom.scaleInPlace(0.2).addInPlace(this.lightColor.multiply(look.cloudShadowTint).scaleInPlace(bounce));
    // Nachts bleibt ein dunkles Nachtblau, damit Wolken vor dem schwarzen Himmel lesbar bleiben.
    this.ambientTop.r = Math.max(this.ambientTop.r, NightAmbientFloor.r * twilightFactor);
    this.ambientTop.g = Math.max(this.ambientTop.g, NightAmbientFloor.g * twilightFactor);
    this.ambientTop.b = Math.max(this.ambientTop.b, NightAmbientFloor.b * twilightFactor);
    // Gewitter und trübes Wetter: Licht und Schatten kühl blaugrau (helligkeitserhaltend)
    const luminance = 0.2126 * CoolTintColor.r + 0.7152 * CoolTintColor.g + 0.0722 * CoolTintColor.b;
    Color3.LerpToRef(Color3.White(), CoolTintColor.scale(1 / luminance), weather.coolTint * (1 - 0.6 * twilightFactor), this.coolFactor);
    this.lightColor.multiplyInPlace(this.coolFactor);
    this.ambientTop.multiplyInPlace(this.coolFactor);
    this.ambientBottom.multiplyInPlace(this.coolFactor);
    // Dunst: Farbskript, bei grauem Wetter entsättigt
    const gray = look.hazeColor.r * 0.3 + look.hazeColor.g * 0.59 + look.hazeColor.b * 0.11;
    Color3.LerpToRef(look.hazeColor, new Color3(gray, gray, gray), weather.hazeGray, this.hazeColor);
    this.hazeColor.scaleInPlace(Math.max(0.05, Math.min(1.2, light.intensity / Math.PI + 0.12))).multiplyInPlace(this.coolFactor);
  }

  /** Licht der Inseln neben dem Hauptlicht: Aufhellung von unten am Tag, nachts ein schwaches Nachtblau. */
  private updateIslandLight(twilightFactor: number, weather: WeatherPreset): void {
    this.lighting.fill.intensity = mix(FillDayIntensity * weather.keyLightFactor, FillNightIntensity, twilightFactor);
    const atmosphere = this.lighting.atmosphere;
    atmosphere.additionalDiffuseSkyIrradianceColor = NightAmbientFloor;
    atmosphere.additionalDiffuseSkyIrradianceIntensity = NightIslandIrradiance * twilightFactor;
  }

  private updateClouds(look: SkyLook, weather: WeatherPreset, worldSeconds: number, dt: number): void {
    const hazeDistance = this.hazeEnabled ? Math.max(1800, 5.8 / Math.max(look.hazeDensity * weather.hazeFactor, 1e-5)) : 1e9;
    const hazeStrength = this.hazeEnabled ? 0.7 : 0;
    this.lightning.setHaze(hazeDistance, hazeStrength);
    const clouds = this.clouds;
    if (clouds === undefined) {
      return;
    }
    // Drift mit dem Wind: Massen langsam (Wolkenfelder ziehen), Form schneller (Wolken verändern sich).
    const massTile = CloudMedium.massTileMeters;
    const shapeTile = CloudMedium.shapeTileMeters;
    this.massOffset.set(((WindDirection.x * worldSeconds * 3.0) / massTile) % 1, ((worldSeconds * 0.15) / massTile) % 1, ((WindDirection.z * worldSeconds * 3.0) / massTile) % 1);
    this.shapeOffset.set((WindDirection.x * worldSeconds * 4.5) % shapeTile, (worldSeconds * 0.6) % shapeTile, (WindDirection.z * worldSeconds * 4.5) % shapeTile);
    const mistAmount = this.mistEnabled ? look.mistAmount * weather.mistFactor : 0;
    const mist = mistAmount > 0.02 && this.mistSource ? this.mistSource(this.camera.globalPosition, mistAmount) : [];
    this.selectNearClearings();

    const params: CloudFrameParams = {
      toLight: this.toLight,
      lightColor: this.lightColor,
      ambientTop: this.ambientTop,
      ambientBottom: this.ambientBottom,
      coverage: weather.coverage,
      density: CloudMedium.density,
      massTile,
      verticalSquash: CloudMedium.verticalSquash,
      erosion: CloudMedium.erosion,
      depthBias: CloudMedium.depthBias,
      ambientStrength: CloudAmbientStrength,
      rainDarkening: 0.4 * weather.rain,
      stormCoverage: weather.stormCoverage,
      stormDensityBoost: CloudMedium.stormDensityBoost,
      rain: weather.rain,
      massOffset: this.massOffset,
      shapeOffset: this.shapeOffset,
      hazeColor: this.hazeColor,
      hazeDistance,
      hazeStrength,
      worldRadius: WorldRadius,
      boundaryRamp: CloudMedium.boundaryRamp,
      boundaryDensity: CloudMedium.boundaryDensity,
      topOpenness: CloudMedium.topOpenness,
      renderDistance: CloudMedium.renderDistance,
      mist,
      clearings: this.nearClearings,
      lightning: this.lightningState,
      lightningColor: this.lightningColor,
      rainbow: this.keyIsMoon ? 0 : this.rainbow.intensity,
      opacity: 1,
    };
    clouds.setFrameParams(params);
    // Dieselben Frame-Werte für die CPU-Dichtefunktion: Sonde, Blitzsuche und Kanal-Sichtbarkeit sehen dieselbe Wolke.
    this.densityField?.setFrame(params);
    const probe = this.densityProbe;
    if (probe !== undefined) {
      probe.update(dt, this.camera.globalPosition);
      this.setCameraCloudDensity(probe.density);
    }
  }

  /** Wählt die Lichtungen, die den sichtbaren Wolkenraum berühren, nächste zuerst (höchstens `ClearingCount`). */
  private selectNearClearings(): void {
    const camera = this.camera.globalPosition;
    const reach = CloudMedium.renderDistance;
    const near = this.nearClearings;
    near.length = 0;
    for (const clearing of this.clearings) {
      const distance = Math.hypot(clearing.x - camera.x, clearing.y - camera.y, clearing.z - camera.z);
      if (distance < reach + clearing.radius) {
        near.push(clearing);
      }
    }
    near.sort((a, b) => Math.hypot(a.x - camera.x, a.y - camera.y, a.z - camera.z) - Math.hypot(b.x - camera.x, b.y - camera.y, b.z - camera.z));
    near.length = Math.min(near.length, ClearingCount);
  }

  /** Sonnen- bzw. Mondstrahlen: Stärke nach Farbskript × Wetter, ausgeblendet im Medium an der Kamera. */
  private updateShafts(look: SkyLook, weather: WeatherPreset): void {
    const light = this.lighting.keyLight;
    const medium = 1 - smoothstep(ShaftMediumFadeStart, ShaftMediumFadeEnd, this.cloudDensityAtCamera);
    const strength = look.shaftStrength * weather.shaftFactor * medium * (this.keyIsMoon ? MoonShaftFactor : 1);
    // Farbe des Hauptlichts; nachts mit der kühlen Mondtönung des Hauptlichts
    this.shaftColor.copyFrom(light.diffuse).scaleInPlace(light.intensity * (this.keyIsMoon ? MoonShaftBoost : 1));
    this.shafts.setFrame({
      toLight: this.toLight,
      lightColor: this.shaftColor,
      strength,
      length: Math.min(1, look.shaftStrength),
      haloWeight: this.keyIsMoon ? MoonShaftHalo : SunShaftHalo,
      coreAngle: this.keyIsMoon ? MoonShaftCore : SunShaftCore,
    });
  }

  private updateRain(dt: number, weather: WeatherPreset): void {
    WindDirection.scaleToRef(weather.wind, this.wind);
    this.lightningColor.scaleToRef(this.lightning.flashLevel * RainFlashScale, this.rainFlash);
    const frame = { intensity: weather.rain, wind: this.wind, ambient: this.ambientTop, lightColor: this.lightColor, toLight: this.toLight, flash: this.rainFlash };
    this.rain.update(dt, frame);
    this.farRain.update(dt, frame);
  }

  private updateBodies(worldSeconds: number, nightFactor: number): void {
    const celestial = this.celestial;
    this.bodies.update({
      toSun: celestial.toSun,
      toMoon: celestial.toMoon,
      sunColor: Color3.White(),
      sunIntensity: 60,
      moonIntensity: 0.9 * nightFactor + 0.15,
      moonGlow: 0.25 * nightFactor * celestial.moonBrightness * (1 - this.weather.blended.coverage * 0.5),
      moonPhase: celestial.moonPhase,
      starIntensity: nightFactor * (1 - this.weather.blended.coverage * 0.6),
      starRotation: celestial.starRotation,
      time: worldSeconds,
    });
  }

  /** Zustand für Debug-API und Prüf-Agenten. */
  public debugState(): SkyDebugState {
    const weather = this.weather.blended;
    return {
      hours: this.clock.hours,
      phase: this.keyframes.look.phase,
      sunElevationDeg: this.celestial.sunElevationDeg,
      moonElevationDeg: this.celestial.moonElevationDeg,
      keyLight: this.keyIsMoon ? "moon" : "sun",
      keyLightIntensity: this.lighting.keyLight.intensity,
      exposureEv: this.exposureEv,
      weather: this.weather.label,
      weatherBlend: this.weather.state.blend,
      coverage: weather.coverage,
      rainIntensity: this.rain.intensity,
      windDirection: [WindDirection.x, WindDirection.z],
      windSpeed: weather.wind,
      cameraCloudDensity: this.cloudDensityAtCamera,
      lightningActive: this.lightning.isActive,
      lightningStrikes: this.lightning.strikeCount,
      shaftIntensity: this.shafts.intensity,
      rainbowIntensity: this.keyIsMoon ? 0 : this.rainbow.intensity,
    };
  }

  public dispose(): void {
    this.lighting.atmosphere.onAfterUpdateVariablesForCameraObservable.remove(this.moonTintObserver);
    this.lightning.dispose();
    this.rain.dispose();
    this.farRain.dispose();
    this.shafts.dispose();
    this.clouds?.dispose();
    this.bodies.dispose();
  }
}
