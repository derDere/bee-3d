// src/hud/topBar.ts — oben rechts: Honigtopf, Himmelsplakette (Tageszeit, Uhr, Wetter), Hilfe und Menü.

import { createElement, HintSlot, NumberSlot, setHint, setVisible, TextSlot } from "./dom";
import { formatInteger } from "./format";
import type { DayPhaseIcon, HudActions, HudModel, WeatherIcon } from "./hudTypes";
import { createIconButton } from "./iconButton";
import { createIcon, IconSlot } from "./icons";

/** Was die Leiste von der Oberfläche braucht (Leisten-Gastgeber). */
export interface TopBarHost {
  toggleMenu(): void;
}

/** Leiste oben rechts (Kopfleiste). */
export class TopBar {
  /** Wurzelelement (Bedienfeld für den Feldschutz). */
  public readonly element: HTMLDivElement;
  private readonly honeyCounter: HTMLDivElement;
  private readonly honey: NumberSlot;
  private readonly sky: HTMLDivElement;
  private readonly phase: IconSlot;
  private readonly weather: IconSlot;
  private readonly clock: TextSlot;
  private readonly skyHint: HintSlot;
  private readonly helpButton: HTMLButtonElement;
  private phaseName: DayPhaseIcon | undefined;
  private weatherName: WeatherIcon | undefined;
  private phaseLabel = "";
  private weatherLabel = "";
  private helpShown: boolean | undefined;

  public constructor(parent: HTMLElement, actions: HudActions, host: TopBarHost) {
    this.element = createElement("div", "top-bar", parent);

    this.honeyCounter = createElement("div", "honey-counter", this.element);
    setHint(this.honeyCounter, "Honey", "Spend it in the hive workshop.");
    createIcon("honey", "honey-counter-icon", this.honeyCounter);
    this.honey = new NumberSlot(createElement("span", "honey-counter-value", this.honeyCounter), formatInteger);

    this.sky = createElement("div", "sky-badge", this.element);
    this.skyHint = new HintSlot(this.sky);
    this.phase = new IconSlot(createElement("span", "sky-phase", this.sky), "sky-icon");
    this.clock = new TextSlot(createElement("span", "sky-clock", this.sky));
    this.weather = new IconSlot(createElement("span", "sky-weather", this.sky), "sky-icon");

    this.helpButton = createIconButton("round-btn help-btn", "help", "Key help", this.element, "H");
    this.helpButton.tabIndex = -1;
    this.helpButton.addEventListener("click", () => actions.toggleHelp());
    const menu = createIconButton("round-btn menu-btn", "menu", "Menu", this.element, "Esc");
    menu.tabIndex = -1;
    menu.addEventListener("click", () => host.toggleMenu());
  }

  public update(model: HudModel): void {
    const player = model.player;
    setVisible(this.honeyCounter, player !== undefined);
    if (player !== undefined) {
      this.honey.set(player.honey);
    }
    const sky = model.sky;
    if (sky.phase !== this.phaseName) {
      this.phaseName = sky.phase;
      this.phase.set(sky.phase);
      this.sky.classList.toggle("is-night", sky.isNight);
    }
    if (sky.weather !== this.weatherName) {
      this.weatherName = sky.weather;
      this.weather.set(sky.weather);
    }
    this.clock.set(sky.clock);
    if (sky.phaseLabel !== this.phaseLabel || sky.weatherLabel !== this.weatherLabel) {
      this.phaseLabel = sky.phaseLabel;
      this.weatherLabel = sky.weatherLabel;
      this.skyHint.set(sky.phaseLabel, sky.weatherLabel);
    }
    if (model.showHelp !== this.helpShown) {
      this.helpShown = model.showHelp;
      this.helpButton.classList.toggle("is-on", model.showHelp);
      this.helpButton.setAttribute("aria-pressed", String(model.showHelp));
    }
  }

  public dispose(): void {
    this.element.remove();
  }
}
