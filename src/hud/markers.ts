// src/hud/markers.ts — Raummarkierungen über der 3D-Szene: runde Leuchtmarken mit Symbol der Objektart,
// Ringe für Auswahl und Aufschaltung, LP-Balken über Bienen; Elemente aus einem Vorrat. Markierungen unter
// einem Bedienfeld blenden aus.

import { createElement, NumberSlot, setVisible, StyleSlot, TextSlot } from "./dom";
import { EntityToneClass, entityKey } from "./entities";
import { clamp01, distanceStep, formatDistance } from "./format";
import { applyEntityClick, applyEntityDoubleClick, type HudContext } from "./hudContext";
import type { BracketHud, EntityType } from "./hudTypes";
import { IconSlot } from "./icons";
import { KeyedViews, type KeyedView } from "./keyedViews";
import type { PanelShield } from "./panelShield";

/** Ringdurchmesser: umschließt das Objekt, bleibt aber zwischen diesen Grenzen (Pixel). */
const MinRing = 34;
const MaxRing = 112;
/** Halbmesser der Leuchtmarke samt Schein in HUD-Einheiten. */
const PinRadiusUnits = 1.25;
/** So weit ragt der Blütenkranz der Aufschaltung über den Ring hinaus (Pixel). */
const PetalOverhang = 6;

/** Ringdurchmesser einer Markierung zur Bildschirmgröße des Objekts (Ringmaß). */
export function markerRingDiameter(size: number): number {
  return Math.round(Math.min(MaxRing, Math.max(MinRing, size + 12)));
}

/** Markierung eines Objekts im Raum (Raummarke). */
class MarkerView implements KeyedView {
  public readonly element: HTMLDivElement;
  public seen = 0;
  public current: BracketHud | undefined;
  private readonly position: StyleSlot;
  private readonly ring: StyleSlot;
  private readonly icon: IconSlot;
  private readonly hp: HTMLSpanElement;
  private readonly hpFill: StyleSlot;
  private readonly name: TextSlot;
  private readonly distance: NumberSlot;
  private type: EntityType | undefined;
  private x = Number.NaN;
  private y = Number.NaN;
  private ringSize = Number.NaN;
  private hpStep = -1;
  private hpTier = "";
  private covered = false;

  public constructor(layer: HTMLElement) {
    this.element = createElement("div", "mk", layer);
    this.position = new StyleSlot(this.element, "transform");
    this.ring = new StyleSlot(this.element, "--ring");
    createElement("span", "mk-ring", this.element);
    createElement("span", "mk-petals", this.element);
    const pin = createElement("span", "mk-pin", this.element);
    this.icon = new IconSlot(pin, "mk-icon");
    this.hp = createElement("span", "mk-hp", this.element);
    this.hpFill = new StyleSlot(createElement("i", "mk-hp-fill", this.hp), "transform");
    const label = createElement("span", "mk-label", this.element);
    this.name = new TextSlot(createElement("span", "mk-name", label));
    this.distance = new NumberSlot(createElement("span", "mk-distance", label), formatDistance, distanceStep);
  }

  public update(marker: BracketHud, shield: PanelShield): void {
    this.current = marker;
    if (marker.ref.type !== this.type) {
      if (this.type !== undefined) {
        this.element.classList.remove(EntityToneClass[this.type]);
      }
      this.type = marker.ref.type;
      this.element.classList.add(EntityToneClass[this.type]);
      this.icon.set(this.type);
    }
    setVisible(this.element, true);
    // Halbe Pixel genügen; seltener schreiben spart Stilberechnungen
    const x = Math.round(marker.x * 2) / 2;
    const y = Math.round(marker.y * 2) / 2;
    if (x !== this.x || y !== this.y) {
      this.x = x;
      this.y = y;
      this.position.set(`translate3d(${x}px, ${y}px, 0)`);
    }
    const ring = markerRingDiameter(marker.size);
    if (ring !== this.ringSize) {
      this.ringSize = ring;
      this.ring.set(`${ring}px`);
    }
    // Unter einem Bedienfeld ausblenden: Ring und Kranz zählen mit, sobald sie zu sehen sind
    const ringShown = marker.isSelected || marker.isLocked;
    const radius = Math.max(PinRadiusUnits * shield.unit, ringShown ? ring / 2 + PetalOverhang : 0);
    const covered = shield.coversCircle(marker.x, marker.y, radius);
    if (covered !== this.covered) {
      this.covered = covered;
      this.element.classList.toggle("is-covered", covered);
    }
    const classes = this.element.classList;
    classes.toggle("is-selected", marker.isSelected);
    classes.toggle("is-locked", marker.isLocked);
    classes.toggle("is-active", marker.isActiveTarget);
    classes.toggle("is-hostile", marker.hostile);
    classes.toggle("has-label", marker.showLabel);
    if (marker.showLabel) {
      this.name.set(marker.name);
      this.distance.set(marker.distance);
    }
    // LP-Balken über Bienen (Vorbild 2D)
    const hp = marker.ref.type === "bee" ? marker.hpRatio : undefined;
    setVisible(this.hp, hp !== undefined);
    if (hp !== undefined) {
      const step = Math.round(clamp01(hp) * 100);
      if (step !== this.hpStep) {
        this.hpStep = step;
        this.hpFill.set(`scaleX(${step / 100})`);
        const tier = step > 60 ? "hp-high" : step > 30 ? "hp-mid" : "hp-low";
        if (tier !== this.hpTier) {
          if (this.hpTier !== "") {
            this.hp.classList.remove(this.hpTier);
          }
          this.hpTier = tier;
          this.hp.classList.add(tier);
        }
      }
    }
  }

  /** Legt die Markierung für die Wiederverwendung beiseite. */
  public park(): void {
    this.current = undefined;
    setVisible(this.element, false);
  }

  public dispose(): void {
    this.element.remove();
  }
}

/** Ebene aller Raummarkierungen (Markierungsebene); Koordinaten in CSS-Pixeln relativ zur Oberfläche. */
export class MarkerLayer {
  private readonly element: HTMLDivElement;
  private readonly context: HudContext;
  private readonly views: KeyedViews<MarkerView>;
  private readonly pool: MarkerView[] = [];
  private readonly all: MarkerView[] = [];
  private readonly byElement = new WeakMap<Element, MarkerView>();

  private readonly onClick = (event: MouseEvent): void => {
    const marker = this.markerAt(event.target);
    if (marker !== undefined) {
      applyEntityClick(event, marker.ref, this.context.actions);
    }
  };

  private readonly onDoubleClick = (event: MouseEvent): void => {
    const marker = this.markerAt(event.target);
    if (marker !== undefined) {
      applyEntityDoubleClick(event, marker.ref, this.context.actions);
    }
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    const marker = this.markerAt(event.target);
    if (marker === undefined) {
      return;
    }
    event.preventDefault();
    const subject = { ref: marker.ref, distance: marker.distance, isLocked: marker.isLocked, isActiveTarget: marker.isActiveTarget };
    this.context.openEntityMenu(subject, marker.name, event.clientX, event.clientY);
  };

  public constructor(parent: HTMLElement, context: HudContext) {
    this.context = context;
    this.element = createElement("div", "hud-layer marker-layer", parent);
    this.views = new KeyedViews<MarkerView>(
      () => this.takeView(),
      (view) => {
        view.park();
        this.pool.push(view);
      },
    );
    this.element.addEventListener("click", this.onClick);
    this.element.addEventListener("dblclick", this.onDoubleClick);
    this.element.addEventListener("contextmenu", this.onContextMenu);
  }

  public update(markers: readonly BracketHud[], shield: PanelShield): void {
    this.views.begin();
    for (const marker of markers) {
      if (marker.onScreen) {
        this.views.claim(entityKey(marker.ref)).update(marker, shield);
      }
    }
    this.views.end();
  }

  public setVisible(visible: boolean): void {
    setVisible(this.element, visible);
  }

  public dispose(): void {
    this.element.removeEventListener("click", this.onClick);
    this.element.removeEventListener("dblclick", this.onDoubleClick);
    this.element.removeEventListener("contextmenu", this.onContextMenu);
    for (const view of this.all) {
      view.dispose();
    }
    this.element.remove();
  }

  private takeView(): MarkerView {
    const pooled = this.pool.pop();
    if (pooled !== undefined) {
      return pooled;
    }
    const view = new MarkerView(this.element);
    this.byElement.set(view.element, view);
    this.all.push(view);
    return view;
  }

  private markerAt(target: EventTarget | null): BracketHud | undefined {
    const element = target instanceof Element ? target.closest(".mk") : null;
    return element === null ? undefined : this.byElement.get(element)?.current;
  }
}
