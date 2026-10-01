"""Röhren, Ringe und Bänder entlang von Kurven: Wurzeln, Äste, Stängel, Halme, Blätter, Wülste (Sweep-Netze).

Offene Röhren folgen der Kurve mit mitgeführtem Rahmen (Parallel Transport) und laufen in einer
Spitze aus; geschlossene Röhren laufen um eine geschlossene Linie. Die UVs wickeln eine kachelnde
Textur um den Umfang (u) und entlang der Länge (v). ``catmull_rom`` glättet Stützpunkte zu Kurven.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

type FloatArray = npt.NDArray[np.float64]
type IndexArray = npt.NDArray[np.int64]


@dataclass(frozen=True, slots=True)
class SweptMesh:
    """Netz mit Normalen, UVs, Tangenten und Längsparameter je Eckpunkt (Sweep-Netz).

    ``along`` läuft von 0 am Anfang bis 1 an der Spitze (z. B. für Farbverläufe). ``tangents``
    folgen glTF (xyz = +u, w = Händigkeit; die Bitangente zeigt zum Anfang, v = 0).
    """

    vertices: FloatArray
    normals: FloatArray
    faces: IndexArray
    uvs: FloatArray
    along: FloatArray
    tangents: FloatArray

    @staticmethod
    def concatenate(meshes: Iterable[SweptMesh]) -> SweptMesh:
        """Fügt Netze ohne Boolean zusammen."""
        parts = list(meshes)
        offsets = np.cumsum([0] + [len(m.vertices) for m in parts[:-1]])
        return SweptMesh(
            np.concatenate([m.vertices for m in parts]),
            np.concatenate([m.normals for m in parts]),
            np.concatenate([m.faces + offset for m, offset in zip(parts, offsets, strict=True)]),
            np.concatenate([m.uvs for m in parts]),
            np.concatenate([m.along for m in parts]),
            np.concatenate([m.tangents for m in parts]),
        )


def _normalized(vectors: FloatArray) -> FloatArray:
    return vectors / np.maximum(np.linalg.norm(vectors, axis=-1, keepdims=True), 1e-12)


def transport_frames(path: FloatArray, initial_normal: FloatArray | None = None) -> tuple[FloatArray, FloatArray, FloatArray]:
    """Tangenten, Normalen und Binormalen entlang einer Polylinie (K, 3) ohne Verdrillung."""
    tangents = _normalized(np.gradient(path, axis=0))
    normals = np.empty_like(path)
    seed = initial_normal if initial_normal is not None else np.cross(tangents[0], [0.0, 1.0, 0.0])
    if np.linalg.norm(seed) < 1e-6:
        seed = np.cross(tangents[0], [1.0, 0.0, 0.0])
    normals[0] = _normalized(seed - tangents[0] * (seed @ tangents[0]))
    for i in range(1, len(path)):
        projected = normals[i - 1] - tangents[i] * (normals[i - 1] @ tangents[i])
        normals[i] = _normalized(projected) if np.linalg.norm(projected) > 1e-9 else normals[i - 1]
    return tangents, normals, np.cross(tangents, normals)


def sweep_tube(
    path: FloatArray,
    radii: FloatArray,
    sides: int,
    *,
    u_repeat: float = 1.0,
    v_per_meter: float = 1.0,
    initial_normal: FloatArray | None = None,
) -> SweptMesh:
    """Röhre durch die Stützpunkte ``path`` (K, 3) mit Radien (K,), endet in einer Spitze.

    ``u_repeat`` Kacheln um den Umfang, ``v_per_meter`` Kacheln je Meter Länge. Der Anfang
    bleibt offen (Röhren beginnen im Elternkörper).
    """
    count = len(path)
    tangents, normals, binormals = transport_frames(path, initial_normal)
    segment = np.linalg.norm(np.diff(path, axis=0), axis=1)
    arc = np.concatenate([[0.0], np.cumsum(segment)])
    slope = np.gradient(radii, arc, edge_order=1) if arc[-1] > 0 else np.zeros(count)
    angles = np.linspace(0.0, 2.0 * np.pi, sides + 1)
    ring = np.cos(angles)[None, :, None] * normals[:, None, :] + np.sin(angles)[None, :, None] * binormals[:, None, :]
    rings = count - 1  # letzter Stützpunkt wird die Spitze
    vertices = path[:rings, None, :] + radii[:rings, None, None] * ring[:rings]
    shading = _normalized(ring[:rings] - slope[:rings, None, None] * tangents[:rings, None, :])
    u = np.broadcast_to(angles[None, :] / (2.0 * np.pi) * u_repeat, (rings, sides + 1))
    v = np.broadcast_to(arc[:rings, None] * v_per_meter, (rings, sides + 1))

    grid = np.arange(rings * (sides + 1)).reshape(rings, sides + 1)
    a, b = grid[:-1, :-1].ravel(), grid[:-1, 1:].ravel()
    c, d = grid[1:, :-1].ravel(), grid[1:, 1:].ravel()
    # Wicklung gegen den Uhrzeigersinn von außen gesehen (Normale zeigt nach außen)
    faces = [np.stack([a, b, c], axis=1), np.stack([b, d, c], axis=1)]
    tip = rings * (sides + 1) + np.arange(sides)
    faces.append(np.stack([grid[-1, :-1], grid[-1, 1:], tip], axis=1))

    tip_uv = np.stack([(np.arange(sides) + 0.5) / sides * u_repeat, np.full(sides, arc[-1] * v_per_meter)], axis=1)
    # +u läuft um den Umfang; cross(N, T) zeigt entlang der Röhre, also w = −1 (Bitangente zum Anfang)
    around = -np.sin(angles)[None, :, None] * normals[:, None, :] + np.cos(angles)[None, :, None] * binormals[:, None, :]
    surface_tangents = np.concatenate([around[:rings].reshape(-1, 3), np.repeat(binormals[-1:], sides, axis=0)])
    return SweptMesh(
        vertices=np.concatenate([vertices.reshape(-1, 3), np.repeat(path[-1:], sides, axis=0)]),
        normals=np.concatenate([shading.reshape(-1, 3), np.repeat(tangents[-1:], sides, axis=0)]),
        faces=np.concatenate(faces).astype(np.int64),
        uvs=np.concatenate([np.stack([u.ravel(), v.ravel()], axis=1), tip_uv]),
        along=np.concatenate([np.repeat(arc[:rings] / max(arc[-1], 1e-9), sides + 1), np.ones(sides)]),
        tangents=np.concatenate([surface_tangents, -np.ones((len(surface_tangents), 1))], axis=1),
    )


def sweep_closed_tube(path: FloatArray, radii: FloatArray, up: FloatArray, sides: int) -> SweptMesh:
    """Geschlossene Röhre um die geschlossene Polylinie ``path`` (K, 3) mit Radien (K,) — Ringe, Wülste, Lippen.

    ``up`` (K, 3) gibt je Stützpunkt die Bezugsrichtung des Querschnitts vor (etwa die
    Flächennormale); der Rahmen schließt sich dadurch ohne Verdrillung. Der erste Ring wird am
    Ende wiederholt, damit v entlang der Linie stetig bis zur Gesamtlänge läuft.
    """
    tangents = _normalized(np.roll(path, -1, axis=0) - np.roll(path, 1, axis=0))
    binormals = _normalized(up - tangents * np.einsum("ij,ij->i", up, tangents)[:, None])
    normals = np.cross(binormals, tangents)
    closed = np.concatenate([path, path[:1]])
    segment = np.linalg.norm(np.diff(closed, axis=0), axis=1)
    arc = np.concatenate([[0.0], np.cumsum(segment)])
    slope = (np.roll(radii, -1) - np.roll(radii, 1)) / np.maximum(segment + np.roll(segment, 1), 1e-12)
    rows = np.arange(len(path) + 1) % len(path)
    angles = np.linspace(0.0, 2.0 * np.pi, sides + 1)
    ring = np.cos(angles)[None, :, None] * normals[rows, None, :] + np.sin(angles)[None, :, None] * binormals[rows, None, :]
    vertices = closed[:, None, :] + radii[rows, None, None] * ring
    shading = _normalized(ring - slope[rows, None, None] * tangents[rows, None, :])
    grid = np.arange(len(rows) * (sides + 1)).reshape(len(rows), sides + 1)
    a, b = grid[:-1, :-1].ravel(), grid[:-1, 1:].ravel()
    c, d = grid[1:, :-1].ravel(), grid[1:, 1:].ravel()
    # Umfang (u) × Linie (v) zeigt nach außen, weil normals × binormals = tangents
    faces = np.concatenate([np.stack([a, b, c], axis=1), np.stack([b, d, c], axis=1)]).astype(np.int64)
    u = np.broadcast_to(angles[None, :] / (2.0 * np.pi), (len(rows), sides + 1))
    v = np.broadcast_to(arc[:, None], (len(rows), sides + 1))
    around = -np.sin(angles)[None, :, None] * normals[rows, None, :] + np.cos(angles)[None, :, None] * binormals[rows, None, :]
    count = len(rows) * (sides + 1)
    return SweptMesh(
        vertices=vertices.reshape(-1, 3),
        normals=shading.reshape(-1, 3),
        faces=faces,
        uvs=np.stack([u.ravel(), v.ravel()], axis=1),
        along=np.repeat(arc / max(arc[-1], 1e-12), sides + 1),
        tangents=np.concatenate([around.reshape(-1, 3), -np.ones((count, 1))], axis=1),
    )


def catmull_rom(points: FloatArray, samples_per_segment: int) -> FloatArray:
    """Glatte Kurve durch alle Stützpunkte (K, 3) als zentripetaler Catmull-Rom-Spline.

    Liefert (K − 1) · ``samples_per_segment`` + 1 Punkte; Anfangs- und Endpunkt bleiben erhalten.
    """
    nodes = np.asarray(points, dtype=np.float64)
    padded = np.concatenate([2.0 * nodes[:1] - nodes[1:2], nodes, 2.0 * nodes[-1:] - nodes[-2:-1]])
    result = [nodes[:1]]
    t = np.linspace(0.0, 1.0, samples_per_segment + 1)[1:, None]
    for i in range(len(nodes) - 1):
        p0, p1, p2, p3 = padded[i : i + 4]
        # Zentripetale Parametrisierung (alpha = 0,5) vermeidet Schlaufen an engen Knicken
        t1 = np.linalg.norm(p1 - p0) ** 0.5 + 1e-9
        t2 = t1 + np.linalg.norm(p2 - p1) ** 0.5 + 1e-9
        t3 = t2 + np.linalg.norm(p3 - p2) ** 0.5 + 1e-9
        s = t1 + t * (t2 - t1)
        a1 = (t1 - s) / t1 * p0 + s / t1 * p1
        a2 = (t2 - s) / (t2 - t1) * p1 + (s - t1) / (t2 - t1) * p2
        a3 = (t3 - s) / (t3 - t2) * p2 + (s - t2) / (t3 - t2) * p3
        b1 = (t2 - s) / t2 * a1 + s / t2 * a2
        b2 = (t3 - s) / (t3 - t1) * a2 + (s - t1) / (t3 - t1) * a3
        result.append((t2 - s) / (t2 - t1) * b1 + (s - t1) / (t2 - t1) * b2)
    return np.concatenate(result)


def sweep_ribbon(path: FloatArray, widths: FloatArray, side: FloatArray, segments_across: int = 2, *, cup: float = 0.0) -> SweptMesh:
    """Band entlang ``path`` (K, 3); ``side`` (K, 3) gibt die Querrichtung je Stützpunkt vor.

    ``widths`` sind die vollen Breiten, ``cup`` wölbt das Band quer (Anteil der Breite, positiv
    entlang der Bandnormale). u läuft quer von 0 bis 1, v entlang der Länge von 0 bis 1.
    """
    across = np.linspace(-0.5, 0.5, segments_across + 1)
    tangents = _normalized(np.gradient(path, axis=0))
    side = _normalized(side - tangents * np.einsum("ij,ij->i", side, tangents)[:, None])
    normal = _normalized(np.cross(side, tangents))
    bend = cup * (1.0 - (2.0 * across) ** 2)
    vertices = (
        path[:, None, :]
        + (widths[:, None] * across[None, :])[..., None] * side[:, None, :]
        + (widths[:, None] * bend[None, :])[..., None] * normal[:, None, :]
    )
    tilt = (-8.0 * cup * across)[None, :, None] * side[:, None, :]
    normals = _normalized(normal[:, None, :] + tilt)
    count, width = len(path), segments_across + 1
    grid = np.arange(count * width).reshape(count, width)
    a, b = grid[:-1, :-1].ravel(), grid[:-1, 1:].ravel()
    c, d = grid[1:, :-1].ravel(), grid[1:, 1:].ravel()
    v = np.linspace(0.0, 1.0, count)
    uvs = np.stack(np.broadcast_arrays(across[None, :] + 0.5, v[:, None]), axis=-1).reshape(-1, 2)
    return SweptMesh(
        vertices=vertices.reshape(-1, 3),
        normals=normals.reshape(-1, 3),
        faces=np.concatenate([np.stack([a, b, c], axis=1), np.stack([b, d, c], axis=1)]).astype(np.int64),
        uvs=uvs,
        along=np.repeat(v, width),
        tangents=np.concatenate([np.repeat(side, width, axis=0), -np.ones((count * width, 1))], axis=1),
    )
