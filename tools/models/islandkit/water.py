"""Wasser der Insel: Teichfläche, Bachband und Wasserfall mit Gischtschleier (Inselwasser).

Alle Flächen sind fertige Netze mit Texturen. Bach und Wasserfall tragen UVs, deren v entlang
der Fließrichtung wächst; das Spiel verschiebt die Texturen zur Laufzeit um
``flow_speed`` UV-Einheiten je Sekunde (Knoten-``extras``: ``{"flow": {"speed": …}}``).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from modelkit.shading import linear_to_srgb, smoothstep, srgb_to_linear
from modelkit.sweep import transport_frames
from modelkit.tiling import encode_linear, encode_normal, height_to_normal, periodic_noise

from islandkit.terrain import IslandTerrain

type FloatArray = npt.NDArray[np.float64]
type IndexArray = npt.NDArray[np.int64]
type ByteImage = npt.NDArray[np.uint8]

RIPPLE_TILE = 3.0  # m je Kachel der Wellen-Normal-Map
FALL_TILE = 5.0  # m je Kachel der Wasserfalltextur entlang der Fallrichtung
GRAVITY = 9.81


@dataclass(frozen=True, slots=True)
class WaterMesh:
    """Wasserfläche (Wassernetz): Geometrie, UVs, Tangenten, lineare RGBA-Vertexfarben, Fließgeschwindigkeit."""

    vertices: FloatArray
    normals: FloatArray
    faces: IndexArray
    uvs: FloatArray
    tangents: FloatArray
    colors: FloatArray
    flow_speed: float = 0.0


@dataclass(frozen=True, slots=True)
class WaterTextures:
    """Gemeinsame Wassertexturen: Wellen-Normal-Map (kachelnd) und Wasserfall-RGBA (kachelnd entlang v)."""

    ripple_normal: ByteImage
    fall_color: ByteImage
    fall_normal: ByteImage


def _grid_faces(rows: int, cols: int, *, flip: bool = False) -> IndexArray:
    """Dreiecke eines Gitters; Normale = Spaltenrichtung × Zeilenrichtung, mit ``flip`` umgekehrt."""
    grid = np.arange(rows * cols).reshape(rows, cols)
    a, b = grid[:-1, :-1].ravel(), grid[:-1, 1:].ravel()
    c, d = grid[1:, :-1].ravel(), grid[1:, 1:].ravel()
    faces = np.concatenate([np.stack([a, b, c], axis=1), np.stack([b, d, c], axis=1)]).astype(np.int64)
    return faces[:, ::-1].copy() if flip else faces


def build_water_textures(seed: int) -> WaterTextures:
    """Wellen (512²) und Wasserfallschleier (256 × 1024, Fasern längs) als kachelnde Texturen."""
    ripples = periodic_noise(512, 512, seed, exponent=3.2, shortest=6.0)
    ripple_normal = encode_normal(height_to_normal(ripples, strength=0.9))

    fibers = periodic_noise(1024, 256, seed + 1, exponent=2.4, stretch=(1.0, 9.0), shortest=2.0)
    churn = periodic_noise(1024, 256, seed + 2, exponent=2.8, stretch=(1.0, 2.0), shortest=3.0)
    foam = smoothstep(0.2, 1.6, 0.7 * fibers + 0.5 * churn)
    alpha = np.clip(0.55 + 0.3 * fibers + 0.25 * foam, 0.0, 1.0)
    base = srgb_to_linear([0.62, 0.80, 0.88])
    white = srgb_to_linear([0.95, 0.98, 1.0])
    linear = base[None, None, :] + (white - base)[None, None, :] * foam[..., None]
    srgb = linear_to_srgb(linear.reshape(-1, 3)).reshape(linear.shape)
    fall_color = encode_linear(np.concatenate([srgb, alpha[..., None]], axis=-1))
    fall_normal = encode_normal(height_to_normal(0.6 * fibers + 0.4 * churn, strength=0.6))
    return WaterTextures(ripple_normal, fall_color, fall_normal)


def pond_spacing(terrain: IslandTerrain) -> float:
    """Gitterweite der Teichfläche: wächst mit dem Teich von 0,35 m bis 0,6 m bei großen Seen."""
    pond = terrain.plan.pond
    return 0.35 if pond is None else float(np.clip(float(pond.radii.max()) / 25.0, 0.35, 0.6))


def build_pond(terrain: IslandTerrain, spacing: float | None = None) -> WaterMesh | None:
    """Teichfläche auf dem Wasserspiegel; reicht eine Zelle unter das Ufer, das sie verdeckt.

    Ohne ``spacing`` gilt ``pond_spacing``.
    """
    pond, water = terrain.plan.pond, terrain.water
    if pond is None or water is None:
        return None
    spacing = spacing or pond_spacing(terrain)
    reach = 1.35 * float(pond.radii.max()) + 1.0
    axis = np.arange(-reach, reach + spacing, spacing)
    gx, gz = np.meshgrid(pond.center[0] + axis, pond.center[1] + axis, indexing="ij")
    points = np.stack([gx.ravel(), np.full(gx.size, water.pond), gz.ravel()], axis=1)
    sample = terrain.sample(points)
    clearance = terrain.distance(points)  # > 0: Wasserspiegel liegt frei über dem Grund
    wet = ((clearance > 0.0) & (sample.pond < 0.4)).reshape(gx.shape)
    faces = _grid_faces(*gx.shape)
    keep = wet.ravel()[faces].any(axis=1)
    return _flat_water(points, faces[keep], depth=np.clip(clearance, 0.0, None))


def build_stream(terrain: IslandTerrain, step: float = 0.4) -> WaterMesh | None:
    """Bachband vom Teichufer bis über die Kante; v entlang der Fließrichtung in Kacheln.

    Der Bachlauf beginnt in der Teichmitte; das Band setzt erst 0,6 m vor dem Ufer an, damit
    Teich- und Bachfläche nicht doppelt übereinander liegen.
    """
    stream, water = terrain.plan.stream, terrain.water
    outlet = terrain.stream_outlet()
    if stream is None or water is None or outlet is None:
        return None
    arc = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(stream.path, axis=0), axis=1))])
    exit_arc = float(arc[np.argmin(np.linalg.norm(stream.path - outlet.position[[0, 2]], axis=1))])
    samples = np.arange(0.0, exit_arc + 0.6 * stream.half_width, step)
    centre = np.stack([np.interp(samples, arc, stream.path[:, i]) for i in range(2)], axis=1)
    level = np.interp(samples, arc, water.stream)
    in_pond = terrain.sample(np.column_stack([centre[:, 0], level, centre[:, 1]])).pond < -0.6
    start = int(np.argmax(~in_pond)) if np.any(~in_pond) else 0
    samples, centre, level = samples[start:], centre[start:], level[start:]
    direction = np.gradient(centre, axis=0)
    direction /= np.linalg.norm(direction, axis=1, keepdims=True)
    side = np.stack([-direction[:, 1], direction[:, 0]], axis=1)
    across = np.linspace(-1.0, 1.0, 7) * stream.half_width
    xz = centre[:, None, :] + across[None, :, None] * side[:, None, :]
    vertices = np.concatenate([xz[..., :1], np.broadcast_to(level[:, None, None], (*xz.shape[:2], 1)), xz[..., 1:]], axis=-1)
    flat = vertices.reshape(-1, 3)
    u = np.broadcast_to((across / (2.0 * stream.half_width) + 0.5)[None, :], xz.shape[:2]) * (2.0 * stream.half_width / RIPPLE_TILE)
    v = np.broadcast_to(samples[:, None] / RIPPLE_TILE, xz.shape[:2])
    edge = np.broadcast_to(np.abs(across)[None, :] / stream.half_width, xz.shape[:2]).ravel()
    alpha = 0.78 - 0.4 * smoothstep(0.6, 1.0, edge)
    # Tangente = +u (quer), Bitangente zeigt gegen die Fließrichtung zu v = 0 → w = −1
    side_3d = np.stack([side[:, 0], np.zeros(len(side)), side[:, 1]], axis=1)
    tangents = np.concatenate([np.repeat(side_3d, len(across), axis=0), -np.ones((len(flat), 1))], axis=1)
    return WaterMesh(
        vertices=flat,
        normals=np.tile([0.0, 1.0, 0.0], (len(flat), 1)),
        faces=_grid_faces(len(samples), len(across)),
        uvs=np.stack([u.ravel(), v.ravel()], axis=1),
        tangents=tangents,
        colors=_with_alpha(alpha),
        flow_speed=1.1 / RIPPLE_TILE,
    )


def build_waterfall(terrain: IslandTerrain, *, mist: bool = False, rows: int = 64, columns: int = 9) -> WaterMesh | None:
    """Wasserfall ab der Bachmündung: Wurfparabel, nach unten breiter und durchsichtiger.

    ``mist`` erzeugt den äußeren Gischtschleier: breiter, weiter außen, schneller verblassend.
    ``rows``/``columns`` sind die Stützpunkte längs und quer (weniger für ferne Detailstufen).
    """
    outlet = terrain.stream_outlet()
    if outlet is None:
        return None
    depth = terrain.dims.depth
    speed = 1.6 + 0.02 * terrain.dims.radius
    fall = 1.05 * depth
    duration = np.sqrt(2.0 * fall / GRAVITY)
    t = duration * np.linspace(0.0, 1.0, rows) ** 1.6  # dichter am Ansatz, wo sich die Kurve biegt
    out = np.array([outlet.direction[0], 0.0, outlet.direction[1]])
    centre = outlet.position[None, :] + speed * t[:, None] * out[None, :] - 0.5 * GRAVITY * (t * t)[:, None] * np.array([0.0, 1.0, 0.0])
    tangents, normals, binormals = transport_frames(centre, initial_normal=out)
    side = np.cross(np.array([0.0, 1.0, 0.0]), out)
    side /= np.linalg.norm(side)
    drop = outlet.position[1] - centre[:, 1]
    spread = 1.0 + drop / (0.8 * depth)
    half_width = outlet.half_width * (0.9 * spread + (0.6 if mist else 0.0)) * (1.25 if mist else 1.0)
    across = np.linspace(-1.0, 1.0, columns)
    bulge = (0.22 if mist else 0.12) * (1.0 - across**2)
    outward = _normalized(np.cross(tangents, side[None, :]))
    outward *= np.sign((outward * out[None, :]).sum(axis=1, keepdims=True) + 1e-9)
    offset = 0.25 * outlet.half_width if mist else 0.0
    vertices = (
        centre[:, None, :]
        + (half_width[:, None] * across[None, :])[..., None] * side[None, None, :]
        + ((half_width[:, None] * bulge[None, :]) + offset)[..., None] * outward[:, None, :]
    )
    arc = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(centre, axis=0), axis=1))])
    u = np.broadcast_to((across * 0.5 + 0.5)[None, :] * (1.6 if mist else 1.0), vertices.shape[:2])
    v = np.broadcast_to(arc[:, None] / FALL_TILE, vertices.shape[:2])
    fade_end = 0.55 if mist else 0.95
    alpha = (1.0 - smoothstep(0.25, fade_end, drop / fall))[:, None] * (1.0 - smoothstep(0.7, 1.0, np.abs(across)))[None, :]
    alpha = alpha * (0.35 if mist else 0.95)
    tangent_rows = np.broadcast_to(np.concatenate([side, [1.0]])[None, None, :], (*vertices.shape[:2], 4))
    normal_rows = np.broadcast_to(outward[:, None, :], vertices.shape)
    return WaterMesh(
        vertices=vertices.reshape(-1, 3),
        normals=normal_rows.reshape(-1, 3).copy(),
        faces=_grid_faces(*vertices.shape[:2], flip=True),
        uvs=np.stack([u.ravel(), v.ravel()], axis=1),
        tangents=tangent_rows.reshape(-1, 4).copy(),
        colors=np.concatenate([np.ones((alpha.size, 3)), alpha.reshape(-1, 1)], axis=1),
        flow_speed=speed * 2.2 / FALL_TILE,
    )


def merge_water(meshes: list[WaterMesh]) -> WaterMesh:
    """Fügt Wasserflächen desselben Materials zu einer Primitive zusammen (gleiche Fließgeschwindigkeit)."""
    offsets = np.cumsum([0] + [len(mesh.vertices) for mesh in meshes[:-1]])
    return WaterMesh(
        vertices=np.concatenate([mesh.vertices for mesh in meshes]),
        normals=np.concatenate([mesh.normals for mesh in meshes]),
        faces=np.concatenate([mesh.faces + offset for mesh, offset in zip(meshes, offsets, strict=True)]),
        uvs=np.concatenate([mesh.uvs for mesh in meshes]),
        tangents=np.concatenate([mesh.tangents for mesh in meshes]),
        colors=np.concatenate([mesh.colors for mesh in meshes]),
        flow_speed=meshes[0].flow_speed,
    )


def reduced_water_textures(textures: WaterTextures, factor: int) -> WaterTextures:
    """Verkleinert die Wassertexturen um ``factor`` je Kante (2 × 2-Mittelung, Normalen neu normiert)."""
    return WaterTextures(
        ripple_normal=_shrink_normal(textures.ripple_normal, factor),
        fall_color=_shrink(textures.fall_color, factor),
        fall_normal=_shrink_normal(textures.fall_normal, factor),
    )


def _shrink(image: ByteImage, factor: int) -> ByteImage:
    h, w, c = image.shape
    blocks = image.reshape(h // factor, factor, w // factor, factor, c).astype(np.float64).mean(axis=(1, 3))
    return np.round(blocks).astype(np.uint8)


def _shrink_normal(image: ByteImage, factor: int) -> ByteImage:
    vectors = _shrink(image, factor).astype(np.float64) / 127.5 - 1.0
    return encode_normal(vectors / np.maximum(np.linalg.norm(vectors, axis=-1, keepdims=True), 1e-9))


def _flat_water(points: FloatArray, faces: IndexArray, depth: FloatArray) -> WaterMesh:
    used = np.unique(faces)
    remap = np.full(len(points), -1)
    remap[used] = np.arange(len(used))
    vertices = points[used]
    alpha = 0.45 + 0.4 * smoothstep(0.05, 0.9, depth[used])
    return WaterMesh(
        vertices=vertices,
        normals=np.tile([0.0, 1.0, 0.0], (len(vertices), 1)),
        faces=remap[faces],
        uvs=vertices[:, [0, 2]] / RIPPLE_TILE,
        tangents=np.tile([1.0, 0.0, 0.0, 1.0], (len(vertices), 1)),
        colors=_with_alpha(alpha),
    )


def _with_alpha(alpha: FloatArray) -> FloatArray:
    """Weiße Vertexfarbe mit Alpha; die Wasserfarbe trägt der Materialfaktor, flaches Wasser bleibt klarer."""
    return np.concatenate([np.ones((len(alpha), 3)), alpha[:, None]], axis=1)


def _normalized(vectors: FloatArray) -> FloatArray:
    return vectors / np.maximum(np.linalg.norm(vectors, axis=-1, keepdims=True), 1e-12)
