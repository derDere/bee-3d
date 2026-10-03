import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { Observer } from "@babylonjs/core/Misc/observable";
import type { Scene } from "@babylonjs/core/scene";

/** Spielsystem mit festem Zeitschritt (Spiellogik-Takt). */
export interface FixedStepSystem {
  fixedUpdate(dt: number): void;
}

/** Spielsystem, das einmal pro gerendertem Frame läuft (Darstellung, Kamera, HUD). */
export interface FrameSystem {
  frameUpdate(dt: number, alpha: number): void;
}

/**
 * Spielschleife mit festem Logiktakt, Pause und Sichtbarkeitsbehandlung (Spielschleife).
 * Hängt sich in `onBeforeRenderObservable`, also nach Animationen des Frames. Für die Debug-API
 * rückt `advanceFixedSteps` eine pausierte Simulation um feste Schritte vor.
 */
export class GameLoop {
  private readonly engine: AbstractEngine;
  private readonly scene: Scene;
  private readonly fixedDt: number;
  private readonly maxStepsPerFrame: number;
  private readonly fixedSystems: FixedStepSystem[] = [];
  private readonly frameSystems: FrameSystem[] = [];
  private readonly afterStepListeners: Array<() => void> = [];
  private readonly observer: Observer<Scene>;
  private readonly resizeObserver: ResizeObserver;
  private accumulator = 0;
  private paused = false;
  private pendingSteps = 0;
  private onStepsDone: (() => void) | null = null;
  private elapsedSeconds = 0;

  public constructor(engine: AbstractEngine, scene: Scene, fixedDt = 1 / 60, maxStepsPerFrame = 5) {
    this.engine = engine;
    this.scene = scene;
    this.fixedDt = fixedDt;
    this.maxStepsPerFrame = maxStepsPerFrame;
    this.observer = scene.onBeforeRenderObservable.add(() => this.tick());
    this.resizeObserver = new ResizeObserver(() => engine.resize());
    const canvas = engine.getRenderingCanvas();
    if (canvas) {
      this.resizeObserver.observe(canvas);
    }
  }

  public addFixed(system: FixedStepSystem): void {
    this.fixedSystems.push(system);
  }

  public addFrame(system: FrameSystem): void {
    this.frameSystems.push(system);
  }

  /** Wird nach jedem festen Schritt aufgerufen (Eingabe-Takt beenden). */
  public onAfterFixedStep(listener: () => void): void {
    this.afterStepListeners.push(listener);
  }

  public get isPaused(): boolean {
    return this.paused;
  }

  /** Spielzeit in Sekunden seit dem Start (ohne Pausen). */
  public get time(): number {
    return this.elapsedSeconds;
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
    this.accumulator = 0;
    this.scene.animationTimeScale = paused ? 0 : 1;
  }

  /** Rückt die pausierte Simulation um `steps` feste Schritte vor (Debug-API). */
  public advanceFixedSteps(steps: number): Promise<void> {
    this.pendingSteps = Math.max(0, Math.floor(steps));
    return new Promise((resolve) => {
      if (this.pendingSteps === 0) {
        resolve();
        return;
      }
      this.onStepsDone = resolve;
    });
  }

  public start(): void {
    this.engine.runRenderLoop(() => this.scene.render());
  }

  private runFixedStep(): void {
    for (const system of this.fixedSystems) {
      system.fixedUpdate(this.fixedDt);
    }
    for (const listener of this.afterStepListeners) {
      listener();
    }
    this.elapsedSeconds += this.fixedDt;
  }

  private tick(): void {
    const frameDt = Math.min(this.engine.getDeltaTime() / 1000, 0.1);
    if (!this.paused) {
      this.accumulator += frameDt;
      let steps = 0;
      while (this.accumulator >= this.fixedDt && steps < this.maxStepsPerFrame) {
        this.runFixedStep();
        this.accumulator -= this.fixedDt;
        steps++;
      }
      if (steps === this.maxStepsPerFrame) {
        // Nach einem Hänger nicht im Zeitraffer aufholen
        this.accumulator = 0;
      }
    } else if (this.pendingSteps > 0) {
      const steps = Math.min(this.pendingSteps, this.maxStepsPerFrame);
      for (let i = 0; i < steps; i++) {
        this.runFixedStep();
      }
      this.pendingSteps -= steps;
      if (this.pendingSteps === 0) {
        this.onStepsDone?.();
        this.onStepsDone = null;
      }
    }
    const alpha = this.accumulator / this.fixedDt;
    for (const system of this.frameSystems) {
      system.frameUpdate(this.paused ? 0 : frameDt, alpha);
    }
  }

  public dispose(): void {
    this.scene.onBeforeRenderObservable.remove(this.observer);
    this.resizeObserver.disconnect();
    this.engine.stopRenderLoop();
  }
}
