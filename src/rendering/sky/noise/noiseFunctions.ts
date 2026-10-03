// src/rendering/sky/noise/noiseFunctions.ts — kachelbare Gradienten- und Worley-Rauschfunktionen (2D, 3D).
// Grundlage der Wolkentexturen; läuft im Worker und für die CPU-Dichtefunktion im Hauptthread.

/** Ganzzahl-Hash auf [0, 2³²) für Gitterpunkte (Gitter-Hash). */
function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f) ^ Math.imul(seed, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

function wrap(value: number, period: number): number {
  const m = value % period;
  return m < 0 ? m + period : m;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// Zwölf Kantenrichtungen eines Würfels als Gradienten (Perlin 2002).
const Gradients = new Float32Array([1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1]);

function gradientDot(ix: number, iy: number, iz: number, period: number, seed: number, dx: number, dy: number, dz: number): number {
  const index = (hash3(wrap(ix, period), wrap(iy, period), wrap(iz, period), seed) % 12) * 3;
  return (Gradients[index] ?? 0) * dx + (Gradients[index + 1] ?? 0) * dy + (Gradients[index + 2] ?? 0) * dz;
}

/** Kachelbares 3D-Gradientenrauschen mit ganzzahliger Periode; Wert etwa −1..1 (Gradientenrauschen). */
export function gradientNoise3(x: number, y: number, z: number, period: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const u = fade(fx);
  const v = fade(fy);
  const w = fade(fz);
  const n000 = gradientDot(ix, iy, iz, period, seed, fx, fy, fz);
  const n100 = gradientDot(ix + 1, iy, iz, period, seed, fx - 1, fy, fz);
  const n010 = gradientDot(ix, iy + 1, iz, period, seed, fx, fy - 1, fz);
  const n110 = gradientDot(ix + 1, iy + 1, iz, period, seed, fx - 1, fy - 1, fz);
  const n001 = gradientDot(ix, iy, iz + 1, period, seed, fx, fy, fz - 1);
  const n101 = gradientDot(ix + 1, iy, iz + 1, period, seed, fx - 1, fy, fz - 1);
  const n011 = gradientDot(ix, iy + 1, iz + 1, period, seed, fx, fy - 1, fz - 1);
  const n111 = gradientDot(ix + 1, iy + 1, iz + 1, period, seed, fx - 1, fy - 1, fz - 1);
  const x00 = n000 + u * (n100 - n000);
  const x10 = n010 + u * (n110 - n010);
  const x01 = n001 + u * (n101 - n001);
  const x11 = n011 + u * (n111 - n011);
  const y0 = x00 + v * (x10 - x00);
  const y1 = x01 + v * (x11 - x01);
  return y0 + w * (y1 - y0);
}

/** Kachelbares fBm aus Gradientenrauschen auf [0, 1) × Periode; Ergebnis etwa 0..1 (fBm). */
export function gradientFbm3(x: number, y: number, z: number, period: number, octaves: number, seed: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave++) {
    sum += amplitude * gradientNoise3(x * frequency, y * frequency, z * frequency, period * frequency, seed + octave * 131);
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return Math.min(1, Math.max(0, 0.5 + (0.75 * sum) / norm));
}

/** Kachelbares Worley-Rauschen (invertierter Abstand zum nächsten Merkmalspunkt) für `cells` Zellen je Kachel (Zellrauschen). */
export function worley3(x: number, y: number, z: number, cells: number, seed: number): number {
  const px = x * cells;
  const py = y * cells;
  const pz = z * cells;
  const cx = Math.floor(px);
  const cy = Math.floor(py);
  const cz = Math.floor(pz);
  let best = 4;
  for (let oz = -1; oz <= 1; oz++) {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const gx = cx + ox;
        const gy = cy + oy;
        const gz = cz + oz;
        const h = hash3(wrap(gx, cells), wrap(gy, cells), wrap(gz, cells), seed);
        const fx = gx + (h & 0x3ff) / 1024 - px;
        const fy = gy + ((h >>> 10) & 0x3ff) / 1024 - py;
        const fz = gz + ((h >>> 20) & 0x3ff) / 1024 - pz;
        const d = fx * fx + fy * fy + fz * fz;
        if (d < best) {
          best = d;
        }
      }
    }
  }
  return 1 - Math.min(1, Math.sqrt(best));
}

/** Kachelbares 2D-Gradienten-fBm (Wetterkarte); Ergebnis etwa 0..1. */
export function gradientFbm2(x: number, y: number, period: number, octaves: number, seed: number): number {
  return gradientFbm3(x, y, 0.37, period, octaves, seed);
}

/** Kachelbares 2D-Worley-Rauschen (Regenzellen). */
export function worley2(x: number, y: number, cells: number, seed: number): number {
  const px = x * cells;
  const py = y * cells;
  const cx = Math.floor(px);
  const cy = Math.floor(py);
  let best = 4;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const gx = cx + ox;
      const gy = cy + oy;
      const h = hash3(wrap(gx, cells), wrap(gy, cells), 0, seed);
      const fx = gx + (h & 0x7ff) / 2048 - px;
      const fy = gy + ((h >>> 11) & 0x7ff) / 2048 - py;
      const d = fx * fx + fy * fy;
      if (d < best) {
        best = d;
      }
    }
  }
  return 1 - Math.min(1, Math.sqrt(best));
}

/** Lineare Umrechnung von [oldMin, oldMax] nach [newMin, newMax] (Umrechnung). */
export function remap(value: number, oldMin: number, oldMax: number, newMin: number, newMax: number): number {
  return newMin + ((value - oldMin) / (oldMax - oldMin)) * (newMax - newMin);
}
