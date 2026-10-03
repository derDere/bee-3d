"""Flügel der Fliege: Umriss, Membran, Aderung, Haltung und Flügelschlag (Flügel).

Fliegen haben ein Flügelpaar. Der Umriss folgt dem Schmeißfliegenflügel: schmale Wurzel mit
Flügelläppchen (Alula), gerader Vorderrand, gewölbter Hinterrand, runde Spitze. Die Membran
liegt im Rahmen des Flügelgelenks — Spannweite entlang +X (linker Flügel), Vorderrand +Z,
Oberseite +Y; der rechte Flügel ist gespiegelt und teilt Textur und UVs. Die Textur folgt
(u = Spannweite, v = Flügeltiefe von hinten nach vorn); die Adern sind in diesen Koordinaten
notiert und werden mit physikalischer Breite gemalt.
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
from modelkit.sweep import catmull_rom
from modelkit.transforms import quaternion_from_matrix, rotation_matrix
from modelkit.uv import UnwrappedMesh

from flykit.anatomy import WingShape
from flykit.species import Palette, linear

type FloatArray = npt.NDArray[np.float64]
type ByteImage = npt.NDArray[np.uint8]
type Polyline = Sequence[tuple[float, float]]

# Umriss in (Spannweitenanteil, Anteil der Flügeltiefe; + = Vorderrand)
_FRONT = ((0.0, 0.035), (0.08, 0.1), (0.25, 0.22), (0.5, 0.31), (0.75, 0.3), (0.9, 0.2), (0.97, 0.09), (1.0, 0.0))
_BACK = ((0.0, -0.035), (0.05, -0.2), (0.11, -0.34), (0.17, -0.38), (0.3, -0.52), (0.55, -0.62), (0.78, -0.53), (0.92, -0.32), (0.98, -0.13), (1.0, 0.0))

# Adern in (Spannweitenanteil, Lage w: −1 = Hinterrand, +1 = Vorderrand) nach dem Schmeißfliegenflügel
_VEINS: tuple[Polyline, ...] = (
    ((0.02, 0.72), (0.18, 0.86), (0.33, 0.97)),  # Subcosta
    ((0.02, 0.56), (0.25, 0.7), (0.5, 0.93)),  # Radius 1
    ((0.14, 0.46), (0.36, 0.53), (0.6, 0.66), (0.8, 0.83), (0.9, 0.94)),  # Radius 2+3
    ((0.14, 0.46), (0.4, 0.33), (0.7, 0.3), (0.88, 0.38), (0.99, 0.5)),  # Radius 4+5
    ((0.05, 0.16), (0.3, 0.05), (0.55, -0.02), (0.68, -0.04), (0.76, 0.07), (0.86, 0.26), (0.95, 0.43)),  # Media mit Knick
    ((0.05, -0.1), (0.3, -0.26), (0.5, -0.43), (0.61, -0.62), (0.66, -0.92)),  # Cubitus
    ((0.03, -0.36), (0.17, -0.63), (0.24, -0.88)),  # Analader
    ((0.0, 0.0), (0.14, 0.46)),  # Stamm des Radius
)
_CROSS_VEINS: tuple[Polyline, ...] = (
    ((0.4, 0.33), (0.42, 0.04)),  # vordere Querader
    ((0.6, -0.03), (0.56, -0.5)),  # hintere Querader
    ((0.08, 0.62), (0.09, 0.86)),  # Schulterquerader
    ((0.17, 0.12), (0.19, -0.18)),  # Basalquerader
)


@dataclass(frozen=True, slots=True)
class WingOutline:
    """Vorder- und Hinterrand als dichte Kurven über der Spannweite (Flügelumriss)."""

    span: FloatArray
    front: FloatArray
    back: FloatArray

    @classmethod
    def default(cls) -> WingOutline:
        """Umriss des Schmeißfliegenflügels."""
        front = catmull_rom(np.array([(s, c, 0.0) for s, c in _FRONT]), 12)
        back = catmull_rom(np.array([(s, c, 0.0) for s, c in _BACK]), 12)
        span = np.linspace(0.0, 1.0, 400)
        return cls(span, np.interp(span, front[:, 0], front[:, 1]), np.interp(span, back[:, 0], back[:, 1]))

    def edges(self, s: FloatArray) -> tuple[FloatArray, FloatArray]:
        """Vorder- und Hinterrand (Anteile der Flügeltiefe) an den Spannweitenanteilen ``s``."""
        return np.interp(s, self.span, self.front), np.interp(s, self.span, self.back)

    def physical(self, wing: WingShape, s: FloatArray, w: FloatArray) -> FloatArray:
        """Punkte (x entlang der Spannweite, z quer) in Metern aus (Spannweitenanteil, Lage w)."""
        front, back = self.edges(s)
        chord = back + 0.5 * (np.asarray(w) + 1.0) * (front - back)
        return np.stack([np.asarray(s) * wing.length, chord * wing.chord], axis=-1)


def wing_mesh(wing: WingShape, outline: WingOutline, span_steps: int, chord_steps: int) -> UnwrappedMesh:
    """Leicht gewölbte Membran im Gelenkrahmen; der rechte Flügel ist gespiegelt."""
    s = 0.004 + 0.992 * (1.0 - np.cos(0.5 * np.pi * np.arange(span_steps + 1) / span_steps)) ** 0.85
    w = np.linspace(-1.0, 1.0, chord_steps + 1)
    grid_s, grid_w = np.meshgrid(s, w, indexing="ij")
    planar = outline.physical(wing, grid_s, grid_w)
    camber = 0.025 * wing.length * np.sin(np.pi * grid_s) * (1.0 - grid_w**2)
    vertices = np.stack([planar[..., 0], camber, planar[..., 1]], axis=-1).reshape(-1, 3)
    index = np.arange(vertices.shape[0]).reshape(len(s), len(w))
    a, b = index[:-1, :-1].ravel(), index[1:, :-1].ravel()
    c, d = index[:-1, 1:].ravel(), index[1:, 1:].ravel()
    faces = np.concatenate([np.stack([a, c, b], axis=1), np.stack([b, c, d], axis=1)]).astype(np.int64)
    uvs = np.stack([grid_s.ravel(), 0.5 * (grid_w.ravel() + 1.0)], axis=1)
    normals = area_weighted_normals(vertices, faces)
    if normals[:, 1].mean() < 0.0:
        faces, normals = faces[:, ::-1].copy(), -normals
    mesh = UnwrappedMesh(vertices, normals, faces, uvs, np.arange(len(vertices)))
    return mesh if wing.side > 0.0 else mesh.mirrored_x()


def rest_rotation(wing: WingShape, raise_degrees: float, sweep_degrees: float, pitch_degrees: float) -> FloatArray:
    """Drehmatrix der Flügelhaltung: anstellen (um die Spannweite), pfeilen (um Y), anheben (um die Körperachse).

    Spiegelsymmetrie: Drehungen um Y und Z wechseln mit der Seite das Vorzeichen, die Drehung um
    die Spannweite (X) nicht.
    """
    side = wing.side
    pitch = rotation_matrix((1.0, 0.0, 0.0), pitch_degrees)
    return rotation_matrix((0, 0, 1), side * raise_degrees) @ rotation_matrix((0, 1, 0), side * sweep_degrees) @ pitch


def flap_tracks(wings: Sequence[WingShape], period: float = 0.04, keys: int = 9) -> list[RotationTrack]:
    """Schnelles Brummen: Auf- und Abschlag um die Körperachse, Vorschwung im Abschlag, Anstellwinkel kippt.

    Erster und letzter Key sind gleich (nahtlose Schleife).
    """
    times = np.linspace(0.0, period, keys)
    phase = 2.0 * np.pi * times / period
    tracks = []
    for wing in wings:
        raised = wing.raise_degrees + 52.0 * np.sin(phase)
        swept = wing.sweep_degrees - 14.0 * np.cos(phase)
        pitched = 22.0 * np.cos(phase)
        quaternions = np.stack(
            [quaternion_from_matrix(rest_rotation(wing, r, s, p)) for r, s, p in zip(raised, swept, pitched, strict=True)]
        )
        tracks.append(RotationTrack(wing.name, times, quaternions))
    return tracks


def _segment_distance(points: FloatArray, start: FloatArray, end: FloatArray) -> FloatArray:
    along = end - start
    t = np.clip(((points - start) @ along) / max(float(along @ along), 1e-18), 0.0, 1.0)
    return np.linalg.norm(points - start - t[:, None] * along, axis=1)


def _polyline_distance(points: FloatArray, lines: Sequence[FloatArray]) -> FloatArray:
    distance = np.full(len(points), np.inf)
    for line in lines:
        for start, end in pairwise(line):
            distance = np.minimum(distance, _segment_distance(points, start, end))
    return distance


def wing_texture(wing: WingShape, outline: WingOutline, palette: Palette, resolution: int, unit: float) -> ByteImage:
    """RGBA-Membran: klar mit rauchiger Wurzel, dunkle Adern, kräftiger Vorderrand, feiner Saum.

    Spalten folgen u (Spannweite), Zeilen v (Flügeltiefe, Vorderrand bei v = 1).
    """
    centers = (np.arange(resolution) + 0.5) / resolution
    s, v = (grid.ravel() for grid in np.meshgrid(centers, centers))
    w = 2.0 * v - 1.0
    points = outline.physical(wing, s, w)

    def to_physical(line: Polyline) -> FloatArray:
        nodes = np.array(line)
        dense = catmull_rom(np.stack([nodes[:, 0], nodes[:, 1], np.zeros(len(nodes))], axis=1), 6)
        return outline.physical(wing, dense[:, 0], dense[:, 1])

    vein_width = 0.035 * unit
    long_distance = _polyline_distance(points, [to_physical(line) for line in _VEINS])
    cross_distance = _polyline_distance(points, [to_physical(line) for line in _CROSS_VEINS])
    taper = 1.0 - 0.45 * s  # Adern werden zur Spitze feiner
    vein = np.maximum(
        1.0 - smoothstep(0.8 * vein_width * taper, 1.25 * vein_width * taper, long_distance),
        0.9 * (1.0 - smoothstep(0.6 * vein_width, vein_width, cross_distance)),
    )
    front, back = outline.edges(s)
    chord_width = (front - back) * wing.chord
    to_front = (1.0 - v) * chord_width
    to_back = v * chord_width
    costa = 1.0 - smoothstep(1.2 * vein_width, 2.2 * vein_width * (1.0 - 0.4 * s), to_front)
    costa *= 1.0 - smoothstep(0.9, 0.99, s)
    fringe = 1.0 - smoothstep(0.3 * vein_width, 1.1 * vein_width, np.minimum(to_back, to_front))
    smoke = 1.0 - smoothstep(0.0, 0.22, s)
    halo = 1.0 - smoothstep(0.5 * vein_width, 4.0 * vein_width, np.minimum(long_distance, cross_distance))

    membrane, base, vein_color = linear(palette.wing_membrane), linear(palette.wing_base), linear(palette.wing_vein)
    color = membrane[None, :] * (1.0 - smoke[:, None]) + base[None, :] * smoke[:, None]
    color = color * (1.0 - 0.25 * halo[:, None])
    alpha = 0.2 + 0.4 * smoke + 0.12 * halo
    dark = np.maximum(np.maximum(vein, costa), 0.7 * fringe)
    color = color * (1.0 - dark[:, None]) + vein_color[None, :] * dark[:, None]
    alpha = alpha * (1.0 - dark) + 0.94 * dark
    rgba = np.concatenate([linear_to_srgb(np.clip(color, 0.0, 1.0)), np.clip(alpha, 0.0, 1.0)[:, None]], axis=1)
    return np.round(rgba.reshape(resolution, resolution, 4) * 255.0).astype(np.uint8)
