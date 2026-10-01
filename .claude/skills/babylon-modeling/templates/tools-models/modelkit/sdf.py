"""Vektorisierte vorzeichenbehaftete Distanzfunktionen (SDF, Distanzfeld).

Konvention: negativ innen, positiv außen, Einheit Meter. Alle Funktionen arbeiten auf
Punktmengen der Form (N, 3), damit ein ganzes Raster in einem NumPy-Aufruf ausgewertet wird.
Die Formeln folgen Inigo Quilez (https://iquilezles.org/articles/distfunctions/).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import dataclass, field
from itertools import pairwise

import numpy as np
import numpy.typing as npt

type FloatArray = npt.NDArray[np.float64]


@dataclass(frozen=True, slots=True)
class Aabb:
    """Achsenparalleler Hüllquader (Begrenzungsbox)."""

    lower: FloatArray
    upper: FloatArray

    def union(self, other: Aabb) -> Aabb:
        """Liefert die Box, die beide Boxen umschließt."""
        return Aabb(np.minimum(self.lower, other.lower), np.maximum(self.upper, other.upper))

    def padded(self, margin: float) -> Aabb:
        """Vergrößert die Box auf allen Seiten um ``margin``."""
        return Aabb(self.lower - margin, self.upper + margin)


class Sdf(ABC):
    """Basisklasse einer vorzeichenbehafteten Distanzfunktion (Distanzfeld)."""

    @abstractmethod
    def distance(self, points: FloatArray) -> FloatArray:
        """Wertet die Distanz für Punkte (N, 3) aus und liefert (N,)."""

    @abstractmethod
    def bounds(self) -> Aabb:
        """Liefert eine Box, außerhalb derer die Distanz sicher positiv ist."""

    def __call__(self, points: FloatArray) -> FloatArray:
        return self.distance(points)

    def gradient(self, points: FloatArray, epsilon: float = 1e-5) -> FloatArray:
        """Gradient des Feldes (N, 3) über zentrale Differenzen."""
        offsets = np.eye(3) * epsilon
        return np.stack(
            [self.distance(points + offset) - self.distance(points - offset) for offset in offsets],
            axis=1,
        ) / (2.0 * epsilon)

    def gradient_normals(self, points: FloatArray, epsilon: float = 1e-5) -> FloatArray:
        """Berechnet Einheitsnormalen über zentrale Differenzen des Feldes."""
        gradient = self.gradient(points, epsilon)
        return gradient / np.maximum(np.linalg.norm(gradient, axis=1, keepdims=True), 1e-12)

    def project_to_surface(self, points: FloatArray, iterations: int = 3) -> FloatArray:
        """Schiebt Punkte per Newton-Schritten (d · ∇d / |∇d|²) auf die Nullfläche des Feldes.

        Für exakte Distanzfelder ist |∇d| = 1; Felder mit Verschiebungen (Rauschen, Schichten)
        haben steilere Gradienten und konvergieren mit dieser Schrittweite trotzdem.
        """
        projected = points.copy()
        for _ in range(iterations):
            gradient = self.gradient(projected)
            squared = np.maximum((gradient * gradient).sum(axis=1, keepdims=True), 1e-12)
            projected -= self.distance(projected)[:, None] * gradient / squared
        return projected


def _rotation_or_identity(rotation: FloatArray | None) -> FloatArray:
    return np.eye(3) if rotation is None else np.asarray(rotation, dtype=np.float64)


@dataclass(frozen=True)
class Ellipsoid(Sdf):
    """Ellipsoid (Kugel bei gleichen Radien), optional gedreht; ``rotation`` bildet lokal → Welt ab."""

    center: FloatArray
    radii: FloatArray
    rotation: FloatArray | None = None

    def to_local(self, points: FloatArray) -> FloatArray:
        """Transformiert Weltpunkte in das lokale Achsensystem des Ellipsoids."""
        return (points - np.asarray(self.center)) @ _rotation_or_identity(self.rotation)

    def distance(self, points: FloatArray) -> FloatArray:
        local = self.to_local(points)
        radii = np.asarray(self.radii, dtype=np.float64)
        k0 = np.linalg.norm(local / radii, axis=1)
        k1 = np.linalg.norm(local / (radii * radii), axis=1)
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-12)

    def bounds(self) -> Aabb:
        rotation = _rotation_or_identity(self.rotation)
        half = np.sqrt(((rotation * np.asarray(self.radii)[None, :]) ** 2).sum(axis=1))
        center = np.asarray(self.center, dtype=np.float64)
        return Aabb(center - half, center + half)


@dataclass(frozen=True)
class TaperedCapsule(Sdf):
    """Kapsel mit linear veränderlichem Radius zwischen zwei Punkten (Näherung eines Rundkegels)."""

    start: FloatArray
    end: FloatArray
    start_radius: float
    end_radius: float

    def distance(self, points: FloatArray) -> FloatArray:
        a = np.asarray(self.start, dtype=np.float64)
        ba = np.asarray(self.end, dtype=np.float64) - a
        t = np.clip(((points - a) @ ba) / float(ba @ ba), 0.0, 1.0)
        radius = self.start_radius + (self.end_radius - self.start_radius) * t
        return np.linalg.norm(points - a - t[:, None] * ba, axis=1) - radius

    def bounds(self) -> Aabb:
        ends = np.stack([self.start, self.end]).astype(np.float64)
        margin = max(self.start_radius, self.end_radius)
        return Aabb(ends.min(axis=0) - margin, ends.max(axis=0) + margin)


@dataclass(frozen=True)
class TubeChain(Sdf):
    """Röhrenzug durch Stützpunkte mit Radien je Punkt (Beine, Fühler, Äste)."""

    points: Sequence[Sequence[float]]
    radii: Sequence[float]
    segments: tuple[TaperedCapsule, ...] = field(init=False)

    def __post_init__(self) -> None:
        nodes = np.asarray(self.points, dtype=np.float64)
        segments = tuple(
            TaperedCapsule(nodes[i], nodes[i + 1], self.radii[i], self.radii[i + 1])
            for i in range(len(nodes) - 1)
        )
        object.__setattr__(self, "segments", segments)

    def distance(self, points: FloatArray) -> FloatArray:
        return np.min([segment.distance(points) for segment in self.segments], axis=0)

    def bounds(self) -> Aabb:
        box = self.segments[0].bounds()
        for segment in self.segments[1:]:
            box = box.union(segment.bounds())
        return box

    def node_pairs(self) -> list[tuple[tuple[FloatArray, float], tuple[FloatArray, float]]]:
        """Liefert benachbarte (Punkt, Radius)-Paare, z. B. für Hüllen-Röhren in manifold3d."""
        nodes = [
            (np.asarray(p, dtype=np.float64), float(r)) for p, r in zip(self.points, self.radii, strict=True)
        ]
        return list(pairwise(nodes))


@dataclass(frozen=True)
class RoundedBox(Sdf):
    """Achsenparallele Box mit Kantenradius (Hard-Surface, Steine, Sockel)."""

    center: FloatArray
    half_extents: FloatArray
    corner_radius: float

    def distance(self, points: FloatArray) -> FloatArray:
        inner = np.asarray(self.half_extents) - self.corner_radius
        q = np.abs(points - np.asarray(self.center)) - inner
        outside = np.linalg.norm(np.maximum(q, 0.0), axis=1)
        inside = np.minimum(q.max(axis=1), 0.0)
        return outside + inside - self.corner_radius

    def bounds(self) -> Aabb:
        center = np.asarray(self.center, dtype=np.float64)
        half = np.asarray(self.half_extents, dtype=np.float64)
        return Aabb(center - half, center + half)


def smooth_min(a: FloatArray, b: FloatArray, k: float) -> FloatArray:
    """Quadratisches Smooth-Minimum; ``k`` ist die Breite der Verrundung in Metern."""
    if k <= 0.0:
        return np.minimum(a, b)
    h = np.maximum(k - np.abs(a - b), 0.0) / k
    return np.minimum(a, b) - h * h * k * 0.25


@dataclass(frozen=True)
class SmoothUnion(Sdf):
    """Weiche Vereinigung mehrerer Felder (organische Übergänge, Hohlkehlen)."""

    children: Sequence[Sdf]
    k: float

    def distance(self, points: FloatArray) -> FloatArray:
        result = self.children[0].distance(points)
        for child in self.children[1:]:
            result = smooth_min(result, child.distance(points), self.k)
        return result

    def bounds(self) -> Aabb:
        box = self.children[0].bounds()
        for child in self.children[1:]:
            box = box.union(child.bounds())
        return box.padded(self.k * 0.25)


@dataclass(frozen=True)
class SmoothSubtraction(Sdf):
    """Weiches Abziehen eines Werkzeugfeldes (Mulden, Einkerbungen, abgerundete Bohrungen)."""

    base: Sdf
    cutter: Sdf
    k: float

    def distance(self, points: FloatArray) -> FloatArray:
        return -smooth_min(-self.base.distance(points), self.cutter.distance(points), self.k)

    def bounds(self) -> Aabb:
        return self.base.bounds()
