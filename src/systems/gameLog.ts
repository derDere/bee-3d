import type { LogEntry } from "../hud/hudTypes";

const MaxEntries = 60;
/** Gleiche Meldungen innerhalb dieser Zeit werden zu einer mit Zähler zusammengefasst (Sekunden). */
const MergeSeconds = 8;

/** Ereignisprotokoll der Sitzung (Protokoll): Kampf, Beute, Quests, Sprüche, Systemmeldungen. */
export class GameLog {
  private readonly items: LogEntry[] = [];
  private nextId = 1;
  private readonly startedAt = performance.now();
  private lastText = "";
  private lastCount = 0;

  public get entries(): readonly LogEntry[] {
    return this.items;
  }

  public add(text: string, kind: LogEntry["kind"]): void {
    const time = (performance.now() - this.startedAt) / 1000;
    const last = this.items[this.items.length - 1];
    if (last !== undefined && text === this.lastText && last.kind === kind && time - last.time < MergeSeconds) {
      // Wiederholung: die letzte Meldung wird durch eine neue mit Zähler ersetzt
      this.lastCount++;
      this.items.pop();
      this.items.push({ id: this.nextId++, time, text: `${text} ×${this.lastCount}`, kind });
      return;
    }
    this.lastText = text;
    this.lastCount = 1;
    this.items.push({ id: this.nextId++, time, text, kind });
    if (this.items.length > MaxEntries) {
      this.items.shift();
    }
  }
}
