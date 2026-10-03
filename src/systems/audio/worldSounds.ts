// src/systems/audio/worldSounds.ts — Raumklänge an Weltpositionen mit Abstands- und Luftdämpfung und Stimmen-Pools.
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Random } from "../../../shared/random";
import { clamp01, dbToGain } from "./audioParams";
import type { WorldSound } from "./audioTypes";
import { NearThunderDistance, WorldSoundCatalog, type WorldSoundSpec } from "./soundCatalog";
import type { SoundBank } from "./soundBank";
import type { ClipId } from "./synth/recipes/recipeTypes";
import { Voice, createPools, type VoicePool } from "./voices";

/** Klänge, die am Hörer leiser als −50 dB ankämen, entfallen. */
const MinAudibility = 0.003;
/** Startet dieselbe Klangart schneller hintereinander, fächert sich die Salve leicht auf (s). */
const SalvoWindowSeconds = 0.03;
/** Untergrenze der Luftdämpfung (Hz). */
const MinAirCutoff = 700;
const MaxAirCutoff = 20000;

/** Grenzfrequenz der Luftdämpfung: ferne Klänge verlieren ihre Höhen. */
function airCutoff(distance: number, damping: number): number {
  return Math.max(MinAirCutoff, MaxAirCutoff * Math.exp(-distance / damping));
}

/** Pegel nach der Abstandsdämpfung des Panners (Modell „inverse“). */
function distanceGain(spec: WorldSoundSpec, distance: number): number {
  return spec.refDistance / (spec.refDistance + spec.rolloff * Math.max(0, distance - spec.refDistance));
}

/** Spielt Raumklänge an Weltpositionen, je Klangart mit begrenzter Stimmenzahl (Raumklang-Spieler). */
export class WorldSoundPlayer {
  private readonly context: BaseAudioContext;
  private readonly bank: SoundBank;
  private readonly output: AudioNode;
  private readonly reverbSend: AudioNode;
  private readonly random: Random;
  private readonly pools: Record<WorldSound, VoicePool>;
  private readonly lastVariant = new Map<ClipId, number>();
  private readonly listener = new Vector3();

  public constructor(context: BaseAudioContext, bank: SoundBank, output: AudioNode, reverbSend: AudioNode, random: Random) {
    this.context = context;
    this.bank = bank;
    this.output = output;
    this.reverbSend = reverbSend;
    this.random = random;
    this.pools = createPools(WorldSoundCatalog);
  }

  /** Anzahl aller gerade klingenden Raumklang-Stimmen. */
  public get activeVoices(): number {
    let count = 0;
    for (const pool of Object.values<VoicePool>(this.pools)) {
      count += pool.activeCount;
    }
    return count;
  }

  public setListenerPosition(position: Vector3): void {
    this.listener.copyFrom(position);
  }

  /** Spielt einen Klang an einer Weltposition; intensity 0..1 skaliert die Lautstärke. */
  public play(sound: WorldSound, position: Vector3, intensity: number): void {
    if (this.context.state !== "running") {
      return;
    }
    const spec = WorldSoundCatalog[sound];
    const distance = Vector3.Distance(position, this.listener);
    if (!(distance <= spec.maxRange)) {
      return;
    }
    const level = clamp01(intensity) * dbToGain(spec.gainDb);
    if (level * distanceGain(spec, distance) < MinAudibility) {
      return;
    }
    const now = this.context.currentTime;
    const pool = this.pools[sound];
    const crowded = pool.sinceLastStart(now) < SalvoWindowSeconds;
    pool.makeRoom(now);
    const voice = new Voice(this.context, {
      buffer: this.pickVariant(sound === "thunder" && distance > NearThunderDistance ? "thunderFar" : sound),
      when: crowded ? now + 0.012 + this.random.next() * 0.035 : now,
      gain: crowded ? level * 0.85 : level,
      detuneCents: this.random.range(-spec.pitchJitter, spec.pitchJitter),
      destination: this.output,
      spatial: {
        position,
        refDistance: spec.refDistance,
        rolloff: spec.rolloff,
        airCutoff: airCutoff(distance, spec.airDamping),
      },
      reverb: { node: this.reverbSend, amount: spec.reverb },
    });
    pool.add(voice, now);
  }

  public dispose(): void {
    for (const pool of Object.values<VoicePool>(this.pools)) {
      pool.dispose();
    }
  }

  /** Wählt eine Variante, möglichst nicht dieselbe wie beim letzten Mal. */
  private pickVariant(id: ClipId): AudioBuffer {
    const variants = this.bank.variants(id);
    let index = this.random.int(variants.length);
    if (variants.length > 1 && index === this.lastVariant.get(id)) {
      index = (index + 1 + this.random.int(variants.length - 1)) % variants.length;
    }
    this.lastVariant.set(id, index);
    return variants[index];
  }
}
