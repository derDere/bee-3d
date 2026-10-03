// src/hud/settingsMenu.ts — Menü (Esc): Grafik, Lautstärke, Musik, Maus invertieren, weniger Blitze,
// Tastenhilfe und die Steuerungshilfe; Weiterspielen über den runden Knopf.

import { ControlSections, type ControlSection } from "./controlsReference";
import { createElement, setHint, setVisible, TextSlot } from "./dom";
import { formatPercent } from "./format";
import type { HudActions, HudSettings } from "./hudTypes";
import { createIconButton } from "./iconButton";
import { createIcon, type IconName } from "./icons";

/** Qualitätswahl des Menüs (Qualitätsstufe). */
export type QualityChoice = HudSettings["quality"];

const QualityOptions: ReadonlyArray<{ readonly value: QualityChoice; readonly icon: IconName; readonly label: string }> = [
  { value: "auto", icon: "qualityAuto", label: "Automatic" },
  { value: "low", icon: "qualityLow", label: "Low" },
  { value: "medium", icon: "qualityMedium", label: "Medium" },
  { value: "high", icon: "qualityHigh", label: "High" },
  { value: "ultra", icon: "qualityUltra", label: "Ultra" },
];

/** Was das Menü von der Oberfläche braucht (Menü-Gastgeber). */
export interface SettingsMenuHost {
  /** Schließt das Menü (Weiterspielen, Klick neben das Fenster). */
  close(): void;
  /** Meldet Darstellungswerte, auf die die Oberfläche selbst reagiert. */
  applyDisplay(quality: QualityChoice, reduceFlashes: boolean): void;
}

type MenuPage = "settings" | "controls";

const Pages: ReadonlyArray<{ readonly page: MenuPage; readonly icon: IconName; readonly label: string }> = [
  { page: "settings", icon: "menu", label: "Settings" },
  { page: "controls", icon: "keyboard", label: "Controls" },
];

/** Einstellungsmenü (Menü). */
export class SettingsMenu {
  private readonly element: HTMLDivElement;
  private readonly dialog: HTMLElement;
  private readonly actions: HudActions;
  private readonly host: SettingsMenuHost;
  private readonly master: HTMLInputElement;
  private readonly music: HTMLInputElement;
  private readonly masterValue: TextSlot;
  private readonly musicValue: TextSlot;
  private readonly helpToggle: HTMLInputElement;
  private readonly pageButtons: HTMLButtonElement[] = [];
  private readonly pages: Readonly<Record<MenuPage, HTMLElement>>;
  private quality: QualityChoice;
  private reduceFlashes: boolean;
  private page: MenuPage = "settings";
  private showHelp: boolean | undefined;

  private readonly onBackdrop = (event: MouseEvent): void => {
    if (event.target === this.element) {
      this.host.close();
    }
  };

  private readonly onVolume = (): void => {
    const master = Number(this.master.value) / 100;
    const music = Number(this.music.value) / 100;
    this.masterValue.set(formatPercent(master));
    this.musicValue.set(formatPercent(music));
    this.actions.setVolume(master, music);
  };

  public constructor(parent: HTMLElement, settings: HudSettings, actions: HudActions, host: SettingsMenuHost) {
    this.actions = actions;
    this.host = host;
    this.quality = settings.quality;
    this.reduceFlashes = settings.reduceFlashes;
    this.element = createElement("div", "menu-backdrop", parent);
    this.dialog = createElement("section", "menu", this.element);
    this.dialog.setAttribute("role", "dialog");
    this.dialog.setAttribute("aria-modal", "true");
    this.dialog.setAttribute("aria-labelledby", "hud-menu-title");
    this.dialog.tabIndex = -1;

    const header = createElement("header", "menu-header", this.dialog);
    createElement("h2", "visually-hidden", header, "Menu").id = "hud-menu-title";
    const tabs = createElement("div", "menu-tabs", header);
    tabs.setAttribute("role", "tablist");
    for (const { page, icon, label } of Pages) {
      const button = createIconButton("menu-tab", icon, label, tabs);
      button.setAttribute("role", "tab");
      button.addEventListener("click", () => this.setPage(page));
      this.pageButtons.push(button);
    }
    const resume = createIconButton("round-btn big-btn menu-resume", "play", "Resume", header, "Esc");
    resume.addEventListener("click", () => this.host.close());

    const settingsPage = createElement("div", "menu-page menu-settings", this.dialog);
    const quality = this.row(settingsPage, "qualityHigh", "Graphics");
    const segmented = createElement("div", "segmented", quality);
    segmented.setAttribute("role", "radiogroup");
    segmented.setAttribute("aria-label", "Graphics quality");
    for (const option of QualityOptions) {
      const label = createElement("label", "segment", segmented);
      setHint(label, option.label);
      const input = createElement("input", "", label);
      input.type = "radio";
      input.name = "hud-quality";
      input.value = option.value;
      input.checked = option.value === settings.quality;
      input.setAttribute("aria-label", option.label);
      input.addEventListener("change", () => this.chooseQuality(option.value));
      createElement("span", "segment-face", label).appendChild(createIcon(option.icon, "segment-icon"));
    }
    [this.master, this.masterValue] = this.slider(this.row(settingsPage, "speaker", "Sound"), "hud-volume", "Sound volume", settings.masterVolume);
    [this.music, this.musicValue] = this.slider(this.row(settingsPage, "music", "Music"), "hud-music", "Music volume", settings.musicVolume);
    this.toggle(this.row(settingsPage, "mouseInvert", "Invert mouse"), "hud-invert-y", "Turn the camera up and down the other way", settings.invertY, (on) =>
      actions.setInvertY(on),
    );
    this.toggle(this.row(settingsPage, "flashOff", "Fewer flashes"), "hud-fewer-flashes", "Softer lightning and calmer warnings", settings.reduceFlashes, (on) => {
      this.reduceFlashes = on;
      actions.setReduceFlashes(on);
      this.host.applyDisplay(this.quality, this.reduceFlashes);
    });
    this.helpToggle = this.toggle(this.row(settingsPage, "help", "Key help"), "hud-key-help", "Also with the H key", false, () => actions.toggleHelp());

    const controlsPage = createElement("div", "menu-page menu-controls", this.dialog);
    for (const section of ControlSections) {
      this.controlSection(controlsPage, section);
    }
    this.pages = { settings: settingsPage, controls: controlsPage };
    this.element.addEventListener("click", this.onBackdrop);
    this.refreshPages();
  }

  /** Zeigt die Seite „Einstellungen“ und setzt den Fokus in das Fenster. */
  public focus(): void {
    this.setPage("settings");
    this.dialog.focus({ preventScroll: true });
  }

  public update(showHelp: boolean): void {
    if (showHelp !== this.showHelp) {
      this.showHelp = showHelp;
      this.helpToggle.checked = showHelp;
    }
  }

  public dispose(): void {
    this.element.removeEventListener("click", this.onBackdrop);
    this.element.remove();
  }

  private chooseQuality(quality: QualityChoice): void {
    this.quality = quality;
    this.actions.setQuality(quality);
    this.host.applyDisplay(this.quality, this.reduceFlashes);
  }

  private setPage(page: MenuPage): void {
    if (page !== this.page) {
      this.page = page;
      this.refreshPages();
    }
  }

  private refreshPages(): void {
    Pages.forEach(({ page }, index) => {
      const current = page === this.page;
      const button = this.pageButtons[index];
      button.classList.toggle("is-current", current);
      button.setAttribute("aria-selected", String(current));
      setVisible(this.pages[page], current);
    });
  }

  /** Einstellungszeile mit Symbol und kurzem englischem Namen. */
  private row(parent: HTMLElement, icon: IconName, label: string): HTMLDivElement {
    const row = createElement("div", "menu-row", parent);
    const name = createElement("div", "menu-row-name", row);
    createIcon(icon, "menu-row-icon", name);
    createElement("span", "menu-row-label", name, label);
    return createElement("div", "menu-row-control", row);
  }

  /** Schieberegler 0–100 % mit Wertanzeige. */
  private slider(parent: HTMLElement, name: string, label: string, value: number): [HTMLInputElement, TextSlot] {
    const input = createElement("input", "slider", parent);
    input.type = "range";
    input.name = name;
    input.min = "0";
    input.max = "100";
    input.step = "1";
    input.value = String(Math.round(value * 100));
    input.setAttribute("aria-label", label);
    input.addEventListener("input", this.onVolume);
    const display = new TextSlot(createElement("span", "slider-value", parent));
    display.set(formatPercent(value));
    return [input, display];
  }

  private toggle(parent: HTMLElement, name: string, hint: string, checked: boolean, change: (on: boolean) => void): HTMLInputElement {
    const label = createElement("label", "switch-box", parent);
    setHint(label, hint);
    const input = createElement("input", "switch", label);
    input.type = "checkbox";
    input.name = name;
    input.checked = checked;
    input.setAttribute("aria-label", hint);
    input.addEventListener("change", () => change(input.checked));
    return input;
  }

  private controlSection(parent: HTMLElement, section: ControlSection): void {
    const block = createElement("section", "controls-section", parent);
    const title = createElement("h3", "controls-title", block);
    createIcon(section.icon, "controls-title-icon", title);
    createElement("span", "", title, section.title);
    if (section.intro !== undefined) {
      createElement("p", "controls-intro", block, section.intro);
    }
    const list = createElement("ul", "controls-list", block);
    for (const row of section.rows) {
      const item = createElement("li", "controls-row", list);
      createElement(section.keys ? "kbd" : "span", section.keys ? "controls-key" : "controls-gesture", item, row.input);
      const text = createElement("div", "controls-text", item);
      createElement("span", "controls-effect", text, row.effect);
      if (row.note !== undefined) {
        createElement("span", "controls-note", text, row.note);
      }
    }
    if (section.footnote !== undefined) {
      createElement("p", "controls-footnote", block, section.footnote);
    }
  }
}
