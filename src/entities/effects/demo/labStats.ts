// Kennzahlen der Effekt-Werkstatt: Bildrate, Draw Calls (gesamt und Effekte), CPU-Zeit des Effektsystems
// und Instanzzahlen; dazu eine Messung über mehrere Sekunden für Prüfläufe.
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { SceneInstrumentation } from "@babylonjs/core/Instrumentation/sceneInstrumentation";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";
import type { EffectsSystem } from "../effectsSystem";

const Window = 120;
const RefreshMs = 250;

/** Ergebnis einer Messung über mehrere Sekunden (Messergebnis). */
export interface LabMeasurement {
  readonly seconds: number;
  readonly frames: number;
  readonly fps: number;
  readonly frameMs: number;
  readonly effectsMsAverage: number;
  readonly effectsMsP95: number;
  readonly effectsMsMax: number;
  readonly drawCallsAverage: number;
  readonly drawCallsMax: number;
  readonly effectDrawCallsMax: number;
  readonly glowInstancesMax: number;
  readonly matterInstancesMax: number;
  readonly meshInstancesMax: number;
  readonly particlesMax: number;
  readonly dropped: number;
}

/** Laufende Messung (Messpuffer). */
interface ActiveMeasurement {
  readonly start: number;
  readonly effectsMs: number[];
  drawCalls: number;
  drawCallsMax: number;
  effectDrawCallsMax: number;
  glowMax: number;
  matterMax: number;
  meshMax: number;
  particlesMax: number;
  readonly resolve: (result: LabMeasurement) => void;
  readonly seconds: number;
}

/** Kennzahlen-Anzeige der Werkstatt (Werkstatt-Kennzahlen). */
export class LabStats {
  private readonly engine: AbstractEngine;
  private readonly effects: EffectsSystem;
  private readonly output: HTMLElement;
  private readonly instrumentation: SceneInstrumentation;
  private readonly observer: Observer<Scene>;
  private readonly scene: Scene;
  private readonly samples = new Float64Array(Window);
  private sampleIndex = 0;
  private sampleCount = 0;
  private lastRefresh = 0;
  private measurement: ActiveMeasurement | undefined;
  private readonly backend: string;

  public constructor(scene: Scene, engine: AbstractEngine, effects: EffectsSystem, output: HTMLElement) {
    this.scene = scene;
    this.engine = engine;
    this.effects = effects;
    this.output = output;
    this.backend = engine.isWebGPU ? "WebGPU" : "WebGL2";
    this.instrumentation = new SceneInstrumentation(scene);
    this.instrumentation.captureFrameTime = true;
    this.observer = scene.onAfterRenderObservable.add(() => this.afterRender());
  }

  /** Nimmt die CPU-Zeit eines frameUpdate-Aufrufs auf (ms). */
  public recordEffects(milliseconds: number): void {
    this.samples[this.sampleIndex] = milliseconds;
    this.sampleIndex = (this.sampleIndex + 1) % Window;
    this.sampleCount = Math.min(Window, this.sampleCount + 1);
    this.measurement?.effectsMs.push(milliseconds);
  }

  /** Misst über `seconds` Sekunden und liefert Mittel- und Spitzenwerte. */
  public measure(seconds: number): Promise<LabMeasurement> {
    return new Promise((resolve) => {
      this.measurement = {
        start: performance.now(),
        effectsMs: [],
        drawCalls: 0,
        drawCallsMax: 0,
        effectDrawCallsMax: 0,
        glowMax: 0,
        matterMax: 0,
        meshMax: 0,
        particlesMax: 0,
        resolve,
        seconds,
      };
    });
  }

  private afterRender(): void {
    const drawCalls = this.instrumentation.drawCallsCounter.current;
    const statistics = this.effects.statistics;
    const measurement = this.measurement;
    if (measurement !== undefined) {
      measurement.drawCalls += drawCalls;
      measurement.drawCallsMax = Math.max(measurement.drawCallsMax, drawCalls);
      measurement.effectDrawCallsMax = Math.max(measurement.effectDrawCallsMax, statistics.drawCalls);
      measurement.glowMax = Math.max(measurement.glowMax, statistics.glowInstances);
      measurement.matterMax = Math.max(measurement.matterMax, statistics.matterInstances);
      measurement.meshMax = Math.max(measurement.meshMax, statistics.meshInstances);
      measurement.particlesMax = Math.max(measurement.particlesMax, statistics.particles);
      const elapsed = (performance.now() - measurement.start) / 1000;
      if (elapsed >= measurement.seconds) {
        this.finish(measurement, elapsed);
      }
    }
    const now = performance.now();
    if (now - this.lastRefresh < RefreshMs) {
      return;
    }
    this.lastRefresh = now;
    let sum = 0;
    let max = 0;
    for (let i = 0; i < this.sampleCount; i++) {
      sum += this.samples[i];
      max = Math.max(max, this.samples[i]);
    }
    const average = this.sampleCount > 0 ? sum / this.sampleCount : 0;
    this.output.textContent = [
      `fps ${this.engine.getFps().toFixed(0).padStart(3)}   Frame ${this.engine.getDeltaTime().toFixed(1)} ms`,
      `Effekte CPU ${average.toFixed(2)} ms (max ${max.toFixed(2)})`,
      `Draw Calls ${drawCalls} (Effekte ${statistics.drawCalls})`,
      `Leuchten ${statistics.glowInstances}  Materie ${statistics.matterInstances}  Meshes ${statistics.meshInstances}`,
      `Partikel ${statistics.particles}  Strahlen ${statistics.beams}  verworfen ${statistics.dropped}`,
      `${this.backend}  ${this.engine.getRenderWidth()}×${this.engine.getRenderHeight()}`,
    ].join("\n");
  }

  private finish(measurement: ActiveMeasurement, elapsed: number): void {
    this.measurement = undefined;
    const sorted = [...measurement.effectsMs].sort((a, b) => a - b);
    const frames = sorted.length;
    const sum = sorted.reduce((total, value) => total + value, 0);
    const statistics = this.effects.statistics;
    measurement.resolve({
      seconds: elapsed,
      frames,
      fps: frames / elapsed,
      frameMs: (elapsed * 1000) / Math.max(1, frames),
      effectsMsAverage: frames > 0 ? sum / frames : 0,
      effectsMsP95: frames > 0 ? sorted[Math.min(frames - 1, Math.floor(frames * 0.95))] : 0,
      effectsMsMax: frames > 0 ? sorted[frames - 1] : 0,
      drawCallsAverage: measurement.drawCalls / Math.max(1, frames),
      drawCallsMax: measurement.drawCallsMax,
      effectDrawCallsMax: measurement.effectDrawCallsMax,
      glowInstancesMax: measurement.glowMax,
      matterInstancesMax: measurement.matterMax,
      meshInstancesMax: measurement.meshMax,
      particlesMax: measurement.particlesMax,
      dropped: statistics.dropped,
    });
  }

  public dispose(): void {
    this.scene.onAfterRenderObservable.remove(this.observer);
    this.instrumentation.dispose();
  }
}
