// src/hud/honeycombBar.ts — Modulleiste F1–F8 als geschwungene Wabenreihe: Jede Zelle füllt sich während
// des Zyklus mit Honig, die F-Taste steht als Abzeichen darauf.

import { AttributeSlot, createButton, createElement, HintSlot, setVisible } from "./dom";
import { clamp01 } from "./format";
import type { HudActions, ModuleHud, ModuleIcon } from "./hudTypes";
import { createKeyBadge } from "./iconButton";
import { IconSlot } from "./icons";

const Ink = "#5b3a1e";
/** Spitze Sechseckwabe (Breite 100, Höhe 115,47). */
const Hex = "50,3 97,30 97,85.5 50,112.5 3,85.5 3,30";
const HexInner = "50,11 90,34 90,81.5 50,104.5 10,81.5 10,34";
const CellHeight = 115.47;
/** Wölbung der Reihe: Anhebung in Zellbreiten je Quadrat des Abstands zur Mitte. */
const ArcLift = 0.034;
/** Abstand zweier Zellmitten in Zellbreiten. */
const ArcStep = 1.08;

let nextClip = 0;

/** Honig-Oberfläche mit Wellen, oben bei y = 0 (Honigspiegel). */
function honeyPath(): string {
  let d = "M-40 0";
  for (let x = -40; x < 140; x += 20) {
    d += "q5 -4 10 0t10 0";
  }
  return `${d}V140H-40z`;
}

/** Eine Wabenzelle (Modulzelle). */
class HoneyCell {
  public readonly element: HTMLButtonElement;
  public slot = -1;
  private readonly level: AttributeSlot;
  private readonly icon: IconSlot;
  private readonly key: HTMLSpanElement;
  private readonly hint: HintSlot;
  private iconName: ModuleIcon | undefined;
  private hotkey = "";
  private title = "";
  private label = "";
  private progressStep = -1;
  private lastProgress = 0;

  public constructor(parent: HTMLElement) {
    nextClip++;
    const clip = `hud-cell-${nextClip}`;
    this.element = createButton("cell", parent);
    this.element.tabIndex = -1;
    const holder = document.createElement("template");
    holder.innerHTML =
      `<svg xmlns="http://www.w3.org/2000/svg" class="cell-svg" viewBox="0 0 100 ${CellHeight}" aria-hidden="true" focusable="false">` +
      `<defs><clipPath id="${clip}"><polygon points="${Hex}"/></clipPath></defs>` +
      `<polygon class="cell-wax" points="${Hex}"/>` +
      `<g clip-path="url(#${clip})"><g class="cell-level" transform="translate(0 ${CellHeight})"><path class="cell-honey" d="${honeyPath()}"/></g></g>` +
      `<polygon class="cell-shine" points="${HexInner}" fill="none"/>` +
      `<polygon class="cell-rim" points="${Hex}" fill="none" stroke="${Ink}" stroke-width="6" stroke-linejoin="round"/>` +
      `</svg>`;
    const svg = holder.content.firstElementChild;
    const level = svg?.querySelector(".cell-level");
    if (!(svg instanceof SVGSVGElement) || level === null || level === undefined) {
      throw new Error("Wabenzelle ließ sich nicht anlegen.");
    }
    this.element.appendChild(svg);
    this.level = new AttributeSlot(level, "transform");
    this.icon = new IconSlot(createElement("span", "cell-icon", this.element), "cell-icon-svg");
    this.key = createKeyBadge("", this.element);
    createElement("span", "cell-pause", this.element);
    this.hint = new HintSlot(this.element);
  }

  /** Platz auf dem Bogen: Versatz zur Mitte in Zellen. */
  public place(offset: number): void {
    const style = this.element.style;
    style.setProperty("--offset", String(offset * ArcStep));
    style.setProperty("--lift", String(ArcLift * offset * offset));
    style.setProperty("--tilt", `${(-Math.atan((2 * ArcLift * offset) / ArcStep) * 180) / Math.PI}deg`);
  }

  public update(module: ModuleHud): void {
    this.slot = module.slot;
    if (module.icon !== this.iconName) {
      this.iconName = module.icon;
      this.icon.set(module.icon);
    }
    if (module.hotkey !== this.hotkey || module.title !== this.title) {
      this.hotkey = module.hotkey;
      this.title = module.title;
      this.label = `${module.title} (${module.hotkey})`;
      this.key.textContent = module.hotkey;
    }
    this.hint.set(this.label, module.tooltip);
    const classes = this.element.classList;
    classes.toggle("is-active", module.active);
    classes.toggle("is-stopping", module.stopping);
    classes.toggle("is-unavailable", !module.available && !module.active);
    const progress = module.active ? clamp01(module.cycleProgress) : 0;
    if (module.active && progress < this.lastProgress - 0.5) {
      // Ein Zyklus ist durch: kurzes Hüpfen der Zelle
      this.element.animate([{ scale: "1" }, { scale: "1.12" }, { scale: "1" }], { duration: 260, easing: "ease-out" });
    }
    this.lastProgress = progress;
    const step = Math.round(progress * 200);
    if (step !== this.progressStep) {
      this.progressStep = step;
      this.level.set(`translate(0 ${((1 - step / 200) * CellHeight).toFixed(1)})`);
    }
  }
}

/** Wabenreihe der Module unten in der Mitte (Wabenleiste). */
export class HoneycombBar {
  /** Wurzelelement (Bedienfeld für den Feldschutz). */
  public readonly element: HTMLDivElement;
  private readonly cells: HoneyCell[] = [];
  private readonly byElement = new WeakMap<Element, HoneyCell>();
  private readonly actions: HudActions;

  private readonly onClick = (event: MouseEvent): void => {
    const button = event.target instanceof Element ? event.target.closest(".cell") : null;
    const cell = button === null ? undefined : this.byElement.get(button);
    if (cell !== undefined && cell.slot >= 0) {
      this.actions.toggleModule(cell.slot);
    }
  };

  public constructor(parent: HTMLElement, actions: HudActions) {
    this.actions = actions;
    this.element = createElement("div", "honeycomb-bar", parent);
    this.element.setAttribute("aria-label", "Powers");
    this.element.addEventListener("click", this.onClick);
  }

  public update(modules: readonly ModuleHud[]): void {
    if (modules.length !== this.cells.length) {
      this.rebuild(modules.length);
    }
    for (let index = 0; index < this.cells.length; index++) {
      this.cells[index].update(modules[index]);
    }
  }

  public setVisible(visible: boolean): void {
    setVisible(this.element, visible);
  }

  public dispose(): void {
    this.element.removeEventListener("click", this.onClick);
    this.element.remove();
  }

  /** Legt die Zellen neu an, wenn sich die Zahl der Module ändert, und verteilt sie auf dem Bogen. */
  private rebuild(count: number): void {
    while (this.cells.length < count) {
      const cell = new HoneyCell(this.element);
      this.byElement.set(cell.element, cell);
      this.cells.push(cell);
    }
    while (this.cells.length > count) {
      this.cells.pop()?.element.remove();
    }
    const middle = (count - 1) / 2;
    this.cells.forEach((cell, index) => cell.place(index - middle));
    this.element.style.setProperty("--cells", String(count));
  }
}
