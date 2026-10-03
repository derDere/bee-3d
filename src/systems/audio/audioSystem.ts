// src/systems/audio/audioSystem.ts — Tonsystem des Spiels: verbindet Klangbank, Mischpult, Raumklänge, Schleifen,
// Umgebung und Musik mit Babylons AudioEngineV2.
//
// Babylons Busse bieten keine Effekt-Einschübe; Kompressor und Limiter am Master brauchen aber die Summe aller
// Klänge. Deshalb läuft die gesamte Mischung (Panner, Filter, Hall, Dynamik) als Web-Audio-Graph im AudioContext
// der Engine und mündet über `createSoundSourceAsync` in Babylons Haupt-Bus. Babylon liefert Kontext, Entsperren,
// Master-Lautstärke und den Hörer, dessen Lage alle Panner des Kontexts verwenden.
import type { AbstractSoundSource } from "@babylonjs/core/AudioV2/abstractAudio/abstractSoundSource";
import type { AudioEngineV2 } from "@babylonjs/core/AudioV2/abstractAudio/audioEngineV2";
import { CreateAudioEngineAsync } from "@babylonjs/core/AudioV2/webAudio/webAudioEngine";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Random } from "../../../shared/random";
import { Ambience } from "./ambience";
import { sliderToGain } from "./audioParams";
import type { AudioApi, UiSound, WorldSound } from "./audioTypes";
import { FlyDrone } from "./flyDrone";
import { AudioMixer } from "./mixer";
import { GenerativeMusic } from "./music";
import { SoundBank, type SoundBankReport } from "./soundBank";
import { UiSoundPlayer } from "./uiSounds";
import { WingBuzz } from "./wingBuzz";
import { WorldSoundPlayer } from "./worldSounds";

/** Seed aller erzeugten Klänge: gleiche Klänge in jeder Sitzung. */
const SoundSeed = 0xb33;
/** Seed der Laufzeit-Variation (Tonhöhenstreuung, Varianten, Musik). */
const PlaybackSeed = 0x5ee5;
/** Musiklautstärke, bis setVolumes aufgerufen wird. */
const DefaultMusicVolume = 0.5;

/** Prüfkennzahlen des Tonsystems (Diagnose). */
export interface AudioDiagnostics {
  readonly contextState: AudioContextState;
  readonly sampleRate: number;
  readonly activeVoices: number;
  readonly bank: SoundBankReport;
}

/**
 * Tonsystem des Spiels (Tonsystem). Alle Klänge entstehen prozedural; `createAsync` erzeugt sie im Worker.
 * Je Frame setzt das Spiel Hörer, Flügelsummen, nächste Fliege, Umgebung und Tageszeit.
 */
export class AudioSystem implements AudioApi {
  private readonly engine: AudioEngineV2;
  private readonly context: AudioContext;
  private readonly bank: SoundBank;
  private readonly mixer: AudioMixer;
  private readonly mixSource: AbstractSoundSource;
  private readonly worldSounds: WorldSoundPlayer;
  private readonly uiSounds: UiSoundPlayer;
  private readonly wingBuzz: WingBuzz;
  private readonly flyDrone: FlyDrone;
  private readonly ambience: Ambience;
  private readonly music: GenerativeMusic;
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private disposed = false;

  private constructor(engine: AudioEngineV2, context: AudioContext, bank: SoundBank, mixer: AudioMixer, mixSource: AbstractSoundSource) {
    this.engine = engine;
    this.context = context;
    this.bank = bank;
    this.mixer = mixer;
    this.mixSource = mixSource;
    const random = new Random(PlaybackSeed);
    this.worldSounds = new WorldSoundPlayer(context, bank, mixer.world, mixer.reverbSend, random);
    this.uiSounds = new UiSoundPlayer(context, bank, mixer.ui, random);
    this.wingBuzz = new WingBuzz(context, bank.get("wingBuzz"), mixer.world, mixer.reverbSend);
    this.flyDrone = new FlyDrone(context, bank.get("flyDrone"), mixer.world);
    this.ambience = new Ambience(context, bank, mixer.ambience);
    this.music = new GenerativeMusic(context, bank, mixer.music, random);
    this.flyDrone.setDistance(Number.POSITIVE_INFINITY);
    this.setVolumes(1, DefaultMusicVolume);
  }

  /** Erzeugt Audio-Engine, Klangbank und Mischpult; danach unlockAsync aus einer Nutzeraktion aufrufen. */
  public static async createAsync(): Promise<AudioSystem> {
    const context = new AudioContext({ latencyHint: "interactive" });
    const engine = await CreateAudioEngineAsync({ audioContext: context, disableDefaultUI: true, listenerAutoUpdate: false });
    try {
      const bank = await SoundBank.createAsync(context, SoundSeed);
      const mixer = new AudioMixer(context, bank.get("reverbImpulse"));
      const mixSource = await engine.createSoundSourceAsync("beeMix", mixer.output);
      return new AudioSystem(engine, context, bank, mixer, mixSource);
    } catch (error) {
      engine.dispose();
      throw error;
    }
  }

  public async unlockAsync(): Promise<void> {
    await this.engine.unlockAsync();
  }

  /** Master- und Musiklautstärke als Schiebereglerwerte 0..1 (intern quadratisch, wahrnehmungsnah). */
  public setVolumes(master: number, music: number): void {
    this.engine.volume = sliderToGain(master);
    const musicGain = sliderToGain(music);
    this.mixer.setMusicGain(musicGain);
    this.music.setEnabled(musicGain > 0.0001);
  }

  public playUi(sound: UiSound): void {
    this.uiSounds.play(sound);
  }

  public playAt(sound: WorldSound, position: Vector3, intensity = 1): void {
    this.worldSounds.play(sound, position, intensity);
  }

  /** Hörer an der Kamera (linkshändige Babylon-Szene): Position und Blickrichtung je Frame. */
  public setListener(position: Vector3, forward: Vector3, up: Vector3): void {
    const listener = this.engine.listener;
    listener.position.copyFrom(position);
    this.worldSounds.setListenerPosition(position);
    forward.normalizeToRef(this.forward);
    Vector3.CrossToRef(up, this.forward, this.right);
    if (this.right.lengthSquared() > 1e-10) {
      this.right.normalize();
      Vector3.CrossToRef(this.forward, this.right, this.up);
      Quaternion.FromLookDirectionLHToRef(this.forward, this.up, listener.rotationQuaternion);
    }
    listener.update();
  }

  public setWingBuzz(speed01: number, ghost: boolean): void {
    this.wingBuzz.set(speed01, ghost);
  }

  public setNearestFly(distance: number): void {
    this.flyDrone.setDistance(distance);
  }

  public setEnvironment(wind01: number, rain01: number, inCloud01: number): void {
    this.ambience.setWeather(wind01, rain01);
    this.mixer.setCloud(inCloud01);
  }

  public setNightFactor(night01: number): void {
    this.ambience.setNight(night01);
    this.music.setNight(night01);
  }

  /** Prüfkennzahlen für Prüfseiten und Debug-API. */
  public diagnostics(): AudioDiagnostics {
    return {
      contextState: this.context.state,
      sampleRate: this.context.sampleRate,
      activeVoices: this.worldSounds.activeVoices + this.uiSounds.activeVoices,
      bank: this.bank.report,
    };
  }

  /** Hängt einen Analysator hinter den Limiter (Pegelmesser für Prüfseiten); der Aufrufer trennt ihn wieder. */
  public createOutputAnalyser(): AnalyserNode {
    const analyser = new AnalyserNode(this.context, { fftSize: 2048, smoothingTimeConstant: 0 });
    this.mixer.meterTap.connect(analyser);
    return analyser;
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.music.dispose();
    this.ambience.dispose();
    this.wingBuzz.dispose();
    this.flyDrone.dispose();
    this.worldSounds.dispose();
    this.uiSounds.dispose();
    this.mixSource.dispose();
    this.mixer.dispose();
    this.engine.dispose();
  }
}
