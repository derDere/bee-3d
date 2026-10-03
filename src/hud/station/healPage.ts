// src/hud/station/healPage.ts — Reiter „Heilstation“: volle Lebenspunkte gegen Honig.

import { HpPerHoney } from "../../../shared/rules";
import { createElement, NumberSlot, setHint, StyleSlot, TextSlot } from "../dom";
import { clamp01, formatInteger } from "../format";
import type { HudActions, StationHud } from "../hudTypes";
import { createIconButton } from "../iconButton";
import { createIcon } from "../icons";
import type { StationPage } from "./stationPage";

/** Seite „Heilstation“ (Heilstation). */
export class HealPage implements StationPage {
  public readonly element: HTMLDivElement;
  private readonly hp: NumberSlot;
  private readonly maxHp: NumberSlot;
  private readonly fill: StyleSlot;
  private readonly meter: HTMLDivElement;
  private readonly cost: NumberSlot;
  private readonly button: HTMLButtonElement;
  private readonly note: TextSlot;
  private fillStep = -1;
  private tier = "";

  public constructor(actions: HudActions) {
    this.element = createElement("div", "heal-page");
    this.meter = createElement("div", "heal-meter", this.element);
    createIcon("heart", "heal-heart", this.meter);
    const values = createElement("div", "heal-values", this.meter);
    this.hp = new NumberSlot(createElement("span", "heal-hp", values), formatInteger);
    createElement("span", "heal-of", values, "/");
    this.maxHp = new NumberSlot(createElement("span", "heal-max", values), formatInteger);
    const bar = createElement("div", "heal-bar", this.meter);
    this.fill = new StyleSlot(createElement("span", "heal-bar-fill", bar), "transform");

    const offer = createElement("div", "heal-offer", this.element);
    setHint(offer, "Price of a full heal", `1 honey heals ${formatInteger(HpPerHoney)} health.`);
    createIcon("honey", "heal-offer-icon", offer);
    this.cost = new NumberSlot(createElement("span", "heal-cost", offer), formatInteger);
    this.button = createIconButton("round-btn big-btn heal-btn", "heart", "Heal fully", this.element);
    this.button.addEventListener("click", () => actions.repair());
    this.note = new TextSlot(createElement("p", "hall-note", this.element));
  }

  public update(station: StationHud): void {
    const ratio = station.maxHp > 0 ? station.hp / station.maxHp : 0;
    this.hp.set(station.hp);
    this.maxHp.set(station.maxHp);
    const step = Math.round(clamp01(ratio) * 200);
    if (step !== this.fillStep) {
      this.fillStep = step;
      this.fill.set(`scaleX(${step / 200})`);
      const tier = ratio > 0.6 ? "hp-high" : ratio > 0.3 ? "hp-mid" : "hp-low";
      if (tier !== this.tier) {
        if (this.tier !== "") {
          this.meter.classList.remove(this.tier);
        }
        this.tier = tier;
        this.meter.classList.add(tier);
      }
    }
    this.cost.set(station.repairCost);
    const healthy = station.hp >= station.maxHp;
    const affordable = station.honey >= station.repairCost;
    const enabled = !healthy && affordable;
    if (this.button.disabled === enabled) {
      this.button.disabled = !enabled;
    }
    this.note.set(healthy ? "Fit as a fiddle! The healers wave hello." : affordable ? "" : "Not enough honey for a full heal yet.");
  }
}
