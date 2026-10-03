// src/systems/audio/ambience.ts — Umgebungsklang: Wind, Regen, sanfte Tagesfläche und Nachtstimmung mit Grillen.
// Alles läuft als Echtzeit-Graph aus Schleifen und Oszillatoren; langsame LFOs lassen Böen und Flächen atmen.
import { FlatLowpassQ, SmoothedParam, clamp01 } from "./audioParams";
import type { SoundBank } from "./soundBank";

/** Gemeinsame Verwaltung der Knoten einer Schicht (Knotenliste). */
class NodeSet {
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];

  public add<T extends AudioNode>(node: T): T {
    this.nodes.push(node);
    if (node instanceof AudioScheduledSourceNode) {
      this.sources.push(node);
    }
    return node;
  }

  public dispose(): void {
    for (const source of this.sources) {
      source.stop();
    }
    for (const node of this.nodes) {
      node.disconnect();
    }
  }
}

/** Startet eine Pufferschleife ab einem Versatz (Versatz und Rate entkoppeln mehrere Schichten desselben Puffers). */
function startLoop(context: BaseAudioContext, nodes: NodeSet, buffer: AudioBuffer, offset: number, rate: number): AudioBufferSourceNode {
  const source = nodes.add(new AudioBufferSourceNode(context, { buffer, loop: true, playbackRate: rate }));
  source.start(context.currentTime, offset % buffer.duration);
  return source;
}

/** Hängt einen langsamen Sinus-LFO mit Tiefe depth an einen AudioParam. */
function attachLfo(context: BaseAudioContext, nodes: NodeSet, frequency: number, depth: number, target: AudioParam, phaseSeconds = 0): void {
  const oscillator = nodes.add(new OscillatorNode(context, { type: "sine", frequency }));
  const gain = nodes.add(new GainNode(context, { gain: depth }));
  oscillator.connect(gain).connect(target);
  oscillator.start(context.currentTime + phaseSeconds);
}

/** Wind (Wind): Brise im Mittenband, heller Fahrtwind und leises Heulen, gemeinsam von Böen bewegt. */
class WindLayer {
  private readonly nodes = new NodeSet();
  private readonly breezeLevel: SmoothedParam;
  private readonly breezeCenter: SmoothedParam;
  private readonly rushLevel: SmoothedParam;
  private readonly rushCutoff: SmoothedParam;
  private readonly howlLevel: SmoothedParam;
  private readonly howlCenter: SmoothedParam;

  public constructor(context: BaseAudioContext, noise: AudioBuffer, output: AudioNode) {
    const n = this.nodes;
    const gust = n.add(new GainNode(context, { gain: 1 }));
    gust.connect(output);
    attachLfo(context, n, 0.09, 0.3, gust.gain);
    attachLfo(context, n, 0.153, 0.2, gust.gain, 2.1);

    const breezeBand = n.add(new BiquadFilterNode(context, { type: "bandpass", Q: 0.6 }));
    const breeze = n.add(new GainNode(context));
    startLoop(context, n, noise, 0, 1).connect(breezeBand).connect(breeze).connect(gust);

    const rushHigh = n.add(new BiquadFilterNode(context, { type: "highpass", frequency: 900, Q: FlatLowpassQ }));
    const rushLow = n.add(new BiquadFilterNode(context, { type: "lowpass", Q: FlatLowpassQ }));
    const rush = n.add(new GainNode(context));
    startLoop(context, n, noise, 1.3, 1.07).connect(rushHigh).connect(rushLow).connect(rush).connect(gust);

    const howlBand = n.add(new BiquadFilterNode(context, { type: "bandpass", Q: 9 }));
    const howl = n.add(new GainNode(context));
    attachLfo(context, n, 0.071, 90, howlBand.frequency);
    startLoop(context, n, noise, 2.1, 0.93).connect(howlBand).connect(howl).connect(output);

    this.breezeLevel = new SmoothedParam(context, breeze.gain, 0.05, 0.35);
    this.breezeCenter = new SmoothedParam(context, breezeBand.frequency, 350, 0.35, 2);
    this.rushLevel = new SmoothedParam(context, rush.gain, 0, 0.35);
    this.rushCutoff = new SmoothedParam(context, rushLow.frequency, 1200, 0.35, 5);
    this.howlLevel = new SmoothedParam(context, howl.gain, 0, 0.35);
    this.howlCenter = new SmoothedParam(context, howlBand.frequency, 520, 0.35, 2);
  }

  public set(wind01: number): void {
    const wind = clamp01(wind01);
    this.breezeLevel.set(0.06 + 0.4 * wind);
    this.breezeCenter.set(350 + 550 * wind);
    this.rushLevel.set(1.2 * Math.pow(wind, 1.6));
    this.rushCutoff.set(1200 + 6000 * wind * wind);
    this.howlLevel.set(0.14 * Math.pow(wind, 1.5));
    this.howlCenter.set(520 + 380 * wind);
  }

  public dispose(): void {
    this.nodes.dispose();
  }
}

/** Regen (Regen): Rauschen der Regenwand, prasselnde Tropfen und bei Starkregen ein tiefes Tosen. */
class RainLayer {
  private readonly nodes = new NodeSet();
  private readonly hissLevel: SmoothedParam;
  private readonly patterLevel: SmoothedParam;
  private readonly roarLevel: SmoothedParam;

  public constructor(context: BaseAudioContext, noise: AudioBuffer, patter: AudioBuffer, output: AudioNode) {
    const n = this.nodes;
    const hissHigh = n.add(new BiquadFilterNode(context, { type: "highpass", frequency: 500, Q: FlatLowpassQ }));
    const hissLow = n.add(new BiquadFilterNode(context, { type: "lowpass", frequency: 7500, Q: FlatLowpassQ }));
    const hiss = n.add(new GainNode(context));
    startLoop(context, n, noise, 0.7, 1.03).connect(hissHigh).connect(hissLow).connect(hiss).connect(output);

    const drops = n.add(new GainNode(context));
    startLoop(context, n, patter, 0, 1).connect(drops).connect(output);

    const roarLow = n.add(new BiquadFilterNode(context, { type: "lowpass", frequency: 260, Q: FlatLowpassQ }));
    const roar = n.add(new GainNode(context));
    startLoop(context, n, noise, 1.9, 0.97).connect(roarLow).connect(roar).connect(output);

    this.hissLevel = new SmoothedParam(context, hiss.gain, 0, 0.8);
    this.patterLevel = new SmoothedParam(context, drops.gain, 0, 0.8);
    this.roarLevel = new SmoothedParam(context, roar.gain, 0, 0.8);
  }

  public set(rain01: number): void {
    const rain = clamp01(rain01);
    this.hissLevel.set(0.45 * Math.pow(rain, 1.2));
    this.patterLevel.set(0.6 * Math.pow(rain, 0.7));
    this.roarLevel.set(0.45 * rain * rain);
  }

  public dispose(): void {
    this.nodes.dispose();
  }
}

/** Ein Ton der Tagesfläche: Frequenz, Wellenform und Atemrate. */
interface PadVoice {
  readonly frequency: number;
  readonly type: OscillatorType;
  readonly breathHz: number;
}

/** Tagesfläche in D-Dur (D3, A3, Fis4, E5): jeder Ton atmet mit eigenem, langsamem Rhythmus. */
const DayPadVoices: readonly PadVoice[] = [
  { frequency: 146.83, type: "triangle", breathHz: 0.05 },
  { frequency: 220, type: "triangle", breathHz: 0.067 },
  { frequency: 369.99, type: "sine", breathHz: 0.083 },
  { frequency: 659.26, type: "sine", breathHz: 0.11 },
];
/** Pegel der Tagesfläche: deutlich unter allem anderen. */
const DayPadLevel = 0.018;

/** Sanfte Tagesfläche (Tagesstimmung). */
class DayPad {
  private readonly nodes = new NodeSet();
  private readonly level: SmoothedParam;

  public constructor(context: BaseAudioContext, output: AudioNode) {
    const n = this.nodes;
    const filter = n.add(new BiquadFilterNode(context, { type: "lowpass", frequency: 1500, Q: FlatLowpassQ }));
    const level = n.add(new GainNode(context, { gain: 0 }));
    filter.connect(level).connect(output);
    DayPadVoices.forEach((voice, index) => {
      const breath = n.add(new GainNode(context, { gain: 0.5 }));
      breath.connect(filter);
      attachLfo(context, n, voice.breathHz, 0.45, breath.gain, index * 1.7);
      for (const detune of [-4, 4]) {
        const oscillator = n.add(new OscillatorNode(context, { type: voice.type, frequency: voice.frequency, detune }));
        oscillator.connect(breath);
        oscillator.start();
      }
    });
    this.level = new SmoothedParam(context, level.gain, 0, 2);
  }

  public set(day01: number): void {
    this.level.set(DayPadLevel * clamp01(day01));
  }

  public dispose(): void {
    this.nodes.dispose();
  }
}

/** Nachtstimmung (Nachtstimmung): Grillen und ein tiefer, warmer Brummton. */
class NightLayer {
  private readonly nodes = new NodeSet();
  private readonly cricketLevel: SmoothedParam;
  private readonly droneLevel: SmoothedParam;

  public constructor(context: BaseAudioContext, crickets: AudioBuffer, output: AudioNode) {
    const n = this.nodes;
    const chirps = n.add(new GainNode(context));
    startLoop(context, n, crickets, 0, 1).connect(chirps).connect(output);

    const droneFilter = n.add(new BiquadFilterNode(context, { type: "lowpass", frequency: 400, Q: FlatLowpassQ }));
    const swell = n.add(new GainNode(context, { gain: 0.6 }));
    const drone = n.add(new GainNode(context));
    swell.connect(droneFilter).connect(drone).connect(output);
    attachLfo(context, n, 0.04, 0.35, swell.gain);
    for (const frequency of [73.42, 110]) {
      const oscillator = n.add(new OscillatorNode(context, { type: "sine", frequency }));
      oscillator.connect(swell);
      oscillator.start();
    }
    this.cricketLevel = new SmoothedParam(context, chirps.gain, 0, 2);
    this.droneLevel = new SmoothedParam(context, drone.gain, 0, 2);
  }

  public set(night01: number): void {
    const night = clamp01(night01);
    this.cricketLevel.set(0.5 * smooth(0.3, 0.9, night));
    this.droneLevel.set(0.025 * smooth(0.4, 1, night));
  }

  public dispose(): void {
    this.nodes.dispose();
  }
}

function smooth(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Umgebungsklang (Umgebung): Wind, Regen sowie Tag- und Nachtstimmung über einem gemeinsamen Ausgang. */
export class Ambience {
  private readonly wind: WindLayer;
  private readonly rain: RainLayer;
  private readonly day: DayPad;
  private readonly night: NightLayer;

  public constructor(context: BaseAudioContext, bank: SoundBank, output: AudioNode) {
    const noise = bank.get("noiseBed");
    this.wind = new WindLayer(context, noise, output);
    this.rain = new RainLayer(context, noise, bank.get("rainPatter"), output);
    this.day = new DayPad(context, output);
    this.night = new NightLayer(context, bank.get("crickets"), output);
    this.setWeather(0, 0);
    this.setNight(0);
  }

  /** Wind 0..1 und Regen 0..1. */
  public setWeather(wind01: number, rain01: number): void {
    this.wind.set(wind01);
    this.rain.set(rain01);
  }

  /** 0 = Tag, 1 = Nacht; Morgen und Abend mischen beide Stimmungen. */
  public setNight(night01: number): void {
    const night = clamp01(night01);
    this.day.set(1 - smooth(0.2, 0.8, night));
    this.night.set(night);
  }

  public dispose(): void {
    this.wind.dispose();
    this.rain.dispose();
    this.day.dispose();
    this.night.dispose();
  }
}
