// src/hud/flightControls.ts — Flugsteuerung neben der Wabenleiste: Pusteblumen-Tempostiel (klicken oder
// ziehen setzt das Tempo), Stoppschild, aktuelles Tempo und der laufende Befehl.

import { createElement, NumberSlot, setHint, setVisible, StyleSlot, TextSlot } from "./dom";
import { clamp01, formatSpeedValue, speedStep } from "./format";
import type { HudActions, PlayerHud } from "./hudTypes";
import { createIconButton } from "./iconButton";
import { createIcon } from "./icons";

/** Schritte, in denen Klick oder Ziehen auf dem Stiel das Tempo setzen. */
const ThrottleSteps = 100;

/** Tempostiel mit Pusteblumen-Knopf (Tempostiel). */
class SpeedStem {
  public readonly element: HTMLDivElement;
  private readonly throttle: StyleSlot;
  private readonly speed: StyleSlot;
  private readonly actions: HudActions;
  private throttleStep = -1;
  private speedLevel = -1;
  private sentStep = -1;
  private dragPointer = -1;

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    this.dragPointer = event.pointerId;
    this.element.setPointerCapture(event.pointerId);
    this.send(event.clientX);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId === this.dragPointer) {
      this.send(event.clientX);
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId === this.dragPointer) {
      this.dragPointer = -1;
      this.sentStep = -1;
    }
  };

  public constructor(parent: HTMLElement, actions: HudActions) {
    this.actions = actions;
    this.element = createElement("div", "speed-stem", parent);
    this.element.setAttribute("role", "slider");
    this.element.setAttribute("aria-valuemin", "0");
    this.element.setAttribute("aria-valuemax", "100");
    setHint(this.element, "Speed", "Click or drag along the stem to set your speed.");
    createElement("span", "stem-track", this.element);
    createElement("span", "stem-fill", this.element);
    const ticks = createElement("span", "stem-ticks", this.element);
    for (let index = 1; index < 4; index++) {
      createElement("i", "stem-tick", ticks).style.setProperty("--at", String(index / 4));
    }
    const knob = createElement("span", "stem-knob", this.element);
    createIcon("speed", "stem-knob-icon", knob);
    this.throttle = new StyleSlot(this.element, "--throttle");
    this.speed = new StyleSlot(this.element, "--speed");
    this.element.addEventListener("pointerdown", this.onPointerDown);
    this.element.addEventListener("pointermove", this.onPointerMove);
    this.element.addEventListener("pointerup", this.onPointerUp);
    this.element.addEventListener("pointercancel", this.onPointerUp);
  }

  public update(player: PlayerHud): void {
    const step = Math.round(clamp01(player.throttle) * ThrottleSteps);
    if (step !== this.throttleStep) {
      this.throttleStep = step;
      this.throttle.set(String(step / ThrottleSteps));
      this.element.setAttribute("aria-valuenow", String(step));
    }
    const ratio = player.isWarping ? 1 : player.maxSpeed > 0 ? player.speed / player.maxSpeed : 0;
    const level = Math.round(clamp01(ratio) * 100);
    if (level !== this.speedLevel) {
      this.speedLevel = level;
      this.speed.set(String(level / 100));
    }
  }

  /** Zeigerposition auf dem Stiel → Tempoanteil; der Knopfradius bleibt an beiden Enden frei. */
  private send(clientX: number): void {
    const rect = this.element.getBoundingClientRect();
    const inset = rect.height / 2;
    const ratio = clamp01((clientX - rect.left - inset) / Math.max(1, rect.width - 2 * inset));
    const step = Math.round(ratio * ThrottleSteps);
    if (step !== this.sentStep) {
      this.sentStep = step;
      this.actions.setThrottle(step / ThrottleSteps);
    }
  }
}

/** Flugsteuerung unten (Flugsteuerung). */
export class FlightControls {
  /** Wurzelelement (Bedienfeld für den Feldschutz). */
  public readonly element: HTMLDivElement;
  private readonly command: TextSlot;
  private readonly commandPill: HTMLDivElement;
  private readonly stem: SpeedStem;
  private readonly speed: NumberSlot;
  private readonly warp: HTMLSpanElement;

  public constructor(parent: HTMLElement, actions: HudActions) {
    this.element = createElement("div", "flight-controls", parent);
    this.commandPill = createElement("div", "command-pill", this.element);
    this.command = new TextSlot(this.commandPill);
    const row = createElement("div", "speed-row", this.element);
    const stop = createIconButton("round-btn stop-btn", "stop", "Stop", row, "Space", "Brakes to a full stop.");
    stop.tabIndex = -1;
    stop.addEventListener("click", () => actions.command("stop"));
    this.stem = new SpeedStem(row, actions);
    const value = createElement("div", "speed-value", row);
    this.warp = createElement("span", "speed-warp", value);
    createIcon("warp", "speed-warp-icon", this.warp);
    setHint(this.warp, "Warping");
    this.speed = new NumberSlot(createElement("span", "speed-number", value), formatSpeedValue, speedStep);
    createElement("span", "speed-unit", value, "m/s");
  }

  public update(player: PlayerHud | undefined): void {
    setVisible(this.element, player !== undefined);
    if (player === undefined) {
      return;
    }
    this.element.classList.toggle("is-warping", player.isWarping);
    this.element.classList.toggle("is-ghost", player.isGhost);
    this.command.set(player.commandLabel);
    setVisible(this.commandPill, player.commandLabel !== "");
    setVisible(this.warp, player.isWarping);
    this.stem.update(player);
    this.speed.set(player.speed);
  }

  public dispose(): void {
    this.element.remove();
  }
}
