// src/systems/audio/voices.ts — Stimmen und Stimmen-Pools für Einzelklänge.
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { FlatLowpassQ } from "./audioParams";

/** Raumlage einer Stimme: Position, Abstandsdämpfung und Luftdämpfung (Raumlage). */
export interface VoiceSpatial {
  readonly position: Vector3;
  readonly refDistance: number;
  readonly rolloff: number;
  /** Grenzfrequenz der Luftdämpfung in Hz. */
  readonly airCutoff: number;
}

/** Hall-Anteil einer Stimme (Hall-Send). */
export interface VoiceReverb {
  readonly node: AudioNode;
  readonly amount: number;
}

/** Auftrag an eine Stimme (Stimmauftrag). */
export interface VoiceRequest {
  readonly buffer: AudioBuffer;
  /** Startzeit im Audiokontext (Sekunden). */
  readonly when: number;
  readonly gain: number;
  readonly detuneCents: number;
  readonly destination: AudioNode;
  readonly spatial?: VoiceSpatial;
  readonly reverb?: VoiceReverb;
}

/** Ausblendzeit einer verdrängten Stimme in Sekunden. */
const StealFadeSeconds = 0.03;

/**
 * Eine klingende Stimme (Stimme): Pufferquelle → Luftfilter → Panner → Pegel, optional mit Hall-Send.
 * Pufferquellen sind in Web Audio Einwegknoten; eine Stimme lebt daher genau einen Abspielvorgang und gibt danach
 * alle Knoten frei.
 */
export class Voice {
  private readonly source: AudioBufferSourceNode;
  private readonly level: GainNode;
  private readonly nodes: AudioNode[];
  private finished = false;
  private onFinished: (() => void) | null = null;

  public constructor(context: BaseAudioContext, request: VoiceRequest) {
    this.source = new AudioBufferSourceNode(context, { buffer: request.buffer, detune: request.detuneCents });
    this.level = new GainNode(context, { gain: request.gain });
    this.nodes = [this.source, this.level];
    let tail: AudioNode = this.source;
    if (request.spatial !== undefined) {
      const { position, refDistance, rolloff, airCutoff } = request.spatial;
      const air = new BiquadFilterNode(context, { type: "lowpass", frequency: airCutoff, Q: FlatLowpassQ });
      const panner = new PannerNode(context, {
        panningModel: "equalpower",
        distanceModel: "inverse",
        refDistance,
        rolloffFactor: rolloff,
        maxDistance: 100000,
        positionX: position.x,
        positionY: position.y,
        positionZ: position.z,
      });
      tail.connect(air).connect(panner);
      tail = panner;
      this.nodes.push(air, panner);
    }
    tail.connect(this.level).connect(request.destination);
    if (request.reverb !== undefined && request.reverb.amount > 0) {
      const send = new GainNode(context, { gain: request.reverb.amount });
      this.level.connect(send).connect(request.reverb.node);
      this.nodes.push(send);
    }
    this.source.onended = () => this.release();
    this.source.start(request.when);
  }

  /** Meldet das Ende der Stimme genau einmal. */
  public whenFinished(callback: () => void): void {
    this.onFinished = callback;
  }

  /** Blendet die Stimme kurz aus und beendet sie (Stimmenraub). */
  public fadeOut(now: number): void {
    const gain = this.level.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + StealFadeSeconds);
    this.source.stop(now + StealFadeSeconds + 0.005);
  }

  /** Beendet die Stimme sofort und gibt alle Knoten frei. */
  public dispose(): void {
    if (!this.finished) {
      this.source.stop();
    }
    this.release();
  }

  private release(): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.source.onended = null;
    for (const node of this.nodes) {
      node.disconnect();
    }
    this.onFinished?.();
  }
}

/** Begrenzte Menge gleichzeitiger Stimmen einer Klangart (Stimmen-Pool): ist er voll, weicht die älteste Stimme. */
export class VoicePool {
  public readonly maxVoices: number;
  private readonly voices: Voice[] = [];
  private lastStart = -Infinity;

  public constructor(maxVoices: number) {
    this.maxVoices = Math.max(1, maxVoices);
  }

  public get activeCount(): number {
    return this.voices.length;
  }

  /** Sekunden seit dem letzten Start einer Stimme dieses Pools. */
  public sinceLastStart(now: number): number {
    return now - this.lastStart;
  }

  /** Macht Platz für eine neue Stimme, indem die ältesten Stimmen ausgeblendet werden. */
  public makeRoom(now: number): void {
    while (this.voices.length >= this.maxVoices) {
      this.voices.shift()?.fadeOut(now);
    }
  }

  public add(voice: Voice, now: number): void {
    this.voices.push(voice);
    this.lastStart = now;
    voice.whenFinished(() => {
      const index = this.voices.indexOf(voice);
      if (index >= 0) {
        this.voices.splice(index, 1);
      }
    });
  }

  public dispose(): void {
    for (const voice of this.voices.splice(0)) {
      voice.dispose();
    }
  }
}

/** Legt je Katalogeintrag einen Stimmen-Pool an. */
export function createPools<K extends string>(catalog: Readonly<Record<K, { readonly maxVoices: number }>>): Record<K, VoicePool> {
  const pools = {} as Record<K, VoicePool>;
  for (const key of Object.keys(catalog) as K[]) {
    pools[key] = new VoicePool(catalog[key].maxVoices);
  }
  return pools;
}
