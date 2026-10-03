import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Matrix } from "@babylonjs/core/Maths/math.vector";

/** Begrenzt einen Wert auf 0..1 (Sättigung). */
export function saturate(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Weicher Hermite-Übergang zwischen zwei Kanten wie `smoothstep` in GLSL (weicher Schwellwert). */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = saturate((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Lineare Mischung wie `mix` in GLSL. */
export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Mischt zwei Farbtöne (Grad) auf dem kürzeren Weg um den Farbkreis. */
export function lerpHue(a: number, b: number, t: number): number {
  const delta = ((((b - a) % 360) + 540) % 360) - 180;
  return (a + delta * t + 360) % 360;
}

/** Lineare Umrechnung von [a, b] nach [c, d] wie `remap` im Wolkenshader. */
export function remap(value: number, a: number, b: number, c: number, d: number): number {
  return c + ((value - a) / (b - a)) * (d - c);
}

/**
 * Sicht-Projektionsmatrix allein aus der Kameradrehung (Himmelsrichtungs-Projektion): Richtungen zum Himmel
 * werden damit unabhängig von der Kameraposition auf den Bildschirm abgebildet.
 * @param scratch Hilfsmatrix, wird überschrieben.
 */
export function rotationViewProjectionToRef(camera: Camera, scratch: Matrix, result: Matrix): Matrix {
  camera.getViewMatrix().invertToRef(scratch);
  scratch.setTranslationFromFloats(0, 0, 0);
  scratch.invert();
  scratch.multiplyToRef(camera.getProjectionMatrix(), result);
  return result;
}

/** Ergebnis einer Projektion einer Himmelsrichtung auf den Bildschirm (Bildlage). */
export interface ScreenDirection {
  /** Bildkoordinate 0..1 (wie `vUV` der Vollbildpässe), außerhalb des Bilds auch darüber hinaus. */
  u: number;
  v: number;
  /** Clip-w der Richtung: > 0 vor der Kamera, Kosinus zur Blickrichtung. */
  facing: number;
}

/** Projiziert eine Einheitsrichtung mit der Drehungs-Sicht-Projektion auf den Bildschirm (Richtungsprojektion). */
export function projectDirectionToRef(direction: { readonly x: number; readonly y: number; readonly z: number }, viewProjection: Matrix, result: ScreenDirection): ScreenDirection {
  const m = viewProjection.m;
  const x = direction.x;
  const y = direction.y;
  const z = direction.z;
  const clipX = x * (m[0] ?? 0) + y * (m[4] ?? 0) + z * (m[8] ?? 0);
  const clipY = x * (m[1] ?? 0) + y * (m[5] ?? 0) + z * (m[9] ?? 0);
  const clipW = x * (m[3] ?? 0) + y * (m[7] ?? 0) + z * (m[11] ?? 0);
  result.facing = clipW;
  const w = Math.abs(clipW) > 1e-5 ? clipW : 1e-5;
  result.u = (clipX / w) * 0.5 + 0.5;
  result.v = (clipY / w) * 0.5 + 0.5;
  return result;
}
