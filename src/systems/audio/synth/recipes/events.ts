// src/systems/audio/synth/recipes/events.ts — Ereignisklänge: Bienentod, Wiederbelebung, Sammeln, Andocken,
// Warp, Summen-Emote, Heilung und Scanner. Tonale Klänge stehen in D-Dur-Pentatonik wie die Musik.
import { Clip } from "../clip";
import {
  EchoLine,
  NoiseSource,
  OnePole,
  Oscillator,
  StateVariableFilter,
  TwoPi,
  decay,
  expLerp,
  hann,
  midiToHz,
  semitones,
  smoothstep,
  strike,
} from "../dsp";
import { chirpTone, softTone, sparkleRun, whoosh, woodTok, type SparkleNote } from "../layers";
import { OneShotLevel, type SoundRecipe } from "./recipeTypes";

/** Bienentod: „Wah-wah-wah-waaah“ — drei Halbtonschritte abwärts, dann ein langer Gleitton mit wachsendem Vibrato. */
const beeDeath: SoundRecipe = {
  id: "beeDeath",
  variants: 1,
  rateFactor: 1,
  level: OneShotLevel,
  build({ sampleRate }) {
    const steps = [
      { midi: 67, start: 0, end: 0.2 },
      { midi: 66, start: 0.22, end: 0.42 },
      { midi: 65, start: 0.44, end: 0.64 },
    ];
    const finalStart = 0.66;
    const finalEnd = 1.6;
    const saw = new Oscillator(sampleRate);
    const pulse = new Oscillator(sampleRate, 0.4);
    const wing = new Oscillator(sampleRate);
    const tone = new StateVariableFilter(sampleRate);
    const wah = new StateVariableFilter(sampleRate);
    return Clip.render(sampleRate, 1.72, (t) => {
      let frequency: number;
      let amplitude: number;
      let formant: number;
      if (t < finalStart) {
        let stepIndex = 0;
        while (stepIndex < steps.length - 1 && t >= steps[stepIndex].end + 0.02) {
          stepIndex++;
        }
        const step = steps[stepIndex];
        const local = t - step.start;
        frequency = midiToHz(step.midi);
        amplitude = smoothstep(step.start, step.start + 0.02, t) * (1 - smoothstep(step.end - 0.04, step.end, t));
        formant = expLerp(450, 1100, smoothstep(0, 0.08, local)) * (1 - 0.3 * smoothstep(0.08, 0.2, local));
      } else {
        const local = t - finalStart;
        const progress = Math.min(1, local / (finalEnd - finalStart));
        const vibrato = 0.03 * smoothstep(0, 0.6, progress) * Math.sin(TwoPi * 5.5 * t);
        frequency = midiToHz(64) * semitones(-12 * smoothstep(0.15, 1, progress)) * (1 + vibrato);
        amplitude = smoothstep(0, 0.03, local) * (1 - smoothstep(0.7, 1, progress));
        formant = expLerp(500, 1100, smoothstep(0, 0.1, local)) * (1 - 0.4 * progress);
      }
      const voice = saw.saw(frequency) * 0.55 + pulse.pulse(frequency, 0.3) * 0.3;
      const body = tone.lowpass(voice, 1800, 0.8) * 0.6 + wah.bandpass(voice, formant, 2.5) * 0.7;
      const buzz = wing.pulse(expLerp(190, 80, Math.min(1, t / 1.5)), 0.3) * 0.06 * (1 - smoothstep(0.8, 1.5, t));
      return body * amplitude + buzz;
    }).fadeOut(0.05);
  },
};

/** Wiederbelebung: warme Fläche schwillt an, darüber ein aufsteigendes Arpeggio und heller Schimmer. */
const revive: SoundRecipe = {
  id: "revive",
  variants: 1,
  rateFactor: 1,
  level: OneShotLevel,
  build({ sampleRate }) {
    const padNotes = [50, 57, 62].map(midiToHz);
    const saws = padNotes.flatMap(() => [new Oscillator(sampleRate, 0.1), new Oscillator(sampleRate, 0.6)]);
    const filter = new StateVariableFilter(sampleRate);
    const detuneDown = semitones(-0.06);
    const detuneUp = semitones(0.06);
    const pad = Clip.render(sampleRate, 1.9, (t) => {
      let sum = 0;
      for (let i = 0; i < padNotes.length; i++) {
        sum += saws[i * 2].saw(padNotes[i] * detuneDown) + saws[i * 2 + 1].saw(padNotes[i] * detuneUp);
      }
      const envelope = smoothstep(0, 0.7, t) * (t > 0.95 ? Math.exp(-(t - 0.95) / 0.45) : 1);
      return filter.lowpass(sum * 0.12, expLerp(300, 2600, smoothstep(0, 0.9, t)), 0.9) * envelope;
    }).fadeOut(0.08);
    const arpeggio: SparkleNote[] = [62, 66, 69, 74, 78, 81].map((midi, k) => ({ midi, at: 0.05 + k * 0.085, gain: 0.3 + k * 0.03 }));
    const shimmer: SparkleNote[] = [86, 90, 93, 98].map((midi, k) => ({ midi, at: 0.62 + k * 0.13, gain: 0.1 }));
    return Clip.silence(sampleRate, 1.9)
      .mix(pad, 0, 0.8)
      .mix(sparkleRun(sampleRate, arpeggio, { ratio: 2, index: 0.8, tau: 0.45, shimmer: 0.05 }), 0)
      .mix(sparkleRun(sampleRate, shimmer, { ratio: 2, index: 1.1, tau: 0.25, shimmer: 0.2 }), 0);
  },
};

/** Pollen sammeln: helles Glitzern aus fünf aufsteigenden Glastönen und einem Hauch Luft. */
const collect: SoundRecipe = {
  id: "collect",
  variants: 3,
  rateFactor: 1,
  level: OneShotLevel,
  build({ sampleRate, random }, variant) {
    const pools = [
      [86, 88, 90, 93, 95, 98],
      [83, 86, 88, 90, 93, 95],
      [88, 90, 93, 95, 98, 100],
    ];
    const pool = [...(pools[variant] ?? pools[0])];
    while (pool.length > 5) {
      pool.splice(1 + random.int(pool.length - 2), 1);
    }
    const notes: SparkleNote[] = pool.map((midi, k) => ({ midi, at: 0.004 + k * 0.052 + random.range(0, 0.01), gain: 0.45 - k * 0.04 }));
    const glitter = sparkleRun(sampleRate, notes, { ratio: 2, index: 0.9, indexTau: 0.04, tau: 0.16 + 0.04 * variant, shimmer: 0.18 });
    const noise = new NoiseSource(random);
    const air = new StateVariableFilter(sampleRate);
    const breeze = Clip.render(sampleRate, 0.4, (t) => air.highpass(noise.white(), 7000) * strike(t, 0.003, 0.12) * 0.06);
    return Clip.silence(sampleRate, glitter.duration)
      .mix(glitter, 0)
      .mix(breeze, 0)
      .process(() => {
        const tone = new StateVariableFilter(sampleRate);
        return (value) => tone.lowpass(value, 11000, 0.7);
      });
  },
};

/** Andocken: Luftzug hinein, zwei hölzerne „Tock“ am Flugloch und ein warmer Ankunftsakkord. */
const dock: SoundRecipe = {
  id: "dock",
  variants: 1,
  rateFactor: 1,
  level: OneShotLevel,
  build({ sampleRate, random }) {
    const draft = whoosh(sampleRate, random, {
      seconds: 0.65,
      fromHz: 1800,
      toHz: 380,
      q: 1.2,
      pink: true,
      envelope: (t) => hann(t, 0, 0.65),
      progress: (t) => smoothstep(0, 0.55, t),
    });
    const clip = Clip.silence(sampleRate, 1.25)
      .mix(draft, 0, 0.7)
      .mix(woodTok(sampleRate, random, 720), 0.38, 0.8)
      .mix(woodTok(sampleRate, random, 600), 0.5, 0.7);
    for (const midi of [50, 57, 66]) {
      clip.mix(softTone(sampleRate, midiToHz(midi), { attack: 0.12, tau: 0.45, warmth: 0.4 }), 0.45, 0.22);
    }
    return clip;
  },
};

/** Abdocken: ein „Tock“, aufsteigender Luftzug und zwei helle Abschiedstöne. */
const undock: SoundRecipe = {
  id: "undock",
  variants: 1,
  rateFactor: 1,
  level: OneShotLevel,
  build({ sampleRate, random }) {
    const draft = whoosh(sampleRate, random, {
      seconds: 0.7,
      fromHz: 420,
      toHz: 2400,
      q: 1.2,
      pink: true,
      envelope: (t) => hann(t, 0.03, 0.68),
      progress: (t) => smoothstep(0.05, 0.5, t),
    });
    const chime: SparkleNote[] = [
      { midi: 69, at: 0.15, gain: 0.25 },
      { midi: 76, at: 0.28, gain: 0.25 },
    ];
    return Clip.silence(sampleRate, 0.95)
      .mix(woodTok(sampleRate, random, 820), 0, 0.8)
      .mix(draft, 0, 0.7)
      .mix(sparkleRun(sampleRate, chime, { ratio: 2, index: 0.5, tau: 0.25, shimmer: 0.05 }), 0);
  },
};

/** Warp-Start: der Sturmwind packt zu — anschwellender Luftzug, hochdrehender Ton, dann ein „Wumms“. */
const warpStart: SoundRecipe = {
  id: "warpStart",
  variants: 1,
  rateFactor: 1,
  level: OneShotLevel,
  build({ sampleRate, random }) {
    const peakAt = 1.35;
    const noise = new NoiseSource(random);
    const band = new StateVariableFilter(sampleRate);
    const root = new Oscillator(sampleRate);
    const fifth = new Oscillator(sampleRate, 0.3);
    const tone = new StateVariableFilter(sampleRate);
    const boom = new Oscillator(sampleRate);
    const boomNoise = new StateVariableFilter(sampleRate);
    return Clip.render(sampleRate, 1.9, (t) => {
      const rise = Math.min(1, t / peakAt);
      const after = t - peakAt;
      const windLevel = t < peakAt ? rise * rise : Math.exp(-after / 0.12);
      const wind = band.bandpass(noise.pink() * 3, expLerp(250, 3800, Math.pow(rise, 1.5)), 1.6) * windLevel;
      const pitch = expLerp(90, 520, Math.pow(rise, 1.3));
      const spoolLevel = t < peakAt ? Math.pow(rise, 1.6) : Math.exp(-after / 0.05);
      const spool = tone.lowpass(root.saw(pitch) + fifth.saw(pitch * 1.5), pitch * 2.2, 1.2) * spoolLevel * 0.35;
      const whoomp =
        boom.sine(48 + 120 * Math.exp(-Math.max(0, after) / 0.05)) * strike(after, 0.003, 0.18) +
        boomNoise.lowpass(noise.white(), 900, 0.7) * strike(after, 0.002, 0.08) * 0.5;
      return wind * 0.9 + spool + whoomp * 0.9;
    }).fadeOut(0.05);
  },
};

/** Warp-Ende: Abbremsen mit fallendem Luftzug und Ton, ein weiches „Pff“ und kleines Glitzern zur Ankunft. */
const warpEnd: SoundRecipe = {
  id: "warpEnd",
  variants: 1,
  rateFactor: 1,
  level: OneShotLevel,
  build({ sampleRate, random }) {
    const noise = new NoiseSource(random);
    const band = new StateVariableFilter(sampleRate);
    const saw = new Oscillator(sampleRate);
    const tone = new StateVariableFilter(sampleRate);
    const puff = new StateVariableFilter(sampleRate);
    const brake = Clip.render(sampleRate, 1.3, (t) => {
      const wind = band.bandpass(noise.pink() * 3, expLerp(3500, 300, smoothstep(0, 0.65, t)), 1.4) * strike(t, 0.01, 0.35);
      const fall = tone.lowpass(saw.saw(expLerp(500, 80, smoothstep(0, 0.6, t))), 1400, 0.8) * strike(t, 0.005, 0.3) * 0.3;
      const arrival = puff.lowpass(noise.white(), 1200, 0.7) * strike(t - 0.55, 0.01, 0.12) * 0.4;
      return wind + fall + arrival;
    }).fadeOut(0.05);
    const sparkles: SparkleNote[] = [
      { midi: 81, at: 0.62, gain: 0.16 },
      { midi: 86, at: 0.72, gain: 0.16 },
      { midi: 90, at: 0.84, gain: 0.14 },
    ];
    return Clip.silence(sampleRate, 1.6).mix(brake, 0).mix(sparkleRun(sampleRate, sparkles, { tau: 0.22 }), 0);
  },
};

/** Ein Ton einer Summ-Melodie: Halbtöne über D4 und Dauer in Sekunden. */
type HumNote = readonly [semitone: number, seconds: number];

/** Summ-Melodien des Emotes: kurze, fröhliche Motive in D-Dur. */
const HumMelodies: readonly (readonly HumNote[])[] = [
  [[0, 0.16], [4, 0.16], [7, 0.16], [12, 0.44]],
  [[7, 0.14], [4, 0.14], [7, 0.14], [9, 0.14], [7, 0.42]],
  [[0, 0.12], [2, 0.12], [4, 0.12], [2, 0.12], [0, 0.14], [7, 0.42]],
];

/** Summen-Emote: die Biene summt ein kleines Motiv — gesummte Stimme mit Flügelflattern und Gleitübergängen. */
const buzz: SoundRecipe = {
  id: "buzz",
  variants: HumMelodies.length,
  rateFactor: 1,
  level: OneShotLevel,
  build({ sampleRate }, variant) {
    const melody = HumMelodies[variant] ?? HumMelodies[0];
    const starts: number[] = [];
    let total = 0.02;
    for (const [, seconds] of melody) {
      starts.push(total);
      total += seconds;
    }
    const lastStart = starts[starts.length - 1];
    const base = midiToHz(62);
    const glide = new OnePole(sampleRate);
    const saw = new Oscillator(sampleRate);
    const pulse = new Oscillator(sampleRate, 0.2);
    const lowpass = new StateVariableFilter(sampleRate);
    const nasal = new StateVariableFilter(sampleRate);
    const buzzing = new StateVariableFilter(sampleRate);
    return Clip.render(sampleRate, total + 0.2, (t) => {
      let index = 0;
      while (index < melody.length - 1 && t >= starts[index + 1]) {
        index++;
      }
      const [semitone, seconds] = melody[index];
      const noteStart = starts[index];
      const pitch = glide.lowpass(Math.log2(base * semitones(semitone)), 7);
      const vibrato = index === melody.length - 1 ? 0.015 * smoothstep(lastStart + 0.1, lastStart + 0.3, t) * Math.sin(TwoPi * 5.5 * t) : 0;
      const frequency = Math.pow(2, pitch) * (1 + vibrato);
      const voice = saw.saw(frequency) * 0.6 + pulse.pulse(frequency, 0.25) * 0.25;
      const flutter = 1 + 0.12 * Math.sin(TwoPi * 34 * t);
      const hum = lowpass.lowpass(voice, 1400, 0.9) * 0.7 + nasal.bandpass(voice, 320, 2) * 0.6 + buzzing.bandpass(voice, 2400, 4) * 0.12;
      const articulation = 0.65 + 0.35 * smoothstep(noteStart, noteStart + 0.03, t) * (1 - smoothstep(noteStart + seconds - 0.025, noteStart + seconds, t));
      const envelope = smoothstep(0, 0.03, t) * (1 - smoothstep(total - 0.02, total + 0.12, t));
      return hum * flutter * articulation * envelope;
    }).fadeOut(0.04);
  },
};

/** Nektar-Heilung: zwei „Gluck“-Schlucke Nektar, ein warmer Dreiklang und ein Hauch Atem. */
const heal: SoundRecipe = {
  id: "heal",
  variants: 1,
  rateFactor: 1,
  level: OneShotLevel,
  build({ sampleRate, random }) {
    const clip = Clip.silence(sampleRate, 1.3)
      .mix(chirpTone(sampleRate, { fromHz: 280, toHz: 520, glideSeconds: 0.06, tau: 0.05, octave: 0.15 }), 0, 0.4)
      .mix(chirpTone(sampleRate, { fromHz: 320, toHz: 600, glideSeconds: 0.06, tau: 0.05, octave: 0.15 }), 0.1, 0.35);
    [74, 78, 81].forEach((midi, k) => {
      clip.mix(softTone(sampleRate, midiToHz(midi), { attack: 0.02, tau: 0.45, warmth: 0.15 }), 0.14 + k * 0.06, 0.25);
    });
    const breath = whoosh(sampleRate, random, {
      seconds: 1.1,
      fromHz: 1600,
      toHz: 2600,
      q: 0.8,
      pink: true,
      envelope: (t) => hann(t, 0.1, 1.1),
    });
    return clip.mix(breath, 0, 0.12);
  },
};

/** Duftscanner: zwei Schnüffler, dann ein Sonar-„Ping“ mit gedämpften Echos und einem weichen Nachklang. */
const scan: SoundRecipe = {
  id: "scan",
  variants: 1,
  rateFactor: 1,
  level: OneShotLevel,
  build({ sampleRate, random }) {
    const sniff = (): Clip =>
      whoosh(sampleRate, random, { seconds: 0.09, fromHz: 2300, toHz: 2900, q: 1.8, pink: true, envelope: (t) => hann(t, 0, 0.09) });
    const ping = new Oscillator(sampleRate);
    const pingOctave = new Oscillator(sampleRate, 0.3);
    const echo = new EchoLine(sampleRate, 0.4);
    const sonar = Clip.render(sampleRate, 1.4, (t) => {
      const frequency = 1240 * (1 - 0.04 * smoothstep(0, 0.35, t));
      const dry = (ping.sine(frequency) + 0.25 * pingOctave.sine(frequency * 2) * decay(t, 0.08)) * strike(t, 0.002, 0.28);
      return dry + echo.process(dry, 0.21, 0.45, 3000) * 0.8;
    }).fadeOut(0.1);
    const clip = Clip.silence(sampleRate, 1.7).mix(sniff(), 0, 0.5).mix(sniff(), 0.13, 0.5).mix(sonar, 0.26, 0.9);
    for (const frequency of [620, 930]) {
      clip.mix(softTone(sampleRate, frequency, { attack: 0.08, tau: 0.5, warmth: 0.2 }), 0.26, 0.08);
    }
    return clip;
  },
};

/** Rezepte der Ereignisklänge. */
export const EventRecipes: readonly SoundRecipe[] = [beeDeath, revive, collect, dock, undock, warpStart, warpEnd, buzz, heal, scan];
