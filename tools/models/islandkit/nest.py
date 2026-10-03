"""Madenhügel der Fliegennester: schleimige Hügel aus Kokons und Maden (Madenhügel).

Grundform ist ein flacher, klumpiger Hügel, auf dem gestreckte, geringelte Maden und Kokons
liegen — weich verschmolzen, damit der Hügel feucht und zäh wirkt. Farben: dunkles Violett mit
giftgrünem, glänzendem Schleim in Mulden und Fugen, fahle violettgraue Maden mit dunklen Ringen.
Gebacken wie die Felsbrocken (Farbe, Normal-Map, ORM). Ursprung mittig am Boden (y = 0); der
untere Teil des Hügels steckt im Boden.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import numpy.typing as npt
from modelkit.baking import bake_base_color, bake_channels, bake_normal_map
from modelkit.noise import Fractal
from modelkit.sdf import Aabb, Sdf, smooth_min
from modelkit.sdf_asset import bake_sdf_asset
from modelkit.shading import smoothstep, srgb_to_linear
from modelkit.uv import UnwrappedMesh

type FloatArray = npt.NDArray[np.float64]
type ByteImage = npt.NDArray[np.uint8]
type Srgb = tuple[float, float, float]


@dataclass(frozen=True, slots=True)
class MoundSpec:
    """Madenhügel (Madenhügel): Maße in m (Breite, Höhe, Tiefe), Madenzahl, Dreiecke, Texturgröße, Farben (sRGB)."""

    name: str
    size: tuple[float, float, float]
    larvae: int
    faces: int
    texture: int
    base_color: Srgb = (0.17, 0.07, 0.17)
    larva_color: Srgb = (0.50, 0.42, 0.50)
    slime_color: Srgb = (0.40, 0.74, 0.06)


@dataclass(frozen=True, slots=True)
class _Larva:
    """Eine Made bzw. ein Kokon: Mitte, Achse, Halblänge, Radius, Ringzahl."""

    center: FloatArray
    axis: FloatArray
    half_length: float
    radius: float
    rings: int


@dataclass(frozen=True)
class MoundField(Sdf):
    """Distanzfeld eines Madenhügels (Hügelfeld); ``min_wavelength`` begrenzt die Rauschoktaven."""

    spec: MoundSpec
    seed: int
    min_wavelength: float = 0.0
    _larvae: tuple[_Larva, ...] = field(init=False, repr=False)
    _lumps: Fractal = field(init=False, repr=False)

    def __post_init__(self) -> None:
        rng = np.random.default_rng(self.seed)
        object.__setattr__(self, "_lumps", Fractal(self.seed + 1, 2.4 / max(self.spec.size), octaves=5))
        object.__setattr__(self, "_larvae", tuple(self._place_larvae(rng)))

    @property
    def _radii(self) -> FloatArray:
        width, height, depth = self.spec.size
        return np.array([0.5 * width, 0.78 * height, 0.5 * depth])

    @property
    def _center(self) -> FloatArray:
        return np.array([0.0, 0.08 * self.spec.size[1], 0.0])

    def _place_larvae(self, rng: np.random.Generator) -> list[_Larva]:
        """Maden liegen tangential auf der oberen Hügelhälfte, halb eingesunken."""
        larvae = []
        scale = float(np.mean(self.spec.size))
        for _ in range(self.spec.larvae):
            direction = rng.normal(size=3)
            direction[1] = abs(direction[1]) + 0.35
            direction /= np.linalg.norm(direction)
            surface = self._center + direction * self._radii
            normal = direction / self._radii
            normal /= np.linalg.norm(normal)
            tangent = np.cross(normal, rng.normal(size=3))
            tangent /= np.linalg.norm(tangent)
            radius = scale * rng.uniform(0.045, 0.075)
            larvae.append(
                _Larva(surface + normal * 0.35 * radius, tangent, radius * rng.uniform(2.2, 3.4), radius, int(rng.integers(5, 9)))
            )
        return larvae

    def with_detail(self, min_wavelength: float) -> MoundField:
        return MoundField(self.spec, self.seed, min_wavelength)

    def base_distance(self, points: FloatArray) -> FloatArray:
        """Abstand zum klumpigen Grundhügel."""
        local = (points - self._center) / self._radii
        k0 = np.linalg.norm(local, axis=1)
        k1 = np.linalg.norm(local / self._radii, axis=1)
        ellipsoid = k0 * (k0 - 1.0) / np.maximum(k1, 1e-12)
        return ellipsoid - 0.07 * max(self.spec.size) * self._lumps(points, self.min_wavelength)

    def larva_distance(self, points: FloatArray) -> tuple[FloatArray, FloatArray]:
        """Abstand zur nächsten Made und deren Ringphase (0…1) am Punkt."""
        best = np.full(len(points), np.inf)
        phase = np.zeros(len(points))
        for larva in self._larvae:
            offset = points - larva.center
            along = offset @ larva.axis
            s = np.clip(along / larva.half_length, -1.0, 1.0)
            radial = np.linalg.norm(offset - along[:, None] * larva.axis[None, :], axis=1)
            profile = larva.radius * np.sqrt(np.clip(1.0 - s * s, 0.0, 1.0)) ** 0.8
            ring = 0.5 + 0.5 * np.cos(np.pi * larva.rings * s)
            distance = np.hypot(np.maximum(np.abs(along) - larva.half_length, 0.0), radial) - profile * (1.0 - 0.14 * ring)
            closer = distance < best
            best = np.where(closer, distance, best)
            phase = np.where(closer, ring, phase)
        return best, phase

    def distance(self, points: FloatArray) -> FloatArray:
        larva, _ = self.larva_distance(points)
        return smooth_min(self.base_distance(points), larva, 0.05 * float(np.mean(self.spec.size)))

    def bounds(self) -> Aabb:
        reach = self._radii + 0.25 * max(self.spec.size)
        return Aabb(self._center - reach, self._center + reach)


@dataclass(frozen=True, slots=True)
class MoundMesh:
    """Fertiger Madenhügel (Hügelnetz): Netz mit UVs, Tangenten und Texturen."""

    mesh: UnwrappedMesh
    tangents: FloatArray
    color: ByteImage
    normal: ByteImage
    orm: ByteImage


def build_mound(spec: MoundSpec, seed: int) -> MoundMesh:
    """Vernetzt, wickelt ab und bemalt einen Madenhügel."""
    fine = MoundField(spec, seed)
    area = 2.6 * spec.size[0] * spec.size[2]
    edge = float(np.sqrt(4.0 * area / (np.sqrt(3.0) * spec.faces)))
    baked = bake_sdf_asset(fine, fine.with_detail(2.0 * edge), spec.faces, spec.texture, ao_rays=32, ao_distance=0.3 * max(spec.size))
    points = baked.texels.positions
    larva, ring = fine.larva_distance(points)
    base = fine.base_distance(points)
    on_larva = 1.0 - smoothstep(-0.01, 0.03, larva - base)
    mottle = Fractal(seed + 5, 6.0 / max(spec.size), octaves=4)(points)
    color = srgb_to_linear(spec.base_color)[None, :] * (0.75 + 0.5 * smoothstep(-0.4, 0.4, mottle))[:, None]
    pale = srgb_to_linear(spec.larva_color)[None, :] * (1.0 - 0.35 * ring)[:, None]
    color = color + (pale - color) * on_larva[:, None]
    # Schleim sammelt sich in Mulden und Fugen (geringe Verdeckung) und läuft in Flecken über den Hügel
    streaks = Fractal(seed + 6, 9.0 / max(spec.size), octaves=3)(points * np.array([1.0, 0.35, 1.0]))
    slime = np.clip((1.0 - smoothstep(0.55, 0.85, baked.occlusion)) + smoothstep(0.25, 0.5, streaks) * 0.8, 0.0, 1.0)
    slime *= 1.0 - 0.6 * on_larva
    color = color + (srgb_to_linear(spec.slime_color) - color) * (0.85 * slime)[:, None]
    color *= (0.7 + 0.3 * baked.occlusion)[:, None]
    roughness = 0.55 - 0.15 * on_larva - 0.38 * slime
    orm = bake_channels(baked.texels, np.stack([baked.occlusion, np.clip(roughness, 0.08, 1.0), np.zeros_like(roughness)], axis=1))
    return MoundMesh(
        baked.mesh,
        baked.tangents,
        bake_base_color(baked.texels, np.clip(color, 0.0, 1.0)),
        bake_normal_map(baked.texels, baked.tangents, baked.detail_normals),
        orm,
    )


MOUNDS: tuple[MoundSpec, ...] = (
    MoundSpec("Nest_Mound_A", size=(2.8, 1.5, 2.4), larvae=22, faces=2600, texture=512),
    MoundSpec("Nest_Mound_B", size=(1.5, 0.95, 1.3), larvae=12, faces=1400, texture=256),
)
