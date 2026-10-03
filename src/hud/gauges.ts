// src/hud/gauges.ts — Füllstandsbilder der Bienenplakette: Honigglas (Lebenspunkte), Nektartropfen (Energie)
// und Pollenkörbchen (Ladung). Geschrieben wird nur, wenn sich der sichtbare Füllstand ändert.

import { AttributeSlot } from "./dom";
import { clamp01 } from "./format";

const Ink = "#5b3a1e";
const Outline = `stroke="${Ink}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"`;

let nextId = 0;

/** Eindeutige Kennung für Clip-Pfade, falls mehrere Anzeigen im Dokument stehen. */
function uniqueId(prefix: string): string {
  nextId++;
  return `hud-${prefix}-${nextId}`;
}

function parseSvg(markup: string): SVGSVGElement {
  const holder = document.createElement("template");
  holder.innerHTML = markup;
  const svg = holder.content.firstElementChild;
  if (!(svg instanceof SVGSVGElement)) {
    throw new Error("Füllanzeige ließ sich nicht anlegen.");
  }
  return svg;
}

/** Wellige Oberfläche einer Flüssigkeit von x0 bis x1 auf Höhe y, nach unten bis yBottom gefüllt (Flüssigkeit). */
function liquidPath(x0: number, x1: number, y: number, yBottom: number): string {
  let d = `M${x0} ${y}`;
  for (let x = x0; x < x1; x += 16) {
    d += "q4 -2.4 8 0t8 0";
  }
  return `${d}V${yBottom}H${x0}z`;
}

/** Einstellungen eines Gefäßes mit Flüssigkeit (Gefäßform). */
interface VesselShape {
  readonly className: string;
  readonly width: number;
  readonly height: number;
  /** Umriss des Gefäßes, zugleich Clip der Flüssigkeit. */
  readonly body: string;
  readonly glass: string;
  readonly liquid: string;
  /** Flüssigkeitsoberkante bei vollem Gefäß. */
  readonly top: number;
  readonly bottom: number;
  /** Zierrat über der Kontur (Deckel, Glanz). */
  readonly decoration: string;
}

/** Gefäß mit welliger Flüssigkeit, deren Stand einen Anteil 0..1 zeigt (Gefäßanzeige). */
class VesselGauge {
  public readonly element: SVGSVGElement;
  private readonly level: AttributeSlot;
  private readonly span: number;
  private step = -1;

  public constructor(shape: VesselShape) {
    const clip = uniqueId(shape.className);
    this.span = shape.bottom - shape.top;
    this.element = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" class="gauge ${shape.className}" viewBox="0 0 ${shape.width} ${shape.height}" aria-hidden="true" focusable="false">` +
        `<defs><clipPath id="${clip}"><path d="${shape.body}"/></clipPath></defs>` +
        `<path d="${shape.body}" fill="${shape.glass}"/>` +
        `<g clip-path="url(#${clip})"><g class="gauge-level"><path class="gauge-liquid" d="${liquidPath(-32, shape.width + 32, shape.top, shape.bottom + 4)}" fill="${shape.liquid}"/></g></g>` +
        `<path d="${shape.body}" fill="none" ${Outline}/>` +
        shape.decoration +
        `</svg>`,
    );
    const level = this.element.querySelector(".gauge-level");
    if (level === null) {
      throw new Error("Füllanzeige ohne Füllstand.");
    }
    this.level = new AttributeSlot(level, "transform");
  }

  /** Füllstand 0..1; die Anzeige ändert sich in 1-%-Schritten. */
  public set(ratio: number): void {
    const step = Math.round(clamp01(ratio) * 100);
    if (step !== this.step) {
      this.step = step;
      this.level.set(`translate(0 ${((1 - step / 100) * this.span).toFixed(2)})`);
      this.element.classList.toggle("is-low", step < 30);
    }
  }
}

/** Honigglas: Honigstand = Lebenspunkte (Honigglas). */
export class HoneyJarGauge extends VesselGauge {
  public constructor() {
    super({
      className: "gauge-jar",
      width: 40,
      height: 48,
      body: "M11 12.4h18v2.4c3.8 1.8 5.6 4.8 5.6 8.8v14.2c0 4.2-3.4 7.6-7.6 7.6H13c-4.2 0-7.6-3.4-7.6-7.6V23.6c0-4 1.8-7 5.6-8.8z",
      glass: "#fff7e2",
      liquid: "#f7b52c",
      top: 15.4,
      bottom: 45.4,
      decoration:
        `<rect x="8.4" y="5.2" width="23.2" height="7.6" rx="3.4" fill="#e08a1e" ${Outline}/>` +
        `<path d="M20 11.2c-2.6-1.8-3.6-2.8-3.6-4a1.8 1.8 0 0 1 3.6-.6 1.8 1.8 0 0 1 3.6.6c0 1.2-1 2.2-3.6 4z" fill="#f48fb1" stroke="${Ink}" stroke-width="1.2"/>` +
        `<path d="M10.4 25c0-2.4.8-4.2 2.4-5.4" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".8"/>`,
    });
  }
}

/** Nektartropfen: Füllstand = Energie (Nektartropfen). */
export class NectarDropGauge extends VesselGauge {
  public constructor() {
    super({
      className: "gauge-drop",
      width: 36,
      height: 48,
      body: "M18 3C12.6 12 6.6 18.4 6.6 28.6a11.4 11.4 0 0 0 22.8 0C29.4 18.4 23.4 12 18 3z",
      glass: "#eafcff",
      liquid: "#4fc9d9",
      top: 9,
      bottom: 40,
      decoration: `<path d="M11.4 27.4c0-2.8 1-5.4 2.6-7.4" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" opacity=".85"/>`,
    });
  }
}

/** Plätze der Pollenkugeln im Körbchen, von unten nach oben. */
const BallSpots: ReadonlyArray<readonly [number, number]> = [
  [12.6, 21.6],
  [19.6, 22.4],
  [27, 22.4],
  [34.2, 21.6],
  [16, 16.4],
  [23.4, 16],
  [30.6, 16.4],
  [23.4, 10.8],
];

/** Pollenkörbchen: Kugeln zeigen die Ladung, goldene Kugeln den Goldpollen (Pollenkörbchen). */
export class PollenBasketGauge {
  public readonly element: SVGSVGElement;
  private readonly balls: SVGCircleElement[];
  private shown = -1;
  private gold = -1;
  private full: boolean | undefined;

  public constructor() {
    let balls = "";
    for (const [x, y] of BallSpots) {
      balls += `<circle class="gauge-ball" cx="${x}" cy="${y}" r="4.4" stroke="${Ink}" stroke-width="2"/>`;
    }
    this.element = parseSvg(
      `<svg xmlns="http://www.w3.org/2000/svg" class="gauge gauge-basket" viewBox="0 0 48 40" aria-hidden="true" focusable="false">` +
        `<path d="M10 21C10 7 38 7 38 21" fill="none" ${Outline}/>` +
        balls +
        `<path d="M4.6 20.4h38.8l-3.6 13.2c-.6 2-2.4 3.4-4.4 3.4H12.6c-2 0-3.8-1.4-4.4-3.4z" fill="#c98a4b" ${Outline}/>` +
        `<path d="M10.4 26.2h27.2M12 31.2h24M16.4 20.4l1.6 16.4M24 20.4V36.8M31.6 20.4L30 36.8" fill="none" stroke="#8a5a2e" stroke-width="1.4" stroke-linecap="round"/>` +
        `</svg>`,
    );
    this.balls = Array.from(this.element.querySelectorAll<SVGCircleElement>(".gauge-ball"));
  }

  /** Ladung als Anteil 0..1 und Anteil des Goldpollens an der Ladung. */
  public set(ratio: number, goldShare: number): void {
    const level = clamp01(ratio);
    const shown = level > 0 ? Math.max(1, Math.round(level * this.balls.length)) : 0;
    const gold = goldShare > 0 && shown > 0 ? Math.max(1, Math.round(shown * clamp01(goldShare))) : 0;
    if (shown !== this.shown || gold !== this.gold) {
      this.shown = shown;
      this.gold = gold;
      this.balls.forEach((ball, index) => {
        ball.classList.toggle("is-shown", index < shown);
        // Goldpollen liegt obenauf: die zuletzt sichtbaren Kugeln funkeln
        ball.classList.toggle("is-gold", index < shown && index >= shown - gold);
      });
    }
    const full = level >= 1;
    if (full !== this.full) {
      this.full = full;
      this.element.classList.toggle("is-full", full);
    }
  }
}
