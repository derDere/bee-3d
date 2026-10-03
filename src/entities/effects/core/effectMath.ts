// Kleine Rechenhelfer der Effekte: Kurven, Basisvektoren, Bézier — alle ohne Allokationen.
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

/** Begrenzt einen Wert auf [0, 1]. */
export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Hermite-Übergang zwischen zwei Kanten (wie GLSL smoothstep). */
export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Hüllkurve aus Einblenden und Ausblenden über eine Lebensdauer (Einblend-Ausblend-Kurve). */
export function envelope(age: number, duration: number, attack: number, release: number): number {
  const rise = attack > 0 ? clamp01(age / attack) : 1;
  const fall = release > 0 ? clamp01((duration - age) / release) : 1;
  return rise * fall;
}

/** Ob alle Komponenten eines Vektors endlich sind. */
export function isFiniteVector(value: Vector3): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

/**
 * Schreibt zwei Einheitsvektoren senkrecht zu `axis` (normiert) in `u` und `v` (Querbasis).
 * Hilfsachse ist die Welt-Y-Achse, bei fast senkrechter Achse die Welt-X-Achse.
 */
export function perpendicularBasis(axis: Vector3, u: Vector3, v: Vector3): void {
  if (Math.abs(axis.y) < 0.92) {
    // u = normalize(up × axis)
    u.set(axis.z, 0, -axis.x);
  } else {
    // u = normalize(right × axis)
    u.set(0, -axis.z, axis.y);
  }
  u.normalize();
  Vector3.CrossToRef(axis, u, v);
  v.normalize();
}

/** Punkt auf einer quadratischen Bézier-Kurve A–C–B bei Parameter s (Bézier-Punkt). */
export function quadraticBezierToRef(a: Vector3, control: Vector3, b: Vector3, s: number, result: Vector3): Vector3 {
  const inverse = 1 - s;
  const wa = inverse * inverse;
  const wc = 2 * inverse * s;
  const wb = s * s;
  return result.set(
    a.x * wa + control.x * wc + b.x * wb,
    a.y * wa + control.y * wc + b.y * wb,
    a.z * wa + control.z * wc + b.z * wb,
  );
}
