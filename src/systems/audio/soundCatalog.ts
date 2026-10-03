// src/systems/audio/soundCatalog.ts — Abspielparameter je Klang: Pegel, Reichweite, Stimmenzahl, Tonhöhenstreuung
// und Hall. Pegel beziehen sich auf die eingepegelte Lautheit der Klangbank (−14 dBFS).
import type { UiSound, WorldSound } from "./audioTypes";

/** Abspielparameter eines Raumklangs (Raumklang-Eintrag). */
export interface WorldSoundSpec {
  /** Pegel relativ zur eingepegelten Lautheit in dB. */
  readonly gainDb: number;
  /** Bis zu diesem Abstand klingt der Klang mit voller Lautstärke (m). */
  readonly refDistance: number;
  /** Stärke der Abstandsdämpfung; 1 entspricht 1/r jenseits von refDistance. */
  readonly rolloff: number;
  /** Jenseits dieses Abstands entfällt der Klang (m). */
  readonly maxRange: number;
  /** Abstand, auf dem die Luftdämpfung die Grenzfrequenz auf 1/e senkt (m). */
  readonly airDamping: number;
  readonly maxVoices: number;
  /** Zufällige Verstimmung ± in Cent je Abspielvorgang. */
  readonly pitchJitter: number;
  /** Anteil am Raumhall. */
  readonly reverb: number;
}

/** Raumklänge: Kampf in 10–300 m ist hörbar, wird mit dem Abstand leiser und dumpfer. */
export const WorldSoundCatalog: Readonly<Record<WorldSound, WorldSoundSpec>> = {
  laser: { gainDb: -4, refDistance: 12, rolloff: 1, maxRange: 420, airDamping: 140, maxVoices: 6, pitchJitter: 30, reverb: 0.08 },
  gatling: { gainDb: -5, refDistance: 10, rolloff: 1, maxRange: 380, airDamping: 130, maxVoices: 8, pitchJitter: 50, reverb: 0.05 },
  stingerLaunch: { gainDb: -5, refDistance: 10, rolloff: 1, maxRange: 400, airDamping: 140, maxVoices: 6, pitchJitter: 60, reverb: 0.08 },
  stingerImpact: { gainDb: -3, refDistance: 14, rolloff: 1, maxRange: 450, airDamping: 150, maxVoices: 6, pitchJitter: 70, reverb: 0.12 },
  spit: { gainDb: -6, refDistance: 8, rolloff: 1, maxRange: 300, airDamping: 120, maxVoices: 6, pitchJitter: 90, reverb: 0.05 },
  spitHit: { gainDb: -5, refDistance: 8, rolloff: 1, maxRange: 300, airDamping: 120, maxVoices: 6, pitchJitter: 80, reverb: 0.05 },
  flyDeath: { gainDb: -2, refDistance: 12, rolloff: 1, maxRange: 400, airDamping: 140, maxVoices: 4, pitchJitter: 60, reverb: 0.1 },
  beeHit: { gainDb: -4, refDistance: 8, rolloff: 1, maxRange: 300, airDamping: 120, maxVoices: 4, pitchJitter: 60, reverb: 0.05 },
  beeDeath: { gainDb: -2, refDistance: 15, rolloff: 1, maxRange: 500, airDamping: 160, maxVoices: 3, pitchJitter: 0, reverb: 0.15 },
  revive: { gainDb: -3, refDistance: 15, rolloff: 1, maxRange: 500, airDamping: 160, maxVoices: 3, pitchJitter: 0, reverb: 0.2 },
  collect: { gainDb: -8, refDistance: 6, rolloff: 1, maxRange: 150, airDamping: 100, maxVoices: 4, pitchJitter: 0, reverb: 0.12 },
  dock: { gainDb: -4, refDistance: 10, rolloff: 1, maxRange: 300, airDamping: 140, maxVoices: 3, pitchJitter: 0, reverb: 0.15 },
  undock: { gainDb: -5, refDistance: 10, rolloff: 1, maxRange: 300, airDamping: 140, maxVoices: 3, pitchJitter: 0, reverb: 0.12 },
  warpStart: { gainDb: -3, refDistance: 20, rolloff: 1, maxRange: 600, airDamping: 200, maxVoices: 3, pitchJitter: 20, reverb: 0.15 },
  warpEnd: { gainDb: -3, refDistance: 20, rolloff: 1, maxRange: 600, airDamping: 200, maxVoices: 3, pitchJitter: 20, reverb: 0.15 },
  buzz: { gainDb: -3, refDistance: 10, rolloff: 1, maxRange: 250, airDamping: 120, maxVoices: 4, pitchJitter: 0, reverb: 0.1 },
  heal: { gainDb: -6, refDistance: 8, rolloff: 1, maxRange: 200, airDamping: 120, maxVoices: 3, pitchJitter: 0, reverb: 0.15 },
  scan: { gainDb: -6, refDistance: 15, rolloff: 1, maxRange: 400, airDamping: 160, maxVoices: 3, pitchJitter: 0, reverb: 0.25 },
  thunder: { gainDb: 1, refDistance: 250, rolloff: 0.4, maxRange: Number.POSITIVE_INFINITY, airDamping: 900, maxVoices: 3, pitchJitter: 40, reverb: 0.3 },
};

/** Ab diesem Abstand klingt Donner fern: ohne Krachen, dunkler und länger (m). */
export const NearThunderDistance = 700;

/** Abspielparameter eines Oberflächenklangs (UI-Eintrag). */
export interface UiSoundSpec {
  readonly gainDb: number;
  readonly maxVoices: number;
  readonly pitchJitter: number;
  /** Mindestabstand zwischen zwei Starts in Sekunden (gegen Hover-Gewitter). */
  readonly minInterval: number;
}

/** Oberflächenklänge: leise, kurz, nie aufdringlich. */
export const UiSoundCatalog: Readonly<Record<UiSound, UiSoundSpec>> = {
  click: { gainDb: -12, maxVoices: 3, pitchJitter: 25, minInterval: 0.03 },
  hover: { gainDb: -20, maxVoices: 2, pitchJitter: 40, minInterval: 0.05 },
  error: { gainDb: -8, maxVoices: 2, pitchJitter: 0, minInterval: 0.12 },
  confirm: { gainDb: -9, maxVoices: 2, pitchJitter: 0, minInterval: 0.08 },
  quest: { gainDb: -6, maxVoices: 1, pitchJitter: 0, minInterval: 0.3 },
  upgrade: { gainDb: -6, maxVoices: 1, pitchJitter: 0, minInterval: 0.3 },
  lock: { gainDb: -10, maxVoices: 3, pitchJitter: 0, minInterval: 0.05 },
  deposit: { gainDb: -7, maxVoices: 2, pitchJitter: 0, minInterval: 0.15 },
};
