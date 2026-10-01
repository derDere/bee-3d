"""Texturen backen: UV-Rasterisierung, Texelwerte aus Funktionen, AO, Dilatation und Kodierung (Baking)."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from scipy import ndimage

from modelkit.geometry import TriangleMesh
from modelkit.shading import bake_ambient_occlusion, linear_to_srgb
from modelkit.uv import UnwrappedMesh

type FloatArray = npt.NDArray[np.float64]
type IntArray = npt.NDArray[np.int64]
type ByteImage = npt.NDArray[np.uint8]

_CANDIDATES_PER_CHUNK = 4_000_000  # Obergrenze der Texelkandidaten je Rasterisierungsblock (begrenzt den RAM-Bedarf)
_DEFAULT_DILATION = 8  # Pixel, um die Inselränder über die Abdeckung hinaus fortgesetzt werden


@dataclass(frozen=True, slots=True)
class TexelMap:
    """Abbildung der abgedeckten Texel auf die Oberfläche (Texelkarte).

    Je abgedecktem Texel (Zeile ``rows``, Spalte ``cols``; Zeile 0 entspricht v = 0, wie in glTF)
    liegen Dreieck, Baryzentrik, Weltposition und interpolierte Normale vor.
    """

    resolution: int
    mesh: UnwrappedMesh
    rows: IntArray
    cols: IntArray
    faces: IntArray
    barycentric: FloatArray
    positions: FloatArray
    normals: FloatArray

    @property
    def count(self) -> int:
        """Anzahl der abgedeckten Texel."""
        return int(len(self.rows))

    def coverage(self) -> npt.NDArray[np.bool_]:
        """Abdeckungsmaske (Auflösung × Auflösung)."""
        mask = np.zeros((self.resolution, self.resolution), dtype=bool)
        mask[self.rows, self.cols] = True
        return mask

    def interpolate(self, vertex_values: FloatArray) -> FloatArray:
        """Interpoliert Eckpunktwerte (V, C) baryzentrisch auf die Texel (N, C)."""
        corners = vertex_values[self.mesh.faces[self.faces]]
        return np.einsum("nk,nkc->nc", self.barycentric, corners)


def _barycentric(triangles: FloatArray, points: FloatArray) -> FloatArray:
    """Baryzentrische Koordinaten von Punkten (N, 2) in Dreiecken (N, 3, 2); degenerierte liefern NaN."""
    a, b, c = triangles[:, 0], triangles[:, 1], triangles[:, 2]
    v0, v1, v2 = b - a, c - a, points - a
    denominator = v0[:, 0] * v1[:, 1] - v1[:, 0] * v0[:, 1]
    with np.errstate(divide="ignore", invalid="ignore"):
        w1 = (v2[:, 0] * v1[:, 1] - v1[:, 0] * v2[:, 1]) / denominator
        w2 = (v0[:, 0] * v2[:, 1] - v2[:, 0] * v0[:, 1]) / denominator
    return np.stack([1.0 - w1 - w2, w1, w2], axis=1)


def _chunk_bounds(counts: IntArray) -> list[tuple[int, int]]:
    """Teilt Dreiecke in Blöcke mit begrenzter Kandidatenzahl."""
    cumulative = np.cumsum(counts)
    bounds: list[tuple[int, int]] = []
    start = 0
    while start < len(counts):
        base = cumulative[start - 1] if start > 0 else 0
        end = int(np.searchsorted(cumulative, base + _CANDIDATES_PER_CHUNK, side="right"))
        end = min(max(end, start + 1), len(counts))
        bounds.append((start, end))
        start = end
    return bounds


def rasterize_uv(mesh: UnwrappedMesh, resolution: int) -> TexelMap:
    """Rasterisiert die UV-Dreiecke auf ein Texelraster (Texelmitte als Abtastpunkt).

    Texel auf gemeinsamen Kanten gehören dem Dreieck mit dem höchsten Index.
    """
    triangles = mesh.uvs[mesh.faces] * resolution
    lower = np.clip(np.floor(triangles.min(axis=1)), 0, resolution - 1).astype(np.int64)
    upper = np.clip(np.ceil(triangles.max(axis=1)), 0, resolution - 1).astype(np.int64)
    size = upper - lower + 1
    counts = size[:, 0] * size[:, 1]

    owner = np.full((resolution, resolution), -1, dtype=np.int64)
    for start, end in _chunk_bounds(counts):
        chunk_counts = counts[start:end]
        triangle = np.repeat(np.arange(start, end), chunk_counts)
        local = np.arange(len(triangle)) - np.repeat(np.cumsum(chunk_counts) - chunk_counts, chunk_counts)
        width = size[triangle, 0]
        cols = lower[triangle, 0] + local % width
        rows = lower[triangle, 1] + local // width
        centers = np.stack([cols + 0.5, rows + 0.5], axis=1)
        weights = _barycentric(triangles[triangle], centers)
        inside = np.all(weights >= -1e-9, axis=1)
        owner[rows[inside], cols[inside]] = triangle[inside]

    rows, cols = np.nonzero(owner >= 0)
    faces = owner[rows, cols]
    barycentric = _barycentric(triangles[faces], np.stack([cols + 0.5, rows + 0.5], axis=1))
    corners = mesh.faces[faces]
    positions = np.einsum("nk,nkc->nc", barycentric, mesh.vertices[corners])
    normals = np.einsum("nk,nkc->nc", barycentric, mesh.normals[corners])
    normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)
    return TexelMap(resolution, mesh, rows, cols, faces, barycentric, positions, normals)


def scatter_with_dilation(
    texels: TexelMap, values: FloatArray, dilation: int = _DEFAULT_DILATION
) -> FloatArray:
    """Schreibt Texelwerte (N, C) in ein Bild (R, R, C) und setzt die Inselränder fort (Dilatation).

    Leere Texel bis ``dilation`` Pixel Abstand erhalten den Wert des nächsten abgedeckten Texels,
    weiter entfernte den Mittelwert aller Werte; so zeigen Mipmaps keine Nähte.
    """
    resolution = texels.resolution
    image = np.zeros((resolution, resolution, values.shape[1]))
    image[texels.rows, texels.cols] = values
    covered = texels.coverage()
    distance, (nearest_row, nearest_col) = ndimage.distance_transform_edt(~covered, return_indices=True)
    filled = image[nearest_row, nearest_col]
    return np.where((distance <= dilation)[..., None], filled, values.mean(axis=0))


def bake_occlusion(
    texels: TexelMap,
    occluder: TriangleMesh,
    ray_count: int,
    max_distance: float,
    downscale: int = 4,
) -> FloatArray:
    """Backt AO (1 = frei, 0 = verdeckt) je Texel.

    Die Strahlen werden auf einem um ``downscale`` gröberen Raster geschossen und bilinear auf die
    volle Auflösung interpoliert; AO ist niederfrequent, die Strahlzahl sinkt um ``downscale``².
    """
    coarse = rasterize_uv(texels.mesh, max(1, texels.resolution // downscale))
    occlusion = bake_ambient_occlusion(
        coarse.positions, coarse.normals, occluder, ray_count=ray_count, max_distance=max_distance
    )
    image = scatter_with_dilation(coarse, occlusion[:, None], dilation=max(2, _DEFAULT_DILATION // 2))[..., 0]
    scale = coarse.resolution / texels.resolution
    coordinates = np.stack([(texels.rows + 0.5) * scale - 0.5, (texels.cols + 0.5) * scale - 0.5])
    return np.clip(ndimage.map_coordinates(image, coordinates, order=1, mode="nearest"), 0.0, 1.0)


def _to_bytes(values: FloatArray) -> ByteImage:
    return np.round(np.clip(values, 0.0, 1.0) * 255.0).astype(np.uint8)


def bake_base_color(
    texels: TexelMap, linear_color: FloatArray, alpha: FloatArray | None = None
) -> ByteImage:
    """Backt die Basisfarbtextur: lineare Farbe (N, 3) wird als sRGB kodiert, Alpha (N,) bleibt linear."""
    channels = linear_to_srgb(linear_color)
    if alpha is not None:
        channels = np.concatenate([channels, alpha[:, None]], axis=1)
    return _to_bytes(scatter_with_dilation(texels, channels))


def bake_orm(
    texels: TexelMap, occlusion: FloatArray, roughness: FloatArray, metallic: FloatArray
) -> ByteImage:
    """Backt die ORM-Textur (R = Occlusion, G = Roughness, B = Metallic, linear)."""
    channels = np.stack([occlusion, roughness, metallic], axis=1)
    return _to_bytes(scatter_with_dilation(texels, channels))
