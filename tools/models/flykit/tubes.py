"""Geschlossene Röhren entlang von Kurven für Glieder, Krallen, Dornen und Schwingkölbchen (Röhren)."""

from __future__ import annotations

import manifold3d as m3d
import numpy as np
import numpy.typing as npt
from modelkit.geometry import TriangleMesh, to_manifold
from modelkit.sweep import sweep_tube

type FloatArray = npt.NDArray[np.float64]


def arc_lengths(path: FloatArray) -> FloatArray:
    """Bogenlänge an jedem Stützpunkt einer Polylinie (K,)."""
    return np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))])


def resample(path: FloatArray, stations: FloatArray) -> FloatArray:
    """Punkte der dichten Kurve ``path`` an den Bogenlängen ``stations``."""
    arc = arc_lengths(path)
    return np.stack([np.interp(stations, arc, path[:, axis]) for axis in range(3)], axis=1)


def rounded_end(path: FloatArray, radii: FloatArray, steps: int = 3) -> tuple[FloatArray, FloatArray]:
    """Hängt eine halbkugelige Kappe an das Ende einer Röhre (Gliedende)."""
    tangent = path[-1] - path[-2]
    tangent = tangent / max(float(np.linalg.norm(tangent)), 1e-12)
    angles = np.linspace(0.0, 0.5 * np.pi, steps + 1)[1:]
    cap = path[-1] + tangent * (radii[-1] * np.sin(angles))[:, None]
    return np.concatenate([path, cap]), np.concatenate([radii, radii[-1] * np.cos(angles)])


def tube_solid(path: FloatArray, radii: FloatArray, sides: int) -> m3d.Manifold:
    """Geschlossene Röhre: Fächer am Anfang, Spitze am Ende (letzter Radius wird zur Spitze)."""
    tube = sweep_tube(path, radii, sides)
    first_ring = np.arange(sides)
    cap_center = len(tube.vertices)
    cap = np.stack([np.full(sides, cap_center), (first_ring + 1) % sides, first_ring], axis=1)
    # Die doppelte Nahtspalte der Röhre verschmilzt to_manifold mit der ersten Spalte
    vertices = np.concatenate([tube.vertices, path[:1]])
    return to_manifold(TriangleMesh(vertices, np.concatenate([tube.faces, cap])))


def spike_solid(base: FloatArray, tip: FloatArray, bend: FloatArray, radius: float, sides: int = 3) -> m3d.Manifold:
    """Gebogener, spitz zulaufender Dorn von ``base`` nach ``tip``; ``bend`` verschiebt die Mitte (Dorn)."""
    middle = 0.5 * (base + tip) + bend
    path = np.stack([base, middle, tip])
    return tube_solid(path, np.array([radius, 0.55 * radius, 0.0]), sides)
