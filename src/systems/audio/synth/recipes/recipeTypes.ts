// src/systems/audio/synth/recipes/recipeTypes.ts — Vertrag der Klangrezepte und gemeinsame Pegelvorgaben.
import type { Random } from "../../../../../shared/random";
import type { UiSound, WorldSound } from "../../audioTypes";
import type { Clip } from "../clip";

/** Klänge, die nur das Tonsystem selbst nutzt: Schleifen, Instrumente, Hallraum (interne Klänge). */
export type InternalClip =
  | "thunderFar"
  | "wingBuzz"
  | "flyDrone"
  | "noiseBed"
  | "rainPatter"
  | "crickets"
  | "kalimba"
  | "bell"
  | "pad"
  | "bass"
  | "reverbImpulse";

/** Kennung eines erzeugten Klangs (Klang-ID). */
export type ClipId = WorldSound | UiSound | InternalClip;

/**
 * Pegelvorgabe nach dem Erzeugen (Einpegelung). drive sättigt Spitzen vor dem Einpegeln weich (tanh), damit
 * Klänge mit hartem Anschlag dieselbe Lautheit erreichen wie gleichmäßige.
 */
export type LevelRule =
  | { readonly kind: "loudness"; readonly loudness: number; readonly peak: number; readonly drive?: number }
  | { readonly kind: "peak"; readonly peak: number };

/** Werkzeugkasten eines Rezepts: Abtastrate und seedbarer Zufall (Rezeptumgebung). */
export interface RecipeContext {
  readonly sampleRate: number;
  readonly random: Random;
}

/** Bauanleitung für einen erzeugten Klang und seine Varianten (Klangrezept). */
export interface SoundRecipe {
  readonly id: ClipId;
  readonly variants: number;
  /** Anteil der Kontext-Abtastrate: 1 für helle Klänge, 0,5 für lange, dunkle Klänge (halber Speicher). */
  readonly rateFactor: number;
  readonly level: LevelRule;
  build(context: RecipeContext, variant: number): Clip;
}

/** Einzelklang: Kurzzeit-Lautheit −14 dBFS, Spitzen höchstens −0,5 dBFS. */
export const OneShotLevel: LevelRule = { kind: "loudness", loudness: 0.2, peak: 0.95 };

/** Einzelklang mit hartem Anschlag: Spitzen werden mit Sättigung drive gezähmt (Schlag, Platsch, Klick). */
export function punchyLevel(drive: number): LevelRule {
  return { kind: "loudness", loudness: 0.2, peak: 0.95, drive };
}

/** Dauerschleife: gleiche Lautheit wie Einzelklänge, damit Laufzeitpegel direkt vergleichbar sind. */
export const LoopLevel: LevelRule = { kind: "loudness", loudness: 0.2, peak: 0.98 };

/** Instrumentenprobe der Musik: auf Spitzenwert eingepegelt, die Dynamik macht die Anschlagstärke. */
export const InstrumentLevel: LevelRule = { kind: "peak", peak: 0.9 };
