// shared/world.ts — Weltkonstanten und Zellraster, gemeinsam genutzt von SpacetimeDB-Modul und Browser-Client.
// Reiner Code: keine Importe aus 'spacetimedb', Babylon oder dem DOM.

export const TickHz = 20;
export const TickSeconds = 1 / TickHz;
export const CellSize = 64; // Meter je Interessenzelle
export const WorldHalfExtent = 4096; // Meter vom Ursprung bis zum Weltrand
export const MaxSpeed = 30; // m/s, Obergrenze der Flugsimulation
export const SpeedSlack = 1.25; // Toleranz für Takt- und Netz-Jitter
export const MaxElapsedTicks = TickHz; // Sprungbudget höchstens 1 s, so lang wie der Herzschlag des Clients
export const AngleScale = 32767 / Math.PI; // Winkel (rad) ↔ i16

/** Packt die Zellkoordinaten in einen u32, damit Abos mit einer einzigen Gleichheit filtern (Zellschlüssel). */
export function packCell(x: number, z: number): number {
  const cx = Math.floor((x + WorldHalfExtent) / CellSize) & 0xffff;
  const cz = Math.floor((z + WorldHalfExtent) / CellSize) & 0xffff;
  return ((cx << 16) | cz) >>> 0;
}

/** Mittelpunkt (x, z) einer gepackten Zelle (Zellmitte). */
export function cellCentre(cell: number): { x: number; z: number } {
  const cx = cell >>> 16;
  const cz = cell & 0xffff;
  return {
    x: cx * CellSize - WorldHalfExtent + CellSize / 2,
    z: cz * CellSize - WorldHalfExtent + CellSize / 2,
  };
}

/** Zellschlüssel der (2r+1)²-Nachbarschaft um eine Position (Nachbarzellen). */
export function neighbourCells(x: number, z: number, radius: number): number[] {
  const cx = Math.floor((x + WorldHalfExtent) / CellSize);
  const cz = Math.floor((z + WorldHalfExtent) / CellSize);
  const cells: number[] = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      cells.push(((((cx + dx) & 0xffff) << 16) | ((cz + dz) & 0xffff)) >>> 0);
    }
  }
  return cells;
}

/** Winkel in Radiant → i16 für die Übertragung (Winkelquantisierung). */
export function encodeAngle(radians: number): number {
  const wrapped = Math.atan2(Math.sin(radians), Math.cos(radians)); // auf (-π, π] normieren
  return Math.round(wrapped * AngleScale);
}

/** i16 aus der Übertragung → Winkel in Radiant. */
export function decodeAngle(value: number): number {
  return value / AngleScale;
}
