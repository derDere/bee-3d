// src/systems/audio/mixer.ts — Mischpult des Tonsystems: Busse für Welt, Umgebung, Oberfläche und Musik,
// Wolkenfilter, Raumhall sowie Kompressor und Limiter am Master.
import { FlatLowpassQ, SmoothedParam, clamp01 } from "./audioParams";

/** Grenzfrequenz des Wolkenfilters außerhalb und tief in einer Wolke (Hz). */
const ClearCutoff = 20000;
const CloudCutoff = 900;
/** In dichter Wolke klingt die Welt etwas leiser. */
const CloudDip = 0.18;
/** Musikanteil am Raumhall (nach dem Musikregler). */
const MusicReverbSend = 0.3;
/** Pegel des Hallrückwegs. */
const ReverbReturn = 0.55;
/**
 * Vorpegel vor dem Kompressor: gleicht die automatische Aufholverstärkung von DynamicsCompressorNode aus, damit
 * leise Passagen den Master mit etwa Verstärkung 1 durchlaufen.
 */
const PreMasterGain = 0.5;

/**
 * Mischpult (Mischpult). Signalfluss:
 * Welt + Umgebung → Wolkenfilter ─┐
 * Oberfläche ─────────────────────┼→ Vorpegel → Kompressor → Limiter → Ausgang (an Babylon)
 * Musik-Bus ──────────────────────┤
 * Hall-Send → Raumhall ───────────┘
 */
export class AudioMixer {
  /** Raumklänge, eigenes Flügelsummen und Fliegenbrummen. */
  public readonly world: GainNode;
  /** Wind, Regen, Tag- und Nachtstimmung. */
  public readonly ambience: GainNode;
  /** Oberflächenklänge (ohne Wolkenfilter). */
  public readonly ui: GainNode;
  /** Musik-Bus: sein Pegel ist die Musiklautstärke. */
  public readonly music: GainNode;
  /** Eingang des Raumhalls. */
  public readonly reverbSend: GainNode;
  /** Ausgang des Mischpults; Babylon übernimmt ihn als Tonquelle. */
  public readonly output: GainNode;
  /** Abgriff hinter dem Limiter für Pegelmessungen. */
  public readonly meterTap: AudioNode;
  private readonly nodes: AudioNode[];
  private readonly cloudCutoff: SmoothedParam;
  private readonly cloudLevel: SmoothedParam;
  private readonly musicLevel: SmoothedParam;

  public constructor(context: BaseAudioContext, reverbImpulse: AudioBuffer) {
    this.world = new GainNode(context);
    this.ambience = new GainNode(context);
    this.ui = new GainNode(context);
    this.music = new GainNode(context);
    this.reverbSend = new GainNode(context);
    this.output = new GainNode(context);
    const cloudFilter = new BiquadFilterNode(context, { type: "lowpass", frequency: ClearCutoff, Q: FlatLowpassQ });
    const cloudGain = new GainNode(context);
    const musicSend = new GainNode(context, { gain: MusicReverbSend });
    const reverb = new ConvolverNode(context, { buffer: reverbImpulse });
    const reverbReturn = new GainNode(context, { gain: ReverbReturn });
    const preMaster = new GainNode(context, { gain: PreMasterGain });
    const compressor = new DynamicsCompressorNode(context, { threshold: -14, knee: 8, ratio: 2.5, attack: 0.005, release: 0.25 });
    const limiter = new DynamicsCompressorNode(context, { threshold: -3, knee: 0, ratio: 20, attack: 0.001, release: 0.08 });

    this.world.connect(cloudFilter);
    this.ambience.connect(cloudFilter);
    cloudFilter.connect(cloudGain).connect(preMaster);
    this.ui.connect(preMaster);
    this.music.connect(preMaster);
    this.music.connect(musicSend).connect(this.reverbSend);
    this.reverbSend.connect(reverb).connect(reverbReturn).connect(preMaster);
    preMaster.connect(compressor).connect(limiter).connect(this.output);
    this.meterTap = limiter;
    this.nodes = [
      this.world, this.ambience, this.ui, this.music, this.reverbSend, this.output,
      cloudFilter, cloudGain, musicSend, reverb, reverbReturn, preMaster, compressor, limiter,
    ];

    this.cloudCutoff = new SmoothedParam(context, cloudFilter.frequency, ClearCutoff, 0.2, 5);
    this.cloudLevel = new SmoothedParam(context, cloudGain.gain, 1, 0.3);
    this.musicLevel = new SmoothedParam(context, this.music.gain, 0, 0.1);
  }

  /** Wolkendichte an der Kamera 0..1: dämpft die Höhen von Welt und Umgebung. */
  public setCloud(inCloud01: number): void {
    const density = clamp01(inCloud01);
    this.cloudCutoff.set(ClearCutoff * Math.pow(CloudCutoff / ClearCutoff, density));
    this.cloudLevel.set(1 - CloudDip * density);
  }

  /** Musiklautstärke als lineare Verstärkung. */
  public setMusicGain(gain: number): void {
    this.musicLevel.set(Math.max(0, gain));
  }

  public dispose(): void {
    for (const node of this.nodes) {
      node.disconnect();
    }
  }
}
