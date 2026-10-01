import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { ViewSpec } from "./views";

/** Vertikaler Öffnungswinkel der perspektivischen Kacheln. */
export const PERSPECTIVE_FOV = 0.55;
const MARGIN = 1.1;

/** Berechnete Kameraplatzierung für eine Kachel. */
export interface CameraPlacement {
  position: Vector3;
  target: Vector3;
  up: Vector3;
  minZ: number;
  maxZ: number;
  /** Halbe Breite/Höhe des orthografischen Volumens (nur orthographic). */
  orthoHalfWidth: number;
  orthoHalfHeight: number;
  /** Ausdehnung des Motivs in Bildbreite/-höhe in Metern. */
  projectedWidth: number;
  projectedHeight: number;
}

/** Acht Eckpunkte einer Box. */
export function boxCorners(min: Vector3, max: Vector3): Vector3[] {
  const corners: Vector3[] = [];
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) corners.push(new Vector3(x, y, z));
    }
  }
  return corners;
}

/**
 * Richtet eine Kamera so aus, dass alle Punkte formatfüllend im Bild liegen
 * (Rechtssystem: rechts = vorwärts x oben).
 */
export function fitCamera(spec: ViewSpec, points: readonly Vector3[], center: Vector3, aspect: number): CameraPlacement {
  const toCamera = spec.direction.normalizeToNew();
  const forward = toCamera.scale(-1);
  const right = Vector3.Cross(forward, spec.up).normalize();
  const camUp = Vector3.Cross(right, forward).normalize();

  const offsets = points.map((point) => {
    const rel = point.subtract(center);
    return { u: Vector3.Dot(rel, right), v: Vector3.Dot(rel, camUp), w: Vector3.Dot(rel, toCamera) };
  });
  const range = (pick: (o: (typeof offsets)[number]) => number): [number, number] => {
    const values = offsets.map(pick);
    return [Math.min(...values), Math.max(...values)];
  };
  const [uMin, uMax] = range((o) => o.u);
  const [vMin, vMax] = range((o) => o.v);
  const uMid = (uMin + uMax) / 2;
  const vMid = (vMin + vMax) / 2;
  const target = center.add(right.scale(uMid)).add(camUp.scale(vMid));
  const reach = Math.max(...points.map((p) => Vector3.Distance(p, target)));

  const common = {
    target,
    up: spec.up.clone(),
    projectedWidth: uMax - uMin,
    projectedHeight: vMax - vMin,
  };

  if (spec.projection === "orthographic") {
    const halfHeight = Math.max((vMax - vMin) / 2, (uMax - uMin) / 2 / aspect) * MARGIN;
    const distance = reach * 3;
    return {
      ...common,
      position: target.add(toCamera.scale(distance)),
      minZ: Math.max(distance - reach * 2, reach * 0.01),
      maxZ: distance + reach * 20,
      orthoHalfWidth: halfHeight * aspect,
      orthoHalfHeight: halfHeight,
    };
  }

  const tanY = Math.tan(PERSPECTIVE_FOV / 2);
  const tanX = tanY * aspect;
  let distance = 0;
  for (const o of offsets) {
    const du = o.u - uMid;
    const dv = o.v - vMid;
    distance = Math.max(distance, Math.abs(du) / tanX + o.w, Math.abs(dv) / tanY + o.w);
  }
  distance *= MARGIN;
  return {
    ...common,
    position: target.add(toCamera.scale(distance)),
    minZ: distance * 0.01,
    maxZ: distance * 60,
    orthoHalfWidth: 0,
    orthoHalfHeight: 0,
  };
}
