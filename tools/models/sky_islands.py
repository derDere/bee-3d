"""Erzeugt die schwebenden Inseln als glb in drei Detailstufen und schreibt den Inselkatalog (Schwebeinseln).

Brief: Fantasie-Inseln für die Spielwelt (640 Inseln aus 9 Varianten; das Spiel skaliert jede
Variante mit 0,6–1,6 und dreht sie, so entstehen 10–100 m Durchmesser). Oben eine Grasnarbe mit
sanften Hügeln, darunter ein Erdband mit hängenden Wurzeln, dann eine geschichtete Felswand,
die in mehrere hängende Spitzen ausläuft. Teiche mit Seerosen, Bäche mit Wasserfall. Texturen
gebacken (Basisfarbe, Normal-Map, ORM), ~5 cm je Texel, höchstens 1024², nur die zwei größten
Inseln 2048². Körper LOD0 ≤ 60.000 Dreiecke. Ursprung in der Mitte der Plateauoberfläche, +Y
oben. Die Bepflanzung setzt ``islandkit.planting`` aus den Teilen von ``island_flora.py``.

Statisch eingebaut (GPU-Instanzen in Kacheln): Gras, Deko-Blumen, Kiesel, Seerosen; als
Einzelknoten je Teil: Bäume, Büsche, Brocken, Madenhügel. Interaktiv sind die Blumenfelder:
je Feld ein eigener instanzierter Knoten ``FlowerPatch_<n>`` unter ``Flora`` (Sammelziel,
Index ``n`` wie im Katalog). Fließendes Wasser trägt ``extras.flow``.

Detailstufen je Insel (Kameradistanz): ``island-<name>.glb`` (LOD0, nah, volle Bepflanzung),
``island-<name>-lod1.glb`` (mittlere Entfernung: Körper ~15 % der Dreiecke, Texturen ≤ 512²,
Bäume und Büsche als vereinfachte Kronen, Wurzeln, Wasser, kein Gras),
``island-<name>-lod2.glb`` (2–7 km: Körper ~3 % mit Vertexfarben und einfachen Kronen, ohne
Texturen). Blumenfelder erscheinen in LOD1 und LOD2 als Farbflecken der Wiese.

Inseln in ``ISLANDS``:

- ``Tiny`` 14 m, Tiefe 0,72 D — kleine Wiesenkuppe mit einer Eiche, Büschen, einem Blumenfeld.
- ``Blossom`` 22 m — Blütenbaum als Solitär, Blütenbüsche, zwei Felder und viele Deko-Blumen.
- ``Hill`` 30 m — Hügel (5 m) mit Felsbrocken, zwei Nadelbäumen, drei Feldern.
- ``Meadow`` 40 m — Teich mit Seerosen, Bach und Wasserfall, Eichenhain, Blütenbaum am Teich, drei Felder.
- ``Cliff`` 48 m, Tiefe 1,05 D — hoher, steiler Felskörper mit langen Spitzen; karg: wenige
  Nadelbäume, viele Brocken, lichtes Gras, zwei Felder.
- ``Grove`` 60 m — Wäldchen aus Eichen und Nadelbäumen, Teich mit Seerosen, fünf Felder.
- ``Terrace`` 70 m — zwei Plateau-Ebenen (Felsstufe 6 m): unten Eichen, Teich, Bach,
  Wasserfall; oben Nadelbäume; sechs Felder.
- ``Lake`` 85 m — großer See mit Seerosen und Wasserfall, Mischwald, sieben Felder.
- ``Nest`` 35 m — Fliegennest: verrottete Insel mit dunkler, fauliger Erde, Schleimflecken,
  toten Bäumen, Pilzen und Madenhügeln, keine Blumen.

Dateien: ``.temp/models/islands/island-<name>[-lod1|-lod2].glb``; Katalog ``shared/islandCatalog.ts``.
"""

from __future__ import annotations

import argparse
import dataclasses
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from island_flora import FLORA_DIR, part_file
from islandkit import texturesets
from islandkit.assembly import IslandParts, IslandWater, LodParts, VertexColoredMesh, write_island, write_island_lod1, write_island_lod2
from islandkit.body import IslandBody, SilhouetteMesh, build_body, build_silhouette
from islandkit.catalog import IslandRecord, collision_resolution, compute_collision, write_catalog
from islandkit.lod import FarPartLibrary, assemble_far_parts
from islandkit.planting import IslandPlanter, PartSource, PlantingResult
from islandkit.plants import FLOWERS
from islandkit.roots import RootSettings, RootStrand, build_coarse_root_mesh, build_root_mesh, grow_roots
from islandkit.spec import IslandSpec, PlantingStyle, ShapeStyle
from islandkit.surface import IslandPainter, PatchTint
from islandkit.terrain import IslandTerrain, TerrainPlan
from islandkit.water import (
    WaterMesh,
    build_pond,
    build_stream,
    build_water_textures,
    build_waterfall,
    merge_water,
    pond_spacing,
    reduced_water_textures,
)
from modelkit.shading import srgb_to_linear

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RAW_DIR = REPO_ROOT / ".temp" / "models"
CATALOG_PATH = REPO_ROOT / "shared" / "islandCatalog.ts"
ISLANDS_DIR = "islands"

_OAKS = (("Tree_Oak_A", 1.0), ("Tree_Oak_B", 1.0))
_CONIFERS = (("Tree_Conifer_A", 1.0), ("Tree_Conifer_B", 1.0))

ISLANDS: tuple[IslandSpec, ...] = (
    IslandSpec(
        "Tiny", seed=12, diameter=14.0, depth_ratio=0.72, pond=False, stream=False,
        planting=PlantingStyle(
            trees=(("Tree_Oak_A", 1.0),), solitary="Tree_Oak_A", tree_count=1, bushes=2.0,
            patches=1, patch_radius=(1.7, 2.0), deco_flowers=0.05,
        ),
    ),
    IslandSpec(
        "Blossom", seed=23, diameter=22.0, pond=False, stream=False,
        planting=PlantingStyle(
            trees=(("Tree_Blossom", 1.0),), solitary="Tree_Blossom", tree_count=1, bushes=4.0,
            patches=2, patch_radius=(2.0, 2.5), deco_flowers=0.4, grass=0.9,
        ),
    ),
    IslandSpec(
        "Hill", seed=34, diameter=30.0, pond=False, stream=False,
        shape=ShapeStyle(hill_height=5.2, hill_radius=0.26, relief=1.3),
        planting=PlantingStyle(
            trees=(("Tree_Conifer_B", 1.0),), solitary=None, tree_count=2, boulders=4.0,
            patches=3, patch_radius=(1.8, 2.5), deco_flowers=0.06,
        ),
    ),
    IslandSpec(
        "Meadow", seed=45, diameter=40.0,
        planting=PlantingStyle(trees=_OAKS, patches=3, patch_radius=(2.2, 3.0), lilies=0.25, grass=0.8),
    ),
    IslandSpec(
        "Cliff", seed=56, diameter=48.0, depth_ratio=1.05, pond=False, stream=False, barren=0.55,
        shape=ShapeStyle(
            core_depth=(0.52, 0.58), shoulder=(2.1, 2.5), taper=(0.8, 0.95), side_spire_depth=(0.72, 0.95),
            extra_spires=3, hang=(0.22, 0.3), relief=1.4,
        ),
        planting=PlantingStyle(
            trees=_CONIFERS, solitary=None, tree_count=3, grove=0.1, bushes=0.6, boulders=2.2,
            patches=2, patch_radius=(2.0, 2.6), deco_flowers=0.0, grass=0.35,
        ),
    ),
    IslandSpec(
        "Grove", seed=67, diameter=60.0, stream=False,
        planting=PlantingStyle(
            trees=(*_OAKS, ("Tree_Conifer_A", 0.6)), tree_count=24, grove=0.02, tree_spacing=(4.0, 5.5),
            patches=5, patch_radius=(2.2, 3.2), lilies=0.16, lily_blossoms=0.25, grass=0.55,
        ),
    ),
    IslandSpec(
        "Terrace", seed=78, diameter=70.0, max_texture=2048,
        shape=ShapeStyle(terrace_height=6.0, terrace_width=2.4, pond_radius=(0.12, 0.16), pond_offset=(0.25, 0.35)),
        planting=PlantingStyle(
            trees=_OAKS, upper_trees=_CONIFERS, tree_count=20,
            patches=6, patch_radius=(2.4, 3.4), lilies=0.25, grass=0.45,
        ),
    ),
    IslandSpec(
        "Lake", seed=89, diameter=85.0, max_texture=2048,
        shape=ShapeStyle(pond_radius=(0.44, 0.5), pond_offset=(0.04, 0.1)),
        planting=PlantingStyle(
            trees=(("Tree_Oak_A", 1.0), ("Tree_Oak_B", 0.8), ("Tree_Conifer_A", 0.8), ("Tree_Conifer_B", 0.5)),
            tree_count=28, grove=-0.05, patches=7, patch_radius=(2.6, 3.6), lilies=0.07, grass=0.35,
        ),
    ),
    IslandSpec(
        "Nest", seed=90, diameter=35.0, pond=False, stream=False, biome="rot",
        shape=ShapeStyle(relief=1.5),
        planting=PlantingStyle(trees=(), solitary=None, tree_count=4, patches=0, deco_flowers=0.0, grass=0.8),
    ),
)  # fmt: skip

_ROOT_COLORS = {"meadow": (0.30, 0.21, 0.14), "rot": (0.28, 0.26, 0.24)}
_BLOSSOM_COLORS = {flower.species: flower.petals.colors[-1] for flower in FLOWERS}


def island_file(spec: IslandSpec, lod: int = 0) -> str:
    """Dateiname einer Insel und Detailstufe: ``Meadow`` → ``island-meadow.glb``, ``island-meadow-lod1.glb``."""
    return f"island-{spec.key}.glb" if lod == 0 else f"island-{spec.key}-lod{lod}.glb"


def flora_source(raw_dir: Path) -> PartSource:
    """Liefert zu einem Teilnamen das fertige Roh-glb aus ``island_flora.py``."""
    directory = raw_dir / FLORA_DIR

    def source(name: str) -> Path:
        path = directory / part_file(name)
        if not path.exists():
            raise FileNotFoundError(f"Teil {name} fehlt ({path}); zuerst island_flora.py ausführen.")
        return path

    return source


@dataclass(frozen=True, slots=True)
class IslandBuild:
    """Ergebnis einer Insel (Inselbau): Dateien der Detailstufen und Katalogeintrag."""

    paths: tuple[Path, ...]
    record: IslandRecord


class IslandBuilder:
    """Baut eine Insel in drei Detailstufen samt Katalogeintrag (Inselbauer)."""

    def __init__(self, spec: IslandSpec, parts: PartSource, library: FarPartLibrary, texture_size: int | None = None) -> None:
        self._spec = spec
        self._parts = parts
        self._library = library
        self._texture_size = texture_size
        self._plan = TerrainPlan.create(spec)

    def build(self, directory: Path, with_lods: bool = True) -> IslandBuild:
        """Schreibt die glb-Dateien und liefert Pfade und Katalogeintrag."""
        spec = self._spec
        start = time.perf_counter()
        body = build_body(spec, self._plan, texture_size=self._texture_size)
        planting = IslandPlanter(spec, body.mesh_terrain, IslandPainter(body.terrain), self._parts).plant()
        strands, settings = self._roots(body)
        paths = [directory / island_file(spec, 0)]
        self._write_lod0(body, planting, strands, settings, paths[0])
        lod0 = time.perf_counter() - start
        print(
            f"{paths[0].name}: Körper {len(body.mesh.faces)} Dreiecke, Textur {body.textures.color.shape[0]}², "
            f"{_format_timings(body.timings)}, gesamt {lod0:.1f} s",
            flush=True,
        )
        print("  Bepflanzung: " + ", ".join(f"{name} {count}" for name, count in planting.counts.items() if count), flush=True)
        if with_lods:
            paths.extend(self._write_far_lods(body, planting, strands, settings, directory))
            print(f"  LOD1/LOD2 {time.perf_counter() - start - lod0:.1f} s", flush=True)
        return IslandBuild(tuple(paths), self.record(body.mesh_terrain, planting))

    def _roots(self, body: IslandBody) -> tuple[list[RootStrand], RootSettings]:
        settings = RootSettings.for_terrain(body.mesh_terrain)
        return grow_roots(body.mesh_terrain, self._spec.seed + 1, settings), settings

    def _write_lod0(self, body: IslandBody, planting: PlantingResult, strands: list[RootStrand], settings: RootSettings, path: Path) -> None:
        spec, terrain = self._spec, body.terrain
        root_texture = texturesets.dead_root(spec.seed) if spec.biome == "rot" else texturesets.root(spec.seed)
        water = IslandWater(
            textures=build_water_textures(spec.seed),
            pond=build_pond(terrain),
            stream=build_stream(terrain),
            waterfall=build_waterfall(terrain),
            mist=build_waterfall(terrain, mist=True),
        )
        roots = build_root_mesh(strands, settings.base_radius)
        write_island(IslandParts(spec.name, body, water, roots, root_texture, planting.placements), path)

    def _write_far_lods(
        self, body: IslandBody, planting: PlantingResult, strands: list[RootStrand], settings: RootSettings, directory: Path
    ) -> list[Path]:
        spec = self._spec
        tints = [PatchTint(patch.center[[0, 2]], patch.radius, _BLOSSOM_COLORS[patch.species]) for patch in planting.patches]
        far_body = build_body(
            spec, self._plan, face_budget=spec.lod1_face_budget, texture_size=spec.lod1_texture_size, tints=tints, with_orm=False, ao_rays=32
        )
        detail = self._lod1_detail(planting, strands, settings)
        terrain = body.terrain
        water = IslandWater(
            textures=reduced_water_textures(build_water_textures(spec.seed), 2),
            pond=build_pond(terrain, spacing=2.0 * pond_spacing(terrain)),
            stream=build_stream(terrain, step=0.8),
            waterfall=_merged_fall(body),
        )
        lod1 = directory / island_file(spec, 1)
        write_island_lod1(LodParts(spec.name, far_body, detail, water), lod1)
        faint = [dataclasses.replace(tint, strength=0.45) for tint in tints]
        silhouette = build_silhouette(far_body, spec.lod2_face_budget, faint)
        crowns = assemble_far_parts(self._library, planting.exemplars("solitary", "trees"), lod=2, seed=spec.seed + 7)
        lod2 = directory / island_file(spec, 2)
        write_island_lod2(spec.name, _with_crowns(silhouette, crowns), lod2)
        print(
            f"  {lod1.name}: Körper {len(far_body.mesh.faces)}, Details {detail.triangle_count if detail else 0}, "
            f"Textur {far_body.textures.color.shape[0]}²; {lod2.name}: {len(silhouette.faces)} + Kronen "
            f"{sum(mesh.triangle_count for mesh in crowns)} Dreiecke",
            flush=True,
        )
        return [lod1, lod2]

    def _lod1_detail(self, planting: PlantingResult, strands: list[RootStrand], settings: RootSettings) -> VertexColoredMesh | None:
        """Vereinfachte Gehölze, Brocken und Madenhügel der LOD0-Bepflanzung plus kräftige Wurzeln."""
        exemplars = planting.exemplars("solitary", "trees", "bushes", "boulders", "mounds")
        meshes = assemble_far_parts(self._library, exemplars, lod=1, seed=self._spec.seed + 5)
        roots = build_coarse_root_mesh(strands, settings.base_radius)
        if roots is not None:
            shade = 0.55 + 0.45 * np.clip(roots.along, 0.0, 1.0) ** 0.7
            colors = srgb_to_linear(_ROOT_COLORS[self._spec.biome])[None, :] * shade[:, None]
            meshes.append(VertexColoredMesh(roots.vertices, roots.normals, roots.faces, colors))
        return VertexColoredMesh.concatenate(meshes) if meshes else None

    def record(self, terrain: IslandTerrain, planting: PlantingResult) -> IslandRecord:
        """Katalogeintrag aus dem groben Feld der Detailstufe 0 und der Bepflanzung."""
        spec = self._spec
        collision = compute_collision(terrain, collision_resolution(spec.diameter))
        ground_top = collision.top[collision.top > -32768]
        top = max(planting.top_height, float(ground_top.max()) / 100.0 if len(ground_top) else 0.0)
        depth = max(-(spire.end[1] - spire.end_radius) for spire in self._plan.spires)
        lowest = collision.bottom[collision.bottom > -32768]
        if len(lowest):
            depth = max(depth, -float(lowest.min()) / 100.0)
        canopy = top
        for part, position, _, scale in planting.exemplars("solitary", "trees"):
            canopy = max(canopy, float(position[1]) + scale * self._library.height(part))
        return IslandRecord(
            key=spec.key,
            files=(f"{ISLANDS_DIR}/{island_file(spec, 0)}", f"{ISLANDS_DIR}/{island_file(spec, 1)}", f"{ISLANDS_DIR}/{island_file(spec, 2)}"),
            diameter=spec.diameter,
            top_height=top,
            depth=float(depth),
            canopy_height=canopy,
            has_pond=terrain.plan.pond is not None,
            is_nest=spec.biome == "rot",
            patches=planting.patches,
            collision=collision,
        )


def _merged_fall(body: IslandBody) -> WaterMesh | None:
    """Wasserfall und Gischtschleier mit weniger Stützpunkten als eine Primitive (ferne Detailstufe)."""
    terrain = body.terrain
    fall = build_waterfall(terrain, rows=24, columns=5)
    mist = build_waterfall(terrain, mist=True, rows=20, columns=5)
    return merge_water([fall, mist]) if fall is not None and mist is not None else fall


def _with_crowns(silhouette: SilhouetteMesh, crowns: list[VertexColoredMesh]) -> SilhouetteMesh:
    """Fügt die Kronen der Silhouette als Teil derselben Primitive hinzu (ein Draw Call)."""
    if not crowns:
        return silhouette
    merged = VertexColoredMesh.concatenate(
        [VertexColoredMesh(silhouette.vertices, silhouette.normals, silhouette.faces, silhouette.colors), *crowns]
    )
    return SilhouetteMesh(merged.vertices, merged.normals, merged.faces, merged.colors)


def _format_timings(timings: dict[str, float]) -> str:
    return ", ".join(f"{name} {seconds:.1f} s" for name, seconds in timings.items())


def generate(
    raw_dir: Path, only: set[str] | None = None, texture_size: int | None = None, with_lods: bool = True, catalog: bool | None = None
) -> list[Path]:
    """Schreibt alle (oder die gewählten) Inseln und liefert die Pfade.

    Der Katalog wird geschrieben, wenn alle Inseln gebaut werden (oder ``catalog`` es verlangt).
    """
    parts = flora_source(raw_dir)
    library = FarPartLibrary(parts)
    directory = raw_dir / ISLANDS_DIR
    directory.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    records: list[IslandRecord] = []
    start = time.perf_counter()
    for spec in ISLANDS:
        if only is not None and spec.name not in only:
            continue
        result = IslandBuilder(spec, parts, library, texture_size).build(directory, with_lods)
        paths.extend(result.paths)
        records.append(result.record)
    write_records = catalog if catalog is not None else only is None
    if write_records:
        write_catalog(records, CATALOG_PATH)
        print(f"Katalog: {CATALOG_PATH.relative_to(REPO_ROOT).as_posix()} ({len(records)} Inseln)", flush=True)
    print(f"Inseln gesamt {time.perf_counter() - start:.1f} s", flush=True)
    return paths


def build(raw_dir: Path) -> list[Path]:
    """Schnittstelle für ``build_all.py``."""
    return generate(raw_dir)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_RAW_DIR)
    parser.add_argument("--only", nargs="*", help="Nur diese Inseln (Namen aus ISLANDS)")
    parser.add_argument("--texture", type=int, help="Texturgröße LOD0 für schnelle Proben (z. B. 1024)")
    parser.add_argument("--skip-lods", action="store_true", help="Nur LOD0 bauen (schnelle Formproben)")
    arguments = parser.parse_args()
    generate(arguments.output_dir, set(arguments.only) if arguments.only else None, arguments.texture, not arguments.skip_lods)


if __name__ == "__main__":
    main()
