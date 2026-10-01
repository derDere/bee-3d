"""Erzeugt die Spielfigur Biene nach dem CSS-Vorbild aus bee-bee als texturierte .glb (Biene).

Brief: Spielerfigur und Mitspieler in bee-3d, Kameradistanz 1–8 m. Stil: dem Vorbild treu —
Farben, Teile und Proportionen aus ``bee.css`` (Proportionsliste in ``beekit.anatomy``) —, mit
niedlich-lustigem Gesicht in einheitlicher Comic-Stilisierung (große runde Augen, gemalte Pupillen
mit festen Glanzlichtern, Lächeln, Bäckchen) und einem Körper zwischen Biene und Wespe: pelzige
Brust und pelziger Kopf mit Sheen, schlanker Hals, Wespentaille, glänzende überlappende
Hinterleibsplatten, gegliederte Fühler, Beine mit Fußgliedern und Krallen, vier geäderte,
schillernde Flügel. Maße: 0,58 m vom Kopf bis zur Stachelspitze, Ursprung in der Bienenmitte
(Bezugspunkt im Spiel), +Z Blickrichtung. Budget ≤ 16.000 Dreiecke; Körpertexturen 1024²
(Farbe, ORM, Normal-Map), Sheen- und Leuchtmasken 512², Augen 256², Flügel 512².

Der Körper ist eine geschlossene Hülle ohne innere Flächen; Augen, Fühler, Beine und Flügel sind
eigene Teile mit Pivot im Gelenk und enden in Ruhehaltung auf der Haut bzw. sitzen mit Luft in
ihren Augenhöhlen — durchscheinende Zustände (Geist) zeigen nur Außenhäute.

Fähigkeiten des Vorbilds und ihre Umsetzung:

| Vorbild (bee.js/bee.css) | Modell |
|---|---|
| Flügelschlag im 50-ms-Takt | Knoten ``Wing_L``/``Wing_R`` mit Pivot im Gelenk, Animation ``WingFlap`` (0,1 s, Schleife) |
| Blick nach links oder rechts | Knoten ``Bee`` drehen |
| Nacht: dunkle Ringe und Fühlerkugeln leuchten | Materialvariante ``Night`` |
| Laser: Ringränder rot, Pupillen rot und verdreht, offener Mund, Strahl aus dem Mund | Variante ``Laser``, Formziel ``Shout`` am Mund, Knoten ``Eye_L``/``Eye_R`` drehen, Strahl ab ``LaserOrigin`` |
| Geist: durchscheinend cyan, kleine hohle Augen, Bogenmund | Variante ``Ghost``, Formziel ``Ghost`` am Mund |
| Lebensbalken über der Biene | Knoten ``HealthBar`` |

Knoten: ``Bee`` → ``Body`` → ``Face`` (Kopfmitte) → ``Eye_L``/``Eye_R`` (Pivot in der
Augenmitte), ``Antenna_L``/``Antenna_R`` (Pivot am Ansatz), ``Mouth``, ``LaserOrigin``;
``Body`` → ``Leg_*`` (Pivot in der Hüfte), ``Wing_L``/``Wing_R``; ``Bee`` → ``HealthBar``. Jeder
bewegliche Knoten trägt sein Mesh am Kindknoten ``<Name>_Mesh``; das Spiel dreht den Pivotknoten.
Varianten und Materialien: ``beekit.look``.
"""

from __future__ import annotations

import argparse
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import numpy.typing as npt
from beekit.anatomy import BeeAnatomy
from beekit.body import BodyField, build_shell
from beekit.eyes import EyeballMesh, EyeImages, eye_textures, eyeball_mesh
from beekit.face import DecalMesh, MouthDecals, mouth_decals
from beekit.limbs import LimbPart, antenna_part, leg_part, stinger_solid
from beekit.look import VARIANTS, BeeTextures, bee_materials, variants_for
from beekit.painting import ShellPainter
from beekit.wings import WingMesh, flap_tracks, wing_mesh, wing_texture
from modelkit.baking import bake_base_color, bake_normal_map, bake_occlusion, bake_orm, rasterize_uv
from modelkit.geometry import TriangleMesh
from modelkit.gltf_writer import GltfBuilder, PrimitiveData
from modelkit.uv import UnwrappedMesh, UvOptions, unwrap

type FloatArray = npt.NDArray[np.float64]
type ByteImage = npt.NDArray[np.uint8]

# Liegt unter tools/models/; Rohdateien nach .temp/models/ im Repo-Root
DEFAULT_RAW_DIR = Path(__file__).resolve().parents[2] / ".temp" / "models"


@contextmanager
def stopwatch(label: str, timings: dict[str, float]) -> Iterator[None]:
    """Misst die Laufzeit eines Pipeline-Schritts."""
    start = time.perf_counter()
    yield
    timings[label] = time.perf_counter() - start


@dataclass(frozen=True, slots=True)
class BeeSettings:
    """Budget, Texturgrößen und Abtastdichten eines Generatorlaufs (Einstellungen)."""

    shell_faces: int = 6500  # Rumpf vor der Vereinigung mit dem Stachel
    body_texture: int = 1024
    wing_texture: int = 512
    eye_texture: int = 256
    ao_rays: int = 64
    ao_distance: float = 0.03  # m, rund 6 % der Körperlänge
    padding: int = 4


@dataclass(frozen=True, slots=True)
class BodyImages:
    """Gebackene Texturen der Körperhülle (Körpertexturen)."""

    color: ByteImage
    orm: ByteImage
    normal: ByteImage
    sheen: ByteImage
    night: ByteImage
    laser: ByteImage
    ghost: ByteImage


@dataclass(frozen=True, slots=True)
class BeeParts:
    """Alle Teile der Biene (Teile): Hülle, Augen, Fühler, Beine, Mund, Flügel."""

    body: UnwrappedMesh
    eyes: list[EyeballMesh]
    antennae: list[LimbPart]
    legs: list[LimbPart]
    mouth: MouthDecals
    wings: list[WingMesh]

    def occluder(self, anatomy: BeeAnatomy) -> TriangleMesh:
        """Alle deckenden Teile in Ruhehaltung als Verdecker für die gebackene AO."""
        meshes = [TriangleMesh(self.body.vertices, self.body.faces)]
        meshes += [mesh for part in (*self.antennae, *self.legs) for mesh in part.solids_in_model()]
        meshes += [TriangleMesh(mesh.vertices + eye.center, mesh.faces) for eye, mesh in zip(anatomy.eyes, self.eyes, strict=True)]
        return TriangleMesh.concatenate(meshes)


@dataclass(frozen=True, slots=True)
class BeeBuild:
    """Ergebnis eines Generatorlaufs: Datei, Dreiecke je Primitive und Laufzeiten."""

    path: Path
    triangles: dict[str, int]
    timings: dict[str, float]


def half_size(image: ByteImage) -> ByteImage:
    """Halbiert die Kantenlänge (2 × 2 gemittelt) — für Masken, die keine volle Auflösung brauchen."""
    height, width = image.shape[:2]
    blocks = image.reshape(height // 2, 2, width // 2, 2, -1).astype(np.float64)
    return np.round(blocks.mean(axis=(1, 3))).astype(np.uint8)


def bake_body(parts: BeeParts, anatomy: BeeAnatomy, painter: ShellPainter, settings: BeeSettings) -> BodyImages:
    """Rasterisiert die Hülle, backt AO und bemalt Farbe, Rauheit, Detailnormalen, Sheen und Leuchtmasken."""
    texels = rasterize_uv(parts.body, settings.body_texture)
    occlusion = bake_occlusion(texels, parts.occluder(anatomy), settings.ao_rays, max_distance=settings.ao_distance)
    surface = painter.paint(texels, occlusion)
    return BodyImages(
        color=bake_base_color(texels, surface.color),
        orm=bake_orm(texels, occlusion, surface.roughness, np.zeros(texels.count)),
        normal=bake_normal_map(texels, parts.body.tangents(), surface.normals),
        sheen=half_size(bake_base_color(texels, surface.sheen)),
        night=half_size(bake_base_color(texels, surface.night)),
        laser=half_size(bake_base_color(texels, surface.laser)),
        ghost=half_size(bake_base_color(texels, surface.ghost)),
    )


def _decal_primitive(decal: DecalMesh, material: str) -> PrimitiveData:
    return PrimitiveData(
        decal.vertices, decal.normals, decal.faces, material, targets=decal.morph_targets(), variants=variants_for(material)
    )


def _limb_primitives(part: LimbPart) -> list[PrimitiveData]:
    return [
        PrimitiveData(mesh.vertices, mesh.normals, mesh.faces, material, variants=variants_for(material))
        for material, mesh in part.pieces.items()
    ]


def write_glb(
    anatomy: BeeAnatomy, parts: BeeParts, body_images: BodyImages, eye_images: EyeImages, wing_image: ByteImage, path: Path
) -> dict[str, int]:
    """Schreibt Materialien, Varianten, Netze, Knoten und Animation; liefert Dreiecke je Primitive."""
    builder = GltfBuilder(generator="modelkit bee")
    builder.add_material_variants(VARIANTS)
    textures = BeeTextures(
        body_color=builder.add_texture("Bee_Body_lod0_color", body_images.color),
        body_orm=builder.add_texture("Bee_Body_lod0_orm", body_images.orm),
        body_normal=builder.add_texture("Bee_Body_lod0_normal", body_images.normal),
        body_sheen=builder.add_texture("Bee_Body_lod0_sheen", body_images.sheen),
        night=builder.add_texture("Bee_Body_Night_lod0_emissive", body_images.night),
        laser=builder.add_texture("Bee_Body_Laser_lod0_emissive", body_images.laser),
        ghost=builder.add_texture("Bee_Body_Ghost_lod0_emissive", body_images.ghost),
        eye=builder.add_texture("Bee_Eye_lod0_color", eye_images.day),
        eye_laser=builder.add_texture("Bee_Eye_Laser_lod0_emissive", half_size(eye_images.laser)),
        eye_ghost=builder.add_texture("Bee_Eye_Ghost_lod0_color", eye_images.ghost),
        eye_ghost_glow=builder.add_texture("Bee_Eye_Ghost_lod0_emissive", half_size(eye_images.ghost_glow)),
        wing=builder.add_texture("Bee_Wing_lod0_color", wing_image),
    )
    for spec in bee_materials(textures):
        builder.add_material(spec)

    body = parts.body
    head_center = anatomy.head.center
    mouth_origin = parts.mouth.fill.vertices[len(parts.mouth.fill.vertices) // 2]
    primitives: dict[str, list[PrimitiveData]] = {
        "Bee_Body": [
            PrimitiveData(
                body.vertices,
                body.normals,
                body.faces,
                "Bee_Body",
                uvs=body.uvs,
                tangents=body.tangents(),
                variants=variants_for("Bee_Body"),
            )
        ],
        "Bee_Mouth": [
            _decal_primitive(parts.mouth.fill.translated(mouth_origin), "Bee_Mouth"),
            _decal_primitive(parts.mouth.rim.translated(mouth_origin), "Bee_MouthRim"),
        ],
    }
    for eye, mesh in zip(anatomy.eyes, parts.eyes, strict=True):
        primitives[f"Bee_{eye.name}"] = [
            PrimitiveData(mesh.vertices, mesh.normals, mesh.faces, "Bee_Eye", uvs=mesh.uvs, variants=variants_for("Bee_Eye"))
        ]
    for part in (*parts.antennae, *parts.legs):
        primitives[f"Bee_{part.name}"] = _limb_primitives(part)
    for wing, wing_part in zip(anatomy.wings, parts.wings, strict=True):
        primitives[f"Bee_{wing.name}"] = [
            PrimitiveData(
                wing_part.vertices,
                wing_part.normals,
                wing_part.faces,
                "Bee_Wing",
                uvs=wing_part.uvs,
                variants=variants_for("Bee_Wing"),
            )
        ]
    meshes = {name: builder.add_mesh(name, items) for name, items in primitives.items()}

    def add_part(name: str, parent: str, translation: FloatArray, rotation: FloatArray | None = None) -> None:
        # Pivotknoten ohne Mesh, Mesh am Kindknoten: die Quantisierung beim Optimieren lässt den Pivot unberührt
        builder.add_node(name, parent=parent, translation=translation, rotation=rotation)
        builder.add_node(f"{name}_Mesh", parent=name, mesh=meshes[f"Bee_{name}"])

    builder.add_node("Bee")
    add_part("Body", "Bee", np.zeros(3))
    builder.add_node("Face", parent="Body", translation=head_center)
    for eye in anatomy.eyes:
        add_part(eye.name, "Face", eye.center - head_center)
    for part in parts.antennae:
        add_part(part.name, "Face", part.pivot - head_center)
    add_part("Mouth", "Face", mouth_origin - head_center)
    builder.add_node("LaserOrigin", parent="Face", translation=parts.mouth.laser_origin - head_center)
    for part in parts.legs:
        add_part(part.name, "Body", part.pivot)
    tracks = flap_tracks(anatomy)
    for wing, track in zip(anatomy.wings, tracks, strict=True):
        add_part(wing.name, "Body", wing.root, track.quaternions[0])
    builder.add_node("HealthBar", parent="Bee", translation=anatomy.health_bar)
    builder.add_rotation_animation("WingFlap", tracks)
    builder.write_glb(path)
    return {
        f"{name}/{primitive.material}": len(primitive.faces) for name, items in primitives.items() for primitive in items
    }


def build_parts(anatomy: BeeAnatomy, field: BodyField, settings: BeeSettings, timings: dict[str, float]) -> BeeParts:
    """Hülle vernetzen und abwickeln, Glieder an der Hülle beschneiden, Augen, Mund und Flügel erzeugen."""
    with stopwatch("shell", timings):
        shell = build_shell(field, stinger_solid(anatomy.stinger), settings.shell_faces)
    with stopwatch("uv unwrap", timings):
        body = unwrap(shell.mesh, UvOptions(settings.body_texture, padding=settings.padding))
    with stopwatch("limbs, eyes, mouth, wings", timings):
        return BeeParts(
            body=body,
            eyes=[eyeball_mesh(eye) for eye in anatomy.eyes],
            antennae=[antenna_part(antenna, shell.solid) for antenna in anatomy.antennae],
            legs=[leg_part(leg, shell.solid) for leg in anatomy.legs],
            mouth=mouth_decals(field),
            wings=[wing_mesh(wing) for wing in anatomy.wings],
        )


def generate(raw_dir: Path, settings: BeeSettings | None = None) -> BeeBuild:
    """Baut die Biene und schreibt ``bee.glb`` nach ``raw_dir``."""
    settings = settings or BeeSettings()
    timings: dict[str, float] = {}
    anatomy = BeeAnatomy.from_css()
    field = BodyField(anatomy)
    parts = build_parts(anatomy, field, settings, timings)
    with stopwatch("bake body", timings):
        body_images = bake_body(parts, anatomy, ShellPainter(field), settings)
    with stopwatch("bake eyes and wings", timings):
        eye_images = eye_textures(settings.eye_texture)
        wing_image = wing_texture(anatomy.wings[0], settings.wing_texture)
    path = raw_dir / "bee.glb"
    with stopwatch("gltf", timings):
        triangles = write_glb(anatomy, parts, body_images, eye_images, wing_image, path)
    return BeeBuild(path, triangles, timings)


def build(raw_dir: Path) -> list[Path]:
    """Schnittstelle für ``build_all``: schreibt das Roh-glb und liefert seinen Pfad."""
    return [generate(raw_dir).path]


def format_report(result: BeeBuild) -> list[str]:
    """Kennzahlen eines Laufs als Textzeilen."""
    total = sum(result.triangles.values())
    lines = [f"{result.path.name}: {total} Dreiecke, {result.path.stat().st_size / 1024:.0f} KiB"]
    lines += [f"  {name:32s} {count:6d}" for name, count in result.triangles.items()]
    lines += [f"  {label:32s} {seconds:6.2f} s" for label, seconds in result.timings.items()]
    return lines


def main() -> None:
    """Baut die Biene in ein Ausgabeverzeichnis und gibt Kennzahlen aus."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_RAW_DIR)
    parser.add_argument("--texture", type=int, default=1024, help="Kantenlänge der Körpertextur (Iterationen: 512)")
    arguments = parser.parse_args()
    settings = BeeSettings(body_texture=arguments.texture, wing_texture=max(256, arguments.texture // 2))
    print("\n".join(format_report(generate(arguments.output_dir, settings))))


if __name__ == "__main__":
    main()
