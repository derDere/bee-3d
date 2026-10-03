// Hilfen für vorab angelegte Objektpools der Effektmodule.

/** Poolobjekt mit Belegt-Kennzeichen (Poolobjekt). */
export interface Poolable {
  readonly active: boolean;
}

/** Erstes freies Objekt eines Pools oder undefined, wenn alle belegt sind. */
export function firstInactive<T extends Poolable>(items: readonly T[]): T | undefined {
  for (const item of items) {
    if (!item.active) {
      return item;
    }
  }
  return undefined;
}

/** Legt einen Pool aus `count` Objekten an. */
export function createPool<T>(count: number, factory: () => T): T[] {
  const items: T[] = [];
  for (let i = 0; i < count; i++) {
    items.push(factory());
  }
  return items;
}
