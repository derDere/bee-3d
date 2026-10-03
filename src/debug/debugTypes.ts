import type { QualityTier } from "../core/quality";
import type { HudActions, HudModel } from "../hud/hudTypes";

export type { QualityTier };

/** Virtuelle Eingaben je Spielaktion, Werte -1..1 (z. B. { yaw: -0.5, throttle: 1 }). */
export type VirtualInput = Readonly<Record<string, number>>;

/** Momentaufnahme der Engine- und Szenenkennzahlen. */
export interface DebugStats {
  readonly engine: string;
  readonly isWebGPU: boolean;
  readonly fps: number;
  readonly cpuFrameTimeMs: number;
  readonly gpuFrameTimeMs: number | null;
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
  readonly blackRatio: number;
  readonly whiteRatio: number;
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

/** Himmel und Wetter steuern (Skill babylon-sky). */
export interface SkyDebugApi {
  listWeathers(): readonly string[];
  setWeather(name: string, blendSeconds?: number): void;
  setTimeScale(scale: number): void;
  skyState(): Readonly<Record<string, unknown>>;
  /** Löst sofort einen Blitz aus (Gewitter prüfen). */
  triggerLightning(): void;
  /** Lässt sofort einen Regenbogen einblenden; er steht einige Minuten, solange die Sonne über dem Horizont steht. */
  triggerRainbow(): void;
}

/** Netz-Steuerung für Prüf-Agenten und Tests (Skill spacetimedb-babylon). */
export interface NetDebugApi {
  state(): Readonly<Record<string, unknown>>;
  dropConnection(): void;
}

/** Spielgeschehen für Prüf-Agenten: dieselben Aktionen wie die Oberfläche und das aktuelle HUD-Modell (Spiel-Debug). */
export interface GameplayDebugApi {
  readonly actions: HudActions;
  hud(): HudModel;
}

/** Entwicklungs-Schnittstelle für Prüf-Agenten und Tests. */
export interface GameDebugApi {
  readonly ready: boolean;
  readonly sky: SkyDebugApi;
  readonly net: NetDebugApi;
  readonly gameplay: GameplayDebugApi;
  pause(): void;
  resume(): void;
  step(steps?: number): Promise<void>;
  simulateInput(input: VirtualInput, steps: number): Promise<void>;
  waitFrames(frames: number): Promise<void>;
  setTimeOfDay(hours: number): void;
  listViewpoints(): readonly string[];
  setViewpoint(name: string): void;
  /** Startet das Spiel ohne Startbildschirm (Name optional). */
  play(name?: string): void;
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
