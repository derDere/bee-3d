"""Flügel der Biene: Vorderflügel nach dem Vorbild, Hinterflügel dahinter, Membrantextur, Haltung (Flügel).

Beide Lappen einer Seite liegen in einem Netz am Flügelgelenk und schlagen gemeinsam (wie bei
Bienen, deren Flügel über Häkchen gekoppelt sind). Die Textur teilt sich entlang v: Hinterflügel
v 0–0,5, Vorderflügel v 0,5–1; u folgt der Spannweite.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from itertools import pairwise

import numpy as np
import numpy.typing as npt
from modelkit.geometry import area_weighted_normals
from modelkit.gltf_writer import RotationTrack
from modelkit.shading import linear_to_srgb, smoothstep
from modelkit.transforms import quaternion_from_matrix, rotation_matrix

from beekit.anatomy import PX, BeeAnatomy, Wing, WingLobe
from beekit.look import Swatch

type FloatArray = npt.NDArray[np.float64]
type IndexArray = npt.NDArray[np.int64]
type ByteImage = npt.NDArray[np.uint8]


@dataclass(frozen=True, slots=True)
class WingMesh:
    """Flügelmembran im Rahmen des Flügelgelenks: Spannweite entlang ±X, Vorderkante +Z (Flügelnetz)."""

    vertices: FloatArray
    normals: FloatArray
    faces: IndexArray
    uvs: FloatArray


def _lobe(lobe: WingLobe, v_range: tuple[float, float], span_steps: int, chord_steps: int) -> tuple[FloatArray, IndexArray, FloatArray]:
    """Leicht gewölbter Lappen; u entlang der Spannweite, v quer im Bereich ``v_range`` (Vorderkante oben)."""
    # Wurzel und Spitze bleiben eine Spur breit, damit keine Kante auf einen Punkt zusammenfällt
    u = 0.004 + 0.992 * np.sin(0.5 * np.pi * np.arange(span_steps + 1) / span_steps)
    across = np.linspace(-1.0, 1.0, chord_steps + 1)
    half = lobe.half_width(u)
    x = np.broadcast_to((u * lobe.length)[:, None], (len(u), len(across)))
    z = half[:, None] * across[None, :]
    y = 0.025 * lobe.length * np.sin(np.pi * u)[:, None] * (1.0 - across[None, :] ** 2)
    local = np.stack([x, y, z], axis=-1).reshape(-1, 3)
    vertices = local @ rotation_matrix((0, 1, 0), lobe.sweep_degrees).T + np.asarray(lobe.offset)
    grid = np.arange(len(u) * len(across)).reshape(len(u), len(across))
    a, b = grid[:-1, :-1].ravel(), grid[1:, :-1].ravel()
    c, d = grid[:-1, 1:].ravel(), grid[1:, 1:].ravel()
    faces = np.concatenate([np.stack([a, c, b], axis=1), np.stack([b, c, d], axis=1)]).astype(np.int64)
    v = v_range[0] + (v_range[1] - v_range[0]) * (0.5 * (across + 1.0))
    uvs = np.stack(np.broadcast_arrays(u[:, None], v[None, :]), axis=-1).reshape(-1, 2)
    return vertices, faces, uvs


def wing_mesh(wing: Wing) -> WingMesh:
    """Vorder- und Hinterflügel einer Seite als ein Netz; die rechte Seite ist gespiegelt."""
    fore_vertices, fore_faces, fore_uvs = _lobe(wing.forewing, (0.5, 1.0), 24, 10)
    hind_vertices, hind_faces, hind_uvs = _lobe(wing.hindwing, (0.0, 0.5), 16, 8)
    vertices = np.concatenate([fore_vertices, hind_vertices])
    faces = np.concatenate([fore_faces, hind_faces + len(fore_vertices)])
    uvs = np.concatenate([fore_uvs, hind_uvs])
    normals = area_weighted_normals(vertices, faces)
    if normals[:, 1].mean() < 0.0:
        faces, normals = faces[:, ::-1].copy(), -normals
    if wing.side < 0.0:
        flip = np.array([-1.0, 1.0, 1.0])
        return WingMesh(vertices * flip, normals * flip, faces[:, ::-1].copy(), uvs)
    return WingMesh(vertices, normals, faces, uvs)


def rest_rotation(wing: Wing, raise_degrees: float | None = None) -> FloatArray:
    """Drehmatrix der Flügelhaltung: erst nach hinten pfeilen (um Y), dann anheben (um die Körperachse Z)."""
    raised = wing.raise_degrees if raise_degrees is None else raise_degrees
    return rotation_matrix((0, 0, 1), wing.side * raised) @ rotation_matrix((0, 1, 0), wing.side * wing.sweep_degrees)


def flap_tracks(anatomy: BeeAnatomy, period: float = 0.1, keys: int = 9, amplitude: float = 32.0) -> list[RotationTrack]:
    """Flügelschlag um die Körperachse aus der Ruhehaltung; erster = letzter Key für die Schleife."""
    times = np.linspace(0.0, period, keys)
    tracks = []
    for wing in anatomy.wings:
        angles = wing.raise_degrees + amplitude * np.sin(2.0 * np.pi * times / period)
        quaternions = np.stack([quaternion_from_matrix(rest_rotation(wing, angle)) for angle in angles])
        tracks.append(RotationTrack(wing.name, times, quaternions))
    return tracks


# Flügeladern in (Spannweitenanteil, Anteil der halben Breite; + = Vorderkante) nach dem Aderverlauf
# eines Bienenvorderflügels: Längsadern, Randzelle, Cubital- und Discoidalzellen; außen aderfrei.
_FORE_LONG = (
    ((0.02, 0.62), (0.22, 0.80), (0.42, 0.84), (0.60, 0.82)),
    ((0.02, 0.40), (0.25, 0.55), (0.45, 0.62), (0.58, 0.66)),
    ((0.02, 0.10), (0.20, 0.10), (0.38, 0.06), (0.52, 0.04), (0.66, 0.10)),
    ((0.02, -0.18), (0.18, -0.22), (0.34, -0.30), (0.48, -0.38)),
    ((0.03, -0.45), (0.14, -0.58), (0.26, -0.70)),
    ((0.58, 0.76), (0.70, 0.74), (0.80, 0.66), (0.86, 0.52), (0.80, 0.46), (0.70, 0.50), (0.60, 0.58)),
)
_FORE_CROSS = (
    ((0.45, 0.62), (0.47, 0.06)),
    ((0.58, 0.66), (0.60, 0.05)),
    ((0.70, 0.50), (0.68, 0.10)),
    ((0.38, 0.06), (0.36, -0.29)),
    ((0.52, 0.04), (0.50, -0.37)),
)
_FORE_STIGMA = ((0.54, 0.79), (0.61, 0.79))
_HIND_LONG = (
    ((0.03, 0.55), (0.30, 0.70), (0.55, 0.62)),
    ((0.03, 0.10), (0.25, 0.05), (0.45, 0.02)),
    ((0.03, -0.35), (0.22, -0.45), (0.38, -0.55)),
)
_HIND_CROSS = (((0.45, 0.66), (0.45, 0.02)),)


def _segment_distance(points: FloatArray, start: FloatArray, end: FloatArray) -> FloatArray:
    along = end - start
    t = np.clip(((points - start) @ along) / float(along @ along), 0.0, 1.0)
    return np.linalg.norm(points - start - t[:, None] * along, axis=1)


def _paint_lobe(
    lobe: WingLobe,
    span: FloatArray,
    chord: FloatArray,
    veins: tuple[Sequence[Sequence[tuple[float, float]]], Sequence[Sequence[tuple[float, float]]]],
    stigma: Sequence[tuple[float, float]] | None,
) -> tuple[FloatArray, FloatArray]:
    """Farbe (linear) und Alpha eines Lappens: Membran, Adern, Mal, Rand, Schimmer zur Spitze."""
    half = lobe.half_width(span)
    pixels = np.stack([span * lobe.length, (2.0 * chord - 1.0) * half], axis=1) / PX

    def to_pixels(points: Sequence[tuple[float, float]]) -> FloatArray:
        s = np.array([p[0] for p in points])
        c = np.array([p[1] for p in points])
        return np.stack([s * lobe.length, c * lobe.half_width(s)], axis=1) / PX

    def distance_to(lines: Sequence[Sequence[tuple[float, float]]]) -> FloatArray:
        distance = np.full(len(pixels), np.inf)
        for line in lines:
            for start, end in pairwise(to_pixels(line)):
                distance = np.minimum(distance, _segment_distance(pixels, start, end))
        return distance

    long_distance, cross_distance = distance_to(veins[0]), distance_to(veins[1])
    vein = np.maximum(1.0 - smoothstep(0.30, 0.42, long_distance), 0.8 * (1.0 - smoothstep(0.20, 0.32, cross_distance)))
    if stigma is not None:
        nodes = to_pixels(stigma)
        vein = np.maximum(vein, 1.0 - smoothstep(0.55, 0.8, _segment_distance(pixels, nodes[0], nodes[1])))
    smoke = 1.0 - smoothstep(0.4, 1.6, np.minimum(long_distance, cross_distance))
    edge = (half * (1.0 - np.abs(2.0 * chord - 1.0))) / PX
    rim = 1.0 - smoothstep(0.25, 0.7, edge)
    t = span**0.8
    membrane = np.asarray(Swatch.WING.linear)[None, :] * (1.0 - 0.06 * smoke[:, None])
    membrane = membrane * (1.0 - 0.25 * t[:, None]) + np.asarray(Swatch.WING_TIP.linear)[None, :] * (0.25 * t[:, None])
    alpha = 0.62 - 0.08 * t + 0.06 * smoke
    color = membrane * (1.0 - vein[:, None]) + np.asarray(Swatch.WING_VEIN.linear)[None, :] * vein[:, None]
    alpha = alpha * (1.0 - vein) + 0.9 * vein
    color = color * (1.0 - rim[:, None]) + np.asarray(Swatch.WING_RIM.linear)[None, :] * rim[:, None]
    return color, np.maximum(alpha, 0.84 * rim)


def wing_texture(wing: Wing, resolution: int = 512) -> ByteImage:
    """RGBA-Membran beider Lappen: lavendelfarben durchscheinend wie im Vorbild, Adern im Wurzelbereich.

    Spalten folgen u (Spannweite), Zeilen v; innerhalb eines Lappens wächst v zur Vorderkante.
    """
    centers = (np.arange(resolution) + 0.5) / resolution
    span, v = (grid.ravel() for grid in np.meshgrid(centers, centers))
    color = np.zeros((len(span), 3))
    alpha = np.zeros(len(span))
    for lobe, (low, high), veins, stigma in (
        (wing.forewing, (0.5, 1.0), (_FORE_LONG, _FORE_CROSS), _FORE_STIGMA),
        (wing.hindwing, (0.0, 0.5), (_HIND_LONG, _HIND_CROSS), None),
    ):
        mask = (v >= low) & (v < high)
        chord = (v[mask] - low) / (high - low)
        color[mask], alpha[mask] = _paint_lobe(lobe, span[mask], chord, veins, stigma)
    rgba = np.concatenate([linear_to_srgb(color), alpha[:, None]], axis=1).reshape(resolution, resolution, 4)
    return np.round(np.clip(rgba, 0.0, 1.0) * 255.0).astype(np.uint8)
