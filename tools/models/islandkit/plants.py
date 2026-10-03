"""Grasbüschel, Blumen, Seerosen und Pilze als Geometrie mit Vertexfarben (Wiesenpflanzen).

Halme, Stängel, Blätter und Blütenblätter sind Bänder bzw. Röhren entlang gebogener Kurven;
Farben liegen als lineare Vertexfarben vor. Grünteile teilen das Material ``Flora_Plant``
(doppelseitig, ohne Textur). Blüten bilden eine eigene Primitive mit dem Material
``Flora_Blossom_<Art>``: Ihre UVs zeigen in die Leuchtmaske der Art (``islandkit.blossoms``),
damit das Spiel nachts nur die Blüten leuchten lässt. Ursprung am Fuß der Pflanze (y = 0),
lokales y ist die Höhe über der Wurzel — so biegt der Wind-Shader des Spiels die Pflanze ab dem
Boden. Seerosen liegen mit y = 0 auf dem Wasserspiegel.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from modelkit.shading import srgb_to_linear
from modelkit.sweep import SweptMesh, sweep_ribbon, sweep_tube

type FloatArray = npt.NDArray[np.float64]
type IndexArray = npt.NDArray[np.int64]
type Srgb = tuple[float, float, float]

_UP = np.array([0.0, 1.0, 0.0])
_GOLDEN_ANGLE = 137.507764

# Bereiche der Leuchtmaske in UV: Blütenblätter links, Blütenmitte rechts (islandkit.blossoms)
PETAL_U = (0.0, 0.75)
CENTER_U = (0.82, 0.96)


@dataclass(frozen=True, slots=True)
class ColoredMesh:
    """Netz mit linearen Vertexfarben und optionalen UVs (farbiges Netz)."""

    vertices: FloatArray
    normals: FloatArray
    faces: IndexArray
    colors: FloatArray
    uvs: FloatArray | None = None

    @staticmethod
    def from_swept(mesh: SweptMesh, colors: FloatArray) -> ColoredMesh:
        return ColoredMesh(mesh.vertices, mesh.normals, mesh.faces, colors)

    @staticmethod
    def concatenate(meshes: Iterable[ColoredMesh]) -> ColoredMesh:
        """Fügt Netze zusammen; UVs bleiben nur erhalten, wenn alle Teile welche tragen."""
        parts = list(meshes)
        offsets = np.cumsum([0] + [len(m.vertices) for m in parts[:-1]])
        with_uvs = all(m.uvs is not None for m in parts)
        return ColoredMesh(
            np.concatenate([m.vertices for m in parts]),
            np.concatenate([m.normals for m in parts]),
            np.concatenate([m.faces + o for m, o in zip(parts, offsets, strict=True)]),
            np.concatenate([m.colors for m in parts]),
            np.concatenate([m.uvs for m in parts if m.uvs is not None]) if with_uvs else None,
        )

    def transformed(self, rotation: FloatArray, translation: FloatArray) -> ColoredMesh:
        return ColoredMesh(
            self.vertices @ rotation.T + translation, self.normals @ rotation.T, self.faces, self.colors, self.uvs
        )

    def scaled(self, factor: float) -> ColoredMesh:
        """Gleichmäßig skaliertes Netz (Normalen bleiben)."""
        return ColoredMesh(self.vertices * factor, self.normals, self.faces, self.colors, self.uvs)

    @property
    def triangle_count(self) -> int:
        return int(len(self.faces))

    @property
    def height(self) -> float:
        """Höhe über dem Fuß in m."""
        return float(self.vertices[:, 1].max())


@dataclass(frozen=True, slots=True)
class BloomingPlant:
    """Pflanze mit Blüten (blühende Pflanze): Grünteile (``Flora_Plant``) und Blüten mit Masken-UVs."""

    plant: ColoredMesh
    blossom: ColoredMesh

    @property
    def triangle_count(self) -> int:
        return self.plant.triangle_count + self.blossom.triangle_count

    @property
    def height(self) -> float:
        return max(self.plant.height, self.blossom.height)

    def scaled(self, factor: float) -> BloomingPlant:
        return BloomingPlant(self.plant.scaled(factor), self.blossom.scaled(factor))


def _gradient(stops: Sequence[Srgb], t: FloatArray) -> FloatArray:
    """Farbverlauf (linear) über gleichmäßig verteilte Stützfarben."""
    colors = np.array([srgb_to_linear(c) for c in stops])
    if len(colors) == 1:
        return np.tile(colors[0], (len(t), 1))
    position = np.clip(t, 0.0, 1.0) * (len(colors) - 1)
    low = np.floor(position).astype(int).clip(0, len(colors) - 2)
    blend = (position - low)[:, None]
    return colors[low] * (1.0 - blend) + colors[low + 1] * blend


def _soften(normals: FloatArray, amount: float) -> FloatArray:
    """Neigt Normalen nach oben — dünne Pflanzenteile wirken dadurch weich schattiert."""
    blended = normals * (1.0 - amount) + _UP * amount
    return blended / np.linalg.norm(blended, axis=1, keepdims=True)


def _bent_path(base: FloatArray, direction: FloatArray, length: float, droop: float, nodes: int) -> FloatArray:
    """Kurve, die in ``direction`` startet und sich unter ``droop`` (Anteil der Länge) nach unten neigt."""
    t = np.linspace(0.0, 1.0, nodes)
    return base + direction * length * t[:, None] - _UP * droop * length * (t * t)[:, None]


def _petal_uvs(ribbon: SweptMesh) -> FloatArray:
    """UVs eines Blütenblatts im Blattbereich der Leuchtmaske: u quer, v vom Ansatz zur Spitze."""
    u = PETAL_U[0] + ribbon.uvs[:, 0] * (PETAL_U[1] - PETAL_U[0])
    return np.stack([u, ribbon.uvs[:, 1]], axis=1)


def _center_uvs(shade: FloatArray) -> FloatArray:
    """UVs der Blütenmitte im Mittenbereich der Leuchtmaske (v von innen nach außen)."""
    u = np.full(len(shade), 0.5 * (CENTER_U[0] + CENTER_U[1]))
    return np.stack([u, 0.1 + 0.8 * np.clip(shade, 0.0, 1.0)], axis=1)


# --- Gras --------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class GrassTuftSpec:
    """Grasbüschel (Grasbüschel): Halmzahl, Höhen, Breiten, Streuradius, Neigung, Farben (sRGB)."""

    name: str
    blades: int
    height: tuple[float, float]
    width: tuple[float, float]
    spread: float
    lean_degrees: tuple[float, float]
    droop: float
    colors: Sequence[Srgb] = ((0.10, 0.22, 0.05), (0.27, 0.47, 0.12), (0.50, 0.63, 0.22))
    seed_stalks: int = 0


def build_grass_tuft(spec: GrassTuftSpec, seed: int) -> ColoredMesh:
    """Halme als leicht gekehlte Bänder (4 Segmente), am Fuß dunkel, an der Spitze hell."""
    rng = np.random.default_rng(seed)
    parts = []
    for _ in range(spec.blades):
        radius = spec.spread * np.sqrt(rng.random())
        azimuth = rng.uniform(0.0, 2.0 * np.pi)
        base = np.array([radius * np.cos(azimuth), -0.02, radius * np.sin(azimuth)])
        lean = np.radians(rng.uniform(*spec.lean_degrees))
        facing = azimuth + rng.normal(0.0, 0.6)
        outward = np.array([np.cos(facing), 0.0, np.sin(facing)])
        direction = np.cos(lean) * _UP + np.sin(lean) * outward
        height = rng.uniform(*spec.height)
        path = _bent_path(base, direction, height, spec.droop * rng.uniform(0.5, 1.4), 5)
        width = rng.uniform(*spec.width) * np.array([1.0, 0.95, 0.8, 0.5, 0.04])
        side = np.cross(direction, outward)
        side = side if np.linalg.norm(side) > 1e-6 else np.array([1.0, 0.0, 0.0])
        blade = sweep_ribbon(path, width, np.tile(side, (5, 1)), segments_across=1, cup=0.12)
        hue = rng.uniform(-0.12, 0.12)
        colors = _gradient(spec.colors, blade.along) * np.array([1.0 + hue, 1.0, 1.0 - hue])
        parts.append(ColoredMesh(blade.vertices, _soften(blade.normals, 0.55), blade.faces, np.clip(colors, 0, 1)))
    for _ in range(spec.seed_stalks):
        parts.append(_seed_stalk(rng, spec))
    return ColoredMesh.concatenate(parts)


def _seed_stalk(rng: np.random.Generator, spec: GrassTuftSpec) -> ColoredMesh:
    """Halm mit Ährenrispe (Grasblüte) über dem Büschel."""
    lean = np.radians(rng.uniform(4.0, 18.0))
    azimuth = rng.uniform(0.0, 2.0 * np.pi)
    direction = np.cos(lean) * _UP + np.sin(lean) * np.array([np.cos(azimuth), 0.0, np.sin(azimuth)])
    height = spec.height[1] * rng.uniform(1.15, 1.45)
    path = _bent_path(np.zeros(3), direction, height, 0.08, 7)
    stem = sweep_tube(path, np.linspace(0.0025, 0.0012, 7), 3)
    stem_colors = _gradient(((0.25, 0.40, 0.12), (0.55, 0.58, 0.28)), stem.along)
    head_path = path[-1] + direction * np.linspace(0.0, 0.07, 5)[:, None]
    head = sweep_tube(head_path, np.array([0.004, 0.009, 0.010, 0.007, 0.002]), 5)
    head_colors = _gradient(((0.62, 0.58, 0.32), (0.78, 0.70, 0.42)), head.along)
    return ColoredMesh.concatenate(
        [ColoredMesh.from_swept(stem, stem_colors), ColoredMesh.from_swept(head, head_colors)]
    )


GRASS_TUFTS: tuple[GrassTuftSpec, ...] = (
    GrassTuftSpec("Grass_Meadow", blades=22, height=(0.28, 0.5), width=(0.016, 0.026), spread=0.16, lean_degrees=(4, 32), droop=0.18),
    GrassTuftSpec("Grass_Short", blades=16, height=(0.12, 0.26), width=(0.014, 0.022), spread=0.13, lean_degrees=(6, 40), droop=0.12),
    GrassTuftSpec(
        "Grass_Tall", blades=14, height=(0.5, 0.85), width=(0.018, 0.03), spread=0.14, lean_degrees=(3, 24), droop=0.3,
        colors=((0.12, 0.24, 0.06), (0.32, 0.50, 0.14), (0.62, 0.66, 0.30)), seed_stalks=3,
    ),
    GrassTuftSpec(
        "Grass_Dead", blades=18, height=(0.16, 0.38), width=(0.012, 0.02), spread=0.17, lean_degrees=(12, 58), droop=0.42,
        colors=((0.13, 0.10, 0.06), (0.30, 0.24, 0.13), (0.46, 0.40, 0.25)),
    ),
)  # fmt: skip


# --- Blumen ------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class PetalSpec:
    """Blütenblätter einer Blüte (Blütenblätter): Anzahl, Länge, Breite, Wölbung, Neigung, Farbverlauf.

    ``nodes`` Stützpunkte längs und ``across`` Segmente quer bestimmen die Auflösung eines
    Blatts: kleine Blüten kommen mit 4 × 1 aus (6 Dreiecke), große gewölbte mit 6 × 2.
    """

    count: int
    length: float
    width: float
    cup: float
    tilt_degrees: float
    colors: Sequence[Srgb]
    droop: float = 0.15
    layers: int = 1
    nodes: int = 4
    across: int = 1


@dataclass(frozen=True, slots=True)
class FlowerSpec:
    """Blumenart (Blume): Stängelhöhe, Blüten je Pflanze, Blütenblätter, Mitte, Blätter.

    ``species`` ist der Schlüssel der Art im Spiel (``Flora_Blossom_<Art>``, Blumenfelder).
    ``nodding`` lässt die Blüte nach unten hängen (Glockenblume); ``spike`` verteilt viele kleine
    Blüten entlang der oberen Stängelhälfte (Lupine). ``center_glow`` ist der Leuchtanteil der
    Blütenmitte (0 = dunkel).
    """

    name: str
    species: str
    height: tuple[float, float]
    heads: int
    petals: PetalSpec
    center_radius: float
    center_colors: Sequence[Srgb]
    leaf_length: float
    leaf_count: int = 3
    nodding: bool = False
    spike: int = 0
    center_glow: float = 0.6
    stem_color: Srgb = (0.22, 0.40, 0.12)
    leaf_colors: Sequence[Srgb] = ((0.14, 0.30, 0.08), (0.30, 0.50, 0.16))

    @property
    def material(self) -> str:
        """Name des Blütenmaterials (``Flora_Blossom_<Art>``)."""
        return f"Flora_Blossom_{self.species.capitalize()}"


def build_flower(spec: FlowerSpec, seed: int) -> BloomingPlant:
    """Pflanze mit Stängeln und Grundblättern (Grünteile) und Blüten (eigene Primitive)."""
    rng = np.random.default_rng(seed)
    green = [_basal_leaves(spec, rng)]
    blossoms: list[ColoredMesh] = []
    for head in range(spec.heads):
        height = rng.uniform(*spec.height)
        azimuth = rng.uniform(0.0, 2.0 * np.pi)
        lean = np.radians(rng.uniform(2.0, 9.0) + 8.0 * head)
        direction = np.cos(lean) * _UP + np.sin(lean) * np.array([np.cos(azimuth), 0.0, np.sin(azimuth)])
        droop = 0.35 if spec.nodding else rng.uniform(0.02, 0.08)
        path = _bent_path(np.zeros(3), direction, height, droop, 6)
        stem = sweep_tube(path, np.linspace(0.0035, 0.0022, 6), 4)
        green.append(ColoredMesh.from_swept(stem, np.tile(srgb_to_linear(spec.stem_color), (len(stem.vertices), 1))))
        tip_direction = path[-1] - path[-2]
        tip_direction /= np.linalg.norm(tip_direction)
        if spec.spike:
            blossoms.extend(_spike(spec, path, rng))
        else:
            facing = -_UP * 0.9 + tip_direction * 0.1 if spec.nodding else tip_direction
            blossoms.append(_blossom(spec, path[-1], facing / np.linalg.norm(facing), rng))
    return BloomingPlant(ColoredMesh.concatenate(green), ColoredMesh.concatenate(blossoms))


def _frame(normal: FloatArray) -> tuple[FloatArray, FloatArray]:
    helper = np.array([1.0, 0.0, 0.0]) if abs(normal[0]) < 0.9 else np.array([0.0, 0.0, 1.0])
    first = np.cross(normal, helper)
    first /= np.linalg.norm(first)
    return first, np.cross(normal, first)


def _petal_ribbon(
    center: FloatArray, facing: FloatArray, radial: FloatArray, tilt: float, length: float, width: float, petal: PetalSpec
) -> SweptMesh:
    """Gewölbtes Band eines Blütenblatts vom Blütenansatz nach außen."""
    direction = np.cos(tilt) * radial + np.sin(tilt) * facing
    t = np.linspace(0.0, 1.0, petal.nodes)
    path = center + direction * length * t[:, None] - facing * petal.droop * length * (t * t)[:, None]
    widths = width * np.sin(np.pi * np.clip(t * 0.92 + 0.06, 0.0, 1.0)) ** 0.7
    side = np.tile(np.cross(facing, radial), (petal.nodes, 1))
    return sweep_ribbon(path, widths, side, segments_across=petal.across, cup=petal.cup)


def _petal(
    center: FloatArray,
    facing: FloatArray,
    radial: FloatArray,
    tilt: float,
    length: float,
    width: float,
    petal: PetalSpec,
    rng: np.random.Generator,
) -> ColoredMesh:
    """Ein Blütenblatt mit Farbverlauf und Masken-UVs."""
    ribbon = _petal_ribbon(center, facing, radial, tilt, length, width, petal)
    colors = _gradient(petal.colors, ribbon.along) * rng.uniform(0.92, 1.05)
    return ColoredMesh(ribbon.vertices, _soften(ribbon.normals, 0.2), ribbon.faces, np.clip(colors, 0, 1), _petal_uvs(ribbon))


def _blossom(spec: FlowerSpec, center: FloatArray, facing: FloatArray, rng: np.random.Generator, scale: float = 1.0) -> ColoredMesh:
    """Blüte: Blütenblätter gleichmäßig um die Achse, darüber die gewölbte Mitte."""
    petal = spec.petals
    u_axis, v_axis = _frame(facing)
    parts = []
    for layer in range(petal.layers):
        offset = rng.uniform(0.0, 360.0) + layer * 180.0 / petal.count
        for index in range(petal.count):
            angle = np.radians(offset + index * 360.0 / petal.count + rng.normal(0.0, 4.0))
            radial = np.cos(angle) * u_axis + np.sin(angle) * v_axis
            tilt = np.radians(petal.tilt_degrees + rng.normal(0.0, 5.0) - 12.0 * layer)
            length = petal.length * scale * rng.uniform(0.9, 1.1)
            parts.append(_petal(center, facing, radial, tilt, length, petal.width * scale, petal, rng))
    if spec.center_radius > 0.0:
        parts.append(_dome(center + facing * 0.002, facing, spec.center_radius * scale, spec.center_colors))
    return ColoredMesh.concatenate(parts)


def _dome(center: FloatArray, facing: FloatArray, radius: float, colors: Sequence[Srgb], rings: int = 3, segments: int = 8) -> ColoredMesh:
    """Flache Halbkugel als Blütenmitte (Körbchen) mit UVs im Mittenbereich der Leuchtmaske."""
    u_axis, v_axis = _frame(facing)
    polar = np.linspace(0.0, 0.5 * np.pi, rings + 1)
    azimuth = np.linspace(0.0, 2.0 * np.pi, segments, endpoint=False)
    vertices, normals, shade = [center + facing * radius * 0.55], [facing], [0.0]
    for p in polar[1:]:
        for a in azimuth:
            direction = np.sin(p) * (np.cos(a) * u_axis + np.sin(a) * v_axis) + np.cos(p) * facing
            vertices.append(center + radius * (direction - facing * np.cos(p) * 0.45))
            normals.append(direction)
            shade.append(p / (0.5 * np.pi))
    faces = [[0, 1 + (j + 1) % segments, 1 + j] for j in range(segments)]
    for ring in range(rings - 1):
        start, nxt = 1 + ring * segments, 1 + (ring + 1) * segments
        for j in range(segments):
            a, b = start + j, start + (j + 1) % segments
            c, d = nxt + j, nxt + (j + 1) % segments
            faces += [[a, b, c], [b, d, c]]
    shade_array = np.array(shade)
    return ColoredMesh(
        np.array(vertices),
        np.array(normals),
        np.array(faces, dtype=np.int64),
        _gradient(colors, shade_array),
        _center_uvs(shade_array),
    )


def _spike(spec: FlowerSpec, path: FloatArray, rng: np.random.Generator) -> list[ColoredMesh]:
    """Blütenähre: kleine Blüten dicht entlang der oberen Stängelhälfte, nach oben kleiner und blasser."""
    parts = []
    count = spec.spike
    for index in range(count):
        t = 0.45 + 0.55 * index / max(count - 1, 1)
        position = path[min(int(t * (len(path) - 1)), len(path) - 1)]
        angle = np.radians(index * _GOLDEN_ANGLE)
        outward = np.array([np.cos(angle), 0.35, np.sin(angle)])
        outward /= np.linalg.norm(outward)
        parts.append(_blossom(spec, position + outward * 0.006, outward, rng, scale=1.0 - 0.45 * (t - 0.45) / 0.55))
    return parts


def _basal_leaves(spec: FlowerSpec, rng: np.random.Generator) -> ColoredMesh:
    """Grundblätter als gekehlte, überhängende Bänder."""
    parts = []
    for index in range(spec.leaf_count):
        azimuth = np.radians(index * _GOLDEN_ANGLE) + rng.normal(0.0, 0.3)
        outward = np.array([np.cos(azimuth), 0.0, np.sin(azimuth)])
        direction = 0.55 * outward + 0.85 * _UP
        direction /= np.linalg.norm(direction)
        length = spec.leaf_length * rng.uniform(0.8, 1.15)
        path = _bent_path(np.zeros(3), direction, length, 0.45, 6)
        t = np.linspace(0.0, 1.0, 6)
        widths = 0.22 * length * np.sin(np.pi * np.clip(t * 0.9 + 0.08, 0, 1)) ** 0.8
        ribbon = sweep_ribbon(path, widths, np.tile(np.cross(_UP, outward), (6, 1)), segments_across=2, cup=0.18)
        parts.append(ColoredMesh(ribbon.vertices, _soften(ribbon.normals, 0.35), ribbon.faces, _gradient(spec.leaf_colors, ribbon.along)))
    return ColoredMesh.concatenate(parts)


# Höhen in Metern vor der stilisierten Vergrößerung (``island_flora.FLOWER_SCALE``)
FLOWERS: tuple[FlowerSpec, ...] = (
    FlowerSpec(
        "Flower_Daisy", "daisy", height=(0.15, 0.2), heads=1,
        petals=PetalSpec(18, 0.04, 0.010, 0.15, 8.0, ((0.95, 0.93, 0.85), (1.0, 1.0, 0.97))),
        center_radius=0.013, center_colors=((0.98, 0.72, 0.10), (0.85, 0.55, 0.05)), leaf_length=0.08, center_glow=0.8,
    ),
    FlowerSpec(
        "Flower_Poppy", "poppy", height=(0.24, 0.31), heads=1,
        petals=PetalSpec(4, 0.045, 0.05, 0.45, 42.0, ((0.55, 0.05, 0.04), (0.88, 0.14, 0.08), (0.95, 0.24, 0.12)), droop=-0.1, nodes=6, across=2),
        center_radius=0.010, center_colors=((0.25, 0.30, 0.12), (0.08, 0.06, 0.05)), leaf_length=0.1, center_glow=0.15,
    ),
    FlowerSpec(
        "Flower_Bluebell", "bluebell", height=(0.19, 0.24), heads=1, nodding=True, spike=6,
        petals=PetalSpec(6, 0.021, 0.014, 0.5, 70.0, ((0.24, 0.26, 0.70), (0.46, 0.44, 0.92)), droop=-0.3),
        center_radius=0.0, center_colors=((0.5, 0.5, 0.9),), leaf_length=0.16, leaf_count=4,
    ),
    FlowerSpec(
        "Flower_Buttercup", "buttercup", height=(0.15, 0.22), heads=3,
        petals=PetalSpec(5, 0.02, 0.018, 0.4, 35.0, ((0.90, 0.68, 0.02), (1.0, 0.86, 0.10))),
        center_radius=0.0055, center_colors=((0.75, 0.62, 0.05), (0.55, 0.45, 0.03)), leaf_length=0.07, center_glow=0.7,
    ),
    FlowerSpec(
        "Flower_Lupine", "lupine", height=(0.28, 0.32), heads=1, spike=26,
        petals=PetalSpec(3, 0.02, 0.017, 0.5, 20.0, ((0.42, 0.22, 0.70), (0.68, 0.46, 0.94))),
        center_radius=0.0, center_colors=((0.5, 0.3, 0.8),), leaf_length=0.12, leaf_count=5,
    ),
)  # fmt: skip


# --- Seerosen ----------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class LilySpec:
    """Seerose (Seerose): Blattradius, Kerbe, Randfarben; Blüte aus Blattkränzen (sRGB)."""

    pad_radius: float = 0.2
    notch_degrees: float = 24.0
    pad_colors: Sequence[Srgb] = ((0.12, 0.30, 0.08), (0.22, 0.44, 0.13), (0.30, 0.50, 0.16))
    rim_color: Srgb = (0.42, 0.24, 0.14)
    petal_colors: Sequence[Srgb] = ((0.98, 0.95, 0.93), (0.98, 0.84, 0.90), (0.93, 0.56, 0.72))
    center_colors: Sequence[Srgb] = ((0.99, 0.86, 0.25), (0.92, 0.66, 0.08))
    sepal_colors: Sequence[Srgb] = ((0.16, 0.32, 0.10), (0.36, 0.42, 0.20))


LILY = LilySpec()
LILY_SPECIES = "lily"
LILY_MATERIAL = "Flora_Blossom_Lily"
LILY_PETALS = PetalSpec(8, 0.085, 0.034, 0.35, 12.0, LILY.petal_colors, droop=-0.05, nodes=5, across=1)


def build_lily_pad(spec: LilySpec, seed: int, radius_scale: float = 1.0) -> ColoredMesh:
    """Seerosenblatt: flache, runde Scheibe mit Kerbe, Rand leicht aufgewölbt, rötlicher Saum."""
    rng = np.random.default_rng(seed)
    radius = spec.pad_radius * radius_scale
    notch = np.radians(spec.notch_degrees) * rng.uniform(0.8, 1.2)
    segments = 18
    theta = np.linspace(0.5 * notch, 2.0 * np.pi - 0.5 * notch, segments + 1)
    rho = np.array([0.4, 0.75, 0.93, 1.0])
    rings = len(rho)
    wobble = rng.uniform(0.0, 2.0 * np.pi)
    vertices = [np.array([0.0, 0.004, 0.0])]
    shade = [0.0]
    for r in rho:
        for a in theta:
            # Kerbe: die Ränder laufen zur Mitte hin leicht zusammen, außen bleibt der Spalt offen
            lift = 0.006 + 0.016 * r**3 + 0.004 * np.sin(5.0 * a + wobble) * r**2
            vertices.append(np.array([radius * r * np.cos(a), lift, radius * r * np.sin(a)]))
            shade.append(r)
    faces = []
    cols = segments + 1
    for j in range(segments):
        faces.append([0, 1 + j + 1, 1 + j])
    for ring in range(rings - 1):
        start, nxt = 1 + ring * cols, 1 + (ring + 1) * cols
        for j in range(segments):
            a, b = start + j, start + j + 1
            c, d = nxt + j, nxt + j + 1
            faces += [[a, b, c], [b, d, c]]
    vertex_array = np.array(vertices)
    shade_array = np.array(shade)
    normals = _soften(_upward_normals(vertex_array, np.array(faces, dtype=np.int64)), 0.6)
    colors = _gradient(spec.pad_colors, shade_array) * rng.uniform(0.9, 1.08)
    rim = 0.75 * np.clip((shade_array - 0.93) / 0.07, 0.0, 1.0)[:, None]
    colors = colors * (1.0 - rim) + srgb_to_linear(spec.rim_color)[None, :] * rim
    return ColoredMesh(vertex_array, normals, np.array(faces, dtype=np.int64), np.clip(colors, 0.0, 1.0))


def build_lily_flower(spec: LilySpec, seed: int) -> BloomingPlant:
    """Seerose mit Blüte: Blatt und Kelchblätter (Grünteile), drei Blütenblattkränze und gelbe Mitte."""
    rng = np.random.default_rng(seed)
    pad = build_lily_pad(spec, seed + 1, radius_scale=1.05)
    center = np.array([0.03, 0.035, 0.0])
    facing = _UP
    u_axis, v_axis = _frame(facing)
    sepals = []
    for index in range(4):
        angle = np.radians(index * 90.0 + 45.0 + rng.normal(0.0, 6.0))
        radial = np.cos(angle) * u_axis + np.sin(angle) * v_axis
        ribbon = _petal_ribbon(center - 0.008 * _UP, facing, radial, np.radians(4.0), 0.07, 0.03, LILY_PETALS)
        sepals.append(ColoredMesh(ribbon.vertices, _soften(ribbon.normals, 0.2), ribbon.faces, _gradient(spec.sepal_colors, ribbon.along)))
    petals = []
    for layer, (count, length, width, tilt) in enumerate(((8, 0.088, 0.036, 14.0), (8, 0.078, 0.032, 36.0), (6, 0.06, 0.026, 58.0))):
        offset = rng.uniform(0.0, 360.0) + layer * 22.5
        for index in range(count):
            angle = np.radians(offset + index * 360.0 / count + rng.normal(0.0, 4.0))
            radial = np.cos(angle) * u_axis + np.sin(angle) * v_axis
            lifted = center + _UP * (0.006 * layer)
            petals.append(_petal(lifted, facing, radial, np.radians(tilt + rng.normal(0.0, 4.0)), length, width, LILY_PETALS, rng))
    petals.append(_dome(center + _UP * 0.012, facing, 0.022, spec.center_colors, rings=3, segments=10))
    return BloomingPlant(ColoredMesh.concatenate([pad, *sepals]), ColoredMesh.concatenate(petals))


def _upward_normals(vertices: FloatArray, faces: IndexArray) -> FloatArray:
    """Glatte Eckpunktnormalen eines flach liegenden Blatts, stets zur Oberseite gerichtet."""
    normals = _smooth_normals(vertices, faces)
    return np.where(normals[:, 1:2] < 0.0, -normals, normals)


# --- Pilze -------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class MushroomSpec:
    """Pilzgruppe (Pilze): Anzahl, Höhen, Hutradien, Streuung, Farben (sRGB)."""

    name: str
    count: tuple[int, int]
    height: tuple[float, float]
    cap_radius: tuple[float, float]
    spread: float
    cap_colors: Sequence[Srgb]
    gill_color: Srgb
    stem_colors: Sequence[Srgb]
    lean_degrees: float = 14.0


def build_mushrooms(spec: MushroomSpec, seed: int) -> ColoredMesh:
    """Gruppe gebogener Pilze: Stiel als Röhre, Hut als gedrehtes Profil mit Lamellen-Unterseite."""
    rng = np.random.default_rng(seed)
    count = int(rng.integers(spec.count[0], spec.count[1] + 1))
    parts = []
    for index in range(count):
        size = rng.uniform(0.55, 1.0) if index else 1.0
        radius = spec.spread * np.sqrt(rng.random()) * (0.0 if index == 0 else 1.0)
        azimuth = rng.uniform(0.0, 2.0 * np.pi)
        base = np.array([radius * np.cos(azimuth), -0.02, radius * np.sin(azimuth)])
        height = rng.uniform(*spec.height) * size
        lean = np.radians(rng.uniform(0.0, spec.lean_degrees)) + (0.2 if radius > 0 else 0.0)
        outward = np.array([np.cos(azimuth), 0.0, np.sin(azimuth)])
        direction = np.cos(lean) * _UP + np.sin(lean) * outward
        path = _bent_path(base, direction, height, -0.06, 6)
        cap_radius = rng.uniform(*spec.cap_radius) * size
        stem_radius = 0.16 * cap_radius
        stem = sweep_tube(path, stem_radius * np.array([1.35, 1.1, 1.0, 0.95, 0.9, 0.85]), 6)
        stem_colors = _gradient(spec.stem_colors, stem.along)
        parts.append(ColoredMesh(stem.vertices, stem.normals, stem.faces, stem_colors))
        tip = path[-1] - path[-2]
        tip /= np.linalg.norm(tip)
        parts.append(_cap(path[-1], tip, cap_radius, spec, rng))
    return ColoredMesh.concatenate(parts)


def _cap(apex_base: FloatArray, axis: FloatArray, radius: float, spec: MushroomSpec, rng: np.random.Generator) -> ColoredMesh:
    """Pilzhut als Rotationsfläche: Scheitel, gewölbte Oberseite bis zum Rand, Lamellen innen.

    Der Scheitel ist ein Fächer um einen Punkt; die Ringe laufen über den Rand zurück zum Stiel.
    """
    rows = np.array([0.3, 0.55, 0.78, 0.92, 1.0, 0.92, 0.6, 0.25])  # Profilradius relativ
    heights = np.array([0.58, 0.48, 0.32, 0.16, 0.02, -0.06, -0.04, -0.02])  # relativ zum Radius
    rim_row = 4
    flatness = rng.uniform(0.7, 1.15)
    segments = 12
    u_axis, v_axis = _frame(axis)
    azimuth = np.linspace(0.0, 2.0 * np.pi, segments, endpoint=False)
    wobble = 1.0 + 0.06 * np.sin(3.0 * azimuth + rng.uniform(0.0, 6.3))
    vertices, shade = [apex_base + radius * 0.62 * flatness * axis], [-1.0]
    for row, (r, h) in enumerate(zip(rows, heights, strict=True)):
        for a, w in zip(azimuth, wobble, strict=True):
            radial = np.cos(a) * u_axis + np.sin(a) * v_axis
            vertices.append(apex_base + radius * (r * w * radial + h * flatness * axis))
            shade.append(row)
    faces = [[0, 1 + j, 1 + (j + 1) % segments] for j in range(segments)]
    for row in range(len(rows) - 1):
        for j in range(segments):
            a, b = 1 + row * segments + j, 1 + row * segments + (j + 1) % segments
            c, d = 1 + (row + 1) * segments + j, 1 + (row + 1) * segments + (j + 1) % segments
            faces += [[a, c, b], [b, c, d]]
    vertex_array = np.array(vertices)
    face_array = np.array(faces, dtype=np.int64)
    normals = _smooth_normals(vertex_array, face_array)
    shade_array = np.array(shade, dtype=np.float64)
    top = _gradient(spec.cap_colors, np.clip(shade_array + 1.0, 0.0, None) / (rim_row + 1.0))
    gills = np.tile(srgb_to_linear(spec.gill_color), (len(shade_array), 1))
    under = (shade_array > rim_row)[:, None]
    colors = np.where(under, gills, top) * rng.uniform(0.88, 1.08)
    return ColoredMesh(vertex_array, normals, face_array, np.clip(colors, 0.0, 1.0))


def _smooth_normals(vertices: FloatArray, faces: IndexArray) -> FloatArray:
    a, b, c = (vertices[faces[:, i]] for i in range(3))
    face_normals = np.cross(b - a, c - a)
    normals = np.zeros_like(vertices)
    for i in range(3):
        np.add.at(normals, faces[:, i], face_normals)
    return normals / np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)


MUSHROOMS: tuple[MushroomSpec, ...] = (
    MushroomSpec(
        "Mushroom_Cluster", count=(5, 7), height=(0.14, 0.3), cap_radius=(0.05, 0.1), spread=0.16,
        cap_colors=((0.30, 0.17, 0.26), (0.40, 0.25, 0.30), (0.62, 0.52, 0.46)), gill_color=(0.66, 0.58, 0.52),
        stem_colors=((0.30, 0.25, 0.20), (0.70, 0.66, 0.56)),
    ),
    MushroomSpec(
        "Mushroom_Giant", count=(2, 3), height=(0.7, 1.05), cap_radius=(0.32, 0.46), spread=0.5,
        cap_colors=((0.30, 0.46, 0.06), (0.46, 0.64, 0.10), (0.20, 0.12, 0.22)), gill_color=(0.38, 0.30, 0.36),
        stem_colors=((0.26, 0.22, 0.20), (0.62, 0.60, 0.50)), lean_degrees=9.0,
    ),
)  # fmt: skip
