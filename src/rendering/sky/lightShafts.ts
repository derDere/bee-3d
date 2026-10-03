import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Constants } from "@babylonjs/core/Engines/constants";
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore";
import type { Effect } from "@babylonjs/core/Materials/effect";
import type { EffectRenderer, EffectWrapper } from "@babylonjs/core/Materials/effectRenderer";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { RenderTargetTexture } from "@babylonjs/core/Materials/Textures/renderTargetTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, type Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Observer } from "@babylonjs/core/Misc/observable";
import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess";
import type { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import type { Scene } from "@babylonjs/core/scene";
import { CameraRenderScope } from "./cameraRenderScope";
import { ShaftCompositeFragmentShader, ShaftCompositeShaderName, ShaftGatherFragmentShader, ShaftOcclusionFragmentShader } from "./shaders/lightShaftShaders";
import { mix, projectDirectionToRef, rotationViewProjectionToRef, smoothstep, type ScreenDirection } from "./skyMath";
import { bindSkyPassView, createSkyPass, createSkyPassRenderer } from "./skyPass";

/** Qualitätswerte der Lichtstrahlen (Strahlenqualität). */
export interface LightShaftQuality {
  /** Stichproben der Radialsammlung; 0 schaltet die Strahlen ab. */
  readonly samples: number;
  /** MSAA-Stufe des Szenenbilds: Der Strahlen-Post-Process ist das erste Glied der Kamerakette und trägt sie. */
  readonly msaaSamples: number;
}

/** Lichtquelle der Strahlen in einem Frame (Strahlenquelle). */
export interface LightShaftFrame {
  readonly toLight: Vector3;
  /** Farbe × Intensität des Hauptlichts (linear, HDR). */
  readonly lightColor: Color3;
  /** Stärke nach Tagesphase, Wetter und Medium an der Kamera (0 = aus). */
  readonly strength: number;
  /** Länge der Strahlen 0..1: Morgen und Abend lang, Mittag kurz. */
  readonly length: number;
  /** Gewicht des weiten Hofs um die Quelle (Sonne breit, Mond schmal). */
  readonly haloWeight: number;
  /** Winkelbreite der hellen Quelle (rad), eng um die Scheibe. */
  readonly coreAngle: number;
  /** Anteil des gleichmäßigen Scheins um die Quelle neben den Strahlen (Sonne kräftig, Mond schwach). */
  readonly glowShare: number;
}

/** Teiler der Auflösung gegenüber dem Bild: Verdeckungsbild in Viertel-, Sammeln in halber Auflösung. */
const OcclusionDownscale = 4;
const GatherDownscale = 2;
/** Stichprobenzahl, für die das Abklingen je Schritt angegeben ist. */
const ReferenceSamples = 64;
/** Abklingen je Schritt bei kurzen (Mittag) und langen Strahlen (Morgen, Abend). */
const ShortDecay = 0.95;
const LongDecay = 0.985;
/** Winkelbreite des weiten Hofs um Sonne bzw. Mond (rad). */
const HaloAngle = (28 * Math.PI) / 180;
/** Kehrwert der quadrierten Hofbreite für den Gaußabfall im Shader. */
const HaloFalloff = 1 / (HaloAngle * HaloAngle);
/** Gewicht der Silberränder der Wolken als Strahlenquelle und Winkelbreite ihres Fensters um die Lichtquelle (rad). */
const CloudRimWeight = 0.6;
const RimWindowAngle = (10 * Math.PI) / 180;
/** Helligkeit der Strahlen relativ zum Hauptlicht. */
const Brightness = 2.0;
/** Strahlenkontrast beim Einmischen: Vergleichswinkel um die Lichtquelle (rad) und Verstärkung der Strahlen gegenüber ihren Nachbarn. */
const ContrastAngle = (6 * Math.PI) / 180;
const RayGain = 1.5;
/** Luftstrecke vor Geometrie, ab der die Strahlen voll wirken (m). */
const AirMeters = 200;
/** Unterhalb dieser Stärke entfallen die Pässe. */
const MinStrength = 0.003;

/**
 * Sonnen- und Mondstrahlen (Lichtstrahlen): Radialunschärfe mit Wolkenmaske nach Skill babylon-sky
 * (light-shafts.md). Verdeckungsbild (¼ Auflösung) und Sammeln (½ Auflösung) laufen nach den Wolken des Frames; ein
 * Kamera-Post-Process vor der DefaultRenderingPipeline mischt die Strahlen ins HDR-Bild, sodass Bloom und
 * Tonemapping sie erfassen. Beim Einmischen hebt ein Winkelvergleich die einzelnen Strahlen gegenüber dem
 * gleichmäßigen Schein hervor: deutliche Strahlen durch Wolkenlücken und an Inseln vorbei, ohne Schleier.
 *
 * Der Post-Process ist vom ersten Frame an und dauerhaft das erste Glied der Kamerakette: Er nimmt das
 * Szenenbild samt Tiefenpuffer auf und trägt dessen MSAA-Stufe, die Pipeline selbst arbeitet ohne MSAA. Sind die
 * Strahlen aus (Stufe low, Effektschalter, Quelle nicht im Bild), reicht er das Bild unverändert weiter. Ein
 * Wechsel des ersten Glieds zur Laufzeit legt unter WebGPU (Babylon 9.29) die Tiefentextur des neuen ersten
 * Glieds im falschen Format an; die feste Lage vermeidet das.
 */
export class LightShafts {
  private readonly engine: AbstractEngine;
  private readonly camera: Camera;
  private readonly pipeline: DefaultRenderingPipeline;
  private readonly depthMap: RenderTargetTexture;
  private readonly cloudTexture: () => RenderTargetTexture | undefined;
  private readonly effectRenderer: EffectRenderer;
  private readonly occlusionPass: EffectWrapper;
  private gatherPass: EffectWrapper;
  private readonly postProcess: PostProcess;
  /** Ersatz für die Wolkentextur ohne Wolken: Transmission 1. */
  private readonly clearSky: RawTexture;
  private readonly cameraScope: CameraRenderScope;
  private readonly observers: Array<Observer<unknown>> = [];
  private occlusionTarget: RenderTargetTexture | undefined;
  private gatherTarget: RenderTargetTexture | undefined;
  private quality: LightShaftQuality;
  private frame: LightShaftFrame | undefined;
  private enabled = true;
  private passesRendered = false;
  private visibleStrength = 0;
  private readonly screenLight: ScreenDirection = { u: 0.5, v: 0.5, facing: 0 };
  private readonly matrixScratch = new Matrix();
  private readonly viewProjection = new Matrix();
  private readonly inverseViewProjection = new Matrix();
  private readonly shaftColor = new Color3();

  /**
   * @param depthMap Kameraraum-Z der Szene (0 = Himmel), dieselbe Karte wie für die Wolken.
   * @param cloudTexture liefert die Wolkentextur des Frames (a = Transmission) oder undefined ohne Wolken.
   */
  public constructor(scene: Scene, camera: Camera, pipeline: DefaultRenderingPipeline, depthMap: RenderTargetTexture, cloudTexture: () => RenderTargetTexture | undefined, quality: LightShaftQuality) {
    this.engine = scene.getEngine();
    this.camera = camera;
    this.pipeline = pipeline;
    this.depthMap = depthMap;
    this.cloudTexture = cloudTexture;
    this.quality = quality;
    this.effectRenderer = createSkyPassRenderer(this.engine);
    this.occlusionPass = createSkyPass(this.engine, "lightShaftOcclusion", ShaftOcclusionFragmentShader, ["toLight", "occlusionParams", "sourceParams"], ["depthSampler", "cloudSampler"], []);
    this.occlusionPass.onApplyObservable.add(() => this.bindOcclusion(this.occlusionPass.effect));
    this.gatherPass = this.createGatherPass();
    this.clearSky = new RawTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.NEAREST_SAMPLINGMODE);

    ShaderStore.ShadersStore[`${ShaftCompositeShaderName}FragmentShader`] = ShaftCompositeFragmentShader;
    this.postProcess = new PostProcess("lightShafts", ShaftCompositeShaderName, {
      uniforms: ["shaftColor", "lightParams", "contrastParams", "shaftSize"],
      samplers: ["shaftSampler", "depthSampler"],
      size: 1,
      camera,
      samplingMode: Constants.TEXTURE_NEAREST_SAMPLINGMODE,
      engine: this.engine,
      reusable: false,
      textureType: Constants.TEXTURETYPE_HALF_FLOAT,
    });
    // Ganz vorn in die Kette, vor die DefaultRenderingPipeline (noch vor dem ersten Frame)
    camera.detachPostProcess(this.postProcess);
    camera.attachPostProcess(this.postProcess, 0);
    this.postProcess.onApplyObservable.add((effect) => this.bindComposite(effect));

    this.cameraScope = new CameraRenderScope(scene, camera);
    const resize = this.engine.onResizeObservable.add(() => this.createTargets());
    const afterTargets = scene.onAfterRenderTargetsRenderObservable.add(() => this.renderPasses());
    this.observers.push(resize as Observer<unknown>, afterTargets as Observer<unknown>);
    this.createTargets();
    this.syncMultisampling();
  }

  /** Setzt Lichtquelle und Stärke des nächsten Frames. */
  public setFrame(frame: LightShaftFrame): void {
    this.frame = frame;
  }

  /** Effektschalter der Debug-API. */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Wendet eine Qualitätsstufe an (Stichproben, MSAA); 0 Stichproben schalten die Strahlen ab. */
  public applyQuality(quality: LightShaftQuality): void {
    const recompile = quality.samples !== this.quality.samples;
    this.quality = quality;
    if (recompile) {
      this.gatherPass.dispose();
      this.gatherPass = this.createGatherPass();
    }
    this.syncMultisampling();
  }

  /** Wirksame Stärke des letzten Frames nach allen Abblendungen (0 = keine Strahlen im Bild). */
  public get intensity(): number {
    return this.passesRendered ? this.visibleStrength : 0;
  }

  private get shouldRun(): boolean {
    return this.enabled && this.quality.samples > 0;
  }

  private createGatherPass(): EffectWrapper {
    const samples = Math.max(1, Math.round(this.quality.samples));
    const pass = createSkyPass(this.engine, "lightShaftGather", ShaftGatherFragmentShader, ["gatherParams"], ["occlusionSampler"], [`SHAFT_SAMPLES ${samples}`]);
    pass.onApplyObservable.add(() => this.bindGather(pass.effect));
    return pass;
  }

  /** MSAA liegt auf dem ersten Glied der Kette, das das Szenenbild aufnimmt; die Pipeline arbeitet ohne. */
  private syncMultisampling(): void {
    this.postProcess.samples = this.quality.msaaSamples;
    this.pipeline.samples = 1;
  }

  private createTargets(): void {
    this.occlusionTarget?.dispose();
    this.gatherTarget?.dispose();
    const create = (name: string, downscale: number): RenderTargetTexture => {
      const width = Math.max(16, Math.ceil(this.engine.getRenderWidth() / downscale));
      const height = Math.max(16, Math.ceil(this.engine.getRenderHeight() / downscale));
      const target = new RenderTargetTexture(name, { width, height }, this.camera.getScene(), {
        generateMipMaps: false,
        generateDepthBuffer: false,
        generateStencilBuffer: false,
        type: Constants.TEXTURETYPE_HALF_FLOAT,
        format: Constants.TEXTUREFORMAT_R,
        samplingMode: Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
      });
      target.wrapU = Texture.CLAMP_ADDRESSMODE;
      target.wrapV = Texture.CLAMP_ADDRESSMODE;
      target.skipInitialClear = true;
      return target;
    };
    this.occlusionTarget = create("lightShaftOcclusion", OcclusionDownscale);
    this.gatherTarget = create("lightShaftGather", GatherDownscale);
  }

  /** Verdeckungsbild und Radialsammlung des Frames; läuft nach den Wolken der Spielkamera. */
  private renderPasses(): void {
    this.passesRendered = false;
    const frame = this.frame;
    const occlusion = this.occlusionTarget;
    const gather = this.gatherTarget;
    if (!this.shouldRun || !this.cameraScope.isActive || frame === undefined || occlusion === undefined || gather === undefined) {
      return;
    }
    rotationViewProjectionToRef(this.camera, this.matrixScratch, this.viewProjection);
    const light = projectDirectionToRef(frame.toLight, this.viewProjection, this.screenLight);
    // Abblenden, wenn die Quelle hinter der Kamera, weit außerhalb des Bilds oder unter dem Horizont liegt
    const outside = Math.max(0, -light.u, light.u - 1, -light.v, light.v - 1);
    const fade = smoothstep(0.02, 0.3, light.facing) * (1 - smoothstep(0, 0.45, outside)) * smoothstep(-0.04, 0.04, frame.toLight.y);
    this.visibleStrength = frame.strength * fade;
    if (this.visibleStrength < MinStrength || !this.occlusionPass.isReady() || !this.gatherPass.isReady()) {
      return;
    }
    this.viewProjection.invertToRef(this.inverseViewProjection);
    this.effectRenderer.render(this.occlusionPass, occlusion);
    this.effectRenderer.render(this.gatherPass, gather);
    this.passesRendered = true;
  }

  private bindOcclusion(effect: Effect): void {
    const frame = this.frame;
    if (frame === undefined) {
      return;
    }
    bindSkyPassView(effect, this.engine, this.inverseViewProjection);
    // Tiefenproben auf den äußeren Pixelmitten des Blocks, den ein Verdeckungspixel abdeckt
    const depthSize = this.depthMap.getSize();
    const spread = OcclusionDownscale / 2 - 0.5;
    effect.setTexture("depthSampler", this.depthMap);
    effect.setTexture("cloudSampler", this.cloudTexture() ?? this.clearSky);
    effect.setVector3("toLight", frame.toLight);
    effect.setFloat4("occlusionParams", spread / Math.max(1, depthSize.width), spread / Math.max(1, depthSize.height), 1 / (frame.coreAngle * frame.coreAngle), HaloFalloff);
    // Wolkenränder zählen als Quelle im Verhältnis zur Helligkeit des Lichts (Silberränder heller als das Licht)
    const color = frame.lightColor;
    const lightLuminance = Math.max(1e-4, 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b);
    effect.setFloat4("sourceParams", frame.haloWeight, CloudRimWeight, 1 / lightLuminance, 1 / (RimWindowAngle * RimWindowAngle));
  }

  private bindGather(effect: Effect): void {
    const frame = this.frame;
    const occlusion = this.occlusionTarget;
    if (frame === undefined || occlusion === undefined) {
      return;
    }
    bindSkyPassView(effect, this.engine, this.inverseViewProjection);
    effect.setTexture("occlusionSampler", occlusion);
    // Abklingen je Schritt so umgerechnet, dass 32 und 64 Stichproben gleich lange Strahlen ergeben
    const decay = Math.pow(mix(ShortDecay, LongDecay, frame.length), ReferenceSamples / Math.max(1, this.quality.samples));
    effect.setFloat4("gatherParams", this.screenLight.u, this.screenLight.v, mix(0.85, 1.0, frame.length), decay);
  }

  private bindComposite(effect: Effect): void {
    const frame = this.frame;
    if (this.passesRendered && frame !== undefined) {
      frame.lightColor.scaleToRef(this.visibleStrength * Brightness, this.shaftColor);
    } else {
      this.shaftColor.set(0, 0, 0);
    }
    const shafts = this.gatherTarget ?? this.clearSky;
    const size = shafts.getSize();
    const aspect = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
    effect.setTexture("shaftSampler", shafts);
    effect.setTexture("depthSampler", this.depthMap);
    effect.setFloat4("shaftColor", this.shaftColor.r, this.shaftColor.g, this.shaftColor.b, AirMeters);
    effect.setFloat4("lightParams", this.screenLight.u, this.screenLight.v, aspect, 0);
    effect.setFloat4("contrastParams", Math.cos(ContrastAngle), Math.sin(ContrastAngle), frame?.glowShare ?? 0, RayGain);
    effect.setFloat2("shaftSize", Math.max(1, size.width), Math.max(1, size.height));
  }

  public dispose(): void {
    for (const observer of this.observers) {
      observer.remove();
    }
    this.cameraScope.dispose();
    this.postProcess.dispose(this.camera);
    this.pipeline.samples = this.quality.msaaSamples;
    this.occlusionPass.dispose();
    this.gatherPass.dispose();
    this.effectRenderer.dispose();
    this.occlusionTarget?.dispose();
    this.gatherTarget?.dispose();
    this.clearSky.dispose();
  }
}
