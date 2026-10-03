"""Wabenzellen und Naturwaben: Sechseckgitter, Zellbecher mit Honig oder Deckel, Wabenscheiben (Waben).

Zellen sitzen in einem Sechseckgitter mit senkrechten Seitenwänden und Spitzen oben und unten
(wie in Naturwaben). Benachbarte Zellen teilen ihre Randecken, die Wände laufen oben scharf
zusammen. Jede offene Zelle ist ein Becher aus Randring, verjüngtem Bodenring und
Pyramidenboden mit eigenen, glatten Normalen; Honigzellen tragen zusätzlich einen
Honigspiegel, verdeckelte Zellen einen gewölbten Wachsdeckel. Flächen bilden die Zellen über
eine Abbildung ``CellSurface`` (Ebene einer Wabe oder Wand der Halle).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

import manifold3d as m3d
import numpy as np
import numpy.typing as npt

from hivekit.mesh import MeshPart, normalized, sweep_section

type FloatArray = npt.NDArray[np.float64]
type IndexArray = npt.NDArray[np.int64]
type BoolArray = npt.NDArray[np.bool_]

# Ecken eines Sechsecks mit Spitze oben, gegen den Uhrzeigersinn ab der oberen Spitze
_CORNER_ANGLES = np.radians(90.0 + 60.0 * np.arange(6))
_CUP_WALLS = np.array([[k, (k + 1) % 6, 6 + (k + 1) % 6, k, 6 + (k + 1) % 6, 6 + k] for k in range(6)]).reshape(-1, 3)
_CUP_BOTTOM = np.array([[6 + k, 6 + (k + 1) % 6, 12] for k in range(6)])
_CUP_FACES = np.concatenate([_CUP_WALLS, _CUP_BOTTOM])
_HEX_FAN = np.array([[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 5]])
_DOME_FAN = np.array([[k, (k + 1) % 6, 6] for k in range(6)])


class CellKind(StrEnum):
    """Zustand einer Wabenzelle (Zellart)."""

    EMPTY = "empty"
    HONEY = "honey"
    CAPPED = "capped"
    FLAT = "flat"


class CellSurface(Protocol):
    """Abbildung von Flächenparametern (N, 2) in Meter auf Punkte und Normalen zum Betrachter (Zellfläche)."""

    def point(self, params: FloatArray) -> FloatArray: ...

    def normal(self, params: FloatArray) -> FloatArray: ...


@dataclass(frozen=True, slots=True)
class PlaneSurface:
    """Ebene mit Ursprung und Achsen; die Normale ``axis_u × axis_v`` zeigt zum Betrachter (Ebene)."""

    origin: FloatArray
    axis_u: FloatArray
    axis_v: FloatArray

    def point(self, params: FloatArray) -> FloatArray:
        return self.origin + params[:, 0:1] * self.axis_u + params[:, 1:2] * self.axis_v

    def normal(self, params: FloatArray) -> FloatArray:
        return np.broadcast_to(normalized(np.cross(self.axis_u, self.axis_v)), (len(params), 3)).copy()


@dataclass(frozen=True, slots=True)
class HexLattice:
    """Sechseckgitter mit Spitze oben; ``width`` ist die Schlüsselweite zwischen den senkrechten Wänden (Wabengitter)."""

    width: float

    @property
    def circumradius(self) -> float:
        """Abstand von der Zellmitte zu einer Ecke."""
        return self.width / np.sqrt(3.0)

    @property
    def row_spacing(self) -> float:
        """Abstand benachbarter Zellreihen."""
        return 1.5 * self.circumradius

    def centers(
        self, lower: Sequence[float], upper: Sequence[float], phase: Sequence[float] | FloatArray = (0.0, 0.0)
    ) -> FloatArray:
        """Zellmitten (N, 2) im Rechteck ``lower``–``upper``; jede zweite Reihe um eine halbe Zelle versetzt."""
        rows = np.arange(
            np.floor((lower[1] - phase[1]) / self.row_spacing) - 1,
            np.ceil((upper[1] - phase[1]) / self.row_spacing) + 2,
        )
        columns = np.arange(
            np.floor((lower[0] - phase[0]) / self.width) - 2, np.ceil((upper[0] - phase[0]) / self.width) + 2
        )
        row, column = np.meshgrid(rows, columns, indexing="ij")
        x = phase[0] + (column + 0.5 * (np.mod(row, 2.0))) * self.width
        y = phase[1] + row * self.row_spacing
        centers = np.stack([x.ravel(), y.ravel()], axis=1)
        inside = np.all(
            (centers >= np.asarray(lower) - self.width) & (centers <= np.asarray(upper) + self.width), axis=1
        )
        return centers[inside]

    def corners(self, centers: FloatArray, scale: float = 1.0) -> FloatArray:
        """Ecken (N, 6, 2) gegen den Uhrzeigersinn ab der oberen Spitze."""
        direction = np.stack([np.cos(_CORNER_ANGLES), np.sin(_CORNER_ANGLES)], axis=1)
        return centers[:, None, :] + self.circumradius * scale * direction[None, :, :]


@dataclass(frozen=True, slots=True)
class CellStyle:
    """Form der Zellbecher (Zellform): Verjüngung, Tiefe des Pyramidenbodens, Wölbung der Deckel, UV-Kachel."""

    taper: float = 0.16
    bottom_point: float = 0.14
    cap_bulge: float = 0.05
    uv_tile: float = 1.2


@dataclass(frozen=True, slots=True)
class CellSet:
    """Zellen einer Fläche (Zellsatz): Mitten (N, 2), Arten, Tiefen, Honigspiegel (Anteil der Tiefe) und Wachstönung (N, 3)."""

    centers: FloatArray
    kinds: tuple[CellKind, ...]
    depths: FloatArray
    fills: FloatArray
    tints: FloatArray

    def select(self, mask: BoolArray) -> CellSet:
        """Teilmenge in unveränderter Reihenfolge."""
        return CellSet(
            self.centers[mask],
            tuple(kind for kind, keep in zip(self.kinds, mask, strict=True) if keep),
            self.depths[mask],
            self.fills[mask],
            self.tints[mask],
        )

    def of_kind(self, *kinds: CellKind) -> CellSet:
        """Nur Zellen der genannten Arten."""
        return self.select(np.array([kind in kinds for kind in self.kinds], dtype=bool))

    @property
    def count(self) -> int:
        """Anzahl der Zellen."""
        return int(len(self.centers))


@dataclass(frozen=True, slots=True)
class CellMeshes:
    """Netze eines Zellfelds: Wachs (Becher, Deckel, Füllflächen) und Honigspiegel (Zellnetze)."""

    wax: MeshPart
    honey: MeshPart


def build_cells(
    surface: CellSurface, lattice: HexLattice, cells: CellSet, style: CellStyle, rng: np.random.Generator
) -> CellMeshes:
    """Erzeugt Becher, Honigspiegel, Deckel und Füllflächen aller Zellen einer Fläche."""
    cups = cells.of_kind(CellKind.EMPTY, CellKind.HONEY)
    wax = [
        _cups(surface, lattice, cups, style),
        _domes(surface, lattice, cells.of_kind(CellKind.CAPPED), style),
        _flats(surface, lattice, cells.of_kind(CellKind.FLAT), style),
    ]
    honey = _honey(surface, lattice, cells.of_kind(CellKind.HONEY), style, rng)
    return CellMeshes(MeshPart.concatenate(wax), honey)


def _cup_points(
    surface: CellSurface, lattice: HexLattice, cells: CellSet, style: CellStyle
) -> tuple[FloatArray, FloatArray, FloatArray, FloatArray]:
    """Randring, Bodenring und Bodenspitze (N, 6, 3), (N, 6, 3), (N, 3) samt Zellachsen (N, 3)."""
    count = cells.count
    corners = lattice.corners(cells.centers)
    inset = lattice.corners(cells.centers, 1.0 - style.taper)
    axis = surface.normal(cells.centers)
    rim = surface.point(corners.reshape(-1, 2)).reshape(count, 6, 3)
    bottom = surface.point(inset.reshape(-1, 2)).reshape(count, 6, 3) - (cells.depths[:, None, None] * axis[:, None, :])
    tip = surface.point(cells.centers) - (cells.depths * (1.0 + style.bottom_point))[:, None] * axis
    return rim, bottom, tip, axis


def _cups(surface: CellSurface, lattice: HexLattice, cells: CellSet, style: CellStyle) -> MeshPart:
    if cells.count == 0:
        return MeshPart.empty()
    count = cells.count
    rim, bottom, tip, axis = _cup_points(surface, lattice, cells, style)
    vertices = np.concatenate([rim, bottom, tip[:, None, :]], axis=1)
    faces = _CUP_FACES[None, :, :] + 13 * np.arange(count)[:, None, None]
    # Wicklung je Becher prüfen: die Bodenfläche muss zur Zellöffnung (Achse) zeigen
    a, b, c = (vertices[:, _CUP_BOTTOM[0, i]] for i in range(3))
    flip = np.einsum("ij,ij->i", np.cross(b - a, c - a), axis) < 0.0
    faces[flip] = faces[flip][:, :, ::-1]
    flat_vertices = vertices.reshape(-1, 3)
    flat_faces = faces.reshape(-1, 3)
    normals = _per_cup_normals(flat_vertices, flat_faces, count)
    # Ränder etwas zur Fläche geneigt: weicher Lichtsaum auf den Wandkronen
    rim_normals = normals.reshape(count, 13, 3)
    rim_normals[:, :6] = normalized(rim_normals[:, :6] + 0.35 * axis[:, None, :])
    params = np.concatenate(
        [lattice.corners(cells.centers), lattice.corners(cells.centers, 1.0 - style.taper), cells.centers[:, None, :]],
        axis=1,
    )
    depth_offset = np.concatenate(
        [np.zeros((count, 6)), np.repeat(cells.depths[:, None], 6, axis=1), cells.depths[:, None] * 1.1], axis=1
    )
    uvs = (params + depth_offset[..., None] * np.array([0.0, 0.7])) / style.uv_tile
    shade = np.concatenate([np.ones(6), np.full(6, 0.82), [0.74]])
    tint = cells.tints[:, None, :] * shade[None, :, None]
    return MeshPart(flat_vertices, rim_normals.reshape(-1, 3), flat_faces, uvs.reshape(-1, 2), tint.reshape(-1, 3))


def _per_cup_normals(vertices: FloatArray, faces: IndexArray, count: int) -> FloatArray:
    """Flächengewichtete Normalen; jeder Becher hat eigene Eckpunkte, die Kronen bleiben dadurch scharf."""
    a, b, c = (vertices[faces[:, i]] for i in range(3))
    face_normals = np.cross(b - a, c - a)
    normals = np.zeros_like(vertices)
    for corner in range(3):
        np.add.at(normals, faces[:, corner], face_normals)
    return normalized(normals)


def _domes(surface: CellSurface, lattice: HexLattice, cells: CellSet, style: CellStyle) -> MeshPart:
    if cells.count == 0:
        return MeshPart.empty()
    count = cells.count
    corners = lattice.corners(cells.centers)
    rim = surface.point(corners.reshape(-1, 2)).reshape(count, 6, 3)
    axis = surface.normal(cells.centers)
    center = surface.point(cells.centers) + style.cap_bulge * lattice.width * axis
    vertices = np.concatenate([rim, center[:, None, :]], axis=1)
    spread = normalized(rim - surface.point(cells.centers)[:, None, :])
    normals = np.concatenate([normalized(axis[:, None, :] + 0.55 * spread), axis[:, None, :]], axis=1)
    faces = _DOME_FAN[None, :, :] + 7 * np.arange(count)[:, None, None]
    params = np.concatenate([corners, cells.centers[:, None, :]], axis=1)
    tint = np.repeat(cells.tints[:, None, :], 7, axis=1)
    part = MeshPart(
        vertices.reshape(-1, 3),
        normals.reshape(-1, 3),
        faces.reshape(-1, 3),
        (params / style.uv_tile).reshape(-1, 2),
        tint.reshape(-1, 3),
    )
    return part.oriented()


def _flats(surface: CellSurface, lattice: HexLattice, cells: CellSet, style: CellStyle) -> MeshPart:
    if cells.count == 0:
        return MeshPart.empty()
    count = cells.count
    corners = lattice.corners(cells.centers)
    vertices = surface.point(corners.reshape(-1, 2))
    normals = surface.normal(corners.reshape(-1, 2))
    faces = _HEX_FAN[None, :, :] + 6 * np.arange(count)[:, None, None]
    tint = np.repeat(cells.tints[:, None, :], 6, axis=1)
    return MeshPart(
        vertices, normals, faces.reshape(-1, 3), (corners / style.uv_tile).reshape(-1, 2), tint.reshape(-1, 3)
    ).oriented()


def _honey(
    surface: CellSurface, lattice: HexLattice, cells: CellSet, style: CellStyle, rng: np.random.Generator
) -> MeshPart:
    """Honigspiegel: Sechseck auf Höhe des Füllstands im Becher.

    Die UVs legen das Sechseck mittig auf die Honigtextur, deren Glühen zur Mitte hin zunimmt;
    eine zufällige Drehung je Zelle verteilt die Schlieren.
    """
    if cells.count == 0:
        return MeshPart.empty()
    count = cells.count
    rim, bottom, _, axis = _cup_points(surface, lattice, cells, style)
    level = (1.0 - cells.fills)[:, None, None]
    ring = rim + (bottom - rim) * level
    faces = _HEX_FAN[None, :, :] + 6 * np.arange(count)[:, None, None]
    turn = rng.uniform(0.0, 2.0 * np.pi, (count, 1)) + _CORNER_ANGLES[None, :]
    uvs = 0.5 + 0.44 * np.stack([np.cos(turn), np.sin(turn)], axis=-1)
    normals = np.repeat(axis[:, None, :], 6, axis=1)
    part = MeshPart(
        ring.reshape(-1, 3), normals.reshape(-1, 3), faces.reshape(-1, 3), uvs.reshape(-1, 2), np.ones((count * 6, 3))
    )
    return part.oriented()


# Ebene Polygone -----------------------------------------------------------------------------


def polygon_contains(points: FloatArray, contours: Sequence[FloatArray]) -> BoolArray:
    """Punkt-in-Polygon nach der Gerade-Ungerade-Regel über alle Konturen (Außenkonturen und Löcher)."""
    inside = np.zeros(len(points), dtype=bool)
    x, y = points[:, 0:1], points[:, 1:2]
    for contour in contours:
        start, end = contour, np.roll(contour, -1, axis=0)
        crosses = (start[None, :, 1] > y) != (end[None, :, 1] > y)
        with np.errstate(divide="ignore", invalid="ignore"):
            hit_x = start[None, :, 0] + (y - start[None, :, 1]) * (end[None, :, 0] - start[None, :, 0]) / (
                end[None, :, 1] - start[None, :, 1]
            )
        inside ^= (np.count_nonzero(crosses & (x < hit_x), axis=1) % 2) == 1
    return inside


def cells_inside(lattice: HexLattice, centers: FloatArray, region: m3d.CrossSection) -> BoolArray:
    """Zellen, deren sechs Ecken alle in der Region liegen."""
    contours = region.to_polygons()
    if not contours or len(centers) == 0:
        return np.zeros(len(centers), dtype=bool)
    corners = lattice.corners(centers).reshape(-1, 2)
    return polygon_contains(corners, contours).reshape(-1, 6).all(axis=1)


def hexagon_union(lattice: HexLattice, centers: FloatArray) -> m3d.CrossSection:
    """Vereinigung der Zellsechsecke als ebener Querschnitt (gemeinsame Kanten verschmelzen)."""
    if len(centers) == 0:
        return m3d.CrossSection()
    hexagons = [m3d.CrossSection([corners]) for corners in lattice.corners(centers, 1.0 + 1e-6)]
    return m3d.CrossSection.batch_boolean(hexagons, m3d.OpType.Add)


def triangulated_region(region: m3d.CrossSection, surface: CellSurface, uv_tile: float) -> MeshPart:
    """Trianguliert eine ebene Region (mit Löchern) und bildet sie auf die Fläche ab."""
    contours = [contour for contour in region.to_polygons() if len(contour) >= 3]
    if not contours:
        return MeshPart.empty()
    points = np.concatenate(contours)
    triangles = m3d.triangulate(contours)
    if len(triangles) == 0:
        return MeshPart.empty()
    part = MeshPart.create(
        surface.point(points), surface.normal(points), np.asarray(triangles, dtype=np.int64), points / uv_tile
    )
    return part.oriented().compact()


# Naturwaben ---------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class CombOutline:
    """Umriss einer hängenden Wabe in ihrer Ebene, (x, y) gegen den Uhrzeigersinn; ``rim`` ist der sichtbare U-Rand (Wabenumriss)."""

    polygon: FloatArray
    rim: FloatArray

    def section(self) -> m3d.CrossSection:
        """Umriss als ebener Querschnitt."""
        return m3d.CrossSection([self.polygon])


def comb_outline(
    half_width: float,
    length: float,
    top: float,
    tip_shift: float,
    samples: int,
    rng: np.random.Generator,
    wobble: float,
) -> CombOutline:
    """Zungenförmiger Wabenumriss: oben voll, zur runden Spitze hin verjüngt; leichte Unregelmäßigkeit und schräge Spitze."""
    t = np.sin(0.5 * np.pi * np.linspace(0.0, 1.0, samples + 1))
    depth = length * t
    half = half_width * np.clip(1.0 - t**2.0, 0.0, 1.0) ** (1.0 / 1.5)
    shift = tip_shift * t**2
    phases = rng.uniform(0.0, 2.0 * np.pi, 3)
    left_noise = wobble * (np.sin(5.0 * t + phases[0]) + 0.5 * np.sin(11.0 * t + phases[1]))
    right_noise = wobble * (np.sin(6.0 * t + phases[2]) + 0.5 * np.sin(13.0 * t + phases[0]))
    left = np.stack([-half + shift - left_noise * (1.0 - t**4), top - depth], axis=1)
    right = np.stack([half + shift + right_noise * (1.0 - t**4), top - depth], axis=1)
    # Linke Seite abwärts, über die Spitze, rechte Seite aufwärts (gegen den Uhrzeigersinn)
    rim = np.concatenate([left, right[::-1][1:]])
    return CombOutline(rim.copy(), rim)


def comb_rim(outline: CombOutline, plane_z: float, thickness: float, sides: int, uv_tile: float) -> MeshPart:
    """Runder Wabenrand: halber Kreisquerschnitt entlang des U-Rands, tangential an beide Wabenflächen."""
    path = outline.rim
    tangent = normalized(np.gradient(path, axis=0))
    outward = np.stack([tangent[:, 1], -tangent[:, 0]], axis=1)
    points = np.concatenate([path, np.full((len(path), 1), plane_z)], axis=1)
    axis_a = np.concatenate([outward, np.zeros((len(path), 1))], axis=1)
    axis_b = np.broadcast_to(np.array([0.0, 0.0, 1.0]), axis_a.shape)
    angles = np.linspace(-0.5 * np.pi, 0.5 * np.pi, sides + 1)
    section = 0.5 * thickness * np.stack([np.cos(angles), np.sin(angles)], axis=1)
    lengths = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))])
    return sweep_section(
        points,
        axis_a,
        axis_b,
        section,
        section / (0.5 * thickness),
        lengths / uv_tile,
        angles * 0.5 * thickness / uv_tile,
    )
