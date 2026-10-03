// src/systems/audio/music.ts — generative Hintergrundmusik: ruhige D-Dur-Pentatonik mit Kalimba, Glocke, Fläche
// und Bass. Ein Vorausplaner setzt Noten im Achtelraster auf die Uhr des Audiokontexts.
import type { Random } from "../../../shared/random";
import { FlatLowpassQ, SmoothedParam, clamp01 } from "./audioParams";
import type { SoundBank } from "./soundBank";
import { InstrumentBaseNotes, PadSustainLoop } from "./synth/recipes/instruments";

/** Akkordnamen der Musik. */
type ChordName = "D" | "Bm7" | "Gmaj7" | "Asus2" | "Em7";

/** Ein Akkord: Bassnote, Flächenstimmen, Akkordtöne als Tonklassen und Glockentöne (Akkord). */
interface Chord {
  readonly bass: number;
  readonly pad: readonly number[];
  readonly tones: readonly number[];
  readonly bells: readonly number[];
}

const Chords: Readonly<Record<ChordName, Chord>> = {
  D: { bass: 38, pad: [50, 54, 57], tones: [2, 6, 9], bells: [81, 86, 90] },
  Bm7: { bass: 35, pad: [47, 54, 57], tones: [11, 2, 6, 9], bells: [83, 86, 90] },
  Gmaj7: { bass: 43, pad: [55, 59, 62], tones: [7, 11, 2, 6], bells: [83, 86, 90] },
  Asus2: { bass: 45, pad: [52, 57, 59], tones: [9, 11, 4], bells: [81, 83, 88] },
  Em7: { bass: 40, pad: [52, 55, 59], tones: [4, 7, 11, 2], bells: [83, 86, 88] },
};

/** Übergänge zwischen Akkorden mit Gewichten (Markow-Kette). */
type Progression = Readonly<Record<ChordName, readonly (readonly [ChordName, number])[]>>;

const DayProgression: Progression = {
  D: [["Bm7", 0.3], ["Gmaj7", 0.35], ["Asus2", 0.2], ["Em7", 0.15]],
  Gmaj7: [["D", 0.45], ["Asus2", 0.3], ["Bm7", 0.25]],
  Bm7: [["Gmaj7", 0.45], ["Em7", 0.25], ["D", 0.3]],
  Asus2: [["D", 0.5], ["Bm7", 0.3], ["Gmaj7", 0.2]],
  Em7: [["Asus2", 0.4], ["Gmaj7", 0.35], ["D", 0.25]],
};

/** Nachts kreist die Harmonie um h-Moll. */
const NightProgression: Progression = {
  Bm7: [["Gmaj7", 0.4], ["Em7", 0.35], ["D", 0.25]],
  Gmaj7: [["Bm7", 0.4], ["D", 0.3], ["Em7", 0.3]],
  Em7: [["Bm7", 0.5], ["Gmaj7", 0.5]],
  D: [["Bm7", 0.6], ["Gmaj7", 0.4]],
  Asus2: [["Bm7", 0.6], ["Em7", 0.4]],
};

/** Stimmung eines Akkordabschnitts: Melodie, sparsam oder Pause (nur Fläche und Bass). */
type PhraseMood = "melody" | "sparse" | "rest";

/** Melodietöne: D-Dur-Pentatonik von D4 bis A5. */
const MelodyNotes: readonly number[] = [62, 64, 66, 69, 71, 74, 76, 78, 81];
/** Schritte der Melodie-Zufallswanderung über die Skala. */
const MelodySteps: readonly number[] = [-2, -1, -1, 0, 1, 1, 2, -3, 3];

/** Achtel je Akkord (zwei Takte). */
const StepsPerChord = 16;
const LookaheadSeconds = 0.3;
const TimerMilliseconds = 100;
/** Pause vor dem ersten Ton nach dem Einschalten. */
const StartDelaySeconds = 1.5;
/** Tempo am Tag und in der Nacht (Schläge je Minute). */
const DayBpm = 76;
const NightBpm = 62;
/** Gesamtpegel der Musik vor dem Musikregler. */
const MusicLevel = 0.75;
/** Helligkeit am Tag und in der Nacht (Hz). */
const DayBrightness = 7000;
const NightBrightness = 2400;

/** Ein gerade klingender Ton, damit Ausschalten und Entsorgen ihn sanft beenden können. */
interface ActiveNote {
  readonly source: AudioBufferSourceNode;
  readonly level: GainNode;
}

/** Generative Hintergrundmusik (Hintergrundmusik). */
export class GenerativeMusic {
  private readonly context: BaseAudioContext;
  private readonly bank: SoundBank;
  private readonly random: Random;
  private readonly output: GainNode;
  private readonly tone: BiquadFilterNode;
  private readonly brightness: SmoothedParam;
  private readonly active = new Set<ActiveNote>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private enabled = false;
  private night = 0;
  private nextStepTime = 0;
  private step = 0;
  private chord: ChordName = "D";
  private mood: PhraseMood = "rest";
  private melodyIndex = 4;
  private motif: (number | null)[] = new Array<number | null>(StepsPerChord).fill(null);
  private replayMotif = false;

  public constructor(context: BaseAudioContext, bank: SoundBank, output: AudioNode, random: Random) {
    this.context = context;
    this.bank = bank;
    this.random = random;
    this.output = new GainNode(context, { gain: MusicLevel });
    this.tone = new BiquadFilterNode(context, { type: "lowpass", frequency: DayBrightness, Q: FlatLowpassQ });
    this.output.connect(this.tone).connect(output);
    this.brightness = new SmoothedParam(context, this.tone.frequency, DayBrightness, 3, 10);
  }

  /** Schaltet die Musik ein oder aus; beim Ausschalten klingen laufende Töne sanft aus. */
  public setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) {
      return;
    }
    this.enabled = enabled;
    if (enabled) {
      this.nextStepTime = this.context.currentTime + StartDelaySeconds;
      this.step = 0;
      this.timer = setInterval(() => this.tick(), TimerMilliseconds);
      this.tick();
    } else {
      this.stopTimer();
      this.releaseAll(1.2);
    }
  }

  /** 0 = Tag, 1 = Nacht: Tempo, Harmonie, Dichte und Helligkeit folgen. */
  public setNight(night01: number): void {
    this.night = clamp01(night01);
    this.brightness.set(DayBrightness * Math.pow(NightBrightness / DayBrightness, this.night));
  }

  public dispose(): void {
    this.stopTimer();
    for (const note of this.active) {
      note.source.onended = null;
      note.source.stop();
      note.source.disconnect();
      note.level.disconnect();
    }
    this.active.clear();
    this.output.disconnect();
    this.tone.disconnect();
  }

  private get stepSeconds(): number {
    return 30 / (DayBpm + (NightBpm - DayBpm) * this.night);
  }

  private get isNight(): boolean {
    return this.night > 0.5;
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Plant alle Achtel bis zum Vorausschau-Horizont; nach einem Hänger (Hintergrund-Tab) setzt er neu auf. */
  private tick(): void {
    const now = this.context.currentTime;
    if (this.nextStepTime < now - 0.1) {
      this.nextStepTime = now + 0.05;
    }
    while (this.nextStepTime < now + LookaheadSeconds) {
      this.scheduleStep(this.nextStepTime);
      this.nextStepTime += this.stepSeconds;
      this.step = (this.step + 1) % StepsPerChord;
    }
  }

  private scheduleStep(time: number): void {
    if (this.step === 0) {
      this.startChord(time);
    }
    const chord = Chords[this.chord];
    if (this.step === 8 && this.random.chance(0.5)) {
      this.playBass(chord.bass + (this.random.chance(0.5) ? 7 : 0), time, 0.32);
    }
    const density = this.mood === "melody" ? (this.isNight ? 0.3 : 0.42) : this.mood === "sparse" ? 0.18 : 0;
    const strong = this.step % 4 === 0;
    let noteIndex: number | null = null;
    if (this.replayMotif) {
      const remembered = this.motif[this.step];
      noteIndex = remembered === null ? null : strong ? this.snapToChord(remembered, chord) : remembered;
    } else if (this.random.chance(density * (strong ? 1.3 : 1))) {
      noteIndex = this.walkMelody(strong, chord);
    }
    if (!this.replayMotif) {
      this.motif[this.step] = noteIndex;
    }
    if (noteIndex !== null) {
      const swing = this.step % 2 === 1 ? this.stepSeconds * 0.04 : 0;
      const humanize = this.random.range(-0.008, 0.008);
      const velocity = (0.55 + 0.3 * this.random.next() + (strong ? 0.1 : 0)) * (1 - 0.25 * this.night);
      const midi = MelodyNotes[noteIndex];
      if (this.isNight && this.random.chance(0.3)) {
        this.playBell(midi + 12, time + swing + humanize, velocity * 0.6);
      } else {
        this.playKalimba(midi, time + swing + humanize, velocity);
      }
    }
  }

  /** Neuer Akkordabschnitt: Akkord wählen, Stimmung würfeln, Fläche, Bass und manchmal eine Glocke setzen. */
  private startChord(time: number): void {
    this.chord = this.nextChord();
    const chord = Chords[this.chord];
    const previousMood = this.mood;
    this.mood = this.pickMood();
    this.replayMotif = this.mood === "melody" && previousMood === "melody" && this.random.chance(0.3);
    const holdSeconds = StepsPerChord * this.stepSeconds + 0.6;
    for (const midi of chord.pad) {
      this.playPad(midi, time, holdSeconds);
    }
    this.playBass(chord.bass, time, 0.45);
    if (this.random.chance(this.isNight ? 0.5 : 0.35)) {
      this.playBell(this.random.pick(chord.bells), time + this.stepSeconds * this.random.int(4), 0.35);
    }
  }

  private nextChord(): ChordName {
    const options = (this.isNight ? NightProgression : DayProgression)[this.chord];
    let roll = this.random.next() * options.reduce((sum, [, weight]) => sum + weight, 0);
    for (const [name, weight] of options) {
      roll -= weight;
      if (roll <= 0) {
        return name;
      }
    }
    return options[options.length - 1][0];
  }

  private pickMood(): PhraseMood {
    const roll = this.random.next();
    if (this.isNight) {
      return roll < 0.3 ? "melody" : roll < 0.75 ? "sparse" : "rest";
    }
    return roll < 0.55 ? "melody" : roll < 0.85 ? "sparse" : "rest";
  }

  /** Zufallswanderung über die Skala, auf starken Zählzeiten zum nächsten Akkordton gezogen. */
  private walkMelody(strong: boolean, chord: Chord): number {
    let index = this.melodyIndex + this.random.pick(MelodySteps);
    if (index < 0 || index >= MelodyNotes.length) {
      index = this.melodyIndex - Math.sign(index - this.melodyIndex);
    }
    index = Math.max(0, Math.min(MelodyNotes.length - 1, index));
    if (strong) {
      index = this.snapToChord(index, chord);
    }
    this.melodyIndex = index;
    return index;
  }

  private snapToChord(index: number, chord: Chord): number {
    for (let distance = 0; distance < MelodyNotes.length; distance++) {
      for (const candidate of [index - distance, index + distance]) {
        if (candidate >= 0 && candidate < MelodyNotes.length && chord.tones.includes(MelodyNotes[candidate] % 12)) {
          return candidate;
        }
      }
    }
    return index;
  }

  private playKalimba(midi: number, time: number, velocity: number): void {
    const variant = midi < 68 ? 0 : 1;
    this.playSample(this.bank.get("kalimba", variant), InstrumentBaseNotes.kalimba[variant], midi, time, 0.5 * velocity * velocity);
  }

  private playBell(midi: number, time: number, velocity: number): void {
    this.playSample(this.bank.get("bell"), InstrumentBaseNotes.bell, midi, time, 0.28 * velocity);
  }

  private playBass(midi: number, time: number, gain: number): void {
    this.playSample(this.bank.get("bass"), InstrumentBaseNotes.bass, midi, time, gain);
  }

  /** Flächenton mit Halteschleife; nach holdSeconds klingt er mit langer Ausklingzeit aus. */
  private playPad(midi: number, time: number, holdSeconds: number): void {
    const note = this.playSample(this.bank.get("pad"), InstrumentBaseNotes.pad, midi, time, 0.22, true);
    const release = time + holdSeconds;
    note.level.gain.setTargetAtTime(0, release, 0.7);
    note.source.stop(release + 4);
  }

  private playSample(buffer: AudioBuffer, baseMidi: number, midi: number, time: number, gain: number, sustain = false): ActiveNote {
    const source = new AudioBufferSourceNode(this.context, {
      buffer,
      playbackRate: Math.pow(2, (midi - baseMidi) / 12),
      loop: sustain,
      loopStart: sustain ? PadSustainLoop.start : 0,
      loopEnd: sustain ? PadSustainLoop.end : 0,
    });
    const level = new GainNode(this.context, { gain });
    source.connect(level).connect(this.output);
    const note: ActiveNote = { source, level };
    this.active.add(note);
    source.onended = () => {
      source.disconnect();
      level.disconnect();
      this.active.delete(note);
    };
    source.start(Math.max(time, this.context.currentTime));
    return note;
  }

  /** Lässt alle laufenden Töne mit der Zeitkonstante tau ausklingen. */
  private releaseAll(tau: number): void {
    const now = this.context.currentTime;
    for (const note of this.active) {
      note.level.gain.cancelScheduledValues(now);
      note.level.gain.setTargetAtTime(0, now, tau);
      note.source.stop(now + tau * 6);
    }
  }
}
