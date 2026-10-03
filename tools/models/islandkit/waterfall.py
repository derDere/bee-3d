"""Wasserfälle als fertige Netze: Wasserkörper, Zerstäubung, Gischtschleier, Sprühwolke, ferne Bänder (Wasserfall).

Jeder Fall folgt seiner Bahn (``islandkit.falls``) und besteht aus Schichten:

- **Wasserkörper** (``Island_Waterfall``, Alpha-Test): ein Band mit Fasertextur, das nach dem
  Austritt auffächert und nach unten breiter wird, bis ``CORE_END`` der Fallhöhe, unten schmaler
  auslaufend. Der Alpha-Test schreibt Tiefe: Der Wolken-Compositor des Spiels zeichnet Wolken hinter
  dem Fall nicht über ihn. Ohne Vertex-Alpha und mit der Schwelle 0,4 deckt sich die Fläche mit der
  Tiefenkarte des Spiels.
- **Zerstäubung** (``Island_Spray``, Blend): dieselben Fasern weich, setzt über dem Ende des
  Wasserkörpers an, überdeckt dessen Spitze und verliert sich bis zum Ende der Fallhöhe.
- **Gischtschleier** vor dem Fall, breiter und nach unten dichter, und eine **Sprühwolke** aus drei
  gekreuzten Flächen um den Fuß, deren Wolkenballen langsam aufsteigen.

v wächst mit der Sichtzeit der Bahn (``FLOW_SPEED`` UV-Einheiten je Sekunde): Wasserkörper und
Zerstäubung ziehen mit dem Wasser, der Schleier mit einem Drittel davon, die Sprühwolke steigt.
Ferne Detailstufen bekommen den Wasserkörper als deckendes, beidseitiges Band mit Vertexfarben im
Netz ihrer Details bzw. der Silhouette — ohne eigenen Draw Call.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from modelkit.shading import smoothstep, srgb_to_linear

from islandkit.assembly import VertexColoredMesh
from islandkit.falls import CORE_END, FallSource, FallTrajectory, trajectory
from islandkit.water import WaterMesh, grid_faces, merge_water

type FloatArray = npt.NDArray[np.float64]

FLOW_SPEED = 0.7  # UV-Einheiten je Sekunde Sichtzeit (Wasserkörper, Zerstäubung, Schleier, Sprühwolke)
_UP = np.array([0.0, 1.0, 0.0])
_BREAKUP = (0.45, 1.0)  # Zerstäubung: Beginn und Ende relativ zur Fallhöhe
_VEIL = (0.12, 1.0)  # Gischtschleier
_PLUME = (0.6, 1.0)  # Sprühwolke am Fuß
_VEIL_DRIFT = 0.35  # Schleier zieht mit diesem Anteil der Wassergeschwindigkeit
_PLUME_RISE = 2.5  # m/s, Aufstieg der Wolkenballen in der Sprühwolke
_PLUME_ANGLES = np.radians([0.0, 60.0, 120.0])
_FAR_END = 0.82  # Ende des fernen Bands relativ zur Fallhöhe
_LAMINAR_TINT = srgb_to_linear((0.86, 0.93, 0.98))  # Ansatz noch glasig, darunter weiß
_FAR_COLOR = srgb_to_linear((0.94, 0.96, 0.99))


@dataclass(frozen=True, slots=True)
class FallDetail:
    """Auflösung der Wasserfallnetze (Falldetail): Zeilen und Spalten der Schichten."""

    core_rows: int = 40
    core_columns: int = 7
    spray_rows: int = 28
    spray_columns: int = 5
    plume_rows: int = 10


@dataclass(frozen=True, slots=True)
class FallMeshes:
    """Netze aller Wasserfälle einer Insel (Wasserfallnetze): Wasserkörper (Alpha-Test) und Gischt (Blend)."""

    core: WaterMesh
    spray: WaterMesh


def build_falls(sources: Sequence[FallSource], height: float, detail: FallDetail | None = None) -> FallMeshes | None:
    """Wasserkörper und Gischt aller Fälle, je Material zu einer Primitive zusammengefasst."""
    if not sources:
        return None
    detail = detail or FallDetail()
    cores = [_core(source, height, detail) for source in sources]
    sprays: list[WaterMesh] = []
    for source in sources:
        sprays.append(_breakup(source, height, detail))
        sprays.append(_veil(source, height, detail))
        sprays.extend(_plume(source, height, detail))
    return FallMeshes(merge_water(cores), merge_water(sprays))


def build_far_falls(sources: Sequence[FallSource], height: float, rows: int = 10) -> VertexColoredMesh | None:
    """Wasserkörper ferner Detailstufen: deckendes, beidseitiges Band bis ``_FAR_END`` der Fallhöhe, unten spitz."""
    if not sources:
        return None
    meshes = []
    for source in sources:
        drops = height * _FAR_END * np.linspace(0.0, 1.0, rows) ** 1.3
        path = trajectory(source, drops)
        relative = drops / drops[-1]
        half_width = source.core_half_width(drops, height) * (1.0 - smoothstep(0.5, 1.0, relative)) + 0.02
        vertices, normals, _ = _sheet(source, path, half_width, np.array([-1.0, 1.0]), bulge=0.0, offset=0.0)
        flat_vertices = vertices.reshape(-1, 3)
        flat_normals = normals.reshape(-1, 3)
        shade = np.repeat(0.9 + 0.1 * smoothstep(0.0, 0.3, relative), 2)
        colors = np.clip(_FAR_COLOR[None, :] * shade[:, None], 0.0, 1.0)
        front = grid_faces(rows, 2, flip=True)
        count = len(flat_vertices)
        # Rückseite mit eigenen Eckpunkten und umgekehrter Normale (das Material ist einseitig)
        meshes.append(
            VertexColoredMesh(
                np.concatenate([flat_vertices, flat_vertices]),
                np.concatenate([flat_normals, -flat_normals]),
                np.concatenate([front, front[:, ::-1] + count]),
                np.concatenate([colors, colors]),
            )
        )
    return VertexColoredMesh.concatenate(meshes)


def _core(source: FallSource, height: float, detail: FallDetail) -> WaterMesh:
    """Wasserkörper: Fasertextur über die volle Breite, unten schmaler auslaufend; Vertexfarbe ohne Alpha."""
    drops = height * CORE_END * np.linspace(0.0, 1.0, detail.core_rows) ** 1.45
    path = trajectory(source, drops)
    end = float(drops[-1])
    taper = 1.0 - 0.65 * smoothstep(0.7 * end, end, drops)
    half_width = source.core_half_width(drops, height) * taper
    across = np.linspace(-1.0, 1.0, detail.core_columns)
    vertices, normals, tangents = _sheet(source, path, half_width, across, bulge=0.12, offset=0.0)
    u = np.broadcast_to((0.5 * across + 0.5)[None, :], vertices.shape[:2])
    v = np.broadcast_to((FLOW_SPEED * path.visual_time)[:, None], vertices.shape[:2])
    clear = smoothstep(0.0, 0.25 * height, drops)
    tint = _LAMINAR_TINT[None, :] + (1.0 - _LAMINAR_TINT)[None, :] * clear[:, None]
    colors = np.repeat(tint, len(across), axis=0)
    return _mesh(vertices, normals, tangents, u, v, colors)


def _breakup(source: FallSource, height: float, detail: FallDetail) -> WaterMesh:
    """Zerstäubung: Fasern weich, vor dem Wasserkörper, wird breiter und verliert sich nach unten."""
    start, stop = _BREAKUP
    relative = start + (stop - start) * np.linspace(0.0, 1.0, detail.spray_rows) ** 1.2
    drops = height * relative
    path = trajectory(source, drops)
    widening = 1.1 + 0.6 * (relative - start) / (stop - start)
    half_width = source.core_half_width(drops, height) * widening
    across = np.linspace(-1.0, 1.0, detail.spray_columns)
    offset = 0.06 + 0.03 * source.half_width
    vertices, normals, tangents = _sheet(source, path, half_width, across, bulge=0.15, offset=offset)
    u = np.broadcast_to((0.25 * across + 0.25)[None, :], vertices.shape[:2])
    v = np.broadcast_to((FLOW_SPEED * path.visual_time)[:, None], vertices.shape[:2])
    along = 0.9 * smoothstep(start, start + 0.1, relative) * (1.0 - smoothstep(0.7, 1.0, relative))
    alpha = along[:, None] * (1.0 - smoothstep(0.55, 1.0, np.abs(across)))[None, :]
    return _mesh(vertices, normals, tangents, u, v, _white(alpha))


def _veil(source: FallSource, height: float, detail: FallDetail) -> WaterMesh:
    """Gischtschleier vor dem Fall: oben zart, nach unten breiter und dichter, am Ende ausgeblendet."""
    start, stop = _VEIL
    relative = start + (stop - start) * np.linspace(0.0, 1.0, detail.spray_rows)
    drops = height * relative
    path = trajectory(source, drops)
    half_width = source.core_half_width(drops, height) * (1.5 + 1.2 * relative)
    across = np.linspace(-1.0, 1.0, detail.spray_columns)
    offset = 0.35 * source.half_width + 0.25
    vertices, normals, tangents = _sheet(source, path, half_width, across, bulge=0.25, offset=offset)
    u = np.broadcast_to((0.75 + 0.25 * across)[None, :], vertices.shape[:2])
    v = np.broadcast_to((FLOW_SPEED * path.visual_time / _VEIL_DRIFT)[:, None], vertices.shape[:2])
    along = 0.4 * smoothstep(0.12, 0.55, relative) * (1.0 - smoothstep(0.82, 1.0, relative))
    alpha = along[:, None] * (1.0 - smoothstep(0.3, 1.0, np.abs(across)))[None, :]
    return _mesh(vertices, normals, tangents, u, v, _white(alpha))


def _plume(source: FallSource, height: float, detail: FallDetail) -> list[WaterMesh]:
    """Sprühwolke am Fuß: drei senkrechte, gekreuzte Flächen um die Bahn, Wolkenballen steigen auf."""
    start, stop = _PLUME
    local = np.linspace(0.0, 1.0, detail.plume_rows)
    drops = height * (start + (stop - start) * local)
    path = trajectory(source, drops)
    half_width = source.core_half_width(drops, height) * (2.2 + 1.8 * local)
    across = np.linspace(-1.0, 1.0, detail.spray_columns)
    along = 0.45 * smoothstep(0.0, 0.35, local) * (1.0 - smoothstep(0.55, 1.0, local))
    alpha = along[:, None] * (1.0 - smoothstep(0.25, 1.0, np.abs(across)))[None, :]
    rise = -(drops - drops[0]) * FLOW_SPEED / _PLUME_RISE
    planes = []
    for index, angle in enumerate(_PLUME_ANGLES):
        direction = np.cos(angle) * source.side + np.sin(angle) * source.outward
        normal = np.cross(_UP, direction)
        vertices = path.centre[:, None, :] + (half_width[:, None] * across[None, :])[..., None] * direction[None, None, :]
        normals = np.broadcast_to(normal[None, None, :], vertices.shape)
        tangents = np.broadcast_to(np.concatenate([direction, [1.0]])[None, None, :], (*vertices.shape[:2], 4))
        u = np.broadcast_to((0.75 + 0.25 * across)[None, :], vertices.shape[:2])
        v = np.broadcast_to((rise + index / len(_PLUME_ANGLES))[:, None], vertices.shape[:2])
        planes.append(_mesh(vertices, normals, tangents, u, v, _white(alpha)))
    return planes


def _sheet(
    source: FallSource, path: FallTrajectory, half_width: FloatArray, across: FloatArray, *, bulge: float, offset: float
) -> tuple[FloatArray, FloatArray, FloatArray]:
    """Band entlang der Bahn: quer zur Fließrichtung, in der Mitte nach außen gewölbt, um ``offset`` vor die Bahn gesetzt.

    Liefert Eckpunkte (Zeilen, Spalten, 3), Normalen nach außen und Tangenten (+u quer; die
    Bitangente zeigt nach oben zu v = 0, w = +1).
    """
    side = source.side
    outward = np.cross(path.tangents, side[None, :])
    outward /= np.maximum(np.linalg.norm(outward, axis=1, keepdims=True), 1e-12)
    outward *= np.sign((outward * source.outward[None, :]).sum(axis=1, keepdims=True) + 1e-9)
    lateral = (half_width[:, None] * across[None, :])[..., None] * side[None, None, :]
    forward = (half_width[:, None] * bulge * (1.0 - across**2)[None, :] + offset)[..., None] * outward[:, None, :]
    vertices = path.centre[:, None, :] + lateral + forward
    normals = np.broadcast_to(outward[:, None, :], vertices.shape)
    tangents = np.broadcast_to(np.concatenate([side, [1.0]])[None, None, :], (*vertices.shape[:2], 4))
    return vertices, normals, tangents


def _mesh(vertices: FloatArray, normals: FloatArray, tangents: FloatArray, u: FloatArray, v: FloatArray, colors: FloatArray) -> WaterMesh:
    """Gitter aus (Zeilen, Spalten)-Feldern als Wassernetz mit ``FLOW_SPEED``."""
    rows, columns = vertices.shape[:2]
    return WaterMesh(
        vertices=vertices.reshape(-1, 3).copy(),
        normals=normals.reshape(-1, 3).copy(),
        faces=grid_faces(rows, columns, flip=True),
        uvs=np.stack([u.ravel(), v.ravel()], axis=1),
        tangents=tangents.reshape(-1, 4).copy(),
        colors=colors,
        flow_speed=FLOW_SPEED,
    )


def _white(alpha: FloatArray) -> FloatArray:
    """Weiße Vertexfarben mit Alpha je Eckpunkt."""
    flat = alpha.reshape(-1)
    return np.concatenate([np.ones((len(flat), 3)), flat[:, None]], axis=1)
