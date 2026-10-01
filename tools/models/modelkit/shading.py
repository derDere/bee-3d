"""Oberflächenlook: Farbfunktionen, Oberflächenzonen über Distanzfelder, Streifen und Umgebungsverdeckung (AO)."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
import trimesh

from modelkit.geometry import TriangleMesh
from modelkit.sdf import Sdf

type FloatArray = npt.NDArray[np.float64]
type ColorFunction = Callable[[FloatArray], FloatArray]


def srgb_to_linear(rgb: Sequence[float] | FloatArray) -> FloatArray:
    """Wandelt sRGB-Farbwerte (0..1) in linearen Farbraum um."""
    c = np.asarray(rgb, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(rgb: FloatArray) -> FloatArray:
    """Wandelt lineare Farbwerte (0..1) in sRGB um (Kodierung für Farbtexturen)."""
    c = np.clip(rgb, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1.0 / 2.4) - 0.055)


def smoothstep(edge0: float, edge1: float, x: FloatArray) -> FloatArray:
    """Hermite-Übergang zwischen zwei Schwellen."""
    t = np.clip((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def solid_color(srgb: Sequence[float]) -> ColorFunction:
    """Einfarbige Farbfunktion."""
    linear = srgb_to_linear(srgb)
    return lambda points: np.broadcast_to(linear, (len(points), 3))


def banded_color(
    coordinate: Callable[[FloatArray], FloatArray],
    base_srgb: Sequence[float],
    band_srgb: Sequence[float],
    intervals: Sequence[tuple[float, float]],
    feather: float,
) -> ColorFunction:
    """Streifenmuster entlang einer Koordinate; ``intervals`` sind die Bandbereiche, ``feather`` die Kantenweichheit."""
    base = srgb_to_linear(base_srgb)
    band = srgb_to_linear(band_srgb)

    def color(points: FloatArray) -> FloatArray:
        u = coordinate(points)
        mask = np.zeros(len(points))
        for start, end in intervals:
            mask = np.maximum(
                mask,
                smoothstep(start - feather, start + feather, u)
                * (1.0 - smoothstep(end - feather, end + feather, u)),
            )
        return base[None, :] * (1.0 - mask[:, None]) + band[None, :] * mask[:, None]

    return color


@dataclass(frozen=True, slots=True)
class SurfaceZone:
    """Oberflächenzone eines Modells: das Feld bestimmt die Zugehörigkeit, der Rest den Look (Oberflächenzone).

    ``color`` liefert lineare RGB-Werte; ``roughness`` und ``metallic`` sind Konstanten der Zone.
    """

    region: Sdf
    color: ColorFunction
    roughness: float
    metallic: float = 0.0


@dataclass(frozen=True, slots=True)
class SurfaceSample:
    """Ausgewertete Materialeigenschaften an Punkten: lineare Farbe, Rauheit, Metallizität."""

    color: FloatArray
    roughness: FloatArray
    metallic: FloatArray


def evaluate_zones(points: FloatArray, zones: Sequence[SurfaceZone], softness: float) -> SurfaceSample:
    """Mischt die Zonen per Softmin der Distanzen; ``softness`` (m) steuert die Übergangsbreite."""
    distances = np.stack([zone.region.distance(points) for zone in zones], axis=1)
    weights = np.exp(-(distances - distances.min(axis=1, keepdims=True)) / softness)
    weights /= weights.sum(axis=1, keepdims=True)
    colors = np.stack([zone.color(points) for zone in zones], axis=1)
    return SurfaceSample(
        color=np.einsum("nr,nrc->nc", weights, colors),
        roughness=weights @ np.array([zone.roughness for zone in zones]),
        metallic=weights @ np.array([zone.metallic for zone in zones]),
    )


def _tangent_frames(normals: FloatArray) -> tuple[FloatArray, FloatArray]:
    helper = np.where(np.abs(normals[:, :1]) < 0.9, [[1.0, 0.0, 0.0]], [[0.0, 1.0, 0.0]])
    tangent = np.cross(helper, normals)
    tangent /= np.linalg.norm(tangent, axis=1, keepdims=True)
    return tangent, np.cross(normals, tangent)


def bake_ambient_occlusion(
    points: FloatArray,
    normals: FloatArray,
    occluder: TriangleMesh,
    ray_count: int = 64,
    max_distance: float = 0.05,
    bias: float = 2e-4,
    seed: int = 7,
) -> FloatArray:
    """Backt lokale Umgebungsverdeckung per kosinusgewichteter Strahlen (Embree über trimesh).

    Liefert je Punkt 1.0 (frei) bis 0.0 (verdeckt). Treffer werden mit der Entfernung
    weich ausgeblendet, sodass nur Verdeckung innerhalb von ``max_distance`` zählt.
    """
    rng = np.random.default_rng(seed)
    strata = (np.arange(ray_count) + 0.5) / ray_count
    golden_angle = np.pi * (3.0 - np.sqrt(5.0))
    radius = np.sqrt(strata)
    phi = golden_angle * np.arange(ray_count)[None, :] + rng.uniform(0.0, 2.0 * np.pi, (len(points), 1))
    local = np.stack(
        [
            radius[None, :] * np.cos(phi),
            radius[None, :] * np.sin(phi),
            np.broadcast_to(np.sqrt(1.0 - strata), phi.shape),
        ],
        axis=-1,
    )
    tangent, bitangent = _tangent_frames(normals)
    directions = (
        local[..., 0:1] * tangent[:, None, :]
        + local[..., 1:2] * bitangent[:, None, :]
        + local[..., 2:3] * normals[:, None, :]
    ).reshape(-1, 3)
    origins = np.repeat(points + normals * bias, ray_count, axis=0)

    scene = trimesh.Trimesh(occluder.vertices, occluder.faces, process=False)
    locations, ray_index, _ = scene.ray.intersects_location(origins, directions, multiple_hits=False)
    hit_distance = np.linalg.norm(locations - origins[ray_index], axis=1)
    occlusion = np.zeros(len(origins))
    occlusion[ray_index] = np.clip(1.0 - hit_distance / max_distance, 0.0, 1.0)
    return 1.0 - occlusion.reshape(len(points), ray_count).mean(axis=1)
