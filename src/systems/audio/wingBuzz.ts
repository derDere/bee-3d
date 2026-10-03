// src/systems/audio/wingBuzz.ts — Flügelsummen der eigenen Biene: Tonhöhe, Lautstärke und Helligkeit folgen dem
// Tempo; als Geist klingt das Summen hohl (Kammfilter) und verhallt.
import { FlatLowpassQ, SmoothedParam, clamp01 } from "./audioParams";

/** Abspielrate bei Stillstand und Höchsttempo (Tonhöhe des Summens). */
const IdleRate = 0.82;
const FullRate = 1.32;
/** Pegel bei Stillstand und Höchsttempo. */
const IdleLevel = 0.28;
const FullLevel = 0.62;
/** Helligkeit (Tiefpass) bei Stillstand und Höchsttempo in Hz. */
const IdleBrightness = 1700;
const FullBrightness = 6500;
/** Geisterklang: Verstimmung, Wabern, Röhrenresonanz und Hallanteil. */
const GhostDetuneCents = -140;
const GhostWobbleCents = 35;
const GhostCombSeconds = 0.0075;
const GhostFeedback = 0.6;
const GhostReverb = 0.9;
/** Pegel des Geisterpfads: Bandpass und Kammfilter dünnen das Summen aus, der Pegel gleicht das aus. */
const GhostLevel = 1.2;

/** Flügelsummen der eigenen Biene (Flügelsummen). */
export class WingBuzz {
  private readonly source: AudioBufferSourceNode;
  private readonly wobble: OscillatorNode;
  private readonly nodes: AudioNode[];
  private readonly rate: SmoothedParam;
  private readonly brightness: SmoothedParam;
  private readonly loudness: SmoothedParam;
  private readonly dryLevel: SmoothedParam;
  private readonly ghostLevel: SmoothedParam;
  private readonly ghostDetune: SmoothedParam;
  private readonly wobbleDepth: SmoothedParam;

  public constructor(context: BaseAudioContext, buffer: AudioBuffer, output: AudioNode, reverbSend: AudioNode) {
    this.source = new AudioBufferSourceNode(context, { buffer, loop: true });
    const tone = new BiquadFilterNode(context, { type: "lowpass", Q: FlatLowpassQ });
    const level = new GainNode(context);
    const dry = new GainNode(context);
    const ghostBand = new BiquadFilterNode(context, { type: "bandpass", frequency: 700, Q: 1.4 });
    const ghostDelay = new DelayNode(context, { delayTime: GhostCombSeconds, maxDelayTime: 0.05 });
    const ghostFeedback = new GainNode(context, { gain: GhostFeedback });
    const ghost = new GainNode(context);
    const ghostSend = new GainNode(context, { gain: GhostReverb });
    this.wobble = new OscillatorNode(context, { type: "sine", frequency: 0.9 });
    const wobbleGain = new GainNode(context);

    this.source.connect(tone).connect(level);
    level.connect(dry).connect(output);
    level.connect(ghostBand);
    ghostBand.connect(ghost);
    ghostBand.connect(ghostDelay);
    ghostDelay.connect(ghostFeedback).connect(ghostDelay);
    ghostDelay.connect(ghost);
    ghost.connect(output);
    ghost.connect(ghostSend).connect(reverbSend);
    this.wobble.connect(wobbleGain).connect(this.source.detune);
    this.nodes = [this.source, tone, level, dry, ghostBand, ghostDelay, ghostFeedback, ghost, ghostSend, this.wobble, wobbleGain];

    this.rate = new SmoothedParam(context, this.source.playbackRate, IdleRate, 0.08, 0.002);
    this.brightness = new SmoothedParam(context, tone.frequency, IdleBrightness, 0.1, 5);
    this.loudness = new SmoothedParam(context, level.gain, IdleLevel, 0.08);
    this.dryLevel = new SmoothedParam(context, dry.gain, 1, 0.25);
    this.ghostLevel = new SmoothedParam(context, ghost.gain, 0, 0.25);
    this.ghostDetune = new SmoothedParam(context, this.source.detune, 0, 0.3, 0.5);
    this.wobbleDepth = new SmoothedParam(context, wobbleGain.gain, 0, 0.3, 0.5);

    this.source.start();
    this.wobble.start();
  }

  /** Tempo 0..1 (Stillstand bis Höchsttempo) und Geisterzustand. */
  public set(speed01: number, ghost: boolean): void {
    const speed = clamp01(speed01);
    this.rate.set(IdleRate + (FullRate - IdleRate) * speed);
    this.brightness.set(IdleBrightness * Math.pow(FullBrightness / IdleBrightness, speed));
    this.loudness.set((IdleLevel + (FullLevel - IdleLevel) * Math.pow(speed, 0.8)) * (ghost ? 0.85 : 1));
    this.dryLevel.set(ghost ? 0 : 1);
    this.ghostLevel.set(ghost ? GhostLevel : 0);
    this.ghostDetune.set(ghost ? GhostDetuneCents : 0);
    this.wobbleDepth.set(ghost ? GhostWobbleCents : 0);
  }

  public dispose(): void {
    this.source.stop();
    this.wobble.stop();
    for (const node of this.nodes) {
      node.disconnect();
    }
  }
}
