// shared/dayClock.ts — Tagesuhr: Weltzeit (Sekunden seit Weltbeginn) → Sonnenstunden mit Tempokurve.
// Dämmerungen bekommen mehr Echtzeit als Mittag und tiefe Nacht (Skill babylon-sky, day-night.md).

/** Ein Abschnitt der Tageskurve (Abschnitt der Tageskurve). */
export interface PacingSegment {
  readonly startHours: number;
  /** Darf über 24 liegen für den Abschnitt über Mitternacht. */
  readonly endHours: number;
  readonly realSeconds: number;
}

/** Tageskurve für Breite 45° und Deklination 15°: Morgen 7,5 min, Mittag 3,5, Abend 8, Nacht 5. */
export const DayPacing: readonly PacingSegment[] = [
  { startHours: 20 + 20 / 60, endHours: 27 + 40 / 60, realSeconds: 300 }, // Nacht
  { startHours: 3 + 40 / 60, endHours: 4 + 46 / 60, realSeconds: 90 }, // blaue Morgendämmerung
  { startHours: 4 + 46 / 60, endHours: 5 + 45 / 60, realSeconds: 120 }, // Sonnenaufgang
  { startHours: 5 + 45 / 60, endHours: 6 + 54 / 60, realSeconds: 120 }, // goldener Morgen
  { startHours: 6 + 54 / 60, endHours: 9 + 20 / 60, realSeconds: 120 }, // Vormittag
  { startHours: 9 + 20 / 60, endHours: 14 + 40 / 60, realSeconds: 210 }, // Mittag
  { startHours: 14 + 40 / 60, endHours: 17 + 6 / 60, realSeconds: 120 }, // Nachmittag
  { startHours: 17 + 6 / 60, endHours: 18 + 15 / 60, realSeconds: 120 }, // goldener Abend
  { startHours: 18 + 15 / 60, endHours: 19 + 14 / 60, realSeconds: 120 }, // Sonnenuntergang
  { startHours: 19 + 14 / 60, endHours: 20 + 20 / 60, realSeconds: 120 }, // blaue Abenddämmerung
];

/** Länge eines Spieltags in Echtsekunden. */
export const DaySeconds = DayPacing.reduce((sum, segment) => sum + segment.realSeconds, 0);

/** Weltzeit, zu der die Uhr den Weltbeginn anzeigt: kurz vor Sonnenaufgang (Startversatz). */
export const WorldStartOffsetSeconds = 300 + 90 + 40;

/** Sonnenstunden 0..24 zu einer Weltzeit in Sekunden (Tagesuhr). */
export function solarHours(worldSeconds: number): number {
  const shifted = worldSeconds + WorldStartOffsetSeconds;
  let remaining = ((shifted % DaySeconds) + DaySeconds) % DaySeconds;
  for (const segment of DayPacing) {
    if (remaining < segment.realSeconds) {
      const t = remaining / segment.realSeconds;
      return (segment.startHours + t * (segment.endHours - segment.startHours)) % 24;
    }
    remaining -= segment.realSeconds;
  }
  return DayPacing[0]?.startHours ?? 0;
}

/** Nummer des Spieltags (für Wetterplan und Mondphase). */
export function dayIndex(worldSeconds: number): number {
  return Math.floor((worldSeconds + WorldStartOffsetSeconds) / DaySeconds);
}

/** Weltzeit in Sekunden zur kontinuierlichen Taktnummer des Servers. */
export function worldSecondsAtTick(tick: number, tickSeconds: number): number {
  return tick * tickSeconds;
}

/** Ist es Nacht (für Spielregeln: Leuchtblumen-Bonus, Aggression)? Sonne mehr als 6° unter dem Horizont. */
export function isNightHours(hours: number): boolean {
  return hours >= 19 + 50 / 60 || hours < 4 + 10 / 60;
}
