"""Teilnetze des Bienenstocks mit Normalen, Kachel-UVs und Farbtönung je Eckpunkt (Netzteile).

Alle Teile tragen kachelnde Texturkoordinaten (Wiederholungen je Meter bzw. je Wulst) und eine
lineare Tönung je Eckpunkt; die gebackene Verdeckung (AO) wird später in die Tönung
multipliziert und als ``COLOR_0`` geschrieben. Bausteine: Gitterflächen, Rotationskörper,
Querschnitt-Sweeps entlang von Pfaden, Fächerdeckel und abgerundete Querschnitte.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, replace

import numpy as np
import numpy.typing as npt
from modelkit.geometry import TriangleMesh, area_weighted_normals
from modelkit.uv import UnwrappedMesh

type FloatArray = npt.NDArray[np.float64]
type IndexArray = npt.NDArray[np.int64]
type BoolArray = npt.NDArray[np.bool_]

_WELD_TOLERANCE = 1e-5  # m; deckungsgleiche Eckpunkte an UV-Nähten teilen ihre Normale


def normalized(vectors: FloatArray) -> FloatArray:
    """Normiert Vektoren entlang der letzten Achse (Nullvektoren bleiben null)."""
    return vectors / np.maximum(np.linalg.norm(vectors, axis=-1, keepdims=True), 1e-12)


def grid_faces(rows: int, cols: int) -> IndexArray:
    """Zwei Dreiecke je Zelle eines Gitters aus ``rows`` × ``cols`` Eckpunkten (zeilenweise abgelegt)."""
    grid = np.arange(rows * cols).reshape(rows, cols)
    a, b = grid[:-1, :-1].ravel(), grid[:-1, 1:].ravel()
    c, d = grid[1:, 1:].ravel(), grid[1:, :-1].ravel()
    return np.concatenate([np.stack([a, b, c], axis=1), np.stack([a, c, d], axis=1)]).astype(np.int64)


def welded_normals(vertices: FloatArray, faces: IndexArray) -> FloatArray:
    """Glatte, flächengewichtete Eckpunktnormalen; deckungsgleiche Eckpunkte (UV-Nähte) teilen ihre Normale."""
    keys = np.round(vertices / _WELD_TOLERANCE).astype(np.int64)
    _, inverse = np.unique(keys, axis=0, return_inverse=True)
    inverse = inverse.ravel()
    positions = np.zeros((int(inverse.max()) + 1, 3))
    positions[inverse] = vertices
    return area_weighted_normals(positions, inverse[faces])[inverse]


@dataclass(frozen=True, slots=True)
class MeshPart:
    """Teilnetz mit Normalen, Texturkoordinaten und linearer Tönung je Eckpunkt (Netzteil).

    ``tint`` multipliziert die Basisfarbe des Materials (lineares RGB); ``uvs`` kacheln
    (Sampler REPEAT), v läuft nach unten wie in glTF.
    """

    vertices: FloatArray
    normals: FloatArray
    faces: IndexArray
    uvs: FloatArray
    tint: FloatArray

    @classmethod
    def create(
        cls,
        vertices: FloatArray,
        normals: FloatArray,
        faces: IndexArray,
        uvs: FloatArray | None = None,
        tint: Sequence[float] | FloatArray | None = None,
    ) -> MeshPart:
        """Legt ein Teilnetz an; ohne UVs liegen alle Eckpunkte bei (0, 0), ohne Tönung ist sie weiß."""
        positions = np.asarray(vertices, dtype=np.float64).reshape(-1, 3)
        count = len(positions)
        coordinates = np.zeros((count, 2)) if uvs is None else np.asarray(uvs, dtype=np.float64).reshape(-1, 2)
        color = np.ones(3) if tint is None else np.asarray(tint, dtype=np.float64)
        return cls(
            positions,
            normalized(np.asarray(normals, dtype=np.float64).reshape(-1, 3)),
            np.asarray(faces, dtype=np.int64).reshape(-1, 3),
            coordinates,
            np.broadcast_to(color, (count, 3)).copy(),
        )

    @classmethod
    def empty(cls) -> MeshPart:
        """Leeres Teilnetz (neutrales Element beim Zusammenfügen)."""
        return cls(
            np.zeros((0, 3)), np.zeros((0, 3)), np.zeros((0, 3), dtype=np.int64), np.zeros((0, 2)), np.zeros((0, 3))
        )

    @property
    def vertex_count(self) -> int:
        """Anzahl der Eckpunkte."""
        return int(len(self.vertices))

    @property
    def face_count(self) -> int:
        """Anzahl der Dreiecke."""
        return int(len(self.faces))

    @staticmethod
    def concatenate(parts: Iterable[MeshPart]) -> MeshPart:
        """Fügt Teilnetze ohne Boolean zu einem Netz zusammen."""
        items = [part for part in parts if part.face_count > 0]
        if not items:
            return MeshPart.empty()
        offsets = np.cumsum([0] + [part.vertex_count for part in items[:-1]])
        return MeshPart(
            np.concatenate([part.vertices for part in items]),
            np.concatenate([part.normals for part in items]),
            np.concatenate([part.faces + offset for part, offset in zip(items, offsets, strict=True)]),
            np.concatenate([part.uvs for part in items]),
            np.concatenate([part.tint for part in items]),
        )

    def transformed(
        self, rotation: FloatArray | None = None, translation: Sequence[float] | FloatArray | None = None
    ) -> MeshPart:
        """Dreht (Matrix lokal → Welt) und verschiebt das Teil."""
        matrix = np.eye(3) if rotation is None else np.asarray(rotation, dtype=np.float64)
        offset = np.zeros(3) if translation is None else np.asarray(translation, dtype=np.float64)
        return replace(self, vertices=self.vertices @ matrix.T + offset, normals=self.normals @ matrix.T)

    def tinted(self, color: Sequence[float] | FloatArray) -> MeshPart:
        """Multipliziert die Tönung mit einer Farbe (3,) oder Farben je Eckpunkt (V, 3)."""
        return replace(self, tint=self.tint * np.asarray(color, dtype=np.float64))

    def with_uvs(self, uvs: FloatArray) -> MeshPart:
        """Ersetzt die Texturkoordinaten."""
        return replace(self, uvs=np.asarray(uvs, dtype=np.float64).reshape(-1, 2))

    def with_normals(self, normals: FloatArray) -> MeshPart:
        """Ersetzt die Normalen (werden normiert)."""
        return replace(self, normals=normalized(np.asarray(normals, dtype=np.float64)))

    def smoothed(self) -> MeshPart:
        """Berechnet glatte Normalen aus der Geometrie; UV-Nähte bleiben unsichtbar."""
        return replace(self, normals=welded_normals(self.vertices, self.faces))

    def oriented(self) -> MeshPart:
        """Dreht die Wicklung jener Dreiecke um, deren Flächennormale gegen ihre Eckpunktnormalen zeigt."""
        if self.face_count == 0:
            return self
        a, b, c = (self.vertices[self.faces[:, i]] for i in range(3))
        geometric = np.cross(b - a, c - a)
        reference = self.normals[self.faces].sum(axis=1)
        flip = np.einsum("ij,ij->i", geometric, reference) < 0.0
        faces = self.faces.copy()
        faces[flip] = faces[flip][:, ::-1]
        return replace(self, faces=faces)

    def compact(self, keep: BoolArray | None = None, min_area: float = 1e-9) -> MeshPart:
        """Behält die gewählten, nicht entarteten Dreiecke und entfernt unbenutzte Eckpunkte."""
        a, b, c = (self.vertices[self.faces[:, i]] for i in range(3))
        area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
        mask = area > min_area if keep is None else (area > min_area) & keep
        faces = self.faces[mask]
        used = np.unique(faces)
        remap = np.full(self.vertex_count, -1, dtype=np.int64)
        remap[used] = np.arange(len(used))
        return MeshPart(self.vertices[used], self.normals[used], remap[faces], self.uvs[used], self.tint[used])

    def tangents(self) -> FloatArray:
        """Tangenten je Eckpunkt (V, 4) nach glTF aus den Kachel-UVs (xyz = +u, w = Händigkeit)."""
        return UnwrappedMesh(self.vertices, self.normals, self.faces, self.uvs, np.arange(self.vertex_count)).tangents()

    def triangle_mesh(self) -> TriangleMesh:
        """Reine Geometrie, z. B. als Verdecker für die AO-Strahlen."""
        return TriangleMesh(self.vertices, self.faces)


def revolve(
    profile: FloatArray,
    profile_normals: FloatArray,
    v: FloatArray,
    thetas: FloatArray,
    u: FloatArray,
) -> MeshPart:
    """Rotationskörper um +Y: Profil (M, 2) als (Radius, Höhe) mit Normalen (M, 2), Winkel ab +Z (θ = 0) über +X.

    ``v`` (M,) und ``u`` (N,) sind die Texturkoordinaten je Profilpunkt bzw. je Winkel; für
    geschlossene Körper wiederholt der letzte Winkel den ersten (UV-Naht).
    """
    sin, cos = np.sin(thetas)[None, :], np.cos(thetas)[None, :]
    radius, height = profile[:, 0:1], profile[:, 1:2]
    vertices = np.stack([radius * sin, np.broadcast_to(height, (len(profile), len(thetas))), radius * cos], axis=-1)
    normal_r, normal_y = profile_normals[:, 0:1], profile_normals[:, 1:2]
    normals = np.stack(
        [normal_r * sin, np.broadcast_to(normal_y, (len(profile), len(thetas))), normal_r * cos], axis=-1
    )
    uvs = np.stack(np.broadcast_arrays(u[None, :], v[:, None]), axis=-1)
    part = MeshPart.create(
        vertices.reshape(-1, 3), normals.reshape(-1, 3), grid_faces(len(profile), len(thetas)), uvs.reshape(-1, 2)
    )
    return part.oriented().compact()


def sweep_section(
    points: FloatArray,
    axis_a: FloatArray,
    axis_b: FloatArray,
    section: FloatArray,
    section_normals: FloatArray,
    u: FloatArray,
    v: FloatArray,
    scale: FloatArray | None = None,
) -> MeshPart:
    """Zieht einen Querschnitt (M, 2) entlang eines Pfades (K, 3).

    Der Querschnittspunkt (a, b) liegt bei ``points + scale · (a · axis_a + b · axis_b)``; die
    Normalen folgen derselben Basis. ``u`` (K,) läuft entlang des Pfades, ``v`` (M,) um den
    Querschnitt. Für veränderliche Radien die Normalen mit ``MeshPart.smoothed`` neu berechnen.
    """
    factor = np.ones(len(points)) if scale is None else np.asarray(scale, dtype=np.float64)
    offsets = section[None, :, 0:1] * axis_a[:, None, :] + section[None, :, 1:2] * axis_b[:, None, :]
    vertices = points[:, None, :] + factor[:, None, None] * offsets
    normals = section_normals[None, :, 0:1] * axis_a[:, None, :] + section_normals[None, :, 1:2] * axis_b[:, None, :]
    uvs = np.stack(np.broadcast_arrays(u[:, None], v[None, :]), axis=-1)
    part = MeshPart.create(
        vertices.reshape(-1, 3), normals.reshape(-1, 3), grid_faces(len(points), len(section)), uvs.reshape(-1, 2)
    )
    return part.oriented().compact()


def fan_cap(
    ring: FloatArray, center: FloatArray, normal: Sequence[float] | FloatArray, uv_scale: float = 1.0
) -> MeshPart:
    """Ebener Deckel aus einem Ring (M, 3) und seinem Mittelpunkt; UVs planar in Metern × ``uv_scale``."""
    direction = normalized(np.asarray(normal, dtype=np.float64))
    helper = np.array([1.0, 0.0, 0.0]) if abs(direction[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    first = normalized(np.cross(helper, direction))
    second = np.cross(direction, first)
    vertices = np.concatenate([ring, np.asarray(center, dtype=np.float64)[None, :]])
    relative = vertices - vertices[-1]
    uvs = np.stack([relative @ first, relative @ second], axis=1) * uv_scale
    count = len(ring)
    faces = np.stack([np.arange(count), (np.arange(count) + 1) % count, np.full(count, count)], axis=1)
    return MeshPart.create(vertices, np.broadcast_to(direction, vertices.shape), faces, uvs).oriented().compact()


def rounded_rectangle(
    width: float, height: float, radius: float, corner_segments: int, side_segments: int = 1
) -> tuple[FloatArray, FloatArray]:
    """Geschlossener Querschnitt eines Rechtecks mit abgerundeten Ecken (gegen den Uhrzeigersinn).

    Liefert Punkte (M + 1, 2) mit wiederholtem Startpunkt (UV-Naht) und ihre Normalen;
    ``side_segments`` unterteilt die geraden Seiten.
    """
    half = np.array([width * 0.5 - radius, height * 0.5 - radius])
    centers = np.array([[half[0], half[1]], [-half[0], half[1]], [-half[0], -half[1]], [half[0], -half[1]]])
    points, normals = [], []
    for corner, center in enumerate(centers):
        angles = np.radians(90.0 * corner + np.linspace(0.0, 90.0, corner_segments + 1))
        direction = np.stack([np.cos(angles), np.sin(angles)], axis=1)
        points.append(center + radius * direction)
        normals.append(direction)
        following = centers[(corner + 1) % 4] + radius * direction[-1]
        steps = np.linspace(0.0, 1.0, side_segments + 1)[1:-1, None]
        points.append(points[-1][-1] + steps * (following - points[-1][-1]))
        normals.append(np.repeat(direction[-1:], len(steps), axis=0))
    loop, loop_normals = np.concatenate(points), np.concatenate(normals)
    return np.concatenate([loop, loop[:1]]), np.concatenate([loop_normals, loop_normals[:1]])


def plank(
    start: FloatArray,
    end: FloatArray,
    up: Sequence[float],
    width: float,
    thickness: float,
    rounding: float,
    uv_per_meter: float,
) -> MeshPart:
    """Brett bzw. Balken zwischen zwei Punkten mit abgerundeten Längskanten und Stirnflächen.

    ``up`` gibt die Richtung der Dicke vor; u läuft entlang der Faser (je Meter ``uv_per_meter``).
    """
    begin, finish = np.asarray(start, dtype=np.float64), np.asarray(end, dtype=np.float64)
    along = normalized(finish - begin)
    normal = normalized(np.asarray(up, dtype=np.float64) - along * (np.asarray(up, dtype=np.float64) @ along))
    side = np.cross(normal, along)
    section, section_normals = rounded_rectangle(width, thickness, rounding, 2)
    path = np.stack([begin, finish])
    perimeter = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(section, axis=0), axis=1))])
    length = float(np.linalg.norm(finish - begin))
    body = sweep_section(
        path,
        np.broadcast_to(side, (2, 3)),
        np.broadcast_to(normal, (2, 3)),
        section,
        section_normals,
        np.array([0.0, length]) * uv_per_meter,
        perimeter * uv_per_meter,
    )
    loop = section[:-1]
    caps = [
        fan_cap(origin + loop[:, 0:1] * side + loop[:, 1:2] * normal, origin, direction * along, uv_per_meter)
        for origin, direction in ((begin, -1.0), (finish, 1.0))
    ]
    return MeshPart.concatenate([body, *caps])
