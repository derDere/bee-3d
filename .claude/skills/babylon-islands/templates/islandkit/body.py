"""Baut den Inselkörper: Netz aus dem Distanzfeld, UV-Atlas und gebackene Texturen (Inselkörper).

Das Netz entsteht aus dem groben Feld (Oktaven bis zur doppelten Kantenlänge), die Normal-Map
aus dem vollen Feld — sie trägt Schichtkanten, Risse, Korn und Grasnarbe, die das Netz nicht
auflöst. Farbe und Rauheit kommen aus ``IslandPainter``, die Verdeckung aus Embree-Strahlen.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import numpy.typing as npt
from modelkit.baking import bake_base_color, bake_channels, bake_normal_map
from modelkit.geometry import TriangleMesh
from modelkit.meshing import edge_length_for_budget
from modelkit.sdf_asset import bake_sdf_asset, stopwatch
from modelkit.uv import UnwrappedMesh

from islandkit.spec import IslandSpec
from islandkit.surface import IslandPainter, IslandPalette
from islandkit.terrain import IslandTerrain, TerrainPlan, TerrainSample

type FloatArray = npt.NDArray[np.float64]
type ByteImage = npt.NDArray[np.uint8]

_CHUNK = 1_000_000  # Texel je Auswertungsblock der Geländemerkmale


@dataclass(frozen=True, slots=True)
class BodyTextures:
    """Gebackene Texturen des Inselkörpers: Basisfarbe (sRGB), Normal-Map, ORM (halbe Größe ab 4096²)."""

    color: ByteImage
    normal: ByteImage
    orm: ByteImage


@dataclass(frozen=True, slots=True)
class IslandBody:
    """Fertiger Inselkörper (Inselkörper): abgewickeltes Netz, Tangenten, Texturen, Felder.

    ``terrain`` ist das volle Feld (Texturen), ``mesh_terrain`` das grobe Feld, auf dem das Netz
    liegt (Platzierung, Wurzeln).
    """

    mesh: UnwrappedMesh
    tangents: FloatArray
    textures: BodyTextures
    terrain: IslandTerrain
    mesh_terrain: IslandTerrain
    timings: dict[str, float] = field(default_factory=dict)

    @property
    def occluder(self) -> TriangleMesh:
        """Geometrie des Körpers für Strahltests (Verdeckung, Platzierung)."""
        return TriangleMesh(self.mesh.vertices, self.mesh.faces)


def build_body(
    spec: IslandSpec,
    plan: TerrainPlan,
    *,
    texture_size: int | None = None,
    palette: IslandPalette | None = None,
    ao_rays: int = 48,
) -> IslandBody:
    """Erzeugt Netz und Texturen des Inselkörpers nach Steckbrief und Plan."""
    dims = spec.dimensions
    size = texture_size or dims.texture_size(spec.texel_size, spec.max_texture)
    edge = edge_length_for_budget(dims.texture_area, spec.face_budget)
    full = IslandTerrain(spec, plan, min_wavelength=0.0)
    coarse = full.with_detail(2.0 * edge)
    baked = bake_sdf_asset(full, coarse, spec.face_budget, size, ao_rays=ao_rays, ao_distance=0.08 * dims.radius)
    timings = dict(baked.timings)
    texels = baked.texels
    with stopwatch("surface", timings):
        sample = _sample_texels(full, texels.positions)
        painted = IslandPainter(full, palette).paint(texels.positions, baked.detail_normals, sample, baked.occlusion)
    with stopwatch("encode", timings):
        orm = bake_channels(texels, np.stack([baked.occlusion, painted.roughness, np.zeros(texels.count)], axis=1))
        textures = BodyTextures(
            color=bake_base_color(texels, painted.color),
            normal=bake_normal_map(texels, baked.tangents, baked.detail_normals),
            orm=_downsample(orm) if size >= 4096 else orm,
        )
    return IslandBody(baked.mesh, baked.tangents, textures, full, coarse, timings)


def _sample_texels(terrain: IslandTerrain, points: FloatArray) -> TerrainSample:
    """Geländemerkmale blockweise (begrenzt den RAM-Bedarf bei 4096²-Texturen)."""
    samples = [terrain.sample(points[start : start + _CHUNK]) for start in range(0, len(points), _CHUNK)]
    names = TerrainSample.__dataclass_fields__
    return TerrainSample(**{name: np.concatenate([getattr(s, name) for s in samples]) for name in names})


def _downsample(image: ByteImage) -> ByteImage:
    """Halbiert die Kantenlänge per 2×2-Mittelung (für niederfrequente Kanäle wie AO und Rauheit)."""
    h, w, c = image.shape
    blocks = image.reshape(h // 2, 2, w // 2, 2, c).astype(np.float64).mean(axis=(1, 3))
    return np.round(blocks).astype(np.uint8)
