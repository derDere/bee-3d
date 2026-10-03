// src/hud/ribbonBanner.ts — kurzer Hinweis (model.banner) als Schmuckband mit gefalteten Enden.

import { createElement, TextSlot } from "./dom";

/** Hinweisband in der oberen Bildmitte (Banner). */
export class RibbonBanner {
  /** Wurzelelement (Bedienfeld für den Feldschutz). */
  public readonly element: HTMLDivElement;
  private readonly text: TextSlot;
  private shown = false;

  public constructor(parent: HTMLElement) {
    this.element = createElement("div", "ribbon-banner", parent);
    this.element.setAttribute("role", "status");
    this.element.setAttribute("aria-live", "polite");
    this.text = new TextSlot(createElement("span", "ribbon-banner-text", this.element));
  }

  /** Ob das Band gerade einen Hinweis zeigt. */
  public get isShown(): boolean {
    return this.shown;
  }

  /** undefined blendet aus; der letzte Text bleibt während des Ausblendens stehen. */
  public update(text: string | undefined, ghost: boolean): void {
    const show = text !== undefined && text !== "";
    if (show) {
      this.text.set(text);
    }
    if (show !== this.shown) {
      this.shown = show;
      this.element.classList.toggle("is-shown", show);
    }
    this.element.classList.toggle("is-ghost", ghost);
  }

  public dispose(): void {
    this.element.remove();
  }
}
