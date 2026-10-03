import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { EffectRenderer, EffectWrapper } from "@babylonjs/core/Materials/effectRenderer";
import type { Effect } from "@babylonjs/core/Materials/effect";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { RawTexture3D } from "@babylonjs/core/Materials/Textures/rawTexture3D";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { RenderingGroupInfo } from "@babylonjs/core/Rendering/renderingManager";
import { CameraRenderScope } from "./cameraRenderScope";
import { CloudMedium, cloudMediumDefines } from "./cloudMedium";
import { DetailSize, ShapeSize, WeatherSize, type CloudNoiseData } from "./noise/cloudNoiseData";
import { CloudCompositeFragmentShader } from "./shaders/cloudComposite";
import { CloudMarchFragmentShader } from "./shaders/cloudMarch";
import { CloudResolveFragmentShader } from "./shaders/cloudResolve";
import { rotationViewProjectionToRef } from "./skyMath";
import { bindSkyPassView, createSkyPass, createSkyPassRenderer } from "./skyPass";

/** Höchstzahl der Nebelvolumen an Inseln im Shader. */
export const MistVolumeCount = 16;
/** Höchstzahl der Lichtungen (um Nester und Stöcke) im Shader; die SkySystem-Auswahl nimmt die nächsten. */
export const ClearingCount = 8;
/** Lichtproben im günstigen Lichtweg (dünnes Medium, weitgehend verdeckter Strahl). */
const CheapLightSamples = 2;
/** Zusätzliche Verkleinerung der Wolkentextur, solange die Kamera im dichten Wolkenmedium steckt. */
const InsideMediumDownscale = 1.5;

/** Eine wolkenfreie Lichtung (Kugel mit weichem Rand) um ein Nest oder einen Stock (Lichtung). */
export interface CloudClearing {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
}

/** Ein Nebelvolumen (flaches Ellipsoid) für den Raymarcher (Nebelvolumen). */
export interface MistVolume {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly density: number;
  readonly softness: number;
  /** Stauchung in y: > 1 macht das Volumen flacher. */
  readonly flatten: number;
}

/** Alle pro Frame veränderlichen Parameter des Wolkenmediums und seiner Beleuchtung (Wolkenzustand). */
export interface CloudFrameParams {
  readonly toLight: Vector3;
  readonly lightColor: Color3;
  readonly ambientTop: Color3;
  readonly ambientBottom: Color3;
  /** Grundbedeckung 0..1 der Wolkenmassen. */
  readonly coverage: number;
  readonly density: number;
  /** Kachelgröße der großräumigen Wolkenmassen in Metern. */
  readonly massTile: number;
  /** Stauchung in y: > 1 macht Wolkenmassen breiter als hoch. */
  readonly verticalSquash: number;
  readonly erosion: number;
  /** Zusätzliche Bedeckung je 7 km Tiefe unter dem Mittelpunkt. */
  readonly depthBias: number;
  readonly ambientStrength: number;
  readonly rainDarkening: number;
  readonly stormCoverage: number;
  readonly stormDensityBoost: number;
  readonly rain: number;
  /** Drift der Wolkenmassen in Kacheleinheiten. */
  readonly massOffset: Vector3;
  /** Drift von Form- und Detailrauschen in Metern. */
  readonly shapeOffset: Vector3;
  readonly hazeColor: Color3;
  readonly hazeDistance: number;
  readonly hazeStrength: number;
  readonly worldRadius: number;
  /** Breite der Verdichtungszone vor dem Kugelrand in Metern. */
  readonly boundaryRamp: number;
  readonly boundaryDensity: number;
  /** Wie offen die Wolkenhülle nach oben ist (0 = geschlossen, 1 = viele Lücken). */
  readonly topOpenness: number;
  readonly renderDistance: number;
  readonly mist: readonly MistVolume[];
  /** Lichtungen nahe der Kamera, höchstens `ClearingCount`. */
  readonly clearings: readonly CloudClearing[];
  readonly lightning: { readonly x: number; readonly y: number; readonly z: number; readonly intensity: number };
  readonly lightningColor: Color3;
  /** Stärke des Regenbogens 0..1 (0 = keiner). */
  readonly rainbow: number;
  readonly opacity: number;
}

/** Feste Einstellungen des Renderers aus der Qualitätsstufe (Wolkenqualität). */
export interface CloudQuality {
  readonly downscale: number;
  readonly steps: number;
  readonly lightSamples: number;
  readonly temporal: boolean;
}

/**
 * Volumetrische Wolken (Wolkenrenderer): Raymarch in reduzierter Auflösung nach den Render-Targets der
 * Kamera, zeitliche Glättung, tiefenbewusster Compositor direkt nach Rendering-Gruppe 0 — nach dem
 * Himmels-Compositor der Atmosphäre, vor Wasser, Regen und Partikeln (Gruppe 1).
 */
export class CloudRenderer {
  private readonly scene: Scene;
  private readonly engine: AbstractEngine;
  private readonly camera: Camera;
  private readonly depthMap: RenderTargetTexture;
  private readonly effectRenderer: EffectRenderer;
  private readonly shape: RawTexture3D;
  private readonly detail: RawTexture3D;
  private readonly weather: RawTexture;
  private quality: CloudQuality;
  private marchWrapper: EffectWrapper;
  private readonly resolveWrapper: EffectWrapper;
  private readonly compositeWrapper: EffectWrapper;
  private current: RenderTargetTexture | undefined;
  private history: [RenderTargetTexture, RenderTargetTexture] | undefined;
  private historyIndex = 0;
  private historyValid = false;
  private params: CloudFrameParams | undefined;
  private frameIndex = 0;
  private readonly cameraScope: CameraRenderScope;
  private enabled = true;
  private temporalEnabled = true;
  private insideMedium = false;
  private readonly matrixScratch = new Matrix();
  private readonly viewProjectionNoTranslation = new Matrix();
  private readonly inverseViewProjection = new Matrix();
  private readonly previousViewProjection = new Matrix();
  private readonly forward = new Vector3();
  private readonly lastCameraPosition = new Vector3();
  private readonly mistSpheres = new Float32Array(MistVolumeCount * 4);
  private readonly mistData = new Float32Array(MistVolumeCount * 4);
  private readonly clearingSpheres = new Float32Array(ClearingCount * 4);
  private readonly observers: Array<{ remove(): void }> = [];

  public constructor(scene: Scene, camera: Camera, depthMap: RenderTargetTexture, noise: CloudNoiseData, quality: CloudQuality) {
    this.scene = scene;
    this.engine = scene.getEngine();
    this.camera = camera;
    this.depthMap = depthMap;
    this.quality = quality;
    this.effectRenderer = createSkyPassRenderer(this.engine);
    this.shape = CloudRenderer.createVolume(noise.shape, ShapeSize, scene);
    this.detail = CloudRenderer.createVolume(noise.detail, DetailSize, scene);
    this.weather = new RawTexture(noise.weather, WeatherSize, WeatherSize, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
    this.weather.wrapU = Texture.WRAP_ADDRESSMODE;
    this.weather.wrapV = Texture.WRAP_ADDRESSMODE;
    this.marchWrapper = this.createMarchWrapper();
    this.resolveWrapper = this.createWrapper(
      "cloudResolve",
      CloudResolveFragmentShader,
      ["previousViewProjectionNoTranslation", "resolveParams"],
      ["currentSampler", "historySampler"],
      [],
    );
    this.compositeWrapper = this.createWrapper("cloudComposite", CloudCompositeFragmentShader, ["cloudTexel", "cloudOpacity", "cameraForward", "hazeParams", "hazeColor"], ["cloudSampler", "depthSampler"], []);
    this.resolveWrapper.onApplyObservable.add(() => this.bindResolve(this.resolveWrapper.effect));
    this.compositeWrapper.onApplyObservable.add(() => this.bindComposite(this.compositeWrapper.effect));
    this.createTargets();

    this.cameraScope = new CameraRenderScope(scene, camera, () => this.updateMatrices());
    const engineResize = this.engine.onResizeObservable.add(() => this.createTargets());
    // Als erster Beobachter: Spätere Pässe derselben Phase (Lichtstrahlen) lesen die Wolkentextur dieses Frames.
    const afterTargets = scene.onAfterRenderTargetsRenderObservable.add(
      () => {
        if (this.cameraScope.isActive && this.enabled) {
          this.renderClouds();
        }
      },
      undefined,
      true,
    );
    const afterGroup = scene.onAfterRenderingGroupObservable.add((info: RenderingGroupInfo) => {
      if (info.renderingManager === scene.renderingManager && info.renderingGroupId === 0 && this.cameraScope.isActive && this.enabled) {
        this.drawComposite();
      }
    });
    this.observers.push(...([engineResize, afterTargets, afterGroup] as Observer<unknown>[]));
  }

  /** Setzt die Parameter des nächsten Frames. */
  public setFrameParams(params: CloudFrameParams): void {
    this.params = params;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.historyValid = false;
  }

  public get isEnabled(): boolean {
    return this.enabled;
  }

  public setTemporal(enabled: boolean): void {
    this.temporalEnabled = enabled;
    this.historyValid = false;
  }

  /**
   * Kamera im dichten Wolkenmedium: Der Nebel zeigt kaum Detail, die Wolkentextur wird gröber gerechnet
   * (Faktor `InsideMediumDownscale` auf die Verkleinerung der Qualitätsstufe).
   */
  public setInsideMedium(inside: boolean): void {
    if (inside === this.insideMedium) {
      return;
    }
    this.insideMedium = inside;
    this.createTargets();
  }

  /** Wendet eine neue Qualitätsstufe an (neue Zielgrößen und Schrittzahlen). */
  public applyQuality(quality: CloudQuality): void {
    const recompile = quality.steps !== this.quality.steps || quality.lightSamples !== this.quality.lightSamples;
    this.quality = quality;
    if (recompile) {
      this.marchWrapper.dispose();
      this.marchWrapper = this.createMarchWrapper();
    }
    this.createTargets();
  }

  /** Wolkentextur der aktuellen Auflösung (für Lichtstrahlen: Transmission im Alphakanal). */
  public get cloudTexture(): RenderTargetTexture | undefined {
    return this.history?.[this.historyIndex] ?? this.current;
  }

  private static createVolume(data: Uint8Array, size: number, scene: Scene): RawTexture3D {
    const texture = new RawTexture3D(data, size, size, size, Constants.TEXTUREFORMAT_R, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;
    texture.wrapR = Texture.WRAP_ADDRESSMODE;
    return texture;
  }

  private createWrapper(name: string, fragment: string, uniforms: string[], samplers: string[], defines: string[]): EffectWrapper {
    return createSkyPass(this.engine, name, fragment, uniforms, samplers, defines);
  }

  private createMarchWrapper(): EffectWrapper {
    const wrapper = this.createWrapper(
      "cloudMarch",
      CloudMarchFragmentShader,
      [
        "cameraPosition",
        "cameraForward",
        "frameParams",
        "toLight",
        "lightColor",
        "ambientTop",
        "ambientBottom",
        "phaseParams",
        "cloudParams",
        "noiseParams",
        "erosionParams",
        "stormParams",
        "massOffset",
        "shapeOffset",
        "marchParams",
        "lightParams",
        "boundaryParams",
        "hazeParams",
        "hazeColor",
        "mistSpheres",
        "mistData",
        "mistCount",
        "lightningParams",
        "lightningColor",
        "clearings",
        "clearingCount",
        "seaParams",
        "rainbowParams",
      ],
      ["depthSampler", "shapeSampler", "detailSampler", "weatherSampler"],
      [
        `MAX_STEPS ${this.quality.steps}`,
        `LIGHT_SAMPLES ${this.quality.lightSamples}`,
        `CHEAP_LIGHT_SAMPLES ${Math.min(CheapLightSamples, this.quality.lightSamples)}`,
        `MIST_COUNT ${MistVolumeCount}`,
        `CLEARING_COUNT ${ClearingCount}`,
        ...cloudMediumDefines(),
      ],
    );
    wrapper.onApplyObservable.add(() => this.bindMarch(wrapper.effect));
    return wrapper;
  }

  private createTargets(): void {
    this.current?.dispose();
    this.history?.[0].dispose();
    this.history?.[1].dispose();
    const downscale = this.quality.downscale * (this.insideMedium ? InsideMediumDownscale : 1);
    const width = Math.max(16, Math.ceil(this.engine.getRenderWidth() / downscale));
    const height = Math.max(16, Math.ceil(this.engine.getRenderHeight() / downscale));
    const create = (name: string): RenderTargetTexture => {
      const target = new RenderTargetTexture(name, { width, height }, this.scene, {
        generateMipMaps: false,
        generateDepthBuffer: false,
        generateStencilBuffer: false,
        type: Constants.TEXTURETYPE_HALF_FLOAT,
        format: Constants.TEXTUREFORMAT_RGBA,
        samplingMode: Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
      });
      target.wrapU = Texture.CLAMP_ADDRESSMODE;
      target.wrapV = Texture.CLAMP_ADDRESSMODE;
      target.skipInitialClear = true;
      return target;
    };
    this.current = create("cloudCurrent");
    this.history = [create("cloudHistoryA"), create("cloudHistoryB")];
    this.historyValid = false;
  }

  private updateMatrices(): void {
    const camera = this.camera;
    this.previousViewProjection.copyFrom(this.viewProjectionNoTranslation);
    rotationViewProjectionToRef(camera, this.matrixScratch, this.viewProjectionNoTranslation);
    this.viewProjectionNoTranslation.invertToRef(this.inverseViewProjection);
    camera.getDirectionToRef(Vector3.Forward(this.scene.useRightHandedSystem), this.forward);
    const moved = Vector3.Distance(camera.globalPosition, this.lastCameraPosition);
    if (moved > 200) {
      this.historyValid = false; // Sprung (Warp-Ende, Kamerawechsel): kein altes Bild einblenden
    }
    this.lastCameraPosition.copyFrom(camera.globalPosition);
  }

  private bindCommon(effect: Effect): void {
    bindSkyPassView(effect, this.engine, this.inverseViewProjection);
  }

  private bindMarch(effect: Effect): void {
    const params = this.params;
    const target = this.current;
    if (params === undefined || target === undefined) {
      return;
    }
    this.bindCommon(effect);
    const camera = this.camera;
    const size = target.getSize();
    effect.setTexture("depthSampler", this.depthMap);
    effect.setTexture("shapeSampler", this.shape);
    effect.setTexture("detailSampler", this.detail);
    effect.setTexture("weatherSampler", this.weather);
    effect.setVector3("cameraPosition", camera.globalPosition);
    effect.setVector3("cameraForward", this.forward);
    effect.setFloat4("frameParams", this.frameIndex % 1024, performance.now() / 1000, size.width, size.height);
    effect.setVector3("toLight", params.toLight);
    effect.setColor3("lightColor", params.lightColor);
    effect.setColor3("ambientTop", params.ambientTop);
    effect.setColor3("ambientBottom", params.ambientBottom);
    effect.setFloat4("phaseParams", 0.72, -0.22, 0.28, 0.7);
    effect.setFloat4("cloudParams", params.coverage, params.density, params.massTile, params.verticalSquash);
    effect.setFloat4("noiseParams", CloudMedium.shapeTileMeters, CloudMedium.detailTileMeters, CloudMedium.extinctionPerDensity, 0.97);
    effect.setFloat4("erosionParams", params.erosion, params.depthBias, params.ambientStrength, params.rainDarkening);
    effect.setFloat4("stormParams", params.stormCoverage, params.stormDensityBoost, params.rain, CloudMedium.weatherTileMeters);
    effect.setVector3("massOffset", params.massOffset);
    effect.setVector3("shapeOffset", params.shapeOffset);
    effect.setFloat4("marchParams", 0.9, 0.05, params.renderDistance, 0.02);
    effect.setFloat4("lightParams", 4.0, 2.0, 0.85, 0.7);
    effect.setFloat4("boundaryParams", params.worldRadius, params.boundaryRamp, params.boundaryDensity, params.topOpenness);
    effect.setFloat4("hazeParams", params.hazeDistance, params.hazeStrength, params.mist.length > 0 ? 1 : 0, 0);
    effect.setColor3("hazeColor", params.hazeColor);
    const count = Math.min(MistVolumeCount, params.mist.length);
    for (let i = 0; i < MistVolumeCount; i++) {
      const volume = i < count ? params.mist[i] : undefined;
      this.mistSpheres.set([volume?.x ?? 0, volume?.y ?? 0, volume?.z ?? 0, volume?.radius ?? 1], i * 4);
      this.mistData.set([volume?.density ?? 0, volume?.softness ?? 1, volume?.flatten ?? 1, 0], i * 4);
    }
    effect.setArray4("mistSpheres", this.mistSpheres as unknown as number[]);
    effect.setArray4("mistData", this.mistData as unknown as number[]);
    effect.setFloat("mistCount", count);
    effect.setFloat4("lightningParams", params.lightning.x, params.lightning.y, params.lightning.z, params.lightning.intensity);
    effect.setColor3("lightningColor", params.lightningColor);
    const clearingCount = Math.min(ClearingCount, params.clearings.length);
    this.clearingSpheres.fill(0);
    for (let i = 0; i < clearingCount; i++) {
      const clearing = params.clearings[i];
      if (clearing !== undefined) {
        this.clearingSpheres.set([clearing.x, clearing.y, clearing.z, clearing.radius], i * 4);
      }
    }
    effect.setArray4("clearings", this.clearingSpheres as unknown as number[]);
    effect.setFloat("clearingCount", clearingCount);
    // Wolkenmeer: Ebene auf fester Welthöhe, für tief fliegende Kameras mit Mindestabstand darunter
    const seaLevel = Math.min(CloudMedium.seaLevelMeters, camera.globalPosition.y - CloudMedium.seaMinDepthMeters);
    const texelAngle = (2 * Math.tan(camera.fov / 2)) / Math.max(1, size.height);
    effect.setFloat4("seaParams", seaLevel, CloudMedium.seaReliefMeters, texelAngle, 0);
    effect.setFloat4("rainbowParams", params.rainbow, CloudMedium.rainbowCurtainMeters, 0, 0);
  }

  private bindResolve(effect: Effect): void {
    const history = this.history;
    const current = this.current;
    if (history === undefined || current === undefined) {
      return;
    }
    this.bindCommon(effect);
    const size = current.getSize();
    effect.setTexture("currentSampler", current);
    effect.setTexture("historySampler", history[1 - this.historyIndex]);
    effect.setMatrix("previousViewProjectionNoTranslation", this.previousViewProjection);
    const useHistory = this.historyValid && this.temporalEnabled && this.quality.temporal;
    effect.setFloat4("resolveParams", 0.86, useHistory ? 1 : 0, 1 / size.width, 1 / size.height);
  }

  private bindComposite(effect: Effect): void {
    const cloud = this.cloudTexture;
    if (cloud === undefined) {
      return;
    }
    this.bindCommon(effect);
    const size = cloud.getSize();
    effect.setTexture("cloudSampler", cloud);
    effect.setTexture("depthSampler", this.depthMap);
    effect.setFloat4("cloudTexel", 1 / size.width, 1 / size.height, size.width, size.height);
    effect.setFloat("cloudOpacity", this.params?.opacity ?? 1);
    effect.setVector3("cameraForward", this.forward);
    const params = this.params;
    if (params !== undefined) {
      effect.setFloat4("hazeParams", params.hazeDistance, params.hazeStrength, 0, 0);
      effect.setColor3("hazeColor", params.hazeColor);
    }
  }

  private renderClouds(): void {
    const current = this.current;
    const history = this.history;
    if (this.params === undefined || current === undefined || history === undefined || !this.marchWrapper.effect.isReady() || !this.resolveWrapper.effect.isReady()) {
      return;
    }
    this.frameIndex++;
    this.effectRenderer.render(this.marchWrapper, current);
    this.historyIndex = 1 - this.historyIndex;
    this.effectRenderer.render(this.resolveWrapper, history[this.historyIndex]);
    this.historyValid = true;
  }

  private drawComposite(): void {
    const engine = this.engine;
    const wrapper = this.compositeWrapper;
    if (!wrapper.effect.isReady() || this.cloudTexture === undefined || this.params === undefined) {
      return;
    }
    const renderer = this.effectRenderer;
    renderer.saveStates();
    const depthWrite = engine.getDepthWrite();
    const alphaMode = engine.getAlphaMode();
    engine.setDepthWrite(false);
    engine.setAlphaMode(Constants.ALPHA_PREMULTIPLIED_PORTERDUFF, true);
    renderer.setViewport();
    renderer.applyEffectWrapper(wrapper, false);
    renderer.draw();
    engine.setAlphaMode(alphaMode, true);
    engine.setDepthWrite(depthWrite);
    renderer.restoreStates();
  }

  public dispose(): void {
    for (const observer of this.observers) {
      observer.remove();
    }
    this.cameraScope.dispose();
    this.marchWrapper.dispose();
    this.resolveWrapper.dispose();
    this.compositeWrapper.dispose();
    this.effectRenderer.dispose();
    this.current?.dispose();
    this.history?.[0].dispose();
    this.history?.[1].dispose();
    this.shape.dispose();
    this.detail.dispose();
    this.weather.dispose();
  }
}
