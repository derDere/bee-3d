import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { ClearingCount, MistVolumeCount, type CloudFrameParams } from "./cloudRenderer";
import { CloudMedium } from "./cloudMedium";
import { DetailSize, ShapeSize, WeatherSize, type CloudNoiseData } from "./noise/cloudNoiseData";
import { mix, remap, saturate, smoothstep } from "./skyMath";

/** Ergebnis einer Dichteabfrage an einem Punkt (Dichteprobe). */
export interface CloudSample {
  /** Dichte des Mediums wie im Raymarcher (0 = klare Luft, 1 ≈ Wolkenkern). */
  density: number;
  /** Tiefe in der Wolkenmasse 0..1. */
  body: number;
  /** Anteil Regenzelle (Gewitterwolke) 0..1. */
  rainCell: number;
}

/** Trilineare Abtastung eines kachelnden 8-Bit-Volumens wie die GPU (wiederholend, Texelmitten bei (i + 0,5) / n). */
function sampleVolume(data: Uint8Array, size: number, u: number, v: number, w: number): number {
  const mask = size - 1;
  const x = u * size - 0.5;
  const y = v * size - 0.5;
  const z = w * size - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fy = y - y0;
  const fz = z - z0;
  const ix0 = x0 & mask;
  const ix1 = (x0 + 1) & mask;
  const row0 = (y0 & mask) * size;
  const row1 = ((y0 + 1) & mask) * size;
  const slice0 = (z0 & mask) * size * size;
  const slice1 = ((z0 + 1) & mask) * size * size;
  const c000 = data[ix0 + row0 + slice0] ?? 0;
  const c100 = data[ix1 + row0 + slice0] ?? 0;
  const c010 = data[ix0 + row1 + slice0] ?? 0;
  const c110 = data[ix1 + row1 + slice0] ?? 0;
  const c001 = data[ix0 + row0 + slice1] ?? 0;
  const c101 = data[ix1 + row0 + slice1] ?? 0;
  const c011 = data[ix0 + row1 + slice1] ?? 0;
  const c111 = data[ix1 + row1 + slice1] ?? 0;
  const x00 = c000 + (c100 - c000) * fx;
  const x10 = c010 + (c110 - c010) * fx;
  const x01 = c001 + (c101 - c001) * fx;
  const x11 = c011 + (c111 - c011) * fx;
  const y0v = x00 + (x10 - x00) * fy;
  const y1v = x01 + (x11 - x01) * fy;
  return (y0v + (y1v - y0v) * fz) / 255;
}

/** Bilineare Abtastung eines Kanals der kachelnden RGBA-Wetterkarte wie die GPU. */
function sampleWeather(data: Uint8Array, channel: number, u: number, v: number): number {
  const size = WeatherSize;
  const mask = size - 1;
  const x = u * size - 0.5;
  const y = v * size - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const ix0 = x0 & mask;
  const ix1 = (x0 + 1) & mask;
  const row0 = (y0 & mask) * size;
  const row1 = ((y0 + 1) & mask) * size;
  const c00 = data[(ix0 + row0) * 4 + channel] ?? 0;
  const c10 = data[(ix1 + row0) * 4 + channel] ?? 0;
  const c01 = data[(ix0 + row1) * 4 + channel] ?? 0;
  const c11 = data[(ix1 + row1) * 4 + channel] ?? 0;
  const top = c00 + (c10 - c00) * fx;
  const bottom = c01 + (c11 - c01) * fx;
  return (top + (bottom - top) * fy) / 255;
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

/** Kanäle der Wetterkarte: Wolkenfelder (R) und Regenzellen (B). */
const ClusterChannel = 0;
const RainCellChannel = 2;

function fract(x: number): number {
  return x - Math.floor(x);
}

/**
 * CPU-Gegenstück der Dichtefunktion des Raymarchers (Wolkendichtefeld): dieselben Rauschdaten wie die GPU,
 * dieselben Formeln wie `clearingFactor`, `coverageAt`, `massNoise`, `mistDensity` und `cloudDensity` in `shaders/cloudMarch.ts`,
 * dieselben Konstanten aus `cloudMedium.ts` und dieselben Frame-Werte (`CloudFrameParams`) wie der Renderer.
 * Dient Flug-im-Wolken-Effekten, der Blitzregie und Sichtbarkeitsprüfungen ohne GPU-Rücklesen.
 */
export class CloudDensityField {
  private readonly shape: Uint8Array;
  private readonly detail: Uint8Array;
  private readonly weather: Uint8Array;
  private params: CloudFrameParams | undefined;
  private readonly scratch: CloudSample = { density: 0, body: 0, rainCell: 0 };

  public constructor(noise: CloudNoiseData) {
    if (!isPowerOfTwo(ShapeSize) || !isPowerOfTwo(DetailSize) || !isPowerOfTwo(WeatherSize)) {
      throw new Error("Rauschvolumen brauchen Zweierpotenz-Kantenlängen.");
    }
    this.shape = noise.shape;
    this.detail = noise.detail;
    this.weather = noise.weather;
  }

  /** Übernimmt die Frame-Werte, die auch der Raymarcher in diesem Frame bekommt. */
  public setFrame(params: CloudFrameParams): void {
    this.params = params;
  }

  /** Ob Frame-Werte vorliegen. */
  public get isReady(): boolean {
    return this.params !== undefined;
  }

  /** Dichte, Massentiefe und Regenzellen-Anteil am Punkt (wie `cloudDensity(p, lod, true, …)` im Shader). */
  public sample(x: number, y: number, z: number, result: CloudSample): CloudSample {
    result.density = 0;
    result.body = 0;
    result.rainCell = 0;
    const p = this.params;
    if (p === undefined) {
      return result;
    }
    const r = Math.sqrt(x * x + y * y + z * z);
    const topOpen = smoothstep(CloudMedium.rimOpenFrom, CloudMedium.rimOpenTo, y / Math.max(r, 1)) * p.topOpenness;

    // coverageAt
    const weatherU = x / CloudMedium.weatherTileMeters + p.massOffset.x * CloudMedium.weatherDrift;
    const weatherV = z / CloudMedium.weatherTileMeters + p.massOffset.z * CloudMedium.weatherDrift;
    const cluster = sampleWeather(this.weather, ClusterChannel, weatherU, weatherV);
    let cover = p.coverage - (y / CloudMedium.depthBiasMeters) * p.depthBias + (cluster - 0.5) * CloudMedium.clusterStrength;
    const spacing = CloudMedium.layerSpacingMeters;
    const phase = fract((y + cluster * spacing) / spacing);
    const profile = smoothstep(0, CloudMedium.layerBaseSoftness, phase) * (1 - smoothstep(CloudMedium.layerTopTaperStart, 1, phase));
    let rainCell = 0;
    if (p.stormCoverage > 0.001) {
      const cell = sampleWeather(this.weather, RainCellChannel, weatherU, weatherV);
      rainCell = saturate(remap(cell, 1 - p.stormCoverage, 1, 0, 1));
    }
    cover = cover * mix(profile, 1, rainCell) + rainCell * CloudMedium.rainCellCoverage;
    const edge = smoothstep(p.worldRadius - p.boundaryRamp, p.worldRadius + CloudMedium.boundaryOvershootMeters, r);
    const rimCover = mix(CloudMedium.boundaryCoverage, cover + CloudMedium.rimTopExtraCoverage, topOpen);
    cover = saturate(mix(cover, rimCover, edge)) * this.clearingFactor(x, y, z, p);
    result.rainCell = rainCell;

    // massNoise(p, true)
    const cu = x / p.massTile + p.massOffset.x;
    const cv = (y * p.verticalSquash) / p.massTile + p.massOffset.y;
    const cw = z / p.massTile + p.massOffset.z;
    const [ox, oy, oz] = CloudMedium.massOctaveOffset;
    const octaveScale = CloudMedium.massOctaveScale;
    const a = sampleVolume(this.shape, ShapeSize, cu, cv, cw);
    const b = sampleVolume(this.shape, ShapeSize, cu * octaveScale + ox, cv * octaveScale + oy, cw * octaveScale + oz);
    const mass = mix(a, b, CloudMedium.massOctaveWeight);
    const body = saturate((mass - (1 - cover)) / CloudMedium.bodyRamp);
    result.body = body;
    let mist = p.mist.length > 0 ? this.mistDensity(x, y, z, p) : 0;
    if (body <= 0 && mist <= 0) {
      return result;
    }

    const so = p.shapeOffset;
    const shapeTile = CloudMedium.shapeTileMeters;
    const shape = sampleVolume(this.shape, ShapeSize, (x + so.x) / shapeTile, (y + so.y) / shapeTile, (z + so.z) / shapeTile);
    let base = saturate(remap(body, (1 - shape) * CloudMedium.shapeThreshold, 1, 0, 1)) * mix(CloudMedium.shapeDensityFloor, 1, shape);
    mist *= mix(CloudMedium.mistShapeFloor, 1, shape);
    if (base > 0) {
      const drift = CloudMedium.detailDrift;
      const detailTile = CloudMedium.detailTileMeters;
      const detail = sampleVolume(this.detail, DetailSize, (x + so.x * drift) / detailTile, (y + so.y * drift) / detailTile, (z + so.z * drift) / detailTile);
      const erode = mix(1 - detail, detail, body) * p.erosion;
      base = saturate(remap(base, erode, 1, 0, 1));
      mist *= mix(CloudMedium.mistDetailFloor, 1, detail);
    }
    const edgeBoost = 1 + p.boundaryDensity * smoothstep(p.worldRadius - p.boundaryRamp, p.worldRadius, r) * (1 - topOpen);
    result.density = base * p.density * edgeBoost * (1 + rainCell * p.stormDensityBoost) + mist;
    return result;
  }

  /** Dichte am Punkt (Kurzform von `sample`). */
  public density(x: number, y: number, z: number): number {
    return this.sample(x, y, z, this.scratch).density;
  }

  /**
   * Transmission des Mediums zwischen zwei Punkten (Sichtbarkeit durch Wolken), mit `steps` Stichproben in
   * Streckenmitte. Grobe Abschätzung für Effekte; der Raymarcher bleibt das Maß für das Bild.
   */
  public transmittance(from: Vector3, to: Vector3, steps: number): number {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length <= 0 || steps <= 0) {
      return 1;
    }
    const segment = length / steps;
    let opticalDepth = 0;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      opticalDepth += this.density(from.x + dx * t, from.y + dy * t, from.z + dz * t) * CloudMedium.extinctionPerDensity * segment;
    }
    return Math.exp(-opticalDepth);
  }

  // clearingFactor
  private clearingFactor(x: number, y: number, z: number, p: CloudFrameParams): number {
    let factor = 1;
    const count = Math.min(ClearingCount, p.clearings.length);
    for (let i = 0; i < count; i++) {
      const clearing = p.clearings[i];
      if (clearing === undefined) {
        continue;
      }
      const dx = x - clearing.x;
      const dy = y - clearing.y;
      const dz = z - clearing.z;
      const distanceSquared = dx * dx + dy * dy + dz * dz;
      if (distanceSquared < clearing.radius * clearing.radius) {
        factor = Math.min(factor, smoothstep(clearing.radius * CloudMedium.clearingInner, clearing.radius, Math.sqrt(distanceSquared)));
      }
    }
    return factor;
  }

  // mistDensity
  private mistDensity(x: number, y: number, z: number, p: CloudFrameParams): number {
    let m = 0;
    const count = Math.min(MistVolumeCount, p.mist.length);
    for (let i = 0; i < count; i++) {
      const volume = p.mist[i];
      if (volume === undefined) {
        continue;
      }
      const dx = x - volume.x;
      const dy = (y - volume.y) * volume.flatten;
      const dz = z - volume.z;
      const q = Math.sqrt(dx * dx + dy * dy + dz * dz) / volume.radius;
      m += saturate((1 - q) / Math.max(volume.softness, CloudMedium.mistMinSoftness)) * volume.density;
    }
    return m;
  }
}
