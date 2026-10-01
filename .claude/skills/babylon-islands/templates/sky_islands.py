"""Erzeugt schwebende Inseln als glb (Schwebeinseln): Inselkörper, hängende Wurzeln, Teich, Bach, Wasserfall.

Brief: Fantasie-Inseln mit 10–100 m Durchmesser für die Spielwelt. Oben eine Grasnarbe mit
sanften Hügeln, darunter ein Erdband mit Wurzeln, dann eine geschichtete Felswand, die in
mehrere hängende Spitzen ausläuft. Teich mit Bach, der an der Kante als Wasserfall abstürzt.
Texturen gebacken (Basisfarbe, Normal-Map, ORM), ~5 cm je Texel bis 4096². Ursprung in der
Mitte der Plateauoberfläche, +Y oben. Bepflanzung kommt als ``PartPlacement`` aus den Teilen von
``island_flora.py`` (Regeln: Skill ``babylon-islands``, ``references/assembly.md``).

Dateien: ``.temp/models/islands/<name>.glb``.
"""

from __future__ import annotations

import argparse
import time
from collections.abc import Sequence
from pathlib import Path

from islandkit import texturesets
from islandkit.assembly import IslandParts, IslandWater, PartPlacement, write_island
from islandkit.body import build_body
from islandkit.roots import RootSettings, build_root_mesh, grow_roots
from islandkit.spec import IslandSpec
from islandkit.terrain import TerrainPlan
from islandkit.water import build_pond, build_stream, build_water_textures, build_waterfall

DEFAULT_RAW_DIR = Path(__file__).resolve().parents[2] / ".temp" / "models"
ISLANDS_DIR = "islands"

ISLANDS: tuple[IslandSpec, ...] = (IslandSpec("Meadow", seed=7, diameter=40.0),)


def island_file(spec: IslandSpec) -> str:
    """Dateiname einer Insel: ``Meadow`` → ``island-meadow.glb``."""
    return f"island-{spec.name.lower()}.glb"


def build_island(spec: IslandSpec, placements: Sequence[PartPlacement], path: Path, texture_size: int | None = None) -> None:
    """Baut eine Insel und schreibt sie mit den übergebenen Platzierungen."""
    start = time.perf_counter()
    body = build_body(spec, TerrainPlan.create(spec), texture_size=texture_size)
    settings = RootSettings.for_terrain(body.mesh_terrain)
    roots = build_root_mesh(grow_roots(body.mesh_terrain, spec.seed + 1, settings), settings.base_radius)
    terrain = body.terrain
    water = IslandWater(
        textures=build_water_textures(spec.seed),
        pond=build_pond(terrain),
        stream=build_stream(terrain),
        waterfall=build_waterfall(terrain),
        mist=build_waterfall(terrain, mist=True),
    )
    write_island(IslandParts(spec.name, body, water, roots, texturesets.root(spec.seed), placements), path)
    steps = ", ".join(f"{name} {seconds:.1f} s" for name, seconds in body.timings.items())
    print(f"{path.name}: {len(body.mesh.faces)} Dreiecke Körper, {len(roots.faces)} Wurzeln ({steps}), gesamt {time.perf_counter() - start:.1f} s")


def generate(raw_dir: Path, only: set[str] | None = None, texture_size: int | None = None) -> list[Path]:
    """Schreibt alle (oder die gewählten) Inseln und liefert die Pfade."""
    paths = []
    for spec in ISLANDS:
        if only is not None and spec.name not in only:
            continue
        path = raw_dir / ISLANDS_DIR / island_file(spec)
        build_island(spec, placements=(), path=path, texture_size=texture_size)
        paths.append(path)
    return paths


def build(raw_dir: Path) -> list[Path]:
    """Schnittstelle für ``build_all.py``."""
    return generate(raw_dir)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_RAW_DIR)
    parser.add_argument("--only", nargs="*", help="Nur diese Inseln (Namen aus ISLANDS)")
    parser.add_argument("--texture", type=int, help="Texturgröße für schnelle Proben (z. B. 1024)")
    arguments = parser.parse_args()
    generate(arguments.output_dir, set(arguments.only) if arguments.only else None, arguments.texture)


if __name__ == "__main__":
    main()
