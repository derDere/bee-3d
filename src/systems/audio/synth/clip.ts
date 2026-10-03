// src/systems/audio/synth/clip.ts — Klangclip: Abtastwerte je Kanal mit Werkzeugen zum Mischen, Blenden,
// Schleifen und Einpegeln.
import { TwoPi } from "./dsp";

/** Pegelkennzahlen eines Clips (Pegel): Spitzenwert, Effektivwert und Kurzzeit-Lautheit. */
export interface ClipLevels {
  readonly peak: number;
  readonly rms: number;
  readonly loudness: number;
  readonly finite: boolean;
}

/** Abtastwert-Erzeuger für einen Monokanal: Zeit in Sekunden und Abtastindex → Wert. */
export type MonoSampler = (t: number, index: number) => number;

/** Ein Stereo-Abtastpaar, das ein Stereo-Erzeuger beschreibt. */
export interface StereoFrame {
  left: number;
  right: number;
}

/** Abtastwert-Erzeuger für Stereo: schreibt den Wert für Zeit t in frame. */
export type StereoSampler = (t: number, frame: StereoFrame, index: number) => void;

/** Fensterlänge der Kurzzeit-Lautheit in Sekunden. */
const LoudnessWindowSeconds = 0.4;
/** Hochpass vor der Lautheitsmessung: tiefe Anteile klingen leiser, als ihr Effektivwert vermuten lässt. */
const LoudnessHighpassHz = 150;

/** Erzeugter Klang als Abtastwerte je Kanal (Klangclip). */
export class Clip {
  public readonly sampleRate: number;
  public readonly channels: readonly Float32Array<ArrayBuffer>[];

  private constructor(sampleRate: number, channels: Float32Array<ArrayBuffer>[]) {
    this.sampleRate = sampleRate;
    this.channels = channels;
  }

  /** Stiller Clip der gegebenen Länge. */
  public static silence(sampleRate: number, seconds: number, channelCount = 1): Clip {
    const length = Math.max(1, Math.round(seconds * sampleRate));
    const channels: Float32Array<ArrayBuffer>[] = [];
    for (let c = 0; c < channelCount; c++) {
      channels.push(new Float32Array(length));
    }
    return new Clip(sampleRate, channels);
  }

  /** Rendert einen Monoclip Abtastung für Abtastung. */
  public static render(sampleRate: number, seconds: number, sampler: MonoSampler): Clip {
    const clip = Clip.silence(sampleRate, seconds, 1);
    const data = clip.channels[0];
    const step = 1 / sampleRate;
    for (let i = 0; i < data.length; i++) {
      data[i] = sampler(i * step, i);
    }
    return clip;
  }

  /** Rendert einen Stereoclip Abtastung für Abtastung. */
  public static renderStereo(sampleRate: number, seconds: number, sampler: StereoSampler): Clip {
    const clip = Clip.silence(sampleRate, seconds, 2);
    const left = clip.channels[0];
    const right = clip.channels[1];
    const frame: StereoFrame = { left: 0, right: 0 };
    const step = 1 / sampleRate;
    for (let i = 0; i < left.length; i++) {
      sampler(i * step, frame, i);
      left[i] = frame.left;
      right[i] = frame.right;
    }
    return clip;
  }

  /**
   * Rendert eine nahtlose Schleife aus einem periodischen Erzeuger: zwei Perioden entstehen, die zweite
   * bleibt. So sind Filter eingeschwungen und Ende und Anfang passen exakt aneinander. Alle Frequenzen und
   * Modulationen im Erzeuger müssen ganzzahlig oft in die Periode passen.
   */
  public static renderPeriodicLoop(sampleRate: number, periodSeconds: number, sampler: MonoSampler): Clip {
    const period = Math.round(periodSeconds * sampleRate);
    const full = Clip.render(sampleRate, (2 * period) / sampleRate, sampler);
    return new Clip(sampleRate, [full.channels[0].slice(period, 2 * period)]);
  }

  public get length(): number {
    return this.channels[0].length;
  }

  public get duration(): number {
    return this.length / this.sampleRate;
  }

  public get channelCount(): number {
    return this.channels.length;
  }

  /**
   * Mischt source ab atSeconds ein (Mischen). Ein Monoclip in Stereo verteilt sich mit gleicher Leistung
   * nach pan (−1 links … 1 rechts); was über das Ende hinausragt, entfällt.
   */
  public mix(source: Clip, atSeconds = 0, gain = 1, pan = 0): this {
    this.mixInternal(source, atSeconds, gain, pan, false);
    return this;
  }

  /** Wie mix, aber was über das Ende hinausragt, beginnt vorne (Umlauf für nahtlose Schleifen). */
  public mixWrapped(source: Clip, atSeconds: number, gain = 1, pan = 0): this {
    this.mixInternal(source, atSeconds, gain, pan, true);
    return this;
  }

  /** Verarbeitet jeden Kanal mit einem eigenen, zustandsbehafteten Prozessor (z. B. Filter). */
  public process(createProcessor: () => (value: number, t: number) => number): this {
    const step = 1 / this.sampleRate;
    for (const data of this.channels) {
      const processor = createProcessor();
      for (let i = 0; i < data.length; i++) {
        data[i] = processor(data[i], i * step);
      }
    }
    return this;
  }

  public scale(gain: number): this {
    for (const data of this.channels) {
      for (let i = 0; i < data.length; i++) {
        data[i] *= gain;
      }
    }
    return this;
  }

  /** Blendet die ersten seconds Sekunden mit einer Viertelsinus-Kurve ein. */
  public fadeIn(seconds: number): this {
    const count = Math.min(this.length, Math.round(seconds * this.sampleRate));
    for (const data of this.channels) {
      for (let i = 0; i < count; i++) {
        data[i] *= Math.sin((Math.PI / 2) * (i / count));
      }
    }
    return this;
  }

  /** Blendet die letzten seconds Sekunden mit einer Viertelsinus-Kurve aus. */
  public fadeOut(seconds: number): this {
    const count = Math.min(this.length, Math.round(seconds * this.sampleRate));
    const start = this.length - count;
    for (const data of this.channels) {
      for (let i = 0; i < count; i++) {
        data[start + i] *= Math.cos((Math.PI / 2) * ((i + 1) / count));
      }
    }
    return this;
  }

  /**
   * Schneidet eine nahtlose Schleife der Länge loopSeconds heraus (Schleife): der Anfang wird mit der
   * Fortsetzung hinter dem Schleifenende überblendet. Der Clip muss mindestens loopSeconds + crossfadeSeconds lang
   * sein.
   */
  public toLoop(loopSeconds: number, crossfadeSeconds: number): Clip {
    const loopLength = Math.round(loopSeconds * this.sampleRate);
    const fade = Math.min(Math.round(crossfadeSeconds * this.sampleRate), this.length - loopLength);
    if (fade <= 0) {
      throw new Error("toLoop: clip is shorter than loop plus crossfade.");
    }
    const channels = this.channels.map((data) => {
      const loop = data.slice(0, loopLength);
      for (let i = 0; i < fade; i++) {
        const x = i / fade;
        loop[i] = data[i] * Math.sin((Math.PI / 2) * x) + data[loopLength + i] * Math.cos((Math.PI / 2) * x);
      }
      return loop;
    });
    return new Clip(this.sampleRate, channels);
  }

  /**
   * Macht den Bereich [startSeconds, endSeconds) nahtlos schleifbar (Halteschleife): das Ende des Bereichs wird
   * in den Verlauf vor dem Bereichsanfang überblendet. Vor startSeconds muss mindestens crossfadeSeconds Signal
   * liegen; der Clip endet danach bei endSeconds.
   */
  public withSustainLoop(startSeconds: number, endSeconds: number, crossfadeSeconds: number): Clip {
    const start = Math.round(startSeconds * this.sampleRate);
    const end = Math.min(this.length, Math.round(endSeconds * this.sampleRate));
    const fade = Math.min(Math.round(crossfadeSeconds * this.sampleRate), start, end - start);
    const channels = this.channels.map((data) => {
      const result = data.slice(0, end);
      for (let i = 0; i < fade; i++) {
        const x = (i + 1) / fade;
        const index = end - fade + i;
        result[index] = data[index] * Math.cos((Math.PI / 2) * x) + data[start - fade + i] * Math.sin((Math.PI / 2) * x);
      }
      return result;
    });
    return new Clip(this.sampleRate, channels);
  }

  /** Misst Spitzenwert, Effektivwert und Kurzzeit-Lautheit; finite meldet NaN- oder Unendlich-Werte. */
  public measure(): ClipLevels {
    let peak = 0;
    let sum = 0;
    let finite = true;
    for (const data of this.channels) {
      for (let i = 0; i < data.length; i++) {
        const value = data[i];
        if (!Number.isFinite(value)) {
          finite = false;
          continue;
        }
        const magnitude = Math.abs(value);
        if (magnitude > peak) {
          peak = magnitude;
        }
        sum += value * value;
      }
    }
    const rms = Math.sqrt(sum / (this.length * this.channelCount));
    return { peak, rms, loudness: this.loudness(), finite };
  }

  /**
   * Kurzzeit-Lautheit (Lautheit): höchster Effektivwert über gleitende 0,4-s-Fenster nach einem 150-Hz-Hochpass,
   * gemittelt über die Kanäle. Kürzere Clips zählen als ein Fenster.
   */
  public loudness(): number {
    const length = this.length;
    const window = Math.max(1, Math.min(length, Math.round(LoudnessWindowSeconds * this.sampleRate)));
    const hop = Math.max(1, Math.round(window / 8));
    const coefficient = 1 - Math.exp((-TwoPi * LoudnessHighpassHz) / this.sampleRate);
    const prefix = new Float64Array(length + 1);
    const energy = new Float64Array(length);
    for (const data of this.channels) {
      let lowState = 0;
      for (let i = 0; i < length; i++) {
        lowState += coefficient * (data[i] - lowState);
        const high = data[i] - lowState;
        energy[i] += (high * high) / this.channelCount;
      }
    }
    for (let i = 0; i < length; i++) {
      prefix[i + 1] = prefix[i] + energy[i];
    }
    let best = 0;
    for (let start = 0; start + window <= length; start += hop) {
      best = Math.max(best, (prefix[start + window] - prefix[start]) / window);
    }
    best = Math.max(best, (prefix[length] - prefix[length - window]) / window);
    return Math.sqrt(best);
  }

  /** Pegelt auf eine Kurzzeit-Lautheit ein, ohne den Spitzenwert peakCeiling zu überschreiten. */
  public normalizeLoudness(targetLoudness: number, peakCeiling: number): this {
    const levels = this.measure();
    if (levels.loudness <= 1e-9 || levels.peak <= 1e-9) {
      return this;
    }
    const gain = Math.min(targetLoudness / levels.loudness, peakCeiling / levels.peak);
    return this.scale(gain);
  }

  /** Pegelt auf einen Spitzenwert ein. */
  public normalizePeak(target: number): this {
    const { peak } = this.measure();
    return peak > 1e-9 ? this.scale(target / peak) : this;
  }

  private mixInternal(source: Clip, atSeconds: number, gain: number, pan: number, wrap: boolean): void {
    if (source.sampleRate !== this.sampleRate) {
      throw new Error("Clip.mix: sample rates differ.");
    }
    const length = this.length;
    let offset = Math.round(atSeconds * this.sampleRate);
    if (wrap) {
      offset = ((offset % length) + length) % length;
    }
    const angle = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
    const monoToStereo = source.channelCount === 1 && this.channelCount === 2;
    for (let c = 0; c < this.channelCount; c++) {
      const target = this.channels[c];
      const input = source.channels[Math.min(c, source.channelCount - 1)];
      const channelGain = monoToStereo ? gain * (c === 0 ? Math.cos(angle) : Math.sin(angle)) : gain;
      for (let i = 0; i < input.length; i++) {
        let index = offset + i;
        if (wrap) {
          index %= length;
        } else if (index < 0) {
          continue;
        } else if (index >= length) {
          break;
        }
        target[index] += input[i] * channelGain;
      }
    }
  }
}
