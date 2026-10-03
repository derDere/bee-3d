// Seedbarer Zufallsgenerator der Effekte (mulberry32): reproduzierbare Prüfläufe, keine Allokationen.
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";

/** Seedbarer Zufallsgenerator für Effekte (Effektzufall). */
export class EffectRandom {
  private state: number;

  public constructor(seed = 0x5eedbee) {
    this.state = seed >>> 0;
  }

  /** Gleichverteilter Wert in [0, 1). */
  public next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Gleichverteilter Wert in [min, max). */
  public range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Gleichverteilter Wert in [-1, 1). */
  public signed(): number {
    return this.next() * 2 - 1;
  }

  /** Schreibt einen gleichverteilten Einheitsvektor in `result`. */
  public unitVector(result: Vector3): Vector3 {
    const z = this.signed();
    const angle = this.next() * Math.PI * 2;
    const radial = Math.sqrt(Math.max(0, 1 - z * z));
    return result.set(radial * Math.cos(angle), radial * Math.sin(angle), z);
  }
}
