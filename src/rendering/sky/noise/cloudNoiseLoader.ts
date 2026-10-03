import type { CloudNoiseData } from "./cloudNoiseData";

/** Erzeugt die Wolkenrauschdaten in einem Web Worker (Rauschlader). */
export function loadCloudNoise(seed: number): Promise<CloudNoiseData> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./cloudNoise.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<CloudNoiseData>) => {
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(`Wolkenrauschen fehlgeschlagen: ${event.message}`));
    };
    worker.postMessage({ seed });
  });
}
