// shared/islandCatalogTypes.ts — Form des Inselkatalogs, den der Inselgenerator schreibt.
// Reiner Code: keine Importe aus 'spacetimedb', Babylon oder dem DOM.

/** Blumenart eines Blumenfelds (Blumenart). */
export type FlowerSpecies = "daisy" | "poppy" | "lupine" | "buttercup" | "bluebell";

/** Ein Blumenfeld in Modellkoordinaten der Insel: Mittelpunkt auf der Grasnarbe (Blumenfeld). */
export interface FlowerPatchInfo {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Radius des Felds in Metern (Modellmaßstab 1). */
  readonly radius: number;
  readonly species: FlowerSpecies;
  /** Anzahl der Blüten im Feld. */
  readonly flowers: number;
}

/**
 * Höhenfelder für Kollisionen in Modellkoordinaten (Kollisionsfeld): Raster `resolution` ×
 * `resolution` über [−extent, +extent]² in X und Z, Zeilen entlang Z, Spalten entlang X.
 * `top` ist die Oberkante (Grasnarbe), `bottom` die Unterkante (Felsspitzen), beide in Zentimetern;
 * außerhalb des Umrisses steht −32768 in beiden Feldern.
 */
export interface IslandCollisionField {
  readonly resolution: number;
  readonly extent: number;
  /** Base64 eines little-endian Int16Array der Länge resolution². */
  readonly top: string;
  /** Base64 eines little-endian Int16Array der Länge resolution². */
  readonly bottom: string;
}

/** Ein Inselmodell des Katalogs (Inselmodell). */
export interface IslandModelInfo {
  /** Eindeutiger Schlüssel, z. B. "meadow". */
  readonly key: string;
  /** Pfade relativ zu public/assets/models/ für LOD0, LOD1 und LOD2. */
  readonly files: readonly [string, string, string];
  /** Durchmesser des Plateaus in Metern bei Maßstab 1. */
  readonly diameter: number;
  /** Höchster Punkt über dem Ursprung (Kuppe, Baumkronen ausgenommen). */
  readonly topHeight: number;
  /** Tiefe der längsten Felsspitze unter dem Ursprung (positiv). */
  readonly depth: number;
  /** Höchste Baumkrone über dem Ursprung. */
  readonly canopyHeight: number;
  readonly hasPond: boolean;
  /** Fliegennest-Insel (verrottet). */
  readonly isNest: boolean;
  readonly flowerPatches: readonly FlowerPatchInfo[];
  readonly collision: IslandCollisionField;
}
