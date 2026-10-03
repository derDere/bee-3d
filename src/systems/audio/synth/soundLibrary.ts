// src/systems/audio/synth/soundLibrary.ts — erzeugt Klänge aus den Rezepten (in Workern oder im Hauptthread).
import { Random, hash32 } from "../../../../shared/random";
import type { Clip } from "./clip";
import { saturate } from "./dsp";
import { AllRecipes } from "./recipes";
import type { ClipId, LevelRule } from "./recipes/recipeTypes";

/** Ein erzeugter Klang mit Abtastwerten und Pegelkennzahlen (erzeugter Klang). */
export interface GeneratedClip {
  readonly id: ClipId;
  readonly variant: number;
  readonly sampleRate: number;
  readonly channels: Float32Array<ArrayBuffer>[];
  readonly peak: number;
  readonly rms: number;
  readonly loudness: number;
  readonly finite: boolean;
  /** Erzeugungsdauer in Millisekunden. */
  readonly milliseconds: number;
}

/** Ergebnis eines Erzeugungslaufs (Klangbibliothek). */
export interface SoundLibrary {
  readonly clips: GeneratedClip[];
  /** Rechenzeit des Laufs in Millisekunden. */
  readonly milliseconds: number;
}

/** Ein Teil der Rezeptliste für parallele Erzeugung: Rezept i gehört zu Teil i mod count (Teilauftrag). */
export interface LibraryPart {
  readonly index: number;
  readonly count: number;
}

/** Die gesamte Rezeptliste als ein Teil. */
export const WholeLibrary: LibraryPart = { index: 0, count: 1 };

/** Stabiler 32-Bit-Hash einer Zeichenkette (FNV-1a), damit jedes Rezept einen eigenen Zufallsstrom hat. */
function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function applyLevel(clip: Clip, rule: LevelRule): void {
  if (rule.kind === "peak") {
    clip.normalizePeak(rule.peak);
    return;
  }
  const drive = rule.drive;
  if (drive !== undefined && drive > 0) {
    clip.normalizePeak(1).process(() => (value) => saturate(value, drive));
  }
  clip.normalizeLoudness(rule.loudness, rule.peak);
}

/**
 * Erzeugt die Klänge eines Teils der Rezeptliste für eine Kontext-Abtastrate. Jede Variante bekommt einen eigenen,
 * aus Seed, Rezept und Variante abgeleiteten Zufallsstrom; das Ergebnis hängt nicht von Reihenfolge oder Aufteilung ab.
 */
export function buildSoundLibrary(sampleRate: number, seed: number, part: LibraryPart = WholeLibrary): SoundLibrary {
  const started = performance.now();
  const clips: GeneratedClip[] = [];
  AllRecipes.forEach((recipe, recipeIndex) => {
    if (recipeIndex % part.count !== part.index) {
      return;
    }
    const rate = Math.round(sampleRate * recipe.rateFactor);
    for (let variant = 0; variant < recipe.variants; variant++) {
      const clipStarted = performance.now();
      const random = new Random(hash32(seed, hashText(recipe.id), variant));
      const clip = recipe.build({ sampleRate: rate, random }, variant);
      applyLevel(clip, recipe.level);
      const levels = clip.measure();
      clips.push({
        id: recipe.id,
        variant,
        sampleRate: rate,
        channels: [...clip.channels],
        peak: levels.peak,
        rms: levels.rms,
        loudness: levels.loudness,
        finite: levels.finite,
        milliseconds: performance.now() - clipStarted,
      });
    }
  });
  return { clips, milliseconds: performance.now() - started };
}
