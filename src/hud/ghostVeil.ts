// src/hud/ghostVeil.ts — Geist-Zustand: zarter cyaner Schleier am Bildrand und runder Heimflug-Knopf.

import { createElement, setVisible } from "./dom";
import type { HudActions } from "./hudTypes";
import { createIconButton } from "./iconButton";

/** Schleier und Heimflug-Knopf, solange die Biene ein Geist ist (Geisterschleier). */
export class GhostVeil {
  /** Runder Heimflug-Knopf unter dem Hinweisband (Bedienfeld für den Feldschutz). */
  public readonly homeButton: HTMLButtonElement;
  private readonly veil: HTMLDivElement;

  public constructor(veilParent: HTMLElement, actionParent: HTMLElement, actions: HudActions) {
    this.veil = createElement("div", "hud-layer ghost-veil", veilParent);
    this.veil.hidden = true;
    this.homeButton = createIconButton("round-btn ghost-home", "home", "Fly home", actionParent, undefined, "Warp to your home hive, where you come back to life.");
    this.homeButton.tabIndex = -1;
    this.homeButton.hidden = true;
    this.homeButton.addEventListener("click", () => actions.returnHome());
  }

  public update(isGhost: boolean): void {
    setVisible(this.veil, isGhost);
    setVisible(this.homeButton, isGhost);
  }

  public dispose(): void {
    this.veil.remove();
    this.homeButton.remove();
  }
}
