// shared/random.ts — deterministischer Zufall für Weltgenerator, Wetterplan und Effekte.
// Nur Ganzzahl-Arithmetik mit Math.imul und exakte Gleitkomma-Operationen: Server (V8) und alle
// Browser erzeugen bitgleiche Folgen.

/** Mischt beliebig viele 32-Bit-Werte zu einem Hash (Hashwert). */
export function hash32(...values: readonly number[]): number {
  let h = 0x9e3779b9 ^ values.length;
  for (const value of values) {
    let k = value | 0;
    k = Math.imul(k, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hash auf [0, 1) (Hash-Zufallswert). */
export function hashUnit(...values: readonly number[]): number {
  return hash32(...values) / 4294967296;
}

/** Seedbarer Zufallsgenerator nach SFC32 (Zufallsgenerator). */
export class Random {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  public constructor(seed: number) {
    this.a = hash32(seed, 1);
    this.b = hash32(seed, 2);
    this.c = hash32(seed, 3);
    this.d = hash32(seed, 4);
    for (let i = 0; i < 12; i++) {
      this.nextUint32();
    }
  }

  /** Nächster Wert als vorzeichenlose 32-Bit-Ganzzahl. */
  public nextUint32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Gleichverteilt auf [0, 1). */
  public next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Gleichverteilt auf [min, max). */
  public range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Ganzzahl auf [0, count). */
  public int(count: number): number {
    return Math.floor(this.next() * count);
  }

  /** Wahr mit Wahrscheinlichkeit p. */
  public chance(p: number): boolean {
    return this.next() < p;
  }

  /** Ein Element der Liste. */
  public pick<T>(items: readonly T[]): T {
    const item = items[this.int(items.length)];
    if (item === undefined) {
      throw new Error("pick() auf leerer Liste");
    }
    return item;
  }

  /** Etwa normalverteilt (Summe von vier Gleichverteilungen), Mittel 0, Streuung ~1. */
  public gaussian(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.7320508;
  }

  /** Zufällige Einheitsrichtung in der XZ-Ebene als [cos, sin] — ohne Winkelfunktionen. */
  public unitXZ(): [number, number] {
    for (;;) {
      const x = this.range(-1, 1);
      const z = this.range(-1, 1);
      const lengthSquared = x * x + z * z;
      if (lengthSquared > 0.0001 && lengthSquared <= 1) {
        const length = Math.sqrt(lengthSquared);
        return [x / length, z / length];
      }
    }
  }

  /** Zufälliger Punkt in der Einheitskugel. */
  public inUnitSphere(): [number, number, number] {
    for (;;) {
      const x = this.range(-1, 1);
      const y = this.range(-1, 1);
      const z = this.range(-1, 1);
      if (x * x + y * y + z * z <= 1) {
        return [x, y, z];
      }
    }
  }
}
