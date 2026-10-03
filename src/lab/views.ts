import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { ViewId } from "./types";

/** Beschreibung einer Kontaktbogen-Ansicht (glTF-Koordinaten: +Y oben, +Z vorne, Modell-Rechts = -X). */
export interface ViewSpec {
  id: ViewId;
  label: string;
  projection: "orthographic" | "perspective";
  /** Richtung vom Ziel zur Kamera. */
  direction: Vector3;
  /** Bildschirm-Oben der Kamera. */
  up: Vector3;
  /** true: Ausschnitt um einen Fokuspunkt; false: ganzes Modell. */
  detail: boolean;
}

const Y_UP = new Vector3(0, 1, 0);

/** Reihenfolge entspricht dem 3x2-Raster (oben links nach unten rechts). */
export const VIEW_SPECS: readonly ViewSpec[] = [
  { id: "front", label: "FRONT (+Z)", projection: "orthographic", direction: new Vector3(0, 0, 1), up: Y_UP, detail: false },
  { id: "right", label: "RIGHT (-X)", projection: "orthographic", direction: new Vector3(-1, 0, 0), up: Y_UP, detail: false },
  { id: "back", label: "BACK (-Z)", projection: "orthographic", direction: new Vector3(0, 0, -1), up: Y_UP, detail: false },
  { id: "top", label: "TOP (+Y)", projection: "orthographic", direction: new Vector3(0, 1, 0), up: new Vector3(0, 0, 1), detail: false },
  { id: "three-quarter", label: "3/4 FRONT-RIGHT-TOP", projection: "perspective", direction: new Vector3(-0.6, 0.55, 0.75).normalize(), up: Y_UP, detail: false },
  { id: "close-up", label: "CLOSE-UP", projection: "perspective", direction: new Vector3(-0.45, 0.25, 0.85).normalize(), up: Y_UP, detail: true },
];

export function getViewSpec(id: ViewId): ViewSpec {
  const spec = VIEW_SPECS.find((candidate) => candidate.id === id);
  if (!spec) throw new Error(`Unbekannte Ansicht: ${id}`);
  return spec;
}
