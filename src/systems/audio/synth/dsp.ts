// src/systems/audio/synth/dsp.ts — Bausteine der Klangsynthese: Oszillatoren, Rauschen, Filter und Hüllkurven.
// Alle Bausteine arbeiten Abtastung für Abtastung und sind frei von Web-Audio-Abhängigkeiten, damit die
// Klangbank auch im Worker entsteht.
import type { Random } from "../../../../shared/random";

/** Vollkreis im Bogenmaß. */
export const TwoPi = Math.PI * 2;

/** Begrenzt einen Wert auf [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Lineare Interpolation zwischen a und b. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Exponentielle Interpolation, gleichmäßig in Tonhöhe oder Frequenz; a und b sind positiv. */
export function expLerp(a: number, b: number, t: number): number {
  return a * Math.pow(b / a, t);
}

/** Weicher Übergang von 0 nach 1 zwischen edge0 und edge1 (Smoothstep). */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Frequenz eines MIDI-Tons in Hertz (Tonhöhe). */
export function midiToHz(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

/** Frequenzverhältnis eines Intervalls in Halbtönen (Intervall). */
export function semitones(count: number): number {
  return Math.pow(2, count / 12);
}

/** Exponentieller Abfall (Abklingkurve): 1 bei t = 0, 1/e nach tau Sekunden, 0 vor dem Einsatz. */
export function decay(t: number, tau: number): number {
  return t < 0 ? 0 : Math.exp(-t / tau);
}

/**
 * Anschlag-Hüllkurve (Anschlag): weicher Anstieg über attack Sekunden, danach exponentieller Abfall mit
 * der Zeitkonstante tau. Vor dem Einsatz 0.
 */
export function strike(t: number, attack: number, tau: number): number {
  if (t < 0) {
    return 0;
  }
  if (t < attack) {
    const x = t / attack;
    return x * x * (3 - 2 * x);
  }
  return Math.exp(-(t - attack) / tau);
}

/** Glockenförmiges Fenster zwischen start und end (Hann-Fenster); außerhalb 0. */
export function hann(t: number, start: number, end: number): number {
  if (t <= start || t >= end) {
    return 0;
  }
  const x = (t - start) / (end - start);
  return 0.5 - 0.5 * Math.cos(TwoPi * x);
}

/** Sanfte Sättigung mit Pegelausgleich (Sättigung): drive > 0, Vollaussteuerung bleibt bei 1. */
export function saturate(x: number, drive: number): number {
  return Math.tanh(x * drive) / Math.tanh(drive);
}

/** Korrekturterm der PolyBLEP-Kantenglättung für einen Sprung der Höhe 2 bei Phase 0. */
function polyBlep(phase: number, increment: number): number {
  if (phase < increment) {
    const x = phase / increment;
    return x + x - x * x - 1;
  }
  if (phase > 1 - increment) {
    const x = (phase - 1) / increment;
    return x * x + x + x + 1;
  }
  return 0;
}

/**
 * Phasenoszillator (Oszillator): Sinus, Dreieck sowie bandbegrenzte Säge und Rechteck (PolyBLEP).
 * Jeder Aufruf rückt die Phase um eine Abtastung vor; die Frequenz darf sich je Abtastung ändern.
 */
export class Oscillator {
  private phase: number;
  private readonly sampleDuration: number;

  public constructor(sampleRate: number, startPhase = 0) {
    this.sampleDuration = 1 / sampleRate;
    this.phase = startPhase - Math.floor(startPhase);
  }

  /** Sinus; phaseModulation verschiebt die Phase in Radiant (Phasenmodulation für FM-Klänge). */
  public sine(frequency: number, phaseModulation = 0): number {
    return Math.sin(TwoPi * this.step(frequency) + phaseModulation);
  }

  /** Dreieck, phasengleich zum Sinus. */
  public triangle(frequency: number): number {
    const shifted = this.step(frequency) + 0.25;
    return 1 - 4 * Math.abs(shifted - Math.floor(shifted) - 0.5);
  }

  /** Bandbegrenzte Sägezahnschwingung. */
  public saw(frequency: number): number {
    const increment = Math.abs(frequency) * this.sampleDuration;
    const phase = this.step(frequency);
    return 2 * phase - 1 - polyBlep(phase, increment);
  }

  /** Bandbegrenzte Pulsschwingung mit Tastverhältnis duty (0,5 = Rechteck). */
  public pulse(frequency: number, duty = 0.5): number {
    const increment = Math.abs(frequency) * this.sampleDuration;
    const phase = this.step(frequency);
    let value = phase < duty ? 1 : -1;
    value += polyBlep(phase, increment);
    const shifted = phase - duty;
    value -= polyBlep(shifted < 0 ? shifted + 1 : shifted, increment);
    return value;
  }

  /** Liefert die aktuelle Phase (0..1) und rückt sie um eine Abtastung vor. */
  private step(frequency: number): number {
    const phase = this.phase;
    const next = phase + frequency * this.sampleDuration;
    this.phase = next - Math.floor(next);
    return phase;
  }
}

/** Seedbare Rauschquelle (Rauschen): weißes, rosa und braunes Rauschen. */
export class NoiseSource {
  private readonly random: Random;
  private pink0 = 0;
  private pink1 = 0;
  private pink2 = 0;
  private brownState = 0;

  public constructor(random: Random) {
    this.random = random;
  }

  /** Weißes Rauschen, gleichverteilt auf [-1, 1). */
  public white(): number {
    return this.random.next() * 2 - 1;
  }

  /** Rosa Rauschen (−3 dB je Oktave) nach Paul Kellet; Effektivwert etwa 0,3. */
  public pink(): number {
    const white = this.white();
    this.pink0 = 0.99765 * this.pink0 + white * 0.099046;
    this.pink1 = 0.963 * this.pink1 + white * 0.2965164;
    this.pink2 = 0.57 * this.pink2 + white * 1.0526913;
    return (this.pink0 + this.pink1 + this.pink2 + white * 0.1848) * 0.2;
  }

  /** Braunes Rauschen (−6 dB je Oktave), leckend integriert; Effektivwert etwa 0,2. */
  public brown(): number {
    this.brownState = (this.brownState + 0.02 * this.white()) / 1.02;
    return this.brownState * 3.5;
  }
}

/**
 * Zustandsvariablenfilter nach Zavalishin (TPT-SVF, Filter): Tief-, Band- und Hochpass in einem, stabil bei
 * Modulation der Grenzfrequenz je Abtastung. Der Bandpass ist auf Verstärkung 1 in der Bandmitte normiert.
 */
export class StateVariableFilter {
  private readonly sampleRate: number;
  private readonly maxCutoff: number;
  private ic1 = 0;
  private ic2 = 0;
  private lastCutoff = -1;
  private lastQ = -1;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private k = 1;
  private low = 0;
  private band = 0;
  private high = 0;

  public constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.maxCutoff = sampleRate * 0.49;
  }

  public lowpass(input: number, cutoff: number, q = Math.SQRT1_2): number {
    this.process(input, cutoff, q);
    return this.low;
  }

  public bandpass(input: number, cutoff: number, q: number): number {
    this.process(input, cutoff, q);
    return this.band * this.k;
  }

  public highpass(input: number, cutoff: number, q = Math.SQRT1_2): number {
    this.process(input, cutoff, q);
    return this.high;
  }

  private process(input: number, cutoff: number, q: number): void {
    if (cutoff !== this.lastCutoff || q !== this.lastQ) {
      this.updateCoefficients(cutoff, q);
    }
    const v3 = input - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.low = v2;
    this.band = v1;
    this.high = input - this.k * v1 - v2;
  }

  private updateCoefficients(cutoff: number, q: number): void {
    this.lastCutoff = cutoff;
    this.lastQ = q;
    const g = Math.tan((Math.PI * clamp(cutoff, 5, this.maxCutoff)) / this.sampleRate);
    this.k = 1 / Math.max(q, 0.05);
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
}

/** Einpoliger Tief- und Hochpass (Einpolfilter) für Glättung und sanfte Klangfärbung. */
export class OnePole {
  private readonly sampleRate: number;
  private state = 0;
  private coefficient = 0;
  private lastCutoff = -1;

  public constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  public lowpass(input: number, cutoff: number): number {
    if (cutoff !== this.lastCutoff) {
      this.lastCutoff = cutoff;
      this.coefficient = 1 - Math.exp((-TwoPi * cutoff) / this.sampleRate);
    }
    this.state += this.coefficient * (input - this.state);
    return this.state;
  }

  public highpass(input: number, cutoff: number): number {
    return input - this.lowpass(input, cutoff);
  }
}

/** Rückgekoppelte Verzögerung mit gedämpften Wiederholungen (Echo). */
export class EchoLine {
  private readonly sampleRate: number;
  private readonly buffer: Float32Array;
  private readonly damping: OnePole;
  private writeIndex = 0;

  public constructor(sampleRate: number, maxSeconds: number) {
    this.sampleRate = sampleRate;
    this.buffer = new Float32Array(Math.max(2, Math.ceil(maxSeconds * sampleRate)));
    this.damping = new OnePole(sampleRate);
  }

  /** Schreibt input ein und liefert die verzögerte Wiederholung. */
  public process(input: number, delaySeconds: number, feedback: number, dampingCutoff: number): number {
    const size = this.buffer.length;
    const delaySamples = clamp(Math.round(delaySeconds * this.sampleRate), 1, size - 1);
    let readIndex = this.writeIndex - delaySamples;
    if (readIndex < 0) {
      readIndex += size;
    }
    const delayed = this.damping.lowpass(this.buffer[readIndex], dampingCutoff);
    this.buffer[this.writeIndex] = input + delayed * feedback;
    this.writeIndex = (this.writeIndex + 1) % size;
    return delayed;
  }
}

/** Funkenauslöser (Knistern): zufällige, kurz abklingende Impulse mit wählbarer Rate je Sekunde. */
export class Crackle {
  private readonly random: Random;
  private readonly noise: NoiseSource;
  private readonly sampleDuration: number;
  private readonly decayFactor: number;
  private level = 0;

  public constructor(sampleRate: number, random: Random, sparkSeconds = 0.0015) {
    this.random = random;
    this.noise = new NoiseSource(random);
    this.sampleDuration = 1 / sampleRate;
    this.decayFactor = Math.exp(-1 / (sparkSeconds * sampleRate));
  }

  /** Nächste Abtastung bei rate Funken je Sekunde. */
  public next(rate: number): number {
    if (this.random.next() < rate * this.sampleDuration) {
      this.level = 0.4 + 0.6 * this.random.next();
    }
    this.level *= this.decayFactor;
    return this.noise.white() * this.level;
  }
}
