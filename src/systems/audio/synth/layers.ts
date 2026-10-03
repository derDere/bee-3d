// src/systems/audio/synth/layers.ts — wiederverwendbare Klangschichten der Rezepte: Glocke, Gleitton, Plopp,
// Holzklopfen, Luftzug, Platsch und weicher Ton.
import type { Random } from "../../../../shared/random";
import { Clip } from "./clip";
import { NoiseSource, Oscillator, StateVariableFilter, expLerp, midiToHz, smoothstep, strike } from "./dsp";

/** Kurze Ausblendung am Clipende gegen Knackser. */
const TailFadeSeconds = 0.012;

/** Optionen eines Glockentons. */
export interface BellOptions {
  /** Abklingzeit des Tons in Sekunden. */
  readonly tau?: number;
  /** Verhältnis Modulator zu Träger: 2 klingt gläsern, 3,5 nach Glocke. */
  readonly ratio?: number;
  /** FM-Index am Anschlag (Helligkeit). */
  readonly index?: number;
  /** Abklingzeit des FM-Index. */
  readonly indexTau?: number;
  readonly attack?: number;
  /** Anteil eines unharmonischen Obertons bei 2,76 · f (Schimmer). */
  readonly shimmer?: number;
  readonly seconds?: number;
}

/** Glockenton per Frequenzmodulation (Glockenton): klar, mit abklingender Helligkeit. */
export function bellTone(sampleRate: number, frequency: number, options: BellOptions = {}): Clip {
  const tau = options.tau ?? 0.35;
  const ratio = options.ratio ?? 2;
  const index = options.index ?? 1.2;
  const indexTau = options.indexTau ?? 0.06;
  const attack = options.attack ?? 0.002;
  const shimmer = options.shimmer ?? 0.12;
  const seconds = options.seconds ?? tau * 4.5 + 0.03;
  const carrier = new Oscillator(sampleRate);
  const modulator = new Oscillator(sampleRate);
  const partial = new Oscillator(sampleRate, 0.3);
  const shimmerTau = tau * 0.4;
  return Clip.render(sampleRate, seconds, (t) => {
    const modulation = index * Math.exp(-t / indexTau) * modulator.sine(frequency * ratio);
    const tone = carrier.sine(frequency, modulation) + shimmer * partial.sine(frequency * 2.76) * Math.exp(-t / shimmerTau);
    return tone * strike(t, attack, tau);
  }).fadeOut(TailFadeSeconds);
}

/** Optionen eines Gleittons. */
export interface ChirpOptions {
  readonly fromHz: number;
  readonly toHz: number;
  /** Dauer der Tonhöhenfahrt (verlangsamt sich zum Ende). */
  readonly glideSeconds: number;
  readonly tau: number;
  readonly attack?: number;
  /** Anteil der Oktave über dem Grundton. */
  readonly octave?: number;
  readonly seconds?: number;
}

/** Gleitton (Gleitton): Sinus mit Tonhöhenfahrt und Anschlag-Hüllkurve — Tropfen, Blubbern, Piepen. */
export function chirpTone(sampleRate: number, options: ChirpOptions): Clip {
  const attack = options.attack ?? 0.002;
  const octave = options.octave ?? 0;
  const seconds = options.seconds ?? attack + options.tau * 5 + 0.01;
  const fundamental = new Oscillator(sampleRate);
  const upper = new Oscillator(sampleRate, 0.25);
  return Clip.render(sampleRate, seconds, (t) => {
    const x = Math.min(1, t / options.glideSeconds);
    const frequency = expLerp(options.fromHz, options.toHz, 1 - (1 - x) * (1 - x));
    const tone = fundamental.sine(frequency) + octave * upper.sine(frequency * 2);
    return tone * strike(t, attack, options.tau);
  }).fadeOut(TailFadeSeconds);
}

/** Optionen eines Plopps. */
export interface PlopOptions {
  readonly startHz: number;
  readonly endHz: number;
  /** Zeitkonstante des Tonhöhenabfalls. */
  readonly pitchTau: number;
  /** Abklingzeit der Lautstärke. */
  readonly tau: number;
  /** Anteil des Luftstoßes (Rauschen). */
  readonly puff: number;
  /** Anteil des Obertonklicks. */
  readonly overtone: number;
}

/** Plopp (Plopp): Sinus mit schnell fallender Tonhöhe, Obertonklick und Luftstoß — Korken, Kugeln, Blasen. */
export function plop(sampleRate: number, random: Random, options: PlopOptions): Clip {
  const body = new Oscillator(sampleRate);
  const over = new Oscillator(sampleRate, 0.4);
  const noise = new NoiseSource(random);
  const air = new StateVariableFilter(sampleRate);
  const seconds = options.tau * 6 + 0.012;
  return Clip.render(sampleRate, seconds, (t) => {
    const frequency = options.endHz + (options.startHz - options.endHz) * Math.exp(-t / options.pitchTau);
    const tone = body.sine(frequency) * strike(t, 0.0012, options.tau);
    const click = over.sine(frequency * 2.03) * strike(t, 0.0008, options.tau * 0.3) * options.overtone;
    const puff = air.lowpass(noise.white(), 2200, 0.7) * strike(t, 0.0008, 0.006) * options.puff;
    return tone + click + puff;
  }).fadeOut(TailFadeSeconds);
}

/** Holzklopfen (Klopfen): kurzes, resonantes Knacken mit hölzernem Grundton — Riegel, Wabe, Klick. */
export function woodTok(sampleRate: number, random: Random, frequency: number): Clip {
  const noise = new NoiseSource(random);
  const resonance = new StateVariableFilter(sampleRate);
  const fundamental = new Oscillator(sampleRate);
  const overtone = new Oscillator(sampleRate, 0.2);
  return Clip.render(sampleRate, 0.14, (t) => {
    const knock = resonance.bandpass(noise.white(), frequency * 1.3, 6) * strike(t, 0.0005, 0.012);
    const tone = fundamental.sine(frequency) * strike(t, 0.0008, 0.03) * 0.6;
    const ring = overtone.sine(frequency * 2.7) * strike(t, 0.0006, 0.009) * 0.25;
    return knock * 0.9 + tone + ring;
  }).fadeOut(TailFadeSeconds);
}

/** Optionen eines Luftzugs. */
export interface WhooshOptions {
  readonly seconds: number;
  readonly fromHz: number;
  readonly toHz: number;
  readonly q: number;
  /** Lautstärkeverlauf über die Zeit. */
  readonly envelope: (t: number) => number;
  /** Fortschritt der Bandmitte 0..1 über die Zeit; Standard linear über die Dauer. */
  readonly progress?: (t: number) => number;
  readonly pink?: boolean;
}

/** Luftzug (Luftzug): Rauschen durch einen wandernden Bandpass — Wind, Andocken, Warp. */
export function whoosh(sampleRate: number, random: Random, options: WhooshOptions): Clip {
  const noise = new NoiseSource(random);
  const band = new StateVariableFilter(sampleRate);
  const progress = options.progress ?? ((t: number) => t / options.seconds);
  return Clip.render(sampleRate, options.seconds, (t) => {
    const cutoff = expLerp(options.fromHz, options.toHz, Math.min(1, Math.max(0, progress(t))));
    const source = options.pink === true ? noise.pink() * 3 : noise.white();
    return band.bandpass(source, cutoff, options.q) * options.envelope(t);
  }).fadeOut(TailFadeSeconds);
}

/** Optionen eines Platschers. */
export interface SplatOptions {
  readonly seconds: number;
  /** Tiefpass zu Beginn und am Ende der Fahrt (Hz). */
  readonly brightHz: number;
  readonly darkHz: number;
  readonly sweepSeconds: number;
  /** Abklingzeit des Rauschschlags. */
  readonly tau: number;
  /** Schmatzende Resonanz: Start- und Endfrequenz. */
  readonly squelchFromHz: number;
  readonly squelchToHz: number;
  /** Tiefer Aufprall (Hz am Anschlag), 0 = keiner. */
  readonly thumpHz: number;
  readonly droplets: number;
}

/** Platsch (Platsch): nasser Rauschschlag mit schmatzender Resonanz und Tröpfchen — Spucke, Fliegentod. */
export function splat(sampleRate: number, random: Random, options: SplatOptions): Clip {
  const noise = new NoiseSource(random);
  const body = new StateVariableFilter(sampleRate);
  const squelch = new StateVariableFilter(sampleRate);
  const thump = new Oscillator(sampleRate);
  const clip = Clip.render(sampleRate, options.seconds, (t) => {
    const sweep = smoothstep(0, options.sweepSeconds, t);
    const white = noise.white();
    const wet = body.lowpass(white + noise.brown() * 0.8, expLerp(options.brightHz, options.darkHz, sweep), 1.1) * strike(t, 0.0015, options.tau);
    const squish = squelch.bandpass(white, expLerp(options.squelchFromHz, options.squelchToHz, smoothstep(0, options.sweepSeconds * 1.6, t)), 4.5);
    const low = options.thumpHz > 0 ? thump.sine(options.thumpHz * 0.45 + options.thumpHz * 0.55 * Math.exp(-t / 0.03)) * strike(t, 0.002, 0.07) : 0;
    return wet + squish * strike(t, 0.003, options.tau * 1.5) * 0.8 + low * 0.55;
  });
  for (let i = 0; i < options.droplets; i++) {
    const from = 450 + random.next() * 350;
    const droplet = chirpTone(sampleRate, { fromHz: from, toHz: from * (2.2 + random.next()), glideSeconds: 0.025, tau: 0.018 + random.next() * 0.012 });
    clip.mix(droplet, 0.04 + random.next() * (options.seconds * 0.5), 0.12 + random.next() * 0.22);
  }
  return clip.fadeOut(TailFadeSeconds * 2);
}

/** Optionen eines weichen Tons. */
export interface SoftToneOptions {
  readonly attack: number;
  readonly tau: number;
  readonly seconds?: number;
  /** Anteil des Dreiecks (wärmer, etwas hohler). */
  readonly warmth?: number;
  /** Vibratotiefe als Frequenzanteil und Rate in Hz. */
  readonly vibratoDepth?: number;
  readonly vibratoRate?: number;
}

/** Weicher Ton (Ton): Sinus mit Dreieck, weichem Einsatz und langem Abklingen — Akkorde, Hinweise. */
export function softTone(sampleRate: number, frequency: number, options: SoftToneOptions): Clip {
  const warmth = options.warmth ?? 0.3;
  const depth = options.vibratoDepth ?? 0;
  const rate = options.vibratoRate ?? 5;
  const seconds = options.seconds ?? options.attack + options.tau * 5 + 0.02;
  const sine = new Oscillator(sampleRate);
  const triangle = new Oscillator(sampleRate, 0.1);
  return Clip.render(sampleRate, seconds, (t) => {
    const f = frequency * (1 + depth * Math.sin(2 * Math.PI * rate * t) * smoothstep(0.05, 0.35, t));
    return ((1 - warmth) * sine.sine(f) + warmth * triangle.triangle(f)) * strike(t, options.attack, options.tau);
  }).fadeOut(TailFadeSeconds * 2);
}

/** Ein Ton eines Glitzerlaufs: MIDI-Tonhöhe, Einsatz in Sekunden, Pegel. */
export interface SparkleNote {
  readonly midi: number;
  readonly at: number;
  readonly gain: number;
}

/** Glitzerlauf (Glitzern): Folge heller Glockentöne — Sammeln, Ankunft, Belohnungen. */
export function sparkleRun(sampleRate: number, notes: readonly SparkleNote[], bell: BellOptions = {}): Clip {
  let end = 0;
  const tones = notes.map((note) => {
    const tone = bellTone(sampleRate, midiToHz(note.midi), bell);
    end = Math.max(end, note.at + tone.duration);
    return tone;
  });
  const clip = Clip.silence(sampleRate, end);
  tones.forEach((tone, i) => clip.mix(tone, notes[i].at, notes[i].gain));
  return clip;
}
