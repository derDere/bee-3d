// src/hud/demo/hudDemo.ts — Entwicklungsseite der Oberfläche (hud-demo.html): Mock-Spiel, Szenario-Umschalter,
// Blütenkranz mit neun Einträgen, Symboltafel und Konsolenprotokoll aller HUD-Aktionen. Adressparameter:
// `scenario` (start, flight, docked, ghost), `scale` (UI scale als Faktor, z. B. 0.7) und `icons=1`.
// Nur für die Entwicklung, nicht Teil des Spiels.

import { Hud } from "../hud";
import type { ContextMenuEntry, HudSettings } from "../hudTypes";
import { createIcon, IconNames } from "../icons";
import { DemoScenarios, MockGame, type DemoScenario } from "./mockGame";

const ScenarioLabels: Readonly<Record<DemoScenario, string>> = {
  start: "Start",
  flight: "Flight",
  docked: "Docked",
  ghost: "Ghost",
};

/** Einstellungen der Seite; `scale` aus der Adresse ersetzt die Grundgröße der Oberfläche. */
function demoSettings(params: URLSearchParams): HudSettings {
  const scale = Number(params.get("scale") ?? "1");
  return {
    quality: "auto",
    masterVolume: 0.8,
    musicVolume: 0.5,
    invertY: false,
    reduceFlashes: false,
    uiScale: Number.isFinite(scale) && scale > 0 ? scale : 1,
    suggestedName: "Waggle Walter",
  };
}

function isScenario(value: string | null): value is DemoScenario {
  return value !== null && (DemoScenarios as readonly string[]).includes(value);
}

/** Entwicklungsseite mit Mock-Spiel (HUD-Demo). */
class HudDemo {
  private readonly game = new MockGame();
  private readonly hud: Hud;
  private readonly scene: HTMLElement;
  private readonly scenarioButtons = new Map<DemoScenario, HTMLButtonElement>();
  private readonly connectionButton: HTMLButtonElement;
  private readonly touchReadout: HTMLElement;
  private readonly iconSheet: HTMLElement;
  private last = performance.now();
  private fps = 60;

  private readonly loop = (now: number): void => {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (dt > 0) {
      this.fps += (1 / dt - this.fps) * 0.05;
    }
    this.game.tick(dt);
    this.hud.update(this.game.snapshot(window.innerWidth, window.innerHeight, this.fps));
    this.refreshTouchReadout();
    requestAnimationFrame(this.loop);
  };

  /** Rechtsklick in den leeren Raum: Raum-Menü über die öffentliche Hud-API. */
  private readonly onSceneContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    const entries: ContextMenuEntry[] = [
      { icon: "flyHere", label: "Fly this way", hotkey: "Dbl", enabled: true, run: () => console.info("[Demo] space: fly this way", event.clientX, event.clientY) },
      { icon: "approach", label: "Open the dial", hotkey: "Q", enabled: true, run: () => console.info("[Demo] space: dial") },
      { icon: "stop", label: "Stop", enabled: true, run: () => this.game.command("stop") },
      { icon: "home", label: "Fly home", enabled: false, run: () => undefined },
    ];
    this.hud.showContextMenu(event.clientX, event.clientY, entries, "Open sky");
  };

  private readonly onSceneDoubleClick = (event: MouseEvent): void => {
    console.info("[Demo] double-click into space", event.clientX, event.clientY);
  };

  /** Größter Blütenkranz wie das Objektmenü des Spiels: neun Einträge mit Abstandsfähnchen und Ansehen. */
  private readonly onLargeMenu = (): void => {
    const log = (entry: string) => () => console.info(`[Demo] hive menu: ${entry}`);
    const entries: ContextMenuEntry[] = [
      { icon: "select", label: "Select Queen's Hive", enabled: true, run: log("select") },
      { icon: "approach", label: "Approach", hotkey: "Q", enabled: true, run: log("approach") },
      { icon: "orbit", label: "Orbit at 20 m", detail: "20 m", hotkey: "W", enabled: true, run: log("orbit") },
      { icon: "keepRange", label: "Keep range at 15 m", detail: "15 m", hotkey: "E", enabled: true, run: log("keep range") },
      { icon: "align", label: "Align", hotkey: "A", enabled: true, run: log("align") },
      { icon: "warp", label: "Warp", hotkey: "S", enabled: false, run: log("warp") },
      { icon: "dock", label: "Dock", hotkey: "D", enabled: true, run: log("dock") },
      { icon: "lock", label: "Lock target", hotkey: "Ctrl+Click", enabled: true, run: log("lock") },
      { icon: "lookAt", label: "Look at", enabled: true, active: false, run: log("look at") },
    ];
    this.hud.showContextMenu(window.innerWidth / 2, window.innerHeight / 2, entries, "Queen's Hive");
  };

  /** Vertritt die Tastatursteuerung des Spiels: H schaltet die Tastenhilfe, 1–4 wechseln das Szenario. */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.game.typing || event.ctrlKey || event.altKey || event.metaKey || event.repeat) {
      return;
    }
    if (event.code === "KeyH") {
      this.game.toggleHelp();
      return;
    }
    const index = Number(event.key) - 1;
    if (index >= 0 && index < DemoScenarios.length) {
      this.setScenario(DemoScenarios[index]);
    }
  };

  public constructor() {
    const root = document.getElementById("hud");
    const scene = document.getElementById("demo-scene");
    const dock = document.getElementById("demo-dock");
    if (root === null || scene === null || dock === null) {
      throw new Error("hud-demo.html: #hud, #demo-scene oder #demo-dock fehlt.");
    }
    this.scene = scene;
    const params = new URLSearchParams(window.location.search);
    this.hud = new Hud(root, this.game, demoSettings(params));
    // Die Szene vertritt den Canvas des Spiels: dorthin kehrt der Tastaturfokus zurück
    this.hud.keyboardHome = scene;

    const panel = document.createElement("div");
    panel.className = "demo-panel";
    dock.appendChild(panel);
    const title = document.createElement("div");
    title.className = "demo-title";
    title.textContent = "HUD demo";
    panel.appendChild(title);
    DemoScenarios.forEach((scenario, index) => {
      const button = this.button(panel, `${index + 1} ${ScenarioLabels[scenario]}`, () => this.setScenario(scenario));
      this.scenarioButtons.set(scenario, button);
    });
    this.connectionButton = this.button(panel, "Network: online", () => {
      this.connectionButton.textContent = `Network: ${this.game.cycleConnection()}`;
    });
    const panButton = this.button(panel, "Camera: still", () => {
      this.game.cameraPanning = !this.game.cameraPanning;
      panButton.textContent = this.game.cameraPanning ? "Camera: panning" : "Camera: still";
    });
    this.button(panel, "Petal menu: 9 entries", this.onLargeMenu);
    this.button(panel, "Icon sheet", () => this.iconSheet.toggleAttribute("hidden"));
    this.touchReadout = document.createElement("div");
    this.touchReadout.className = "demo-touch";
    panel.appendChild(this.touchReadout);
    this.iconSheet = this.createIconSheet();

    scene.addEventListener("contextmenu", this.onSceneContextMenu);
    scene.addEventListener("dblclick", this.onSceneDoubleClick);
    // Wie im Spiel in der Erfassungsphase am Fenster
    window.addEventListener("keydown", this.onKeyDown, { capture: true });
    const requested = params.get("scenario");
    this.setScenario(isScenario(requested) ? requested : "start");
    this.iconSheet.hidden = params.get("icons") !== "1";
    Object.assign(window, { __hudDemo: { game: this.game, hud: this.hud, setScenario: (scenario: DemoScenario) => this.setScenario(scenario) } });
    requestAnimationFrame(this.loop);
  }

  private setScenario(scenario: DemoScenario): void {
    this.game.setScenario(scenario);
    for (const [key, button] of this.scenarioButtons) {
      button.classList.toggle("is-current", key === scenario);
    }
    if (scenario !== "start") {
      this.scene.focus({ preventScroll: true });
    }
  }

  /** Tafel aller Symbole mit Namen, um den Symbolsatz auf einen Blick zu prüfen. */
  private createIconSheet(): HTMLElement {
    const sheet = document.createElement("div");
    sheet.className = "demo-icons";
    for (const name of IconNames) {
      const cell = document.createElement("figure");
      cell.appendChild(createIcon(name));
      const caption = document.createElement("figcaption");
      caption.textContent = name;
      cell.appendChild(caption);
      sheet.appendChild(cell);
    }
    document.body.appendChild(sheet);
    return sheet;
  }

  private refreshTouchReadout(): void {
    const [moveX, moveY] = this.hud.touch.moveAxis();
    const [aimX, aimY] = this.hud.touch.aimAxis();
    const text = `Move ${moveX.toFixed(2)} / ${moveY.toFixed(2)}\nAim ${aimX.toFixed(2)} / ${aimY.toFixed(2)}${this.hud.touch.aimActive() ? " firing" : ""}`;
    if (this.touchReadout.textContent !== text) {
      this.touchReadout.textContent = text;
    }
  }

  private button(parent: HTMLElement, label: string, run: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", run);
    parent.appendChild(button);
    return button;
  }
}

new HudDemo();
