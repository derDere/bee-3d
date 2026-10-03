// src/hud/compassBadge.ts — unten links: Blütenkompass mit Bienennadel und Koordinatenschild (x, Höhe, z, Kurs).

import { AttributeSlot, createElement, NumberSlot, setHint, setVisible } from "./dom";
import { formatHeading, formatInteger, headingStep } from "./format";
import type { PlayerHud } from "./hudTypes";

const Ink = "#5b3a1e";

/** Kompassrose als Blüte: Norden ist das rote Blatt; die Nadel ist eine kleine Biene. */
const CompassMarkup =
  `<svg xmlns="http://www.w3.org/2000/svg" class="compass" viewBox="0 0 48 48" aria-hidden="true" focusable="false">` +
  `<g stroke="${Ink}" stroke-width="2" stroke-linejoin="round">` +
  `<path d="M24 1.6c3.4 3 3.4 7.6 0 10.6-3.4-3-3.4-7.6 0-10.6z" fill="#e8564a"/>` +
  `<path d="M46.4 24c-3 3.4-7.6 3.4-10.6 0 3-3.4 7.6-3.4 10.6 0z" fill="#f7b52c"/>` +
  `<path d="M24 46.4c-3.4-3-3.4-7.6 0-10.6 3.4 3 3.4 7.6 0 10.6z" fill="#f7b52c"/>` +
  `<path d="M1.6 24c3-3.4 7.6-3.4 10.6 0-3 3.4-7.6 3.4-10.6 0z" fill="#f7b52c"/>` +
  `<circle cx="24" cy="24" r="12.4" fill="#fff5dc"/>` +
  `</g>` +
  `<g class="compass-needle">` +
  `<path d="M24 13.4l4.4 9.6h-8.8z" fill="#e8564a" stroke="${Ink}" stroke-width="1.6" stroke-linejoin="round"/>` +
  `<ellipse cx="24" cy="26.6" rx="3.4" ry="4.2" fill="#f7b52c" stroke="${Ink}" stroke-width="1.6"/>` +
  `<path d="M20.8 26h6.4M21.2 28.6h5.6" stroke="#3b3330" stroke-width="1.4" stroke-linecap="round"/>` +
  `</g>` +
  `</svg>`;

/** Kompass und Koordinaten unten links (Kompassplakette). */
export class CompassBadge {
  /** Wurzelelement (Bedienfeld für den Feldschutz). */
  public readonly element: HTMLDivElement;
  private readonly needle: AttributeSlot;
  private readonly x: NumberSlot;
  private readonly y: NumberSlot;
  private readonly z: NumberSlot;
  private readonly heading: NumberSlot;
  private needleStep = Number.NaN;

  public constructor(parent: HTMLElement) {
    this.element = createElement("div", "compass-badge", parent);
    setHint(this.element, "Where you are", "x and z run across the sky sphere, the arrow shows your height.");
    const holder = document.createElement("template");
    holder.innerHTML = CompassMarkup;
    const compass = holder.content.firstElementChild;
    const needle = compass?.querySelector(".compass-needle");
    if (!(compass instanceof SVGSVGElement) || needle === null || needle === undefined) {
      throw new Error("Kompass ließ sich nicht anlegen.");
    }
    this.element.appendChild(compass);
    this.needle = new AttributeSlot(needle, "transform");

    const tag = createElement("div", "coords-tag", this.element);
    const across = createElement("div", "coords-row", tag);
    this.x = this.coordinate(across, "x");
    this.z = this.coordinate(across, "z");
    const height = createElement("div", "coords-row", tag);
    this.y = this.coordinate(height, "↑");
    this.heading = new NumberSlot(createElement("span", "coords-heading", height), formatHeading, headingStep);
  }

  public update(player: PlayerHud | undefined): void {
    setVisible(this.element, player !== undefined);
    if (player === undefined) {
      return;
    }
    this.x.set(player.position.x);
    this.y.set(player.position.y);
    this.z.set(player.position.z);
    this.heading.set(player.headingDeg);
    const step = headingStep(player.headingDeg);
    if (step !== this.needleStep) {
      this.needleStep = step;
      this.needle.set(`rotate(${step} 24 24)`);
    }
  }

  public setVisible(visible: boolean): void {
    setVisible(this.element, visible);
  }

  public dispose(): void {
    this.element.remove();
  }

  private coordinate(parent: HTMLElement, label: string): NumberSlot {
    const item = createElement("span", "coord", parent);
    createElement("span", "coord-label", item, label);
    return new NumberSlot(createElement("span", "coord-value", item), formatInteger);
  }
}
