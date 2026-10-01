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
