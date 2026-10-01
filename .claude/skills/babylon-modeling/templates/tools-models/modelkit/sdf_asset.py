"""Gemeinsamer Backablauf für Modelle aus Distanzfeldern (Feldmodell backen).

Netz aus dem groben Feld (budgetgerecht vernetzt), UV-Atlas, Texelkarte, Detailnormalen aus
dem feinen Feld und gebackene Verdeckung. Farbe und Rauheit bestimmt der Aufrufer je Texel.
"""

from __future__ import annotations

import math
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field

import numpy as np
import numpy.typing as npt

from modelkit.baking import TexelMap, bake_occlusion, rasterize_uv
from modelkit.geometry import ShadedMesh, TriangleMesh, area_weighted_normals
from modelkit.meshing import remesh_to_budget
from modelkit.sdf import Sdf
from modelkit.uv import UnwrappedMesh, UvOptions, unwrap

type FloatArray = npt.NDArray[np.float64]

_CHUNK = 1_000_000  # Texel je Auswertungsblock (begrenzt den RAM-Bedarf)
_TETRAHEDRON = np.array([[1.0, -1.0, -1.0], [-1.0, -1.0, 1.0], [-1.0, 1.0, -1.0], [1.0, 1.0, 1.0]])


@dataclass(frozen=True, slots=True)
class SdfAssetBake:
    """Zwischenstand eines Feldmodells (gebackenes Feldmodell): Netz, Tangenten, Texel, Normalen, AO."""

    mesh: UnwrappedMesh
    tangents: FloatArray
    texels: TexelMap
    detail_normals: FloatArray
    occlusion: FloatArray
    triangles: TriangleMesh
    timings: dict[str, float] = field(default_factory=dict)


@contextmanager
def stopwatch(label: str, timings: dict[str, float]) -> Iterator[None]:
    """Misst die Laufzeit eines Schritts in ``timings[label]`` (Sekunden)."""
    start = time.perf_counter()
    yield
    timings[label] = time.perf_counter() - start


def detail_normals(field_sdf: Sdf, points: FloatArray, step: float) -> FloatArray:
    """Normalen des Feldes per Tetraeder-Gradient (4 Auswertungen); ``step`` glättet unter einem Texel."""
    result = []
    for start in range(0, len(points), _CHUNK):
        block = points[start : start + _CHUNK]
        gradient = np.zeros_like(block)
        for corner in _TETRAHEDRON:
            gradient += corner[None, :] * field_sdf.distance(block + step * corner)[:, None]
        result.append(gradient / np.maximum(np.linalg.norm(gradient, axis=1, keepdims=True), 1e-12))
    return np.concatenate(result)


def bake_sdf_asset(
    fine: Sdf,
    coarse: Sdf,
    face_budget: int,
    texture_size: int,
    *,
    ao_rays: int,
    ao_distance: float,
    voxel_divisor: float = 2.0,
) -> SdfAssetBake:
    """Vernetzt ``coarse``, wickelt ab und berechnet Detailnormalen aus ``fine`` sowie die Verdeckung."""
    timings: dict[str, float] = {}
    with stopwatch("mesh", timings):
        triangles = remesh_to_budget(coarse, face_budget, voxel_divisor=voxel_divisor)
        normals = area_weighted_normals(triangles.vertices, triangles.faces)
    with stopwatch("unwrap", timings):
        mesh = unwrap(ShadedMesh(triangles.vertices, normals, triangles.faces), UvOptions(texture_size, padding=max(4, texture_size // 512)))
        tangents = mesh.tangents()
        texels = rasterize_uv(mesh, texture_size)
    with stopwatch("occlusion", timings):
        occlusion = bake_occlusion(texels, triangles, ao_rays, max_distance=ao_distance)
    with stopwatch("normals", timings):
        texel_size = math.sqrt(triangles.surface_area() / max(texels.count, 1))
        normals_hi = detail_normals(fine, texels.positions, step=0.5 * texel_size)
    return SdfAssetBake(mesh, tangents, texels, normals_hi, occlusion, triangles, timings)
