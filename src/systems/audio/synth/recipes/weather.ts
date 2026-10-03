// src/systems/audio/synth/recipes/weather.ts — Wetter und Umgebung: Donner nah und fern, Rauschbett für Wind
// und Regen, Regentropfen und Nachtgrillen.
import type { Random } from "../../../../../shared/random";
import { Clip } from "../clip";
import { Crackle, NoiseSource, StateVariableFilter, TwoPi, expLerp, hann, saturate, smoothstep, strike } from "../dsp";
import { LoopLevel, OneShotLevel, type SoundRecipe } from "./recipeTypes";

/** Länge des Rauschbetts in Sekunden. */
const NoiseBedSeconds = 3;
/** Länge der Regentropfen-Schleife in Sekunden. */
const RainPatterSeconds = 4;
/** Länge der Grillen-Schleife in Sekunden; alle Zirpperioden teilen sie ganzzahlig. */
const CricketLoopSeconds = 8;

/** Ein Blitzschlag im Donnergrollen: Einsatz, Stärke, Anstieg und Abklingen. */
interface ThunderStroke {
  readonly at: number;
  readonly amplitude: number;
  readonly attack: number;
  readonly tau: number;
}

/** Donner: Grollen aus braunem Rauschen mit mehreren Schlägen; nah mit Krachen und Knistern, fern dunkler und länger. */
function buildThunder(sampleRate: number, random: Random, near: boolean): Clip {
  const seconds = near ? 5.5 : 6.5;
  const count = (near ? 4 : 5) + random.int(3);
  const strokes: ThunderStroke[] = [];
  for (let k = 0; k < count; k++) {
    strokes.push({
      at: k === 0 ? (near ? 0.02 : 0.2) : random.range(near ? 0.05 : 0.3, near ? 1.7 : 3.4),
      amplitude: k === 0 ? 1 : random.range(0.45, 0.95),
      attack: near ? random.range(0.03, 0.12) : random.range(0.15, 0.4),
      tau: near ? random.range(0.35, 1) : random.range(0.6, 1.5),
    });
  }
  const rumbleNoise = new NoiseSource(random);
  const subNoise = new NoiseSource(random);
  const crackNoise = new NoiseSource(random);
  const rumble = new StateVariableFilter(sampleRate);
  const sub = new StateVariableFilter(sampleRate);
  const crack = new StateVariableFilter(sampleRate);
  const crackle = new Crackle(sampleRate, random, 0.001);
  const crackleTone = new StateVariableFilter(sampleRate);
  const rollRate = random.range(1.1, 1.9);
  return Clip.render(sampleRate, seconds, (t) => {
    let envelope = 0;
    for (let k = 0; k < strokes.length; k++) {
      const stroke = strokes[k];
      envelope += stroke.amplitude * strike(t - stroke.at, stroke.attack, stroke.tau);
    }
    const strength = Math.min(1, envelope);
    const cutoff = near ? 90 + 300 * strength : 60 + 150 * strength;
    const body = rumble.lowpass(rumbleNoise.brown() + 0.3 * rumbleNoise.pink(), cutoff, 0.7);
    const deep = sub.lowpass(subNoise.brown(), 55, 0.6);
    const roll = 1 + 0.25 * Math.sin(TwoPi * rollRate * t);
    let value = (body + deep * 0.7) * Math.min(1.4, envelope) * roll;
    if (near) {
      value +=
        crack.highpass(crackNoise.white(), 500, 0.7) * strike(t, 0.0015, 0.045) * 1.1 +
        crackleTone.highpass(crackle.next(900 * Math.exp(-t / 0.12)), 800) * 0.5;
    }
    return saturate(value * (1 - smoothstep(seconds - 1.6, seconds, t)), 1.3);
  });
}

/** Naher Donner mit Krachen. */
const thunder: SoundRecipe = {
  id: "thunder",
  variants: 2,
  rateFactor: 0.5,
  level: OneShotLevel,
  build({ sampleRate, random }) {
    return buildThunder(sampleRate, random, true);
  },
};

/** Ferner Donner: rollendes Grollen ohne Krachen. */
const thunderFar: SoundRecipe = {
  id: "thunderFar",
  variants: 2,
  rateFactor: 0.5,
  level: OneShotLevel,
  build({ sampleRate, random }) {
    return buildThunder(sampleRate, random, false);
  },
};

/** Rauschbett: dekorreliertes rosa Stereorauschen als nahtlose Schleife — Rohstoff für Wind und Regen. */
const noiseBed: SoundRecipe = {
  id: "noiseBed",
  variants: 1,
  rateFactor: 1,
  level: LoopLevel,
  build({ sampleRate, random }) {
    const left = new NoiseSource(random);
    const right = new NoiseSource(random);
    return Clip.renderStereo(sampleRate, NoiseBedSeconds + 0.25, (_t, frame) => {
      frame.left = left.pink();
      frame.right = right.pink();
    }).toLoop(NoiseBedSeconds, 0.25);
  },
};

/** Schreibt einen Regentropfen (kurzer, leicht steigender Sinus) mit Umlauf in einen Stereoclip. */
function addDroplet(clip: Clip, start: number, frequency: number, tau: number, amplitude: number, pan: number): void {
  const sampleRate = clip.sampleRate;
  const length = clip.length;
  const count = Math.min(length, Math.ceil(tau * 6 * sampleRate));
  const angle = ((pan + 1) * Math.PI) / 4;
  const leftGain = Math.cos(angle) * amplitude;
  const rightGain = Math.sin(angle) * amplitude;
  const [left, right] = clip.channels;
  let phase = 0;
  for (let i = 0; i < count; i++) {
    const t = i / sampleRate;
    phase += (frequency * (1 + 0.5 * (1 - Math.exp(-t / 0.002)))) / sampleRate;
    const value = Math.sin(TwoPi * phase) * Math.exp(-t / tau) * Math.min(1, i / 3);
    const index = (start + i) % length;
    left[index] += value * leftGain;
    right[index] += value * rightGain;
  }
}

/** Regentropfen: dichtes Prasseln feiner Tropfen und einzelne dickere „Plitsch“ als nahtlose Stereoschleife. */
const rainPatter: SoundRecipe = {
  id: "rainPatter",
  variants: 1,
  rateFactor: 0.5,
  level: LoopLevel,
  build({ sampleRate, random }) {
    const clip = Clip.silence(sampleRate, RainPatterSeconds, 2);
    const fine = Math.round(RainPatterSeconds * 900);
    for (let k = 0; k < fine; k++) {
      const amplitude = 0.15 + 0.85 * Math.pow(random.next(), 3);
      addDroplet(clip, random.int(clip.length), expLerp(1800, 7000, random.next()), random.range(0.0015, 0.0055), amplitude, random.range(-1, 1));
    }
    const heavy = Math.round(RainPatterSeconds * 14);
    for (let k = 0; k < heavy; k++) {
      addDroplet(clip, random.int(clip.length), random.range(700, 1400), random.range(0.008, 0.015), 0.6, random.range(-0.8, 0.8));
    }
    return clip;
  },
};

/** Eine Grille: Trägerfrequenz, Zirpperiode, Pulse je Zirp, Pulsrate, Panorama, Pegel und Singphase. */
interface CricketVoice {
  readonly carrier: number;
  readonly period: number;
  readonly pulses: number;
  readonly pulseRate: number;
  readonly pan: number;
  readonly gain: number;
  readonly offset: number;
  /** Anteil der Schleife, in dem die Grille singt (Anfang, Ende). */
  readonly active: readonly [number, number];
}

const Crickets: readonly CricketVoice[] = [
  { carrier: 4650, period: 0.8, pulses: 3, pulseRate: 32, pan: -0.6, gain: 0.8, offset: 0.1, active: [0, 0.75] },
  { carrier: 4300, period: 1, pulses: 4, pulseRate: 28, pan: 0.55, gain: 0.6, offset: 0.37, active: [0.2, 1] },
  { carrier: 5050, period: 0.5, pulses: 2, pulseRate: 36, pan: 0.1, gain: 0.32, offset: 0.05, active: [0, 1] },
  { carrier: 3900, period: 1.6, pulses: 5, pulseRate: 25, pan: -0.25, gain: 0.3, offset: 0.9, active: [0.1, 0.9] },
];

/** Ein Grillenpuls: kurzer Sinus mit leicht fallender Tonhöhe im Hann-Fenster. */
function cricketPulse(sampleRate: number, carrier: number, seconds: number): Clip {
  let phase = 0;
  return Clip.render(sampleRate, seconds, (t) => {
    phase += (carrier * (1 - (0.03 * t) / seconds)) / sampleRate;
    return Math.sin(TwoPi * phase) * hann(t, 0, seconds);
  });
}

/** Nachtgrillen: vier zirpende Grillen im Stereofeld und ein ferner Baumgrillen-Triller als nahtlose Schleife. */
const crickets: SoundRecipe = {
  id: "crickets",
  variants: 1,
  rateFactor: 0.5,
  level: LoopLevel,
  build({ sampleRate, random }) {
    const clip = Clip.silence(sampleRate, CricketLoopSeconds, 2);
    for (const voice of Crickets) {
      const pulse = cricketPulse(sampleRate, voice.carrier, 0.016);
      const chirps = Math.round(CricketLoopSeconds / voice.period);
      for (let n = 0; n < chirps; n++) {
        const chirp = voice.offset + n * voice.period;
        const position = (chirp % CricketLoopSeconds) / CricketLoopSeconds;
        const presence = smoothstep(voice.active[0], voice.active[0] + 0.06, position) * (1 - smoothstep(voice.active[1] - 0.06, voice.active[1], position));
        if (presence <= 0.01) {
          continue;
        }
        const amplitude = voice.gain * presence * random.range(0.75, 1);
        for (let p = 0; p < voice.pulses; p++) {
          clip.mixWrapped(pulse, chirp + p / voice.pulseRate + random.range(-0.002, 0.002), amplitude, voice.pan);
        }
      }
    }
    const trill = cricketPulse(sampleRate, 2950, 0.012);
    const trillRate = 48;
    for (let k = 0; k < CricketLoopSeconds * trillRate; k++) {
      const t = k / trillRate;
      clip.mixWrapped(trill, t, 0.12 * (0.5 + 0.5 * Math.sin((TwoPi * t) / CricketLoopSeconds)), 0.8);
    }
    return clip;
  },
};

/** Rezepte für Wetter und Umgebung. */
export const WeatherRecipes: readonly SoundRecipe[] = [thunder, thunderFar, noiseBed, rainPatter, crickets];
