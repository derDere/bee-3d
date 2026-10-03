/** Ansichten des Kontaktbogens. */
export const VIEW_IDS = ["front", "right", "back", "top", "three-quarter", "close-up"] as const;
export type ViewId = (typeof VIEW_IDS)[number];

/** "sheet" zeigt alle Ansichten, sonst eine einzelne Ansicht bildfüllend. */
export type ViewMode = ViewId | "sheet";

/** Darstellungsmodi für die Geometrieprüfung. */
export const DEBUG_MODES = ["none", "wireframe", "normals", "uv", "vertexcolors", "materialid"] as const;
export type DebugMode = (typeof DEBUG_MODES)[number];

export type BackendName = "webgpu" | "webgl2";

/** Pixelrechteck mit Ursprung oben links. */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Vec3Tuple = [number, number, number];
