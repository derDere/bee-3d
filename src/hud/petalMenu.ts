// src/hud/petalMenu.ts — Kontextmenü als Blütenkranz: Symbolknöpfe als Blütenblätter um den Klickpunkt. Der Kranz
// wächst mit der Zahl der Einträge, Abstandsfähnchen stehen außen am Blatt, die Beschriftung steht in der Mitte.

import { createButton, createElement, setHint, setVisible, TextSlot } from "./dom";
import type { ContextMenuEntry } from "./hudTypes";
import { createKeyBadge } from "./iconButton";
import { createIcon } from "./icons";

const ViewportMargin = 8;

/** Maße in HUD-Einheiten; `PetalUnits` entspricht `--petal` in hud.css. */
const PetalUnits = 3;
/** Kleinster Kranzradius: Platz für zwei Zeilen Beschriftung in der Mitte. */
const MinRadiusUnits = 4.6;
/** Luft zwischen benachbarten Blättern; deckt Tastenabzeichen und das Wachsen beim Überfahren ab. */
const PetalSpacingUnits = 0.9;
/** Luft zwischen der Beschriftung in der Mitte und den Blättern. */
const CenterClearanceUnits = 0.35;
/** So weit ragen Tastenabzeichen über den Blattrand hinaus. */
const BadgeReachUnits = 1.1;
/** Abstandsfähnchen: Höhe, Abstand zum Blatt und geschätzte Breite je Zeichen samt Polster. */
const ChipHeightUnits = 1.3;
const ChipGapUnits = 0.2;
const ChipCharUnits = 0.5;
const ChipPaddingUnits = 0.9;
/** Rand um den ganzen Kranz, damit nichts am Bildrand anstößt. */
const OuterMarginUnits = 0.3;

/** Kranzradius in HUD-Einheiten, bei dem `count` Blätter mit Luft nebeneinander auf dem Kreis liegen. */
function wreathRadiusUnits(count: number): number {
  if (count < 3) {
    return MinRadiusUnits;
  }
  return Math.max(MinRadiusUnits, (PetalUnits + PetalSpacingUnits) / (2 * Math.sin(Math.PI / count)));
}

/** Lage eines Abstandsfähnchens außen am Blatt (Fähnchenlage), in HUD-Einheiten ab Blattmitte. */
interface ChipReach {
  /** Abstand der Fähnchenmitte von der Blattmitte. */
  readonly offset: number;
  /** Äußerster Punkt des Fähnchens in Richtung des Blatts. */
  readonly outer: number;
}

/**
 * Das Fähnchen sitzt in Blickrichtung des Blatts nach außen und hält Abstand zum eigenen Blatt: Seine halbe
 * Ausdehnung in dieser Richtung hängt vom Winkel ab (seitlich zählt die Breite, oben und unten die Höhe).
 */
function chipReach(text: string, angleDegrees: number): ChipReach {
  const radians = (angleDegrees * Math.PI) / 180;
  const width = ChipPaddingUnits + text.length * ChipCharUnits;
  const half = (Math.abs(Math.sin(radians)) * width + Math.abs(Math.cos(radians)) * ChipHeightUnits) / 2;
  const offset = PetalUnits / 2 + ChipGapUnits + half;
  return { offset, outer: offset + half };
}

/**
 * Blütenkranz-Menü (Kontextmenü): Jeder Eintrag ist ein rundes Blütenblatt mit Symbol, Tastenabzeichen und
 * Zusatz (z. B. „20 m“); die Mitte nennt das Objekt bzw. den Eintrag unter dem Zeiger, der volle Text steht
 * zusätzlich im Tooltip. Schließt bei Auswahl, Klick daneben, Mausrad, Fokusverlust des Fensters und
 * Größenänderung.
 */
export class PetalMenu {
  private readonly host: HTMLElement;
  private readonly element: HTMLDivElement;
  private readonly ring: HTMLDivElement;
  private readonly centerText: TextSlot;
  private entries: readonly ContextMenuEntry[] = [];
  private title = "";
  private open = false;
  private closedAt = Number.NEGATIVE_INFINITY;

  private readonly onOutsidePointer = (event: PointerEvent): void => {
    if (this.open && !(event.target instanceof Node && this.element.contains(event.target))) {
      this.hide();
    }
  };

  private readonly onDismiss = (): void => this.hide();

  private readonly onClick = (event: MouseEvent): void => {
    const entry = this.entryAt(event.target);
    if (entry === undefined || !entry.enabled) {
      return;
    }
    this.hide();
    entry.run();
  };

  private readonly onPointerOver = (event: PointerEvent): void => {
    const entry = this.entryAt(event.target);
    this.centerText.set(entry === undefined ? this.title : centerLabel(entry));
  };

  private readonly onContextMenu = (event: MouseEvent): void => event.preventDefault();

  public constructor(host: HTMLElement, layer: HTMLElement) {
    this.host = host;
    this.element = createElement("div", "petal-menu", layer);
    this.element.setAttribute("role", "menu");
    this.element.hidden = true;
    this.ring = createElement("div", "petal-ring", this.element);
    const center = createElement("div", "petal-center", this.element);
    this.centerText = new TextSlot(createElement("span", "petal-center-text", center));
    this.element.addEventListener("click", this.onClick);
    this.element.addEventListener("pointerover", this.onPointerOver);
    this.element.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("pointerdown", this.onOutsidePointer, true);
    window.addEventListener("wheel", this.onDismiss, { passive: true });
    window.addEventListener("blur", this.onDismiss);
    window.addEventListener("resize", this.onDismiss);
  }

  public get isOpen(): boolean {
    return this.open;
  }

  /**
   * Ob das Menü zum Zeitpunkt eines Ereignisses (event.timeStamp) offen war — auch wenn ein früherer
   * Listener desselben Tastendrucks es schon geschlossen hat.
   */
  public wasOpenAt(timeStamp: number): boolean {
    return this.open || this.closedAt >= timeStamp;
  }

  /**
   * Öffnet den Kranz um einen Bildschirmpunkt (CSS-Pixel); der Titel steht in der Mitte. `current` hebt
   * bei einer Auswahl das Blatt des geltenden Werts hervor.
   */
  public show(x: number, y: number, entries: readonly ContextMenuEntry[], title?: string, current = -1): void {
    this.entries = entries;
    this.title = title ?? "";
    this.centerText.set(this.title);
    this.ring.replaceChildren();
    const count = Math.max(1, entries.length);
    const radius = wreathRadiusUnits(count);
    let reach = PetalUnits / 2 + BadgeReachUnits;
    entries.forEach((entry, index) => {
      const angle = (index / count) * 360;
      const petal = this.createPetal(entry, index, current);
      petal.style.setProperty("--angle", `${angle}deg`);
      petal.style.setProperty("--delay", `${index * 18}ms`);
      if (entry.detail !== undefined) {
        const chip = chipReach(entry.detail, angle);
        petal.style.setProperty("--chip", chip.offset.toFixed(2));
        reach = Math.max(reach, chip.outer);
      }
    });
    const style = this.element.style;
    style.setProperty("--wreath-radius", radius.toFixed(2));
    style.setProperty("--wreath-inner", (radius - PetalUnits / 2 - CenterClearanceUnits).toFixed(2));
    style.setProperty("--wreath-extent", (radius + reach + OuterMarginUnits).toFixed(2));
    setVisible(this.element, true);
    this.open = true;
    this.place(x, y);
  }

  public hide(): void {
    if (!this.open) {
      return;
    }
    this.open = false;
    this.closedAt = performance.now();
    this.entries = [];
    setVisible(this.element, false);
  }

  public dispose(): void {
    this.hide();
    this.element.removeEventListener("click", this.onClick);
    this.element.removeEventListener("pointerover", this.onPointerOver);
    this.element.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("pointerdown", this.onOutsidePointer, true);
    window.removeEventListener("wheel", this.onDismiss);
    window.removeEventListener("blur", this.onDismiss);
    window.removeEventListener("resize", this.onDismiss);
    this.element.remove();
  }

  /** Blatt mit Symbol, Tastenabzeichen (kurze Tasten) und Abstandsfähnchen; eingeschaltete Einträge leuchten. */
  private createPetal(entry: ContextMenuEntry, index: number, current: number): HTMLButtonElement {
    const highlighted = index === current || entry.active === true;
    const petal = createButton(highlighted ? "petal is-current" : "petal", this.ring);
    if (current >= 0) {
      petal.setAttribute("role", "menuitemradio");
      petal.setAttribute("aria-checked", String(index === current));
    } else if (entry.active !== undefined) {
      petal.setAttribute("role", "menuitemcheckbox");
      petal.setAttribute("aria-checked", String(entry.active));
    } else {
      petal.setAttribute("role", "menuitem");
    }
    petal.dataset.index = String(index);
    petal.disabled = !entry.enabled;
    petal.tabIndex = -1;
    setHint(petal, entry.hotkey === undefined ? entry.label : `${entry.label} (${entry.hotkey})`, entry.detail);
    createIcon(entry.icon, "petal-icon", petal);
    if (entry.detail !== undefined) {
      createElement("span", "petal-detail", petal, entry.detail);
    }
    if (entry.hotkey !== undefined && entry.hotkey.length <= 3) {
      createKeyBadge(entry.hotkey, petal);
    }
    return petal;
  }

  private entryAt(target: EventTarget | null): ContextMenuEntry | undefined {
    const petal = target instanceof Element ? target.closest<HTMLElement>(".petal") : null;
    return petal === null ? undefined : this.entries[Number(petal.dataset.index)];
  }

  /** Mittelpunkt am Zeiger; rückt so weit ein, dass der ganze Kranz im Bild bleibt. */
  private place(x: number, y: number): void {
    const host = this.host.getBoundingClientRect();
    const halfWidth = this.element.offsetWidth / 2;
    const halfHeight = this.element.offsetHeight / 2;
    const left = Math.min(Math.max(x - host.left, halfWidth + ViewportMargin), host.width - halfWidth - ViewportMargin);
    const top = Math.min(Math.max(y - host.top, halfHeight + ViewportMargin), host.height - halfHeight - ViewportMargin);
    this.element.style.transform = `translate(${Math.round(left - halfWidth)}px, ${Math.round(top - halfHeight)}px)`;
  }
}

/** Text der Mitte für ein Blatt: Name des Eintrags, der Zusatz nur, wenn der Name ihn nicht schon nennt. */
function centerLabel(entry: ContextMenuEntry): string {
  return entry.detail === undefined || entry.label.includes(entry.detail) ? entry.label : `${entry.label} ${entry.detail}`;
}
