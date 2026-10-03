// src/net/serverClock.ts — schätzt den laufenden Server-Takt aus den Takt-Nummern empfangener Zeilen.
import { TickSeconds } from "../../shared/world";

/**
 * Bildet lokale Zeit auf einen kontinuierlichen Server-Takt ab (Serveruhr).
 * Die schnellste Ankunft eines Takts liegt der echten Serverzeit am nächsten; spätere Ankünfte
 * heben die Schätzung nur langsam an, damit Ausreißer im Netz nicht ruckeln.
 */
export class ServerClock {
  private readonly tickMs = TickSeconds * 1000;
  private readonly relaxation: number;
  private offsetMs: number | undefined;
  private newestTick = 0;

  /** @param relaxation Anteil, mit dem eine spätere Ankunft die Schätzung je Beobachtung anhebt. */
  public constructor(relaxation = 0.02) {
    this.relaxation = relaxation;
  }

  /** Ob schon ein Takt beobachtet wurde. */
  public get isSynchronised(): boolean {
    return this.offsetMs !== undefined;
  }

  /** Meldet einen empfangenen Takt (z. B. `row.tick`) mit der lokalen Ankunftszeit in ms. */
  public observe(tick: number, nowMs: number): void {
    if (tick < this.newestTick) {
      return; // ältere Zeile, z. B. aus einem frischen Abo
    }
    this.newestTick = tick;
    const candidate = nowMs - tick * this.tickMs;
    if (this.offsetMs === undefined || candidate < this.offsetMs) {
      this.offsetMs = candidate;
    } else {
      this.offsetMs += (candidate - this.offsetMs) * this.relaxation;
    }
  }

  /** Kontinuierlicher Server-Takt zur lokalen Zeit `nowMs`. */
  public tickAt(nowMs: number): number {
    return this.offsetMs === undefined ? this.newestTick : (nowMs - this.offsetMs) / this.tickMs;
  }

  /** Weltsekunden zur lokalen Zeit `nowMs` (Takt 0 = Weltbeginn). */
  public worldSecondsAt(nowMs: number): number {
    return this.tickAt(nowMs) * TickSeconds;
  }
}
