"""Inselkatalog für Spiellogik und Server: Kennzahlen, Blumenfelder, Kollisionsfelder (Inselkatalog).

Der Katalog entsteht aus dem groben Feld der Detailstufe 0 und der Bepflanzung — beide hängen
nur vom Steckbrief ab, daher schreibt der Generator bei gleichem Stand dieselbe Datei.

Kollisionsfeld: Raster ``resolution`` × ``resolution`` über [−extent, +extent]² in X und Z;
Zeile i läuft entlang Z, Spalte j entlang X, Knoten j liegt bei x = −extent + 2·extent·j /
(resolution − 1) (Eckknoten auf ±extent). ``top`` ist die Oberkante (Grasnarbe, über Teich und
Bach der Wasserspiegel), ``bottom`` die Unterkante des obersten Felskörpers (Felsspitzen), beide
in Zentimetern als little-endian Int16; außerhalb des Umrisses steht −32768.
"""

from __future__ import annotations

import base64
import math
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import numpy.typing as npt

from islandkit.planting import FlowerPatch, surface_heights
from islandkit.terrain import IslandTerrain

type FloatArray = npt.NDArray[np.float64]
type ShortArray = npt.NDArray[np.int16]

OUTSIDE = -32768
_MARCH_STEP = 0.08  # kleinste Schrittweite beim Abstieg durch den Felskörper (m)


@dataclass(frozen=True, slots=True)
class CollisionField:
    """Höhenfelder für Kollisionen in Modellkoordinaten (Kollisionsfeld), Werte in Zentimetern."""

    resolution: int
    extent: float
    top: ShortArray
    bottom: ShortArray

    @staticmethod
    def encode(values: ShortArray) -> str:
        """Base64 eines little-endian Int16-Felds."""
        return base64.b64encode(values.astype("<i2").tobytes()).decode("ascii")


def collision_resolution(diameter: float) -> int:
    """Rasterauflösung nach Inselgröße: 64 bis 30 m, 80 bis 60 m, darüber 96."""
    return 64 if diameter <= 30.0 else 80 if diameter <= 60.0 else 96


def compute_collision(terrain: IslandTerrain, resolution: int) -> CollisionField:
    """Ober- und Unterkante je Rasterknoten aus dem Feld (Newton von oben, Abstieg durch den Körper)."""
    extent = math.ceil((terrain.max_outline_radius + 0.5) * 2.0) / 2.0
    axis = np.linspace(-extent, extent, resolution)
    grid_x, grid_z = np.meshgrid(axis, axis)  # Zeilen entlang Z, Spalten entlang X
    xz = np.column_stack([grid_x.ravel(), grid_z.ravel()])
    outline = terrain.outline_radius(np.arctan2(xz[:, 1], xz[:, 0]))
    inside = np.flatnonzero(np.hypot(xz[:, 0], xz[:, 1]) < outline)
    top = np.full(len(xz), OUTSIDE, dtype=np.int64)
    bottom = np.full(len(xz), OUTSIDE, dtype=np.int64)
    ground, valid = surface_heights(terrain, xz[inside])
    columns = inside[valid]
    ground = ground[valid]
    surface = np.column_stack([xz[columns, 0], ground, xz[columns, 1]])
    sample = terrain.sample(surface)
    wet = (np.minimum(sample.pond, sample.stream) < 0.3) & (sample.waterline < 0.0)
    upper = np.where(wet, ground - sample.waterline, ground)
    lower = _descend(terrain, surface)
    top[columns] = np.round(upper * 100.0)
    bottom[columns] = np.round(lower * 100.0)
    shape = (resolution, resolution)
    return CollisionField(
        resolution,
        extent,
        np.clip(top, OUTSIDE, 32767).astype(np.int16).reshape(shape),
        np.clip(bottom, OUTSIDE, 32767).astype(np.int16).reshape(shape),
    )


def _descend(terrain: IslandTerrain, surface: FloatArray) -> FloatArray:
    """Steigt von der Oberfläche senkrecht durch den Körper bis zum Austritt; liefert dessen Höhe."""
    y = surface[:, 1] - 0.05
    floor = float(min(spire.end[1] for spire in terrain.plan.spires)) - 5.0
    last_inside = y.copy()
    exit_height = np.full(len(y), np.nan)
    active = np.arange(len(y))
    for _ in range(2000):
        if len(active) == 0:
            break
        points = np.column_stack([surface[active, 0], y[active], surface[active, 2]])
        distance = terrain.distance(points)
        outside = distance >= 0.0
        if np.any(outside):
            done = active[outside]
            exit_height[done] = _bisect(terrain, surface[done], last_inside[done], y[done])
        inner = active[~outside]
        last_inside[inner] = y[inner]
        y[inner] -= np.maximum(0.6 * np.abs(distance[~outside]), _MARCH_STEP)
        below = y[inner] < floor
        exit_height[inner[below]] = floor
        active = inner[~below]
    return np.where(np.isnan(exit_height), floor, exit_height)


def _bisect(terrain: IslandTerrain, columns: FloatArray, inside: FloatArray, outside: FloatArray, steps: int = 12) -> FloatArray:
    """Engt den Austrittspunkt zwischen einer Höhe im Körper und einer darunter ein."""
    high, low = inside.copy(), outside.copy()
    for _ in range(steps):
        middle = 0.5 * (high + low)
        distance = terrain.distance(np.column_stack([columns[:, 0], middle, columns[:, 2]]))
        solid = distance < 0.0
        high = np.where(solid, middle, high)
        low = np.where(solid, low, middle)
    return 0.5 * (high + low)


@dataclass(frozen=True, slots=True)
class IslandRecord:
    """Eintrag einer Insel im Katalog (Inselmodell): Dateien, Maße, Blumenfelder, Kollisionsfeld."""

    key: str
    files: tuple[str, str, str]
    diameter: float
    top_height: float
    depth: float
    canopy_height: float
    has_pond: bool
    is_nest: bool
    patches: tuple[FlowerPatch, ...]
    collision: CollisionField


_HEADER = """// shared/islandCatalog.ts — Inselkatalog (Inselmodelle mit Blumenfeldern und Kollisionsfeldern).
// Wird von tools/models/sky_islands.py geschrieben; nicht von Hand bearbeiten.
import type { IslandModelInfo } from "./islandCatalogTypes";

/** Alle Inselmodelle des Spiels (Inselkatalog). */
export const IslandCatalog: readonly IslandModelInfo[] = [
"""


def write_catalog(records: Sequence[IslandRecord], path: Path) -> None:
    """Schreibt ``shared/islandCatalog.ts`` vollständig neu (feste Zahlenformate, deterministisch)."""
    lines = [_HEADER.rstrip("\n")]
    for record in records:
        lines.append("  {")
        lines.append(f'    key: "{record.key}",')
        lines.append("    files: [" + ", ".join(f'"{file}"' for file in record.files) + "],")
        lines.append(f"    diameter: {_number(record.diameter, 2)},")
        lines.append(f"    topHeight: {_number(record.top_height, 2)},")
        lines.append(f"    depth: {_number(record.depth, 2)},")
        lines.append(f"    canopyHeight: {_number(record.canopy_height, 2)},")
        lines.append(f"    hasPond: {_boolean(record.has_pond)},")
        lines.append(f"    isNest: {_boolean(record.is_nest)},")
        if record.patches:
            lines.append("    flowerPatches: [")
            for patch in record.patches:
                x, y, z = (_number(float(value), 2) for value in patch.center)
                lines.append(
                    f'      {{ x: {x}, y: {y}, z: {z}, radius: {_number(patch.radius, 2)}, species: "{patch.species}", flowers: {patch.flowers} }},'
                )
            lines.append("    ],")
        else:
            lines.append("    flowerPatches: [],")
        collision = record.collision
        lines.append("    collision: {")
        lines.append(f"      resolution: {collision.resolution},")
        lines.append(f"      extent: {_number(collision.extent, 2)},")
        lines.append(f'      top: "{CollisionField.encode(collision.top)}",')
        lines.append(f'      bottom: "{CollisionField.encode(collision.bottom)}",')
        lines.append("    },")
        lines.append("  },")
    lines.append("];")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def _number(value: float, digits: int) -> str:
    """Zahl mit höchstens ``digits`` Nachkommastellen, ohne nachlaufende Nullen."""
    text = f"{round(value, digits):.{digits}f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def _boolean(value: bool) -> str:
    return "true" if value else "false"
