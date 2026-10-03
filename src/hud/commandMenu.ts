// src/hud/commandMenu.ts — Einträge des Blütenkranz-Menüs: Befehle zu einem Objekt (Nearby, Markierungen,
// Ziele) und die Abstandswahl für Umkreisen und Abstand halten.

import { DockRange } from "../../shared/rules";
import { WarpMinDistance } from "../../shared/world";
import { isLockableType, sameEntity } from "./entities";
import { formatDistance } from "./format";
import type { ContextMenuEntry, EntityRef, HudActions, SelectionHud } from "./hudTypes";

/** Befehle mit wählbarem Abstand (Abstandsbefehl). */
export type DistanceCommand = "orbit" | "keepRange";

/** Wählbare Abstände nach `spec/steuerung.md` (Meter). */
export const CommandDistanceChoices: Readonly<Record<DistanceCommand, readonly number[]>> = {
  orbit: [10, 20, 40, 80],
  keepRange: [5, 15, 30, 60],
};

/** Name des Befehls und Titel seiner Abstandswahl. */
export const DistanceCommandNames: Readonly<Record<DistanceCommand, { readonly label: string; readonly choiceTitle: string }>> = {
  orbit: { label: "Orbit", choiceTitle: "Orbit distance" },
  keepRange: { label: "Keep range", choiceTitle: "Keep-range distance" },
};

/** Was das Befehlsmenü über ein Objekt wissen muss (Befehlsziel). */
export interface CommandSubject {
  readonly ref: EntityRef;
  readonly distance: number;
  readonly isLocked: boolean;
  readonly isActiveTarget: boolean;
}

/** Gewählte Abstände für Umkreisen und Abstand halten (Befehlsabstände). */
export interface CommandDistances {
  readonly orbit: number;
  readonly keepRange: number;
}

/** Standardabstände aus `spec/steuerung.md`, solange das Infofeld keine eigenen Werte meldet. */
export const DefaultCommandDistances: CommandDistances = { orbit: 20, keepRange: 15 };

/** Freigaben der Befehle zu einem Objekt (Befehlsfreigabe). */
interface CommandAvailability {
  readonly approach: boolean;
  readonly orbit: boolean;
  readonly keepRange: boolean;
  readonly align: boolean;
  readonly warp: boolean;
  readonly dock: boolean;
  readonly lock: boolean;
}

/**
 * Freigaben: Für das ausgewählte Objekt gelten die Werte des Infofelds; für andere Objekte die
 * Grundregeln aus `spieldesign.md` (Warp ab 150 m, Andocken nur an Bienenstöcken bis 45 m). Das Spiel
 * prüft jeden Befehl ohnehin selbst.
 */
function availabilityFor(subject: CommandSubject, selection: SelectionHud | undefined): CommandAvailability {
  if (selection !== undefined && sameEntity(selection.ref, subject.ref)) {
    return {
      approach: selection.canApproach,
      orbit: selection.canOrbit,
      keepRange: selection.canKeepRange,
      align: selection.canAlign,
      warp: selection.canWarp,
      dock: selection.canDock,
      lock: selection.canLock,
    };
  }
  return {
    approach: true,
    orbit: true,
    keepRange: true,
    align: true,
    warp: subject.distance >= WarpMinDistance,
    dock: subject.ref.type === "hive" && subject.distance <= DockRange,
    lock: isLockableType(subject.ref.type),
  };
}

/** Baut die Einträge Hinfliegen, Umkreisen, Abstand halten, Ausrichten, Warp, Andocken und Aufschalten bzw. Lösen. */
export function buildEntityCommands(
  subject: CommandSubject,
  selection: SelectionHud | undefined,
  distances: CommandDistances,
  actions: HudActions,
): ContextMenuEntry[] {
  const ref = subject.ref;
  const can = availabilityFor(subject, selection);
  const entries: ContextMenuEntry[] = [
    { icon: "approach", label: "Approach", hotkey: "Q", enabled: can.approach, run: () => actions.command("approach", ref) },
    { icon: "orbit", label: "Orbit", detail: formatDistance(distances.orbit), hotkey: "W", enabled: can.orbit, run: () => actions.command("orbit", ref, distances.orbit) },
    {
      icon: "keepRange",
      label: "Keep range",
      detail: formatDistance(distances.keepRange),
      hotkey: "E",
      enabled: can.keepRange,
      run: () => actions.command("keepRange", ref, distances.keepRange),
    },
    { icon: "align", label: "Align", hotkey: "A", enabled: can.align, run: () => actions.command("align", ref) },
    { icon: "warp", label: "Warp", hotkey: "S", enabled: can.warp, run: () => actions.command("warp", ref) },
  ];
  if (ref.type === "hive") {
    entries.push({ icon: "dock", label: "Dock", hotkey: "D", enabled: can.dock, run: () => actions.command("dock", ref) });
  }
  if (subject.isLocked) {
    if (!subject.isActiveTarget) {
      entries.push({ icon: "select", label: "Make active target", hotkey: "Tab", enabled: true, run: () => actions.setActiveTarget(ref) });
    }
    entries.push({ icon: "unlock", label: "Unlock target", hotkey: "Ctrl+Shift+Click", enabled: true, run: () => actions.unlock(ref) });
  } else {
    entries.push({ icon: "lock", label: "Lock target", hotkey: "Ctrl+Click", enabled: can.lock, run: () => actions.lock(ref) });
  }
  return entries;
}

/**
 * Abstandswahl als Blütenblätter (Abstandswahl): Ein Blatt merkt sich den Abstand als neuen Standard und
 * startet den Befehl gleich mit diesem Abstand.
 */
export function buildDistanceChoices(command: DistanceCommand, ref: EntityRef, actions: HudActions): ContextMenuEntry[] {
  const remember = command === "orbit" ? (distance: number) => actions.setOrbitDistance(distance) : (distance: number) => actions.setKeepRangeDistance(distance);
  return CommandDistanceChoices[command].map((distance) => ({
    icon: command,
    label: DistanceCommandNames[command].label,
    detail: formatDistance(distance),
    enabled: true,
    run: () => {
      remember(distance);
      actions.command(command, ref, distance);
    },
  }));
}
