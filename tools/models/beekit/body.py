"""Körper der Biene als eine geschlossene Hülle (Körperhülle).

Das Distanzfeld vereinigt Kopf, Bäckchen, Hals, Brust, Taille und Hinterleib mit eigenen
Übergangsbreiten; der Kopf hat Augenhöhlen für die beweglichen Augäpfel, der Hinterleib Tergite,
deren Vorderkante unter die vorherige Platte taucht und deren Hinterkante als Wulst übersteht.
Der Stachel kommt per Boolean dazu. Die Hülle hat keine inneren Flächen — durchscheinende
Zustände (Geist) zeigen nur die Außenhaut.
"""

from __future__ import annotations

from dataclasses import dataclass

import manifold3d as m3d
import numpy as np
import numpy.typing as npt
from modelkit.geometry import ShadedMesh, TriangleMesh, shade_with_creases, to_manifold, union_all
from modelkit.meshing import decimate_quadric, remesh_to_budget
from modelkit.sdf import Aabb, Sdf, smooth_min
from modelkit.shading import smoothstep

from beekit.anatomy import PX, BeeAnatomy

type FloatArray = npt.NDArray[np.float64]
type IntArray = npt.NDArray[np.int64]

TUCK = 0.045  # Vorderkante eines Tergits taucht um diesen Anteil des Radius unter die vorherige Platte
LIP = 0.02  # Hinterkante steht um diesen Anteil als Wulst über
EDGE_SOFTNESS = 0.04  # Anteil der Bandbreite, über den die Stufe an der Plattenkante verläuft
SOCKET_GAP = 0.12 * PX  # Luft zwischen Augapfel und Augenhöhle (kein Z-Fighting, keine Durchdringung)
SOCKET_ROUNDING = 0.7 * PX  # Rundung des Höhlenrands


@dataclass(frozen=True, slots=True)
class BandSample:
    """Lage auf dem Hinterleib: Bandindex (−1 vor dem Hinterleib) und Anteil im Band (Bandlage)."""

    index: IntArray
    fraction: FloatArray


class BodyField(Sdf):
    """Distanzfeld des Rumpfs ohne Glieder (Körperfeld)."""

    def __init__(self, anatomy: BeeAnatomy) -> None:
        self._anatomy = anatomy
        self._edges = anatomy.band_edges()

    @property
    def anatomy(self) -> BeeAnatomy:
        """Die zugrunde liegende Anatomie."""
        return self._anatomy

    def bands(self, z: FloatArray) -> BandSample:
        """Band und Lage im Band für Höhen z entlang der Körperachse (Bänder liegen absteigend in z)."""
        edges = self._edges
        index = np.searchsorted(-edges, -np.asarray(z), side="right") - 1
        inside = (index >= 0) & (index < len(edges) - 1)
        safe = np.clip(index, 0, len(edges) - 2)
        fraction = (edges[safe] - z) / (edges[safe] - edges[safe + 1])
        return BandSample(np.where(inside, safe, -1), np.where(inside, fraction, 0.0))

    def head_distance(self, points: FloatArray) -> FloatArray:
        """Kopf mit Bäckchen (ohne Augenhöhlen)."""
        anatomy = self._anatomy
        head = anatomy.head.distance(points)
        for cheek in anatomy.cheeks:
            head = smooth_min(head, cheek.distance(points), 3.0 * PX)
        return head

    def socket_distance(self, points: FloatArray) -> FloatArray:
        """Abstand zu den Augenhöhlen (Kugeln etwas größer als die Augäpfel); negativ in der Höhle."""
        return np.min(
            [np.linalg.norm(points - eye.center, axis=1) - eye.radius - SOCKET_GAP for eye in self._anatomy.eyes], axis=0
        )

    def abdomen_distance(self, points: FloatArray) -> FloatArray:
        """Ringkugeln des Hinterleibs mit Dachziegelprofil der Tergite."""
        segments = self._anatomy.segments
        distance = np.min([segment.distance(points) for segment in segments], axis=0)
        band = self.bands(points[:, 2])
        t = band.fraction
        last = len(segments) - 1
        profile = -TUCK * (1.0 - t) ** 2.2 + np.where(band.index < last, LIP * t**3, 0.0)
        # Am Plattenende steil auf die eingezogene Vorderkante des nächsten Tergits
        step = np.where(band.index < last, smoothstep(1.0 - EDGE_SOFTNESS, 1.0, t), 0.0)
        profile = profile * (1.0 - step) - TUCK * step
        radius = np.array([segment.radii[1] for segment in segments])[np.clip(band.index, 0, last)]
        return distance - np.where(band.index >= 0, profile * radius, 0.0)

    def distance(self, points: FloatArray) -> FloatArray:
        anatomy = self._anatomy
        body = smooth_min(self.head_distance(points), anatomy.neck.distance(points), 3.5 * PX)
        body = smooth_min(body, anatomy.thorax.distance(points), 4.0 * PX)
        body = smooth_min(body, anatomy.waist.distance(points), 4.0 * PX)
        body = smooth_min(body, self.abdomen_distance(points), 3.0 * PX)
        # Augenhöhlen weich ausgespart: −smooth_min(−Körper, Höhle)
        return -smooth_min(-body, self.socket_distance(points), SOCKET_ROUNDING)

    def bounds(self) -> Aabb:
        anatomy = self._anatomy
        parts = [anatomy.head, *anatomy.cheeks, anatomy.neck, anatomy.thorax, anatomy.waist, *anatomy.segments]
        box = parts[0].bounds()
        for part in parts[1:]:
            box = box.union(part.bounds())
        return box.padded(2.0 * PX)


@dataclass(frozen=True, slots=True)
class BodyShell:
    """Körperhülle als schattiertes Netz und als Volumen zum Beschneiden der Glieder (Körperhülle)."""

    mesh: ShadedMesh
    solid: m3d.Manifold


def build_shell(field: BodyField, stinger: m3d.Manifold, face_budget: int = 6500) -> BodyShell:
    """Fein vernetzen, mit Fehlerquadriken auf Budget reduzieren, auf das Feld zurückprojizieren, Stachel vereinigen."""
    fine = remesh_to_budget(field, 4 * face_budget, voxel_divisor=2.0)
    coarse = decimate_quadric(fine, face_budget)
    body = to_manifold(TriangleMesh(field.project_to_surface(coarse.vertices), coarse.faces))
    solid = union_all([body, stinger])
    return BodyShell(shade_with_creases(solid, sharp_angle_degrees=50.0), solid)
