"""Gebackene Umgebungsverdeckung je Eckpunkt (Eckpunkt-AO).

Die Texturen des Stocks kacheln und tragen deshalb nur die Verdeckung im Kleinen (Rillen,
Zellwände der Kachel). Die großräumige Verdeckung — unter dem Anflugbrett, am Rahmen, zwischen
den Waben, tief in den Zellen, in den Türnischen — wird je Eckpunkt mit Embree-Strahlen
gebacken und in die Tönung (``COLOR_0``) multipliziert.
"""

from __future__ import annotations

from dataclasses import replace

import numpy as np
from modelkit.geometry import TriangleMesh
from modelkit.shading import bake_ambient_occlusion

from hivekit.mesh import MeshPart

_CHUNK = 20_000  # Eckpunkte je Strahlenblock (begrenzt den RAM-Bedarf)


def occluder(parts: list[MeshPart]) -> TriangleMesh:
    """Alle Teile als ein Verdeckernetz."""
    return TriangleMesh.concatenate([part.triangle_mesh() for part in parts if part.face_count > 0])


def shade_with_occlusion(
    part: MeshPart, blocker: TriangleMesh, rays: int, distance: float, strength: float, floor: float = 0.0
) -> MeshPart:
    """Multipliziert die Tönung mit (1 − strength) + strength · AO; ``floor`` hebt die dunkelsten Stellen an."""
    if part.vertex_count == 0:
        return part
    values = []
    for start in range(0, part.vertex_count, _CHUNK):
        points = part.vertices[start : start + _CHUNK]
        normals = part.normals[start : start + _CHUNK]
        values.append(
            bake_ambient_occlusion(
                points, normals, blocker, ray_count=rays, max_distance=distance, bias=0.012, seed=start + 7
            )
        )
    occlusion = np.concatenate(values)
    factor = (1.0 - strength) + strength * np.maximum(occlusion, floor)
    return replace(part, tint=part.tint * factor[:, None])
