// src/hud/commandRing.ts — Befehlskranz um das ausgewählte Objekt: runde Symbolknöpfe als Blütenblätter mit
// Tastenabzeichen. Umkreisen und Abstand halten tragen ihren Abstand als Fähnchen; Fähnchen, Rechtsklick oder
// langer Druck auf das Blatt öffnen die Abstandswahl.

import { buildDistanceChoices, CommandDistanceChoices, DistanceCommandNames, type DistanceCommand } from "./commandMenu";
import { createButton, createElement, NumberSlot, setHint, setVisible } from "./dom";
import { isLockableType } from "./entities";
import { distanceStep, formatDistance } from "./format";
import type { HudContext } from "./hudContext";
import type { CommandIcon, SelectionHud } from "./hudTypes";
import { createKeyBadge } from "./iconButton";
import { IconSlot } from "./icons";

/** Blatt des Befehlskranzes (Befehlsblatt). */
type PetalKind = "approach" | "orbit" | "keepRange" | "align" | "warp" | "dock" | "lock";

interface PetalSpec {
  readonly kind: PetalKind;
  readonly icon: CommandIcon;
  readonly key: string | undefined;
  readonly label: string;
  readonly hint: string;
}

const Petals: readonly PetalSpec[] = [
  { kind: "approach", icon: "approach", key: "Q", label: "Approach (Q)", hint: "Fly there and stop in front of it." },
  { kind: "orbit", icon: "orbit", key: "W", label: "Orbit (W)", hint: "Circle around it.\nRight-click or hold to choose the distance." },
  { kind: "keepRange", icon: "keepRange", key: "E", label: "Keep range (E)", hint: "Hold the distance; stops if it vanishes.\nRight-click or hold to choose the distance." },
  { kind: "align", icon: "align", key: "A", label: "Align (A)", hint: "Turn your flight direction toward it." },
  { kind: "warp", icon: "warp", key: "S", label: "Warp (S)", hint: "Ride the storm wind to things at least 150 m away." },
  { kind: "dock", icon: "dock", key: "D", label: "Dock (D)", hint: "Hives only, within 45 m." },
  { kind: "lock", icon: "lock", key: undefined, label: "Lock target (Ctrl+Click)", hint: "Lock on to use your modules on it." },
];

/** Lücke im Kranz zur Sprechblase hin (Grad). */
export const RingGapDegrees = 64;
/** Ab dieser Druckdauer öffnet ein Blatt mit Abstand die Abstandswahl (Millisekunden). */
const LongPressMs = 450;

function isDistanceKind(kind: PetalKind): kind is DistanceCommand {
  return kind === "orbit" || kind === "keepRange";
}

/** Andocken gibt es nur an Bienenstöcken, Aufschalten nur bei aufschaltbaren Arten. */
function isShown(kind: PetalKind, selection: SelectionHud): boolean {
  switch (kind) {
    case "dock":
      return selection.ref.type === "hive" || selection.canDock;
    case "lock":
      return selection.isLocked || selection.canLock || isLockableType(selection.ref.type);
    default:
      return true;
  }
}

function isEnabled(kind: PetalKind, selection: SelectionHud): boolean {
  switch (kind) {
    case "approach":
      return selection.canApproach;
    case "orbit":
      return selection.canOrbit;
    case "keepRange":
      return selection.canKeepRange;
    case "align":
      return selection.canAlign;
    case "warp":
      return selection.canWarp;
    case "dock":
      return selection.canDock;
    case "lock":
      return selection.isLocked || selection.canLock;
  }
}

/** Ein Blatt mit Knopf und bei Abstandsbefehlen einem Fähnchen (Blattansicht). */
class PetalView {
  public readonly spec: PetalSpec;
  public readonly slot: HTMLDivElement;
  public readonly button: HTMLButtonElement;
  public readonly icon: IconSlot;
  public readonly tag: HTMLButtonElement | undefined;
  private readonly tagValue: NumberSlot | undefined;
  public shown = false;
  private enabled: boolean | undefined;

  public constructor(parent: HTMLElement, spec: PetalSpec, index: number) {
    this.spec = spec;
    this.slot = createElement("div", `ring-slot ring-${spec.kind}`, parent);
    this.slot.style.setProperty("--i", String(index));
    this.button = createButton("icon-btn round-btn ring-petal", this.slot);
    this.button.tabIndex = -1;
    setHint(this.button, spec.label, spec.hint);
    this.icon = new IconSlot(this.button, "icon-btn-icon");
    this.icon.set(spec.icon);
    if (spec.key !== undefined) {
      createKeyBadge(spec.key, this.button);
    }
    if (isDistanceKind(spec.kind)) {
      this.tag = createButton("ring-tag", this.slot);
      this.tag.tabIndex = -1;
      setHint(this.tag, DistanceCommandNames[spec.kind].choiceTitle, "Click to choose another distance.");
      this.tagValue = new NumberSlot(this.tag, formatDistance, distanceStep);
    }
  }

  public setShown(shown: boolean): void {
    this.shown = shown;
    setVisible(this.slot, shown);
  }

  public update(selection: SelectionHud): void {
    const enabled = isEnabled(this.spec.kind, selection);
    if (enabled !== this.enabled) {
      this.enabled = enabled;
      this.button.disabled = !enabled;
      if (this.tag !== undefined) {
        this.tag.disabled = !enabled;
      }
    }
    if (this.tagValue !== undefined) {
      this.tagValue.set(this.spec.kind === "orbit" ? selection.orbitDistance : selection.keepRangeDistance);
    }
  }
}

/** Befehlskranz um die Auswahl (Befehlskranz). */
export class CommandRing {
  public readonly element: HTMLDivElement;
  private readonly context: HudContext;
  private readonly views: PetalView[] = [];
  private readonly bySlot = new WeakMap<Element, PetalView>();
  private readonly lockView: PetalView;
  private current: SelectionHud | undefined;
  private layoutMask = -1;
  private locked: boolean | undefined;
  private pressTimer = 0;
  private suppressClick = false;

  private readonly onClick = (event: MouseEvent): void => {
    if (this.suppressClick) {
      // Klick am Ende eines langen Drucks: die Abstandswahl ist schon offen
      this.suppressClick = false;
      return;
    }
    const target = event.target;
    const view = this.viewAt(target);
    if (view === undefined || this.current === undefined || !(target instanceof Node)) {
      return;
    }
    const kind = view.spec.kind;
    if (view.tag !== undefined && view.tag.contains(target) && isDistanceKind(kind)) {
      this.openChoices(kind, event.clientX, event.clientY);
    } else if (view.button.contains(target)) {
      this.run(kind, this.current);
    }
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    const view = this.viewAt(event.target);
    if (view === undefined) {
      return;
    }
    event.preventDefault();
    const kind = view.spec.kind;
    if (isDistanceKind(kind) && !view.button.disabled) {
      this.openChoices(kind, event.clientX, event.clientY);
    }
  };

  /** Langer Druck mit Finger oder Stift auf Umkreisen oder Abstand halten öffnet die Abstandswahl. */
  private readonly onPointerDown = (event: PointerEvent): void => {
    this.cancelPress();
    this.suppressClick = false;
    const view = this.viewAt(event.target);
    if (event.pointerType === "mouse" || view === undefined || view.button.disabled) {
      return;
    }
    const kind = view.spec.kind;
    if (!isDistanceKind(kind)) {
      return;
    }
    const { clientX, clientY } = event;
    this.pressTimer = window.setTimeout(() => {
      this.pressTimer = 0;
      this.suppressClick = true;
      this.openChoices(kind, clientX, clientY);
    }, LongPressMs);
  };

  private readonly onPointerEnd = (): void => this.cancelPress();

  public constructor(parent: HTMLElement, context: HudContext) {
    this.context = context;
    this.element = createElement("div", "sel-ring", parent);
    this.element.setAttribute("role", "toolbar");
    this.element.setAttribute("aria-label", "Commands");
    Petals.forEach((spec, index) => {
      const view = new PetalView(this.element, spec, index);
      this.bySlot.set(view.slot, view);
      this.views.push(view);
    });
    this.lockView = this.views[this.views.length - 1];
    this.element.addEventListener("click", this.onClick);
    this.element.addEventListener("contextmenu", this.onContextMenu);
    this.element.addEventListener("pointerdown", this.onPointerDown);
    this.element.addEventListener("pointerup", this.onPointerEnd);
    this.element.addEventListener("pointercancel", this.onPointerEnd);
    this.element.addEventListener("pointerleave", this.onPointerEnd);
  }

  /** `flipped`: Die Blase hängt unter dem Objekt; der Kranz öffnet sich nach unten. */
  public update(selection: SelectionHud, flipped: boolean): void {
    this.current = selection;
    let mask = flipped ? 1 << this.views.length : 0;
    for (let index = 0; index < this.views.length; index++) {
      if (isShown(this.views[index].spec.kind, selection)) {
        mask |= 1 << index;
      }
    }
    if (mask !== this.layoutMask) {
      this.layoutMask = mask;
      this.layout(mask, flipped);
    }
    for (const view of this.views) {
      if (view.shown) {
        view.update(selection);
      }
    }
    if (selection.isLocked !== this.locked) {
      this.locked = selection.isLocked;
      const button = this.lockView.button;
      this.lockView.icon.set(selection.isLocked ? "unlock" : "lock");
      if (selection.isLocked) {
        setHint(button, "Unlock target (Ctrl+Shift+Click)", "Let go of this target.");
      } else {
        setHint(button, "Lock target (Ctrl+Click)", "Lock on to use your modules on it.");
      }
      button.classList.toggle("is-locked", selection.isLocked);
    }
  }

  public dispose(): void {
    this.cancelPress();
    this.element.removeEventListener("click", this.onClick);
    this.element.removeEventListener("contextmenu", this.onContextMenu);
    this.element.removeEventListener("pointerdown", this.onPointerDown);
    this.element.removeEventListener("pointerup", this.onPointerEnd);
    this.element.removeEventListener("pointercancel", this.onPointerEnd);
    this.element.removeEventListener("pointerleave", this.onPointerEnd);
    this.element.remove();
  }

  /**
   * Verteilt die sichtbaren Blätter im Uhrzeigersinn auf den Kreis und lässt zur Blase hin eine Lücke;
   * hängt die Blase unten, wird der Kranz gespiegelt, damit Q W E rechts und S D links bleiben.
   */
  private layout(mask: number, flipped: boolean): void {
    let count = 0;
    for (let index = 0; index < this.views.length; index++) {
      if ((mask & (1 << index)) !== 0) {
        count++;
      }
    }
    const start = RingGapDegrees / 2;
    const span = 360 - RingGapDegrees;
    let slot = 0;
    for (let index = 0; index < this.views.length; index++) {
      const view = this.views[index];
      const shown = (mask & (1 << index)) !== 0;
      view.setShown(shown);
      if (!shown) {
        continue;
      }
      const angle = start + (count > 1 ? (slot * span) / (count - 1) : span / 2);
      view.slot.style.setProperty("--angle", `${Math.round(flipped ? 180 - angle : angle)}deg`);
      slot++;
    }
  }

  private run(kind: PetalKind, selection: SelectionHud): void {
    const actions = this.context.actions;
    switch (kind) {
      case "orbit":
        actions.command("orbit", selection.ref, selection.orbitDistance);
        break;
      case "keepRange":
        actions.command("keepRange", selection.ref, selection.keepRangeDistance);
        break;
      case "lock":
        if (selection.isLocked) {
          actions.unlock(selection.ref);
        } else {
          actions.lock(selection.ref);
        }
        break;
      default:
        actions.command(kind, selection.ref);
    }
  }

  private openChoices(command: DistanceCommand, x: number, y: number): void {
    const selection = this.current;
    if (selection === undefined) {
      return;
    }
    const current = command === "orbit" ? selection.orbitDistance : selection.keepRangeDistance;
    const entries = buildDistanceChoices(command, selection.ref, this.context.actions);
    this.context.openChoices(x, y, entries, DistanceCommandNames[command].choiceTitle, CommandDistanceChoices[command].indexOf(current));
  }

  private cancelPress(): void {
    if (this.pressTimer !== 0) {
      window.clearTimeout(this.pressTimer);
      this.pressTimer = 0;
    }
  }

  private viewAt(target: EventTarget | null): PetalView | undefined {
    const slot = target instanceof Element ? target.closest(".ring-slot") : null;
    return slot === null ? undefined : this.bySlot.get(slot);
  }
}
