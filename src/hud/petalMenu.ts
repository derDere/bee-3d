// src/hud/petalMenu.ts — Kontextmenü als Blütenkranz: Symbolknöpfe als Blütenblätter um den Klickpunkt.

import { createButton, createElement, setHint, setVisible, TextSlot } from "./dom";
import type { ContextMenuEntry } from "./hudTypes";
import { createKeyBadge } from "./iconButton";
import { createIcon } from "./icons";

const ViewportMargin = 8;

/**
 * Blütenkranz-Menü (Kontextmenü): Jeder Eintrag ist ein rundes Blütenblatt mit Symbol, Tastenabzeichen und
 * Zusatz (z. B. „20 m“); die Mitte nennt das Objekt bzw. den Eintrag unter dem Zeiger. Schließt bei Auswahl,
 * Klick daneben, Mausrad, Fokusverlust des Fensters und Größenänderung.
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
    this.centerText.set(entry === undefined ? this.title : entry.detail === undefined ? entry.label : `${entry.label} ${entry.detail}`);
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
    this.element.style.setProperty("--count", String(count));
    entries.forEach((entry, index) => {
      const petal = createButton(index === current ? "petal is-current" : "petal", this.ring);
      if (current >= 0) {
        petal.setAttribute("role", "menuitemradio");
        petal.setAttribute("aria-checked", String(index === current));
      } else {
        petal.setAttribute("role", "menuitem");
      }
      petal.dataset.index = String(index);
      petal.disabled = !entry.enabled;
      petal.tabIndex = -1;
      petal.style.setProperty("--angle", `${(index / count) * 360}deg`);
      petal.style.setProperty("--delay", `${index * 18}ms`);
      setHint(petal, entry.hotkey === undefined ? entry.label : `${entry.label} (${entry.hotkey})`, entry.detail);
      createIcon(entry.icon, "petal-icon", petal);
      if (entry.detail !== undefined) {
        createElement("span", "petal-detail", petal, entry.detail);
      }
      if (entry.hotkey !== undefined && entry.hotkey.length <= 3) {
        createKeyBadge(entry.hotkey, petal);
      }
    });
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
