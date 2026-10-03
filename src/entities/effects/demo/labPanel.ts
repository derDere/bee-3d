// Bedienfeld der Effekt-Werkstatt: Knöpfe je Effekt, Schalter für Flug und Großkampf, Kameraabstand,
// Zeitlupe und Pause.
import type { LabScenarios } from "./labScenarios";

/** Steuerung der Werkstatt, die das Bedienfeld auslöst (Werkstatt-Steuerung). */
export interface LabControls {
  setDistance(meters: number): void;
  setSlowMotion(enabled: boolean): void;
  setPaused(paused: boolean): void;
}

const Distances: readonly number[] = [1, 5, 20, 60];

/** HTML-Bedienfeld der Werkstatt (Bedienfeld). */
export class LabPanel {
  private readonly host: HTMLElement;
  private readonly scenarios: LabScenarios;
  private readonly controls: LabControls;

  public constructor(host: HTMLElement, scenarios: LabScenarios, controls: LabControls) {
    this.host = host;
    this.scenarios = scenarios;
    this.controls = controls;
    this.build();
  }

  private build(): void {
    const groups = new Map<string, HTMLElement>();
    for (const scenario of this.scenarios.scenarios) {
      let row = groups.get(scenario.group);
      if (row === undefined) {
        row = this.section(scenario.group);
        groups.set(scenario.group, row);
      }
      row.appendChild(this.button(scenario.label, () => scenario.run(), `fx-${scenario.id}`));
    }

    const flight = this.section("Flug");
    flight.appendChild(this.toggle("Freier Laser", "fx-freeLaser", () => this.scenarios.toggleFreeLaser()));
    let warpOn = false;
    let warpLevel = 1;
    flight.appendChild(
      this.toggle("Warp", "fx-warp", () => {
        warpOn = !warpOn;
        this.scenarios.setWarp(warpOn ? warpLevel : 0);
        return warpOn;
      }),
    );
    this.host.appendChild(
      this.slider("Warp-Stärke", "fx-warpLevel", 0, 1, 0.05, warpLevel, (value) => {
        warpLevel = value;
        if (warpOn) {
          this.scenarios.setWarp(value);
        }
      }),
    );
    this.host.appendChild(this.slider("Fahrtwind m/s", "fx-motes", 0, 40, 1, 0, (value) => this.scenarios.setMoteSpeed(value)));

    const battle = this.section("Großkampf");
    battle.appendChild(
      this.toggle("Alles gleichzeitig", "fx-battle", () => {
        this.scenarios.setBattle(!this.scenarios.isBattle);
        return this.scenarios.isBattle;
      }),
    );

    const view = this.section("Ansicht");
    for (const distance of Distances) {
      view.appendChild(this.button(`${distance} m`, () => this.controls.setDistance(distance), `fx-distance-${distance}`));
    }
    const time = this.section("Zeit");
    let slow = false;
    let paused = false;
    time.appendChild(
      this.toggle("Zeitlupe ¼", "fx-slow", () => {
        slow = !slow;
        this.controls.setSlowMotion(slow);
        return slow;
      }),
    );
    time.appendChild(
      this.toggle("Pause", "fx-pause", () => {
        paused = !paused;
        this.controls.setPaused(paused);
        return paused;
      }),
    );
  }

  /** Leert das Bedienfeld (Knöpfe samt Listenern). */
  public dispose(): void {
    this.host.replaceChildren();
  }

  private section(title: string): HTMLElement {
    const heading = document.createElement("h2");
    heading.textContent = title;
    const row = document.createElement("div");
    row.className = "row";
    this.host.append(heading, row);
    return row;
  }

  private button(label: string, onClick: () => void, id: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.id = id;
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  /** Schalter: `onToggle` liefert den neuen Zustand, der Knopf zeigt ihn an. */
  private toggle(label: string, id: string, onToggle: () => boolean): HTMLButtonElement {
    const button = this.button(label, () => button.classList.toggle("on", onToggle()), id);
    return button;
  }

  private slider(label: string, id: string, min: number, max: number, step: number, value: number, onInput: (value: number) => void): HTMLLabelElement {
    const wrapper = document.createElement("label");
    const caption = document.createElement("span");
    caption.textContent = label;
    const input = document.createElement("input");
    input.type = "range";
    input.id = id;
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    const display = document.createElement("span");
    display.className = "value";
    display.textContent = String(value);
    input.addEventListener("input", () => {
      const current = Number(input.value);
      display.textContent = String(current);
      onInput(current);
    });
    wrapper.append(caption, input, display);
    return wrapper;
  }
}
