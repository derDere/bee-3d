// src/hud/dom.ts — DOM-Bausteine der Oberfläche: Elemente anlegen und Werte nur bei Änderung schreiben.

const SvgNamespace = "http://www.w3.org/2000/svg";

/** Legt ein HTML-Element an, setzt Klasse und Text und hängt es optional an (Elementfabrik). */
export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  parent?: Node,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  parent?.appendChild(element);
  return element;
}

/** Legt ein SVG-Element mit Attributen an (SVG-Fabrik). */
export function createSvgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Readonly<Record<string, string | number>>,
  parent?: Node,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SvgNamespace, tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
  parent?.appendChild(element);
  return element;
}

/** Schaltfläche ohne Formularverhalten (Schaltfläche). */
export function createButton(className: string, parent?: Node, text?: string): HTMLButtonElement {
  const button = createElement("button", className, parent, text);
  button.type = "button";
  return button;
}

/**
 * Englischer Hinweis eines Bedienelements (Hinweis): `title` und `aria-label`, optional ein Zusatz für den
 * Tooltip. Während der Tooltip ein Element zeigt, liegt dessen title in `data-tip-stash`, damit der
 * Browser keinen zweiten Hinweis einblendet; geschrieben wird dann dorthin.
 */
export function setHint(element: HTMLElement, label: string, detail?: string): void {
  if (element.dataset.tipStash !== undefined) {
    element.dataset.tipStash = label;
  } else {
    element.title = label;
  }
  element.setAttribute("aria-label", label);
  if (detail === undefined || detail === "") {
    element.removeAttribute("data-tip");
  } else {
    element.dataset.tip = detail;
  }
}

/** Hinweis, der nur bei geändertem Text geschrieben wird (Hinweisfeld). */
export class HintSlot {
  private readonly element: HTMLElement;
  private label: string | undefined;
  private detail: string | undefined;

  public constructor(element: HTMLElement) {
    this.element = element;
  }

  public set(label: string, detail?: string): void {
    if (label !== this.label || detail !== this.detail) {
      this.label = label;
      this.detail = detail;
      setHint(this.element, label, detail);
    }
  }
}

/** Blendet ein Element ein oder aus und berührt das DOM nur bei einem Wechsel (Sichtbarkeit). */
export function setVisible(element: HTMLElement, visible: boolean): void {
  if (element.hidden === visible) {
    element.hidden = !visible;
  }
}

/** Text, der nur bei Änderung in das DOM geschrieben wird (Textfeld). */
export class TextSlot {
  private readonly node: Node;
  private current: string | undefined;

  public constructor(node: Node) {
    this.node = node;
  }

  public set(text: string): void {
    if (text !== this.current) {
      this.current = text;
      this.node.textContent = text;
    }
  }
}

/**
 * Zahl, die erst bei geänderter Anzeigestufe formatiert und geschrieben wird (Zahlenfeld). Die
 * Stufenfunktion bildet den Wert auf die Genauigkeit der Anzeige ab, damit gleich aussehende Werte
 * weder eine Zeichenkette erzeugen noch das DOM berühren.
 */
export class NumberSlot {
  private readonly node: Node;
  private readonly format: (value: number) => string;
  private readonly step: (value: number) => number;
  private currentStep = Number.NaN;

  public constructor(node: Node, format: (value: number) => string, step: (value: number) => number = Math.round) {
    this.node = node;
    this.format = format;
    this.step = step;
  }

  public set(value: number): void {
    const step = this.step(value);
    if (step !== this.currentStep) {
      this.currentStep = step;
      this.node.textContent = this.format(value);
    }
  }
}

/** Inline-Stilwert, der nur bei Änderung gesetzt wird (Stilfeld). */
export class StyleSlot {
  private readonly style: CSSStyleDeclaration;
  private readonly property: string;
  private current: string | undefined;

  public constructor(element: HTMLElement | SVGElement, property: string) {
    this.style = element.style;
    this.property = property;
  }

  public set(value: string): void {
    if (value !== this.current) {
      this.current = value;
      this.style.setProperty(this.property, value);
    }
  }
}

/** Attribut, das nur bei Änderung gesetzt oder entfernt wird (Attributfeld). */
export class AttributeSlot {
  private readonly element: Element;
  private readonly name: string;
  private current: string | null | undefined;

  public constructor(element: Element, name: string) {
    this.element = element;
    this.name = name;
  }

  /** null entfernt das Attribut. */
  public set(value: string | null): void {
    if (value === this.current) {
      return;
    }
    this.current = value;
    if (value === null) {
      this.element.removeAttribute(this.name);
    } else {
      this.element.setAttribute(this.name, value);
    }
  }
}
