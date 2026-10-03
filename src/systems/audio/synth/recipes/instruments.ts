// src/systems/audio/synth/recipes/instruments.ts — Instrumentenproben der Hintergrundmusik (Kalimba, Glocke,
// Fläche, Bass) und der Raumhall. Die Musik transponiert die Proben über die Abspielrate.
import { Clip } from "../clip";
import { NoiseSource, Oscillator, StateVariableFilter, TwoPi, expLerp, midiToHz, semitones, smoothstep, strike } from "../dsp";
import { bellTone } from "../layers";
import { InstrumentLevel, type SoundRecipe } from "./recipeTypes";

/** Grundtöne der Instrumentenproben als MIDI-Noten (Variante → Note). */
export const InstrumentBaseNotes = {
  kalimba: [62, 74],
  bell: 86,
  pad: 50,
  bass: 38,
} as const;

/** Halteschleife der Flächenprobe in Sekunden: davor liegt der Einschwingvorgang. */
export const PadSustainLoop = { start: 1.2, end: 3.6 } as const;

/** Kalimba: Zinkenton mit kurzem Oberton bei 5,95 · f, leiser Oktave und Daumenklick. */
const kalimba: SoundRecipe = {
  id: "kalimba",
  variants: InstrumentBaseNotes.kalimba.length,
  rateFactor: 1,
  level: InstrumentLevel,
  build({ sampleRate, random }, variant) {
    const frequency = midiToHz(InstrumentBaseNotes.kalimba[variant] ?? InstrumentBaseNotes.kalimba[0]);
    const tine = new Oscillator(sampleRate);
    const overtone = new Oscillator(sampleRate, 0.1);
    const octave = new Oscillator(sampleRate, 0.6);
    const noise = new NoiseSource(random);
    const thumb = new StateVariableFilter(sampleRate);
    const body = new StateVariableFilter(sampleRate);
    return Clip.render(sampleRate, 2.4, (t) => {
      const beat = 1 + 0.0015 * Math.sin(TwoPi * 3 * t);
      const tone =
        tine.sine(frequency * beat) * strike(t, 0.002, 0.7) +
        overtone.sine(frequency * 5.95) * strike(t, 0.001, 0.07) * 0.22 +
        octave.sine(frequency * 2.01) * strike(t, 0.001, 0.22) * 0.1 +
        thumb.lowpass(noise.white(), 2600, 0.7) * strike(t, 0.0004, 0.004) * 0.2;
      return tone + body.bandpass(tone, frequency * 1.5, 1.2) * 0.15;
    }).fadeOut(0.1);
  },
};

/** Glocke: FM-Glocke mit unharmonischem Verhältnis 3,5 und langem Ausklang. */
const bell: SoundRecipe = {
  id: "bell",
  variants: 1,
  rateFactor: 1,
  level: InstrumentLevel,
  build({ sampleRate }) {
    return bellTone(sampleRate, midiToHz(InstrumentBaseNotes.bell), {
      ratio: 3.5,
      index: 2.2,
      indexTau: 0.25,
      tau: 1.1,
      attack: 0.003,
      shimmer: 0.08,
      seconds: 3.2,
    });
  },
};

/** Fläche: drei leicht verstimmte Sägezähne und ein Subsinus hinter einem atmenden Tiefpass, mit Halteschleife. */
const pad: SoundRecipe = {
  id: "pad",
  variants: 1,
  rateFactor: 0.5,
  level: InstrumentLevel,
  build({ sampleRate }) {
    const frequency = midiToHz(InstrumentBaseNotes.pad);
    const low = new Oscillator(sampleRate, 0.1);
    const mid = new Oscillator(sampleRate, 0.5);
    const high = new Oscillator(sampleRate, 0.8);
    const sub = new Oscillator(sampleRate);
    const filter = new StateVariableFilter(sampleRate);
    const down = frequency * semitones(-0.07);
    const up = frequency * semitones(0.07);
    return Clip.render(sampleRate, PadSustainLoop.end + 0.1, (t) => {
      const raw = low.saw(down) + mid.saw(frequency) + high.saw(up) + 0.6 * sub.sine(frequency * 0.5);
      const cutoff = 1100 * (1 + 0.12 * Math.sin(TwoPi * 0.4 * t));
      return filter.lowpass(raw * 0.3, cutoff, 0.8) * smoothstep(0, 0.8, t);
    }).withSustainLoop(PadSustainLoop.start, PadSustainLoop.end, 0.35);
  },
};

/** Bass: weicher Sinus mit etwas Dreieck, tiefpassgefiltert. */
const bass: SoundRecipe = {
  id: "bass",
  variants: 1,
  rateFactor: 0.5,
  level: InstrumentLevel,
  build({ sampleRate }) {
    const frequency = midiToHz(InstrumentBaseNotes.bass);
    const sine = new Oscillator(sampleRate);
    const triangle = new Oscillator(sampleRate, 0.05);
    const filter = new StateVariableFilter(sampleRate);
    return Clip.render(sampleRate, 2.6, (t) => {
      const raw = sine.sine(frequency) + 0.35 * triangle.triangle(frequency);
      return filter.lowpass(raw, 420, 0.7) * strike(t, 0.03, 0.9);
    }).fadeOut(0.2);
  },
};

/** Raumhall des Himmels: Vorverzögerung, frühe Reflexionen und ein Nachhall, der mit der Zeit dunkler wird. */
const reverbImpulse: SoundRecipe = {
  id: "reverbImpulse",
  variants: 1,
  rateFactor: 1,
  level: InstrumentLevel,
  build({ sampleRate, random }) {
    const seconds = 2.6;
    const tau = 2.3 / 6.91;
    const preDelay = 0.018;
    const leftNoise = new NoiseSource(random);
    const rightNoise = new NoiseSource(random);
    const leftFilter = new StateVariableFilter(sampleRate);
    const rightFilter = new StateVariableFilter(sampleRate);
    const clip = Clip.renderStereo(sampleRate, seconds, (t, frame) => {
      const envelope = smoothstep(preDelay, preDelay + 0.012, t) * Math.exp(-Math.max(0, t - preDelay) / tau);
      const cutoff = expLerp(9000, 1300, t / seconds);
      frame.left = leftFilter.lowpass(leftNoise.white(), cutoff, 0.6) * envelope;
      frame.right = rightFilter.lowpass(rightNoise.white(), cutoff, 0.6) * envelope;
    });
    const reflection = Clip.render(sampleRate, 0.002, (t) => strike(t, 0.0002, 0.0004));
    for (let k = 0; k < 7; k++) {
      const at = random.range(0.006, 0.07);
      clip.mix(reflection, at, 0.6 * Math.exp(-at / 0.05), random.range(-0.8, 0.8));
    }
    return clip.fadeOut(0.2);
  },
};

/** Rezepte der Musikinstrumente und des Halls. */
export const InstrumentRecipes: readonly SoundRecipe[] = [kalimba, bell, pad, bass, reverbImpulse];
