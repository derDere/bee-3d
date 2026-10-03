"""Gemeinsamer Texturatlas für alle Chitinteile eines Materials (Chitin-Atlas).

Rumpf, Kopfkapsel, Rüssel und Beine teilen das Material ``<Art>_Body`` und damit eine Textur.
xatlas wickelt die Teile gemeinsam ab und packt sie mit gleicher Texeldichte in einen Atlas;
jedes Teil behält sein eigenes Netz (eigener Knoten im glTF). Für das Backen werden die Teile zu
einem Netz verbunden; ``part_of_face`` ordnet jedem Dreieck sein Teil zu.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from enum import IntEnum

import numpy as np
import numpy.typing as npt
import xatlas
from modelkit.geometry import ShadedMesh
from modelkit.uv import UnwrappedMesh, UvOptions

type FloatArray = npt.NDArray[np.float64]
type IntArray = npt.NDArray[np.int64]


class PartKind(IntEnum):
    """Art eines Chitinteils — bestimmt die Bemalung (Teilart)."""

    BODY = 0
    HEAD = 1
    PROBOSCIS = 2
    LEG = 3


@dataclass(frozen=True, slots=True)
class ChitinPart:
    """Deckendes Teil im Chitin-Atlas: Knotenname, Art und Netz im Modellrahmen (Chitinteil)."""

    node: str
    kind: PartKind
    mesh: ShadedMesh


@dataclass(frozen=True, slots=True)
class ChitinAtlas:
    """Abgewickelte Chitinteile und ihr verbundenes Netz zum Backen (Chitin-Atlas)."""

    parts: tuple[ChitinPart, ...]
    meshes: tuple[UnwrappedMesh, ...]
    combined: UnwrappedMesh
    vertex_offsets: IntArray
    face_offsets: IntArray

    def part_of_face(self, faces: IntArray) -> IntArray:
        """Index des Teils zu Dreiecksindizes des verbundenen Netzes."""
        return np.searchsorted(self.face_offsets, faces, side="right") - 1

    def split(self, values: FloatArray) -> list[FloatArray]:
        """Teilt Eckpunktwerte des verbundenen Netzes (z. B. Tangenten) auf die Teile auf."""
        return [values[start:end] for start, end in zip(self.vertex_offsets[:-1], self.vertex_offsets[1:], strict=True)]


def unwrap_parts(parts: Sequence[ChitinPart], options: UvOptions) -> ChitinAtlas:
    """Wickelt alle Teile gemeinsam ab (ein Atlas, gleiche Texeldichte) und verbindet sie zum Backen."""
    atlas = xatlas.Atlas()
    for part in parts:
        mesh = part.mesh
        atlas.add_mesh(mesh.vertices.astype(np.float32), mesh.faces.astype(np.uint32), mesh.normals.astype(np.float32))
    pack = xatlas.PackOptions()
    pack.resolution = options.resolution
    pack.padding = options.padding
    pack.texels_per_unit = options.texels_per_unit
    pack.bilinear = True
    atlas.generate(pack_options=pack)
    meshes = []
    for index, part in enumerate(parts):
        source, faces, uvs = atlas.get_mesh(index)
        source = source.astype(np.int64)
        meshes.append(UnwrappedMesh(part.mesh.vertices[source], part.mesh.normals[source], faces.astype(np.int64), uvs.astype(np.float64), source))
    vertex_offsets = np.cumsum([0] + [len(mesh.vertices) for mesh in meshes])
    face_offsets = np.cumsum([0] + [len(mesh.faces) for mesh in meshes])
    combined = UnwrappedMesh(
        np.concatenate([mesh.vertices for mesh in meshes]),
        np.concatenate([mesh.normals for mesh in meshes]),
        np.concatenate([mesh.faces + offset for mesh, offset in zip(meshes, vertex_offsets[:-1], strict=True)]),
        np.concatenate([mesh.uvs for mesh in meshes]),
        np.arange(int(vertex_offsets[-1])),
    )
    return ChitinAtlas(tuple(parts), tuple(meshes), combined, vertex_offsets, face_offsets)
