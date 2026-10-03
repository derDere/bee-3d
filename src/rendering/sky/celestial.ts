import { Vector3 } from "@babylonjs/core/Maths/math.vector";

/** Breite und Deklination der Sonnenbahn: Mittagshöhe 60°, Aufgang ~04:58, Untergang ~19:02. */
export const SunLatitudeDeg = 45;
export const SunDeclinationDeg = 15;
/** Mondbahn: dem Sonnenstand gegenüber, etwa 40° hoch um Mitternacht. */
export const MoonDeclinationDeg = -5;
/** Länge eines Mondzyklus in Spieltagen. */
export const MoonCycleDays = 8;

/**
 * Schreibt den Einheitsvektor zu einem Himmelskörper (Richtung zum Himmelskörper). Rahmen: +X Osten,
 * +Y oben, +Z Norden; Stundenwinkel 0 am Mittag.
 */
export function directionToBody(hours: number, latitudeDeg: number, declinationDeg: number, result: Vector3): Vector3 {
  const phi = (latitudeDeg * Math.PI) / 180;
  const delta = (declinationDeg * Math.PI) / 180;
  const hourAngle = ((hours - 12) / 24) * 2 * Math.PI;
  const along = Math.cos(delta) * Math.cos(hourAngle);
  const west = Math.cos(delta) * Math.sin(hourAngle);
  const polar = Math.sin(delta);
  return result.set(-west, polar * Math.sin(phi) + along * Math.cos(phi), polar * Math.cos(phi) - along * Math.sin(phi));
}

/** Stand von Sonne und Mond zu einer Sonnenstunde (Himmelsmechanik). */
export class CelestialRig {
  public readonly toSun = new Vector3(0, 1, 0);
  public readonly toMoon = new Vector3(0, -1, 0);
  public sunElevationDeg = 90;
  public moonElevationDeg = -90;
  /** Mondphase 0..1 (0 = Neumond, 0,5 = Vollmond). */
  public moonPhase = 0.5;
  /** Helligkeit des Mondlichts 0,4 (Neumond) … 1 (Vollmond). */
  public moonBrightness = 1;
  /** Ob die Sonne steigt (Morgen) oder sinkt (Abend). */
  public rising = true;
  /** Drehung der Sternkugel um den Himmelspol (rad). */
  public starRotation = 0;

  public update(hours: number, day: number): void {
    directionToBody(hours, SunLatitudeDeg, SunDeclinationDeg, this.toSun);
    directionToBody(hours + 12, SunLatitudeDeg, MoonDeclinationDeg, this.toMoon);
    this.sunElevationDeg = (Math.asin(Math.max(-1, Math.min(1, this.toSun.y))) * 180) / Math.PI;
    this.moonElevationDeg = (Math.asin(Math.max(-1, Math.min(1, this.toMoon.y))) * 180) / Math.PI;
    this.rising = hours < 12;
    const cycle = (((day + hours / 24) % MoonCycleDays) + MoonCycleDays) % MoonCycleDays;
    this.moonPhase = cycle / MoonCycleDays;
    const fullness = 0.5 - 0.5 * Math.cos(this.moonPhase * 2 * Math.PI);
    this.moonBrightness = 0.4 + 0.6 * fullness;
    this.starRotation = (hours / 24) * 2 * Math.PI;
  }
}
