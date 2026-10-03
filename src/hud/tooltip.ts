// src/hud/tooltip.ts — gemeinsamer Hinweistext für Bedienelemente mit title bzw. data-tip.

import { createElement, setVisible, TextSlot } from "./dom";

const ShowDelayMs = 300;
const ViewportMargin = 8;
const AnchorGap = 10;
const AnchorSelector = "[title], [data-tip], [data-tip-stash]";

/**
 * Hinweistext zu Bedienelementen (Tooltip): Überschrift aus `title`, Zusatz aus `data-tip`
 * (Zeilenumbruch per \n). Solange der Hinweis steht, parkt der title in `data-tip-stash`, damit der
 * Browser keinen eigenen Hinweis darüberlegt. Findet seine Elemente per Ereignisdelegation.
 */
export class Tooltip {
  private readonly host: HTMLElement;
  private readonly element: HTMLDivElement;
  private readonly titleElement: HTMLDivElement;
  private readonly bodyElement: HTMLDivElement;
  private readonly title: TextSlot;
  private readonly body: TextSlot;
  private anchor: HTMLElement | undefined;
  private pending: HTMLElement | undefined;
  private timer: number | undefined;

  private readonly onPointerOver = (event: PointerEvent): void => {
    if (event.pointerType === "touch") {
      return;
    }
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>(AnchorSelector) : null;
    if (target === null || !this.host.contains(target)) {
      this.hide();
      return;
    }
    if (target === this.anchor || target === this.pending) {
      return;
    }
    this.hide();
    this.pending = target;
    this.stash(target);
    this.timer = window.setTimeout(() => this.show(target), ShowDelayMs);
  };

  private readonly onPointerOut = (event: PointerEvent): void => {
    const current = this.anchor ?? this.pending;
    if (current === undefined) {
      return;
    }
    const next = event.relatedTarget;
    if (next instanceof Node && current.contains(next)) {
      return;
    }
    this.hide();
  };

  private readonly onPointerDown = (): void => this.hide();

  public constructor(host: HTMLElement, layer: HTMLElement) {
    this.host = host;
    this.element = createElement("div", "tooltip", layer);
    this.element.setAttribute("role", "tooltip");
    this.element.hidden = true;
    this.titleElement = createElement("div", "tooltip-title", this.element);
    this.bodyElement = createElement("div", "tooltip-body", this.element);
    this.title = new TextSlot(this.titleElement);
    this.body = new TextSlot(this.bodyElement);
    host.addEventListener("pointerover", this.onPointerOver);
    host.addEventListener("pointerout", this.onPointerOut);
    host.addEventListener("pointerdown", this.onPointerDown, true);
  }

  /** Übernimmt geänderte Texte des gezeigten Elements; jeden Frame aufrufbar. */
  public refresh(): void {
    if (this.anchor === undefined) {
      return;
    }
    if (!this.anchor.isConnected || this.anchor.closest("[hidden]") !== null) {
      this.hide();
      return;
    }
    this.fill(this.anchor);
  }

  public hide(): void {
    if (this.timer !== undefined) {
      window.clearTimeout(this.timer);
      this.timer = undefined;
    }
    const current = this.anchor ?? this.pending;
    if (current !== undefined) {
      this.unstash(current);
    }
    this.pending = undefined;
    this.anchor = undefined;
    setVisible(this.element, false);
  }

  public dispose(): void {
    this.hide();
    this.host.removeEventListener("pointerover", this.onPointerOver);
    this.host.removeEventListener("pointerout", this.onPointerOut);
    this.host.removeEventListener("pointerdown", this.onPointerDown, true);
    this.element.remove();
  }

  private show(anchor: HTMLElement): void {
    this.timer = undefined;
    this.pending = undefined;
    if (!anchor.isConnected) {
      return;
    }
    this.anchor = anchor;
    this.fill(anchor);
    setVisible(this.element, true);
    this.place(anchor);
  }

  private fill(anchor: HTMLElement): void {
    const title = anchor.dataset.tipStash ?? anchor.title;
    const body = anchor.dataset.tip ?? "";
    this.title.set(title);
    this.body.set(body);
    setVisible(this.titleElement, title !== "");
    setVisible(this.bodyElement, body !== "");
  }

  private stash(anchor: HTMLElement): void {
    const title = anchor.getAttribute("title");
    if (title !== null) {
      anchor.dataset.tipStash = title;
      anchor.removeAttribute("title");
    }
  }

  private unstash(anchor: HTMLElement): void {
    const title = anchor.dataset.tipStash;
    if (title !== undefined) {
      anchor.title = title;
      delete anchor.dataset.tipStash;
    }
  }

  /** Über dem Element, bei Platzmangel darunter; immer ganz im Bild. */
  private place(anchor: HTMLElement): void {
    const host = this.host.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    const width = this.element.offsetWidth;
    const height = this.element.offsetHeight;
    let x = rect.left + rect.width / 2 - width / 2 - host.left;
    let y = rect.top - height - AnchorGap - host.top;
    if (y < ViewportMargin) {
      y = rect.bottom + AnchorGap - host.top;
    }
    x = Math.min(Math.max(ViewportMargin, x), host.width - width - ViewportMargin);
    y = Math.min(Math.max(ViewportMargin, y), host.height - height - ViewportMargin);
    this.element.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
}
