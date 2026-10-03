import { DEBUG_MODES, VIEW_IDS } from "./types";
import type { BackendName, DebugMode, ViewMode } from "./types";

/** Aus der URL gelesene Einstellungen (Stellt die Startkonfiguration des Labs dar). */
export interface LabParams {
  modelUrl: string | null;
  backend: BackendName;
  view: ViewMode;
  debug: DebugMode;
  /** Name der Animation; null = alle Animationen. */
  animationName: string | null;
  /** Fester Zeitpunkt der Animation in Sekunden. */
  animationTime: number;
  /** Optionaler Fokuspunkt der Nahaufnahme (glTF-Koordinaten, Meter). */
  focus: [number, number, number] | null;
  /** Optionale Kantenlänge des Nahaufnahme-Ausschnitts in Metern. */
  focusSize: number | null;
  /** Optionale Blickrichtung der Nahaufnahme: Richtung vom Fokuspunkt zur Kamera. */
  focusDirection: [number, number, number] | null;
}

function pick<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.find((candidate) => candidate === value) ?? fallback;
}

function parseNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseVec3(value: string | null): [number, number, number] | null {
  const parts = value?.split(",").map(Number);
  if (parts?.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** Liest ?model, ?backend, ?view, ?debug, ?anim, ?t, ?focus, ?focusSize, ?focusDir. */
export function readParams(search: string): LabParams {
  const query = new URLSearchParams(search);
  return {
    modelUrl: query.get("model"),
    backend: pick(query.get("backend"), ["webgpu", "webgl2"] as const, "webgpu"),
    view: pick(query.get("view"), [...VIEW_IDS, "sheet"] as const, "sheet"),
    debug: pick(query.get("debug"), DEBUG_MODES, "none"),
    animationName: query.get("anim"),
    animationTime: parseNumber(query.get("t")) ?? 0,
    focus: parseVec3(query.get("focus")),
    focusSize: parseNumber(query.get("focusSize")),
    focusDirection: parseVec3(query.get("focusDir")),
  };
}
