// src/systems/audio/synth/recipes/creatures.ts — Dauerschleifen der Tiere: Flügelsummen der Biene und
// Brummen der Schmeißfliege. Beide Schleifen sind periodisch gerendert und damit nahtlos.
import type { Random } from "../../../../../shared/random";
import { Clip } from "../clip";
import { Oscillator, StateVariableFilter, TwoPi, saturate } from "../dsp";
import { LoopLevel, type SoundRecipe } from "./recipeTypes";

/** Periode der Tierschleifen in Sekunden; alle Frequenzen passen ganzzahlig hinein. */
const CreatureLoopSeconds = 2;

/** Grundton des Flügelsummens bei Abspielrate 1 (Hz). */
export const WingBuzzBaseHz = 180;

/** Weißes Rauschen als Tabelle, die sich mit der Schleife wiederholt (periodisches Rauschen). */
function periodicNoise(random: Random, length: number): Float32Array {
  const table = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    table[i] = random.next() * 2 - 1;
  }
  return table;
}

/** Flügelsummen der Biene: warmes „Zzz“ mit Nasenformant, Flügelflattern und einem Hauch Luft. */
const wingBuzz: SoundRecipe = {
  id: "wingBuzz",
  variants: 1,
  rateFactor: 1,
  level: LoopLevel,
  build({ sampleRate, random }) {
    const saw = new Oscillator(sampleRate);
    const pulse = new Oscillator(sampleRate, 0.13);
    const body = new StateVariableFilter(sampleRate);
    const nasal = new StateVariableFilter(sampleRate);
    const air = new StateVariableFilter(sampleRate);
    const noise = periodicNoise(random, Math.round(CreatureLoopSeconds * sampleRate));
    return Clip.renderPeriodicLoop(sampleRate, CreatureLoopSeconds, (t, index) => {
      const frequency = WingBuzzBaseHz * (1 + 0.006 * Math.sin(TwoPi * 6 * t) + 0.01 * Math.sin(TwoPi * 0.5 * t));
      const raw = saturate(0.65 * saw.saw(frequency) + 0.35 * pulse.pulse(frequency, 0.32), 1.4);
      const flutter = 1 + 0.08 * Math.sin(TwoPi * 11 * t) + 0.05 * Math.sin(TwoPi * 2 * t + 1.3);
      const tone = body.lowpass(raw, 2600, 0.8) * 0.75 + nasal.bandpass(raw, 950, 2.2) * 0.45;
      const breath = air.bandpass(noise[index % noise.length], 3800, 1.5) * 0.05;
      return (tone + breath) * flutter;
    });
  },
};

/** Fliegenbrummen: tiefes, raues „Brrzz“ aus zwei schwebenden Stimmen mit Sättigung und harten Formanten. */
const flyDrone: SoundRecipe = {
  id: "flyDrone",
  variants: 1,
  rateFactor: 1,
  level: LoopLevel,
  build({ sampleRate }) {
    const low = new Oscillator(sampleRate);
    const high = new Oscillator(sampleRate, 0.37);
    const body = new StateVariableFilter(sampleRate);
    const growl = new StateVariableFilter(sampleRate);
    const sting = new StateVariableFilter(sampleRate);
    return Clip.renderPeriodicLoop(sampleRate, CreatureLoopSeconds, (t) => {
      const a = low.pulse(120 * (1 + 0.004 * Math.sin(TwoPi * 7 * t)), 0.42);
      const b = high.saw(121.5 * (1 + 0.005 * Math.sin(TwoPi * 5 * t + 0.7)));
      const rough = (0.6 * a + 0.5 * b) * (1 + 0.18 * Math.sin(TwoPi * 31 * t));
      const driven = saturate(rough * 1.6, 2.2);
      return body.lowpass(driven, 3200, 0.9) * 0.6 + growl.bandpass(driven, 620, 1.6) * 0.5 + sting.bandpass(driven, 1850, 3.5) * 0.35;
    });
  },
};

/** Rezepte der Tierschleifen. */
export const CreatureRecipes: readonly SoundRecipe[] = [wingBuzz, flyDrone];
