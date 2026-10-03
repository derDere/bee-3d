"""Ansätze und Bahnen der Wasserfälle einer Insel: Bachmündung und Quellen in der Felswand (Wasserfälle).

Ein Wasserfall beginnt an der Bachmündung in der Kerbe der Kante oder an einer Quelle, die knapp
unter dem Erdband aus der Felswand tritt — dort, wo Sickerwasser auf dem dichten Fels austritt
(Schichtquelle). Quellen liegen, wo die Wand unter dem Austritt frei zurückweicht: Der
Wasserkörper hält auf seiner ganzen Länge Abstand zum Fels und zu den hängenden Spitzen. Quellen
halten Abstand zur Mündung und zueinander. Gesucht wird auf einem Feld mit fester Detailgrenze,
damit jede Fassung des Feldes (Netz, Texturen, ferne Detailstufen) dieselben Quellen liefert.

Die Bahn ist eine Wurfparabel ab dem Austritt. Die Sichtzeit entlang der Bahn begrenzt die
Geschwindigkeit des Wassers auf ``VISUAL_SPEED_LIMIT``: Texturen, deren v mit der Sichtzeit wächst,
ziehen mit dem Wasser mit, beschleunigen am Ansatz und strecken sich weiter unten zu langen Fasern.
"""

from __future__ import annotations

import zlib
from dataclasses import dataclass
from typing import Literal

import numpy as np
import numpy.typing as npt
from modelkit.shading import smoothstep

from islandkit.terrain import IslandTerrain

type FloatArray = npt.NDArray[np.float64]
type BoolArray = npt.NDArray[np.bool_]
type FallKind = Literal["outlet", "spring"]

GRAVITY = 9.81
FALL_RATIO = 1.75  # Fallhöhe relativ zur Inseltiefe: reicht weit unter die Insel in die Wolken
VISUAL_SPEED_LIMIT = 11.0  # m/s, Endgeschwindigkeit des sichtbaren Wassers
CORE_END = 0.72  # Ende des Wasserkörpers relativ zur Fallhöhe; darunter zerstäubt der Fall
_UP = np.array([0.0, 1.0, 0.0])
_SEARCH_DETAIL = 1.0  # m, Detailgrenze des Suchfelds
_SPRING_LEVEL = 1.2  # Austritt unter der Grasnarbe in Erdbanddicken (Grenze Erde/Fels)
_SPRING_INSET = 0.3  # m, so weit setzt der Wasserkörper in der Wand an (oberer Rand verdeckt)
_CANDIDATES = 96  # Winkel je Umlauf bei der Quellensuche
_MIN_SEPARATION = np.radians(70.0)  # kleinster Winkelabstand zweier Fälle im Grundriss
_CHECK_ROWS = 48  # Prüfzeilen entlang der Bahn, am Austritt dichter
_CHECK_ACROSS = np.array([-1.0, -0.5, 0.0, 0.5, 1.0])


@dataclass(frozen=True, slots=True)
class FallSource:
    """Ansatz eines Wasserfalls (Fallquelle).

    ``position`` ist die Mitte des Austritts (Wasserspiegel der Mündung bzw. Quellpunkt in der
    Wand), ``direction`` die waagrechte Fließrichtung (x, z), ``half_width`` die halbe Breite des
    Wasserkörpers am Ansatz, ``speed`` die waagrechte Austrittsgeschwindigkeit (m/s).
    """

    position: FloatArray
    direction: FloatArray
    half_width: float
    speed: float
    kind: FallKind

    @property
    def outward(self) -> FloatArray:
        """Fließrichtung als Raumvektor (waagrecht, Einheitslänge)."""
        return np.array([self.direction[0], 0.0, self.direction[1]])

    @property
    def side(self) -> FloatArray:
        """Waagrechte Querrichtung des Wasserkörpers (Einheitslänge)."""
        side = np.cross(_UP, self.outward)
        return side / np.linalg.norm(side)

    @property
    def angle(self) -> float:
        """Lage des Ansatzes im Grundriss als Winkel um die Inselachse."""
        return float(np.arctan2(self.position[2], self.position[0]))

    def core_half_width(self, drop: FloatArray, height: float) -> FloatArray:
        """Halbe Breite des Wasserkörpers je Fallstrecke: fächert nach dem Austritt auf, wird nach unten breiter."""
        spread = 1.0 + 0.8 * smoothstep(0.0, 0.1 * height, drop) + 1.0 * drop / height
        return self.half_width * spread


@dataclass(frozen=True, slots=True)
class FallTrajectory:
    """Mittellinie eines Wasserfalls (Fallbahn): Stützpunkte, Fallstrecke und Sichtzeit seit dem Austritt je Stützpunkt."""

    centre: FloatArray
    drop: FloatArray
    visual_time: FloatArray

    @property
    def tangents(self) -> FloatArray:
        """Bahnrichtung je Stützpunkt (Einheitslänge)."""
        tangents = np.gradient(self.centre, axis=0)
        return tangents / np.maximum(np.linalg.norm(tangents, axis=1, keepdims=True), 1e-12)


def trajectory(source: FallSource, drops: FloatArray) -> FallTrajectory:
    """Wurfparabel ab dem Ansatz an den Fallstrecken ``drops`` (m unter dem Austritt).

    Die Sichtzeit hängt nur von der Fallstrecke ab — Schichten mit verschiedenen Zeilen (Wasserkörper,
    Zerstäubung) bekommen an gleicher Stelle dieselbe Zeit und damit dasselbe Texturmuster.
    """
    centre = _ballistic(source, drops)
    fine = np.linspace(0.0, max(float(drops.max()), 1e-6), 512)
    times = np.sqrt(2.0 * fine / GRAVITY)
    steps = np.linalg.norm(np.diff(_ballistic(source, fine), axis=0), axis=1)
    pace = 1.0 / np.minimum(np.hypot(source.speed, GRAVITY * times), VISUAL_SPEED_LIMIT)
    elapsed = np.concatenate([[0.0], np.cumsum(0.5 * (pace[1:] + pace[:-1]) * steps)])
    return FallTrajectory(centre, drops, np.interp(drops, fine, elapsed))


def _ballistic(source: FallSource, drops: FloatArray) -> FloatArray:
    """Punkte der Wurfparabel je Fallstrecke."""
    times = np.sqrt(2.0 * np.maximum(drops, 0.0) / GRAVITY)
    return source.position[None, :] + (source.speed * times)[:, None] * source.outward[None, :] - drops[:, None] * _UP[None, :]


def fall_height(terrain: IslandTerrain) -> float:
    """Fallhöhe der Wasserfälle einer Insel (m)."""
    return FALL_RATIO * terrain.dims.depth


def plan_falls(terrain: IslandTerrain) -> tuple[FallSource, ...]:
    """Alle Wasserfälle der Insel: die Bachmündung (falls vorhanden), dann die Quellen des Steckbriefs."""
    dims = terrain.dims
    sources: list[FallSource] = []
    outlet = terrain.stream_outlet()
    if outlet is not None:
        sources.append(FallSource(outlet.position, outlet.direction, outlet.half_width, 1.6 + 0.02 * dims.radius, "outlet"))
    if terrain.spec.springs > 0:
        finder = SpringFinder(terrain.with_detail(_SEARCH_DETAIL))
        sources.extend(finder.find(terrain.spec.springs, sources))
    return tuple(sources)


def outside_falls(points: FloatArray, sources: tuple[FallSource, ...], margin: float) -> BoolArray:
    """True für Punkte, die nicht im Vorhang eines Wasserfalls liegen (z. B. Ansätze hängender Wurzeln).

    Der Vorhang reicht quer bis zur doppelten Ansatzbreite plus ``margin`` und vom Wandfuß bis
    einige Meter vor die Wand.
    """
    keep = np.ones(len(points), dtype=bool)
    for source in sources:
        offset = points - source.position[None, :]
        across = np.abs(offset @ source.side)
        along = offset @ source.outward
        keep &= ~((across < 2.0 * source.half_width + margin) & (along > -4.0) & (along < 6.0) & (offset[:, 1] < 1.5))
    return keep


class SpringFinder:
    """Sucht Quellen in der Felswand (Quellensuche).

    Kandidaten liegen in festen Winkelschritten auf der Höhe der Grenze Erde/Fels; jeder bekommt
    die Bahn seines Wasserkörpers und den kleinsten Abstand zum Fels entlang dieser Bahn.
    """

    def __init__(self, field: IslandTerrain) -> None:
        self._field = field
        dims = field.dims
        self._height = FALL_RATIO * dims.depth
        self._half_width = float(np.clip(0.045 * dims.radius, 0.6, 2.0))
        self._speed = 1.4 + 0.035 * dims.radius
        rng = np.random.default_rng([field.spec.seed, zlib.crc32(b"springs")])
        self._angles = rng.uniform(0.0, 2.0 * np.pi / _CANDIDATES) + 2.0 * np.pi * np.arange(_CANDIDATES) / _CANDIDATES
        self._preference = 0.2 * rng.random(_CANDIDATES)
        self._sources, self._margins = self._candidates()

    def find(self, count: int, existing: list[FallSource]) -> list[FallSource]:
        """Wählt bis zu ``count`` Quellen mit größtem Abstand zum Fels und Abstand zu den vorhandenen Fällen."""
        suitable = [
            (float(self._angles[index]), min(float(self._margins[index]), 1.5) + float(self._preference[index]), source)
            for index, source in enumerate(self._sources)
            if source is not None and self._margins[index] > 0.0
        ]
        taken = [source.angle for source in existing]
        chosen: list[FallSource] = []
        for _ in range(count):
            free = [item for item in suitable if all(_angular_distance(item[0], angle) >= _MIN_SEPARATION for angle in taken)]
            if not free:
                break
            angle, _, source = max(free, key=lambda item: item[1])
            chosen.append(source)
            taken.append(angle)
        return chosen

    def _candidates(self) -> tuple[list[FallSource | None], FloatArray]:
        """Quellpunkte je Winkel und ihr kleinster Felsabstand entlang der Bahn (≤ 0: ungeeignet)."""
        field, dims = self._field, self._field.dims
        theta = self._angles
        rim = np.stack([np.cos(theta), np.sin(theta)], axis=1) * (0.97 * field.outline_radius(theta))[:, None]
        terrace = field.plan.terrace
        lift = terrace.lift(rim[:, 0], rim[:, 1]) if terrace is not None else np.zeros(len(theta))
        on_level = np.abs(field.terrace_fraction(rim) - 0.5) > 0.47
        wall = field.wall_points(theta, lift - _SPRING_LEVEL * dims.soil_depth)
        normals = field.gradient_normals(wall, epsilon=0.05)
        horizontal = normals[:, [0, 2]]
        steepness = np.linalg.norm(horizontal, axis=1)
        sources: list[FallSource | None] = []
        margins = np.full(len(theta), -np.inf)
        for index in range(len(theta)):
            if not on_level[index] or steepness[index] < 0.6:
                sources.append(None)
                continue
            direction = horizontal[index] / steepness[index]
            outward = np.array([direction[0], 0.0, direction[1]])
            source = FallSource(wall[index] - _SPRING_INSET * outward, direction, self._half_width, self._speed, "spring")
            sources.append(source)
            margins[index] = self._clearance(source)
        return sources, margins

    def _clearance(self, source: FallSource) -> float:
        """Kleinster Abstand des Wasserkörpers zum Fels abzüglich des geforderten Abstands (m)."""
        drops = 1.2 + (CORE_END * self._height - 1.2) * np.linspace(0.0, 1.0, _CHECK_ROWS) ** 1.6
        centre = _ballistic(source, drops)
        half_width = source.core_half_width(drops, self._height)
        points = centre[:, None, :] + (half_width[:, None] * _CHECK_ACROSS[None, :])[..., None] * source.side[None, None, :]
        distance = self._field.distance(points.reshape(-1, 3)).reshape(len(drops), len(_CHECK_ACROSS))
        required = 0.5 + 0.025 * drops
        return float((distance - required[:, None]).min())


def _angular_distance(first: float, second: float) -> float:
    """Kleinster Winkelabstand zweier Richtungen im Grundriss (0 … π)."""
    difference = (first - second + np.pi) % (2.0 * np.pi) - np.pi
    return abs(float(difference))
