// src/systems/audio/soundBank.worker.ts — erzeugt einen Teil der Klangbank abseits des Hauptthreads.
import { buildSoundLibrary, type LibraryPart } from "./synth/soundLibrary";

/** Auftrag an den Worker: Abtastrate des Audiokontexts, Seed der Klänge und zu erzeugender Teil. */
interface SoundBankRequest {
  readonly sampleRate: number;
  readonly seed: number;
  readonly part: LibraryPart;
}

self.onmessage = (event: MessageEvent<SoundBankRequest>): void => {
  const { sampleRate, seed, part } = event.data;
  const library = buildSoundLibrary(sampleRate, seed, part);
  // Übertragung ohne Kopie: die Abtastpuffer wechseln den Besitzer
  const transfer = library.clips.flatMap((clip) => clip.channels.map((channel) => channel.buffer));
  (self as unknown as Worker).postMessage(library, transfer);
};
