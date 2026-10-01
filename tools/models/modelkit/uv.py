"""UV-Abwicklung mit xatlas: Netz in Charts zerlegen und in einen Texturatlas packen (Texturkoordinaten)."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
import xatlas

from modelkit.geometry import ShadedMesh

type FloatArray = npt.NDArray[np.float64]
type IndexArray = npt.NDArray[np.int64]


@dataclass(frozen=True, slots=True)
class UvOptions:
    """Parameter der Abwicklung (Atlas-Einstellungen).

    ``resolution`` ist die Kantenlänge der Zieltextur in Pixeln, ``padding`` der Mindestabstand
    zwischen Inseln in Pixeln. ``texels_per_unit`` (Pixel je Meter) legt die Texeldichte fest;
    bei 0 skaliert xatlas die Inseln so, dass der Atlas die Textur füllt.
    """

    resolution: int
    padding: int = 4
    texels_per_unit: float = 0.0


@dataclass(frozen=True, slots=True)
class UnwrappedMesh:
    """Netz mit Texturkoordinaten (abgewickeltes Netz).

    Eckpunkte an UV-Nähten sind dupliziert. ``source_index`` verweist je Eckpunkt auf den
    Eckpunkt des Eingabenetzes, damit weitere Eckpunkt-Attribute übernommen werden können.
    """

    vertices: FloatArray
    normals: FloatArray
    faces: IndexArray
    uvs: FloatArray
    source_index: IndexArray

    def take(self, attributes: FloatArray) -> FloatArray:
        """Überträgt Eckpunkt-Attribute des Eingabenetzes auf die duplizierten Eckpunkte."""
        return attributes[self.source_index]

    def tangents(self) -> FloatArray:
        """Tangenten je Eckpunkt (V, 4) nach glTF: xyz = Richtung von +u, w = Händigkeit.

        Die Bitangente ``cross(N, T) · w`` zeigt zum Bildrand v = 0 (+Y einer glTF-Normal-Map).
        Flächengewichtet gemittelt und gegen die Normale orthogonalisiert (Gram-Schmidt).
        """
        p0, p1, p2 = (self.vertices[self.faces[:, i]] for i in range(3))
        t0, t1, t2 = (self.uvs[self.faces[:, i]] for i in range(3))
        e1, e2 = p1 - p0, p2 - p0
        d1, d2 = t1 - t0, t2 - t0
        determinant = d1[:, 0] * d2[:, 1] - d2[:, 0] * d1[:, 1]
        valid = np.abs(determinant) > 1e-20
        inverse = np.where(valid, 1.0 / np.where(valid, determinant, 1.0), 0.0)
        along_u = (e1 * d2[:, 1:2] - e2 * d1[:, 1:2]) * inverse[:, None]
        along_v = (e2 * d1[:, 0:1] - e1 * d2[:, 0:1]) * inverse[:, None]
        area = 0.5 * np.linalg.norm(np.cross(e1, e2), axis=1, keepdims=True)
        tangent_sum = np.zeros_like(self.vertices)
        bitangent_sum = np.zeros_like(self.vertices)
        for corner in range(3):
            np.add.at(tangent_sum, self.faces[:, corner], _normalized(along_u) * area)
            np.add.at(bitangent_sum, self.faces[:, corner], _normalized(along_v) * area)
        normals = self.normals
        tangent = tangent_sum - normals * np.einsum("ij,ij->i", tangent_sum, normals)[:, None]
        fallback = np.cross(normals, np.where(np.abs(normals[:, :1]) < 0.9, [[1.0, 0.0, 0.0]], [[0.0, 1.0, 0.0]]))
        tangent = np.where(np.linalg.norm(tangent, axis=1, keepdims=True) > 1e-12, tangent, fallback)
        tangent = _normalized(tangent)
        handedness = np.where(np.einsum("ij,ij->i", np.cross(normals, tangent), -bitangent_sum) < 0.0, -1.0, 1.0)
        return np.concatenate([tangent, handedness[:, None]], axis=1)

    def mirrored_x(self) -> UnwrappedMesh:
        """Spiegelt das Netz an der Ebene x = 0; die Texturkoordinaten bleiben erhalten."""
        flip = np.array([-1.0, 1.0, 1.0])
        return UnwrappedMesh(
            self.vertices * flip,
            self.normals * flip,
            self.faces[:, ::-1].copy(),
            self.uvs,
            self.source_index,
        )


def _normalized(vectors: FloatArray) -> FloatArray:
    return vectors / np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-12)


def unwrap(mesh: ShadedMesh, options: UvOptions) -> UnwrappedMesh:
    """Wickelt ein Netz ab; liefert das Netz mit UVs in [0, 1] (v nach unten wie in glTF)."""
    atlas = xatlas.Atlas()
    atlas.add_mesh(
        mesh.vertices.astype(np.float32),
        mesh.faces.astype(np.uint32),
        mesh.normals.astype(np.float32),
    )
    pack = xatlas.PackOptions()
    pack.resolution = options.resolution
    pack.padding = options.padding
    pack.texels_per_unit = options.texels_per_unit
    pack.bilinear = True
    atlas.generate(pack_options=pack)
    source_index, faces, uvs = atlas.get_mesh(0)
    source = source_index.astype(np.int64)
    return UnwrappedMesh(
        vertices=mesh.vertices[source],
        normals=mesh.normals[source],
        faces=faces.astype(np.int64),
        uvs=uvs.astype(np.float64),
        source_index=source,
    )
