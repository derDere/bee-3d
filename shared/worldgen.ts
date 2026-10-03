// shared/worldgen.ts — Weltgenerator: Inseln, Blumenfelder, Bienenstöcke und Fliegennester aus dem Weltseed.
// Server und Client erzeugen dieselbe Liste. Nur exakte Gleitkomma-Operationen (+ − × ÷ √) und der
// Ganzzahl-Zufall aus random.ts entscheiden über Lage und Anzahl — keine Winkelfunktionen.
//
// Koordinaten: Babylon-Weltraum (linkshändig, +Y oben). Der Inselkatalog liegt im glTF-Raum
// (rechtshändig); `catalogToLocal` spiegelt X wie der glTF-Lader von Babylon.
import { IslandCatalog } from "./islandCatalog";
import type { FlowerSpecies, IslandModelInfo } from "./islandCatalogTypes";
import { Random } from "./random";
import { PlacementRadius, WorldSeed, packCell } from "./world";

/** Eine platzierte Insel (Inselplatzierung). */
export interface IslandPlacement {
  readonly id: number;
  /** Index in `IslandCatalog`. */
  readonly model: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly scale: number;
  /** Gierdrehung als Einheitsvektor: cos und sin des Winkels um +Y. */
  readonly cos: number;
  readonly sin: number;
  /** Plateau-Radius in Metern (skaliert). */
  readonly radius: number;
  /** Welthöhe der Grasnarbe, der tiefsten Felsspitze und der höchsten Baumkrone. */
  readonly top: number;
  readonly bottom: number;
  readonly canopy: number;
  readonly isNest: boolean;
  readonly firstPatch: number;
  readonly patchCount: number;
}

/** Ein Blumenfeld in Weltkoordinaten (Blumenfeld). */
export interface FlowerPatchPlacement {
  readonly id: number;
  readonly island: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly species: FlowerSpecies;
  readonly flowers: number;
  readonly capacity: number;
  readonly golden: boolean;
  readonly cell: number;
}

/** Ein Bienenstock (Station). */
export interface HivePlacement {
  readonly id: number;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly cos: number;
  readonly sin: number;
  readonly cell: number;
}

/** Ein Fliegennest auf einer Nest-Insel (Fliegennest). */
export interface NestPlacement {
  readonly id: number;
  readonly name: string;
  readonly island: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly hasQueen: boolean;
  readonly cell: number;
}

/** Die vollständige statische Welt (Weltaufbau). */
export interface WorldLayout {
  readonly seed: number;
  readonly islands: readonly IslandPlacement[];
  readonly patches: readonly FlowerPatchPlacement[];
  readonly hives: readonly HivePlacement[];
  readonly nests: readonly NestPlacement[];
}

/** Zielzahl der Inseln. */
export const IslandTarget = 640;
export const HiveHeight = 18;
export const HiveRadius = 8;
/** Flugloch des Stockmodells (Anker EntrancePoint): Abstand entlang der lokalen +Z-Achse und Höhe zur Korbmitte. */
export const HiveEntranceOffset = 7.26;
export const HiveEntranceHeight = -2.75;

const HiveNames: readonly string[] = [
  "Queen's Hive",
  "Linden Hive",
  "Clover Grove",
  "Honeydew",
  "Comb Castle",
  "Sunny Comb",
  "Misty Skep",
  "Storm Comb",
  "Moon Honey",
];

const NestNames: readonly string[] = [
  "Maggot Keep",
  "Mold Hole",
  "Stink Hill",
  "Rot Pit",
  "Slime Roost",
  "Buzz Cauldron",
  "Compost Crown",
  "Gunk Peak",
  "Mud Nest",
  "Yuck Meadow",
  "Rotten Rock",
  "Brood Fog",
];

/** Abstände der Bienenstöcke vom Mittelpunkt; der letzte (Moon Honey) liegt nahe dem Wolkenrand. */
const HiveRadii: readonly number[] = [2100, 2700, 3300, 3900, 4400, 4900, 3600, 5700];
const NestCount = 12;
const ArchipelagoCount = 24;

/** Punkt `distance` Meter vor dem Flugloch eines Stocks (Andockpunkt). */
export function hiveDockPoint(hive: HivePlacement, distance: number): { x: number; y: number; z: number } {
  const offset = rotateYaw(0, HiveEntranceOffset + distance, hive.cos, hive.sin);
  return { x: hive.x + offset.x, y: hive.y + HiveEntranceHeight, z: hive.z + offset.z };
}

/** Wandelt einen Punkt des Inselkatalogs (glTF-Raum) in Babylon-Modellkoordinaten. */
export function catalogToLocal(x: number, y: number, z: number): { x: number; y: number; z: number } {
  return { x: -x, y, z };
}

/** Dreht einen Punkt der Modellebene um +Y (linkshändig wie Babylon: +Z dreht Richtung +X). */
export function rotateYaw(x: number, z: number, cos: number, sin: number): { x: number; z: number } {
  return { x: x * cos + z * sin, z: -x * sin + z * cos };
}

/** Dreht einen Weltpunkt zurück in die Modellebene (Umkehrung von `rotateYaw`). */
export function unrotateYaw(x: number, z: number, cos: number, sin: number): { x: number; z: number } {
  return { x: x * cos - z * sin, z: x * sin + z * cos };
}

/** Senkrechter Zylinder, den eine Insel belegt (Belegung). */
interface Footprint {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly bottom: number;
  readonly top: number;
}

/** Räumliches Raster für die Überlappungsprüfung beim Platzieren (Belegungsraster). */
class FootprintGrid {
  private static readonly Cell = 200;
  private readonly cells = new Map<number, Footprint[]>();

  public add(footprint: Footprint): void {
    const key = FootprintGrid.key(Math.floor(footprint.x / FootprintGrid.Cell), Math.floor(footprint.z / FootprintGrid.Cell));
    const list = this.cells.get(key);
    if (list === undefined) {
      this.cells.set(key, [footprint]);
    } else {
      list.push(footprint);
    }
  }

  /** Prüft, ob ein Zylinder mit Rand `margin` einen vorhandenen schneidet. */
  public collides(candidate: Footprint, margin: number): boolean {
    const reach = candidate.radius + 120 + margin;
    const minX = Math.floor((candidate.x - reach) / FootprintGrid.Cell);
    const maxX = Math.floor((candidate.x + reach) / FootprintGrid.Cell);
    const minZ = Math.floor((candidate.z - reach) / FootprintGrid.Cell);
    const maxZ = Math.floor((candidate.z + reach) / FootprintGrid.Cell);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        for (const other of this.cells.get(FootprintGrid.key(cx, cz)) ?? []) {
          const dx = other.x - candidate.x;
          const dz = other.z - candidate.z;
          const limit = other.radius + candidate.radius + margin;
          if (dx * dx + dz * dz >= limit * limit) {
            continue;
          }
          if (candidate.bottom - margin < other.top && other.bottom - margin < candidate.top) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private static key(cx: number, cz: number): number {
    return (cx + 1000) * 4096 + (cz + 1000);
  }
}

/** Wählt einen Zieldurchmesser nach der Größenverteilung der Spec. */
function targetDiameter(random: Random, bias: "small" | "mixed" | "large"): number {
  const roll = bias === "small" ? random.next() * 0.8 : bias === "large" ? 0.45 + random.next() * 0.55 : random.next();
  if (roll < 0.45) {
    return random.range(10, 25);
  }
  if (roll < 0.8) {
    return random.range(25, 55);
  }
  return random.range(55, 100);
}

/** Generator der statischen Welt (Weltgenerator). */
class WorldGenerator {
  private readonly random: Random;
  private readonly catalog: readonly IslandModelInfo[];
  private readonly grid = new FootprintGrid();
  private readonly islands: IslandPlacement[] = [];
  private readonly patches: FlowerPatchPlacement[] = [];
  private readonly hives: HivePlacement[] = [];
  private readonly nests: NestPlacement[] = [];
  private readonly landModels: number[] = [];
  private readonly nestModels: number[] = [];

  public constructor(seed: number, catalog: readonly IslandModelInfo[]) {
    this.random = new Random(seed);
    this.catalog = catalog;
    catalog.forEach((model, index) => (model.isNest ? this.nestModels : this.landModels).push(index));
    if (this.landModels.length === 0) {
      throw new Error("Inselkatalog ohne Landinseln");
    }
  }

  public generate(seed: number): WorldLayout {
    this.placeHives();
    this.placeNests();
    for (const hive of this.hives) {
      this.placeCluster(hive.x, hive.y, hive.z, 7, 110, 420, 60, 140, "small", 70);
    }
    for (let i = 0; i < ArchipelagoCount && this.islands.length < IslandTarget; i++) {
      const centre = this.randomSpherePoint(PlacementRadius - 300);
      const count = 10 + this.random.int(17);
      const horizontal = this.random.range(300, 800);
      const vertical = this.random.range(80, 300);
      this.placeCluster(centre.x, centre.y, centre.z, count, 0, horizontal, vertical, vertical, "mixed", 0);
    }
    let attempts = 0;
    while (this.islands.length < IslandTarget && attempts < 20000) {
      attempts++;
      const point = this.randomSpherePoint(PlacementRadius);
      this.tryPlaceIsland(point.x, point.y, point.z, targetDiameter(this.random, "mixed"), false);
    }
    return { seed, islands: this.islands, patches: this.patches, hives: this.hives, nests: this.nests };
  }

  /** Zufallspunkt in der Kugel, gleichverteilt im Volumen bis `maxRadius` vom Mittelpunkt. */
  private randomSpherePoint(maxRadius: number): { x: number; y: number; z: number } {
    const [x, y, z] = this.random.inUnitSphere();
    return { x: x * maxRadius, y: y * maxRadius, z: z * maxRadius };
  }

  private placeHives(): void {
    this.addHive(0, 0, 120, 0, 0, 1);
    // Acht Stöcke in alle Raumrichtungen: Würfelecken als exakte Richtungen, je Stock leicht verschoben.
    const c = 1 / Math.sqrt(3);
    const directions: readonly (readonly [number, number, number])[] = [
      [c, c, c], [-c, c, -c], [c, -c, -c], [-c, -c, c], [c, c, -c], [-c, c, c], [c, -c, c], [-c, -c, -c],
    ];
    for (let i = 0; i < directions.length; i++) {
      const [dx, dy, dz] = directions[i] ?? [1, 0, 0];
      const [jx, jy, jz] = this.random.inUnitSphere();
      let ux = dx + jx * 0.25;
      let uy = dy * 0.7 + jy * 0.25;
      let uz = dz + jz * 0.25;
      const length = Math.sqrt(ux * ux + uy * uy + uz * uz);
      ux /= length;
      uy /= length;
      uz /= length;
      const radius = HiveRadii[i] ?? 3000;
      const [cos, sin] = this.random.unitXZ();
      this.addHive(i + 1, ux * radius, uy * radius, uz * radius, cos, sin);
    }
  }

  private addHive(id: number, x: number, y: number, z: number, cos: number, sin: number): void {
    this.hives.push({ id, name: HiveNames[id] ?? `Stock ${id}`, x, y, z, cos, sin, cell: packCell(x, z) });
    this.grid.add({ x, z, radius: HiveRadius + 40, bottom: y - HiveHeight, top: y + HiveHeight });
  }

  private placeNests(): void {
    const model = this.nestModels[0] ?? this.landModels[0] ?? 0;
    let attempts = 0;
    while (this.nests.length < NestCount && attempts < 4000) {
      attempts++;
      const isQueen = this.nests.length === 0;
      const point = isQueen ? this.queenPoint() : this.randomSpherePoint(PlacementRadius - 100);
      const distanceFromCentre = Math.sqrt(point.x * point.x + point.z * point.z);
      if (!isQueen && distanceFromCentre < 1500) {
        continue;
      }
      if (this.hives.some((hive) => sq(hive.x - point.x, hive.y - point.y, hive.z - point.z) < 900 * 900)) {
        continue;
      }
      if (this.nests.some((nest) => sq(nest.x - point.x, nest.y - point.y, nest.z - point.z) < 700 * 700)) {
        continue;
      }
      const scale = isQueen ? 1.5 : this.random.range(1.0, 1.35);
      const island = this.tryPlaceModel(model, point.x, point.y, point.z, scale, true);
      if (island === undefined) {
        continue;
      }
      const id = this.nests.length;
      this.nests.push({
        id,
        name: NestNames[id] ?? `Nest ${id}`,
        island: island.id,
        x: island.x,
        y: island.top + 2,
        z: island.z,
        hasQueen: isQueen,
        cell: packCell(island.x, island.z),
      });
    }
  }

  /** Lage von Maggot Keep: nahe dem Wolkenrand, gegenüber dem Stock Moon Honey. */
  private queenPoint(): { x: number; y: number; z: number } {
    const moon = this.hives[this.hives.length - 1];
    const length = moon === undefined ? 1 : Math.sqrt(moon.x * moon.x + moon.y * moon.y + moon.z * moon.z);
    const ux = moon === undefined ? 1 : -moon.x / length;
    const uy = moon === undefined ? 0 : -moon.y / length;
    const uz = moon === undefined ? 0 : -moon.z / length;
    const radius = PlacementRadius - 150;
    return { x: ux * radius + this.random.range(-150, 150), y: uy * radius + this.random.range(-150, 150), z: uz * radius + this.random.range(-150, 150) };
  }

  /** Setzt bis zu `count` Inseln in eine Ellipsoidschale um einen Mittelpunkt. */
  private placeCluster(
    cx: number,
    cy: number,
    cz: number,
    count: number,
    minRadius: number,
    maxRadius: number,
    below: number,
    above: number,
    bias: "small" | "mixed" | "large",
    margin: number,
  ): void {
    let placed = 0;
    for (let attempt = 0; attempt < count * 12 && placed < count && this.islands.length < IslandTarget; attempt++) {
      const [ux, uz] = this.random.unitXZ();
      const t = Math.sqrt(this.random.next());
      const radius = minRadius + (maxRadius - minRadius) * t;
      const dy = this.random.range(-below, above);
      const x = cx + ux * radius;
      const z = cz + uz * radius;
      const y = cy + dy;
      if (x * x + y * y + z * z > PlacementRadius * PlacementRadius) {
        continue;
      }
      if (this.tryPlaceIsland(x, y, z, targetDiameter(this.random, bias), false, margin) !== undefined) {
        placed++;
      }
    }
  }

  /** Wählt ein Landmodell für den Zieldurchmesser und versucht die Platzierung. */
  private tryPlaceIsland(x: number, y: number, z: number, diameter: number, isNest: boolean, margin = 0): IslandPlacement | undefined {
    const candidates = this.landModels.filter((index) => {
      const ratio = diameter / (this.catalog[index]?.diameter ?? 1);
      return ratio >= 0.6 && ratio <= 1.6;
    });
    const model = candidates.length > 0 ? this.random.pick(candidates) : this.closestModel(diameter);
    const modelDiameter = this.catalog[model]?.diameter ?? diameter;
    const scale = Math.min(1.6, Math.max(0.6, diameter / modelDiameter));
    return this.tryPlaceModel(model, x, y, z, scale, isNest, margin);
  }

  private closestModel(diameter: number): number {
    let best = this.landModels[0] ?? 0;
    let bestError = Number.POSITIVE_INFINITY;
    for (const index of this.landModels) {
      const error = Math.abs((this.catalog[index]?.diameter ?? 0) - diameter);
      if (error < bestError) {
        bestError = error;
        best = index;
      }
    }
    return best;
  }

  private tryPlaceModel(model: number, x: number, y: number, z: number, scale: number, isNest: boolean, margin = 0): IslandPlacement | undefined {
    const info = this.catalog[model];
    if (info === undefined) {
      return undefined;
    }
    const radius = (info.diameter / 2) * scale;
    const footprint: Footprint = { x, z, radius: radius * 1.1 + 6, bottom: y - info.depth * scale - 4, top: y + info.canopyHeight * scale + 4 };
    if (x * x + y * y + z * z > (PlacementRadius + 150) * (PlacementRadius + 150) || this.grid.collides(footprint, 8 + margin)) {
      return undefined;
    }
    this.grid.add(footprint);
    const [cos, sin] = this.random.unitXZ();
    const id = this.islands.length;
    const firstPatch = this.patches.length;
    if (!isNest) {
      this.addPatches(info, id, x, y, z, scale, cos, sin);
    }
    const island: IslandPlacement = {
      id,
      model,
      x,
      y,
      z,
      scale,
      cos,
      sin,
      radius,
      top: y + info.topHeight * scale,
      bottom: y - info.depth * scale,
      canopy: y + info.canopyHeight * scale,
      isNest,
      firstPatch,
      patchCount: this.patches.length - firstPatch,
    };
    this.islands.push(island);
    return island;
  }

  private addPatches(info: IslandModelInfo, island: number, x: number, y: number, z: number, scale: number, cos: number, sin: number): void {
    const sizeFactor = Math.min(1.4, Math.max(0.7, scale));
    for (const patch of info.flowerPatches) {
      const local = catalogToLocal(patch.x, patch.y, patch.z);
      const rotated = rotateYaw(local.x * scale, local.z * scale, cos, sin);
      const px = x + rotated.x;
      const pz = z + rotated.z;
      this.patches.push({
        id: this.patches.length,
        island,
        x: px,
        y: y + local.y * scale,
        z: pz,
        radius: patch.radius * scale,
        species: patch.species,
        flowers: patch.flowers,
        capacity: Math.round((60 + 140 * this.random.next()) * sizeFactor),
        golden: this.random.chance(0.02),
        cell: packCell(px, pz),
      });
    }
  }
}

function sq(dx: number, dy: number, dz: number): number {
  return dx * dx + dy * dy + dz * dz;
}

/** Erzeugt die statische Welt aus Seed und Inselkatalog (Weltaufbau). */
export function generateWorld(seed: number = WorldSeed, catalog: readonly IslandModelInfo[] = IslandCatalog): WorldLayout {
  return new WorldGenerator(seed, catalog).generate(seed);
}
