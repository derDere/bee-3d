// src/hud/hudContext.ts — Dienste, die die Hud-Klasse ihren Bausteinen reicht, und gemeinsame Objektbedienung.

import type { CommandSubject } from "./commandMenu";
import type { ContextMenuEntry, EntityRef, HudActions } from "./hudTypes";

/** Gemeinsame Dienste der Oberflächenbausteine (HUD-Umgebung). */
export interface HudContext {
  readonly actions: HudActions;
  /** Öffnet das Blütenkranz-Menü zu einem Objekt an einer Bildschirmposition (CSS-Pixel). */
  openEntityMenu(subject: CommandSubject, title: string, x: number, y: number): void;
  /** Öffnet das Blütenkranz-Menü als Auswahl; das Blatt Nummer `current` ist hervorgehoben (Auswahlkranz). */
  openChoices(x: number, y: number, entries: readonly ContextMenuEntry[], title: string, current: number): void;
}

/**
 * Klick auf ein Objekt in Übersicht oder Raum (Objektklick): ohne Taste auswählen, mit Strg (bzw. Cmd)
 * aufschalten, mit Strg + Umschalt lösen — wie in `spec/steuerung.md`.
 */
export function applyEntityClick(event: MouseEvent, ref: EntityRef, actions: HudActions): void {
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && event.shiftKey) {
    actions.unlock(ref);
  } else if (modifier) {
    actions.lock(ref);
  } else {
    actions.select(ref);
  }
}

/** Doppelklick auf ein Objekt: hinfliegen. */
export function applyEntityDoubleClick(event: MouseEvent, ref: EntityRef, actions: HudActions): void {
  if (!(event.ctrlKey || event.metaKey || event.shiftKey)) {
    actions.command("approach", ref);
  }
}
