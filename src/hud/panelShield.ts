// src/hud/panelShield.ts — Bildschirmflächen der festen Bedienfelder: Raummarkierungen darunter werden
// ausgeblendet, und die Auswahl im Raum weicht ihnen aus.

import { createElement } from "./dom";

/** Rechteck in CSS-Pixeln relativ zur Oberfläche (Bildschirmrechteck). */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Angemeldetes Bedienfeld; `active` meldet, ob es gerade als Fläche zählt (Bedienfeld). */
interface Panel {
  readonly element: HTMLElement;
  readonly active: (() => boolean) | undefined;
}

/** So lange gelten gelesene Rechtecke, bevor sie neu gelesen werden (Millisekunden). */
const RefreshMs = 200;
/** Länge der Messleiste in HUD-Einheiten. */
const ProbeUnits = 100;

/** Fläche, um die sich zwei Rechtecke überdecken (0 ohne Überdeckung). */
export function overlapArea(a: ScreenRect, b: ScreenRect): number {
  const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * Flächen der Bedienfelder (Feldschutz). `refresh()` liest die Rechtecke höchstens alle 200 ms und gehört
 * an den Anfang eines Frames, bevor die Oberfläche schreibt: So erzwingt das Lesen kein zusätzliches Layout.
 * Dabei misst es auch die Größe der Oberfläche und die HUD-Einheit `--u` in Pixeln.
 */
export class PanelShield {
  /** Breite der Oberfläche in CSS-Pixeln. */
  public width = 0;
  /** Höhe der Oberfläche in CSS-Pixeln. */
  public height = 0;
  /** Eine HUD-Einheit (`--u`) in CSS-Pixeln. */
  public unit = 14;
  private readonly root: HTMLElement;
  private readonly probe: HTMLDivElement;
  private readonly panels: Panel[] = [];
  private readonly rects: ScreenRect[] = [];
  private count = 0;
  private readAt = Number.NEGATIVE_INFINITY;

  public constructor(root: HTMLElement) {
    this.root = root;
    this.probe = createElement("div", "hud-unit-probe", root);
    this.probe.setAttribute("aria-hidden", "true");
  }

  /** Anzahl der Felder, die beim letzten Lesen sichtbar waren. */
  public get rectCount(): number {
    return this.count;
  }

  /** Meldet ein Bedienfeld an; ausgeblendete Felder (ohne Fläche) zählen von selbst nicht. */
  public register(element: HTMLElement, active?: () => boolean): void {
    this.panels.push({ element, active });
  }

  /** Erzwingt das Neulesen beim nächsten `refresh()`, z. B. nach einem Moduswechsel. */
  public invalidate(): void {
    this.readAt = Number.NEGATIVE_INFINITY;
  }

  /** Liest Rechtecke, Oberflächengröße und Einheit neu, wenn die letzte Messung älter als 200 ms ist. */
  public refresh(now: number): void {
    if (now - this.readAt < RefreshMs) {
      return;
    }
    this.readAt = now;
    const host = this.root.getBoundingClientRect();
    this.width = host.width;
    this.height = host.height;
    const probeWidth = this.probe.getBoundingClientRect().width;
    if (probeWidth > 0) {
      this.unit = probeWidth / ProbeUnits;
    }
    this.count = 0;
    for (const panel of this.panels) {
      if (panel.active !== undefined && !panel.active()) {
        continue;
      }
      const box = panel.element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) {
        continue;
      }
      let rect = this.rects[this.count];
      if (rect === undefined) {
        rect = { left: 0, top: 0, right: 0, bottom: 0 };
        this.rects.push(rect);
      }
      rect.left = box.left - host.left;
      rect.top = box.top - host.top;
      rect.right = box.right - host.left;
      rect.bottom = box.bottom - host.top;
      this.count++;
    }
  }

  /** Feld Nummer `index` (0 ≤ index < rectCount). */
  public rectAt(index: number): Readonly<ScreenRect> {
    return this.rects[index];
  }

  /** Ob ein Kreis (Mittelpunkt, Radius in Pixeln) ein Bedienfeld berührt. */
  public coversCircle(x: number, y: number, radius: number): boolean {
    const limit = radius * radius;
    for (let index = 0; index < this.count; index++) {
      const rect = this.rects[index];
      const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
      const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
      if (dx * dx + dy * dy < limit) {
        return true;
      }
    }
    return false;
  }

  /** Summe der Flächen, mit denen ein Rechteck die Bedienfelder überdeckt. */
  public overlap(rect: ScreenRect): number {
    let area = 0;
    for (let index = 0; index < this.count; index++) {
      area += overlapArea(rect, this.rects[index]);
    }
    return area;
  }

  public dispose(): void {
    this.panels.length = 0;
    this.count = 0;
    this.probe.remove();
  }
}
