"""Erzeugt eine stilisierte Biene als texturierte .glb (Beispielgenerator der Modell-Pipeline).

Aufbau: Körper als Smooth-Union-SDF → Marching Cubes → isotropes Remeshing auf Budget →
Beine/Fühler/Stachel als Hüllen-Röhren per Boolean → Normalen mit harten Kanten →
UV-Abwicklung (xatlas) → gebackene Texturen: Basisfarbe aus Oberflächenzonen und Streifen,
ORM (Occlusion/Roughness/Metallic) mit Embree-AO → Augen mit Facettenmuster → Flügel als
eigene Knoten mit Pivot am Ansatz und RGBA-Textur (Adern, Alpha-Verlauf) → Flügelschlag-Animation.
Maßstab Meter, +Y oben, +Z vorne (glTF), Ursprung im Bruststück (Schwerpunkt, Drehpunkt im Flug).
"""

from __future__ import annotations

import argparse
import time
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import manifold3d as m3d
import numpy as np
from modelkit.baking import bake_base_color, bake_occlusion, bake_orm, rasterize_uv
from modelkit.geometry import (
    ShadedMesh,
    TriangleMesh,
    area_weighted_normals,
    ellipsoid_solid,
    from_manifold,
    hull_tube,
    shade_with_creases,
    to_manifold,
    union_all,
)
from modelkit.gltf_writer import GltfBuilder, MaterialSpec, PrimitiveData, RotationTrack
from modelkit.meshing import decimate_quadric, remesh_to_budget
from modelkit.sdf import Ellipsoid, Sdf, SmoothUnion, TaperedCapsule, TubeChain
from modelkit.shading import (
    SurfaceSample,
    SurfaceZone,
    banded_color,
    evaluate_zones,
    smoothstep,
    solid_color,
    srgb_to_linear,
)
from modelkit.transforms import axis_angle_quaternions, rotation_matrix
from modelkit.uv import UnwrappedMesh, UvOptions, unwrap

type FloatArray = np.ndarray

# Liegt unter tools/models/; Rohdateien nach .temp/models/ im Repo-Root
DEFAULT_RAW_DIR = Path(__file__).resolve().parents[2] / ".temp" / "models"


@contextmanager
def stopwatch(label: str, timings: dict[str, float]) -> Iterator[None]:
    """Misst die Laufzeit eines Pipeline-Schritts."""
    start = time.perf_counter()
    yield
    timings[label] = time.perf_counter() - start


@dataclass(frozen=True, slots=True)
class LodSettings:
    """Detailstufe (LOD): Dreiecksbudget, Abtastdichten und Texturgrößen."""

    name: str
    body_faces: int
    tube_segments: int
    eye_segments: int
    ao_rays: int
    body_texture: int
    eye_texture: int
    wing_texture: int
    facet_degrees: float
    padding: int


@dataclass(frozen=True, slots=True)
class WingShape:
    """Umriss eines Flügellappens in Metern (Flügelform)."""

    length: float
    width: float
    sweep_degrees: float
    offset: tuple[float, float, float] = (0.0, 0.0, 0.0)


@dataclass(frozen=True, slots=True)
class WingVein:
    """Ader als Strecke in normierten Flügelkoordinaten (Spannweitenanteil, Sehnenanteil -1..1)."""

    start: tuple[float, float]
    end: tuple[float, float]
    width: float


@dataclass(frozen=True, slots=True)
class BeeBuild:
    """Ergebnis eines Generatorlaufs: geschriebene Dateien, Dreieckszahlen und Laufzeiten."""

    paths: list[Path]
    triangles: dict[str, dict[str, int]]
    timings: dict[str, float]


def mirrored_x(points: list[tuple[float, float, float]]) -> list[tuple[float, float, float]]:
    """Spiegelt Stützpunkte an der Mittelebene (linke → rechte Körperseite)."""
    return [(-x, y, z) for x, y, z in points]


class BeeModel:
    """Stilisierte Honigbiene; alle Maße in Metern, Bruststück im Ursprung (Biene)."""

    BODY_SRGB = {
        "thorax": (0.60, 0.40, 0.13),
        "head": (0.12, 0.09, 0.07),
        "yellow": (0.98, 0.77, 0.15),
        "black": (0.09, 0.07, 0.05),
        "limb": (0.08, 0.065, 0.055),
    }
    EYE_CENTER_X = 0.040
    EYE_CENTER = (0.0, 0.012, 0.095)
    EYE_RADII = (0.018, 0.032, 0.024)
    WING_ROOT = (0.026, 0.054, 0.004)
    FOREWING = WingShape(length=0.150, width=0.052, sweep_degrees=28.0)
    HINDWING = WingShape(length=0.095, width=0.034, sweep_degrees=42.0, offset=(0.006, -0.002, -0.016))
    WING_VEINS = (
        WingVein((0.0, 0.0), (0.95, 0.35), 0.0010),
        WingVein((0.0, 0.0), (0.90, -0.10), 0.0007),
        WingVein((0.0, 0.0), (0.75, -0.50), 0.0006),
        WingVein((0.0, 0.0), (0.70, 0.75), 0.0006),
        WingVein((0.0, 0.0), (0.45, -0.70), 0.0005),
        WingVein((0.30, -0.45), (0.30, 0.55), 0.0005),
        WingVein((0.55, -0.40), (0.55, 0.60), 0.0005),
        WingVein((0.78, -0.25), (0.78, 0.45), 0.0005),
    )

    def __init__(self) -> None:
        self.thorax = Ellipsoid(np.array([0.0, 0.0, 0.0]), np.array([0.062, 0.060, 0.068]))
        self.head = Ellipsoid(np.array([0.0, 0.004, 0.088]), np.array([0.050, 0.052, 0.040]))
        self.abdomen = Ellipsoid(
            np.array([0.0, -0.018, -0.135]),
            np.array([0.075, 0.072, 0.095]),
            rotation_matrix((1, 0, 0), -12.0),
        )
        self.tail = TaperedCapsule(
            np.array([0.0, -0.035, -0.195]), np.array([0.0, -0.048, -0.235]), 0.035, 0.008
        )
        self.stinger = TubeChain([(0.0, -0.048, -0.236), (0.0, -0.055, -0.258)], [0.005, 0.0008])
        self.legs = self._legs()
        self.antennae = self._antennae()

    @staticmethod
    def _legs() -> tuple[TubeChain, ...]:
        # Drei Beinpaare: Hüfte im Bruststück, Knie, Knöchel, Fuß; Hinterbeine mit Pollenkörbchen
        left = [
            (
                [
                    (0.028, -0.040, 0.035),
                    (0.060, -0.070, 0.065),
                    (0.068, -0.115, 0.080),
                    (0.072, -0.130, 0.085),
                ],
                [0.010, 0.0075, 0.0065, 0.004],
            ),
            (
                [
                    (0.030, -0.042, 0.000),
                    (0.066, -0.072, -0.005),
                    (0.074, -0.118, -0.010),
                    (0.078, -0.134, -0.012),
                ],
                [0.010, 0.0075, 0.0065, 0.004],
            ),
            (
                [
                    (0.028, -0.040, -0.030),
                    (0.064, -0.072, -0.070),
                    (0.070, -0.112, -0.115),
                    (0.074, -0.124, -0.130),
                ],
                [0.010, 0.008, 0.011, 0.004],
            ),
        ]
        chains = [TubeChain(points, radii) for points, radii in left]
        chains += [TubeChain(mirrored_x(points), radii) for points, radii in left]
        return tuple(chains)

    @staticmethod
    def _antennae() -> tuple[TubeChain, ...]:
        # Gekniete Fühler: Schaft nach oben, Geißel nach vorn außen, Kolben an der Spitze
        points = [(0.015, 0.035, 0.115), (0.020, 0.075, 0.135), (0.040, 0.095, 0.170), (0.055, 0.090, 0.200)]
        radii = [0.0045, 0.0042, 0.0040, 0.0055]
        return TubeChain(points, radii), TubeChain(mirrored_x(points), radii)

    def body_sdf(self) -> Sdf:
        """Rumpf aus Kopf, Bruststück und Hinterleib als verschachtelte Smooth-Union."""
        front = SmoothUnion([self.thorax, self.head], k=0.012)
        rear = SmoothUnion([self.abdomen, self.tail], k=0.030)
        return SmoothUnion([front, rear], k=0.020)

    def surface_zones(self) -> list[SurfaceZone]:
        """Oberflächenzonen: pelziges Bruststück, Kopf, gestreifter Hinterleib, glatte dunkle Gliedmaßen."""
        srgb = self.BODY_SRGB
        abdomen_axis = lambda points: self.abdomen.to_local(points)[:, 2] / self.abdomen.radii[2]  # noqa: E731
        stripes = banded_color(
            abdomen_axis,
            srgb["yellow"],
            srgb["black"],
            intervals=[(0.22, 0.50), (-0.14, 0.12), (-0.50, -0.24), (-3.0, -0.78)],
            feather=0.03,
        )
        limb = solid_color(srgb["limb"])
        return [
            SurfaceZone(self.thorax, solid_color(srgb["thorax"]), roughness=0.85),
            SurfaceZone(self.head, solid_color(srgb["head"]), roughness=0.75),
            SurfaceZone(SmoothUnion([self.abdomen, self.tail], k=0.030), stripes, roughness=0.55),
            *(
                SurfaceZone(chain, limb, roughness=0.45)
                for chain in (*self.legs, *self.antennae, self.stinger)
            ),
        ]

    def body_solid(self, lod: LodSettings) -> m3d.Manifold:
        """Rumpf-Netz auf Budget plus Gliedmaßen als Boolean-Vereinigung."""
        trunk = to_manifold(remesh_to_budget(self.body_sdf(), lod.body_faces))
        tubes = [hull_tube(chain, lod.tube_segments) for chain in (*self.legs, *self.antennae, self.stinger)]
        return union_all([trunk, *tubes])

    def eyes_solid(self, lod: LodSettings) -> m3d.Manifold:
        """Facettenaugen als eigene, glänzende Teilkörper."""
        return union_all(
            [
                ellipsoid_solid(
                    (side * self.EYE_CENTER_X, self.EYE_CENTER[1], self.EYE_CENTER[2]),
                    self.EYE_RADII,
                    (0.0, side * 20.0, 0.0),
                    lod.eye_segments,
                )
                for side in (1.0, -1.0)
            ]
        )

    def eye_surface(self, positions: FloatArray, facet_degrees: float) -> SurfaceSample:
        """Facettenmuster der Augen: hexagonales Raster in Blickwinkeln, glänzende Linsenmitte, matte Ränder."""
        side = np.where(positions[:, 0] >= 0.0, 1.0, -1.0)
        center = np.stack(
            [side * self.EYE_CENTER_X, np.full(len(side), self.EYE_CENTER[1]), np.full(len(side), self.EYE_CENTER[2])],
            axis=1,
        )
        direction = (positions - center) / np.asarray(self.EYE_RADII)
        direction /= np.linalg.norm(direction, axis=1, keepdims=True)
        elevation = np.degrees(np.arcsin(np.clip(direction[:, 1], -1.0, 1.0)))
        azimuth = np.degrees(np.arctan2(direction[:, 0] * side, direction[:, 2])) * np.cos(np.radians(elevation))
        t = hex_cell_edge_factor(azimuth / facet_degrees, elevation / facet_degrees)
        edge = smoothstep(0.55, 0.95, t)
        lens = srgb_to_linear((0.20, 0.09, 0.05))
        rim = srgb_to_linear((0.025, 0.02, 0.02))
        color = lens[None, :] * (1.0 - edge[:, None]) + rim[None, :] * edge[:, None]
        return SurfaceSample(color, 0.10 + 0.40 * edge, np.zeros(len(positions)))

    @classmethod
    def wing_lobe(
        cls, shape: WingShape, segments: int = 28, rings: int = 4, camber: float = 0.04
    ) -> tuple[TriangleMesh, FloatArray]:
        """Flügellappen als Ringfächer um einen Punkt nahe der Wurzel.

        Liefert das Netz und je Eckpunkt die Attribute (Spannweite ab Mitte, Sehne, Randanteil,
        Spannweitenanteil, Länge, halbe Breite) für das Backen des Aderndesigns.
        """
        phi = np.linspace(0.0, 2.0 * np.pi, segments, endpoint=False)
        span = 0.5 * shape.length * (1.0 - np.cos(phi))
        chord = 0.5 * shape.width * np.sin(phi) * (1.0 - 0.3 * np.cos(phi))
        center = np.array([0.06 * shape.length, 0.0])
        outline = np.stack([span, chord], axis=1)
        fractions = np.arange(1, rings + 1) / rings
        ring_points = (
            center[None, None, :] + (outline[None, :, :] - center[None, None, :]) * fractions[:, None, None]
        )
        flat = np.concatenate([center[None, :], ring_points.reshape(-1, 2)])
        span_fraction = flat[:, 0] / shape.length
        # Wölbung nach oben entlang der Spannweite, danach Pfeilung nach hinten
        heights = camber * shape.length * np.sin(np.pi * np.clip(span_fraction, 0.0, 1.0))
        local = np.stack([flat[:, 0], heights, flat[:, 1]], axis=1)
        vertices = local @ rotation_matrix((0, 1, 0), shape.sweep_degrees).T + np.asarray(shape.offset)

        faces: list[tuple[int, int, int]] = []
        ring_start = lambda ring: 1 + ring * segments  # noqa: E731
        for i in range(segments):
            j = (i + 1) % segments
            faces.append((0, ring_start(0) + j, ring_start(0) + i))
            for ring in range(rings - 1):
                a, b = ring_start(ring) + i, ring_start(ring) + j
                c, d = ring_start(ring + 1) + i, ring_start(ring + 1) + j
                faces += [(a, b, d), (a, d, c)]
        mesh = TriangleMesh(vertices, np.asarray(faces, dtype=np.int64))
        radial = np.concatenate([[0.0], np.repeat(fractions, segments)])
        count = len(vertices)
        attributes = np.stack(
            [
                flat[:, 0] - center[0],
                flat[:, 1] - center[1],
                radial,
                span_fraction,
                np.full(count, shape.length),
                np.full(count, 0.5 * shape.width),
            ],
            axis=1,
        )
        return mesh, attributes

    @classmethod
    def wing_source(cls) -> tuple[ShadedMesh, FloatArray]:
        """Vorder- und Hinterflügel einer linken Seite als ein Netz mit Eckpunkt-Attributen, Pivot im Ursprung."""
        lobes = [cls.wing_lobe(cls.FOREWING), cls.wing_lobe(cls.HINDWING)]
        mesh = TriangleMesh.concatenate(lobe for lobe, _ in lobes)
        attributes = np.concatenate([attr for _, attr in lobes])
        faces = mesh.faces
        normals = area_weighted_normals(mesh.vertices, faces)
        if normals[:, 1].mean() < 0.0:
            faces, normals = faces[:, ::-1].copy(), -normals
        return ShadedMesh(mesh.vertices, normals, faces), attributes

    @classmethod
    def wing_surface(cls, attributes: FloatArray) -> tuple[FloatArray, FloatArray]:
        """Membranfarbe (linear RGB) und Alpha aus den Flügelattributen: Adern, Randader, Verlauf Wurzel → Spitze."""
        dx, dz, radial, span, length, half_width = attributes.T
        point = np.stack([dx, dz], axis=1)
        scale = np.stack([length, half_width], axis=1)
        feather = 0.00025  # Kantenweichheit der Adern (m), etwa ein Texel
        vein = np.zeros(len(attributes))
        for segment in cls.WING_VEINS:
            start = np.asarray(segment.start) * scale
            end = np.asarray(segment.end) * scale
            along = end - start
            t = np.clip(((point - start) * along).sum(axis=1) / (along * along).sum(axis=1), 0.0, 1.0)
            distance = np.linalg.norm(point - (start + t[:, None] * along), axis=1)
            vein = np.maximum(vein, 1.0 - smoothstep(0.5 * segment.width, 0.5 * segment.width + feather, distance))
        rim = smoothstep(0.93, 0.985, radial)
        ink = np.maximum(vein, rim)

        t = np.clip(span, 0.0, 1.0) ** 0.6
        membrane = (
            srgb_to_linear((0.80, 0.70, 0.50))[None, :] * (1.0 - t)[:, None]
            + srgb_to_linear((0.92, 0.96, 1.0))[None, :] * t[:, None]
        )
        membrane_alpha = 0.50 * (1.0 - t) + 0.18 * t
        vein_color = srgb_to_linear((0.30, 0.20, 0.10))
        color = membrane * (1.0 - ink[:, None]) + vein_color[None, :] * ink[:, None]
        alpha = membrane_alpha * (1.0 - ink) + 0.9 * ink
        return color, alpha


def hex_cell_edge_factor(x: FloatArray, y: FloatArray) -> FloatArray:
    """Randnähe in einem hexagonalen Raster mit Zellbreite 1: 0 in der Zellmitte, 1 am Zellrand."""
    cell = np.array([1.0, np.sqrt(3.0)])
    half = cell * 0.5
    point = np.stack([x, y], axis=1)
    a = np.mod(point, cell) - half
    b = np.mod(point - half, cell) - half
    local = np.where(((a * a).sum(axis=1) < (b * b).sum(axis=1))[:, None], a, b)
    folded = np.abs(local)
    return np.clip(np.maximum(folded[:, 0], folded @ np.array([0.5, np.sqrt(3.0) / 2.0])) / 0.5, 0.0, 1.0)


def flap_tracks(
    period: float = 0.125, keys: int = 9, offset: float = 12.0, amplitude: float = 48.0
) -> list[RotationTrack]:
    """Flügelschlag: Sinus um die Längsachse (+Z), rechte Seite gespiegelt; erster = letzter Key für Loop."""
    times = np.linspace(0.0, period, keys)
    angles = offset + amplitude * np.sin(2.0 * np.pi * times / period)
    return [
        RotationTrack("Wing_L", times, axis_angle_quaternions((0, 0, 1), angles)),
        RotationTrack("Wing_R", times, axis_angle_quaternions((0, 0, 1), -angles)),
    ]


def primitive_from(mesh: UnwrappedMesh, material: str) -> PrimitiveData:
    """Render-Primitive eines abgewickelten Netzes."""
    return PrimitiveData(mesh.vertices, mesh.normals, mesh.faces, material, uvs=mesh.uvs)


def write_bee(
    model: BeeModel, body_solid: m3d.Manifold, lod: LodSettings, path: Path, timings: dict[str, float]
) -> dict[str, int]:
    """Schattiert, wickelt ab, backt und schreibt eine Detailstufe; liefert Dreieckszahlen je Teil."""
    with stopwatch(f"{lod.name}: normals", timings):
        body = shade_with_creases(body_solid, sharp_angle_degrees=60.0)
        eyes = shade_with_creases(model.eyes_solid(lod), sharp_angle_degrees=60.0)
    with stopwatch(f"{lod.name}: uv unwrap", timings):
        body_uv = unwrap(body, UvOptions(lod.body_texture, padding=lod.padding))
        eyes_uv = unwrap(eyes, UvOptions(lod.eye_texture, padding=lod.padding))
        wing_source, wing_attributes = BeeModel.wing_source()
        wing_uv = unwrap(wing_source, UvOptions(lod.wing_texture, padding=lod.padding))
    occluder = TriangleMesh.concatenate([body.as_triangle_mesh(), eyes.as_triangle_mesh()])
    with stopwatch(f"{lod.name}: bake body", timings):
        texels = rasterize_uv(body_uv, lod.body_texture)
        surface = evaluate_zones(texels.positions, model.surface_zones(), softness=0.004)
        occlusion = bake_occlusion(texels, occluder, lod.ao_rays, max_distance=0.05)
        body_color = bake_base_color(texels, surface.color)
        body_orm = bake_orm(texels, occlusion, surface.roughness, surface.metallic)
    with stopwatch(f"{lod.name}: bake eyes", timings):
        texels = rasterize_uv(eyes_uv, lod.eye_texture)
        surface = model.eye_surface(texels.positions, lod.facet_degrees)
        occlusion = bake_occlusion(texels, occluder, lod.ao_rays, max_distance=0.05)
        eye_color = bake_base_color(texels, surface.color)
        eye_orm = bake_orm(texels, occlusion, surface.roughness, surface.metallic)
    with stopwatch(f"{lod.name}: bake wings", timings):
        texels = rasterize_uv(wing_uv, lod.wing_texture)
        color, alpha = BeeModel.wing_surface(texels.interpolate(wing_uv.take(wing_attributes)))
        wing_color = bake_base_color(texels, color, alpha)
    with stopwatch(f"{lod.name}: gltf", timings):
        builder = GltfBuilder(generator="modelkit bee")
        body_color_tex = builder.add_texture(f"Bee_Body_{lod.name}_color", body_color)
        body_orm_tex = builder.add_texture(f"Bee_Body_{lod.name}_orm", body_orm)
        eye_color_tex = builder.add_texture(f"Bee_Eye_{lod.name}_color", eye_color)
        eye_orm_tex = builder.add_texture(f"Bee_Eye_{lod.name}_orm", eye_orm)
        wing_color_tex = builder.add_texture(f"Bee_Wing_{lod.name}_color", wing_color)
        for name, color_tex, orm_tex in (
            ("Bee_Body", body_color_tex, body_orm_tex),
            ("Bee_Eye", eye_color_tex, eye_orm_tex),
        ):
            builder.add_material(
                MaterialSpec(
                    name,
                    metallic=1.0,
                    roughness=1.0,
                    base_color_texture=color_tex,
                    metallic_roughness_texture=orm_tex,
                    occlusion_texture=orm_tex,
                )
            )
        builder.add_material(
            MaterialSpec(
                "Bee_Wing",
                roughness=0.25,
                alpha_mode="BLEND",
                double_sided=True,
                base_color_texture=wing_color_tex,
            )
        )
        body_mesh = builder.add_mesh(
            "Bee_Body", [primitive_from(body_uv, "Bee_Body"), primitive_from(eyes_uv, "Bee_Eye")]
        )
        wing_l = builder.add_mesh("Bee_Wing_L", [primitive_from(wing_uv, "Bee_Wing")])
        wing_r = builder.add_mesh("Bee_Wing_R", [primitive_from(wing_uv.mirrored_x(), "Bee_Wing")])
        tracks = flap_tracks()
        root_l = np.array(BeeModel.WING_ROOT)
        builder.add_node("Bee")
        builder.add_node("Body", parent="Bee", mesh=body_mesh)
        builder.add_node(
            "Wing_L", parent="Bee", mesh=wing_l, translation=root_l, rotation=tracks[0].quaternions[0]
        )
        builder.add_node(
            "Wing_R",
            parent="Bee",
            mesh=wing_r,
            translation=root_l * [-1, 1, 1],
            rotation=tracks[1].quaternions[0],
        )
        builder.add_rotation_animation("WingFlap", tracks)
        builder.write_glb(path)
    return {
        "body": len(body_uv.faces),
        "eyes": len(eyes_uv.faces),
        "wings": 2 * len(wing_uv.faces),
        "body_vertices": len(body_uv.vertices),
    }


def generate(raw_dir: Path) -> BeeBuild:
    """Baut LOD0 und LOD1 als Roh-glb in ``raw_dir``."""
    timings: dict[str, float] = {}
    model = BeeModel()
    lod0 = LodSettings(
        "lod0", body_faces=5000, tube_segments=10, eye_segments=24, ao_rays=64,
        body_texture=1024, eye_texture=256, wing_texture=512, facet_degrees=7.0, padding=4,
    )  # fmt: skip
    lod1 = LodSettings(
        "lod1", body_faces=1500, tube_segments=8, eye_segments=12, ao_rays=32,
        body_texture=512, eye_texture=128, wing_texture=256, facet_degrees=14.0, padding=2,
    )  # fmt: skip
    path0 = raw_dir / "bee.glb"
    path1 = raw_dir / "bee-lod1.glb"

    with stopwatch("lod0: body mesh+boolean", timings):
        solid0 = model.body_solid(lod0)
    stats0 = write_bee(model, solid0, lod0, path0, timings)

    with stopwatch("lod1: decimate", timings):
        solid1 = to_manifold(decimate_quadric(from_manifold(solid0), lod1.body_faces))
    stats1 = write_bee(model, solid1, lod1, path1, timings)
    return BeeBuild([path0, path1], {"lod0": stats0, "lod1": stats1}, timings)


def build(raw_dir: Path) -> list[Path]:
    """Schnittstelle für ``build_all``: schreibt die Roh-glbs und liefert deren Pfade."""
    return generate(raw_dir).paths


def format_report(result: BeeBuild) -> Sequence[str]:
    """Kennzahlen eines Laufs als Textzeilen."""
    lines = []
    for path, (name, stats) in zip(result.paths, result.triangles.items(), strict=True):
        total = stats["body"] + stats["eyes"] + stats["wings"]
        lines.append(f"{name}: tris total={total} {stats} size={path.stat().st_size / 1024:.1f} KiB -> {path.name}")
    lines += [f"  {label:28s} {seconds:6.2f} s" for label, seconds in result.timings.items()]
    lines.append(f"  {'total':28s} {sum(result.timings.values()):6.2f} s")
    return lines


def main() -> None:
    """Baut die Biene in ein Ausgabeverzeichnis und gibt Kennzahlen aus."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_RAW_DIR)
    args = parser.parse_args()
    print("\n".join(format_report(generate(args.output_dir))))


if __name__ == "__main__":
    main()
