// src/systems/audio/synth/recipes/ui.ts — Oberflächenklänge: Klick, Hover, Fehler, Bestätigung, Quest, Upgrade,
// Aufschalten und Abliefern. Kurz, weich und in D-Dur-Pentatonik.
import { Clip } from "../clip";
import { NoiseSource, Oscillator, StateVariableFilter, midiToHz, smoothstep, strike } from "../dsp";
import { bellTone, chirpTone, softTone, sparkleRun, whoosh, type SparkleNote } from "../layers";
import { OneShotLevel, type SoundRecipe } from "./recipeTypes";

/** Klick: weiches „Tick“ mit kleinem Holzkörper. */
const click: SoundRecipe = {
  id: "click",
  variants: 1,
  rateFactor: 1,
  level: OneShotLevel,
  build({ sampleRate, random }) {
    const tick = new Oscillator(sampleRate);
    const body = new Oscillator(sampleRate, 0.2);
    const noise = new NoiseSource(random);
    const air = new StateVariableFilter(sampleRate);
    return Clip.render(sampleRate, 0.05, (t) => {
      return (
        tick.sine(2200) * strike(t, 0.0005, 0.005) * 0.7 +
        body.sine(1150) * strike(t, 0.0008, 0.012) * 0.4 +
        air.highpass(noise.white(), 3000) * strike(t, 0.0003, 0.0015) * 0.3
      );
    }).fadeOut(0.005);
  },
};

/** Hover: sehr leises, helles „Tik“. */
const hover: SoundRecipe = {
  id: "hover",
  variants: 1,
  rateFactor: 1,
  level: OneShotLevel,
  build({ sampleRate }) {
    const tone = new Oscillator(sampleRate);
    const upper = new Oscillator(sampleRate, 0.3);
    return Clip.render(sampleRate, 0.03, (t) => tone.sine(3300) * strike(t, 0.001, 0.004) + upper.sine(4950) * strike(t, 0.0008, 0.002) * 0.3).fadeOut(0.004);
  },
};

/** Fehler: freundliches „Bonk-bonk“ abwärts, weich statt schrill. */
const error: SoundRecipe = {
  id: "error",
  variants: 1,
  rateFactor: 1,
  level: OneShotLevel,
  build({ sampleRate }) {
    const notes = [
      { frequency: midiToHz(64), start: 0 },
      { frequency: midiToHz(60), start: 0.13 },
    ];
    const triangle = new Oscillator(sampleRate);
    const pulse = new Oscillator(sampleRate, 0.25);
    const tone = new StateVariableFilter(sampleRate);
    return Clip.render(sampleRate, 0.34, (t) => {
      const note = t < notes[1].start ? notes[0] : notes[1];
      const local = t - note.start;
      const frequency = note.frequency * (1 - 0.04 * smoothstep(0, 0.09, local));
      const voice = triangle.triangle(frequency) * 0.7 + tone.lowpass(pulse.pulse(frequency, 0.5), 1400, 0.7) * 0.3;
      return voice * strike(local, 0.004, 0.06);
    }).fadeOut(0.02);
  },
};

/** Bestätigung: „Ding-ding“ mit aufsteigender Quarte. */
const confirm: SoundRecipe = {
  id: "confirm",
  variants: 1,
  rateFactor: 1,
  level: OneShotLevel,
  build({ sampleRate }) {
    const notes: SparkleNote[] = [
      { midi: 81, at: 0, gain: 0.5 },
      { midi: 86, at: 0.09, gain: 0.5 },
    ];
    return sparkleRun(sampleRate, notes, { ratio: 2, index: 0.7, tau: 0.18, shimmer: 0.06 });
  },
};

/** Quest: kleine Fanfare „Ta-da-da-daaa“ mit weichem Akkord darunter. */
const quest: SoundRecipe = {
  id: "quest",
  variants: 1,
  rateFactor: 1,
  level: OneShotLevel,
  build({ sampleRate }) {
    const clip = Clip.silence(sampleRate, 1.4);
    [74, 78, 81].forEach((midi, k) => {
      clip.mix(bellTone(sampleRate, midiToHz(midi), { ratio: 2, index: 0.8, tau: 0.22, shimmer: 0.06 }), k * 0.09, 0.42);
    });
    clip.mix(bellTone(sampleRate, midiToHz(86), { ratio: 2, index: 0.9, tau: 0.6, shimmer: 0.1 }), 0.3, 0.5);
    for (const midi of [62, 69, 78]) {
      clip.mix(softTone(sampleRate, midiToHz(midi), { attack: 0.05, tau: 0.5, warmth: 0.3 }), 0.3, 0.16);
    }
    return clip;
  },
};

/** Upgrade: schneller Glitzerlauf über zwei Oktaven, Schlussakkord und ein leiser Luftzug nach oben. */
const upgrade: SoundRecipe = {
  id: "upgrade",
  variants: 1,
  rateFactor: 1,
  level: OneShotLevel,
  build({ sampleRate, random }) {
    const run: SparkleNote[] = [81, 83, 86, 88, 90, 93, 95, 98].map((midi, k) => ({ midi, at: k * 0.05, gain: 0.28 }));
    const chord: SparkleNote[] = [86, 90, 93].map((midi) => ({ midi, at: 0.42, gain: 0.3 }));
    const lift = whoosh(sampleRate, random, {
      seconds: 0.6,
      fromHz: 900,
      toHz: 5000,
      q: 1,
      pink: true,
      envelope: (t) => smoothstep(0, 0.4, t) * (1 - smoothstep(0.4, 0.6, t)),
    });
    return Clip.silence(sampleRate, 1.5)
      .mix(sparkleRun(sampleRate, run, { ratio: 2, index: 0.8, tau: 0.15, shimmer: 0.1 }), 0)
      .mix(sparkleRun(sampleRate, chord, { ratio: 2, index: 1, tau: 0.5, shimmer: 0.15 }), 0)
      .mix(lift, 0, 0.15);
  },
};

/** Aufschalten: zwei kurze, steigende elektronische „Bip-bip“. */
const lock: SoundRecipe = {
  id: "lock",
  variants: 1,
  rateFactor: 1,
  level: OneShotLevel,
  build({ sampleRate }) {
    const bips = [
      { frequency: 1800, start: 0 },
      { frequency: 2400, start: 0.08 },
    ];
    const triangle = new Oscillator(sampleRate);
    const pulse = new Oscillator(sampleRate, 0.1);
    const tone = new StateVariableFilter(sampleRate);
    return Clip.render(sampleRate, 0.2, (t) => {
      const bip = t < bips[1].start ? bips[0] : bips[1];
      const local = t - bip.start;
      const voice = triangle.triangle(bip.frequency) * 0.7 + pulse.pulse(bip.frequency, 0.5) * 0.3;
      return tone.lowpass(voice, 4000, 0.7) * strike(local, 0.002, 0.018);
    }).fadeOut(0.01);
  },
};

/** Abliefern: zwei Honig-„Blubb“ und ein metallisches „Kling-kling“ wie Münzen in der Wabe. */
const deposit: SoundRecipe = {
  id: "deposit",
  variants: 1,
  rateFactor: 1,
  level: OneShotLevel,
  build({ sampleRate }) {
    const coins: SparkleNote[] = [
      { midi: 86, at: 0.16, gain: 0.35 },
      { midi: 93, at: 0.2, gain: 0.3 },
      { midi: 98, at: 0.32, gain: 0.12 },
    ];
    return Clip.silence(sampleRate, 0.95)
      .mix(chirpTone(sampleRate, { fromHz: 250, toHz: 700, glideSeconds: 0.04, tau: 0.05, octave: 0.2 }), 0, 0.5)
      .mix(chirpTone(sampleRate, { fromHz: 300, toHz: 820, glideSeconds: 0.04, tau: 0.05, octave: 0.2 }), 0.09, 0.45)
      .mix(sparkleRun(sampleRate, coins, { ratio: 3.5, index: 1.5, indexTau: 0.05, tau: 0.3, shimmer: 0.15 }), 0);
  },
};

/** Rezepte der Oberflächenklänge. */
export const UiRecipes: readonly SoundRecipe[] = [click, hover, error, confirm, quest, upgrade, lock, deposit];
