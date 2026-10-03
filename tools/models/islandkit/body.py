"""Baut den Inselkörper: Netz aus dem Distanzfeld, UV-Atlas und gebackene Texturen (Inselkörper).

Das Netz entsteht aus dem groben Feld (Oktaven bis zur doppelten Kantenlänge), die Normal-Map
aus dem vollen Feld — sie trägt Schichtkanten, Risse, Korn und Grasnarbe, die das Netz nicht
auflöst. Farbe und Rauheit kommen aus ``IslandPainter``, die Verdeckung aus Embree-Strahlen.

Detailstufen: LOD0 und LOD1 sind gebackene Körper mit eigenem Budget und eigener Texturgröße
(LOD1 ohne ORM-Textur; die Verdeckung steckt dort in der Farbe). LOD2 ist eine Silhouette aus
dem vereinfachten LOD1-Netz mit Vertexfarben, ganz ohne Texturen.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

import numpy as np
import numpy.typing as npt
from modelkit.baking import bake_base_color, bake_channels, bake_normal_map, bake_occlusion, rasterize_uv
from modelkit.geometry import ShadedMesh, TriangleMesh, area_weighted_normals
from modelkit.meshing import decimate_quadric, edge_length_for_budget, remesh_to_budget
from modelkit.sdf import Sdf
from modelkit.sdf_asset import SdfAssetBake, detail_normals, stopwatch
from modelkit.shading import bake_ambient_occlusion, smoothstep, srgb_to_linear
from modelkit.uv import UnwrappedMesh, UvOptions, unwrap

from islandkit.spec import MAX_BODY_FACES, IslandSpec
from islandkit.surface import IslandPainter, IslandPalette, PatchTint
from islandkit.terrain import IslandTerrain, TerrainPlan, TerrainSample

type FloatArray = npt.NDArray[np.float64]
type IndexArray = npt.NDArray[np.int64]
type ByteImage = npt.NDArray[np.uint8]

_CHUNK = 1_000_000  # Texel je Auswertungsblock der Geländemerkmale
WATER_COLOR = (0.09, 0.27, 0.29)  # sRGB, tiefes Grünblau (Teich und Bach)


@dataclass(frozen=True, slots=True)
class BodyTextures:
    """Gebackene Texturen des Inselkörpers: Basisfarbe (sRGB), Normal-Map, ORM (halbe Größe ab 4096²; ``None`` ohne ORM)."""

    color: ByteImage
    normal: ByteImage
    orm: ByteImage | None


@dataclass(frozen=True, slots=True)
class IslandBody:
    """Fertiger Inselkörper (Inselkörper): abgewickeltes Netz, Tangenten, Texturen, Felder.

    ``terrain`` ist das volle Feld (Texturen), ``mesh_terrain`` das grobe Feld, auf dem das Netz
    liegt (Platzierung, Wurzeln, Kollision). ``triangles`` ist das geschlossene Netz vor der
    Abwicklung (Verdecker, Vereinfachung).
    """

    mesh: UnwrappedMesh
    tangents: FloatArray
    textures: BodyTextures
    terrain: IslandTerrain
    mesh_terrain: IslandTerrain
    triangles: TriangleMesh
    timings: dict[str, float] = field(default_factory=dict)

    @property
    def occluder(self) -> TriangleMesh:
        """Geometrie des Körpers für Strahltests (Verdeckung, Platzierung)."""
        return self.triangles

    @property
    def roughness(self) -> float:
        """Rauheitsfaktor des Materials: 1 mit ORM-Textur, sonst der mittlere Wert des Körpers."""
        return 1.0 if self.textures.orm is not None else 0.9


@dataclass(frozen=True, slots=True)
class SilhouetteMesh:
    """Fernste Detailstufe (Silhouette): Netz mit Normalen und linearen Vertexfarben."""

    vertices: FloatArray
    normals: FloatArray
    faces: IndexArray
    colors: FloatArray


def build_body(
    spec: IslandSpec,
    plan: TerrainPlan,
    *,
    face_budget: int | None = None,
    texture_size: int | None = None,
    palette: IslandPalette | None = None,
    tints: Sequence[PatchTint] = (),
    with_orm: bool = True,
    ao_rays: int = 48,
) -> IslandBody:
    """Erzeugt Netz und Texturen des Inselkörpers nach Steckbrief und Plan.

    ``face_budget``/``texture_size`` ersetzen die Werte des Steckbriefs (Detailstufen, Proben);
    ohne ``with_orm`` liegt die Verdeckung in der Basisfarbe und die Rauheit im Material.
    Das Netz bleibt in jeder Stufe unter ``MAX_BODY_FACES`` Dreiecken.
    """
    dims = spec.dimensions
    budget = face_budget or spec.face_budget
    size = texture_size or spec.texture_size
    edge = edge_length_for_budget(dims.texture_area, budget)
    full = IslandTerrain(spec, plan, min_wavelength=0.0)
    coarse = full.with_detail(2.0 * edge)
    baked = _bake_capped(full, coarse, budget, MAX_BODY_FACES, size, ao_rays=ao_rays, ao_distance=0.08 * dims.radius)
    timings = dict(baked.timings)
    texels = baked.texels
    with stopwatch("surface", timings):
        sample = _sample_texels(full, texels.positions)
        painter = IslandPainter(full, palette, tints)
        painted = painter.paint(texels.positions, baked.detail_normals, sample, baked.occlusion)
        color = painted.color if with_orm else painted.color * (0.62 + 0.38 * baked.occlusion)[:, None]
    with stopwatch("encode", timings):
        orm = None
        if with_orm:
            channels = bake_channels(texels, np.stack([baked.occlusion, painted.roughness, np.zeros(texels.count)], axis=1))
            orm = _downsample(channels) if size >= 4096 else channels
        textures = BodyTextures(
            color=bake_base_color(texels, color),
            normal=bake_normal_map(texels, baked.tangents, baked.detail_normals),
            orm=orm,
        )
    return IslandBody(baked.mesh, baked.tangents, textures, full, coarse, baked.triangles, timings)


def _bake_capped(
    fine: Sdf, coarse: Sdf, budget: int, cap: int, size: int, *, ao_rays: int, ao_distance: float
) -> SdfAssetBake:
    """Backablauf eines Feldmodells mit harter Obergrenze der Dreiecke.

    Das isotrope Remeshing trifft das Budget nur ungefähr (einige Prozent darüber); liegt das
    Netz über ``cap``, vereinfacht QEM es auf knapp darunter und schiebt die Eckpunkte zurück auf
    das grobe Feld. Danach wie ``modelkit.sdf_asset.bake_sdf_asset``: Abwicklung, Texelkarte,
    Verdeckung, Detailnormalen aus dem feinen Feld.
    """
    timings: dict[str, float] = {}
    with stopwatch("mesh", timings):
        triangles = remesh_to_budget(coarse, budget, voxel_divisor=2.0)
        if len(triangles.faces) > cap:
            reduced = decimate_quadric(triangles, int(0.99 * cap))
            triangles = TriangleMesh(coarse.project_to_surface(reduced.vertices), reduced.faces)
        normals = area_weighted_normals(triangles.vertices, triangles.faces)
    with stopwatch("unwrap", timings):
        mesh = unwrap(ShadedMesh(triangles.vertices, normals, triangles.faces), UvOptions(size, padding=max(4, size // 512)))
        tangents = mesh.tangents()
        texels = rasterize_uv(mesh, size)
    with stopwatch("occlusion", timings):
        occlusion = bake_occlusion(texels, triangles, ao_rays, max_distance=ao_distance)
    with stopwatch("normals", timings):
        texel_size = float(np.sqrt(triangles.surface_area() / max(texels.count, 1)))
        normals_hi = detail_normals(fine, texels.positions, step=0.5 * texel_size)
    return SdfAssetBake(mesh, tangents, texels, normals_hi, occlusion, triangles, timings)


def build_silhouette(body: IslandBody, face_budget: int, tints: Sequence[PatchTint] = ()) -> SilhouetteMesh:
    """Vereinfacht das Körpernetz auf ``face_budget`` Dreiecke und färbt die Eckpunkte (grobe Farben).

    Eckpunkte im Teich- oder Bachbett unter dem Wasserspiegel bekommen die Wasserfarbe — LOD2
    hat keine eigenen Wasserflächen.
    """
    reduced = decimate_quadric(body.triangles, face_budget)
    normals = area_weighted_normals(reduced.vertices, reduced.faces)
    terrain = body.mesh_terrain
    sample = terrain.sample(reduced.vertices)
    occlusion = bake_ambient_occlusion(
        reduced.vertices, normals, reduced, ray_count=32, max_distance=0.08 * terrain.dims.radius
    )
    painted = IslandPainter(body.terrain, None, tints).paint(reduced.vertices, normals, sample, occlusion)
    colors = painted.color * (0.62 + 0.38 * occlusion)[:, None]
    wet = _under_water(sample)
    colors = colors + (srgb_to_linear(WATER_COLOR)[None, :] - colors) * wet[:, None]
    return SilhouetteMesh(reduced.vertices, normals, reduced.faces, np.clip(colors, 0.0, 1.0))


def _under_water(sample: TerrainSample) -> FloatArray:
    """1 für Punkte im Teich- oder Bachbett unter dem Wasserspiegel."""
    bed = 1.0 - smoothstep(-0.1, 0.3, np.minimum(sample.pond, sample.stream))
    return bed * (1.0 - smoothstep(-0.05, 0.1, sample.waterline))


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
