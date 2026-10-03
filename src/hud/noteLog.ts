// src/hud/noteLog.ts — Ereignisprotokoll als kleine Notizzettel mit Symbol; Fliegensprüche als grüne Schleimblasen.
// Ältere Einträge verblassen.

import { createElement } from "./dom";
import type { LogEntry } from "./hudTypes";
import { createIcon, type IconName } from "./icons";

/** So viele Einträge zeigt das Protokoll höchstens. */
const VisibleEntries = 8;

const KindIcons: Readonly<Record<LogEntry["kind"], IconName>> = {
  combat: "stinger",
  loot: "sparkle",
  quest: "scroll",
  taunt: "fly",
  system: "info",
  warning: "warning",
};

/** Protokoll unten rechts (Notizprotokoll); erwartet die Einträge in zeitlicher Reihenfolge. */
export class NoteLog {
  /** Wurzelelement (Bedienfeld für den Feldschutz). */
  public readonly element: HTMLOListElement;
  private readonly views = new Map<number, HTMLLIElement>();
  private readonly wanted = new Set<number>();
  private firstId = Number.NaN;
  private lastId = Number.NaN;
  private shown = 0;

  public constructor(parent: HTMLElement) {
    this.element = createElement("ol", "notes", parent);
    this.element.setAttribute("aria-label", "Messages");
  }

  public update(entries: readonly LogEntry[]): void {
    const start = Math.max(0, entries.length - VisibleEntries);
    const count = entries.length - start;
    const firstId = count > 0 ? entries[start].id : Number.NaN;
    const lastId = count > 0 ? entries[entries.length - 1].id : Number.NaN;
    if (count === this.shown && Object.is(firstId, this.firstId) && Object.is(lastId, this.lastId)) {
      return;
    }
    this.firstId = firstId;
    this.lastId = lastId;
    this.shown = count;
    this.reconcile(entries, start);
  }

  public dispose(): void {
    this.element.remove();
    this.views.clear();
  }

  /** Gleicht die Liste mit den sichtbaren Einträgen ab; vorhandene Zettel bleiben stehen, damit ihr Auftauchen nicht neu startet. */
  private reconcile(entries: readonly LogEntry[], start: number): void {
    this.wanted.clear();
    for (let index = start; index < entries.length; index++) {
      this.wanted.add(entries[index].id);
    }
    for (const [id, view] of this.views) {
      if (!this.wanted.has(id)) {
        view.remove();
        this.views.delete(id);
      }
    }
    for (let index = start; index < entries.length; index++) {
      const entry = entries[index];
      let view = this.views.get(entry.id);
      if (view === undefined) {
        view = this.createView(entry);
        this.views.set(entry.id, view);
      }
      const position = index - start;
      if (this.element.children[position] !== view) {
        this.element.insertBefore(view, this.element.children[position] ?? null);
      }
      // Alter 0 = neuester Eintrag; ältere werden blasser
      view.style.setProperty("--age", String(entries.length - 1 - index));
    }
  }

  private createView(entry: LogEntry): HTMLLIElement {
    const view = createElement("li", `note kind-${entry.kind}`);
    createElement("span", "note-icon", view).appendChild(createIcon(KindIcons[entry.kind]));
    createElement("span", "note-text", view, entry.text);
    return view;
  }
}
