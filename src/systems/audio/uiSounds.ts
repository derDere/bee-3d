// src/systems/audio/uiSounds.ts — Oberflächenklänge ohne Raumbezug mit Stimmenbegrenzung und Mindestabstand.
import type { Random } from "../../../shared/random";
import { dbToGain } from "./audioParams";
import type { UiSound } from "./audioTypes";
import { UiSoundCatalog } from "./soundCatalog";
import type { SoundBank } from "./soundBank";
import { Voice, createPools, type VoicePool } from "./voices";

/** Spielt Oberflächenklänge (UI-Klang-Spieler). */
export class UiSoundPlayer {
  private readonly context: BaseAudioContext;
  private readonly bank: SoundBank;
  private readonly output: AudioNode;
  private readonly random: Random;
  private readonly pools: Record<UiSound, VoicePool>;

  public constructor(context: BaseAudioContext, bank: SoundBank, output: AudioNode, random: Random) {
    this.context = context;
    this.bank = bank;
    this.output = output;
    this.random = random;
    this.pools = createPools(UiSoundCatalog);
  }

  /** Anzahl aller gerade klingenden UI-Stimmen. */
  public get activeVoices(): number {
    let count = 0;
    for (const pool of Object.values<VoicePool>(this.pools)) {
      count += pool.activeCount;
    }
    return count;
  }

  public play(sound: UiSound): void {
    if (this.context.state !== "running") {
      return;
    }
    const spec = UiSoundCatalog[sound];
    const pool = this.pools[sound];
    const now = this.context.currentTime;
    if (pool.sinceLastStart(now) < spec.minInterval) {
      return;
    }
    pool.makeRoom(now);
    const voice = new Voice(this.context, {
      buffer: this.bank.get(sound),
      when: now,
      gain: dbToGain(spec.gainDb),
      detuneCents: this.random.range(-spec.pitchJitter, spec.pitchJitter),
      destination: this.output,
    });
    pool.add(voice, now);
  }

  public dispose(): void {
    for (const pool of Object.values<VoicePool>(this.pools)) {
      pool.dispose();
    }
  }
}
