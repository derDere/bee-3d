// Einstieg der Effekt-Werkstatt (fx-lab.html, nur Entwicklung): Szene mit Biene und Fliegen, alle Effekte
// per Knopf, Großkampf mit Kennzahlen. Prüf-Agenten steuern die Werkstatt über window.__fx.
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import { createEngine } from "../../../core/engineFactory";
import { EffectsSystem, type EffectStatistics } from "../effectsSystem";
import { LabActors } from "./labActors";
import { LabPanel, type LabControls } from "./labPanel";
import { LabScenarios } from "./labScenarios";
import { LabScene } from "./labScene";
import { LabStats, type LabMeasurement } from "./labStats";

/** Debug-API der Werkstatt für Prüfläufe (Werkstatt-API). */
export interface FxLabApi {
  /** Modelle geladen (oder Platzhalter endgültig), erste Frames gerendert. */
  readonly ready: boolean;
  scenarioIds(): string[];
  trigger(id: string): boolean;
  toggleFreeLaser(): boolean;
  setBattle(enabled: boolean): void;
  setDistance(meters: number): void;
  setCameraAngles(alpha: number, beta: number): void;
  setWarp(intensity: number): void;
  setMoteSpeed(speed: number): void;
  setSlowMotion(enabled: boolean): void;
  setPaused(paused: boolean): void;
  /** Handbetrieb: Die Renderschleife steht still, advance() rückt mit festem Zeitschritt vor (reproduzierbare Standbilder). */
  setManual(enabled: boolean): void;
  /** Rendert `seconds` Sekunden mit `fps` Bildern je Sekunde im Handbetrieb; liefert die CPU-Zeit des Effektsystems je Frame. */
  advance(seconds: number, fps?: number): { frames: number; effectsMsAverage: number; effectsMsP95: number; effectsMsMax: number };
  stats(): EffectStatistics;
  measure(seconds: number): Promise<LabMeasurement>;
  /** Positionen aller lebenden Darsteller (Name → x, y, z) zum Ausrichten der Kamera. */
  actorPositions(): Record<string, [number, number, number]>;
  /** Richtet die Kamera auf einen Punkt aus (Orbit um diesen Punkt). */
  lookAt(x: number, y: number, z: number): void;
  /** Kamera folgt wieder der Biene. */
  followBee(): void;
}

declare global {
  interface Window {
    __fx?: FxLabApi;
  }
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) {
    throw new Error(`Element #${id} fehlt.`);
  }
  return found;
}

async function main(): Promise<void> {
  const canvas = element("fx-canvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("#fx-canvas ist kein Canvas.");
  }
  registerBuiltInLoaders();
  const engine = await createEngine(canvas);
  const lab = new LabScene(engine);
  const actors = new LabActors(lab.scene);
  lab.camera.setTarget(actors.bee.root.position);
  const effects = new EffectsSystem(lab.scene, lab.camera);
  const scenarios = new LabScenarios(effects, actors, lab);
  const stats = new LabStats(lab.scene, engine, effects, element("fx-stats"));

  let timeScale = 1;
  let paused = false;
  let manual = false;
  let manualStep = 0;
  const controls: LabControls = {
    setDistance: (meters) => lab.setDistance(meters),
    setSlowMotion: (enabled) => {
      timeScale = enabled ? 0.25 : 1;
    },
    setPaused: (value) => {
      paused = value;
    },
  };
  new LabPanel(element("fx-panel"), scenarios, controls);

  let lastEffectsMs = 0;
  lab.scene.onBeforeRenderObservable.add(() => {
    const realDt = paused ? 0 : Math.min(0.1, engine.getDeltaTime() / 1000) * timeScale;
    const dt = manual ? manualStep * timeScale : realDt;
    actors.update(dt);
    scenarios.update(dt);
    const start = performance.now();
    effects.frameUpdate(dt);
    lastEffectsMs = performance.now() - start;
    stats.recordEffects(lastEffectsMs);
  });
  window.addEventListener("resize", () => engine.resize());
  engine.runRenderLoop(() => lab.scene.render());

  let ready = false;
  window.__fx = {
    get ready() {
      return ready;
    },
    scenarioIds: () => scenarios.scenarios.map((scenario) => scenario.id),
    trigger: (id) => scenarios.trigger(id),
    toggleFreeLaser: () => scenarios.toggleFreeLaser(),
    setBattle: (enabled) => scenarios.setBattle(enabled),
    setDistance: (meters) => lab.setDistance(meters),
    setCameraAngles: (alpha, beta) => {
      lab.camera.alpha = alpha;
      lab.camera.beta = beta;
    },
    setWarp: (intensity) => scenarios.setWarp(intensity),
    setMoteSpeed: (speed) => scenarios.setMoteSpeed(speed),
    setSlowMotion: (enabled) => controls.setSlowMotion(enabled),
    setPaused: (value) => controls.setPaused(value),
    setManual: (enabled) => {
      manual = enabled;
      manualStep = 0;
    },
    advance: (seconds, fps = 60) => {
      manual = true;
      const frames = Math.max(1, Math.round(seconds * fps));
      const samples: number[] = [];
      for (let i = 0; i < frames; i++) {
        manualStep = 1 / fps;
        engine.beginFrame();
        lab.scene.render();
        engine.endFrame();
        samples.push(lastEffectsMs);
      }
      manualStep = 0;
      samples.sort((a, b) => a - b);
      const sum = samples.reduce((total, value) => total + value, 0);
      return {
        frames,
        effectsMsAverage: sum / frames,
        effectsMsP95: samples[Math.min(frames - 1, Math.floor(frames * 0.95))],
        effectsMsMax: samples[frames - 1],
      };
    },
    stats: () => effects.statistics,
    measure: (seconds) => stats.measure(seconds),
    actorPositions: () => {
      const result: Record<string, [number, number, number]> = {};
      for (const actor of [...actors.allBees(), ...actors.allFlies()]) {
        if (actor.isAlive) {
          const p = actor.root.position;
          result[actor.root.name] = [p.x, p.y, p.z];
        }
      }
      return result;
    },
    lookAt: (x, y, z) => lab.camera.setTarget(new Vector3(x, y, z)),
    followBee: () => lab.camera.setTarget(actors.bee.root.position),
  };
  await actors.loadModelsAsync();
  await lab.scene.whenReadyAsync();
  ready = true;
}

void main().catch((error: unknown) => {
  console.error("[fx-lab]", error);
  const box = document.getElementById("fx-error");
  if (box !== null) {
    box.style.display = "block";
    box.textContent = `FX-Lab konnte nicht starten:\n${String(error)}`;
  }
});
