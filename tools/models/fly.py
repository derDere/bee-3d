"""Erzeugt die Gegner Schmeißfliege, Brummer und Fliegenkönigin als texturierte .glb (böse Schmeißfliegen).

Brief: Gegner in bee-3d (Spec ``spieldesign.md``, Abschnitt „Gegner“), Kameradistanz meist
5–50 m (im Kampf umkreisen die Fliegen ihr Ziel in 25–50 m), Nahsicht bis 1 m.
Stil: realistisch und monströs — Makrofoto einer Schmeißfliege, leicht übersteigert, ohne
Comic-Elemente als Kontrast zur niedlichen Biene: riesige rote Facettenaugen (Facetten über die
Normal-Map), borstiger Thorax (Borsten als dünne Röhren), metallischer Panzer mit
Schillerschicht, gegliederte behaarte Beine mit Dornen, Krallen und Haftlappen,
durchscheinende geäderte schillernde Flügel, tropfender Tupfrüssel (Spuckwaffe).

| Art | Datei | Länge (Kopf bis Hinterleibsende) | Look | Budget | Texturen |
|---|---|---|---|---|---|
| Schmeißfliege | ``fly.glb`` | 0,45 m | metallisch grün-blau schillernd | ≤ 10.000 Dreiecke | Chitin 1024², Augen 512², Flügel 512² |
| Brummer | ``fly-brummer.glb`` | 0,9 m | gedrungener, haariger, metallisch blau-schwarz | ≤ 10.000 Dreiecke | Chitin 1024², Augen 512², Flügel 512² |
| Fliegenkönigin | ``fly-queen.glb`` | 2,8 m | violett-schwarz, giftgrüne Akzente, aufgeblähter Hinterleib, Borstenkrone | ≤ 20.000 Dreiecke | Chitin 2048², Augen 1024², Flügel 512² |

Maße in Metern, +Y oben, +Z Blickrichtung, Ursprung im Schwerpunkt der Rumpfvolumina.
Proportionen: ``flykit.anatomy``, Arten: ``flykit.species``. Die Grundhaare füllen das
Dreiecksbudget, das nach Hüllen, Gliedern, Augen, Flügeln und Großborsten bleibt.

Knoten (alle Arten gleich, der Spielcode greift über diese Namen zu): ``Fly`` → ``Body`` →
``Head`` (Pivot im Halsgelenk) → ``Eye_L``/``Eye_R`` (Pivot in der Augenmitte), ``Proboscis``
(Pivot im Rüsselansatz) → ``SpitOrigin`` (leerer Anker in der Mitte des Speicheltropfens);
``Body`` → ``Wing_L``/``Wing_R`` (Pivot im Flügelgelenk), ``Leg_Front_L`` … ``Leg_Hind_R`` (Pivot
in der Hüfte). Jeder Knoten mit Geometrie trägt sein Mesh am Kindknoten ``<Name>_Mesh``; das
Spiel dreht den Pivotknoten.

Materialien je Art mit Modellpräfix (``Fly``, ``FlyBrummer``, ``FlyQueen``): ``<Präfix>_Body``
(Chitin: Basisfarbe, ORM, Normal-Map, Schillerschicht; Brummer und Königin mit Samtschimmer),
``<Präfix>_Eye`` (Facetten: Basisfarbe, ORM, Normal-Map, Leuchtmaske mit ``emissiveFactor`` = 0 —
das Spiel hebt die Leuchtfarbe nachts an), ``<Präfix>_Wing`` (RGBA, BLEND, doppelseitig,
schillernd), ``<Präfix>_Hair`` (Borsten mit Vertexfarben).

Animationen: ``WingFlap`` (Brummen, Schleife 0,04 s) und ``Idle`` (Beine und Rüssel zucken
leicht, Schleife 1,6 s).
"""

from __future__ import annotations

import argparse
import time
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import numpy.typing as npt
from flykit.anatomy import FlyAnatomy
from flykit.atlas import ChitinAtlas, ChitinPart, PartKind, unwrap_parts
from flykit.bristles import (
    GROUND_TRIANGLES,
    BodyCoat,
    Bristle,
    HairMesh,
    HeadCoat,
    arista_bristles,
    body_macrochaetae,
    crown_spikes,
    ground_hairs,
    grow,
    head_macrochaetae,
)
from flykit.eyes import EyeImages, bake_eye, eye_mesh, facet_mosaic
from flykit.fields import BodyField, HeadField
from flykit.limbs import LimbPart, antenna_solid, halter_solid, leg_part, proboscis_part
from flykit.look import FlyTextures, Zone, fly_materials, material_name
from flykit.motion import idle_tracks
from flykit.painting import ChitinPainter
from flykit.shells import Shell, build_shell
from flykit.species import SPECIES, Species
from flykit.wings import WingOutline, flap_tracks, wing_mesh, wing_texture
from modelkit.baking import bake_base_color, bake_normal_map, bake_occlusion, bake_orm, rasterize_uv
from modelkit.geometry import TriangleMesh
from modelkit.gltf_writer import GltfBuilder, PrimitiveData
from modelkit.uv import UnwrappedMesh, UvOptions

type FloatArray = npt.NDArray[np.float64]
type ByteImage = npt.NDArray[np.uint8]

# Liegt unter tools/models/; Rohdateien nach .temp/models/ im Repo-Root
DEFAULT_RAW_DIR = Path(__file__).resolve().parents[2] / ".temp" / "models"

AO_REACH = 0.7  # Referenz-mm: Reichweite der gebackenen Verdeckung (~7 % der Körperlänge)


@contextmanager
def stopwatch(label: str, timings: dict[str, float]) -> Iterator[None]:
    """Misst die Laufzeit eines Pipeline-Schritts."""
    start = time.perf_counter()
    yield
    timings[label] = time.perf_counter() - start


@dataclass(frozen=True, slots=True)
class TextureSizes:
    """Kantenlängen der Texturen eines Laufs (Texturgrößen)."""

    body: int
    eye: int
    wing: int

    @classmethod
    def of(cls, species: Species, scale: float) -> TextureSizes:
        """Texturgrößen der Art, für schnelle Iterationen verkleinert (``scale`` < 1)."""
        budget = species.budget

        def scaled(size: int) -> int:
            return max(128, int(round(size * scale)))

        return cls(scaled(budget.body_texture), scaled(budget.eye_texture), scaled(budget.wing_texture))


@dataclass(frozen=True, slots=True)
class FlyParts:
    """Alle Teile einer Fliege im Modellrahmen, Ruhehaltung (Teile)."""

    body: Shell
    head: Shell
    proboscis: LimbPart
    legs: list[LimbPart]
    eyes: list[UnwrappedMesh]
    wings: list[UnwrappedMesh]
    body_hair: HairMesh
    head_hair: HairMesh

    def occluder(self) -> TriangleMesh:
        """Alle deckenden Teile ohne Borsten als Verdecker für die gebackene Verdeckung."""
        meshes = [self.body.mesh.as_triangle_mesh(), self.head.mesh.as_triangle_mesh(), self.proboscis.mesh.as_triangle_mesh()]
        meshes += [leg.mesh.as_triangle_mesh() for leg in self.legs]
        meshes += [TriangleMesh(eye.vertices, eye.faces) for eye in self.eyes]
        return TriangleMesh.concatenate(meshes)

    def chitin_parts(self) -> list[ChitinPart]:
        """Die Teile des Chitin-Atlas in fester Reihenfolge: Rumpf, Kopf, Rüssel, Beine."""
        parts = [
            ChitinPart("Body", PartKind.BODY, self.body.mesh),
            ChitinPart("Head", PartKind.HEAD, self.head.mesh),
            ChitinPart("Proboscis", PartKind.PROBOSCIS, self.proboscis.mesh),
        ]
        return parts + [ChitinPart(leg.name, PartKind.LEG, leg.mesh) for leg in self.legs]


@dataclass(frozen=True, slots=True)
class ChitinImages:
    """Gebackene Texturen des Chitin-Atlas (Chitintexturen)."""

    color: ByteImage
    orm: ByteImage
    normal: ByteImage
    sheen: ByteImage | None


@dataclass(frozen=True, slots=True)
class FlyBuild:
    """Ergebnis eines Generatorlaufs: Datei, Dreiecke je Primitive und Laufzeiten."""

    species: Species
    path: Path
    triangles: dict[str, int]
    timings: dict[str, float]


def half_size(image: ByteImage) -> ByteImage:
    """Halbiert die Kantenlänge (2 × 2 gemittelt) — für Masken, die keine volle Auflösung brauchen."""
    height, width = image.shape[:2]
    blocks = image.reshape(height // 2, 2, width // 2, 2, -1).astype(np.float64)
    return np.round(blocks.mean(axis=(1, 3))).astype(np.uint8)


def _hair_triangles(bristles: Sequence[Bristle]) -> int:
    return sum(bristle.triangles for bristle in bristles)


def build_parts(anatomy: FlyAnatomy, timings: dict[str, float]) -> FlyParts:
    """Hüllen, Glieder, Augen, Flügel und Borsten; die Grundhaare füllen das restliche Dreiecksbudget."""
    species = anatomy.species
    budget = species.budget
    rng = np.random.default_rng(species.seed)
    body_field, head_field = BodyField(anatomy), HeadField(anatomy)
    with stopwatch("shells", timings):
        body = build_shell(body_field, [halter_solid(halter) for halter in anatomy.thorax.halteres], budget.body)
        head = build_shell(head_field, [antenna_solid(antenna) for antenna in anatomy.antennae], budget.head)
    with stopwatch("limbs, eyes, wings", timings):
        legs = [leg_part(leg, body.solid, budget.leg_sides, budget.leg_spines, rng) for leg in anatomy.legs]
        proboscis = proboscis_part(anatomy.proboscis, head.solid, budget.proboscis_sides)
        left_eye = eye_mesh(anatomy.eyes[0], budget.eye_rings, budget.eye_segments)
        eyes = [left_eye, left_eye.mirrored_x()]
        outline = WingOutline.default()
        wings = [wing_mesh(wing, outline, *budget.wing_steps) for wing in anatomy.wings]
    with stopwatch("bristles", timings):
        thickness = species.hair.thickness * species.proportions.head
        body_bristles = body_macrochaetae(anatomy, body_field)
        head_bristles = head_macrochaetae(anatomy, head_field) + crown_spikes(anatomy, head_field)
        for antenna in anatomy.antennae:
            head_bristles += arista_bristles(antenna, anatomy.unit, thickness)
        solids = [body.mesh, head.mesh, proboscis.mesh, *(leg.mesh for leg in legs)]
        used = sum(len(mesh.faces) for mesh in solids) + sum(len(mesh.faces) for mesh in (*eyes, *wings))
        spare = budget.total - budget.reserve - used - _hair_triangles(body_bristles) - _hair_triangles(head_bristles)
        if spare < 0:
            raise ValueError(f"{species.key}: Dreiecksbudget um {-spare} überschritten, bevor Grundhaare verteilt sind.")
        ground = spare // GROUND_TRIANGLES
        head_count = int(round(ground * species.hair.head_share))
        body_bristles += ground_hairs(anatomy, body.mesh, body_field, ground - head_count, BodyCoat(anatomy), rng)
        head_bristles += ground_hairs(anatomy, head.mesh, head_field, head_count, HeadCoat(anatomy), rng)
        body_hair = grow(body_bristles, species, rng)
        head_hair = grow(head_bristles, species, rng)
    return FlyParts(body, head, proboscis, legs, eyes, wings, body_hair, head_hair)


def bake_chitin(anatomy: FlyAnatomy, atlas: ChitinAtlas, size: int, occluder: TriangleMesh) -> ChitinImages:
    """Rasterisiert den Atlas, backt die Verdeckung und bemalt Farbe, ORM, Detailnormalen und Samtschimmer."""
    texels = rasterize_uv(atlas.combined, size)
    occlusion = bake_occlusion(texels, occluder, anatomy.species.budget.ao_rays, max_distance=AO_REACH * anatomy.unit)
    painted = ChitinPainter(anatomy, BodyField(anatomy)).paint(texels, atlas, occlusion)
    sheen = half_size(bake_base_color(texels, painted.sheen)) if anatomy.species.sheen is not None else None
    return ChitinImages(
        color=bake_base_color(texels, painted.color),
        orm=bake_orm(texels, occlusion, painted.roughness, painted.metallic),
        normal=bake_normal_map(texels, atlas.combined.tangents(), painted.normals),
        sheen=sheen,
    )


def bake_eyes(anatomy: FlyAnatomy, eye: UnwrappedMesh, size: int, occluder: TriangleMesh) -> EyeImages:
    """Facettenmosaik und Texturen des linken Auges (das rechte teilt sie gespiegelt)."""
    species = anatomy.species
    rng = np.random.default_rng(species.seed + 7)
    texels = rasterize_uv(eye, size)
    occlusion = bake_occlusion(texels, occluder, species.budget.ao_rays, max_distance=AO_REACH * anatomy.unit)
    mosaic = facet_mosaic(anatomy.eyes[0], species.budget.eye_facets, rng)
    return bake_eye(texels, anatomy.eyes[0], mosaic, species.palette, occlusion)


def write_glb(
    anatomy: FlyAnatomy,
    parts: FlyParts,
    atlas: ChitinAtlas,
    chitin: ChitinImages,
    eye_images: EyeImages,
    wing_image: ByteImage,
    path: Path,
) -> dict[str, int]:
    """Schreibt Materialien, Netze, Knoten und Animationen; liefert Dreiecke je Primitive."""
    species = anatomy.species
    prefix = species.model
    builder = GltfBuilder(generator=f"modelkit fly ({species.key})")
    textures = FlyTextures(
        body_color=builder.add_texture(f"{prefix}_Body_lod0_color", chitin.color),
        body_orm=builder.add_texture(f"{prefix}_Body_lod0_orm", chitin.orm),
        body_normal=builder.add_texture(f"{prefix}_Body_lod0_normal", chitin.normal),
        body_sheen=None if chitin.sheen is None else builder.add_texture(f"{prefix}_Body_lod0_sheen", chitin.sheen),
        eye_color=builder.add_texture(f"{prefix}_Eye_lod0_color", eye_images.color),
        eye_orm=builder.add_texture(f"{prefix}_Eye_lod0_orm", eye_images.orm),
        eye_normal=builder.add_texture(f"{prefix}_Eye_lod0_normal", eye_images.normal),
        eye_emissive=builder.add_texture(f"{prefix}_Eye_lod0_emissive", eye_images.emissive),
        wing=builder.add_texture(f"{prefix}_Wing_lod0_color", wing_image),
    )
    for spec in fly_materials(species, textures):
        builder.add_material(spec)
    body_material, eye_material = material_name(species, Zone.BODY), material_name(species, Zone.EYE)
    wing_material, hair_material = material_name(species, Zone.WING), material_name(species, Zone.HAIR)

    head_pivot = anatomy.head.neck_joint
    proboscis_pivot = anatomy.proboscis.pivot
    pivots = {"Body": np.zeros(3), "Head": head_pivot, "Proboscis": proboscis_pivot}
    pivots |= {leg.name: leg.pivot for leg in anatomy.legs}
    tangents = atlas.split(atlas.combined.tangents())
    primitives: dict[str, list[PrimitiveData]] = {}
    for part, mesh, part_tangents in zip(atlas.parts, atlas.meshes, tangents, strict=True):
        offset = pivots[part.node]
        primitives[part.node] = [
            PrimitiveData(mesh.vertices - offset, mesh.normals, mesh.faces, body_material, uvs=mesh.uvs, tangents=part_tangents)
        ]
    for node, hair in (("Body", parts.body_hair), ("Head", parts.head_hair)):
        local = hair.translated(pivots[node])
        primitives[node].append(PrimitiveData(local.vertices, local.normals, local.faces, hair_material, colors=local.colors))
    for eye, mesh in zip(anatomy.eyes, parts.eyes, strict=True):
        primitives[eye.name] = [
            PrimitiveData(mesh.vertices - eye.center, mesh.normals, mesh.faces, eye_material, uvs=mesh.uvs, tangents=mesh.tangents())
        ]
    for wing, mesh in zip(anatomy.wings, parts.wings, strict=True):
        primitives[wing.name] = [PrimitiveData(mesh.vertices, mesh.normals, mesh.faces, wing_material, uvs=mesh.uvs)]
    meshes = {name: builder.add_mesh(f"{prefix}_{name}", items) for name, items in primitives.items()}

    def add_part(name: str, parent: str, translation: FloatArray, rotation: FloatArray | None = None) -> None:
        # Pivotknoten ohne Mesh, Mesh am Kindknoten: die Quantisierung beim Optimieren lässt den Pivot unberührt
        builder.add_node(name, parent=parent, translation=translation, rotation=rotation)
        builder.add_node(f"{name}_Mesh", parent=name, mesh=meshes[name])

    builder.add_node("Fly")
    add_part("Body", "Fly", np.zeros(3))
    add_part("Head", "Body", head_pivot)
    for eye in anatomy.eyes:
        add_part(eye.name, "Head", eye.center - head_pivot)
    add_part("Proboscis", "Head", proboscis_pivot - head_pivot)
    builder.add_node("SpitOrigin", parent="Proboscis", translation=anatomy.proboscis.spit_origin - proboscis_pivot)
    flap = flap_tracks(anatomy.wings)
    for wing, track in zip(anatomy.wings, flap, strict=True):
        add_part(wing.name, "Body", wing.root, track.quaternions[0])
    for leg in anatomy.legs:
        add_part(leg.name, "Body", leg.pivot)
    builder.add_rotation_animation("WingFlap", flap)
    builder.add_rotation_animation("Idle", idle_tracks(anatomy, np.random.default_rng(species.seed + 13)))
    builder.write_glb(path)
    return {f"{name}/{item.material}": len(item.faces) for name, items in primitives.items() for item in items}


def generate(species: Species, raw_dir: Path, texture_scale: float = 1.0) -> FlyBuild:
    """Baut eine Fliegenart und schreibt ihr Roh-glb nach ``raw_dir``."""
    timings: dict[str, float] = {}
    sizes = TextureSizes.of(species, texture_scale)
    anatomy = FlyAnatomy.build(species)
    parts = build_parts(anatomy, timings)
    with stopwatch("uv unwrap", timings):
        padding = max(2, sizes.body // 256)
        atlas = unwrap_parts(parts.chitin_parts(), UvOptions(sizes.body, padding=padding))
    occluder = parts.occluder()
    with stopwatch("bake chitin", timings):
        chitin = bake_chitin(anatomy, atlas, sizes.body, occluder)
    with stopwatch("bake eyes and wings", timings):
        eye_images = bake_eyes(anatomy, parts.eyes[0], sizes.eye, occluder)
        wing_image = wing_texture(anatomy.wings[0], WingOutline.default(), species.palette, sizes.wing, anatomy.unit)
    path = raw_dir / species.file_name
    with stopwatch("gltf", timings):
        triangles = write_glb(anatomy, parts, atlas, chitin, eye_images, wing_image, path)
    return FlyBuild(species, path, triangles, timings)


def build(raw_dir: Path) -> list[Path]:
    """Schnittstelle für ``build_all``: schreibt die Roh-glbs aller Arten und liefert ihre Pfade."""
    return [generate(species, raw_dir).path for species in SPECIES]


def format_report(result: FlyBuild) -> list[str]:
    """Kennzahlen eines Laufs als Textzeilen."""
    total = sum(result.triangles.values())
    lines = [f"{result.path.name}: {total} Dreiecke, {result.path.stat().st_size / 1024:.0f} KiB"]
    lines += [f"  {name:36s} {count:6d}" for name, count in result.triangles.items()]
    lines += [f"  {label:36s} {seconds:6.2f} s" for label, seconds in result.timings.items()]
    return lines


def main() -> None:
    """Baut die gewählten Arten in ein Ausgabeverzeichnis und gibt Kennzahlen aus."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_RAW_DIR)
    parser.add_argument("--only", default="", help="Kommagetrennte Arten: fly, brummer, queen (Standard: alle)")
    parser.add_argument("--texture-scale", type=float, default=1.0, help="Faktor auf alle Texturgrößen (Iterationen: 0.5)")
    arguments = parser.parse_args()
    keys = [key.strip() for key in arguments.only.split(",") if key.strip()]
    unknown = sorted(set(keys) - {species.key for species in SPECIES})
    if unknown:
        parser.error(f"Unbekannte Arten: {', '.join(unknown)}")
    for species in SPECIES:
        if not keys or species.key in keys:
            print("\n".join(format_report(generate(species, arguments.output_dir, arguments.texture_scale))), flush=True)


if __name__ == "__main__":
    main()
