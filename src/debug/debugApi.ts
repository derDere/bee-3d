import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { Scene } from "@babylonjs/core/scene";
import { EngineInstrumentation } from "@babylonjs/core/Instrumentation/engineInstrumentation";
import { SceneInstrumentation } from "@babylonjs/core/Instrumentation/sceneInstrumentation";
import { SetMissingSideEffectWarningsEnabled } from "@babylonjs/core/Misc/devTools";
import { CreateScreenshotAsync } from "@babylonjs/core/Misc/screenshotTools";
import type {
  DebugStats,
  FrameCheck,
  GameDebugApi,
  GameplayDebugApi,
  GpuInfo,
  NetDebugApi,
  PerfSample,
  QualityTier,
  SkyDebugApi,
  VirtualInput,
} from "./debugTypes";

/** Spielseitige Operationen, die die Debug-API steuert (implementiert vom Spiel). */
export interface DebugHost {
  readonly engine: AbstractEngine;
  readonly scene: Scene;
  readonly isReady: boolean;
  readonly isPaused: boolean;
  readonly qualityTier: QualityTier;
  readonly timeOfDay: number;
  readonly skyDebug: SkyDebugApi;
  readonly netDebug: NetDebugApi;
  readonly gameplayDebug: GameplayDebugApi;
  pause(): void;
  resume(): void;
  advanceFixedSteps(steps: number): Promise<void>;
  holdVirtualInput(input: VirtualInput, steps: number): Promise<void>;
  setTimeOfDay(hours: number): void;
  viewpointNames(): readonly string[];
  applyViewpoint(name: string): void;
  startGame(name: string): void;
  applyQuality(tier: QualityTier): void;
  effectNames(): readonly string[];
  setEffectEnabled(name: string, enabled: boolean): void;
  snapshotState(): Readonly<Record<string, unknown>>;
}

const SoftwareRendererPattern = /swiftshader|llvmpipe|lavapipe|warp|basic render/i;

/** Verbindet die Debug-API mit Spiel und Engine (Debug-Brücke). */
class DebugBridge implements GameDebugApi {
  private readonly host: DebugHost;
  private readonly engineInstrumentation: EngineInstrumentation;
  private readonly sceneInstrumentation: SceneInstrumentation;

  public constructor(host: DebugHost) {
    this.host = host;
    this.engineInstrumentation = new EngineInstrumentation(host.engine);
    this.engineInstrumentation.captureGPUFrameTime = true;
    this.sceneInstrumentation = new SceneInstrumentation(host.scene);
    this.sceneInstrumentation.captureFrameTime = true;
  }

  public get ready(): boolean {
    return this.host.isReady;
  }

  public get sky(): SkyDebugApi {
    return this.host.skyDebug;
  }

  public get net(): NetDebugApi {
    return this.host.netDebug;
  }

  public get gameplay(): GameplayDebugApi {
    return this.host.gameplayDebug;
  }

  public pause(): void {
    this.host.pause();
  }

  public resume(): void {
    this.host.resume();
  }

  public step(steps = 1): Promise<void> {
    return this.host.advanceFixedSteps(steps);
  }

  public simulateInput(input: VirtualInput, steps: number): Promise<void> {
    return this.host.holdVirtualInput(input, steps);
  }

  public waitFrames(frames: number): Promise<void> {
    const observable = this.host.scene.onAfterRenderObservable;
    return new Promise((resolve) => {
      let remaining = frames;
      const observer = observable.add(() => {
        remaining -= 1;
        if (remaining <= 0) {
          observable.remove(observer);
          resolve();
        }
      });
    });
  }

  public setTimeOfDay(hours: number): void {
    this.host.setTimeOfDay(hours);
  }

  public listViewpoints(): readonly string[] {
    return this.host.viewpointNames();
  }

  public setViewpoint(name: string): void {
    this.host.applyViewpoint(name);
  }

  public play(name = "Testbiene"): void {
    this.host.startGame(name);
  }

  public setQuality(tier: QualityTier): void {
    this.host.applyQuality(tier);
  }

  public listEffects(): readonly string[] {
    return this.host.effectNames();
  }

  public setEffect(name: string, enabled: boolean): void {
    this.host.setEffectEnabled(name, enabled);
  }

  public state(): Readonly<Record<string, unknown>> {
    return this.host.snapshotState();
  }

  public stats(): DebugStats {
    const { engine, scene } = this.host;
    const gpuNs = this.engineInstrumentation.gpuFrameTimeCounter.lastSecAverage;
    return {
      engine: engine.description,
      isWebGPU: engine.isWebGPU,
      fps: engine.getFps(),
      cpuFrameTimeMs: this.sceneInstrumentation.frameTimeCounter.lastSecAverage,
      gpuFrameTimeMs: gpuNs > 0 ? gpuNs / 1e6 : null,
      drawCalls: this.sceneInstrumentation.drawCallsCounter.current,
      activeMeshes: scene.getActiveMeshes().length,
      totalVertices: scene.getTotalVertices(),
      activeIndices: scene.getActiveIndices(),
      activeParticles: scene.getActiveParticles(),
      renderWidth: engine.getRenderWidth(),
      renderHeight: engine.getRenderHeight(),
      hardwareScalingLevel: engine.getHardwareScalingLevel(),
      quality: this.host.qualityTier,
      timeOfDay: this.host.timeOfDay,
      paused: this.host.isPaused,
    };
  }

  public async gpuInfo(): Promise<GpuInfo> {
    if (this.host.engine.isWebGPU) {
      const adapter = await navigator.gpu.requestAdapter();
      const vendor = adapter?.info.vendor ?? "";
      const renderer = `${adapter?.info.architecture ?? ""} ${adapter?.info.description ?? ""}`.trim();
      return { api: "webgpu", vendor, renderer, isSoftware: SoftwareRendererPattern.test(`${vendor} ${renderer}`) };
    }
    const gl = document.createElement("canvas").getContext("webgl2");
    const debugInfo = gl?.getExtension("WEBGL_debug_renderer_info");
    const vendor = gl && debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)) : "";
    const renderer = gl && debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) : "";
    return { api: "webgl2", vendor, renderer, isSoftware: SoftwareRendererPattern.test(renderer) };
  }

  public async frameCheck(): Promise<FrameCheck> {
    const camera = this.host.scene.activeCamera;
    if (camera === null) {
      throw new Error("Keine aktive Kamera.");
    }
    const dataUrl = await CreateScreenshotAsync(this.host.engine, camera, { width: 64, height: 36 });
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) {
      throw new Error("2D-Kontext nicht verfügbar.");
    }
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const pixelCount = data.length / 4;
    let sum = 0;
    let sumSquares = 0;
    let black = 0;
    let white = 0;
    for (let offset = 0; offset < data.length; offset += 4) {
      const luminance = (0.2126 * (data[offset] ?? 0) + 0.7152 * (data[offset + 1] ?? 0) + 0.0722 * (data[offset + 2] ?? 0)) / 255;
      sum += luminance;
      sumSquares += luminance * luminance;
      if (luminance < 0.02) black += 1;
      if (luminance > 0.98) white += 1;
    }
    const mean = sum / pixelCount;
    return {
      meanLuminance: mean,
      stdDevLuminance: Math.sqrt(Math.max(0, sumSquares / pixelCount - mean * mean)),
      blackRatio: black / pixelCount,
      whiteRatio: white / pixelCount,
    };
  }

  public measure(seconds: number): Promise<PerfSample> {
    const observable = this.host.scene.onAfterRenderObservable;
    const frameTimes: number[] = [];
    const gpuTimes: number[] = [];
    let drawCallSum = 0;
    let last = performance.now();
    const observer = observable.add(() => {
      const now = performance.now();
      frameTimes.push(now - last);
      last = now;
      drawCallSum += this.sceneInstrumentation.drawCallsCounter.current;
      const gpuNs = this.engineInstrumentation.gpuFrameTimeCounter.current;
      if (gpuNs > 0) gpuTimes.push(gpuNs / 1e6);
    });
    return new Promise((resolve) => {
      window.setTimeout(() => {
        observable.remove(observer);
        const sorted = [...frameTimes].sort((a, b) => a - b);
        const total = frameTimes.reduce((acc, value) => acc + value, 0);
        resolve({
          seconds,
          frames: frameTimes.length,
          avgFps: total > 0 ? (frameTimes.length * 1000) / total : 0,
          frameMs: { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), p99: percentile(sorted, 0.99), max: sorted.at(-1) ?? 0 },
          avgGpuFrameMs: gpuTimes.length > 0 ? gpuTimes.reduce((acc, value) => acc + value, 0) / gpuTimes.length : null,
          avgDrawCalls: frameTimes.length > 0 ? drawCallSum / frameTimes.length : 0,
        });
      }, seconds * 1000);
    });
  }

  public async showInspector(): Promise<void> {
    const { ShowInspector } = await import("@babylonjs/inspector");
    ShowInspector(this.host.scene, { layoutMode: "overlay" });
  }

  public async startInspectable(): Promise<void> {
    const { StartInspectable } = await import("@babylonjs/inspector");
    StartInspectable(this.host.scene, { name: document.title });
  }
}

/** Liefert das p-Quantil (0..1) einer aufsteigend sortierten Liste. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index] ?? 0;
}

/** Hängt die Debug-API an `window.__game` und schaltet die Side-Effect-Warnungen ein. */
export function installDebugApi(host: DebugHost): void {
  SetMissingSideEffectWarningsEnabled(true);
  const api = new DebugBridge(host);
  window.__game = api;
  if (new URLSearchParams(window.location.search).has("inspectable")) {
    void api.startInspectable();
  }
}

declare global {
  interface Window {
    __game?: GameDebugApi;
  }
}
