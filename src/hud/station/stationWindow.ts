// src/hud/station/stationWindow.ts — kompaktes Fenster einer Stationsseite neben der Seitenleiste: Holzschild mit
// Seitensymbol, Seitenname, Stockname und abgeliefertem Honig, dazu der Schließknopf; darunter der Seiteninhalt.

import { createElement, NumberSlot, setHint, setVisible, TextSlot } from "../dom";
import { formatInteger } from "../format";
import type { StationHud } from "../hudTypes";
import { createIconButton } from "../iconButton";
import { createIcon, IconSlot } from "../icons";
import type { StationPage, StationPageSpec } from "./stationPage";

const TitleId = "hud-hall-title";

/** Fenster einer Stationsseite (Stationsfenster). */
export class StationWindow {
  public readonly element: HTMLElement;
  private readonly icon: IconSlot;
  private readonly title: TextSlot;
  private readonly hiveName: TextSlot;
  private readonly homeBadge: HTMLSpanElement;
  private readonly delivered: NumberSlot;
  private readonly body: HTMLDivElement;
  private readonly close: HTMLButtonElement;
  private readonly onClose: () => void;

  private readonly onCloseClick = (): void => this.onClose();

  /** `id` macht das Fenster für die Wabenknöpfe der Seitenleiste ansprechbar; `onClose` schließt es. */
  public constructor(parent: HTMLElement, id: string, onClose: () => void) {
    this.onClose = onClose;
    this.element = createElement("section", "hall-window", parent);
    this.element.id = id;
    this.element.setAttribute("role", "dialog");
    this.element.setAttribute("aria-labelledby", TitleId);
    this.element.hidden = true;

    const sign = createElement("header", "hall-window-sign", this.element);
    this.icon = new IconSlot(createElement("span", "hall-window-crest", sign), "hall-window-crest-icon");
    const titles = createElement("div", "hall-window-titles", sign);
    const title = createElement("h2", "hall-window-title", titles);
    title.id = TitleId;
    this.title = new TextSlot(title);
    const sub = createElement("div", "hall-window-sub", titles);
    this.hiveName = new TextSlot(createElement("span", "hall-window-hive", sub));
    this.homeBadge = createElement("span", "hall-home", sub);
    setHint(this.homeBadge, "Your home hive");
    createIcon("home", "hall-home-icon", this.homeBadge);
    const balance = createElement("span", "hall-balance", sub);
    setHint(balance, "Honey delivered to this hive");
    createIcon("deposit", "hall-balance-icon", balance);
    this.delivered = new NumberSlot(createElement("span", "", balance), formatInteger);
    this.close = createIconButton("hall-window-close", "close", "Close (Esc)", sign);
    this.close.addEventListener("click", this.onCloseClick);

    this.body = createElement("div", "hall-window-body", this.element);
  }

  /** Zeigt eine Seite im Fenster; das Fenster springt dabei kurz auf. */
  public show(spec: StationPageSpec, page: StationPage): void {
    this.icon.set(spec.icon);
    this.title.set(spec.label);
    this.body.replaceChildren(page.element);
    this.body.scrollTop = 0;
    setVisible(this.element, true);
    for (const animation of this.element.getAnimations()) {
      animation.cancel();
      animation.play();
    }
  }

  public hide(): void {
    setVisible(this.element, false);
    this.body.replaceChildren();
  }

  /** Schild mit Stockname, Heimatzeichen und abgeliefertem Honig. */
  public update(station: StationHud): void {
    this.hiveName.set(station.hiveName);
    setVisible(this.homeBadge, station.isHome);
    this.delivered.set(station.honeyDelivered);
  }

  public dispose(): void {
    this.close.removeEventListener("click", this.onCloseClick);
    this.element.remove();
  }
}
