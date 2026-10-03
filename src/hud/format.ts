// src/hud/format.ts — Zahlen- und Textformate der Oberfläche (englische Schreibweise).

const IntegerFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const DecimalFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Geschütztes Leerzeichen zwischen Zahl und Einheit, damit „12 m“ nie umbricht. */
export const UnitSpace = " ";

/** Begrenzt einen Anteil auf 0..1. */
export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Ganze Zahl mit Tausendertrennzeichen; −0 erscheint als 0. */
export function formatInteger(value: number): string {
  return IntegerFormat.format(Math.round(value) + 0);
}

/** Anzeigestufe einer Entfernung: ganze Meter unter 1 km, darüber 100-m-Schritte (Entfernungsstufe). */
export function distanceStep(meters: number): number {
  return meters < 999.5 ? Math.round(meters) : 100_000 + Math.round(meters / 100);
}

/** Entfernung als „12 m“, „1.2 km“ oder „140 km“. */
export function formatDistance(meters: number): string {
  if (meters < 999.5) {
    return `${formatInteger(Math.max(0, meters))}${UnitSpace}m`;
  }
  const kilometers = meters / 1000;
  const value = kilometers < 99.95 ? DecimalFormat.format(kilometers) : formatInteger(kilometers);
  return `${value}${UnitSpace}km`;
}

/** Anzeigestufe eines Tempos in Zehntel m/s (Tempostufe). */
export function speedStep(metersPerSecond: number): number {
  return Math.round(Math.max(0, metersPerSecond) * 10);
}

/** Tempo ohne Einheit: eine Nachkommastelle unter 100 m/s, darüber ganze Zahlen. */
export function formatSpeedValue(metersPerSecond: number): string {
  const value = Math.max(0, metersPerSecond);
  return value < 99.95 ? DecimalFormat.format(value) : formatInteger(value);
}

/** Tempo mit Einheit, z. B. „11.4 m/s“. */
export function formatSpeed(metersPerSecond: number): string {
  return `${formatSpeedValue(metersPerSecond)}${UnitSpace}m/s`;
}

/** Anzeigestufe eines Anteils in ganzen Prozent (Prozentstufe). */
export function percentStep(ratio: number): number {
  return Math.round(clamp01(ratio) * 100);
}

/** Anteil 0..1 als ganze Prozent, z. B. „84%“. */
export function formatPercent(ratio: number): string {
  return `${percentStep(ratio)}%`;
}

/** Normiert einen Winkel auf 0 ≤ Grad < 360. */
export function normalizeDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

const CompassPoints = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** Himmelsrichtung eines Kurses in Grad, 0 = Norden = +Z (Kompassrichtung). */
export function compassPoint(headingDeg: number): string {
  return CompassPoints[Math.round(normalizeDegrees(headingDeg) / 45) % CompassPoints.length];
}

/** Ganze Grad eines Kurses (Kursstufe). */
export function headingStep(headingDeg: number): number {
  return Math.round(normalizeDegrees(headingDeg)) % 360;
}

/** Kurs als „NE 45°“. */
export function formatHeading(headingDeg: number): string {
  const degrees = headingStep(headingDeg);
  return `${compassPoint(degrees)} ${degrees}°`;
}
