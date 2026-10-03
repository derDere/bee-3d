// src/hud/station/stationBar.ts — Seitenleiste der Wabenhalle am linken Bildrand: Wappen des Stocks, ein Wabenknopf
// je Seite, darunter Heimatstock und Abdocken. Ein Wabenknopf öffnet das Fenster seiner Seite oder schließt es wieder.

import { createElement, HintSlot } from "../dom";
import type { HudActions, StationHud } from "../hudTypes";
import { createIconButton } from "../iconButton";
import { createIcon } from "../icons";
import { StationPages, type StationPageKey } from "./stationPage";

/** Was die Seitenleiste vom Stationsmenü braucht (Leisten-Gastgeber). */
export interface StationBarHost {
  /** Öffnet die Seite oder schließt sie, wenn ihr Fenster schon offen ist. */
  togglePage(page: StationPageKey): void;
}

/** Schmale Seitenleiste der Wabenhalle (Hallenleiste). */
export class StationBar {
  public readonly element: HTMLElement;
  private readonly crest: HTMLSpanElement;
  private readonly crestHint: HintSlot;
  private readonly pageButtons = new Map<StationPageKey, HTMLButtonElement>();
  private readonly homeButton: HTMLButtonElement;
  private readonly homeHint: HintSlot;
  private readonly actions: HudActions;
  private hiveName = "";
  private isHome: boolean | undefined;

  private readonly onHome = (): void => {
    if (this.isHome !== true) {
      this.actions.setHomeHive();
    }
  };

  private readonly onUndock = (): void => this.actions.undock();

  /** `windowId` ist die Kennung des Stationsfensters, das die Wabenknöpfe steuern. */
  public constructor(parent: HTMLElement, actions: HudActions, host: StationBarHost, windowId: string) {
    this.actions = actions;
    this.element = createElement("nav", "hall-bar", parent);
    this.element.setAttribute("aria-label", "Hive");

    this.crest = createElement("span", "hall-crest", this.element);
    this.crestHint = new HintSlot(this.crest);
    createIcon("hive", "hall-crest-icon", this.crest);
    createIcon("home", "hall-crest-home", this.crest);

    const pages = createElement("div", "hall-bar-pages", this.element);
    for (const spec of StationPages) {
      const button = createIconButton("hall-tab", spec.icon, spec.label, pages);
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-controls", windowId);
      button.setAttribute("aria-expanded", "false");
      button.addEventListener("click", () => host.togglePage(spec.key));
      this.pageButtons.set(spec.key, button);
    }

    this.homeButton = createIconButton("round-btn hall-home-btn", "home", "Set as home", this.element);
    this.homeHint = new HintSlot(this.homeButton);
    this.homeButton.addEventListener("click", this.onHome);
    const undock = createIconButton("round-btn hall-undock", "undock", "Undock", this.element, undefined, "Fly out of the hive.");
    undock.addEventListener("click", this.onUndock);
  }

  /** Stockname im Wappen und Zustand des Heimatknopfs. */
  public update(station: StationHud): void {
    if (station.hiveName === this.hiveName && station.isHome === this.isHome) {
      return;
    }
    this.hiveName = station.hiveName;
    this.isHome = station.isHome;
    this.crest.classList.toggle("is-home", station.isHome);
    this.crestHint.set(station.hiveName, station.isHome ? "Your home hive" : undefined);
    this.homeButton.classList.toggle("is-home", station.isHome);
    this.homeButton.setAttribute("aria-disabled", String(station.isHome));
    if (station.isHome) {
      this.homeHint.set("Your home hive");
    } else {
      this.homeHint.set("Set as home", "Make this hive your home hive.");
    }
  }

  /** Hebt den Wabenknopf der offenen Seite hervor; undefined = kein Fenster offen. */
  public setOpenPage(page: StationPageKey | undefined): void {
    for (const [key, button] of this.pageButtons) {
      const open = key === page;
      button.classList.toggle("is-current", open);
      button.setAttribute("aria-expanded", String(open));
    }
  }

  public dispose(): void {
    this.element.remove();
  }
}
