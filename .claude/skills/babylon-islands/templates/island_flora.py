"""Erzeugt Pflanzen und Steine der schwebenden Inseln als einzelne glb-Dateien (Inselflora).

Brief: Teile für den Zusammenbau der Inseln (``sky_islands.py``) und für freie Platzierung im
Spiel. Laubbäume (2 Varianten), Blütenbaum, zwei Büsche — Astwerk mit kachelnder Borke,
Kronen aus Blattkarten (Alpha-Test). Drei Grasbüschel und fünf Blumenarten als Geometrie mit
Vertexfarben, stilisiert 1,6-fach vergrößert. Drei Felsbrocken und ein Kiesel mit gebackenen
Texturen. Maßstab Meter, +Y oben, Ursprung am Fuß. Budgets: Bäume 4.000–12.000 Dreiecke, Büsche
≤ 4.000, Gras 130–320, Blumen 270–1.800, Brocken ~1.400, Kiesel ~160.

Materialnamen sind über alle Teile eindeutig je Definition (``Flora_Plant``, ``Flora_Bark``,
``Flora_Leaves_<Atlas>``, ``Rock_<Name>``) — der Zusammenbau führt gleichnamige Materialien
zusammen. Dateien: ``.temp/models/flora/<teil>.glb``.
"""

from __future__ import annotations

import argparse
import time
from collections.abc import Callable
from pathlib import Path

import numpy as np
from islandkit import texturesets
from islandkit.foliage import build_foliage_atlas
from islandkit.plants import FLOWERS, GRASS_TUFTS, ColoredMesh, FlowerSpec, GrassTuftSpec, build_flower, build_grass_tuft
from islandkit.rocks import ROCKS, RockSpec, build_rock
from islandkit.trees import TREES, TreeSpec, build_tree
from modelkit.gltf_writer import GltfBuilder, MaterialSpec, PrimitiveData

DEFAULT_RAW_DIR = Path(__file__).resolve().parents[2] / ".temp" / "models"
FLORA_DIR = "flora"
FLOWER_SCALE = 1.6  # stilisierte Blüten: auf Inselmaßstab sichtbar
BARK_SEED = 21
FOLIAGE_SEED = 11
PLANT_MATERIAL = MaterialSpec("Flora_Plant", roughness=0.65, double_sided=True)


def part_file(name: str) -> str:
    """Dateiname eines Teils: ``Tree_Oak_A`` → ``tree-oak-a.glb``."""
    return name.lower().replace("_", "-") + ".glb"


def _write_colored(name: str, mesh: ColoredMesh, path: Path) -> None:
    builder = GltfBuilder("island_flora")
    builder.add_material(PLANT_MATERIAL)
    index = builder.add_mesh(name, [PrimitiveData(mesh.vertices, mesh.normals, mesh.faces, PLANT_MATERIAL.name, colors=mesh.colors)])
    builder.add_node(name, mesh=index)
    builder.write_glb(path)


class _TreeWriter:
    """Schreibt Gehölze; Borke und Blattatlanten entstehen einmal und werden in jedes glb eingebettet."""

    def __init__(self) -> None:
        self._bark = texturesets.bark(BARK_SEED)
        self._atlases = {name: build_foliage_atlas(name, FOLIAGE_SEED) for name in {spec.foliage for spec in TREES}}

    def write(self, spec: TreeSpec, seed: int, path: Path) -> int:
        tree = build_tree(spec, seed)
        builder = GltfBuilder("island_flora")
        bark_color = builder.add_texture("Flora_Bark_color", self._bark.color, wrap="repeat")
        bark_normal = builder.add_texture("Flora_Bark_normal", self._bark.normal, wrap="repeat")
        builder.add_material(MaterialSpec("Flora_Bark", roughness=self._bark.roughness, base_color_texture=bark_color, normal_texture=bark_normal))
        leaves = f"Flora_Leaves_{spec.foliage}"
        atlas = builder.add_texture(f"{leaves}_color", self._atlases[spec.foliage])
        builder.add_material(MaterialSpec(leaves, roughness=0.7, alpha_mode="MASK", alpha_cutoff=0.45, double_sided=True, base_color_texture=atlas))
        wood = tree.wood
        index = builder.add_mesh(
            spec.name,
            [
                PrimitiveData(wood.vertices, wood.normals, wood.faces, "Flora_Bark", uvs=wood.uvs, tangents=wood.tangents, colors=tree.wood_colors),
                PrimitiveData(tree.leaves_vertices, tree.leaves_normals, tree.leaves_faces, leaves, uvs=tree.leaves_uvs, colors=tree.leaves_colors),
            ],
        )
        builder.add_node(spec.name, mesh=index)
        builder.write_glb(path)
        return tree.triangle_count


def _write_rock(spec: RockSpec, seed: int, path: Path) -> int:
    rock = build_rock(spec, seed)
    builder = GltfBuilder("island_flora")
    color = builder.add_texture(f"{spec.name}_color", rock.color)
    normal = builder.add_texture(f"{spec.name}_normal", rock.normal)
    orm = builder.add_texture(f"{spec.name}_orm", rock.orm)
    builder.add_material(
        MaterialSpec(spec.name, metallic=1.0, roughness=1.0, base_color_texture=color, metallic_roughness_texture=orm, occlusion_texture=orm, normal_texture=normal)
    )
    mesh = rock.mesh
    index = builder.add_mesh(spec.name, [PrimitiveData(mesh.vertices, mesh.normals, mesh.faces, spec.name, uvs=mesh.uvs, tangents=rock.tangents)])
    builder.add_node(spec.name, mesh=index)
    builder.write_glb(path)
    return int(len(mesh.faces))


def _scaled(mesh: ColoredMesh, factor: float) -> ColoredMesh:
    return ColoredMesh(mesh.vertices * factor, mesh.normals, mesh.faces, mesh.colors)


def generate(raw_dir: Path, only: set[str] | None = None) -> list[Path]:
    """Schreibt alle (oder die gewählten) Teile und liefert die Pfade."""
    directory = raw_dir / FLORA_DIR
    directory.mkdir(parents=True, exist_ok=True)
    jobs: list[tuple[str, Callable[[Path], int]]] = []
    for index, grass in enumerate(GRASS_TUFTS):
        jobs.append((grass.name, lambda path, g=grass, i=index: _write_tuft(g, 100 + i, path)))
    for index, flower in enumerate(FLOWERS):
        jobs.append((flower.name, lambda path, f=flower, i=index: _write_flower(f, 200 + i, path)))
    trees = _TreeWriter() if only is None or any(spec.name in only for spec in TREES) else None
    for index, spec in enumerate(TREES):
        if trees is not None:
            jobs.append((spec.name, lambda path, s=spec, i=index, w=trees: w.write(s, 300 + i, path)))
    for index, rock in enumerate(ROCKS):
        jobs.append((rock.name, lambda path, r=rock, i=index: _write_rock(r, 400 + i, path)))
    paths = []
    for name, job in jobs:
        if only is not None and name not in only:
            continue
        start = time.perf_counter()
        path = directory / part_file(name)
        triangles = job(path)
        print(f"{path.name}: {triangles} Dreiecke, {time.perf_counter() - start:.1f} s")
        paths.append(path)
    return paths


def _write_tuft(spec: GrassTuftSpec, seed: int, path: Path) -> int:
    mesh = build_grass_tuft(spec, seed)
    _write_colored(spec.name, mesh, path)
    return mesh.triangle_count


def _write_flower(spec: FlowerSpec, seed: int, path: Path) -> int:
    mesh = _scaled(build_flower(spec, seed), FLOWER_SCALE)
    _write_colored(spec.name, mesh, path)
    return mesh.triangle_count


def write_catalog(paths: list[Path], target: Path) -> None:
    """Stellt alle Teile nebeneinander in ein glb (nur zur Begutachtung im Model Lab)."""
    builder = GltfBuilder("island_flora")
    builder.add_node("Catalog")
    x = 0.0
    for path in paths:
        mesh = builder.import_glb_mesh(path)
        width = 6.5 if "tree" in path.stem else 2.6 if "bush" in path.stem or "rock" in path.stem else 0.7
        builder.add_node(path.stem, parent="Catalog", mesh=mesh, translation=[x + 0.5 * width, 0.0, 0.0])
        x += width
    builder.write_glb(target)


def build(raw_dir: Path) -> list[Path]:
    """Schnittstelle für ``build_all.py``."""
    return generate(raw_dir)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_RAW_DIR)
    parser.add_argument("--only", nargs="*", help="Nur diese Teile (z. B. Tree_Oak_A Flower_Poppy)")
    parser.add_argument("--catalog", action="store_true", help="Zusätzlich flora-catalog.glb zur Begutachtung schreiben")
    arguments = parser.parse_args()
    paths = generate(arguments.output_dir, set(arguments.only) if arguments.only else None)
    if arguments.catalog:
        write_catalog(paths, arguments.output_dir / "flora-catalog.glb")


if __name__ == "__main__":
    main()
