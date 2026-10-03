// src/rendering/sky/noise/cloudNoise.worker.ts — erzeugt die Wolkenrauschdaten abseits des Hauptthreads.
import { buildCloudNoise } from "./cloudNoiseData";

/** Auftrag an den Worker. */
interface NoiseRequest {
  readonly seed: number;
}

self.onmessage = (event: MessageEvent<NoiseRequest>): void => {
  const data = buildCloudNoise(event.data.seed);
  // Übertragung ohne Kopie: die Puffer wechseln den Besitzer
  (self as unknown as Worker).postMessage(data, [data.shape.buffer, data.detail.buffer, data.weather.buffer]);
};
