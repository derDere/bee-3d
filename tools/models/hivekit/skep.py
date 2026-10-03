"""Strohkorb aus Wulstringen: Randwulst, Strohwülste, Knauf und Bodenplatte (Strohkorb).

Jeder Wulst ist ein eigener Ring: Querschnitt als halbe Superellipse zwischen zwei Rillenpunkten,
um die Hochachse gedreht. Benachbarte Ringe treffen sich in einer scharfen Rille; wo ihre
Winkelabtastung verschieden ist, taucht eine kurze Schürze unter den Nachbarn (keine Spalten).
Die Kachel-UVs laufen entlang des Wulstes (u, ganzzahlige Wiederholungen je Ring) und quer über
den Wulst (v von Rille zu Rille). Dieselben Ringe kleiden nach innen gewölbt die Kuppel der
Wabenhalle aus.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, replace

import numpy as np
import numpy.typing as npt

from hivekit.layout import HiveLayout
from hivekit.mesh import MeshPart, normalized, revolve
from hivekit.profiles import ProfileCurve

type FloatArray = npt.NDArray[np.float64]
type BoolArray = npt.NDArray[np.bool_]
type FaceFilter = Callable[[FloatArray], BoolArray]

_SECTION_EXPONENT = 2.2  # Superellipse des Wulstquerschnitts: 2 = Halbellipse, größer = voller


@dataclass(frozen=True, slots=True)
class CoilSettings:
    """Auflösung der Wulstringe einer Detailstufe (Wulsteinstellungen)."""

    cross_segments: int = 6
    chord: float = 0.55
    tile_length: float = 2.0
    skirt: float = 0.07
    fine_chord: float = 0.12
    fine_half_angle: float = 0.0


@dataclass(frozen=True, slots=True)
class CoilSection:
    """Querschnitt eines Wulstes im Meridian: Punkte und Normalen (Radius, Höhe) sowie v quer über den Wulst."""

    points: FloatArray
    normals: FloatArray
    v: FloatArray


def coil_section(
    lower: FloatArray,
    upper: FloatArray,
    bulge: float,
    segments: int,
    side: float,
    skirts: tuple[float, float] = (0.0, 0.0),
) -> CoilSection:
    """Halbe Superellipse zwischen zwei Rillenpunkten; ``side`` +1 wölbt nach außen, −1 zur Achse hin.

    ``skirts`` verlängert den Querschnitt an der unteren bzw. oberen Rille um eine Schürze dieser
    Tiefe, die unter den Nachbarwulst taucht.
    """
    chord = upper - lower
    along = chord / np.linalg.norm(chord)
    outward = side * np.array([along[1], -along[0]])
    tau = 0.5 - 0.5 * np.cos(np.pi * np.arange(segments + 1) / segments)
    centered = np.abs(2.0 * tau - 1.0)
    bump = (1.0 - centered**_SECTION_EXPONENT) ** (1.0 / _SECTION_EXPONENT)
    points = lower + tau[:, None] * chord + (bulge * bump)[:, None] * outward
    # Ableitung der Superellipse; an den Rillen senkrecht (die Wülste stoßen in einer scharfen Kerbe aneinander)
    clipped = np.clip(tau, 1e-4, 1.0 - 1e-4)
    folded = np.abs(2.0 * clipped - 1.0)
    slope = (
        -2.0
        * (1.0 - folded**_SECTION_EXPONENT) ** (1.0 / _SECTION_EXPONENT - 1.0)
        * folded ** (_SECTION_EXPONENT - 1.0)
    )
    slope *= np.sign(2.0 * clipped - 1.0)
    derivative = chord[None, :] + (bulge * slope)[:, None] * outward[None, :]
    normals = side * normalized(np.stack([derivative[:, 1], -derivative[:, 0]], axis=1))
    normals[0], normals[-1] = -along, along
    # Schürzen laufen schräg unter den Nachbarwulst, damit auch steile Blicke in die Rille keinen Spalt finden
    if skirts[0] > 0.0:
        points = np.concatenate([[lower - skirts[0] * (outward + 0.8 * along)], points])
        normals = np.concatenate([[-along], normals])
    if skirts[1] > 0.0:
        points = np.concatenate([points, [upper - skirts[1] * (outward - 0.8 * along)]])
        normals = np.concatenate([normals, [along]])
    lengths = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(points, axis=0), axis=1))])
    start = skirts[0] if skirts[0] > 0.0 else 0.0
    visible = lengths[-1] - start - skirts[1]
    return CoilSection(points, normals, (lengths - start) / max(visible, 1e-9))


def ring_thetas(radius: float, settings: CoilSettings) -> FloatArray:
    """Winkel von −π bis π (Naht hinten bei −Z); optional dichter um das Flugloch bei θ = 0."""
    count = int(8 * np.ceil(2.0 * np.pi * radius / (8.0 * settings.chord)))
    coarse = np.linspace(-np.pi, np.pi, max(count, 8) + 1)
    if settings.fine_half_angle <= 0.0:
        return coarse
    fine_count = int(np.ceil(2.0 * settings.fine_half_angle * radius / settings.fine_chord))
    fine = np.linspace(-settings.fine_half_angle, settings.fine_half_angle, fine_count + 1)
    kept = coarse[np.abs(coarse) > settings.fine_half_angle + 0.5 * (coarse[1] - coarse[0])]
    return np.sort(np.concatenate([kept, fine]))


@dataclass(frozen=True, slots=True)
class CoilRing:
    """Ein Wulstring zwischen zwei Rillenpunkten mit eigener Winkelabtastung (Wulstring)."""

    lower: FloatArray
    upper: FloatArray
    thetas: FloatArray
    tiles: int
    u_offset: float


class CoilShell:
    """Ringe entlang einer Rillenkurve, außen oder innen gewölbt (Wulstschale)."""

    def __init__(self, rings: list[CoilRing], bulge: float, side: float, settings: CoilSettings) -> None:
        self._rings = rings
        self._bulge = bulge
        self._side = side
        self._settings = settings

    @staticmethod
    def along_curve(
        curve: ProfileCurve,
        start: float,
        end: float,
        pitch: float,
        bulge: float,
        side: float,
        settings: CoilSettings,
        rng: np.random.Generator,
        fine_rings: Callable[[FloatArray, FloatArray], bool] | None = None,
    ) -> CoilShell:
        """Teilt den Kurvenabschnitt [start, end] in gleich breite Ringe nahe der Steigung ``pitch``."""
        count = max(1, round((end - start) / pitch))
        grooves = curve.at(np.linspace(start, end, count + 1))
        rings = []
        for lower, upper in zip(grooves[:-1], grooves[1:], strict=True):
            crest = 0.5 * (lower + upper)
            radius = float(crest[0]) + bulge * side
            fine = fine_rings is not None and fine_rings(lower, upper)
            ring_settings = settings if fine else replace(settings, fine_half_angle=0.0)
            thetas = ring_thetas(max(radius, 0.05), ring_settings)
            tiles = max(1, round(2.0 * np.pi * max(radius, 0.05) / settings.tile_length))
            rings.append(CoilRing(lower, upper, thetas, tiles, float(rng.uniform(0.0, 1.0))))
        return CoilShell(rings, bulge, side, settings)

    def meshes(
        self, face_filter: FaceFilter | None = None, first_skirt: bool = False, last_skirt: bool = False
    ) -> list[MeshPart]:
        """Netze aller Ringe; Schürzen an Rillen mit verschiedener Abtastung bzw. auf Wunsch an den Enden."""
        parts = []
        for index, ring in enumerate(self._rings):
            below = self._rings[index - 1] if index > 0 else None
            above = self._rings[index + 1] if index + 1 < len(self._rings) else None
            skirt = self._settings.skirt
            lower_skirt = (
                skirt if (below is None and first_skirt) or (below is not None and not _same(below, ring)) else 0.0
            )
            upper_skirt = (
                skirt if (above is None and last_skirt) or (above is not None and not _same(above, ring)) else 0.0
            )
            section = coil_section(
                ring.lower,
                ring.upper,
                self._bulge,
                self._settings.cross_segments,
                self._side,
                (lower_skirt, upper_skirt),
            )
            u = (ring.thetas + np.pi) / (2.0 * np.pi) * ring.tiles + ring.u_offset
            part = revolve(section.points, section.normals, section.v, ring.thetas, u)
            if face_filter is not None:
                part = part.compact(~_all_corners(part, face_filter))
            parts.append(part)
        return parts


def _same(first: CoilRing, second: CoilRing) -> bool:
    return len(first.thetas) == len(second.thetas) and bool(np.allclose(first.thetas, second.thetas))


def _all_corners(part: MeshPart, predicate: FaceFilter) -> BoolArray:
    """Dreiecke, deren drei Ecken das Prädikat erfüllen."""
    inside = predicate(part.vertices)
    return inside[part.faces].all(axis=1)


def entrance_cutter(layout: HiveLayout, clearance: float) -> FaceFilter:
    """Prädikat für Eckpunkte im Flugloch samt Rahmenauflage (vorn, Abstand zur Lochachse < Radius + ``clearance``)."""

    def inside(points: FloatArray) -> BoolArray:
        distance = np.hypot(points[:, 0], points[:, 1] - layout.entrance_height)
        return (points[:, 2] > 0.0) & (distance < layout.entrance_radius + clearance)

    return inside


def rim_rope(layout: HiveLayout, settings: CoilSettings, rng: np.random.Generator) -> MeshPart:
    """Randwulst: dicker Wulst vom ersten Rillenpunkt außen herum unter den Korb bis zur Bodenplatte."""
    center = np.asarray(layout.rim_center)
    start, stop = np.radians(layout.rim_groove_degrees), np.radians(layout.rim_inner_degrees - 360.0)
    steps = settings.cross_segments + 4
    angles = np.linspace(start, stop, steps + 1)
    direction = np.stack([np.cos(angles), np.sin(angles)], axis=1)
    points = center + layout.rim_radius * direction
    # Schürze an der Rille taucht unter den ersten Strohwulst, die Innenkante unter die Bodenplatte
    groove_along = normalized(layout.groove_curve.tangent(0.0)[0])
    outward = np.array([groove_along[1], -groove_along[0]])
    points = np.concatenate(
        [
            [points[0] - settings.skirt * (outward - 0.8 * groove_along)],
            points,
            [points[-1] + np.array([0.0, settings.skirt])],
        ]
    )
    normals = np.concatenate([[groove_along], direction, [direction[-1]]])
    lengths = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(points, axis=0), axis=1))])
    v = (lengths - lengths[1]) / (lengths[-2] - lengths[1])
    thetas = ring_thetas(float(center[0]) + layout.rim_radius, CoilSettings(chord=settings.chord))
    tiles = max(1, round(2.0 * np.pi * (float(center[0]) + layout.rim_radius) / settings.tile_length))
    u = (thetas + np.pi) / (2.0 * np.pi) * tiles + float(rng.uniform(0.0, 1.0))
    return revolve(points, normals, v, thetas, u)


def knob(layout: HiveLayout, settings: CoilSettings) -> MeshPart:
    """Strohknauf auf dem Scheitel: zwei kleine Wülste und eine Kuppel, durch die der Mast führt."""
    base_height = float(layout.groove_curve.height_at_radius(layout.knob_radius))
    t = np.linspace(0.0, 1.0, 2 * settings.cross_segments + 3)
    radius = layout.knob_radius * np.cos(0.5 * np.pi * t) ** 0.85
    radius *= 1.0 + 0.07 * np.sin(2.0 * np.pi * 2.0 * t) ** 2
    height = base_height - 0.12 + (layout.knob_top - base_height + 0.12) * np.sin(0.5 * np.pi * t) ** 1.2
    profile = np.stack([radius, height], axis=1)
    tangent = normalized(np.gradient(profile, axis=0))
    normals = np.stack([tangent[:, 1], -tangent[:, 0]], axis=1)
    lengths = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(profile, axis=0), axis=1))])
    thetas = ring_thetas(layout.knob_radius, CoilSettings(chord=settings.chord * 0.7))
    tiles = max(1, round(2.0 * np.pi * layout.knob_radius / settings.tile_length))
    return revolve(profile, normals, lengths / 0.9, thetas, (thetas + np.pi) / (2.0 * np.pi) * tiles)


def base_plate(layout: HiveLayout, rings: int, sides: int, tile: float) -> MeshPart:
    """Wachsboden unter dem Korb: flache Kuppel vom Randwulst zur Mitte, sichtbar von unten."""
    edge = float(layout.rim_inner[0])
    radii = edge * (1.0 - np.linspace(0.0, 1.0, rings + 1) ** 1.4)
    radii[0] = edge + 0.03
    heights = layout.base_plate_height(radii)
    profile = np.stack([radii, heights], axis=1)
    tangent = normalized(np.gradient(profile, axis=0))
    # Die Kurve läuft von außen zur Mitte: Normale nach unten
    normals = np.stack([-tangent[:, 1], tangent[:, 0]], axis=1)
    thetas = np.linspace(-np.pi, np.pi, sides + 1)
    part = revolve(profile, normals, np.zeros(len(profile)), thetas, np.zeros(len(thetas)))
    return part.with_uvs(part.vertices[:, [0, 2]] / tile)
