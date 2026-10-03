import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { Scene } from "@babylonjs/core/scene";
import type { AnimationControl } from "./animationControl";
import type { ContactSheet } from "./contactSheet";
import type { DebugModes } from "./debugModes";
import type { LabStats } from "./modelStats";
import type { BackendName, DebugMode, ViewMode } from "./types";

/** Öffentliche Steuerung des Labs für Browser-Automatisierung (window.__lab). */
export interface LabApi {
  readonly status: "loading" | "ready" | "error";
  readonly ready: boolean;
  readonly error: string | null;
  readonly backend: BackendName;
  stats(): LabStats;
  /** Wechselt zwischen "sheet" und einer Einzelansicht; löst nach dem Neuzeichnen auf. */
  setView(mode: ViewMode): Promise<void>;
  setDebug(mode: DebugMode): Promise<void>;
  /** Setzt eine Animation (oder "*" für alle) auf einen festen Zeitpunkt in Sekunden. */
  setAnimationTime(name: string, seconds: number): Promise<void>;
}

export interface LabApiParts {
  backend: BackendName;
  engine: AbstractEngine;
  scene: Scene;
  sheet: ContactSheet;
  debug: DebugModes;
  animation: AnimationControl;
  stats: () => LabStats;
}

/** Wartet, bis `count` Bilder gerendert sind. */
export function renderFrames(scene: Scene, count: number): Promise<void> {
  return new Promise((resolve) => {
    let remaining = count;
    const observer = scene.onAfterRenderObservable.add(() => {
      remaining -= 1;
      if (remaining <= 0) {
        scene.onAfterRenderObservable.remove(observer);
        resolve();
      }
    });
  });
}

/** Baut die API; Zustand wechselt per `markReady`/`markError` von "loading" nach "ready"/"error". */
export class LabController implements LabApi {
  status: "loading" | "ready" | "error" = "loading";
  error: string | null = null;
  backend: BackendName;
  private parts: LabApiParts | null = null;

  constructor(backend: BackendName) {
    this.backend = backend;
  }

  get ready(): boolean {
    return this.status === "ready";
  }

  markReady(parts: LabApiParts): void {
    this.parts = parts;
    this.backend = parts.backend;
    this.status = "ready";
  }

  markError(message: string): void {
    this.error = message;
    this.status = "error";
  }

  stats(): LabStats {
    return this.requireParts().stats();
  }

  async setView(mode: ViewMode): Promise<void> {
    const parts = this.requireParts();
    parts.sheet.setView(mode);
    await renderFrames(parts.scene, 3);
  }

  async setDebug(mode: DebugMode): Promise<void> {
    const parts = this.requireParts();
    parts.debug.set(mode);
    await renderFrames(parts.scene, 3);
  }

  async setAnimationTime(name: string, seconds: number): Promise<void> {
    const parts = this.requireParts();
    parts.animation.setTime(name, seconds);
    await renderFrames(parts.scene, 3);
  }

  private requireParts(): LabApiParts {
    if (!this.parts) throw new Error(`Lab nicht bereit (status=${this.status}, error=${this.error ?? "-"})`);
    return this.parts;
  }
}

declare global {
  interface Window {
    __lab: LabApi;
  }
}
