// src/hud/startScreen.ts — Startbildschirm: Logo „Bee3D“ in Honigschrift, Namensfeld mit Vorschlag, runder
// Startknopf (dieser Klick schaltet im Spiel den Ton frei), Verbindungsstatus und Bildkarten zur Steuerung.

import { StartHelp } from "./controlsReference";
import { createButton, createElement, setHint, TextSlot } from "./dom";
import type { ConnectionStatus, HudActions, HudSettings } from "./hudTypes";
import { createIcon, IconSlot, type IconName } from "./icons";
import type { KeyboardClaims } from "./keyboardClaims";

/** Längster erlaubter Bienenname. */
const MaxNameLength = 24;
const LogoText = "Bee3D";
/** Wachstropfen unter dem Logo: Lage in Prozent der Logobreite, Länge in em. */
const LogoDrips: ReadonlyArray<{ readonly left: number; readonly length: number }> = [
  { left: 12, length: 0.32 },
  { left: 41, length: 0.24 },
  { left: 63, length: 0.38 },
];

/** Statuszeile je Verbindungszustand (Startstatus). */
const StatusLines: Readonly<Record<ConnectionStatus, { readonly tone: string; readonly icon: IconName; readonly text: string }>> = {
  offline: { tone: "is-bad", icon: "close", text: "No server found – you can still explore on your own." },
  connecting: { tone: "is-busy", icon: "dots", text: "Connecting to the server…" },
  joining: { tone: "is-busy", icon: "dots", text: "Joining the world…" },
  online: { tone: "is-good", icon: "check", text: "Connected – other bees may be flying already." },
  reconnecting: { tone: "is-busy", icon: "dots", text: "Connection lost, reconnecting…" },
  "reload-required": { tone: "is-bad", icon: "reload", text: "There is a new version. Please reload the page." },
};

/** Startbildschirm vor dem ersten Flug (Startbildschirm). */
export class StartScreen {
  private readonly element: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly form: HTMLFormElement;
  private readonly statusLine: HTMLParagraphElement;
  private readonly statusIcon: IconSlot;
  private readonly status: TextSlot;
  private readonly actions: HudActions;
  private readonly keyboard: KeyboardClaims;
  private readonly suggestedName: string;
  private connection: ConnectionStatus | undefined;

  private readonly onFocus = (): void => this.keyboard.set("name", true);
  private readonly onBlur = (): void => this.keyboard.set("name", false);

  private readonly onSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    const name = this.input.value.trim().slice(0, MaxNameLength) || this.suggestedName;
    // Erst die Eingabe freigeben, dann starten: Der Klick ist die Nutzeraktion, mit der das Spiel den Ton freischaltet
    this.input.blur();
    this.actions.start(name);
  };

  public constructor(parent: HTMLElement, settings: HudSettings, actions: HudActions, keyboard: KeyboardClaims) {
    this.actions = actions;
    this.keyboard = keyboard;
    this.suggestedName = settings.suggestedName;
    this.element = createElement("section", "start", parent);
    this.element.setAttribute("aria-labelledby", "hud-start-title");

    const meadow = createElement("div", "start-meadow", this.element);
    meadow.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 7; index++) {
      createElement("span", "start-bubble", meadow).style.setProperty("--i", String(index));
    }

    const card = createElement("div", "start-card", this.element);
    const logo = createElement("h1", "logo", card);
    logo.id = "hud-start-title";
    logo.setAttribute("aria-label", LogoText);
    const letters = createElement("span", "logo-letters", logo);
    letters.setAttribute("aria-hidden", "true");
    Array.from(LogoText).forEach((letter, index) => {
      // Kontur und Füllung als eigene Ebenen: die Füllung liegt in der DOM-Reihenfolge darüber
      const span = createElement("span", "logo-letter", letters);
      span.style.setProperty("--i", String(index));
      createElement("span", "logo-ink", span, letter);
      createElement("span", "logo-fill", span, letter).dataset.letter = letter;
    });
    LogoDrips.forEach((drip, index) => {
      const element = createElement("span", "logo-drip", letters);
      element.style.setProperty("--i", String(index));
      element.style.setProperty("--left", String(drip.left));
      element.style.setProperty("--length", String(drip.length));
    });
    createElement("span", "logo-bee", logo).appendChild(createIcon("bee", "logo-bee-icon"));

    createElement("p", "start-tagline", card, "Collect pollen, make honey and shoo the flies!");

    this.form = createElement("form", "start-form", card);
    const field = createElement("label", "start-field", this.form);
    createIcon("pencil", "start-field-icon", field);
    createElement("span", "visually-hidden", field, "Your bee's name");
    this.input = createElement("input", "start-input", field);
    this.input.type = "text";
    this.input.name = "bee-name";
    this.input.maxLength = MaxNameLength;
    this.input.autocomplete = "off";
    this.input.spellcheck = false;
    this.input.value = settings.suggestedName;
    this.input.placeholder = settings.suggestedName;
    this.input.title = "Your bee's name";
    const go = createButton("start-go", this.form);
    go.type = "submit";
    setHint(go, "Fly!");
    createIcon("play", "start-go-icon", go);

    this.statusLine = createElement("p", "start-status", card);
    this.statusIcon = new IconSlot(createElement("span", "start-status-pip", this.statusLine), "start-status-icon");
    this.status = new TextSlot(createElement("span", "", this.statusLine));

    const help = createElement("ul", "start-help", card);
    for (const row of StartHelp) {
      const item = createElement("li", "start-help-card", help);
      createIcon(row.icon, "start-help-icon", item);
      createElement("kbd", "start-help-key", item, row.input);
      createElement("span", "start-help-effect", item, row.effect);
    }

    this.input.addEventListener("focus", this.onFocus);
    this.input.addEventListener("blur", this.onBlur);
    this.form.addEventListener("submit", this.onSubmit);
  }

  public update(connection: ConnectionStatus): void {
    if (connection === this.connection) {
      return;
    }
    if (this.connection !== undefined) {
      this.statusLine.classList.remove(StatusLines[this.connection].tone);
    }
    this.connection = connection;
    const line = StatusLines[connection];
    this.statusLine.classList.add(line.tone);
    this.statusIcon.set(line.icon);
    this.status.set(line.text);
  }

  /** Setzt den Fokus in das Namensfeld und markiert den Vorschlag zum Überschreiben. */
  public focusName(): void {
    this.input.focus({ preventScroll: true });
    this.input.select();
  }

  /** Gibt die Eingabe frei, bevor der Bildschirm verschwindet. */
  public release(): void {
    if (document.activeElement === this.input) {
      this.input.blur();
    }
  }

  public dispose(): void {
    this.release();
    this.input.removeEventListener("focus", this.onFocus);
    this.input.removeEventListener("blur", this.onBlur);
    this.form.removeEventListener("submit", this.onSubmit);
    this.element.remove();
  }
}
