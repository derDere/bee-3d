"""Bäume und Büsche: Astwerk per Space Colonization, Nadelbäume mit Astquirlen, Blattkarten (Gehölze).

Laubbäume nach Runions et al. (2007): Anziehungspunkte füllen die Kronenhülle, Äste wachsen
schrittweise auf die nächsten Punkte zu, erreichte Punkte verschwinden. Astdicken folgen dem
Röhrenmodell (r_Eltern^n = Σ r_Kind^n). Jede Astkette wird eine Röhre; am Stammfuß greifen
Wurzelanläufe in den Boden. An den Astenden sitzen gebogene Blattkarten aus dem Blattatlas,
deren Normalen von der Kronenmitte weg zeigen (weiche, wolkige Schattierung). Gehölze ohne
Blattatlas sind tote Bäume mit kahlem, knorrigem Astwerk.

Nadelbäume wachsen anders: ein durchgehender Stamm bis zur Spitze, Astquirle in festen
Abständen, unten lange, oben kurze Äste, die waagrecht ansetzen und zur Spitze hin hängen;
Nadelkarten liegen entlang der Äste.

Ursprung am Stammfuß (y = 0), Stamm und Wurzelanläufe reichen etwas unter den Boden.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
import numpy.typing as npt
from modelkit.noise import Fractal
from modelkit.shading import smoothstep
from modelkit.sweep import SweptMesh, sweep_tube
from scipy.spatial import cKDTree

from islandkit.foliage import cell_rect

type FloatArray = npt.NDArray[np.float64]
type IndexArray = npt.NDArray[np.int64]
type CrownKind = Literal["ellipsoid", "cone", "dome"]
type BarkKind = Literal["Living", "Dead"]

_UP = np.array([0.0, 1.0, 0.0])
_GOLDEN_ANGLE = np.radians(137.507764)
_CARD_GRID_U, _CARD_GRID_V = np.meshgrid(np.linspace(-0.5, 0.5, 3), np.linspace(0.0, 1.0, 3))
_CARD_FACES = np.array([[0, 1, 3], [1, 4, 3], [1, 2, 4], [2, 5, 4], [3, 4, 6], [4, 7, 6], [4, 5, 7], [5, 8, 7]])


@dataclass(frozen=True, slots=True)
class CrownShape:
    """Kronenhülle (Krone): Mitte in m über dem Fuß, Halbachsen, Form und Unregelmäßigkeit."""

    center_height: float
    radii: tuple[float, float, float]
    kind: CrownKind = "ellipsoid"
    lumpiness: float = 0.25


@dataclass(frozen=True, slots=True)
class TreeSpec:
    """Laubgehölz (Gehölz): Stamm, Krone, Wachstum, Blattkarten, Borke.

    ``trunk_height`` ist die Höhe, bis zu der der Stamm unverzweigt wächst (0 = Busch).
    ``segment`` ist die Schrittweite des Wachstums, ``influence``/``kill`` Einfluss- und
    Tötungsradius der Anziehungspunkte (Vielfache von ``segment``), ``jitter`` die Unruhe der
    Wuchsrichtung (knorrig bei toten Bäumen). ``foliage`` ``None`` ergibt einen kahlen Baum.
    """

    name: str
    trunk_height: float
    trunk_radius: float
    crown: CrownShape
    attractors: int
    segment: float
    influence: float = 6.0
    kill: float = 1.6
    tip_radius: float = 0.012
    pipe_exponent: float = 2.4
    min_branch_radius: float = 0.018
    leaf_card: float = 0.7
    cards_per_tip: int = 2
    foliage: str | None = "Green"
    root_flares: int = 5
    lean: float = 0.04
    stems: int = 1
    upward: float = 0.15
    jitter: float = 0.08
    bark: BarkKind = "Living"


@dataclass(frozen=True, slots=True)
class ConiferSpec:
    """Nadelbaum (Nadelbaum): Höhe, Stamm, Astquirle, Astlängen, Nadelkarten.

    ``crown_base`` ist die Höhe des untersten Quirls, ``crown_radius`` die Länge der untersten
    Äste. ``droop`` lässt die Äste zur Spitze hin hängen (Anteil der Astlänge).
    """

    name: str
    height: float
    trunk_radius: float
    crown_base: float
    crown_radius: float
    whorl_spacing: tuple[float, float] = (0.38, 0.5)
    branches_per_whorl: tuple[int, int] = (5, 7)
    droop: tuple[float, float] = (0.2, 0.4)
    card_size: float = 0.9
    card_spacing: float = 0.42
    foliage: str = "Needles"
    root_flares: int = 5
    lean: float = 0.02
    bark: BarkKind = "Living"


@dataclass(frozen=True, slots=True)
class TreeMesh:
    """Fertiges Gehölz (Gehölznetz): Astwerk mit Borken-UVs, Blattkarten mit Atlas-UVs, beide mit Vertexfarben.

    Kahle Gehölze haben keine Blattkarten (leere Felder).
    """

    wood: SweptMesh
    wood_colors: FloatArray
    leaves_vertices: FloatArray
    leaves_normals: FloatArray
    leaves_faces: IndexArray
    leaves_uvs: FloatArray
    leaves_colors: FloatArray

    @property
    def triangle_count(self) -> int:
        return int(len(self.wood.faces) + len(self.leaves_faces))

    @property
    def has_leaves(self) -> bool:
        return len(self.leaves_faces) > 0

    @property
    def height(self) -> float:
        """Höchster Punkt über dem Fuß in m."""
        top = float(self.wood.vertices[:, 1].max())
        return max(top, float(self.leaves_vertices[:, 1].max())) if self.has_leaves else top


@dataclass(slots=True)
class _Skeleton:
    """Astgerüst: Knotenpositionen, Elternindizes, Radien."""

    positions: list[FloatArray]
    parents: list[int]
    radii: FloatArray | None = None

    def children(self) -> list[list[int]]:
        result: list[list[int]] = [[] for _ in self.positions]
        for index, parent in enumerate(self.parents):
            if parent >= 0:
                result[parent].append(index)
        return result


@dataclass(slots=True)
class _CardBuffer:
    """Sammelt Blattkarten (Kartenpuffer): Ecken, Normalen, Flächen, UVs, Farben."""

    vertices: list[FloatArray]
    normals: list[FloatArray]
    faces: list[IndexArray]
    uvs: list[FloatArray]
    colors: list[FloatArray]
    count: int = 0

    @staticmethod
    def empty() -> _CardBuffer:
        return _CardBuffer([], [], [], [], [])

    def add(self, corners: FloatArray, normals: FloatArray, uvs: FloatArray, colors: FloatArray) -> None:
        self.faces.append(_CARD_FACES + self.count)
        self.vertices.append(corners)
        self.normals.append(normals / np.linalg.norm(normals, axis=1, keepdims=True))
        self.uvs.append(uvs)
        self.colors.append(colors)
        self.count += len(corners)

    def arrays(self) -> tuple[FloatArray, FloatArray, IndexArray, FloatArray, FloatArray]:
        if not self.vertices:
            return np.zeros((0, 3)), np.zeros((0, 3)), np.zeros((0, 3), dtype=np.int64), np.zeros((0, 2)), np.zeros((0, 3))
        return (
            np.concatenate(self.vertices),
            np.concatenate(self.normals),
            np.concatenate(self.faces).astype(np.int64),
            np.concatenate(self.uvs),
            np.clip(np.concatenate(self.colors), 0.0, 1.0),
        )


def _card(base: FloatArray, axis: FloatArray, side: FloatArray, facing: FloatArray, size: float) -> FloatArray:
    """Ecken einer gebogenen Karte (3 × 3 Raster), die bei ``base`` ansetzt und entlang ``axis`` wächst."""
    bend = 0.18 * size * (_CARD_GRID_U**2) - 0.12 * size * _CARD_GRID_V**2
    return (
        base[None, :]
        + (_CARD_GRID_U.ravel() * size)[:, None] * side[None, :]
        + (_CARD_GRID_V.ravel() * size)[:, None] * axis[None, :]
        + bend.ravel()[:, None] * facing[None, :]
    )


def _card_uvs(cell: int) -> FloatArray:
    u0, v0, u1, v1 = cell_rect(cell)
    return np.stack([u0 + (_CARD_GRID_U.ravel() + 0.5) * (u1 - u0), v1 - _CARD_GRID_V.ravel() * (v1 - v0)], axis=1)


def build_tree(spec: TreeSpec, seed: int) -> TreeMesh:
    """Erzeugt Astwerk und Blattkarten eines Laubgehölzes (oder das kahle Astwerk eines toten Baums)."""
    rng = np.random.default_rng(seed)
    skeleton = _trunk(spec, rng)
    attractors = _crown_points(spec, rng)
    _colonize(skeleton, attractors, spec, rng)
    _assign_radii(skeleton, spec)
    children = skeleton.children()
    wood = _wood(skeleton, children, spec, rng)
    wood_colors = _wood_shading(wood, spec)
    leaves = _leaf_cards(skeleton, children, spec, rng) if spec.foliage is not None else _CardBuffer.empty().arrays()
    return TreeMesh(wood, wood_colors, *leaves)


# --- Wachstum ----------------------------------------------------------------------------


def _trunk(spec: TreeSpec, rng: np.random.Generator) -> _Skeleton:
    """Stamm(e) vom Fuß bis zum Kronenansatz mit leichter Neigung und Krümmung."""
    positions: list[FloatArray] = []
    parents: list[int] = []
    for _ in range(spec.stems):
        azimuth = rng.uniform(0.0, 2.0 * np.pi)
        spread = 0.0 if spec.stems == 1 else 0.35
        lean = np.array([np.cos(azimuth), 0.0, np.sin(azimuth)]) * (spec.lean + spread)
        position = np.array([0.0, -0.3, 0.0]) + (0.0 if spec.stems == 1 else 0.05) * lean
        direction = _UP + lean
        direction /= np.linalg.norm(direction)
        parent = -1
        steps = max(1, int(np.ceil((spec.trunk_height + 0.3) / spec.segment)))
        for _ in range(steps):
            positions.append(position.copy())
            parents.append(parent)
            parent = len(positions) - 1
            direction = direction + rng.normal(0.0, 0.05 + 0.5 * spec.jitter * (spec.foliage is None), 3) + 0.04 * _UP
            direction /= np.linalg.norm(direction)
            position = position + direction * spec.segment
    return _Skeleton(positions, parents)


def _crown_points(spec: TreeSpec, rng: np.random.Generator) -> FloatArray:
    """Anziehungspunkte in der unregelmäßigen Kronenhülle, zur Hülle hin verdichtet."""
    crown = spec.crown
    radii = np.array(crown.radii)
    center = np.array([0.0, crown.center_height, 0.0])
    lumps = Fractal(int(rng.integers(1 << 30)), 1.2 / max(radii), octaves=3)
    points: list[FloatArray] = []
    while sum(len(p) for p in points) < spec.attractors:
        candidate = rng.uniform(-1.0, 1.0, (spec.attractors * 3, 3))
        if crown.kind == "cone":
            height = (candidate[:, 1] + 1.0) / 2.0  # 0 unten, 1 Spitze
            inside = np.hypot(candidate[:, 0], candidate[:, 2]) < (1.0 - height) ** 0.9
        elif crown.kind == "dome":
            inside = (np.linalg.norm(candidate, axis=1) < 1.0) & (candidate[:, 1] > -0.35)
        else:
            inside = np.linalg.norm(candidate, axis=1) < 1.0
        local = candidate[inside]
        world = center + local * radii
        shell = np.linalg.norm(local, axis=1)
        wobble = 1.0 + crown.lumpiness * lumps(world)
        keep = (shell < wobble) & (rng.random(len(local)) < 0.35 + 0.65 * shell**1.5)
        points.append(world[keep])
    return np.concatenate(points)[: spec.attractors]


def _colonize(skeleton: _Skeleton, attractors: FloatArray, spec: TreeSpec, rng: np.random.Generator) -> None:
    """Space Colonization: Äste wachsen auf die nächsten Anziehungspunkte zu."""
    influence, kill = spec.influence * spec.segment, spec.kill * spec.segment
    active = attractors.copy()
    started = False
    for _ in range(400):
        if len(active) == 0:
            break
        nodes = np.array(skeleton.positions)
        distance, nearest = cKDTree(nodes).query(active, distance_upper_bound=influence)
        reached = np.isfinite(distance)
        if not np.any(reached):
            if started:
                break
            # Leittrieb wächst weiter auf die Krone zu, bis Anziehungspunkte in Reichweite sind
            leader = len(skeleton.positions) - 1
            toward = active.mean(axis=0) - nodes[leader]
            skeleton.positions.append(nodes[leader] + spec.segment * toward / np.linalg.norm(toward))
            skeleton.parents.append(leader)
            continue
        started = True
        pull = (active[reached] - nodes[nearest[reached]]) / distance[reached, None]
        sums = np.zeros_like(nodes)
        np.add.at(sums, nearest[reached], pull)
        growing = np.unique(nearest[reached])
        new_positions = []
        for node in growing:
            direction = sums[node] / np.linalg.norm(sums[node]) + spec.upward * _UP + rng.normal(0.0, spec.jitter, 3)
            direction /= np.linalg.norm(direction)
            candidate = nodes[node] + direction * spec.segment
            new_positions.append(candidate)
            skeleton.positions.append(candidate)
            skeleton.parents.append(int(node))
        tree = cKDTree(np.array(new_positions))
        alive = np.isinf(tree.query(active, distance_upper_bound=kill)[0])
        active = active[alive]


def _assign_radii(skeleton: _Skeleton, spec: TreeSpec) -> None:
    """Röhrenmodell von den Spitzen zum Stamm; der Stammfuß wird nicht dünner als ``trunk_radius``·0,8."""
    count = len(skeleton.positions)
    radii = np.zeros(count)
    accumulated = np.zeros(count)
    for index in range(count - 1, -1, -1):
        radii[index] = spec.tip_radius if accumulated[index] == 0.0 else accumulated[index] ** (1.0 / spec.pipe_exponent)
        parent = skeleton.parents[index]
        if parent >= 0:
            accumulated[parent] += radii[index] ** spec.pipe_exponent
    scale = spec.trunk_radius / max(radii[0], 1e-6)
    skeleton.radii = np.maximum(radii * min(scale, 1.6), spec.tip_radius * 0.7)


# --- Geometrie ---------------------------------------------------------------------------


def _chains(skeleton: _Skeleton, children: list[list[int]]) -> list[list[int]]:
    """Zerlegt das Gerüst in Astketten: das dickste Kind setzt die Kette fort, die übrigen beginnen neue."""
    assert skeleton.radii is not None
    radii = skeleton.radii
    roots = [i for i, parent in enumerate(skeleton.parents) if parent < 0]
    chains: list[list[int]] = []
    pending = [(root, -1) for root in roots]
    while pending:
        node, parent = pending.pop()
        chain = [parent] if parent >= 0 else []
        while True:
            chain.append(node)
            kids = sorted(children[node], key=lambda child: -radii[child])
            if not kids:
                break
            pending.extend((kid, node) for kid in kids[1:])
            node = kids[0]
        chains.append(chain)
    return chains


def _smooth(points: FloatArray, passes: int = 2) -> FloatArray:
    smoothed = points.copy()
    for _ in range(passes):
        smoothed[1:-1] = 0.25 * smoothed[:-2] + 0.5 * smoothed[1:-1] + 0.25 * smoothed[2:]
    return smoothed


def _sides(radius: float) -> int:
    return 12 if radius > 0.18 else 9 if radius > 0.08 else 6 if radius > 0.035 else 4


def _wood(skeleton: _Skeleton, children: list[list[int]], spec: TreeSpec, rng: np.random.Generator) -> SweptMesh:
    """Röhren je Astkette (Borken-UVs: 0,6 m je Kachel um den Umfang, 0,9 m längs) und Wurzelanläufe."""
    assert skeleton.radii is not None
    positions, radii = np.array(skeleton.positions), skeleton.radii
    tubes = []
    for chain in _chains(skeleton, children):
        if len(chain) < 2 or radii[chain[1]] < spec.min_branch_radius:
            continue
        keep = [chain[0]] + [node for node in chain[1:] if radii[node] >= 0.6 * spec.min_branch_radius]
        if len(keep) < 2:
            continue
        path = _smooth(positions[keep]) if len(keep) > 3 else positions[keep]
        chain_radii = radii[keep].copy()
        chain_radii[0] = chain_radii[1] if skeleton.parents[keep[1]] == keep[0] and len(keep) > 1 else chain_radii[0]
        # Stammfuß verbreitern
        chain_radii *= 1.0 + 0.55 * np.exp(-np.clip(path[:, 1], 0.0, None) / 0.45) * (path[:, 1] < 1.2)
        circumference = 2.0 * np.pi * float(chain_radii.max())
        tubes.append(
            sweep_tube(path, chain_radii, _sides(float(chain_radii.max())), u_repeat=max(1.0, round(circumference / 0.6)), v_per_meter=1.0 / 0.9)
        )
    tubes.extend(_root_flares(spec.root_flares, float(radii[0]), rng))
    return SweptMesh.concatenate(tubes)


def _root_flares(count: int, base_radius: float, rng: np.random.Generator) -> list[SweptMesh]:
    """Wurzelanläufe: kurze, kräftige Wurzeln, die vom Stamm schräg in den Boden greifen."""
    flares = []
    for index in range(count):
        angle = 2.0 * np.pi * (index + rng.uniform(-0.25, 0.25)) / max(count, 1)
        outward = np.array([np.cos(angle), 0.0, np.sin(angle)])
        reach = base_radius * rng.uniform(2.5, 4.0)
        t = np.linspace(0.0, 1.0, 6)
        path = (
            outward[None, :] * (0.3 * base_radius + reach * t[:, None] ** 0.8)
            + _UP[None, :] * (0.55 * base_radius * 2.0 * (1.0 - t[:, None]) ** 1.5 - 0.25 * t[:, None])
        )
        radii = base_radius * 0.55 * (1.0 - t) ** 0.9 + 0.01
        flares.append(sweep_tube(path, radii, 6, u_repeat=1.0, v_per_meter=1.0 / 0.9))
    return flares


def _wood_shading(wood: SweptMesh, spec: TreeSpec) -> FloatArray:
    """Vertexfarben als weiche Verdeckung: Stammfuß und Kroneninneres dunkler."""
    height = wood.vertices[:, 1]
    ground = 0.55 + 0.45 * smoothstep(-0.2, 1.4, height)
    crown = np.array(spec.crown.radii)
    inside = np.linalg.norm((wood.vertices - [0.0, spec.crown.center_height, 0.0]) / crown, axis=1)
    canopy = 0.7 + 0.3 * smoothstep(0.2, 1.0, inside)
    leafy = spec.foliage is not None
    shade = ground * np.where((height > spec.trunk_height) & leafy, canopy, 1.0)
    return np.repeat(shade[:, None], 3, axis=1)


def _leaf_cards(
    skeleton: _Skeleton, children: list[list[int]], spec: TreeSpec, rng: np.random.Generator
) -> tuple[FloatArray, FloatArray, IndexArray, FloatArray, FloatArray]:
    """Gebogene Blattkarten (2 × 2 Felder) an Astenden und dünnen Zweigen."""
    assert skeleton.radii is not None
    positions, radii = np.array(skeleton.positions), skeleton.radii
    center = np.array([0.0, spec.crown.center_height, 0.0])
    crown = np.array(spec.crown.radii)
    tips = [i for i in range(len(positions)) if not children[i] or radii[i] < 2.0 * spec.tip_radius]
    cards = _CardBuffer.empty()
    for tip in tips:
        parent = skeleton.parents[tip]
        growth = positions[tip] - positions[parent] if parent >= 0 else _UP
        growth /= max(np.linalg.norm(growth), 1e-9)
        outward = positions[tip] - center
        outward /= max(np.linalg.norm(outward), 1e-9)
        for _ in range(spec.cards_per_tip):
            size = spec.leaf_card * rng.uniform(0.75, 1.2)
            axis = growth + 0.6 * outward + rng.normal(0.0, 0.45, 3)
            axis /= np.linalg.norm(axis)
            facing = np.cross(axis, rng.normal(size=3))
            facing /= np.linalg.norm(facing)
            side = np.cross(facing, axis)
            corners = _card(positions[tip], axis, side, facing, size)
            soft = corners - center
            soft = soft / np.linalg.norm(soft, axis=1, keepdims=True)
            normal = 0.7 * soft + 0.3 * facing[None, :]
            depth = np.linalg.norm((corners - center) / crown, axis=1)
            tint = rng.uniform(0.92, 1.08)
            shade = (0.62 + 0.4 * smoothstep(0.25, 1.05, depth)) * tint
            colors = np.stack([shade * rng.uniform(0.95, 1.05), shade, shade * rng.uniform(0.9, 1.0)], axis=1)
            cards.add(corners, normal, _card_uvs(int(rng.integers(0, 4))), colors)
    return cards.arrays()


# --- Nadelbäume --------------------------------------------------------------------------


def build_conifer(spec: ConiferSpec, seed: int) -> TreeMesh:
    """Nadelbaum: durchgehender Stamm, Astquirle mit hängenden Ästen und Nadelkarten entlang der Äste."""
    rng = np.random.default_rng(seed)
    trunk_path, trunk_radii = _conifer_trunk(spec, rng)
    tubes = [sweep_tube(trunk_path, trunk_radii, 10, u_repeat=max(1.0, round(2.0 * np.pi * spec.trunk_radius / 0.6)), v_per_meter=1.0 / 0.9)]
    cards = _CardBuffer.empty()
    span = spec.height - spec.crown_base
    y = spec.crown_base
    whorl = 0
    while y < spec.height - 0.45:
        rel = (y - spec.crown_base) / span
        axis_point = _point_on_path(trunk_path, y)
        count = int(rng.integers(spec.branches_per_whorl[0], spec.branches_per_whorl[1] + 1))
        offset = whorl * _GOLDEN_ANGLE + rng.uniform(0.0, 0.4)
        for index in range(count):
            azimuth = offset + 2.0 * np.pi * index / count + rng.normal(0.0, 0.12)
            length = spec.crown_radius * (1.0 - rel) ** 0.95 * rng.uniform(0.85, 1.1)
            if length < 0.22:
                continue
            outward = np.array([np.cos(azimuth), 0.0, np.sin(azimuth)])
            elevation = np.radians(-4.0 + 26.0 * rel + rng.normal(0.0, 4.0))
            direction = np.cos(elevation) * outward + np.sin(elevation) * _UP
            droop = rng.uniform(*spec.droop) * (1.0 - 0.6 * rel)
            t = np.linspace(0.0, 1.0, 4)
            path = axis_point + direction * length * t[:, None] - _UP * droop * length * (t * t)[:, None]
            if length > 0.5:
                base_radius = max(0.014, 0.16 * spec.trunk_radius * (length / spec.crown_radius) ** 0.8)
                tubes.append(sweep_tube(path, base_radius * np.array([1.0, 0.7, 0.45, 0.2]), 4, u_repeat=1.0, v_per_meter=1.0 / 0.9))
            _needle_spray(cards, path, length, spec, trunk_path, rng)
        y += rng.uniform(*spec.whorl_spacing)
        whorl += 1
    _crown_tip(cards, trunk_path, spec, rng)
    tubes.extend(_root_flares(spec.root_flares, float(trunk_radii[0]), rng))
    wood = SweptMesh.concatenate(tubes)
    height = wood.vertices[:, 1]
    wood_shade = (0.55 + 0.45 * smoothstep(-0.2, 1.4, height)) * np.where(height > spec.crown_base, 0.75, 1.0)
    return TreeMesh(wood, np.repeat(wood_shade[:, None], 3, axis=1), *cards.arrays())


def _conifer_trunk(spec: ConiferSpec, rng: np.random.Generator) -> tuple[FloatArray, FloatArray]:
    """Stammachse vom Fuß bis zur Spitze, Radius linear auf ~2 cm, Fuß verbreitert."""
    count = max(8, int(np.ceil((spec.height + 0.3) / 0.45)) + 1)
    t = np.linspace(0.0, 1.0, count)
    azimuth = rng.uniform(0.0, 2.0 * np.pi)
    lean = spec.lean * np.array([np.cos(azimuth), 0.0, np.sin(azimuth)])
    wobble = rng.normal(0.0, 0.03, (count, 3)) * np.array([1.0, 0.0, 1.0])
    wobble[0] = 0.0
    path = np.array([0.0, -0.3, 0.0]) + t[:, None] * (spec.height + 0.3) * (_UP + lean)[None, :] + np.cumsum(wobble, axis=0) * 0.5
    radii = spec.trunk_radius * (1.0 - t) + 0.02 * t
    radii *= 1.0 + 0.5 * np.exp(-np.clip(path[:, 1], 0.0, None) / 0.5)
    return path, radii


def _point_on_path(path: FloatArray, y: float) -> FloatArray:
    """Punkt der Stammachse auf Höhe ``y`` (lineare Interpolation)."""
    return np.array([np.interp(y, path[:, 1], path[:, i]) if i != 1 else y for i in range(3)])


def _needle_spray(
    cards: _CardBuffer, path: FloatArray, length: float, spec: ConiferSpec, trunk: FloatArray, rng: np.random.Generator
) -> None:
    """Nadelkarten entlang eines Astes: Kartenachse in Astrichtung, Fläche nach oben gekippt, abwechselnd gerollt."""
    positions = np.arange(0.22 * length, length, spec.card_spacing)
    arc = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))])
    for index, s in enumerate(positions):
        base = np.array([np.interp(s, arc, path[:, i]) for i in range(3)])
        ahead = np.array([np.interp(min(s + 0.2, arc[-1]), arc, path[:, i]) for i in range(3)])
        axis = ahead - base if np.linalg.norm(ahead - base) > 1e-6 else path[-1] - path[0]
        axis = axis / np.linalg.norm(axis) + rng.normal(0.0, 0.12, 3)
        axis /= np.linalg.norm(axis)
        flat_side = np.cross(_UP, axis)
        flat_side /= max(np.linalg.norm(flat_side), 1e-9)
        roll = np.radians((35.0 if index % 2 else -35.0) + rng.normal(0.0, 10.0))
        facing = np.cross(axis, flat_side)
        facing = np.cos(roll) * facing + np.sin(roll) * flat_side
        facing *= np.sign(facing[1] + 1e-9)
        side = np.cross(facing, axis)
        size = spec.card_size * (0.7 + 0.3 * min(1.0, length / spec.crown_radius)) * rng.uniform(0.8, 1.15)
        corners = _card(base, axis, side, facing, size)
        cards.add(corners, _conifer_normals(corners, facing, trunk), _card_uvs(int(rng.integers(0, 4))), _conifer_colors(corners, spec, trunk, rng))


def _crown_tip(cards: _CardBuffer, trunk: FloatArray, spec: ConiferSpec, rng: np.random.Generator) -> None:
    """Kartenbüschel an der Spitze: steil nach oben, im Kreis um die Stammachse."""
    tip = trunk[-1]
    for index in range(6):
        azimuth = 2.0 * np.pi * index / 6 + rng.uniform(-0.2, 0.2)
        outward = np.array([np.cos(azimuth), 0.0, np.sin(azimuth)])
        axis = 0.85 * _UP + 0.35 * outward
        axis /= np.linalg.norm(axis)
        side = np.cross(axis, outward)
        side /= np.linalg.norm(side)
        facing = np.cross(side, axis)
        size = 0.75 * spec.card_size * rng.uniform(0.8, 1.1)
        base = tip - _UP * 0.9 * size
        corners = _card(base, axis, side, facing, size)
        cards.add(corners, _conifer_normals(corners, facing, trunk), _card_uvs(int(rng.integers(0, 4))), _conifer_colors(corners, spec, trunk, rng))


def _radial_from_trunk(points: FloatArray, trunk: FloatArray) -> FloatArray:
    """Waagrechte Richtung von der Stammachse zu den Punkten."""
    axis_x = np.interp(points[:, 1], trunk[:, 1], trunk[:, 0])
    axis_z = np.interp(points[:, 1], trunk[:, 1], trunk[:, 2])
    radial = np.stack([points[:, 0] - axis_x, np.zeros(len(points)), points[:, 2] - axis_z], axis=1)
    return radial / np.maximum(np.linalg.norm(radial, axis=1, keepdims=True), 1e-9)


def _conifer_normals(corners: FloatArray, facing: FloatArray, trunk: FloatArray) -> FloatArray:
    """Normalen von der Stammachse weg und nach oben gemischt (weiche Kegelschattierung)."""
    return 0.55 * _radial_from_trunk(corners, trunk) + 0.35 * _UP[None, :] + 0.3 * facing[None, :]


def _conifer_colors(corners: FloatArray, spec: ConiferSpec, trunk: FloatArray, rng: np.random.Generator) -> FloatArray:
    """Vertexfarbe als Verdeckung: innen und unten dunkler, außen und oben heller."""
    axis_x = np.interp(corners[:, 1], trunk[:, 1], trunk[:, 0])
    axis_z = np.interp(corners[:, 1], trunk[:, 1], trunk[:, 2])
    distance = np.hypot(corners[:, 0] - axis_x, corners[:, 2] - axis_z)
    rel = np.clip((corners[:, 1] - spec.crown_base) / (spec.height - spec.crown_base), 0.0, 1.0)
    local_radius = np.maximum(spec.crown_radius * (1.0 - rel) ** 0.95, 0.3)
    shade = (0.64 + 0.4 * smoothstep(0.15, 1.0, distance / local_radius)) * (0.85 + 0.22 * rel) * rng.uniform(0.92, 1.08)
    return np.stack([shade * rng.uniform(0.95, 1.05), shade, shade * rng.uniform(0.92, 1.0)], axis=1)


TREES: tuple[TreeSpec, ...] = (
    TreeSpec(
        "Tree_Oak_A", trunk_height=3.0, trunk_radius=0.42, crown=CrownShape(7.1, (4.5, 3.5, 4.5)),
        attractors=1100, segment=0.48, leaf_card=1.08,
    ),
    TreeSpec(
        "Tree_Oak_B", trunk_height=3.8, trunk_radius=0.38, crown=CrownShape(8.3, (3.6, 4.1, 3.8), lumpiness=0.35),
        attractors=1150, segment=0.42, leaf_card=0.92,
    ),
    TreeSpec(
        "Tree_Blossom", trunk_height=2.0, trunk_radius=0.28, crown=CrownShape(5.0, (3.9, 2.5, 3.9), kind="dome"),
        attractors=1000, segment=0.36, foliage="Blossom", leaf_card=0.82, lean=0.12,
    ),
    TreeSpec(
        "Bush_Round", trunk_height=0.0, trunk_radius=0.07, crown=CrownShape(0.75, (1.1, 0.8, 1.1), kind="dome", lumpiness=0.3),
        attractors=420, segment=0.16, tip_radius=0.008, min_branch_radius=0.012, leaf_card=0.42, cards_per_tip=3,
        root_flares=0, stems=3, lean=0.0,
    ),
    TreeSpec(
        "Bush_Blossom", trunk_height=0.0, trunk_radius=0.06, crown=CrownShape(0.65, (0.9, 0.7, 0.9), kind="dome", lumpiness=0.3),
        attractors=360, segment=0.15, tip_radius=0.008, min_branch_radius=0.012, leaf_card=0.4, cards_per_tip=3,
        foliage="Blossom", root_flares=0, stems=3, lean=0.0,
    ),
    TreeSpec(
        "Tree_Dead_A", trunk_height=2.6, trunk_radius=0.36, crown=CrownShape(6.0, (3.3, 2.9, 3.3), lumpiness=0.45),
        attractors=240, segment=0.45, influence=7.5, kill=2.2, tip_radius=0.022, min_branch_radius=0.02,
        foliage=None, root_flares=6, lean=0.1, upward=0.02, jitter=0.24, bark="Dead",
    ),
    TreeSpec(
        "Tree_Dead_B", trunk_height=3.2, trunk_radius=0.44, crown=CrownShape(4.6, (2.2, 1.5, 2.2), lumpiness=0.5),
        attractors=80, segment=0.5, influence=8.0, kill=2.4, tip_radius=0.03, min_branch_radius=0.028,
        foliage=None, root_flares=5, lean=0.16, upward=0.05, jitter=0.3, bark="Dead",
    ),
)  # fmt: skip

CONIFERS: tuple[ConiferSpec, ...] = (
    ConiferSpec("Tree_Conifer_A", height=15.0, trunk_radius=0.36, crown_base=2.2, crown_radius=3.3, card_size=1.3, card_spacing=0.38),
    ConiferSpec(
        "Tree_Conifer_B", height=10.5, trunk_radius=0.26, crown_base=1.6, crown_radius=2.2, card_size=1.05, card_spacing=0.34,
        whorl_spacing=(0.34, 0.46), branches_per_whorl=(5, 6),
    ),
)  # fmt: skip
