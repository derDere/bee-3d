// Verfolgung beweglicher Objekte über Positionsquellen: Die letzte bekannte Position bleibt erhalten,
// wenn das Objekt verschwindet, damit Strahlen und Geschosse sauber auslaufen.
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { PositionSource } from "../effectTypes";
import { isFiniteVector } from "./effectMath";

/** Verfolgt eine Positionsquelle und behält die letzte bekannte Position (Positionsverfolgung). */
export class TrackedPosition {
  public readonly position = new Vector3();
  private source: PositionSource | undefined;
  private known = false;
  private lost = false;

  /** Bindet eine Quelle und liest sie sofort; false, wenn das Objekt bereits weg ist. */
  public bind(source: PositionSource): boolean {
    this.source = source;
    this.known = false;
    this.lost = false;
    return this.update();
  }

  /** Setzt eine feste Position ohne Quelle (ortsfeste Effekte). */
  public setFixed(value: Vector3): void {
    this.source = undefined;
    this.position.copyFrom(value);
    this.known = true;
    this.lost = false;
  }

  /** Liest die Quelle erneut; false, sobald das Objekt weg ist (die letzte Position bleibt erhalten). */
  public update(): boolean {
    if (this.lost) {
      return false;
    }
    if (this.source === undefined) {
      return this.known;
    }
    const value = this.source();
    if (value === undefined || !isFiniteVector(value)) {
      this.lost = true;
      this.source = undefined;
      return false;
    }
    this.position.copyFrom(value);
    this.known = true;
    return true;
  }

  /** Ob je eine Position bekannt war. */
  public get hasPosition(): boolean {
    return this.known;
  }

  /** Ob das verfolgte Objekt verschwunden ist. */
  public get isLost(): boolean {
    return this.lost;
  }

  /** Gibt die Quelle frei, damit ihre Closure nicht länger gehalten wird. */
  public release(): void {
    this.source = undefined;
  }

  public dispose(): void {
    this.release();
    this.known = false;
    this.lost = false;
  }
}
