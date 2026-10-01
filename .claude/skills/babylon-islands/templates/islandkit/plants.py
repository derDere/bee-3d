"""Grasbüschel und Blumen als Geometrie mit Vertexfarben (Wiesenpflanzen).

Halme, Stängel, Blätter und Blütenblätter sind Bänder bzw. Röhren entlang gebogener Kurven;
Farben liegen als lineare Vertexfarben vor, alle Pflanzen teilen ein Material
(``Flora_Plant``, doppelseitig, ohne Textur). Ursprung am Fuß der Pflanze (y = 0), lokales y
ist die Höhe über der Wurzel — so biegt der Wind-Shader des Spiels die Pflanze ab dem Boden.
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


@dataclass(frozen=True, slots=True)
class ColoredMesh:
    """Netz mit linearen Vertexfarben (farbiges Netz)."""

    vertices: FloatArray
    normals: FloatArray
    faces: IndexArray
    colors: FloatArray

    @staticmethod
    def from_swept(mesh: SweptMesh, colors: FloatArray) -> ColoredMesh:
        return ColoredMesh(mesh.vertices, mesh.normals, mesh.faces, colors)

    @staticmethod
    def concatenate(meshes: Iterable[ColoredMesh]) -> ColoredMesh:
        parts = list(meshes)
        offsets = np.cumsum([0] + [len(m.vertices) for m in parts[:-1]])
        return ColoredMesh(
            np.concatenate([m.vertices for m in parts]),
            np.concatenate([m.normals for m in parts]),
            np.concatenate([m.faces + o for m, o in zip(parts, offsets, strict=True)]),
            np.concatenate([m.colors for m in parts]),
        )

    def transformed(self, rotation: FloatArray, translation: FloatArray) -> ColoredMesh:
        return ColoredMesh(self.vertices @ rotation.T + translation, self.normals @ rotation.T, self.faces, self.colors)

    @property
    def triangle_count(self) -> int:
        return int(len(self.faces))


def _gradient(stops: Sequence[Srgb], t: FloatArray) -> FloatArray:
    """Farbverlauf (linear) über gleichmäßig verteilte Stützfarben."""
    colors = np.array([srgb_to_linear(c) for c in stops])
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
)  # fmt: skip


# --- Blumen ------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class PetalSpec:
    """Blütenblätter einer Blüte (Blütenblätter): Anzahl, Länge, Breite, Wölbung, Neigung, Farbverlauf."""

    count: int
    length: float
    width: float
    cup: float
    tilt_degrees: float
    colors: Sequence[Srgb]
    droop: float = 0.15
    layers: int = 1


@dataclass(frozen=True, slots=True)
class FlowerSpec:
    """Blumenart (Blume): Stängelhöhe, Blüten je Pflanze, Blütenblätter, Mitte, Blätter.

    ``nodding`` lässt die Blüte nach unten hängen (Glockenblume); ``spike`` verteilt viele kleine
    Blüten entlang der oberen Stängelhälfte (Lupine).
    """

    name: str
    height: tuple[float, float]
    heads: int
    petals: PetalSpec
    center_radius: float
    center_colors: Sequence[Srgb]
    leaf_length: float
    leaf_count: int = 3
    nodding: bool = False
    spike: int = 0
    stem_color: Srgb = (0.22, 0.40, 0.12)
    leaf_colors: Sequence[Srgb] = ((0.14, 0.30, 0.08), (0.30, 0.50, 0.16))


def build_flower(spec: FlowerSpec, seed: int) -> ColoredMesh:
    """Pflanze mit Stängeln, Grundblättern und Blüten."""
    rng = np.random.default_rng(seed)
    parts = [_basal_leaves(spec, rng)]
    for head in range(spec.heads):
        height = rng.uniform(*spec.height)
        azimuth = rng.uniform(0.0, 2.0 * np.pi) if spec.heads > 1 else rng.uniform(0.0, 2.0 * np.pi)
        lean = np.radians(rng.uniform(2.0, 9.0) + 8.0 * head)
        direction = np.cos(lean) * _UP + np.sin(lean) * np.array([np.cos(azimuth), 0.0, np.sin(azimuth)])
        droop = 0.35 if spec.nodding else rng.uniform(0.02, 0.08)
        path = _bent_path(np.zeros(3), direction, height, droop, 9)
        stem = sweep_tube(path, np.linspace(0.0035, 0.0022, 9), 4)
        parts.append(ColoredMesh.from_swept(stem, np.tile(srgb_to_linear(spec.stem_color), (len(stem.vertices), 1))))
        tip_direction = path[-1] - path[-2]
        tip_direction /= np.linalg.norm(tip_direction)
        if spec.spike:
            parts.extend(_spike(spec, path, rng))
        else:
            facing = -_UP * 0.9 + tip_direction * 0.1 if spec.nodding else tip_direction
            parts.append(_blossom(spec, path[-1], facing / np.linalg.norm(facing), rng))
    return ColoredMesh.concatenate(parts)


def _frame(normal: FloatArray) -> tuple[FloatArray, FloatArray]:
    helper = np.array([1.0, 0.0, 0.0]) if abs(normal[0]) < 0.9 else np.array([0.0, 0.0, 1.0])
    first = np.cross(normal, helper)
    first /= np.linalg.norm(first)
    return first, np.cross(normal, first)


def _blossom(spec: FlowerSpec, center: FloatArray, facing: FloatArray, rng: np.random.Generator, scale: float = 1.0) -> ColoredMesh:
    """Blüte: Blütenblätter im goldenen Winkel bzw. gleichmäßig, darüber die gewölbte Mitte."""
    petal = spec.petals
    u_axis, v_axis = _frame(facing)
    parts = []
    for layer in range(petal.layers):
        offset = rng.uniform(0.0, 360.0) + layer * 180.0 / petal.count
        for index in range(petal.count):
            angle = np.radians(offset + index * 360.0 / petal.count + rng.normal(0.0, 4.0))
            radial = np.cos(angle) * u_axis + np.sin(angle) * v_axis
            tilt = np.radians(petal.tilt_degrees + rng.normal(0.0, 5.0) - 12.0 * layer)
            direction = np.cos(tilt) * radial + np.sin(tilt) * facing
            length = petal.length * scale * rng.uniform(0.9, 1.1)
            t = np.linspace(0.0, 1.0, 6)
            path = center + direction * length * t[:, None] - facing * petal.droop * length * (t * t)[:, None]
            widths = petal.width * scale * np.sin(np.pi * np.clip(t * 0.92 + 0.06, 0.0, 1.0)) ** 0.7
            ribbon = sweep_ribbon(path, widths, np.tile(np.cross(facing, radial), (6, 1)), segments_across=2, cup=petal.cup)
            colors = _gradient(petal.colors, ribbon.along) * rng.uniform(0.92, 1.05)
            parts.append(ColoredMesh(ribbon.vertices, _soften(ribbon.normals, 0.2), ribbon.faces, np.clip(colors, 0, 1)))
    if spec.center_radius > 0.0:
        parts.append(_dome(center + facing * 0.002, facing, spec.center_radius * scale, spec.center_colors))
    return ColoredMesh.concatenate(parts)


def _dome(center: FloatArray, facing: FloatArray, radius: float, colors: Sequence[Srgb]) -> ColoredMesh:
    """Flache Halbkugel als Blütenmitte (Körbchen)."""
    rings, segments = 4, 10
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
    return ColoredMesh(
        np.array(vertices), np.array(normals), np.array(faces, dtype=np.int64), _gradient(colors, np.array(shade))
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


FLOWERS: tuple[FlowerSpec, ...] = (
    FlowerSpec(
        "Flower_Daisy", height=(0.22, 0.32), heads=1,
        petals=PetalSpec(18, 0.045, 0.011, 0.15, 8.0, ((0.95, 0.93, 0.85), (1.0, 1.0, 0.97))),
        center_radius=0.014, center_colors=((0.98, 0.72, 0.10), (0.85, 0.55, 0.05)), leaf_length=0.09,
    ),
    FlowerSpec(
        "Flower_Poppy", height=(0.34, 0.46), heads=1,
        petals=PetalSpec(4, 0.05, 0.055, 0.45, 42.0, ((0.55, 0.05, 0.04), (0.88, 0.14, 0.08), (0.95, 0.24, 0.12)), droop=-0.1, layers=1),
        center_radius=0.011, center_colors=((0.25, 0.30, 0.12), (0.08, 0.06, 0.05)), leaf_length=0.12,
    ),
    FlowerSpec(
        "Flower_Bluebell", height=(0.26, 0.34), heads=1, nodding=True, spike=6,
        petals=PetalSpec(6, 0.018, 0.012, 0.5, 70.0, ((0.20, 0.22, 0.62), (0.42, 0.40, 0.86)), droop=-0.3),
        center_radius=0.0, center_colors=((0.5, 0.5, 0.9),), leaf_length=0.2, leaf_count=4,
    ),
    FlowerSpec(
        "Flower_Buttercup", height=(0.18, 0.28), heads=3,
        petals=PetalSpec(5, 0.022, 0.02, 0.4, 35.0, ((0.90, 0.68, 0.02), (1.0, 0.86, 0.10))),
        center_radius=0.006, center_colors=((0.75, 0.62, 0.05), (0.55, 0.45, 0.03)), leaf_length=0.07,
    ),
    FlowerSpec(
        "Flower_Lupine", height=(0.45, 0.62), heads=1, spike=26,
        petals=PetalSpec(3, 0.016, 0.014, 0.5, 20.0, ((0.35, 0.18, 0.62), (0.62, 0.40, 0.88))),
        center_radius=0.0, center_colors=((0.5, 0.3, 0.8),), leaf_length=0.14, leaf_count=5,
    ),
)  # fmt: skip
