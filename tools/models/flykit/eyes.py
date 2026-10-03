"""Facettenaugen der Fliege: Ellipsoidkappen, Facettenmosaik und Augentexturen (Komplexaugen).

Jedes Auge ist eine Ellipsoidkappe, deren Rand verdeckt in der Kopfkapsel liegt. Die UVs
projizieren polar um die Außenachse (Pol in der Bildmitte, nahtlos); das rechte Auge ist das
gespiegelte linke und teilt Texturen und UVs. Die Ommatidien sind zentroidale Voronoi-Zellen auf
der Kappe (Lloyd-Relaxation gleichverteilter Punkte): sechseckig mit natürlichen Fehlstellen wie
bei echten Komplexaugen. Jede Facette ist eine kleine Linse — die Normal-Map wölbt sie, sodass
jede ihr eigenes Glanzlicht fängt; die Ränder bilden dunkle Rinnen.

Die Leuchttextur trägt Augenmaske × Leuchtrot (Facettenmitten hell, Rinnen dunkel); das Material
startet mit ``emissiveFactor`` = 0, das Spiel hebt die Leuchtfarbe nachts an.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from modelkit.baking import TexelMap, bake_base_color, bake_normal_map, bake_orm
from modelkit.shading import smoothstep
from modelkit.uv import UnwrappedMesh
from scipy.spatial import cKDTree

from flykit.anatomy import EyeShape, normalized
from flykit.species import Palette, linear

type FloatArray = npt.NDArray[np.float64]
type ByteImage = npt.NDArray[np.uint8]

UV_FILL = 0.985  # Anteil des Bildradius, den der Kappenrand erreicht
LENS_BULGE = 0.85  # Neigung der Facettennormalen am Zellrand (Linsenwölbung)
GROOVE_WIDTH = 0.11  # Rinnenbreite als Anteil des Facettenabstands


def eye_mesh(eye: EyeShape, rings: int, segments: int) -> UnwrappedMesh:
    """Kappe im Modellrahmen: Pol auf der Außenachse, Ringe bis zum Kappenrand, polare UVs."""
    cap = np.radians(eye.cap_degrees)
    theta = cap * (np.arange(1, rings + 1) / rings) ** 0.92
    phi = 2.0 * np.pi * np.arange(segments) / segments
    ring = np.stack(
        [
            (np.sin(theta)[:, None] * np.cos(phi)[None, :]).ravel(),
            (np.sin(theta)[:, None] * np.sin(phi)[None, :]).ravel(),
            np.repeat(np.cos(theta), segments),
        ],
        axis=1,
    )
    local = np.concatenate([[[0.0, 0.0, 1.0]], ring])
    faces = []
    for j in range(segments):
        k = (j + 1) % segments
        faces.append((0, 1 + j, 1 + k))
        for r in range(rings - 1):
            a, b = 1 + r * segments + j, 1 + r * segments + k
            faces += [(a, a + segments, b + segments), (a, b + segments, b)]
    angle = np.concatenate([[0.0], np.repeat(theta, segments)])
    heading = np.concatenate([[0.0], np.tile(phi, rings)])
    radius = 0.5 * UV_FILL * angle / cap
    uvs = np.stack([0.5 + radius * np.cos(heading), 0.5 - radius * np.sin(heading)], axis=1)
    count = len(local)
    return UnwrappedMesh(eye.surface(local), eye.normals(local), np.asarray(faces, dtype=np.int64), uvs, np.arange(count))


@dataclass(frozen=True, slots=True)
class FacetMosaic:
    """Ommatidien als zentroidale Voronoi-Zellen auf der Augenkappe (Facettenmosaik).

    ``centers`` sind Punkte auf der Augenfläche im Modellrahmen, ``spacing`` der mittlere
    Abstand benachbarter Facetten, ``tones`` ein Zufallswert je Facette.
    """

    centers: FloatArray
    spacing: float
    tones: FloatArray


def _cap_samples(eye: EyeShape, count: int, rng: np.random.Generator, margin_degrees: float = 6.0) -> FloatArray:
    """Flächengleich verteilte lokale Richtungen auf der Ellipsoidkappe (Verwerfungsverfahren)."""
    limit = np.cos(np.radians(min(eye.cap_degrees + margin_degrees, 179.0)))
    accepted: list[FloatArray] = []
    total = 0
    radii = eye.radii
    peak = float(np.prod(radii) / radii.min())
    while total < count:
        batch = 2 * count
        cos_theta = rng.uniform(limit, 1.0, batch)
        phi = rng.uniform(0.0, 2.0 * np.pi, batch)
        sin_theta = np.sqrt(1.0 - cos_theta**2)
        directions = np.stack([sin_theta * np.cos(phi), sin_theta * np.sin(phi), cos_theta], axis=1)
        # Flächenmaß der Abbildung Einheitskugel → Ellipsoid: r1·r2·r3·|d / r|
        weight = np.prod(radii) * np.linalg.norm(directions / radii, axis=1) / peak
        keep = directions[rng.random(batch) < weight]
        accepted.append(keep)
        total += len(keep)
    return np.concatenate(accepted)[:count]


def facet_mosaic(eye: EyeShape, count: int, rng: np.random.Generator, iterations: int = 12) -> FacetMosaic:
    """Lloyd-Relaxation auf der Kappe: Zufallspunkte wandern in die Schwerpunkte ihrer Zellen."""
    samples = eye.surface(_cap_samples(eye, 40 * count, rng))
    centers = samples[rng.choice(len(samples), count, replace=False)]
    for _ in range(iterations):
        _, owner = cKDTree(centers).query(samples)
        sums = np.zeros_like(centers)
        np.add.at(sums, owner, samples)
        counts = np.bincount(owner, minlength=count)[:, None]
        moved = np.where(counts > 0, sums / np.maximum(counts, 1), centers)
        centers = eye.surface(eye.local_directions(moved))
    distances, _ = cKDTree(centers).query(centers, k=2)
    return FacetMosaic(centers, float(np.median(distances[:, 1])), rng.random(count))


@dataclass(frozen=True, slots=True)
class EyeImages:
    """Texturen der Facettenaugen: Farbe, ORM, Normal-Map, Leuchtmaske (Augentexturen)."""

    color: ByteImage
    orm: ByteImage
    normal: ByteImage
    emissive: ByteImage


def bake_eye(texels: TexelMap, eye: EyeShape, mosaic: FacetMosaic, palette: Palette, occlusion: FloatArray) -> EyeImages:
    """Bemalt die Augenkappe je Texel: Linsen, Rinnen, Tönung, Glanz, Leuchtmaske."""
    directions = eye.local_directions(texels.positions)
    points, normals = eye.surface(directions), eye.normals(directions)
    distances, owners = cKDTree(mosaic.centers).query(points, k=2)
    radius = 0.5 * mosaic.spacing
    edge = (distances[:, 1] - distances[:, 0]) / mosaic.spacing
    groove = 1.0 - smoothstep(0.0, GROOVE_WIDTH, edge)
    offset = points - mosaic.centers[owners[:, 0]]
    tangential = offset - normals * np.einsum("ij,ij->i", offset, normals)[:, None]
    lens = np.clip(1.0 - (np.linalg.norm(tangential, axis=1) / radius) ** 2, 0.0, 1.0)
    detail = normalized(normals + LENS_BULGE * tangential / radius)

    tone = mosaic.tones[owners[:, 0]]
    rim = smoothstep(0.55, 1.0, np.arccos(np.clip(directions[:, 2], -1.0, 1.0)) / np.radians(eye.cap_degrees))
    upper = smoothstep(-0.1, 0.8, directions[:, 1])
    base, deep = linear(palette.eye), linear(palette.eye_deep)
    color = base[None, :] * (0.88 + 0.2 * tone[:, None]) * (1.0 + 0.18 * upper[:, None])
    color = color * (1.0 - 0.55 * rim[:, None]) + deep[None, :] * (0.55 * rim[:, None])
    color = color * (1.0 - groove[:, None]) + deep[None, :] * (0.6 * groove[:, None])
    color *= (0.55 + 0.45 * occlusion)[:, None]
    roughness = 0.1 + 0.08 * (1.0 - lens) + 0.38 * groove
    glow = linear(palette.eye_glow)[None, :] * ((0.35 + 0.65 * lens**0.7) * (1.0 - groove) * (1.0 - 0.6 * rim) * (0.8 + 0.2 * tone))[:, None]
    return EyeImages(
        color=bake_base_color(texels, np.clip(color, 0.0, 1.0)),
        orm=bake_orm(texels, occlusion, np.clip(roughness, 0.05, 1.0), np.zeros(texels.count)),
        normal=bake_normal_map(texels, texels.mesh.tangents(), detail),
        emissive=bake_base_color(texels, np.clip(glow, 0.0, 1.0)),
    )
