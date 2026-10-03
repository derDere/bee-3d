// shared/worldIndex.ts — Nachbarschaftssuche und Inselkollision über dem Weltaufbau.
import { IslandCatalog } from "./islandCatalog";
import type { IslandCollisionField, IslandModelInfo } from "./islandCatalogTypes";
import type { FlowerPatchPlacement, IslandPlacement, WorldLayout } from "./worldgen";
import { unrotateYaw } from "./worldgen";

const IndexCellSize = 128;

/** Dekodiertes Höhenfeld eines Inselmodells in Metern, X gespiegelt in Babylon-Modellkoordinaten (Höhenfeld). */
interface DecodedField {
  readonly resolution: number;
  readonly extent: number;
  readonly top: Float32Array;
  readonly bottom: Float32Array;
}

/** Ober- und Unterkante einer Insel an einer Stelle (Inselschnitt). */
export interface IslandSurface {
  readonly top: number;
  readonly bottom: number;
}

const Base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Dekodiert Base64 ohne Browser- oder Node-API (läuft auch im SpacetimeDB-Modul). */
export function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, "");
  const output = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const char of clean) {
    buffer = (buffer << 6) | Base64Alphabet.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output[index++] = (buffer >> bits) & 0xff;
    }
  }
  return output.subarray(0, index);
}

function decodeHeights(text: string, count: number): Float32Array {
  const bytes = decodeBase64(text);
  const result = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const low = bytes[2 * i] ?? 0;
    const high = bytes[2 * i + 1] ?? 0;
    const value = ((high << 8) | low) << 16 >> 16; // vorzeichenbehaftetes Int16, little-endian
    result[i] = value === -32768 ? Number.NaN : value / 100;
  }
  return result;
}

function decodeField(field: IslandCollisionField): DecodedField {
  const count = field.resolution * field.resolution;
  return {
    resolution: field.resolution,
    extent: field.extent,
    top: decodeHeights(field.top, count),
    bottom: decodeHeights(field.bottom, count),
  };
}

/** Räumlicher Index des Weltaufbaus (Weltindex). */
export class WorldIndex {
  public readonly layout: WorldLayout;
  private readonly islandCells = new Map<number, number[]>();
  private readonly patchCells = new Map<number, number[]>();
  private readonly fields = new Map<number, DecodedField>();
  private readonly catalog: readonly IslandModelInfo[];

  public constructor(layout: WorldLayout, catalog: readonly IslandModelInfo[] = IslandCatalog) {
    this.layout = layout;
    this.catalog = catalog;
    for (const island of layout.islands) {
      const reach = island.radius;
      for (let cx = WorldIndex.cell(island.x - reach); cx <= WorldIndex.cell(island.x + reach); cx++) {
        for (let cz = WorldIndex.cell(island.z - reach); cz <= WorldIndex.cell(island.z + reach); cz++) {
          WorldIndex.push(this.islandCells, WorldIndex.key(cx, cz), island.id);
        }
      }
    }
    for (const patch of layout.patches) {
      WorldIndex.push(this.patchCells, WorldIndex.key(WorldIndex.cell(patch.x), WorldIndex.cell(patch.z)), patch.id);
    }
  }

  /** Inseln, deren Umriss in den Kreis (x, z, radius) reicht. */
  public islandsNear(x: number, z: number, radius: number): IslandPlacement[] {
    const found = new Set<number>();
    for (let cx = WorldIndex.cell(x - radius); cx <= WorldIndex.cell(x + radius); cx++) {
      for (let cz = WorldIndex.cell(z - radius); cz <= WorldIndex.cell(z + radius); cz++) {
        for (const id of this.islandCells.get(WorldIndex.key(cx, cz)) ?? []) {
          found.add(id);
        }
      }
    }
    const result: IslandPlacement[] = [];
    for (const id of found) {
      const island = this.layout.islands[id];
      if (island !== undefined) {
        const dx = island.x - x;
        const dz = island.z - z;
        const reach = island.radius + radius;
        if (dx * dx + dz * dz <= reach * reach) {
          result.push(island);
        }
      }
    }
    return result;
  }

  /** Blumenfelder im Kugelradius um einen Punkt. */
  public patchesNear(x: number, y: number, z: number, radius: number): FlowerPatchPlacement[] {
    const result: FlowerPatchPlacement[] = [];
    for (let cx = WorldIndex.cell(x - radius); cx <= WorldIndex.cell(x + radius); cx++) {
      for (let cz = WorldIndex.cell(z - radius); cz <= WorldIndex.cell(z + radius); cz++) {
        for (const id of this.patchCells.get(WorldIndex.key(cx, cz)) ?? []) {
          const patch = this.layout.patches[id];
          if (patch !== undefined) {
            const dx = patch.x - x;
            const dy = patch.y - y;
            const dz = patch.z - z;
            if (dx * dx + dy * dy + dz * dz <= radius * radius) {
              result.push(patch);
            }
          }
        }
      }
    }
    return result;
  }

  /**
   * Ober- und Unterkante einer Insel über dem Weltpunkt (x, z) oder undefined außerhalb ihres
   * Umrisses (Inselschnitt). Bilinear im Höhenfeld des Modells.
   */
  public surfaceAt(island: IslandPlacement, x: number, z: number): IslandSurface | undefined {
    const field = this.field(island.model);
    if (field === undefined) {
      return undefined;
    }
    const local = unrotateYaw(x - island.x, z - island.z, island.cos, island.sin);
    // Babylon-Modellraum → glTF-Raum des Felds (X gespiegelt), dann in Maßstab 1.
    const gx = -local.x / island.scale;
    const gz = local.z / island.scale;
    const n = field.resolution;
    const u = ((gx + field.extent) / (2 * field.extent)) * (n - 1);
    const v = ((gz + field.extent) / (2 * field.extent)) * (n - 1);
    if (u < 0 || v < 0 || u > n - 1 || v > n - 1) {
      return undefined;
    }
    const i0 = Math.floor(u);
    const j0 = Math.floor(v);
    const i1 = Math.min(n - 1, i0 + 1);
    const j1 = Math.min(n - 1, j0 + 1);
    const fu = u - i0;
    const fv = v - j0;
    const top = bilinear(field.top, n, i0, j0, i1, j1, fu, fv);
    const bottom = bilinear(field.bottom, n, i0, j0, i1, j1, fu, fv);
    if (Number.isNaN(top) || Number.isNaN(bottom)) {
      return undefined;
    }
    return { top: island.y + top * island.scale, bottom: island.y + bottom * island.scale };
  }

  /**
   * Wie tief ein Punkt in einer Insel steckt (Eindringtiefe): positiv innerhalb des Körpers
   * (Meter bis zur Oberkante), sonst 0. Liefert zusätzlich die Oberkante für das Hinausschieben.
   */
  public penetration(x: number, y: number, z: number, clearance: number): { depth: number; top: number } | undefined {
    for (const island of this.islandsNear(x, z, 2)) {
      if (y > island.canopy + clearance || y < island.bottom - clearance) {
        continue;
      }
      const surface = this.surfaceAt(island, x, z);
      if (surface === undefined) {
        continue;
      }
      if (y < surface.top + clearance && y > surface.bottom - clearance) {
        return { depth: surface.top + clearance - y, top: surface.top };
      }
    }
    return undefined;
  }

  private field(model: number): DecodedField | undefined {
    let field = this.fields.get(model);
    if (field === undefined) {
      const info = this.catalog[model];
      if (info === undefined) {
        return undefined;
      }
      field = decodeField(info.collision);
      this.fields.set(model, field);
    }
    return field;
  }

  private static cell(value: number): number {
    return Math.floor(value / IndexCellSize);
  }

  private static key(cx: number, cz: number): number {
    return (cx + 2048) * 8192 + (cz + 2048);
  }

  private static push(map: Map<number, number[]>, key: number, id: number): void {
    const list = map.get(key);
    if (list === undefined) {
      map.set(key, [id]);
    } else {
      list.push(id);
    }
  }
}

function bilinear(values: Float32Array, n: number, i0: number, j0: number, i1: number, j1: number, fu: number, fv: number): number {
  const a = values[j0 * n + i0] ?? Number.NaN;
  const b = values[j0 * n + i1] ?? Number.NaN;
  const c = values[j1 * n + i0] ?? Number.NaN;
  const d = values[j1 * n + i1] ?? Number.NaN;
  return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
}
