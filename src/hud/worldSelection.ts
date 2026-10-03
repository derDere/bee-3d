// src/hud/worldSelection.ts — Auswahl im Raum: Sprechblase und Befehlskranz hängen am ausgewählten Objekt. Liegt
// es außerhalb des Bildes oder hinter der Kamera, rücken beide mit einem Richtungspfeil an den nächsten Bildrand;
// liegt es unter einem Bedienfeld, rücken sie mit dem Pfeil daneben.

import { CommandRing, RingGapDegrees } from "./commandRing";
import { createElement, HintSlot, setVisible, StyleSlot } from "./dom";
import { EntityToneClass, sameEntity } from "./entities";
import type { HudContext } from "./hudContext";
import type { BracketHud, EntityRef, EntityType, SelectionHud } from "./hudTypes";
import { IconSlot } from "./icons";
import { markerRingDiameter } from "./markers";
import type { PanelShield, ScreenRect } from "./panelShield";
import { SelectionBubble } from "./selectionBubble";

/** Maße in HUD-Einheiten; sie entsprechen `--petal` und der Blasenbreite in hud.css. */
const PetalUnits = 2.7;
const BubbleWidthUnits = 15;
/** Kleinster Kranzradius bei wenigen Blättern. */
const MinRadiusUnits = 3.5;
/** Luft zwischen benachbarten Blättern samt Tastenabzeichen; mit mehr Blättern wächst der Kranz. */
const PetalSpacingUnits = 0.45;
/** Abstand zwischen dem Ring der Markierung und den Blättern. */
const RingClearanceUnits = 0.45;
/** Abstand zwischen den obersten Blättern und der Blase. */
const BubbleClearanceUnits = 0.35;
/** Mindestabstand zum Bildrand. */
const EdgeMarginUnits = 0.6;
/** Geschätzte Blasenhöhe, bis die erste Messung vorliegt. */
const BubbleHeightGuessUnits = 7;
/** Der Zipfel bleibt so weit von den Blasenecken entfernt. */
const TailInsetUnits = 1.4;
/** Die Blase wechselt die Seite erst, wenn die andere um so viele Einheiten² weniger verdeckt. */
const SideHysteresisUnits = 6;
/** So lange gilt die zuletzt gesehene Richtung für ein Objekt hinter der Kamera (Millisekunden). */
const DirectionMemoryMs = 8000;
/** Höchstens so viele Bedienfelder schiebt die Randlage nacheinander beiseite. */
const PanelPushes = 3;
/** Ein Objekt gilt als verdeckt, wenn ein Bedienfeld so nah an seinem Mittelpunkt liegt. */
const CoverRadiusUnits = 0.5;
/** So weit ragen die Abstandsfähnchen über die Blätter hinaus. */
const TagReachUnits = 1.5;
/** Luft zwischen der beiseitegerückten Gruppe und einem Bedienfeld. */
const PanelGapUnits = 0.4;

const GapCosine = Math.cos(((RingGapDegrees / 2) * Math.PI) / 180);

/** Seite der Blase zum Objekt (Blasenseite). */
type BubbleSide = "above" | "below";

function clamp(value: number, min: number, max: number): number {
  return min > max ? (min + max) / 2 : value < min ? min : value > max ? max : value;
}

/** Kleinster Kranzradius (HUD-Einheiten), bei dem `petals` Blätter mit Luft nebeneinander auf dem Bogen liegen. */
function minRingRadiusUnits(petals: number): number {
  if (petals < 2) {
    return MinRadiusUnits;
  }
  const step = (((360 - RingGapDegrees) / (petals - 1)) * Math.PI) / 180;
  return Math.max(MinRadiusUnits, (PetalUnits + PetalSpacingUnits) / (2 * Math.sin(step / 2)));
}

/** Klammer des ausgewählten Objekts; fehlt sie, liegt das Objekt hinter der Kamera. */
function findSelectedBracket(brackets: readonly BracketHud[], ref: EntityRef): BracketHud | undefined {
  for (const bracket of brackets) {
    if (bracket.isSelected && sameEntity(bracket.ref, ref)) {
      return bracket;
    }
  }
  return undefined;
}

/** Maße der Gruppe in Pixeln für den aktuellen Frame (Gruppenmaße). */
interface GroupMetrics {
  /** Halbe Breite von Kranz bzw. Blase, je nachdem, was breiter ist. */
  halfX: number;
  /** Ausdehnung über und unter dem Mittelpunkt. */
  up: number;
  down: number;
}

/**
 * Auswahl im Raum (Raumauswahl): Mitte des Kranzes ist das Objekt auf dem Bildschirm; die Blase sitzt über dem
 * Kranz oder, wo oben kein Platz ist, darunter. In Randlage (Objekt außerhalb des Bildes, hinter der Kamera oder
 * unter einem Bedienfeld) steht in der Mitte das Symbol des Objekts mit einem Pfeil in seine Richtung, und die
 * ganze Gruppe weicht den Bedienfeldern aus.
 */
export class WorldSelection {
  private readonly element: HTMLDivElement;
  private readonly bubble: SelectionBubble;
  private readonly ring: CommandRing;
  private readonly proxyIcon: IconSlot;
  private readonly proxyHint: HintSlot;
  private readonly position: StyleSlot;
  private readonly radiusStyle: StyleSlot;
  private readonly offsetStyle: StyleSlot;
  private readonly shiftStyle: StyleSlot;
  private readonly tailStyle: StyleSlot;
  private readonly directionStyle: StyleSlot;
  private readonly resizeObserver: ResizeObserver;
  private readonly above: ScreenRect = { left: 0, top: 0, right: 0, bottom: 0 };
  private readonly below: ScreenRect = { left: 0, top: 0, right: 0, bottom: 0 };
  private readonly box: ScreenRect = { left: 0, top: 0, right: 0, bottom: 0 };
  /** Erlaubter Bereich des Mittelpunkts in Randlage. */
  private readonly bounds: ScreenRect = { left: 0, top: 0, right: 0, bottom: 0 };
  private readonly metrics: GroupMetrics = { halfX: 0, up: 0, down: 0 };
  private ref: EntityRef | undefined;
  private type: EntityType | undefined;
  private side: BubbleSide = "above";
  private edge = false;
  private behind = false;
  private bubbleWidth = 0;
  private bubbleHeight = 0;
  private directionX = 0;
  private directionY = 1;
  private directionAt = Number.NEGATIVE_INFINITY;
  /** Mittelpunkt der Gruppe in diesem Frame. */
  private centerX = 0;
  private centerY = 0;
  private placedX = Number.NaN;
  private placedY = Number.NaN;

  public constructor(parent: HTMLElement, context: HudContext) {
    this.element = createElement("div", "world-sel", parent);
    this.element.hidden = true;
    const proxy = createElement("div", "sel-proxy", this.element);
    // Die Spitze liegt unter dem Symbol; zusammen bilden sie eine Stecknadel, die zum Objekt zeigt
    createElement("span", "sel-arrow", proxy);
    this.proxyIcon = new IconSlot(createElement("span", "sel-proxy-pin", proxy), "sel-proxy-icon");
    this.proxyHint = new HintSlot(proxy);
    this.ring = new CommandRing(this.element, context);
    this.bubble = new SelectionBubble(this.element, context.actions);
    this.position = new StyleSlot(this.element, "transform");
    this.radiusStyle = new StyleSlot(this.element, "--radius");
    this.offsetStyle = new StyleSlot(this.element, "--offset");
    this.shiftStyle = new StyleSlot(this.element, "--shift");
    this.tailStyle = new StyleSlot(this.element, "--tail");
    this.directionStyle = new StyleSlot(this.element, "--dir");
    this.resizeObserver = new ResizeObserver((entries) => {
      const size = entries[entries.length - 1].borderBoxSize[0];
      this.bubbleWidth = size.inlineSize;
      this.bubbleHeight = size.blockSize;
    });
    this.resizeObserver.observe(this.bubble.element);
  }

  /**
   * Jeden Frame: Lage aus der Klammer des ausgewählten Objekts (`isSelected`) und den Bedienfeldern; `lookAt` ist das
   * Objekt, auf das die Kamera gerade gerichtet ist.
   */
  public update(selection: SelectionHud | undefined, brackets: readonly BracketHud[], shield: PanelShield, now: number, lookAt: EntityRef | undefined): void {
    setVisible(this.element, selection !== undefined);
    if (selection === undefined) {
      this.ref = undefined;
      return;
    }
    if (!sameEntity(selection.ref, this.ref)) {
      this.ref = selection.ref;
      this.directionAt = Number.NEGATIVE_INFINITY;
      this.side = "above";
      this.applyType(selection.ref.type);
      this.replayEntrance();
    }
    const bracket = findSelectedBracket(brackets, selection.ref);

    const unit = shield.unit;
    const width = shield.width;
    const height = shield.height;
    const petal = PetalUnits * unit;
    const margin = EdgeMarginUnits * unit;
    // Im Blick: im Bild und nicht unter einem Bedienfeld; sonst rückt die Gruppe wie in Randlage beiseite
    const inView = bracket !== undefined && bracket.onScreen && !shield.coversCircle(bracket.x, bracket.y, CoverRadiusUnits * unit);
    const markerRing = inView ? markerRingDiameter(bracket.size) : 0;
    const minRadius = minRingRadiusUnits(this.ring.shownCount(selection)) * unit;
    const radius = Math.round(Math.max(minRadius, markerRing / 2 + RingClearanceUnits * unit + petal / 2));
    const offset = Math.round(radius * GapCosine + petal / 2 + BubbleClearanceUnits * unit);
    const bubbleWidth = this.bubbleWidth > 0 ? this.bubbleWidth : BubbleWidthUnits * unit;
    const bubbleHeight = this.bubbleHeight > 0 ? this.bubbleHeight : BubbleHeightGuessUnits * unit;

    if (bracket !== undefined) {
      this.directionX = bracket.x - width / 2;
      this.directionY = bracket.y - height / 2;
      this.directionAt = now;
    }
    const behind = bracket === undefined;
    const edge = !inView;
    if (inView) {
      this.centerX = bracket.x;
      this.centerY = bracket.y;
      this.chooseSide(offset, bubbleWidth, bubbleHeight, margin, width, height, shield, unit);
    } else {
      if (behind && now - this.directionAt > DirectionMemoryMs) {
        // Hinter der Kamera ohne bekannte Richtung: unten („dreh dich um“)
        this.directionX = 0;
        this.directionY = 1;
      }
      // Liegt das Objekt in der oberen Bildhälfte, hängt die Blase unter dem Kranz und zeigt so zur Bildmitte
      this.side = this.directionY < 0 ? "below" : "above";
      this.measureGroup(radius + petal / 2 + TagReachUnits * unit, offset, bubbleWidth, bubbleHeight);
      this.edgeBounds(margin, width, height);
      if (bracket !== undefined && bracket.onScreen) {
        // Unter einem Bedienfeld: vom Objekt aus auf dem kürzesten Weg neben das Feld
        this.centerX = clamp(bracket.x, this.bounds.left, this.bounds.right);
        this.centerY = clamp(bracket.y, this.bounds.top, this.bounds.bottom);
      } else {
        this.clampToEdge(width, height);
      }
      this.avoidPanels(shield);
    }

    this.place();
    this.radiusStyle.set(`${radius}px`);
    this.offsetStyle.set(`${offset}px`);
    const shift = Math.round(clamp(this.centerX, margin + bubbleWidth / 2, width - margin - bubbleWidth / 2) - this.centerX);
    this.shiftStyle.set(`${shift}px`);
    const tailLimit = Math.max(0, bubbleWidth / 2 - TailInsetUnits * unit);
    this.tailStyle.set(`${Math.round(clamp(-shift, -tailLimit, tailLimit))}px`);
    if (edge) {
      // Der Pfeil zeigt von der Gruppe zum Objekt; hinter der Kamera in die zuletzt gesehene Richtung
      const arrowX = bracket !== undefined ? bracket.x - this.centerX : this.directionX;
      const arrowY = bracket !== undefined ? bracket.y - this.centerY : this.directionY;
      this.directionStyle.set(`${Math.round((Math.atan2(arrowY, arrowX) * 180) / Math.PI)}deg`);
    }
    if (edge !== this.edge || behind !== this.behind) {
      this.edge = edge;
      this.behind = behind;
      this.element.classList.toggle("is-edge", edge);
      this.element.classList.toggle("is-behind", behind);
      this.proxyHint.set(behind ? "Behind you – turn around" : "Out of view – the arrow shows the way");
    }
    this.element.classList.toggle("is-below", this.side === "below");
    this.ring.update(selection, this.side === "below", lookAt);
    this.bubble.update(selection);
  }

  public dispose(): void {
    this.resizeObserver.disconnect();
    this.ring.dispose();
    this.bubble.dispose();
    this.element.remove();
  }

  private applyType(type: EntityType): void {
    if (this.type !== undefined) {
      this.element.classList.remove(EntityToneClass[this.type]);
    }
    this.type = type;
    this.element.classList.add(EntityToneClass[type]);
    this.proxyIcon.set(type);
  }

  /** Blase und Blätter springen bei jeder neuen Auswahl wieder auf. */
  private replayEntrance(): void {
    for (const animation of this.element.getAnimations({ subtree: true })) {
      animation.cancel();
      animation.play();
    }
  }

  private place(): void {
    // Halbe Pixel genügen; seltener schreiben spart Stilberechnungen
    const left = Math.round(this.centerX * 2) / 2;
    const top = Math.round(this.centerY * 2) / 2;
    if (left !== this.placedX || top !== this.placedY) {
      this.placedX = left;
      this.placedY = top;
      this.position.set(`translate3d(${left}px, ${top}px, 0)`);
    }
  }

  /**
   * Blase über oder unter dem Objekt: Oben ist der Normalfall. Nach unten wechselt sie erst, wenn oben deutlich
   * mehr Bedienfläche verdeckt würde oder kein Platz im Bild ist, und zurück, sobald oben wieder nicht schlechter ist.
   * Das Band dazwischen verhindert, dass die Blase flattert.
   */
  private chooseSide(
    offset: number,
    bubbleWidth: number,
    bubbleHeight: number,
    margin: number,
    width: number,
    height: number,
    shield: PanelShield,
    unit: number,
  ): void {
    const center = clamp(this.centerX, margin + bubbleWidth / 2, width - margin - bubbleWidth / 2);
    const above = this.above;
    const below = this.below;
    above.left = below.left = center - bubbleWidth / 2;
    above.right = below.right = center + bubbleWidth / 2;
    above.bottom = this.centerY - offset;
    above.top = above.bottom - bubbleHeight;
    below.top = this.centerY + offset;
    below.bottom = below.top + bubbleHeight;
    const aboveCost = this.cost(above, margin, height, bubbleWidth, shield);
    const belowCost = this.cost(below, margin, height, bubbleWidth, shield);
    if (this.side === "above") {
      if (belowCost + SideHysteresisUnits * unit * unit < aboveCost) {
        this.side = "below";
      }
    } else if (aboveCost <= belowCost) {
      this.side = "above";
    }
  }

  /** Verdeckte Bedienfläche plus ein hoher Aufschlag für jeden Pixel außerhalb des Bildes. */
  private cost(rect: ScreenRect, margin: number, height: number, bubbleWidth: number, shield: PanelShield): number {
    const outside = Math.max(0, margin - rect.top) + Math.max(0, rect.bottom - (height - margin));
    return shield.overlap(rect) + outside * bubbleWidth * 4;
  }

  /** Ausdehnung von Kranz und Blase um den Mittelpunkt, je nach Seite der Blase. */
  private measureGroup(ringHalf: number, offset: number, bubbleWidth: number, bubbleHeight: number): void {
    const metrics = this.metrics;
    metrics.halfX = Math.max(ringHalf, bubbleWidth / 2);
    metrics.up = this.side === "above" ? offset + bubbleHeight : ringHalf;
    metrics.down = this.side === "above" ? ringHalf : offset + bubbleHeight;
  }

  /** Bereich, in dem der Mittelpunkt in Randlage liegen darf, damit Kranz und Blase ganz im Bild bleiben. */
  private edgeBounds(margin: number, width: number, height: number): void {
    const metrics = this.metrics;
    const bounds = this.bounds;
    bounds.left = margin + metrics.halfX;
    bounds.right = width - margin - metrics.halfX;
    bounds.top = margin + metrics.up;
    bounds.bottom = height - margin - metrics.down;
  }

  /** Vom Bildmittelpunkt in Richtung des Objekts bis an den Rand des erlaubten Bereichs. */
  private clampToEdge(width: number, height: number): void {
    const bounds = this.bounds;
    const originX = clamp(width / 2, bounds.left, bounds.right);
    const originY = clamp(height / 2, bounds.top, bounds.bottom);
    const dx = this.directionX;
    const dy = this.directionY;
    let reach = Number.POSITIVE_INFINITY;
    if (dx > 0) {
      reach = Math.min(reach, (bounds.right - originX) / dx);
    } else if (dx < 0) {
      reach = Math.min(reach, (bounds.left - originX) / dx);
    }
    if (dy > 0) {
      reach = Math.min(reach, (bounds.bottom - originY) / dy);
    } else if (dy < 0) {
      reach = Math.min(reach, (bounds.top - originY) / dy);
    }
    if (!Number.isFinite(reach) || reach < 0) {
      reach = 0;
    }
    this.centerX = clamp(originX + dx * reach, bounds.left, bounds.right);
    this.centerY = clamp(originY + dy * reach, bounds.top, bounds.bottom);
  }

  /**
   * Schiebt die Gruppe aus Bedienfeldern heraus: je Schritt aus dem am stärksten überdeckten Feld, auf dem
   * kürzesten Weg, der im erlaubten Bereich bleibt.
   */
  private avoidPanels(shield: PanelShield): void {
    const box = this.box;
    const metrics = this.metrics;
    for (let push = 0; push < PanelPushes; push++) {
      box.left = this.centerX - metrics.halfX;
      box.right = this.centerX + metrics.halfX;
      box.top = this.centerY - metrics.up;
      box.bottom = this.centerY + metrics.down;
      const worst = this.mostCovered(shield);
      if (worst === undefined || !this.pushOut(worst, PanelGapUnits * shield.unit)) {
        return;
      }
    }
  }

  /** Das Bedienfeld, das die Gruppe am stärksten überdeckt (keines, wenn sie frei steht). */
  private mostCovered(shield: PanelShield): Readonly<ScreenRect> | undefined {
    const box = this.box;
    let worst: Readonly<ScreenRect> | undefined;
    let worstArea = 0;
    for (let index = 0; index < shield.rectCount; index++) {
      const rect = shield.rectAt(index);
      const overlapWidth = Math.min(box.right, rect.right) - Math.max(box.left, rect.left);
      const overlapHeight = Math.min(box.bottom, rect.bottom) - Math.max(box.top, rect.top);
      if (overlapWidth > 0 && overlapHeight > 0 && overlapWidth * overlapHeight > worstArea) {
        worstArea = overlapWidth * overlapHeight;
        worst = rect;
      }
    }
    return worst;
  }

  /** Kürzester Schritt links, rechts, hoch oder runter aus dem Feld (mit etwas Luft), der im erlaubten Bereich bleibt. */
  private pushOut(rect: Readonly<ScreenRect>, gap: number): boolean {
    const box = this.box;
    const bounds = this.bounds;
    let best = Number.POSITIVE_INFINITY;
    let moveX = 0;
    let moveY = 0;
    for (let direction = 0; direction < 4; direction++) {
      const dx = direction === 0 ? rect.left - gap - box.right : direction === 1 ? rect.right + gap - box.left : 0;
      const dy = direction === 2 ? rect.top - gap - box.bottom : direction === 3 ? rect.bottom + gap - box.top : 0;
      const nextX = this.centerX + dx;
      const nextY = this.centerY + dy;
      const distance = Math.abs(dx) + Math.abs(dy);
      if (distance < best && nextX >= bounds.left && nextX <= bounds.right && nextY >= bounds.top && nextY <= bounds.bottom) {
        best = distance;
        moveX = dx;
        moveY = dy;
      }
    }
    if (!Number.isFinite(best)) {
      return false;
    }
    this.centerX += moveX;
    this.centerY += moveY;
    return true;
  }
}
