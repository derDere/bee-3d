// src/systems/audio/flyDrone.ts — Brummen der nächsten Fliege: lauter, heller und bedrohlicher mit der Nähe; die
// Fliege kreist hörbar (wanderndes Panorama, leichtes Doppler-Wabern).
import { FlatLowpassQ, SmoothedParam, clamp01 } from "./audioParams";

/** Bis zu diesem Abstand volle Lautstärke (m). */
const NearDistance = 8;
/** Zwischen diesen Abständen verstummt das Brummen (m). */
const FadeStart = 110;
const FadeEnd = 160;
/** Pegel ganz nah. */
const NearLevel = 0.9;
/** Helligkeit nah und an der Hörgrenze (Hz). */
const NearBrightness = 6000;
const FarBrightness = 900;

/** Brummen der nächsten Fliege (Fliegenbrummen). */
export class FlyDrone {
  private readonly source: AudioBufferSourceNode;
  private readonly wobble: OscillatorNode;
  private readonly circling: OscillatorNode;
  private readonly nodes: AudioNode[];
  private readonly level: SmoothedParam;
  private readonly brightness: SmoothedParam;
  private readonly menace: SmoothedParam;

  public constructor(context: BaseAudioContext, buffer: AudioBuffer, output: AudioNode) {
    this.source = new AudioBufferSourceNode(context, { buffer, loop: true });
    const tone = new BiquadFilterNode(context, { type: "lowpass", Q: FlatLowpassQ });
    const gain = new GainNode(context);
    const panner = new StereoPannerNode(context);
    this.wobble = new OscillatorNode(context, { type: "sine", frequency: 0.37 });
    const wobbleDepth = new GainNode(context, { gain: 30 });
    this.circling = new OscillatorNode(context, { type: "sine", frequency: 0.21 });
    const circlingDepth = new GainNode(context, { gain: 0.45 });

    this.source.connect(tone).connect(gain).connect(panner).connect(output);
    this.wobble.connect(wobbleDepth).connect(this.source.detune);
    this.circling.connect(circlingDepth).connect(panner.pan);
    this.nodes = [this.source, tone, gain, panner, this.wobble, wobbleDepth, this.circling, circlingDepth];

    this.level = new SmoothedParam(context, gain.gain, 0, 0.15);
    this.brightness = new SmoothedParam(context, tone.frequency, FarBrightness, 0.2, 5);
    this.menace = new SmoothedParam(context, this.source.detune, 0, 0.3, 1);

    this.source.start();
    this.wobble.start();
    this.circling.start();
  }

  /** Abstand der nächsten Fliege in Metern; Infinity oder ungültig = keine Fliege. */
  public setDistance(distance: number): void {
    if (!(distance >= 0) || distance >= FadeEnd) {
      this.level.set(0);
      return;
    }
    const proximity = Math.pow(NearDistance / Math.max(distance, NearDistance), 0.85);
    const fade = 1 - clamp01((distance - FadeStart) / (FadeEnd - FadeStart));
    this.level.set(NearLevel * proximity * fade);
    this.brightness.set(FarBrightness * Math.pow(NearBrightness / FarBrightness, 1 - clamp01(distance / FadeStart)));
    // Ganz nah klingt die Fliege angriffslustig höher
    this.menace.set(60 * (1 - clamp01(distance / 15)));
  }

  public dispose(): void {
    this.source.stop();
    this.wobble.stop();
    this.circling.stop();
    for (const node of this.nodes) {
      node.disconnect();
    }
  }
}
