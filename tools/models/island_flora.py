"""Erzeugt Pflanzen, Pilze, Steine und Madenhügel der schwebenden Inseln als einzelne glb-Dateien (Inselflora).

Brief: Teile für den Zusammenbau der Inseln (``sky_islands.py``) und für freie Platzierung im
Spiel, alle in realistischer Größe zur 0,2 m langen Biene. Laubbäume (Eichen 11 und 13 m,
Blütenbaum 7,5 m), Nadelbäume (15 und 10,5 m) mit Astquirlen, zwei Büsche — Astwerk mit
kachelnder Borke, Kronen aus Blattkarten (Alpha-Test). Tote Bäume (9 und 6 m) mit kahlem,
knorrigem Astwerk aus Totholz. Vier Grasbüschel (eines verdorrt) und fünf Blumenarten
(0,25–0,55 m) als Geometrie mit Vertexfarben, stilisiert 1,6-fach vergrößert. Seerosenblatt und
Seerose mit Blüte für Teiche. Pilzgruppen und Riesenpilze, zwei Madenhügel und vier Felsbrocken
mit gebackenen Texturen. Maßstab Meter, +Y oben, Ursprung am Fuß (Seerosen auf dem
Wasserspiegel, Brocken bei 25 % ihrer Höhe). Budgets: Bäume 4.000–12.000 Dreiecke, Büsche
≤ 4.000, Gras 130–320, Blumen 270–1.800, Brocken ~1.400, Kiesel ~160, Madenhügel ≤ 2.600.

Blüten leuchten nachts: Jede Blumenart und die Seerose tragen ihre Blüten in einer eigenen
Primitive mit dem Material ``Flora_Blossom_<Art>`` (Vertexfarben, ``emissiveTexture`` =
Blütenblatt-Maske × Blütenfarbe, ``emissiveFactor`` (0, 0, 0)). Das Spiel hebt nachts die
Emissive-Farbe dieser Materialien an; Stängel und Blätter (``Flora_Plant``) leuchten nicht.

Materialnamen sind über alle Teile eindeutig je Definition (``Flora_Plant``, ``Flora_Bark``,
``Flora_Bark_Dead``, ``Flora_Leaves_<Atlas>``, ``Flora_Blossom_<Art>``, ``Rock_<Name>``,
``Nest_Mound_<Variante>``) — der Zusammenbau führt gleichnamige Materialien zusammen. Dateien:
``.temp/models/flora/<teil>.glb``.
"""

from __future__ import annotations

import argparse
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np
import numpy.typing as npt
import pygltflib
from islandkit import texturesets
from islandkit.blossoms import BlossomGlow, build_glow_texture
from islandkit.foliage import build_foliage_atlas
from islandkit.nest import MOUNDS, MoundSpec, build_mound
from islandkit.plants import (
    FLOWERS,
    GRASS_TUFTS,
    LILY,
    LILY_MATERIAL,
    LILY_PETALS,
    MUSHROOMS,
    BloomingPlant,
    ColoredMesh,
    FlowerSpec,
    build_flower,
    build_grass_tuft,
    build_lily_flower,
    build_lily_pad,
    build_mushrooms,
)
from islandkit.rocks import ROCKS, build_rock
from islandkit.trees import CONIFERS, TREES, ConiferSpec, TreeMesh, TreeSpec, build_conifer, build_tree
from modelkit.gltf_writer import GltfBuilder, MaterialSpec, PrimitiveData
from modelkit.uv import UnwrappedMesh

type FloatArray = npt.NDArray[np.float64]
type ByteImage = npt.NDArray[np.uint8]

DEFAULT_RAW_DIR = Path(__file__).resolve().parents[2] / ".temp" / "models"
FLORA_DIR = "flora"
FLOWER_SCALE = 1.6  # stilisierte Blüten: auf Inselmaßstab sichtbar
BARK_SEED = 21
FOLIAGE_SEED = 11
PLANT_MATERIAL = MaterialSpec("Flora_Plant", roughness=0.65, double_sided=True)
LILY_PAD = "Lily_Pad"
LILY_FLOWER = "Lily_Flower"


def part_file(name: str) -> str:
    """Dateiname eines Teils: ``Tree_Oak_A`` → ``tree-oak-a.glb``."""
    return name.lower().replace("_", "-") + ".glb"


@dataclass(frozen=True, slots=True)
class BlossomMaterial:
    """Blütenmaterial einer Art (Blütenmaterial): Name, Leuchtmaske, Rauheit."""

    name: str
    glow: BlossomGlow
    roughness: float = 0.55


def _flower_material(spec: FlowerSpec) -> BlossomMaterial:
    return BlossomMaterial(spec.material, BlossomGlow(spec.petals.colors, spec.center_colors, spec.center_glow))


LILY_BLOSSOM = BlossomMaterial(LILY_MATERIAL, BlossomGlow(LILY_PETALS.colors, LILY.center_colors, 0.9), roughness=0.5)


def _write_colored(name: str, mesh: ColoredMesh, path: Path) -> int:
    builder = GltfBuilder("island_flora")
    builder.add_material(PLANT_MATERIAL)
    index = builder.add_mesh(name, [PrimitiveData(mesh.vertices, mesh.normals, mesh.faces, PLANT_MATERIAL.name, colors=mesh.colors)])
    builder.add_node(name, mesh=index)
    builder.write_glb(path)
    return mesh.triangle_count


def _write_blooming(name: str, plant: BloomingPlant, blossom: BlossomMaterial, path: Path) -> int:
    """Schreibt eine Pflanze mit Grünteilen (``Flora_Plant``) und Blüten (``Flora_Blossom_<Art>``)."""
    builder = GltfBuilder("island_flora")
    builder.add_material(PLANT_MATERIAL)
    glow = builder.add_texture(f"{blossom.name}_emissive", build_glow_texture(blossom.glow))
    builder.add_material(
        MaterialSpec(blossom.name, roughness=blossom.roughness, double_sided=True, emissive=(0.0, 0.0, 0.0), emissive_texture=glow)
    )
    green, flowers = plant.plant, plant.blossom
    index = builder.add_mesh(
        name,
        [
            PrimitiveData(green.vertices, green.normals, green.faces, PLANT_MATERIAL.name, colors=green.colors),
            PrimitiveData(flowers.vertices, flowers.normals, flowers.faces, blossom.name, uvs=flowers.uvs, colors=flowers.colors),
        ],
    )
    builder.add_node(name, mesh=index)
    builder.write_glb(path)
    return plant.triangle_count


class _TreeWriter:
    """Schreibt Gehölze; Borken und Blattatlanten entstehen einmal und werden in jedes glb eingebettet."""

    def __init__(self) -> None:
        self._barks = {"Living": ("Flora_Bark", texturesets.bark(BARK_SEED)), "Dead": ("Flora_Bark_Dead", texturesets.dead_bark(BARK_SEED + 1))}
        foliage = {spec.foliage for spec in TREES if spec.foliage is not None} | {spec.foliage for spec in CONIFERS}
        self._atlases = {name: build_foliage_atlas(name, FOLIAGE_SEED) for name in sorted(foliage)}

    def write_tree(self, spec: TreeSpec, seed: int, path: Path) -> int:
        return self._write(spec.name, build_tree(spec, seed), spec.bark, spec.foliage, path)

    def write_conifer(self, spec: ConiferSpec, seed: int, path: Path) -> int:
        return self._write(spec.name, build_conifer(spec, seed), spec.bark, spec.foliage, path)

    def _write(self, name: str, tree: TreeMesh, bark_kind: str, foliage: str | None, path: Path) -> int:
        builder = GltfBuilder("island_flora")
        bark_name, bark = self._barks[bark_kind]
        bark_color = builder.add_texture(f"{bark_name}_color", bark.color, wrap="repeat")
        bark_normal = builder.add_texture(f"{bark_name}_normal", bark.normal, wrap="repeat")
        builder.add_material(MaterialSpec(bark_name, roughness=bark.roughness, base_color_texture=bark_color, normal_texture=bark_normal))
        wood = tree.wood
        primitives = [PrimitiveData(wood.vertices, wood.normals, wood.faces, bark_name, uvs=wood.uvs, tangents=wood.tangents, colors=tree.wood_colors)]
        if foliage is not None and tree.has_leaves:
            leaves = f"Flora_Leaves_{foliage}"
            atlas = builder.add_texture(f"{leaves}_color", self._atlases[foliage])
            builder.add_material(MaterialSpec(leaves, roughness=0.7, alpha_mode="MASK", alpha_cutoff=0.45, double_sided=True, base_color_texture=atlas))
            primitives.append(
                PrimitiveData(tree.leaves_vertices, tree.leaves_normals, tree.leaves_faces, leaves, uvs=tree.leaves_uvs, colors=tree.leaves_colors)
            )
        builder.add_node(name, mesh=builder.add_mesh(name, primitives))
        builder.write_glb(path)
        return tree.triangle_count


class BakedPart(Protocol):
    """Gebackenes Teil (gebackenes Teil): abgewickeltes Netz, Tangenten, Farbe, Normal-Map und ORM."""

    @property
    def mesh(self) -> UnwrappedMesh: ...

    @property
    def tangents(self) -> FloatArray: ...

    @property
    def color(self) -> ByteImage: ...

    @property
    def normal(self) -> ByteImage: ...

    @property
    def orm(self) -> ByteImage: ...


def _write_baked(name: str, part: BakedPart, path: Path) -> int:
    """Schreibt einen gebackenen Körper (Felsbrocken, Madenhügel) mit Farbe, Normal-Map und ORM."""
    builder = GltfBuilder("island_flora")
    color = builder.add_texture(f"{name}_color", part.color)
    normal = builder.add_texture(f"{name}_normal", part.normal)
    orm = builder.add_texture(f"{name}_orm", part.orm)
    builder.add_material(
        MaterialSpec(name, metallic=1.0, roughness=1.0, base_color_texture=color, metallic_roughness_texture=orm, occlusion_texture=orm, normal_texture=normal)
    )
    mesh = part.mesh
    index = builder.add_mesh(name, [PrimitiveData(mesh.vertices, mesh.normals, mesh.faces, name, uvs=mesh.uvs, tangents=part.tangents)])
    builder.add_node(name, mesh=index)
    builder.write_glb(path)
    return int(len(mesh.faces))


def _write_mound(spec: MoundSpec, seed: int, path: Path) -> int:
    return _write_baked(spec.name, build_mound(spec, seed), path)


def _jobs(trees: _TreeWriter | None) -> list[tuple[str, Callable[[Path], int]]]:
    """Alle Teile in Bau-Reihenfolge mit festen Seeds."""
    jobs: list[tuple[str, Callable[[Path], int]]] = []
    for index, grass in enumerate(GRASS_TUFTS):
        jobs.append((grass.name, lambda path, g=grass, i=index: _write_colored(g.name, build_grass_tuft(g, 100 + i), path)))
    for index, flower in enumerate(FLOWERS):
        jobs.append(
            (flower.name, lambda path, f=flower, i=index: _write_blooming(f.name, build_flower(f, 200 + i).scaled(FLOWER_SCALE), _flower_material(f), path))
        )
    jobs.append((LILY_PAD, lambda path: _write_colored(LILY_PAD, build_lily_pad(LILY, 250), path)))
    jobs.append((LILY_FLOWER, lambda path: _write_blooming(LILY_FLOWER, build_lily_flower(LILY, 251), LILY_BLOSSOM, path)))
    for index, mushroom in enumerate(MUSHROOMS):
        jobs.append((mushroom.name, lambda path, m=mushroom, i=index: _write_colored(m.name, build_mushrooms(m, 260 + i), path)))
    if trees is not None:
        for index, spec in enumerate(TREES):
            jobs.append((spec.name, lambda path, s=spec, i=index, w=trees: w.write_tree(s, 300 + i, path)))
        for index, conifer in enumerate(CONIFERS):
            jobs.append((conifer.name, lambda path, s=conifer, i=index, w=trees: w.write_conifer(s, 350 + i, path)))
    for index, rock in enumerate(ROCKS):
        jobs.append((rock.name, lambda path, r=rock, i=index: _write_baked(r.name, build_rock(r, 400 + i), path)))
    for index, mound in enumerate(MOUNDS):
        jobs.append((mound.name, lambda path, m=mound, i=index: _write_mound(m, 450 + i, path)))
    return jobs


def generate(raw_dir: Path, only: set[str] | None = None) -> list[Path]:
    """Schreibt alle (oder die gewählten) Teile und liefert die Pfade."""
    directory = raw_dir / FLORA_DIR
    directory.mkdir(parents=True, exist_ok=True)
    woody = {spec.name for spec in TREES} | {spec.name for spec in CONIFERS}
    trees = _TreeWriter() if only is None or woody & only else None
    paths = []
    for name, job in _jobs(trees):
        if only is not None and name not in only:
            continue
        start = time.perf_counter()
        path = directory / part_file(name)
        triangles = job(path)
        print(f"{path.name}: {triangles} Dreiecke, {time.perf_counter() - start:.1f} s", flush=True)
        paths.append(path)
    return paths


def write_catalogs(paths: list[Path], raw_dir: Path) -> list[Path]:
    """Stellt die Teile zur Begutachtung im Model Lab nebeneinander: Gehölze und Brocken, kleine Pflanzen.

    Die Kataloge bleiben in ``.temp/models/`` und werden nicht ausgeliefert.
    """
    large = [p for p in paths if p.stem.startswith(("tree", "bush", "rock", "nest"))]
    small = [p for p in paths if p not in large]
    written = []
    for label, group, gap in (("flora-catalog-large", large, 1.2), ("flora-catalog-small", small, 0.25)):
        if not group:
            continue
        builder = GltfBuilder("island_flora")
        builder.add_node("Catalog")
        x = 0.0
        for path in group:
            mesh = builder.import_glb_mesh(path)
            width = _footprint(path) + gap
            builder.add_node(path.stem, parent="Catalog", mesh=mesh, translation=[x + 0.5 * width, 0.0, 0.0])
            x += width
        target = raw_dir / f"{label}.glb"
        builder.write_glb(target)
        written.append(target)
    return written


def _footprint(path: Path) -> float:
    """Breite eines Teils in x und z (aus den Accessor-Grenzen des glb)."""
    document = pygltflib.GLTF2().load_binary(str(path))
    lower, upper = float("inf"), float("-inf")
    for mesh in document.meshes:
        for primitive in mesh.primitives:
            accessor = document.accessors[primitive.attributes.POSITION]
            lower = min(lower, accessor.min[0], accessor.min[2])
            upper = max(upper, accessor.max[0], accessor.max[2])
    return upper - lower


def build(raw_dir: Path) -> list[Path]:
    """Schnittstelle für ``build_all.py``."""
    return generate(raw_dir)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_RAW_DIR)
    parser.add_argument("--only", nargs="*", help="Nur diese Teile (z. B. Tree_Oak_A Flower_Poppy)")
    parser.add_argument("--catalog", action="store_true", help="Zusätzlich Kataloge zur Begutachtung schreiben")
    arguments = parser.parse_args()
    paths = generate(arguments.output_dir, set(arguments.only) if arguments.only else None)
    if arguments.catalog:
        for target in write_catalogs(paths, arguments.output_dir):
            print(f"Katalog: {target.relative_to(arguments.output_dir).as_posix()}")


if __name__ == "__main__":
    main()
