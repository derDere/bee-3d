// src/hud/station/workshopPage.ts — Reiter „Werkstatt“: Upgrades als Kärtchen mit Symbol, Stufe und Kaufknopf.

import { createButton, createElement, NumberSlot, setHint, setVisible, TextSlot } from "../dom";
import { formatInteger } from "../format";
import type { HudActions, StationHud, UpgradeHud } from "../hudTypes";
import { createIcon, upgradeIcon } from "../icons";
import { KeyedViews, type KeyedView } from "../keyedViews";
import type { StationPage } from "./stationPage";

/** Ein Upgrade in der Werkstatt (Werkstatt-Kärtchen). */
class UpgradeView implements KeyedView {
  public readonly element: HTMLLIElement;
  public seen = 0;
  private readonly title: TextSlot;
  private readonly effect: TextSlot;
  private readonly pips: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  private readonly cost: NumberSlot;
  private readonly maxed: HTMLSpanElement;
  private pipCount = -1;
  private level = -1;
  private affordable: boolean | undefined;

  public constructor(kind: string, actions: HudActions) {
    this.element = createElement("li", "upgrade");
    createIcon(upgradeIcon(kind), "upgrade-icon-svg", createElement("span", "upgrade-icon", this.element));
    const text = createElement("div", "upgrade-text", this.element);
    this.title = new TextSlot(createElement("div", "upgrade-title", text));
    this.effect = new TextSlot(createElement("div", "upgrade-effect", text));
    this.pips = createElement("div", "upgrade-pips", text);
    this.button = createButton("icon-btn upgrade-buy", this.element);
    this.button.tabIndex = -1;
    createIcon("plus", "icon-btn-icon", this.button);
    const price = createElement("span", "upgrade-price", this.button);
    createIcon("honey", "upgrade-price-icon", price);
    this.cost = new NumberSlot(createElement("span", "", price), formatInteger);
    this.maxed = createElement("span", "upgrade-maxed", this.element);
    createIcon("crown", "upgrade-maxed-icon", this.maxed);
    setHint(this.maxed, "Highest level");
    this.button.addEventListener("click", () => actions.buyUpgrade(kind));
  }

  public update(upgrade: UpgradeHud): void {
    this.title.set(upgrade.title);
    this.effect.set(upgrade.effect);
    if (upgrade.maxLevel !== this.pipCount) {
      this.pipCount = upgrade.maxLevel;
      this.pips.replaceChildren();
      for (let index = 0; index < upgrade.maxLevel; index++) {
        createElement("span", "pip", this.pips);
      }
      this.level = -1;
    }
    if (upgrade.level !== this.level) {
      this.level = upgrade.level;
      const pips = this.pips.children;
      for (let index = 0; index < pips.length; index++) {
        pips[index].classList.toggle("is-filled", index < upgrade.level);
      }
      setHint(this.pips, `Level ${upgrade.level} of ${upgrade.maxLevel}`);
    }
    const purchasable = upgrade.cost !== undefined;
    setVisible(this.button, purchasable);
    setVisible(this.maxed, !purchasable);
    if (upgrade.cost !== undefined) {
      this.cost.set(upgrade.cost);
      if (upgrade.affordable !== this.affordable) {
        this.affordable = upgrade.affordable;
        this.button.disabled = !upgrade.affordable;
        setHint(this.button, upgrade.affordable ? `Buy ${upgrade.title}` : "Not enough honey yet");
      }
    }
    this.element.classList.toggle("is-affordable", purchasable && upgrade.affordable);
  }
}

/** Seite „Werkstatt“ (Werkstatt). */
export class WorkshopPage implements StationPage {
  public readonly element: HTMLDivElement;
  private readonly list: HTMLUListElement;
  private readonly views: KeyedViews<UpgradeView, string>;

  public constructor(actions: HudActions) {
    this.element = createElement("div", "workshop-page");
    this.list = createElement("ul", "upgrade-list", this.element);
    this.views = new KeyedViews<UpgradeView, string>(
      (kind) => new UpgradeView(kind, actions),
      (view) => view.element.remove(),
    );
  }

  public update(station: StationHud): void {
    this.views.begin();
    for (const upgrade of station.upgrades) {
      this.views.claim(upgrade.kind).update(upgrade);
    }
    this.views.end();
    this.views.arrange(this.list);
  }
}
