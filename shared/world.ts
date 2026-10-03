// shared/world.ts — Weltkonstanten, Weltgrenze und Zellraster, gemeinsam für SpacetimeDB-Modul und Client.
// Reiner Code: keine Importe aus 'spacetimedb', Babylon oder dem DOM.

/** Seed der Spielwelt: bestimmt Inseln, Blumenfelder, Nester und Wetterplan (Weltseed). */
export const WorldSeed = 0x0bee3d;

// ---------- Weltkugel ----------

/** Radius der Weltkugel um den Ursprung in Metern (Durchmesser 14 km). Die Grenze ist allein der Abstand zu (0, 0, 0). */
export const WorldRadius = 7000;
/** Ab diesem Abstand vor der Grenze drücken Böen die Biene zurück und die Wolken verdichten sich. */
export const BoundaryPushZone = 400;
/** Sicherheitsabstand der harten (unsichtbaren) Grenze zur Kugeloberfläche. */
export const BoundaryMargin = 60;
/** Inseln, Stöcke und Nester liegen höchstens so weit vom Mittelpunkt entfernt. */
export const PlacementRadius = 6100;

// ---------- Takt und Interessenzellen ----------

export const TickHz = 20;
export const TickSeconds = 1 / TickHz;
/** Meter je Interessenzelle; Radius 1 ergibt 768 m Sichtbereich. */
export const CellSize = 256;
/** Verschiebung der Zellkoordinaten in den positiven Bereich (größer als der Weltradius). */
export const CellOffset = 8192;
/** Winkel (rad) ↔ i16. */
export const AngleScale = 32767 / Math.PI;

// ---------- Bewegung und Prüfung ----------

/** Höchsttempo ohne Warp inklusive Boost und Upgrades, mit Reserve (Prüfgrenze des Servers). */
export const MaxCruiseSpeed = 48;
/** Warp-Tempo. */
export const WarpSpeed = 320;
/** Prüfgrenze während eines Warps. */
export const MaxWarpSpeed = 400;
/** Toleranz für Takt- und Netz-Jitter. */
export const SpeedSlack = 1.25;
/** Sprungbudget höchstens 1 s, so lang wie der Herzschlag des Clients. */
export const MaxElapsedTicks = TickHz;
/**
 * Bewegungsbudget (Token-Bucket) in Sekunden Höchsttempo: gleicht unregelmäßig eintreffende Posen aus,
 * ohne die Durchschnittsgeschwindigkeit über das Höchsttempo zu heben.
 */
export const MoveBudgetSeconds = 0.5;
/** Mindestabstand eines Warp-Ziels. */
export const WarpMinDistance = 150;
/** Abstand, in dem ein Warp vor dem Ziel endet. */
export const WarpLandingDistance = 15;

/** Packt die Zellkoordinaten in einen u32, damit Abos mit einer einzigen Gleichheit filtern (Zellschlüssel). */
export function packCell(x: number, z: number): number {
  const cx = Math.floor((x + CellOffset) / CellSize) & 0xffff;
  const cz = Math.floor((z + CellOffset) / CellSize) & 0xffff;
  return ((cx << 16) | cz) >>> 0;
}

/** Mittelpunkt (x, z) einer gepackten Zelle (Zellmitte). */
export function cellCentre(cell: number): { x: number; z: number } {
  const cx = cell >>> 16;
  const cz = cell & 0xffff;
  return {
    x: cx * CellSize - CellOffset + CellSize / 2,
    z: cz * CellSize - CellOffset + CellSize / 2,
  };
}

/** Zellschlüssel der (2r+1)²-Nachbarschaft um eine Position (Nachbarzellen). */
export function neighbourCells(x: number, z: number, radius: number): number[] {
  const cx = Math.floor((x + CellOffset) / CellSize);
  const cz = Math.floor((z + CellOffset) / CellSize);
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
  return Math.max(-32767, Math.min(32767, Math.round(wrapped * AngleScale)));
}

/** i16 aus der Übertragung → Winkel in Radiant. */
export function decodeAngle(value: number): number {
  return value / AngleScale;
}

/**
 * Wie weit ein Punkt außerhalb der erlaubten Kugel liegt (Grenzüberschreitung): positiv = jenseits der
 * unsichtbaren harten Grenze, negativ = Abstand zur Grenze.
 */
export function boundaryOverflow(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z) - (WorldRadius - BoundaryMargin);
}

/** Schiebt einen Punkt auf die erlaubte Seite der Kugelgrenze zurück (Grenzklemme). */
export function clampToWorld(x: number, y: number, z: number): { x: number; y: number; z: number } {
  const limit = WorldRadius - BoundaryMargin;
  const r = Math.sqrt(x * x + y * y + z * z);
  if (r <= limit) {
    return { x, y, z };
  }
  const k = limit / r;
  return { x: x * k, y: y * k, z: z * k };
}

/**
 * Stärke des Grenzdrucks 0..1 (Böenstärke): 0 tief im Inneren, 1 an der harten Grenze. Treibt die
 * Rückstoßkraft des Clients und die Wolkenverdichtung um die Biene.
 */
export function boundaryPressure(x: number, y: number, z: number): number {
  const overflow = boundaryOverflow(x, y, z);
  return Math.min(1, Math.max(0, 1 + overflow / BoundaryPushZone));
}

/** Abstand zweier Punkte. */
export function distance3(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
