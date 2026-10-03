// src/systems/audio/soundBank.ts — Klangbank: erzeugt alle Klänge parallel in Workern und hält sie als AudioBuffer
// bereit. Ohne Worker-Unterstützung entstehen die Klänge im Hauptthread.
import type { ClipId } from "./synth/recipes/recipeTypes";
import { WholeLibrary, buildSoundLibrary, type GeneratedClip, type LibraryPart, type SoundLibrary } from "./synth/soundLibrary";

/** Höchstzahl paralleler Erzeugungs-Worker. */
const MaxWorkers = 4;

/** Kennzahlen eines Klangs der Klangbank (Klangbericht). */
export interface SoundReport {
  readonly id: ClipId;
  readonly variant: number;
  readonly seconds: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly peak: number;
  readonly rms: number;
  readonly loudness: number;
  readonly finite: boolean;
  readonly milliseconds: number;
}

/** Kennzahlen der gesamten Klangbank (Bankbericht). */
export interface SoundBankReport {
  readonly sounds: readonly SoundReport[];
  /** Summierte Rechenzeit der Rezepte über alle Worker in Millisekunden. */
  readonly generationMilliseconds: number;
  /** Zeit bis zur fertigen Klangbank inklusive Worker-Start und Übergabe. */
  readonly totalMilliseconds: number;
  /** Speicher aller Abtastwerte (Float32) in Bytes. */
  readonly bytes: number;
  /** Anzahl der Erzeugungs-Worker; 0 bedeutet Hauptthread. */
  readonly workers: number;
}

/** Klangbank (Klangbank): alle prozedural erzeugten Klänge als AudioBuffer, nach Klang-ID und Variante. */
export class SoundBank {
  public readonly report: SoundBankReport;
  private readonly buffers: ReadonlyMap<ClipId, readonly AudioBuffer[]>;

  private constructor(buffers: ReadonlyMap<ClipId, readonly AudioBuffer[]>, report: SoundBankReport) {
    this.buffers = buffers;
    this.report = report;
  }

  /** Erzeugt alle Klänge für die Abtastrate des Kontexts. */
  public static async createAsync(context: BaseAudioContext, seed: number): Promise<SoundBank> {
    const started = performance.now();
    const workerCount = Math.max(1, Math.min(MaxWorkers, (navigator.hardwareConcurrency || 2) - 1));
    let parts: SoundLibrary[];
    let workers = workerCount;
    try {
      parts = await Promise.all(
        Array.from({ length: workerCount }, (_, index) => generateInWorker(context.sampleRate, seed, { index, count: workerCount })),
      );
    } catch (error) {
      console.warn("[audio] Klangbank-Worker nicht verfügbar, Erzeugung im Hauptthread:", error);
      parts = [buildSoundLibrary(context.sampleRate, seed, WholeLibrary)];
      workers = 0;
    }
    const clips = parts.flatMap((part) => part.clips);
    const buffers = new Map<ClipId, AudioBuffer[]>();
    let bytes = 0;
    for (const clip of clips) {
      const list = buffers.get(clip.id) ?? [];
      list[clip.variant] = toAudioBuffer(clip);
      buffers.set(clip.id, list);
      bytes += clip.channels.reduce((sum, channel) => sum + channel.byteLength, 0);
    }
    const report: SoundBankReport = {
      sounds: clips.map(toReport),
      generationMilliseconds: parts.reduce((sum, part) => sum + part.milliseconds, 0),
      totalMilliseconds: performance.now() - started,
      bytes,
      workers,
    };
    return new SoundBank(buffers, report);
  }

  /** Alle Varianten eines Klangs. */
  public variants(id: ClipId): readonly AudioBuffer[] {
    const list = this.buffers.get(id);
    if (list === undefined || list.length === 0) {
      throw new Error(`Sound bank: sound "${id}" is missing.`);
    }
    return list;
  }

  /** Eine Variante eines Klangs; zu große Indizes liefern die letzte Variante. */
  public get(id: ClipId, variant = 0): AudioBuffer {
    const list = this.variants(id);
    return list[Math.min(Math.max(0, variant), list.length - 1)];
  }
}

function generateInWorker(sampleRate: number, seed: number, part: LibraryPart): Promise<SoundLibrary> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./soundBank.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<SoundLibrary>) => {
      worker.terminate();
      resolve(event.data);
    };
    worker.onmessageerror = () => {
      worker.terminate();
      reject(new Error("Klangbank-Worker: Antwort nicht lesbar."));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(`Klangbank-Worker fehlgeschlagen: ${event.message}`));
    };
    worker.postMessage({ sampleRate, seed, part });
  });
}

function toAudioBuffer(clip: GeneratedClip): AudioBuffer {
  const buffer = new AudioBuffer({
    length: clip.channels[0].length,
    numberOfChannels: clip.channels.length,
    sampleRate: clip.sampleRate,
  });
  clip.channels.forEach((data, channel) => buffer.copyToChannel(data, channel));
  return buffer;
}

function toReport(clip: GeneratedClip): SoundReport {
  return {
    id: clip.id,
    variant: clip.variant,
    seconds: clip.channels[0].length / clip.sampleRate,
    sampleRate: clip.sampleRate,
    channels: clip.channels.length,
    peak: clip.peak,
    rms: clip.rms,
    loudness: clip.loudness,
    finite: clip.finite,
    milliseconds: clip.milliseconds,
  };
}
