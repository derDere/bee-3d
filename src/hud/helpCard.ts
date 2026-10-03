// src/hud/helpCard.ts — feste Tastenhilfe (Taste H): Notizkarte mit Symbol, Taste und kurzer Wirkung.

import { QuickHelp } from "./controlsReference";
import { createElement, setVisible } from "./dom";
import { createIcon } from "./icons";

/** Feste Tastenhilfe rechts oben (Tastenhilfe). */
export class HelpCard {
  /** Wurzelelement (Bedienfeld für den Feldschutz). */
  public readonly element: HTMLElement;

  public constructor(parent: HTMLElement) {
    this.element = createElement("aside", "help-card", parent);
    this.element.setAttribute("aria-label", "Key help");
    this.element.hidden = true;
    const title = createElement("div", "help-card-title", this.element);
    createIcon("keyboard", "help-card-title-icon", title);
    createElement("span", "", title, "Keys");
    const list = createElement("ul", "help-card-list", this.element);
    for (const row of QuickHelp) {
      const item = createElement("li", "help-card-row", list);
      createIcon(row.icon, "help-card-icon", item);
      createElement("kbd", "help-card-key", item, row.input);
      createElement("span", "help-card-effect", item, row.effect);
    }
  }

  public update(visible: boolean): void {
    setVisible(this.element, visible);
  }

  public dispose(): void {
    this.element.remove();
  }
}
