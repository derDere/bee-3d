"""Erzeugt den Bienenstock — die Raumstation der Bienenwelt — als texturierte .glb in zwei Detailstufen (Bienenstock).

Brief: Neun schwebende Stöcke sind die Stationen des Spiels (EVE-Vorbild): hinfliegen, aus
≤ 45 m andocken, die Biene fliegt ins Flugloch, die Kamera zeigt die Wabenhalle mit dem
Stationsmenü. Märchenhaft-realistisch: ein geflochtener Strohkorb (Bienenkorb) mit dicken
Wulstringen und Bindungen aus gespaltenem Rohr, darunter frei hängende Naturwaben aus Wachs mit
Sechseckzellen, teils mit golden leuchtendem Honig, teils verdeckelt, dazu Wachs- und
Honigtropfen; vorn ein Flugloch mit Holzrahmen und Anflugbrett. Details im Bienenmaßstab (die
Biene misst 0,2 m): Wachslaternen, Honigtöpfchen, Wimpelkette, Wimpel an Pfosten und Mast, eine
Leuchtschale auf dem Knauf. Der Stock schwebt (kein Boden); die Unterseite formen die Waben.

Maße: ~18,7 m hoch (Leuchtschale +7,2 bis Wabentropfen −11,5), Korb 14,2 m breit, Flugloch Ø 2,8 m
in +Z; Ursprung im Mittelpunkt des Korbs (Proportionsliste in ``hivekit.layout``).
Kameradistanzen: Silhouette ab einigen hundert Metern (LOD1 ab ~300 m), Anflug 45–3 m,
Bienennähe 0,5–2 m am Brett und in der Halle.

Innen: hinter dem Flugloch die Wabenhalle (Kuppel Ø 11,8 m, Boden y = −4,25): Wände aus
Sechseckzellen mit Tiefe, Honigbecken in der Mitte, zwei Galerien, acht Wachssäulen als Rippen,
Strohkuppel mit Kronleuchterwaben, fünf Bogentüren zu dunklen Kammern, Laternen und Töpfchen.

Struktur (der Spielcode greift über diese Namen zu):
``Hive`` → ``Exterior`` → ``Exterior_Mesh`` (Stroh, Wachs, Honig, Holz, Stoff);
``Hive`` → ``Interior`` → ``Interior_Mesh`` (Hallenstroh, Hallenwachs, Hallenhonig, Holz, Stoff);
leere Anker ``DockPoint`` (3 m vor dem Flugloch), ``EntrancePoint`` (Mitte des Fluglochs),
``HangarPoint`` (Schwebepunkt der angedockten Biene), ``HangarCamera`` (lokale +Z-Achse blickt
auf den HangarPoint), ``BeaconPoint`` (über der Leuchtschale auf dem Mast). LOD1 trägt dieselben
Knoten mit leerem ``Interior``.

Materialien (``hivekit.materials``): ``Hive_Straw``, ``Hive_Wax``, ``Hive_Honey`` (Leuchten über
``emissiveTexture`` × ``emissiveFactor``), ``Hive_Wood``, ``Hive_Cloth``; innen ``Hive_HallStraw``,
``Hive_HallWax`` (beide mit schwachem warmem Eigenleuchten) und ``Hive_HallHoney``. Alle
Texturen kacheln, Farbtöne und gebackene AO liegen in ``COLOR_0``.

Budgets: LOD0 ≤ 50.000 Dreiecke, Texturen außen ≤ 2048², innen ≤ 1024²; LOD1 ≤ 5.000
Dreiecke, Texturen ≤ 512².
"""

from __future__ import annotations

import argparse
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import numpy.typing as npt
from hivekit.decor import PropParts
from hivekit.exterior import ExteriorBuilder, ExteriorDetail
from hivekit.hall import HallBuilder, HallSettings
from hivekit.layout import HiveLayout
from hivekit.materials import SurfaceTextures, hive_materials
from hivekit.mesh import MeshPart
from hivekit.occlusion import occluder, shade_with_occlusion
from hivekit.skep import CoilSettings
from hivekit.textures import TextureSet, cloth_textures, honey_textures, straw_textures, wax_textures, wood_textures
from modelkit.gltf_writer import GltfBuilder, PrimitiveData
from modelkit.transforms import quaternion_from_matrix

type FloatArray = npt.NDArray[np.float64]

# Liegt unter tools/models/; Rohdateien nach .temp/models/ im Repo-Root
DEFAULT_RAW_DIR = Path(__file__).resolve().parents[2] / ".temp" / "models"


@contextmanager
def stopwatch(label: str, timings: dict[str, float]) -> Iterator[None]:
    """Misst die Laufzeit eines Pipeline-Schritts."""
    start = time.perf_counter()
    yield
    timings[label] = timings.get(label, 0.0) + time.perf_counter() - start


@dataclass(frozen=True, slots=True)
class OcclusionSettings:
    """Eckpunkt-AO eines Materials (Verdeckung): Reichweite in Metern, Stärke, Untergrenze."""

    distance: float
    strength: float
    floor: float = 0.0


@dataclass(frozen=True, slots=True)
class LodSettings:
    """Detailstufe (LOD): Umfang, Texturgrößen (Breite, Höhe), Normal-Maps, AO-Strahlen."""

    file_name: str
    lod: str
    exterior: ExteriorDetail
    hall: HallSettings | None
    straw_size: tuple[int, int]
    hall_straw_size: tuple[int, int]
    wax_size: int
    wood_size: tuple[int, int]
    honey_size: int
    cloth_size: int
    normal_maps: bool
    ao_rays: int
    occlusion: dict[str, OcclusionSettings] = field(
        default_factory=lambda: {
            "Hive_Straw": OcclusionSettings(1.6, 0.55),
            "Hive_HallStraw": OcclusionSettings(1.0, 0.6),
            "Hive_Wax": OcclusionSettings(0.9, 0.75, 0.2),
            "Hive_HallWax": OcclusionSettings(0.9, 0.75, 0.2),
            "Hive_Wood": OcclusionSettings(0.9, 0.7),
            "Hive_Honey": OcclusionSettings(0.5, 0.3),
            "Hive_HallHoney": OcclusionSettings(0.5, 0.3),
            "Hive_Cloth": OcclusionSettings(0.8, 0.2),
        }
    )


LOD0 = LodSettings(
    file_name="hive.glb",
    lod="lod0",
    exterior=ExteriorDetail(),
    hall=HallSettings(),
    straw_size=(2048, 1024),
    hall_straw_size=(1024, 512),
    wax_size=1024,
    wood_size=(1024, 512),
    honey_size=256,
    cloth_size=128,
    normal_maps=True,
    ao_rays=48,
)

LOD1 = LodSettings(
    file_name="hive-lod1.glb",
    lod="lod1",
    exterior=ExteriorDetail(
        coil=CoilSettings(cross_segments=2, chord=1.75, tile_length=2.0, skirt=0.0),
        cells=False,
        comb_samples=9,
        comb_rim_sides=2,
        base_rings=3,
        base_sides=20,
        frame_sides=16,
        frame_segments=(1, 1),
        tunnel=False,
        props=False,
        bunting_detail=4,
    ),
    hall=None,
    straw_size=(512, 256),
    hall_straw_size=(0, 0),
    wax_size=256,
    wood_size=(256, 128),
    honey_size=128,
    cloth_size=64,
    normal_maps=False,
    ao_rays=24,
)

_NOT_OCCLUDING = ("Hive_Cloth",)
_WITHOUT_NORMAL_MAP = ("Hive_Honey", "Hive_HallHoney", "Hive_Cloth")


@dataclass(frozen=True, slots=True)
class Section:
    """Teilnetze eines Knotens (Außenhülle oder Halle) je Material (Abschnitt)."""

    node: str
    parts: dict[str, MeshPart]

    @property
    def triangles(self) -> dict[str, int]:
        """Dreiecke je Material."""
        return {name: part.face_count for name, part in self.parts.items() if part.face_count}


@dataclass(frozen=True, slots=True)
class LodBuild:
    """Ergebnis einer Detailstufe: Datei und Dreiecke je Knoten und Material."""

    path: Path
    triangles: dict[str, int]


@dataclass(frozen=True, slots=True)
class HiveBuild:
    """Ergebnis eines Generatorlaufs: beide Detailstufen und die Laufzeiten."""

    lods: list[LodBuild]
    timings: dict[str, float]

    @property
    def paths(self) -> list[Path]:
        """Geschriebene Roh-glbs."""
        return [lod.path for lod in self.lods]


class HiveGenerator:
    """Baut Geometrie, Texturen und Knoten des Bienenstocks (Stockgenerator)."""

    def __init__(self, layout: HiveLayout, seed: int) -> None:
        self._layout = layout
        self._seed = seed
        self._timings: dict[str, float] = {}
        with stopwatch("textures", self._timings):
            full = LOD0
            self._textures = {
                "straw": straw_textures(*full.straw_size, seed=seed + 101),
                "wax": wax_textures(full.wax_size, seed=seed + 102),
                "wood": wood_textures(*full.wood_size, seed=seed + 103),
                "honey": honey_textures(full.honey_size, seed=seed + 104),
                "cloth": cloth_textures(full.cloth_size, seed=seed + 105),
            }

    @property
    def timings(self) -> dict[str, float]:
        """Laufzeiten der Schritte in Sekunden."""
        return self._timings

    def sections(self, lod: LodSettings) -> list[Section]:
        """Außenhülle und Halle einer Detailstufe, je Material zusammengefasst und mit AO schattiert."""
        with stopwatch(f"geometry {lod.lod}", self._timings):
            exterior = ExteriorBuilder(self._layout, lod.exterior, self._seed).build()
            outside = _by_material(exterior.props, exterior.straw, ("Hive_Straw", "Hive_Wax", "Hive_Honey"))
            inside: dict[str, MeshPart] = {}
            if lod.hall is not None:
                hall = HallBuilder(self._layout, lod.hall, np.random.default_rng(self._seed + 7)).build()
                inside = _by_material(hall.props, hall.straw, ("Hive_HallStraw", "Hive_HallWax", "Hive_HallHoney"))
                # Dunkle Kammern hinter den Türen ohne Eigenleuchten
                inside["Hive_Wax"] = MeshPart.concatenate(hall.chambers)
        with stopwatch(f"occlusion {lod.lod}", self._timings):
            blocker = occluder(
                [part for parts in (outside, inside) for name, part in parts.items() if name not in _NOT_OCCLUDING]
            )
            sections = []
            for node, parts in (("Exterior", outside), ("Interior", inside)):
                shaded = {}
                for name, part in parts.items():
                    settings = lod.occlusion[name]
                    shaded[name] = shade_with_occlusion(
                        part, blocker, lod.ao_rays, settings.distance, settings.strength, settings.floor
                    )
                sections.append(Section(node, shaded))
        return sections

    def write(self, lod: LodSettings, raw_dir: Path) -> LodBuild:
        """Schreibt eine Detailstufe als glb."""
        sections = self.sections(lod)
        with stopwatch(f"gltf {lod.lod}", self._timings):
            path = raw_dir / lod.file_name
            builder = GltfBuilder(generator="modelkit hive")
            self._add_materials(builder, lod)
            meshes = {}
            for section in sections:
                primitives = [
                    PrimitiveData(
                        part.vertices,
                        part.normals,
                        part.faces,
                        name,
                        uvs=part.uvs,
                        tangents=part.tangents() if lod.normal_maps and name not in _WITHOUT_NORMAL_MAP else None,
                        colors=np.clip(part.tint, 0.0, 1.0),
                    )
                    for name, part in section.parts.items()
                    if part.face_count
                ]
                meshes[section.node] = builder.add_mesh(f"{section.node}_Mesh", primitives) if primitives else None
            self._add_nodes(builder, meshes)
            builder.write_glb(path)
        triangles = {
            f"{section.node}/{name}": count for section in sections for name, count in section.triangles.items()
        }
        return LodBuild(path, triangles)

    def _add_materials(self, builder: GltfBuilder, lod: LodSettings) -> None:
        textures = self._textures
        # ORM ist niederfrequent (Rillen-AO, Rauheit): halbe Kantenlänge genügt
        straw = textures["straw"].resized(*lod.straw_size, orm_divisor=2)
        wax = textures["wax"].resized(lod.wax_size, lod.wax_size, orm_divisor=2)
        wood = textures["wood"].resized(*lod.wood_size, orm_divisor=2)
        honey = textures["honey"].resized(lod.honey_size, lod.honey_size, orm_divisor=4)
        cloth = textures["cloth"].resized(lod.cloth_size, lod.cloth_size, orm_divisor=2)

        def register(material: str, images: TextureSet) -> SurfaceTextures:
            prefix = f"{material}_{lod.lod}"
            return SurfaceTextures(
                color=builder.add_texture(f"{prefix}_color", images.color, wrap="repeat"),
                orm=builder.add_texture(f"{prefix}_orm", images.orm, wrap="repeat"),
                normal=builder.add_texture(f"{prefix}_normal", images.normal, wrap="repeat")
                if lod.normal_maps and images.normal is not None
                else None,
                emissive=builder.add_texture(f"{prefix}_emissive", images.emissive, wrap="repeat")
                if images.emissive is not None
                else None,
            )

        hall_straw = (
            register("Hive_HallStraw", textures["straw"].resized(*lod.hall_straw_size, orm_divisor=2))
            if lod.hall is not None
            else None
        )
        for spec in hive_materials(
            straw=register("Hive_Straw", straw),
            wax=register("Hive_Wax", wax),
            wood=register("Hive_Wood", wood),
            honey=register("Hive_Honey", honey),
            cloth=register("Hive_Cloth", cloth),
            hall_straw=hall_straw,
        ):
            builder.add_material(spec)

    def _add_nodes(self, builder: GltfBuilder, meshes: dict[str, int | None]) -> None:
        layout = self._layout
        builder.add_node("Hive")
        for node in ("Exterior", "Interior"):
            builder.add_node(node, parent="Hive")
            mesh = meshes.get(node)
            if mesh is not None:
                builder.add_node(f"{node}_Mesh", parent=node, mesh=mesh)
        anchors = {
            "DockPoint": layout.dock_point,
            "EntrancePoint": layout.entrance_point,
            "HangarPoint": layout.hangar_point,
            "HangarCamera": layout.hangar_camera,
            "BeaconPoint": layout.beacon_point,
        }
        # Die Kamera blickt entlang ihrer lokalen +Z-Achse auf den Schwebepunkt der Biene
        look = quaternion_from_matrix(layout.look_rotation(layout.hangar_camera, layout.hangar_point)).tolist()
        for name, position in anchors.items():
            rotation = look if name == "HangarCamera" else None
            builder.add_node(name, parent="Hive", translation=position.tolist(), rotation=rotation)


def _by_material(props: PropParts, straw: list[MeshPart], names: tuple[str, str, str]) -> dict[str, MeshPart]:
    """Fasst die Teile eines Abschnitts je Material zusammen; ``names`` benennt Stroh, Wachs und Honig des Abschnitts."""
    straw_name, wax_name, honey_name = names
    return {
        straw_name: MeshPart.concatenate(straw),
        wax_name: MeshPart.concatenate(props.wax),
        honey_name: MeshPart.concatenate(props.honey),
        "Hive_Wood": MeshPart.concatenate(props.wood),
        "Hive_Cloth": MeshPart.concatenate(props.cloth),
    }


def generate(raw_dir: Path, seed: int = 7) -> HiveBuild:
    """Baut beide Detailstufen und schreibt ``hive.glb`` und ``hive-lod1.glb`` nach ``raw_dir``."""
    generator = HiveGenerator(HiveLayout(), seed)
    lods = [generator.write(lod, raw_dir) for lod in (LOD0, LOD1)]
    return HiveBuild(lods, generator.timings)


def build(raw_dir: Path) -> list[Path]:
    """Schnittstelle für ``build_all``: schreibt die Roh-glbs und liefert ihre Pfade."""
    return generate(raw_dir).paths


def format_report(result: HiveBuild) -> list[str]:
    """Kennzahlen eines Laufs als Textzeilen."""
    lines = []
    for lod in result.lods:
        total = sum(lod.triangles.values())
        lines.append(f"{lod.path.name}: {total} Dreiecke, {lod.path.stat().st_size / 1024:.0f} KiB")
        lines += [f"  {name:28s} {count:6d}" for name, count in lod.triangles.items()]
    lines += [f"  {label:28s} {seconds:6.2f} s" for label, seconds in result.timings.items()]
    return lines


def main() -> None:
    """Baut den Bienenstock in ein Ausgabeverzeichnis und gibt Kennzahlen aus."""
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_RAW_DIR)
    parser.add_argument("--seed", type=int, default=7)
    arguments = parser.parse_args()
    print("\n".join(format_report(generate(arguments.output_dir, arguments.seed))))


if __name__ == "__main__":
    main()
