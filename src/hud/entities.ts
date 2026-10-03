// src/hud/entities.ts — Darstellung der Objektarten: Schlüssel, Farbklassen, Namen, Aufschaltbarkeit.

import type { EntityRef, EntityType } from "./hudTypes";

const TypeIndex: Readonly<Record<EntityType, number>> = {
  bee: 1,
  fly: 2,
  flowerPatch: 3,
  hive: 4,
  island: 5,
  nest: 6,
};

/** Reihenfolge der Arten beim Sortieren nach Art: Gefahr zuerst, Landschaft zuletzt. */
export const TypeSortOrder: Readonly<Record<EntityType, number>> = {
  fly: 0,
  nest: 1,
  bee: 2,
  flowerPatch: 3,
  hive: 4,
  island: 5,
};

/** Zahlenschlüssel eines Objekts für Zuordnungen ohne Zeichenketten (Objektschlüssel). */
export function entityKey(ref: EntityRef): number {
  return TypeIndex[ref.type] * 4_294_967_296 + ref.id;
}

/** Ob zwei Verweise dasselbe Objekt meinen. */
export function sameEntity(a: EntityRef | undefined, b: EntityRef | undefined): boolean {
  return a !== undefined && b !== undefined && a.type === b.type && a.id === b.id;
}

/** CSS-Klasse mit der Farbe einer Objektart (Artfarbe). */
export const EntityToneClass: Readonly<Record<EntityType, string>> = {
  bee: "tone-bee",
  fly: "tone-fly",
  flowerPatch: "tone-flower",
  hive: "tone-hive",
  island: "tone-island",
  nest: "tone-nest",
};

/**
 * Ob sich eine Objektart grundsätzlich aufschalten lässt (Aufschaltbarkeit). Gilt nur, solange kein
 * Infofeld genauere Freigaben liefert; das Spiel prüft jede Aufschaltung selbst.
 */
export function isLockableType(type: EntityType): boolean {
  return type === "bee" || type === "fly" || type === "flowerPatch" || type === "nest";
}
