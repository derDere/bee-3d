// Farbpalette der Effekte: lineare HDR-Farben. Leuchtende Anteile liegen mit ihrer Luminanz
// (0,2126 R + 0,7152 G + 0,0722 B) über der Bloom-Schwelle 1,1; a ist bei Leuchten die Intensität,
// bei Materie (Rauch, Schleim) die Deckkraft.

/** Unveränderliche Effektfarbe, linear und HDR (Effektfarbe). */
export interface FxColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

function color(r: number, g: number, b: number, a = 1): FxColor {
  return Object.freeze({ r, g, b, a });
}

/** Farben aller Effekte (Effektpalette). */
export const Palette = {
  laserHalo: color(7.5, 0.32, 0.12),
  laserCore: color(9, 3.6, 3),
  laserEye: color(7, 1.4, 0.8),
  laserHitGlow: color(7, 1.9, 0.55),
  laserHitCore: color(9, 6.5, 4),
  laserSpark: color(9, 5.5, 2),
  laserSparkAlt: color(8, 2.6, 0.6),
  laserSparkEnd: color(2.5, 0.25, 0.05, 0),
  laserEmber: color(5, 1.2, 0.3),

  pollenTracer: color(2.8, 1.5, 0.18),
  pollenTracerCore: color(5, 3.8, 1.2),
  pollenMuzzle: color(6.5, 4.4, 1.2),
  pollenSpark: color(6.5, 4.2, 0.9),
  pollenSparkAlt: color(7.5, 6.5, 3),
  pollenSparkEnd: color(2.2, 1, 0.1, 0),
  pollenDust: color(1, 0.84, 0.2, 0.55),
  pollenDustEnd: color(0.9, 0.72, 0.25, 0),
  pollenMote: color(2.4, 1.5, 0.2),
  goldMote: color(4.4, 2.6, 0.5),

  stingerFlame: color(6.5, 3.6, 1.3),
  smokeWhite: color(0.92, 0.92, 0.9, 0.42),
  explosionFlash: color(9, 7, 3.2),
  explosionRing: color(5, 3.6, 1.2),
  explosionSmoke: color(0.95, 0.8, 0.32, 0.5),
  explosionSmokeEnd: color(0.85, 0.75, 0.4, 0),

  slimeBall: color(0.2, 0.78, 0.05),
  slimeGlow: color(0.7, 2.7, 0.3),
  slimeStreak: color(0.45, 1.8, 0.2),
  slimeDrip: color(0.18, 0.72, 0.05),
  slimeDripEnd: color(0.12, 0.45, 0.03, 0),
  slimeMist: color(0.3, 0.65, 0.12, 0.45),
  slimeMistEnd: color(0.25, 0.5, 0.1, 0),
  slimeFlash: color(1.5, 5, 0.9),

  gooDark: color(0.02, 0.035, 0.015),
  gooGreen: color(0.22, 0.7, 0.06),
  gooEnd: color(0.05, 0.12, 0.02, 0),
  deathSmoke: color(0.1, 0.11, 0.09, 0.6),
  deathSmokeEnd: color(0.2, 0.22, 0.17, 0),
  deathFlash: color(2.6, 4.2, 1.6),

  ghostCyan: color(0.5, 2.2, 2.8),
  ghostWisp: color(0.7, 3.2, 4),
  ghostWispEnd: color(0.2, 1, 1.6, 0),
  reviveGold: color(4.2, 2.4, 0.5),
  reviveGoldEnd: color(2.2, 1.1, 0.2, 0),
  dockWhite: color(6.5, 5.6, 4),
  dockSpark: color(7, 5.5, 2.6),
  dockSparkEnd: color(2.5, 1.4, 0.4, 0),
  buzzRing: color(2.4, 2.1, 1.1),
  healGreen: color(1.3, 3.8, 0.9),
  healGold: color(4.4, 3.3, 0.8),
  scanViolet: color(1.7, 1.1, 3),
  warpStreak: color(1.5, 2.3, 3.4),
  moteDust: color(1.3, 1.25, 1.15),
  motePollen: color(2, 1.6, 0.6),

  transparent: color(0, 0, 0, 0),
} as const;
