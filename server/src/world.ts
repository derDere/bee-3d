// server/src/world.ts — statische Welt des Moduls: einmal je Modulinstanz aus dem Weltseed erzeugt.
// Unveränderlich nach dem Erzeugen; Reducer lesen nur daraus (kein veränderlicher Modulzustand).
import { generateWorld, type WorldLayout } from "../../shared/worldgen";
import { WorldIndex } from "../../shared/worldIndex";
import { WorldSeed } from "../../shared/world";

let cachedIndex: WorldIndex | undefined;

/** Räumlicher Index der statischen Welt (lazy, deterministisch). */
export function worldIndex(): WorldIndex {
  cachedIndex ??= new WorldIndex(generateWorld(WorldSeed));
  return cachedIndex;
}

/** Der statische Weltaufbau. */
export function world(): WorldLayout {
  return worldIndex().layout;
}
