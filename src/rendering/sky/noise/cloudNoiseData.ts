// src/rendering/sky/noise/cloudNoiseData.ts — erzeugt die kachelbaren Rauschvolumen der Wolken (Wolkenrauschen).
import { gradientFbm2, gradientFbm3, remap, worley2, worley3 } from "./noiseFunctions";

/** Größen der Rauschdaten. */
export const ShapeSize = 128;
export const DetailSize = 32;
export const WeatherSize = 512;

/** Fertige Rauschdaten für die GPU und die CPU-Dichtefunktion (Rauschdaten). */
export interface CloudNoiseData {
  /** Formrauschen ShapeSize³, ein Kanal (Perlin-Worley, durch Worley-fBm geschärft). */
  readonly shape: Uint8Array;
  /** Detailrauschen DetailSize³, ein Kanal (Worley-fBm). */
  readonly detail: Uint8Array;
  /** Wetterkarte WeatherSize², RGBA: Bedeckung, Wolkenart, Regenzellen, Variation. */
  readonly weather: Uint8Array;
}

function toByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value * 255)));
}

/**
 * Streckt ein Rauschvolumen auf den vollen Wertebereich zwischen dem unteren und oberen Perzentil
 * (Kontrastnormierung): die Bedeckungsschwelle im Shader wirkt so über den ganzen Bereich.
 */
function normalizeRange(data: Uint8Array, lowPercentile: number, highPercentile: number): void {
  const histogram = new Uint32Array(256);
  for (const value of data) {
    histogram[value] = (histogram[value] ?? 0) + 1;
  }
  const lowCount = data.length * lowPercentile;
  const highCount = data.length * highPercentile;
  let low = 0;
  let high = 255;
  let cumulative = 0;
  for (let value = 0; value < 256; value++) {
    const previous = cumulative;
    cumulative += histogram[value] ?? 0;
    if (previous < lowCount && cumulative >= lowCount) low = value;
    if (previous < highCount && cumulative >= highCount) high = value;
  }
  const span = Math.max(1, high - low);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.max(0, Math.min(255, Math.round((((data[i] ?? 0) - low) * 255) / span)));
  }
}

/** Formrauschen nach Horizon Zero Dawn, kombiniert in einen Kanal (Frostbite-Variante). */
export function buildShapeNoise(seed: number): Uint8Array {
  const n = ShapeSize;
  const data = new Uint8Array(n * n * n);
  let index = 0;
  for (let z = 0; z < n; z++) {
    const w = z / n;
    for (let y = 0; y < n; y++) {
      const v = y / n;
      for (let x = 0; x < n; x++) {
        const u = x / n;
        const perlin = gradientFbm3(u * 4, v * 4, w * 4, 4, 4, seed);
        const worleyLow = worley3(u, v, w, 4, seed + 11);
        // Perlin-Worley: Perlin wird von Worley aufgebläht → blumenkohlartige Grundform
        const perlinWorley = Math.min(1, Math.max(0, remap(perlin, 0, 1, worleyLow, 1)));
        const worleyFbm =
          worley3(u, v, w, 8, seed + 23) * 0.625 + worley3(u, v, w, 16, seed + 37) * 0.25 + worley3(u, v, w, 32, seed + 41) * 0.125;
        const shape = remap(perlinWorley, worleyFbm - 1, 1, 0, 1);
        data[index++] = toByte(shape);
      }
    }
  }
  normalizeRange(data, 0.02, 0.995);
  return data;
}

/** Detailrauschen: Worley-fBm in höherer Frequenz für Erosion der Ränder. */
export function buildDetailNoise(seed: number): Uint8Array {
  const n = DetailSize;
  const data = new Uint8Array(n * n * n);
  let index = 0;
  for (let z = 0; z < n; z++) {
    const w = z / n;
    for (let y = 0; y < n; y++) {
      const v = y / n;
      for (let x = 0; x < n; x++) {
        const u = x / n;
        const fbm = worley3(u, v, w, 2, seed + 51) * 0.625 + worley3(u, v, w, 4, seed + 53) * 0.25 + worley3(u, v, w, 8, seed + 57) * 0.125;
        data[index++] = toByte(fbm);
      }
    }
  }
  normalizeRange(data, 0.01, 0.995);
  return data;
}

/**
 * Wetterkarte (kachelbar): R großräumige Wolkenfelder, G Haufenwolken-Zellen (je Zelle eine Wolke von
 * 200–400 m), B Regenzellen, A feine Variation (Wellung des Wolkenmeers, Quellungen).
 */
export function buildWeatherMap(seed: number): Uint8Array {
  const n = WeatherSize;
  const channels = [new Uint8Array(n * n), new Uint8Array(n * n), new Uint8Array(n * n), new Uint8Array(n * n)];
  let index = 0;
  for (let y = 0; y < n; y++) {
    const v = y / n;
    for (let x = 0; x < n; x++) {
      const u = x / n;
      channels[0]![index] = toByte(gradientFbm2(u * 3, v * 3, 3, 4, seed + 61));
      // Zellen leicht verbogen, damit die Wolken nicht auf einem Raster sitzen
      const warpU = u + (gradientFbm2(u * 6, v * 6, 6, 2, seed + 63) - 0.5) * 0.05;
      const warpV = v + (gradientFbm2(u * 6 + 3.7, v * 6 + 1.3, 6, 2, seed + 65) - 0.5) * 0.05;
      const cells = Math.max(worley2(warpU, warpV, 15, seed + 67), worley2(warpU, warpV, 24, seed + 69) * 0.82);
      channels[1]![index] = toByte(cells);
      channels[2]![index] = toByte(Math.pow(worley2(u, v, 5, seed + 71), 1.5));
      channels[3]![index] = toByte(gradientFbm2(u * 12, v * 12, 12, 3, seed + 73));
      index++;
    }
  }
  for (const channel of channels) {
    normalizeRange(channel, 0.01, 0.995);
  }
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    data[i * 4] = channels[0]![i] ?? 0;
    data[i * 4 + 1] = channels[1]![i] ?? 0;
    data[i * 4 + 2] = channels[2]![i] ?? 0;
    data[i * 4 + 3] = channels[3]![i] ?? 0;
  }
  return data;
}

/** Erzeugt alle Rauschdaten (Wolkenrauschen). */
export function buildCloudNoise(seed: number): CloudNoiseData {
  return { shape: buildShapeNoise(seed), detail: buildDetailNoise(seed), weather: buildWeatherMap(seed) };
}
