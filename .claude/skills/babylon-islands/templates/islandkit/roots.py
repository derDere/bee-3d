"""Hängende Wurzeln aus dem Erdband: über den Fels gelegt, unter Überhängen frei hängend (Inselwurzeln).

Jede Wurzel wächst schrittweise: Start leicht im Erdband, Richtung nach außen und unten, dann
zieht die Schwerkraft sie senkrecht. Trifft sie den Fels, wird sie aus ihm herausgeschoben und
gleitet an der Oberfläche entlang — so schmiegt sie sich an die Wand. Lange Wurzeln treiben
Seitenwurzeln.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from modelkit.noise import Fractal
from modelkit.sweep import SweptMesh, sweep_tube

from islandkit.terrain import IslandTerrain

type FloatArray = npt.NDArray[np.float64]


@dataclass(frozen=True, slots=True)
class RootStrand:
    """Eine Wurzel als Stützpunkte mit Radien (Wurzelstrang)."""

    path: FloatArray
    radii: FloatArray


@dataclass(frozen=True, slots=True)
class RootSettings:
    """Stellgrößen der Wurzeln (Wurzeleinstellungen), relativ zur Inselgröße abgeleitet."""

    spacing: float  # mittlerer Abstand der Wurzeln entlang des Umfangs (m)
    max_length: float  # Länge der längsten Wurzeln (m)
    base_radius: float  # Radius kräftiger Wurzeln am Ansatz (m)
    step: float  # Schrittweite des Wachstums (m)

    @staticmethod
    def for_terrain(terrain: IslandTerrain) -> RootSettings:
        d = 2.0 * terrain.dims.radius
        return RootSettings(
            spacing=float(np.clip(0.05 * d, 0.9, 2.4)),
            max_length=float(np.clip(0.2 * d, 2.0, 16.0)),
            base_radius=float(np.clip(0.0038 * d, 0.035, 0.3)),
            step=float(np.clip(0.007 * d, 0.15, 0.45)),
        )


def grow_roots(terrain: IslandTerrain, seed: int, settings: RootSettings | None = None) -> list[RootStrand]:
    """Lässt Wurzeln in Gruppen rund um die Kante wachsen; ``terrain`` ist das Feld des Netzes."""
    settings = settings or RootSettings.for_terrain(terrain)
    rng = np.random.default_rng(seed)
    dims = terrain.dims
    circumference = 2.0 * np.pi * dims.radius
    clusters = max(4, int(circumference / (4.0 * settings.spacing)))
    centers = rng.uniform(0.0, 2.0 * np.pi, clusters)
    count = int(circumference / settings.spacing)
    angles = centers[rng.integers(0, clusters, count)] + rng.normal(0.0, 1.6 * settings.spacing / dims.radius, count)
    heights = -rng.uniform(0.35, 1.15, count) * dims.soil_depth
    starts = _surface_points(terrain, angles, heights) - 0.12 * _radial(angles)
    lengths = settings.max_length * (0.08 + 0.92 * rng.random(count) ** 2.4)
    radii = settings.base_radius * (0.35 + 0.65 * rng.random(count)) * (0.5 + 0.5 * lengths / settings.max_length)
    initial = 0.4 * _radial(angles) + np.array([0.0, -0.9, 0.0])
    strands = _grow(terrain, starts, initial, lengths, radii, settings.step, rng)
    return strands + _offshoots(terrain, strands, settings, rng)


def build_root_mesh(strands: list[RootStrand], base_radius: float) -> SweptMesh:
    """Röhren für alle Wurzeln; dicke Wurzeln mit 7, dünne mit 4 Seiten. UVs kacheln die Wurzelrinde."""
    tubes = []
    for strand in strands:
        sides = 7 if strand.radii[0] > 0.6 * base_radius else (5 if strand.radii[0] > 0.3 * base_radius else 4)
        circumference = 2.0 * np.pi * float(strand.radii[0])
        tubes.append(
            sweep_tube(strand.path, strand.radii, sides, u_repeat=max(1.0, round(circumference / 0.25)), v_per_meter=1.6)
        )
    return SweptMesh.concatenate(tubes)


def _radial(angles: FloatArray) -> FloatArray:
    return np.stack([np.cos(angles), np.zeros_like(angles), np.sin(angles)], axis=1)


def _surface_points(terrain: IslandTerrain, angles: FloatArray, heights: FloatArray) -> FloatArray:
    """Schnittpunkte waagrechter Strahlen von außen mit dem Inselkörper (Bisektion entlang des Radius)."""
    direction = _radial(angles)
    outer = np.full(len(angles), terrain.dims.radius * 1.6)
    inner = np.zeros(len(angles))
    for _ in range(28):
        middle = 0.5 * (outer + inner)
        points = direction * middle[:, None] + np.array([0.0, 1.0, 0.0]) * heights[:, None]
        inside = terrain.distance(points) < 0.0
        inner = np.where(inside, middle, inner)
        outer = np.where(inside, outer, middle)
    return direction * inner[:, None] + np.array([0.0, 1.0, 0.0]) * heights[:, None]


def _grow(
    terrain: IslandTerrain,
    starts: FloatArray,
    directions: FloatArray,
    lengths: FloatArray,
    radii: FloatArray,
    step: float,
    rng: np.random.Generator,
) -> list[RootStrand]:
    """Wächst alle Wurzeln gleichzeitig; Kollision mit dem Fels über das Distanzfeld."""
    wiggle = Fractal(int(rng.integers(1 << 30)), 0.6, octaves=2)
    steps = int(np.ceil(lengths.max() / step)) + 1
    position = starts.copy()
    heading = directions / np.linalg.norm(directions, axis=1, keepdims=True)
    gravity = np.array([0.0, -1.0, 0.0])
    path = [position.copy()]
    for _ in range(1, steps):
        noise = np.stack([wiggle(position + offset) for offset in ((0, 0, 0), (17.3, 4.1, -9.2), (-3.7, 21.5, 6.4))], axis=1)
        heading = heading + 1.4 * gravity * step + 0.9 * noise * step
        heading /= np.linalg.norm(heading, axis=1, keepdims=True)
        position = position + heading * step
        # Aus dem Fels herausschieben und an der Oberfläche entlanggleiten lassen
        clearance = 0.6 * radii
        distance = terrain.distance(position)
        blocked = distance < clearance
        if np.any(blocked):
            normal = terrain.gradient_normals(position[blocked], epsilon=1e-3)
            position[blocked] += normal * (clearance[blocked] - distance[blocked])[:, None]
            into = np.einsum("ij,ij->i", heading[blocked], normal)
            heading[blocked] -= np.minimum(into, 0.0)[:, None] * normal
            heading[blocked] /= np.linalg.norm(heading[blocked], axis=1, keepdims=True)
        path.append(position.copy())
    trace = np.stack(path, axis=1)
    strands = []
    for strand_index, length in enumerate(lengths):
        nodes = max(3, int(round(length / step)) + 1)
        s = np.linspace(0.0, 1.0, nodes)
        taper = radii[strand_index] * (1.0 - s) ** 0.75 + 0.004
        strands.append(RootStrand(trace[strand_index, :nodes], taper))
    return strands


def _offshoots(terrain: IslandTerrain, strands: list[RootStrand], settings: RootSettings, rng: np.random.Generator) -> list[RootStrand]:
    """Ein bis drei Seitenwurzeln an langen Wurzeln, schräg abzweigend."""
    starts, directions, lengths, radii = [], [], [], []
    for strand in strands:
        length = float(np.linalg.norm(np.diff(strand.path, axis=0), axis=1).sum())
        if length < 0.35 * settings.max_length:
            continue
        for _ in range(int(rng.integers(1, 4))):
            at = int(rng.uniform(0.2, 0.7) * (len(strand.path) - 1))
            along = strand.path[min(at + 1, len(strand.path) - 1)] - strand.path[at]
            sideways = np.cross(along, rng.normal(size=3))
            starts.append(strand.path[at])
            directions.append(along / max(np.linalg.norm(along), 1e-9) + 0.9 * sideways / max(np.linalg.norm(sideways), 1e-9))
            lengths.append(rng.uniform(0.25, 0.5) * length * (1.0 - at / len(strand.path)))
            radii.append(0.55 * float(strand.radii[at]))
    if not starts:
        return []
    return _grow(terrain, np.array(starts), np.array(directions), np.array(lengths), np.array(radii), settings.step, rng)
