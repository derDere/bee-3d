"""Felsbrocken und Kiesel: kantig geschnittene, verrundete Körper mit Rissen, Korn und Moos (Felsbrocken).

Grundform ist eine verrundete Box, die von schrägen Ebenen weich beschnitten wird (Bruchflächen);
Rauschen und Zellrisse kommen darauf. Ursprung auf der Hochachse bei 25 % der Höhe — der Brocken
steckt beim Platzieren auf y = 0 ein Stück im Boden.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import numpy.typing as npt
from modelkit.baking import bake_base_color, bake_channels, bake_normal_map
from modelkit.noise import Cellular, Fractal
from modelkit.sdf import Aabb, RoundedBox, Sdf, smooth_min
from modelkit.sdf_asset import bake_sdf_asset
from modelkit.shading import smoothstep, srgb_to_linear
from modelkit.uv import UnwrappedMesh

type FloatArray = npt.NDArray[np.float64]
type ByteImage = npt.NDArray[np.uint8]
type Srgb = tuple[float, float, float]


@dataclass(frozen=True, slots=True)
class RockSpec:
    """Felsbrocken (Felsbrocken): Abmessungen in m, Bruchflächen, Dreiecke, Texturgröße, Moosanteil."""

    name: str
    size: tuple[float, float, float]
    cuts: int
    faces: int
    texture: int
    moss: float
    color: Srgb = (0.58, 0.55, 0.50)
    dark: Srgb = (0.34, 0.33, 0.32)
    moss_color: Srgb = (0.30, 0.43, 0.13)


@dataclass(frozen=True)
class RockField(Sdf):
    """Distanzfeld eines Felsbrockens (Felsfeld); ``min_wavelength`` begrenzt die Rauschoktaven."""

    spec: RockSpec
    seed: int
    min_wavelength: float = 0.0
    _planes: FloatArray = field(init=False, repr=False)
    _base: RoundedBox = field(init=False, repr=False)
    _noise: Fractal = field(init=False, repr=False)
    _cracks: Cellular = field(init=False, repr=False)

    def __post_init__(self) -> None:
        rng = np.random.default_rng(self.seed)
        half = np.array(self.spec.size) / 2.0
        center = np.array([0.0, half[1] * 0.5, 0.0])  # Ursprung bei 25 % der Höhe
        normals = rng.normal(size=(self.spec.cuts, 3)) * np.array([1.0, 0.6, 1.0])
        normals /= np.linalg.norm(normals, axis=1, keepdims=True)
        reach = np.abs(normals) @ half
        offsets = normals @ center + reach * rng.uniform(0.72, 0.9, self.spec.cuts)
        object.__setattr__(self, "_planes", np.concatenate([normals, offsets[:, None]], axis=1))
        object.__setattr__(self, "_base", RoundedBox(center, half, 0.35 * float(half.min())))
        object.__setattr__(self, "_noise", Fractal(self.seed + 1, 2.2 / float(half.max()), octaves=6))
        object.__setattr__(self, "_cracks", Cellular(self.seed + 2, 1.6 / float(half.max())))

    def with_detail(self, min_wavelength: float) -> RockField:
        return RockField(self.spec, self.seed, min_wavelength)

    def distance(self, points: FloatArray) -> FloatArray:
        size = float(max(self.spec.size))
        body = self._base.distance(points)
        blend = 0.06 * size
        for plane in self._planes:
            cut = points @ plane[:3] - plane[3]
            body = -smooth_min(-body, -cut, blend)
        cracks = self._cracks.evaluate(points)
        groove = 1.0 - smoothstep(0.0, 0.08, cracks.edge)
        return body - 0.035 * size * self._noise(points, self.min_wavelength) + 0.012 * size * groove

    def bounds(self) -> Aabb:
        return self._base.bounds().padded(0.1 * max(self.spec.size))


@dataclass(frozen=True, slots=True)
class RockMesh:
    """Fertiger Felsbrocken (Felsnetz): Netz mit UVs, Tangenten und Texturen."""

    mesh: UnwrappedMesh
    tangents: FloatArray
    color: ByteImage
    normal: ByteImage
    orm: ByteImage


def build_rock(spec: RockSpec, seed: int) -> RockMesh:
    """Vernetzt, wickelt ab und bemalt einen Felsbrocken."""
    fine = RockField(spec, seed)
    edge = float(np.sqrt(4.0 * _area(spec) / (np.sqrt(3.0) * spec.faces)))
    baked = bake_sdf_asset(fine, fine.with_detail(2.0 * edge), spec.faces, spec.texture, ao_rays=32, ao_distance=0.3 * max(spec.size))
    points, up = baked.texels.positions, baked.detail_normals[:, 1]
    grain = Fractal(seed + 5, 9.0 / max(spec.size), octaves=5)(points)
    patches = Fractal(seed + 6, 3.0 / max(spec.size), octaves=4)(points)
    light, dark = srgb_to_linear(spec.color), srgb_to_linear(spec.dark)
    color = dark + (light - dark) * (0.55 + 0.45 * smoothstep(-0.5, 0.5, grain))[:, None]
    color *= (0.75 + 0.25 * baked.occlusion)[:, None]
    moss = spec.moss * smoothstep(0.35, 0.75, up) * smoothstep(-0.15, 0.25, patches)
    color = color + (srgb_to_linear(spec.moss_color) - color) * moss[:, None]
    roughness = 0.82 + 0.08 * moss
    orm = bake_channels(baked.texels, np.stack([baked.occlusion, roughness, np.zeros_like(roughness)], axis=1))
    return RockMesh(
        baked.mesh,
        baked.tangents,
        bake_base_color(baked.texels, np.clip(color, 0.0, 1.0)),
        bake_normal_map(baked.texels, baked.tangents, baked.detail_normals),
        orm,
    )


def _area(spec: RockSpec) -> float:
    x, y, z = spec.size
    return 2.0 * (x * y + y * z + x * z) * 0.8


ROCKS: tuple[RockSpec, ...] = (
    RockSpec("Rock_Boulder_A", size=(1.6, 1.1, 1.3), cuts=6, faces=1400, texture=512, moss=0.9),
    RockSpec("Rock_Boulder_B", size=(1.0, 1.4, 0.9), cuts=5, faces=1200, texture=512, moss=0.6),
    RockSpec("Rock_Slab", size=(2.2, 0.7, 1.5), cuts=7, faces=1400, texture=512, moss=1.0),
    RockSpec("Rock_Pebble", size=(0.22, 0.13, 0.17), cuts=4, faces=160, texture=128, moss=0.0, color=(0.66, 0.63, 0.58)),
)  # fmt: skip
