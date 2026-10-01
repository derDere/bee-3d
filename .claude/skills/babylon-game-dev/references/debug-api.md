# Debug-API `window.__game`

Über die Debug-API steuern Prüf-Agenten und Tests das Spiel reproduzierbar und lesen
Kennzahlen aus — ohne Screenshot, wo Zahlen genügen, mit Screenshot, wo es um die Optik geht.
Sie existiert im Dev-Build und im Profil-Build (`vite build --mode profile`), im
Produktions-Build fällt sie weg.

## Aktivierung

```ts
// src/main.ts — nach dem Erzeugen des Spiels
if (import.meta.env.DEV || import.meta.env.VITE_DEBUG_API === "true") {
  const { installDebugApi } = await import("./debug/debugApi");
  installDebugApi(game);
}
```

Vite ersetzt `import.meta.env.*` beim Build durch Konstanten, der Zweig entfällt damit im
Produktions-Build. Nach `npm run build` prüfen: In `dist/assets` liegt kein Debug- oder
Inspector-Chunk.

URL-Parameter, die das Spiel auswertet:

| Parameter | Wirkung |
|---|---|
| `?engine=webgl2` | Engine-Fabrik überspringt WebGPU (Rückfallebene testen) |
| `?quality=low\|medium\|high\|ultra` | Start-Qualitätsstufe |
| `?inspectable` | startet im Dev-Build die Inspector-CLI-Anbindung (`StartInspectable`) |

## Vertrag

```ts
/** Qualitätsstufe der Darstellung. */
export type QualityTier = "low" | "medium" | "high" | "ultra";

/** Virtuelle Eingaben je Spielaktion, Werte -1..1 (z. B. { forward: 1, yaw: -0.5 }). */
export type VirtualInput = Readonly<Record<string, number>>;

/** Momentaufnahme der Engine- und Szenenkennzahlen. */
export interface DebugStats {
  readonly engine: string; // engine.description, z. B. "WebGPU1" oder "WebGL2"
  readonly isWebGPU: boolean;
  readonly fps: number;
  readonly cpuFrameTimeMs: number;
  readonly gpuFrameTimeMs: number | null; // null ohne timestamp-query
  readonly drawCalls: number;
  readonly activeMeshes: number;
  readonly totalVertices: number;
  readonly activeIndices: number;
  readonly activeParticles: number;
  readonly renderWidth: number;
  readonly renderHeight: number;
  readonly hardwareScalingLevel: number;
  readonly quality: QualityTier;
  readonly timeOfDay: number;
  readonly paused: boolean;
}

/** Angaben zum Grafikadapter; isSoftware markiert Software-Rendering. */
export interface GpuInfo {
  readonly api: "webgpu" | "webgl2";
  readonly vendor: string;
  readonly renderer: string;
  readonly isSoftware: boolean;
}

/** Bildstatistik eines verkleinerten Frames (Luminanz 0..1). */
export interface FrameCheck {
  readonly meanLuminance: number;
  readonly stdDevLuminance: number;
  readonly blackRatio: number; // Anteil Pixel mit Luminanz < 0.02
  readonly whiteRatio: number; // Anteil Pixel mit Luminanz > 0.98
}

/** Ergebnis einer Leistungsmessung über mehrere Sekunden. */
export interface PerfSample {
  readonly seconds: number;
  readonly frames: number;
  readonly avgFps: number;
  readonly frameMs: { readonly p50: number; readonly p95: number; readonly p99: number; readonly max: number };
  readonly avgGpuFrameMs: number | null;
  readonly avgDrawCalls: number;
}

/** Entwicklungs-Schnittstelle für Prüf-Agenten und Tests. */
export interface GameDebugApi {
  readonly ready: boolean;
  pause(): void;
  resume(): void;
  step(steps?: number): Promise<void>;
  simulateInput(input: VirtualInput, steps: number): Promise<void>;
  waitFrames(frames: number): Promise<void>;
  setTimeOfDay(hours: number): void;
  listViewpoints(): readonly string[];
  setViewpoint(name: string): void;
  setQuality(tier: QualityTier): void;
  listEffects(): readonly string[];
  setEffect(name: string, enabled: boolean): void;
  state(): Readonly<Record<string, unknown>>;
  stats(): DebugStats;
  gpuInfo(): Promise<GpuInfo>;
  frameCheck(): Promise<FrameCheck>;
  measure(seconds: number): Promise<PerfSample>;
  showInspector(): Promise<void>;
  startInspectable(): Promise<void>;
}
```

## Semantik

| Methode | Verhalten |
|---|---|
| `ready` | `true` nach `scene.whenReadyAsync(true)` und zwei gerenderten Frames. Agenten warten darauf. |
| `pause()` / `resume()` | Hält Spiellogik, Physik (`scene.physicsEnabled = false`) und Animationen (`scene.animationTimeScale = 0`) an — `animationTimeScale` setzt beim Fortsetzen nahtlos fort. **Das Rendern läuft weiter** — so konvergieren TAA und zeitliche Effekte für Standbilder. |
| `step(n)` | Rückt die pausierte Simulation um n feste Schritte vor. |
| `simulateInput(input, n)` | Setzt virtuelle Aktionswerte für n feste Schritte. Ersetzt gehaltene Tasten: `press_key` im Chrome-DevTools-MCP drückt nur kurz. |
| `waitFrames(n)` | Erfüllt sich nach n gerenderten Frames. |
| `setTimeOfDay(h)` | Tageszeit 0–24 h für Sonne, Himmel, Licht und Nebel. |
| `listViewpoints()` / `setViewpoint(name)` | Benannte Kamerapunkte aus der Spec (z. B. Übersicht, Verfolgerkamera, Nahaufnahme). |
| `setQuality(tier)` | Wendet die Qualitätsstufe an (Skill `babylon-performance`). |
| `listEffects()` / `setEffect(name, on)` | Schaltet einzelne Effekte (Schatten, Volumetrie, Bloom, SSAO, Wolken …) für Vorher-Nachher-Vergleiche. |
| `state()` | Kompakter Spielzustand als JSON: Position, Geschwindigkeit, Ausrichtung der Spielfigur, Punktestand, Spielphase, aktive Ziele. Koordinaten in Metern, Y oben. |
| `stats()` | Engine- und Szenenkennzahlen (siehe `DebugStats`). |
| `gpuInfo()` | Adapter bzw. Renderer. Bei Software-Rendering (SwiftShader, WARP, llvmpipe, lavapipe) sind Optik- und Leistungsurteile ungültig. |
| `frameCheck()` | Statistik eines 64×36-Abbilds — erkennt schwarze, leere oder überstrahlte Frames ohne Screenshot. |
| `measure(s)` | Frame-Zeit-Perzentile, GPU-Zeit und Draw Calls über s Sekunden. |
| `showInspector()` | Öffnet Inspector v2 als Overlay. |
| `startInspectable()` | Verbindet die Szene mit der Inspector-CLI (Skill `babylon-visual-qa`). |

## Umsetzungsskizze

Das Spiel implementiert `DebugHost` (spielspezifische Operationen); `DebugBridge` ergänzt die
Babylon-Teile. Der Spieltakt aus Skill `babylon-gameplay` liefert `advanceFixedSteps` und die
virtuelle Eingabequelle.

```ts
// src/debug/debugApi.ts
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { Scene } from "@babylonjs/core/scene";
import { EngineInstrumentation } from "@babylonjs/core/Instrumentation/engineInstrumentation";
import { SceneInstrumentation } from "@babylonjs/core/Instrumentation/sceneInstrumentation";
import { SetMissingSideEffectWarningsEnabled } from "@babylonjs/core/Misc/devTools";
import { CreateScreenshotAsync } from "@babylonjs/core/Misc/screenshotTools";
import type { DebugStats, FrameCheck, GameDebugApi, GpuInfo, PerfSample, QualityTier, VirtualInput } from "./debugTypes";

/** Spielseitige Operationen, die die Debug-API steuert (implementiert vom Spiel). */
export interface DebugHost {
  readonly engine: AbstractEngine;
  readonly scene: Scene;
  readonly isReady: boolean;
  readonly isPaused: boolean;
  readonly qualityTier: QualityTier;
  readonly timeOfDay: number;
  pause(): void;
  resume(): void;
  advanceFixedSteps(steps: number): Promise<void>;
  holdVirtualInput(input: VirtualInput, steps: number): Promise<void>;
  setTimeOfDay(hours: number): void;
  viewpointNames(): readonly string[];
  applyViewpoint(name: string): void;
  applyQuality(tier: QualityTier): void;
  effectNames(): readonly string[];
  setEffectEnabled(name: string, enabled: boolean): void;
  snapshotState(): Readonly<Record<string, unknown>>;
}

const SoftwareRendererPattern = /swiftshader|llvmpipe|lavapipe|warp|basic render/i;

/** Verbindet die Debug-API mit Spiel und Engine. */
class DebugBridge implements GameDebugApi {
  private readonly host: DebugHost;
  private readonly engineInstrumentation: EngineInstrumentation;
  private readonly sceneInstrumentation: SceneInstrumentation;

  public constructor(host: DebugHost) {
    this.host = host;
    this.engineInstrumentation = new EngineInstrumentation(host.engine);
    this.engineInstrumentation.captureGPUFrameTime = true; // WebGPU: braucht timestamp-query (enableAllFeatures)
    this.sceneInstrumentation = new SceneInstrumentation(host.scene);
    this.sceneInstrumentation.captureFrameTime = true;
  }

  public get ready(): boolean {
    return this.host.isReady;
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
    // Babylon kopiert den Canvas am Ende des nächsten Frames — funktioniert unter WebGPU und WebGL2.
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
      // Relative Luminanz nach Rec. 709 auf 0..1
      const luminance = (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) / 255;
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
```

Die Typen (`QualityTier`, `DebugStats` …) liegen in `src/debug/debugTypes.ts`, damit
Spielcode sie ohne Laufzeitabhängigkeit importieren kann. GPU-Zeitmessung unter WebGL braucht
die beiden Timer-Imports aus der Side-Effect-Tabelle in `SKILL.md`. Signaturen vor dem Einbau
gegen die installierten Typings prüfen (Abschnitt „API-Wahrheit").

## Aufruf aus dem Chrome-DevTools-MCP

```js
// evaluate_script — Standbild vorbereiten und Kennzahlen lesen
async () => {
  const game = window.__game;
  if (!game?.ready) return { ready: false };
  game.pause();
  game.setTimeOfDay(6.5);
  game.setViewpoint("overview");
  await game.waitFrames(30);
  return { stats: game.stats(), frame: await game.frameCheck() };
}
```
