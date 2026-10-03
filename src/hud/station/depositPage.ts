// src/hud/station/depositPage.ts — Reiter „Abliefern“: Pollen aus dem Körbchen wird im Stock zu Honig.

import { HoneyPerGoldPollen, HoneyPerPollen } from "../../../shared/rules";
import { createElement, NumberSlot, setHint, setVisible } from "../dom";
import { formatInteger } from "../format";
import type { HudActions, StationHud } from "../hudTypes";
import { createIconButton } from "../iconButton";
import { createIcon, type IconName } from "../icons";
import type { StationPage } from "./stationPage";

/** Seite „Abliefern“ (Ablieferung). */
export class DepositPage implements StationPage {
  public readonly element: HTMLDivElement;
  private readonly pollen: NumberSlot;
  private readonly gold: NumberSlot;
  private readonly value: NumberSlot;
  private readonly button: HTMLButtonElement;
  private readonly emptyNote: HTMLParagraphElement;

  public constructor(actions: HudActions) {
    this.element = createElement("div", "deposit-page");
    const counter = createElement("div", "deposit-counter", this.element);
    this.pollen = this.item(counter, "pollen", "Pollen", `Each pollen makes ${formatInteger(HoneyPerPollen)} honey.`);
    this.gold = this.item(counter, "goldPollen", "Gold pollen", `Each gold pollen makes ${formatInteger(HoneyPerGoldPollen)} honey.`);
    createIcon("arrow", "deposit-arrow", counter);
    this.value = this.item(counter, "honey", "Honey you get", "Goes straight into your honey pot.", "is-result");
    this.button = createIconButton("round-btn big-btn deposit-btn", "deposit", "Deposit pollen", this.element);
    this.button.addEventListener("click", () => actions.deposit());
    this.emptyNote = createElement("p", "hall-note", this.element, "Your basket is empty. The flowers are waiting!");
  }

  public update(station: StationHud): void {
    this.pollen.set(station.cargo);
    this.gold.set(station.cargoGold);
    this.value.set(station.depositValue);
    const hasCargo = station.cargo + station.cargoGold > 0;
    if (this.button.disabled === hasCargo) {
      this.button.disabled = !hasCargo;
    }
    setVisible(this.emptyNote, !hasCargo);
  }

  private item(parent: HTMLElement, icon: IconName, label: string, detail: string, className = ""): NumberSlot {
    const item = createElement("div", `deposit-item ${className}`, parent);
    setHint(item, label, detail);
    createIcon(icon, "deposit-item-icon", item);
    return new NumberSlot(createElement("span", "deposit-item-value", item), formatInteger);
  }
}
