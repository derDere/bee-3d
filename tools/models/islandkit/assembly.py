"""Setzt eine Insel aus fertigen Teilen zu glb-Dateien zusammen, je Detailstufe eine (Inselzusammenbau).

Körper, Wurzeln und Wasser entstehen im Inselgenerator; Bäume, Büsche, Gras, Blumen und Steine
sind eigene glb-Dateien (``flora``-Generator) und werden hier übernommen. In LOD0 liegt
Massenware als ``EXT_mesh_gpu_instancing`` in Kacheln (Frustum Culling je Kachel), jedes
Blumenfeld als eigener instanzierter Knoten. LOD1 und LOD2 enthalten nur einfache Meshes ohne
Instanzierung — das Spiel vervielfältigt sie selbst je Inselvariante.

Knotenbaum LOD0::

    Island_<Name>
      Terrain, Roots
      Water: Pond, Stream, Waterfall, WaterfallMist
      Flora: <Teil>_<Kachel> …, FlowerPatch_<n> …

LOD1: ``Island_<Name>`` → ``Terrain``, ``Detail`` (vereinfachte Bäume, Büsche, Brocken,
Wurzeln mit Vertexfarben), ``Water`` (``Pond``, ``Stream``, ``Waterfall``).
LOD2: ``Island_<Name>`` → ``Silhouette`` (Körper und Kronen mit Vertexfarben).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import numpy.typing as npt
from modelkit.gltf_writer import GltfBuilder, InstanceSet, MaterialSpec, PrimitiveData
from modelkit.shading import srgb_to_linear
from modelkit.sweep import SweptMesh

from islandkit.body import WATER_COLOR, IslandBody, SilhouetteMesh
from islandkit.texturesets import TextureSet
from islandkit.water import WaterMesh, WaterTextures

type FloatArray = npt.NDArray[np.float64]
type IndexArray = npt.NDArray[np.int64]


@dataclass(frozen=True, slots=True)
class PartPlacement:
    """Platzierungen eines Teils (Teilplatzierung): Quell-glb, Instanzen, Kachelgröße in m (0 = eine Kachel).

    ``exact_name`` übernimmt ``name`` unverändert als Knotennamen (Blumenfelder), sonst entsteht
    er aus Teil und Kachel (``<Teil>_<x>_<z>`` bzw. ``<Teil>_all``).
    """

    name: str
    source: Path
    instances: InstanceSet
    tile_size: float = 0.0
    exact_name: bool = False


@dataclass(frozen=True, slots=True)
class IslandWater:
    """Wasserflächen einer Insel (Inselwasser); fehlende Teile sind ``None``."""

    textures: WaterTextures
    pond: WaterMesh | None = None
    stream: WaterMesh | None = None
    waterfall: WaterMesh | None = None
    mist: WaterMesh | None = None


@dataclass(frozen=True, slots=True)
class IslandParts:
    """Alles, was in das Insel-glb der Detailstufe 0 kommt (Inselteile)."""

    name: str
    body: IslandBody
    water: IslandWater
    roots: SweptMesh | None = None
    root_texture: TextureSet | None = None
    placements: Sequence[PartPlacement] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class VertexColoredMesh:
    """Netz mit Normalen und linearen Vertexfarben (vertexfarbiges Netz), z. B. vereinfachte Bäume."""

    vertices: FloatArray
    normals: FloatArray
    faces: IndexArray
    colors: FloatArray

    @staticmethod
    def concatenate(meshes: Sequence[VertexColoredMesh]) -> VertexColoredMesh:
        offsets = np.cumsum([0] + [len(mesh.vertices) for mesh in meshes[:-1]])
        return VertexColoredMesh(
            np.concatenate([mesh.vertices for mesh in meshes]),
            np.concatenate([mesh.normals for mesh in meshes]),
            np.concatenate([mesh.faces + offset for mesh, offset in zip(meshes, offsets, strict=True)]),
            np.concatenate([mesh.colors for mesh in meshes]),
        )

    @property
    def triangle_count(self) -> int:
        return int(len(self.faces))


@dataclass(frozen=True, slots=True)
class LodParts:
    """Inhalt einer fernen Detailstufe (LOD1): Körper, vereinfachte Details, Wasser."""

    name: str
    body: IslandBody
    detail: VertexColoredMesh | None
    water: IslandWater


def write_island(parts: IslandParts, path: Path) -> None:
    """Schreibt das Insel-glb der Detailstufe 0."""
    builder = GltfBuilder("islandkit")
    root = f"Island_{parts.name}"
    builder.add_node(root)
    _add_body(builder, parts.body, root)
    if parts.roots is not None and parts.root_texture is not None:
        _add_roots(builder, parts.roots, parts.root_texture, root)
    _add_water(builder, parts.water, root)
    if parts.placements:
        builder.add_node("Flora", parent=root)
        meshes: dict[Path, int] = {}
        for placement in parts.placements:
            if placement.source not in meshes:
                meshes[placement.source] = builder.import_glb_mesh(placement.source)
            tiles = [("", placement.instances)] if placement.exact_name else _tiles(placement.instances, placement.tile_size)
            for tile, instances in tiles:
                name = placement.name if placement.exact_name else f"{placement.name}_{tile}"
                builder.add_instanced_node(name, parent="Flora", mesh=meshes[placement.source], instances=instances)
    builder.write_glb(path)


def write_island_lod1(parts: LodParts, path: Path) -> None:
    """Schreibt das Insel-glb der Detailstufe 1: Körper, vereinfachte Details, Wasser."""
    builder = GltfBuilder("islandkit")
    root = f"Island_{parts.name}"
    builder.add_node(root)
    _add_body(builder, parts.body, root)
    if parts.detail is not None and parts.detail.triangle_count:
        builder.add_material(MaterialSpec("Island_Detail", roughness=0.85))
        detail = parts.detail
        index = builder.add_mesh("Detail", [PrimitiveData(detail.vertices, detail.normals, detail.faces, "Island_Detail", colors=detail.colors)])
        builder.add_node("Detail", parent=root, mesh=index)
    _add_water(builder, parts.water, root)
    builder.write_glb(path)


def write_island_lod2(name: str, silhouette: SilhouetteMesh, path: Path) -> None:
    """Schreibt das Insel-glb der Detailstufe 2: ein Netz mit Vertexfarben, ohne Texturen."""
    builder = GltfBuilder("islandkit")
    root = f"Island_{name}"
    builder.add_node(root)
    builder.add_material(MaterialSpec("Island_Silhouette", roughness=0.9))
    index = builder.add_mesh(
        "Silhouette",
        [PrimitiveData(silhouette.vertices, silhouette.normals, silhouette.faces, "Island_Silhouette", colors=silhouette.colors)],
    )
    builder.add_node("Silhouette", parent=root, mesh=index)
    builder.write_glb(path)


def _add_body(builder: GltfBuilder, body: IslandBody, parent: str) -> None:
    textures = body.textures
    color = builder.add_texture("Island_Body_color", textures.color)
    normal = builder.add_texture("Island_Body_normal", textures.normal)
    orm = builder.add_texture("Island_Body_orm", textures.orm) if textures.orm is not None else None
    builder.add_material(
        MaterialSpec(
            "Island_Body",
            metallic=1.0 if orm is not None else 0.0,
            roughness=body.roughness,
            base_color_texture=color,
            metallic_roughness_texture=orm,
            occlusion_texture=orm,
            normal_texture=normal,
        )
    )
    mesh = body.mesh
    index = builder.add_mesh(
        "Terrain",
        [PrimitiveData(mesh.vertices, mesh.normals, mesh.faces, "Island_Body", uvs=mesh.uvs, tangents=body.tangents)],
    )
    builder.add_node("Terrain", parent=parent, mesh=index)


def _add_roots(builder: GltfBuilder, roots: SweptMesh, texture: TextureSet, parent: str) -> None:
    color = builder.add_texture("Island_Root_color", texture.color, wrap="repeat")
    normal = builder.add_texture("Island_Root_normal", texture.normal, wrap="repeat")
    builder.add_material(
        MaterialSpec("Island_Root", roughness=texture.roughness, base_color_texture=color, normal_texture=normal)
    )
    # Ansatz im Erdband dunkler, Spitzen heller und trockener
    shade = 0.55 + 0.45 * np.clip(roots.along, 0.0, 1.0) ** 0.7
    index = builder.add_mesh(
        "Roots",
        [
            PrimitiveData(
                roots.vertices, roots.normals, roots.faces, "Island_Root",
                uvs=roots.uvs, tangents=roots.tangents, colors=np.repeat(shade[:, None], 3, axis=1),
            )
        ],  # fmt: skip
    )
    builder.add_node("Roots", parent=parent, mesh=index)


def _add_water(builder: GltfBuilder, water: IslandWater, parent: str) -> None:
    if all(mesh is None for mesh in (water.pond, water.stream, water.waterfall)):
        return
    builder.add_node("Water", parent=parent)
    ripple = builder.add_texture("Island_Water_normal", water.textures.ripple_normal, wrap="repeat")
    tint = (*srgb_to_linear(WATER_COLOR), 1.0)
    # Teich und Bach unterscheiden sich in den Werten: gltf-transform optimize führt gleiche
    # Materialien zusammen, das Spiel lässt aber nur den Bach fließen
    if water.pond is not None:
        builder.add_material(
            MaterialSpec("Island_Pond", base_color=tint, roughness=0.05, alpha_mode="BLEND", normal_texture=ripple, normal_scale=0.5)
        )
    if water.stream is not None:
        builder.add_material(
            MaterialSpec("Island_Stream", base_color=tint, roughness=0.09, alpha_mode="BLEND", normal_texture=ripple, normal_scale=0.8)
        )
    if water.waterfall is not None:
        fall_color = builder.add_texture("Island_Waterfall_color", water.textures.fall_color, wrap="repeat")
        fall_normal = builder.add_texture("Island_Waterfall_normal", water.textures.fall_normal, wrap="repeat")
        builder.add_material(
            MaterialSpec(
                "Island_Waterfall",
                roughness=0.2,
                alpha_mode="BLEND",
                double_sided=True,
                base_color_texture=fall_color,
                normal_texture=fall_normal,
                normal_scale=0.5,
            )
        )
    for node, mesh, material in (
        ("Pond", water.pond, "Island_Pond"),
        ("Stream", water.stream, "Island_Stream"),
        ("Waterfall", water.waterfall, "Island_Waterfall"),
        ("WaterfallMist", water.mist, "Island_Waterfall"),
    ):
        if mesh is None:
            continue
        index = builder.add_mesh(
            node,
            [PrimitiveData(mesh.vertices, mesh.normals, mesh.faces, material, uvs=mesh.uvs, tangents=mesh.tangents, colors=mesh.colors)],
        )
        extras = {"flow": {"speed": round(mesh.flow_speed, 4), "material": material}} if mesh.flow_speed else None
        builder.add_node(node, parent="Water", mesh=index, extras=extras)


def _tiles(instances: InstanceSet, tile_size: float) -> list[tuple[str, InstanceSet]]:
    """Teilt Instanzen in quadratische Kacheln; Reihenfolge je Kachel bleibt erhalten."""
    if tile_size <= 0.0:
        return [("all", instances)]
    keys = np.floor(instances.translations[:, [0, 2]] / tile_size).astype(int)
    tiles = []
    for key in np.unique(keys, axis=0):
        mask = np.all(keys == key, axis=1)
        tiles.append((f"{key[0]}_{key[1]}".replace("-", "m"), instances.subset(mask)))
    return tiles
