// src/hud/selectionBubble.ts — Sprechblase der Auswahl im Raum: Symbol, Name, Art, Entfernung, Tempo,
// Lebensbalken und Beschreibung. Der Zipfel zeigt auf das Objekt; die Lage bestimmt die Auswahl im Raum.

import { createElement, HintSlot, NumberSlot, setHint, setVisible, StyleSlot, TextSlot } from "./dom";
import { EntityToneClass } from "./entities";
import { clamp01, distanceStep, formatDistance, formatPercent, formatSpeed, percentStep, speedStep } from "./format";
import type { EntityType, HudActions, SelectionHud } from "./hudTypes";
import { createIconButton } from "./iconButton";
import { createIcon, IconSlot } from "./icons";

/** Sprechblase der Auswahl (Auswahlblase). */
export class SelectionBubble {
  public readonly element: HTMLElement;
  private readonly iconBubble: HTMLSpanElement;
  private readonly icon: IconSlot;
  private readonly name: TextSlot;
  private readonly typeLabel: TextSlot;
  private readonly distance: NumberSlot;
  private readonly speed: NumberSlot;
  private readonly hpRow: HTMLDivElement;
  private readonly hpFill: StyleSlot;
  private readonly hpPercent: NumberSlot;
  private readonly detailElement: HTMLParagraphElement;
  private readonly detail: TextSlot;
  private readonly detailHint: HintSlot;
  private type: EntityType | undefined;
  private hpStep = -1;
  private hpTier = "";

  public constructor(parent: HTMLElement, actions: HudActions) {
    this.element = createElement("section", "sel-bubble", parent);
    this.element.setAttribute("aria-label", "Selection");

    const head = createElement("div", "sel-head", this.element);
    this.iconBubble = createElement("span", "sel-icon", head);
    this.icon = new IconSlot(this.iconBubble, "sel-icon-svg");
    const titles = createElement("div", "sel-titles", head);
    this.name = new TextSlot(createElement("div", "sel-name", titles));
    const facts = createElement("div", "sel-facts", titles);
    this.typeLabel = new TextSlot(createElement("span", "sel-type", facts));
    this.distance = this.fact(facts, "sortDistance", "Distance", formatDistance, distanceStep);
    this.speed = this.fact(facts, "speed", "Speed", formatSpeed, speedStep);
    const clear = createIconButton("sel-close", "close", "Deselect", head);
    clear.tabIndex = -1;
    clear.addEventListener("click", () => actions.select(undefined));

    this.hpRow = createElement("div", "sel-hp", this.element);
    setHint(this.hpRow, "Health");
    createIcon("heart", "sel-hp-icon", this.hpRow);
    const bar = createElement("span", "sel-hp-bar", this.hpRow);
    this.hpFill = new StyleSlot(createElement("span", "sel-hp-fill", bar), "transform");
    this.hpPercent = new NumberSlot(createElement("span", "sel-hp-value", this.hpRow), formatPercent, percentStep);

    this.detailElement = createElement("p", "sel-detail", this.element);
    this.detail = new TextSlot(this.detailElement);
    this.detailHint = new HintSlot(this.detailElement);
    createElement("span", "sel-tail", this.element);
  }

  public update(selection: SelectionHud): void {
    if (selection.ref.type !== this.type) {
      if (this.type !== undefined) {
        this.iconBubble.classList.remove(EntityToneClass[this.type]);
      }
      this.type = selection.ref.type;
      this.iconBubble.classList.add(EntityToneClass[this.type]);
      this.icon.set(this.type);
    }
    this.name.set(selection.name);
    this.typeLabel.set(selection.typeLabel);
    this.distance.set(selection.distance);
    this.speed.set(selection.speed);
    const hp = selection.hpRatio;
    setVisible(this.hpRow, hp !== undefined);
    if (hp !== undefined) {
      const step = percentStep(hp);
      if (step !== this.hpStep) {
        this.hpStep = step;
        this.hpFill.set(`scaleX(${clamp01(step / 100)})`);
        const tier = step > 60 ? "hp-high" : step > 30 ? "hp-mid" : "hp-low";
        if (tier !== this.hpTier) {
          if (this.hpTier !== "") {
            this.hpRow.classList.remove(this.hpTier);
          }
          this.hpTier = tier;
          this.hpRow.classList.add(tier);
        }
      }
      this.hpPercent.set(hp);
    }
    // Lange Beschreibungen kürzt das CSS auf zwei Zeilen; der Hinweis zeigt sie ganz
    this.detail.set(selection.detail);
    this.detailHint.set(selection.detail);
    setVisible(this.detailElement, selection.detail !== "");
  }

  public dispose(): void {
    this.element.remove();
  }

  private fact(parent: HTMLElement, icon: "sortDistance" | "speed", label: string, format: (value: number) => string, step: (value: number) => number): NumberSlot {
    const chip = createElement("span", "sel-fact", parent);
    setHint(chip, label);
    createIcon(icon, "sel-fact-icon", chip);
    return new NumberSlot(createElement("span", "sel-fact-value", chip), format, step);
  }
}
