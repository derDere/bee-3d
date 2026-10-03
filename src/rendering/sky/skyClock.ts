import { DayPacing, DaySeconds, WorldStartOffsetSeconds, dayIndex, solarHours } from "../../../shared/dayClock";

/**
 * Himmelsuhr (Tagesuhr): Weltzeit aus der gemeinsamen Quelle (Server-Takt oder lokale Uhr) plus lokale
 * Vorgaben der Debug-API — feste Tageszeit und Zeitraffer gelten nur für diesen Client.
 */
export class SkyClock {
  private readonly source: () => number;
  private offsetSeconds = 0;
  private scale = 1;
  private scaledSinceSeconds = 0;
  private scaledBaseSeconds = 0;

  /** @param source liefert die gemeinsame Weltzeit in Sekunden. */
  public constructor(source: () => number) {
    this.source = source;
  }

  /** Wirksame Weltzeit in Sekunden. */
  public get worldSeconds(): number {
    const shared = this.source();
    if (this.scale === 1) {
      return shared + this.offsetSeconds;
    }
    return this.scaledBaseSeconds + (shared - this.scaledSinceSeconds) * this.scale + this.offsetSeconds;
  }

  /** Sonnenstunden 0..24. */
  public get hours(): number {
    return solarHours(this.worldSeconds);
  }

  /** Spieltag (für Mondphase und Wetterplan). */
  public get day(): number {
    return dayIndex(this.worldSeconds);
  }

  public get timeScale(): number {
    return this.scale;
  }

  /** Zeitraffer: 0 friert die Zeit ein, 1 ist normal (lokal). */
  public setTimeScale(scale: number): void {
    const now = this.worldSeconds;
    this.scaledBaseSeconds = now - this.offsetSeconds;
    this.scaledSinceSeconds = this.source();
    this.scale = Math.max(0, scale);
    if (this.scale === 1) {
      this.offsetSeconds = now - this.source();
    }
  }

  /** Setzt die lokale Tageszeit, die Uhr läuft von dort weiter (Debug-API). */
  public setHours(hours: number): void {
    const target = ((hours % 24) + 24) % 24;
    const now = this.worldSeconds;
    const dayStart = Math.floor((now + WorldStartOffsetSeconds) / DaySeconds) * DaySeconds - WorldStartOffsetSeconds;
    const desired = dayStart + SkyClock.secondsOfDayForHours(target);
    this.offsetSeconds += desired - now;
  }

  /** Umkehrung der Tageskurve: Sekunden seit Tagesbeginn der Kurve (Nachtbeginn) zu einer Sonnenstunde. */
  private static secondsOfDayForHours(hours: number): number {
    let elapsed = 0;
    for (const segment of DayPacing) {
      const start = segment.startHours;
      const end = segment.endHours;
      const h = hours < start && end > 24 ? hours + 24 : hours;
      if (h >= start && h < end) {
        return elapsed + ((h - start) / (end - start)) * segment.realSeconds;
      }
      elapsed += segment.realSeconds;
    }
    return 0;
  }
}
