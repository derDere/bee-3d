"""Bäume und Büsche: Astwerk per Space Colonization, Röhren mit Borke, Blattkarten (Gehölze).

Ablauf nach Runions et al. (2007): Anziehungspunkte füllen die Kronenhülle, Äste wachsen
schrittweise auf die nächsten Punkte zu, erreichte Punkte verschwinden. Astdicken folgen dem
Röhrenmodell (r_Eltern^n = Σ r_Kind^n). Jede Astkette wird eine Röhre; am Stammfuß greifen
Wurzelanläufe in den Boden. An den Astenden sitzen gebogene Blattkarten aus dem Blattatlas,
deren Normalen von der Kronenmitte weg zeigen (weiche, wolkige Schattierung).

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

_UP = np.array([0.0, 1.0, 0.0])


@dataclass(frozen=True, slots=True)
class CrownShape:
    """Kronenhülle (Krone): Mitte in m über dem Fuß, Halbachsen, Form und Unregelmäßigkeit."""

    center_height: float
    radii: tuple[float, float, float]
    kind: CrownKind = "ellipsoid"
    lumpiness: float = 0.25


@dataclass(frozen=True, slots=True)
class TreeSpec:
    """Gehölzart (Gehölz): Stamm, Krone, Wachstum, Blattkarten, Materialien.

    ``trunk_height`` ist die Höhe, bis zu der der Stamm unverzweigt wächst (0 = Busch).
    ``segment`` ist die Schrittweite des Wachstums, ``influence``/``kill`` Einfluss- und
    Tötungsradius der Anziehungspunkte (Vielfache von ``segment``).
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
    foliage: str = "Green"
    root_flares: int = 5
    lean: float = 0.04
    stems: int = 1
    upward: float = 0.15


@dataclass(frozen=True, slots=True)
class TreeMesh:
    """Fertiges Gehölz (Gehölznetz): Astwerk mit Borken-UVs, Blattkarten mit Atlas-UVs, beide mit Vertexfarben."""

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


def build_tree(spec: TreeSpec, seed: int) -> TreeMesh:
    """Erzeugt Astwerk und Blattkarten eines Gehölzes."""
    rng = np.random.default_rng(seed)
    skeleton = _trunk(spec, rng)
    attractors = _crown_points(spec, rng)
    _colonize(skeleton, attractors, spec, rng)
    _assign_radii(skeleton, spec)
    children = skeleton.children()
    wood = _wood(skeleton, children, spec, rng)
    wood_colors = _wood_shading(wood, spec)
    leaves = _leaf_cards(skeleton, children, spec, rng)
    return TreeMesh(wood, wood_colors, *leaves)


# --- Wachstum ----------------------------------------------------------------------------


def _trunk(spec: TreeSpec, rng: np.random.Generator) -> _Skeleton:
    """Stamm(e) vom Fuß bis zum Kronenansatz mit leichter Neigung und Krümmung."""
    positions: list[FloatArray] = []
    parents: list[int] = []
    for stem in range(spec.stems):
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
            direction = direction + rng.normal(0.0, 0.05, 3) + 0.04 * _UP
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
            direction = sums[node] / np.linalg.norm(sums[node]) + spec.upward * _UP + rng.normal(0.0, 0.08, 3)
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
    tubes.extend(_root_flares(spec, float(radii[0]), rng))
    return SweptMesh.concatenate(tubes)


def _root_flares(spec: TreeSpec, base_radius: float, rng: np.random.Generator) -> list[SweptMesh]:
    """Wurzelanläufe: kurze, kräftige Wurzeln, die vom Stamm schräg in den Boden greifen."""
    flares = []
    for index in range(spec.root_flares):
        angle = 2.0 * np.pi * (index + rng.uniform(-0.25, 0.25)) / max(spec.root_flares, 1)
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
    shade = ground * np.where(height > spec.trunk_height, canopy, 1.0)
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
    vertices, normals, faces, uvs, colors = [], [], [], [], []
    grid_u, grid_v = np.meshgrid(np.linspace(-0.5, 0.5, 3), np.linspace(0.0, 1.0, 3))
    local_faces = np.array([[0, 1, 3], [1, 4, 3], [1, 2, 4], [2, 5, 4], [3, 4, 6], [4, 7, 6], [4, 5, 7], [5, 8, 7]])
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
            bend = 0.18 * size * (grid_u**2) - 0.12 * size * grid_v**2
            card = (
                positions[tip][None, :]
                + (grid_u.ravel() * size)[:, None] * side[None, :]
                + (grid_v.ravel() * size)[:, None] * axis[None, :]
                + bend.ravel()[:, None] * facing[None, :]
            )
            soft = card - center
            soft = soft / np.linalg.norm(soft, axis=1, keepdims=True)
            normal = 0.7 * soft + 0.3 * facing[None, :]
            u0, v0, u1, v1 = cell_rect(int(rng.integers(0, 4)))
            uv = np.stack([u0 + (grid_u.ravel() + 0.5) * (u1 - u0), v1 - grid_v.ravel() * (v1 - v0)], axis=1)
            depth = np.linalg.norm((card - center) / crown, axis=1)
            tint = rng.uniform(0.92, 1.08)
            shade = (0.62 + 0.4 * smoothstep(0.25, 1.05, depth)) * tint
            faces.append(local_faces + sum(len(v) for v in vertices))
            vertices.append(card)
            normals.append(normal / np.linalg.norm(normal, axis=1, keepdims=True))
            uvs.append(uv)
            colors.append(np.stack([shade * rng.uniform(0.95, 1.05), shade, shade * rng.uniform(0.9, 1.0)], axis=1))
    return (
        np.concatenate(vertices),
        np.concatenate(normals),
        np.concatenate(faces).astype(np.int64),
        np.concatenate(uvs),
        np.clip(np.concatenate(colors), 0.0, 1.0),
    )


TREES: tuple[TreeSpec, ...] = (
    TreeSpec("Tree_Oak_A", trunk_height=2.2, trunk_radius=0.32, crown=CrownShape(5.2, (3.4, 2.6, 3.4)), attractors=1100, segment=0.32),
    TreeSpec("Tree_Oak_B", trunk_height=2.8, trunk_radius=0.28, crown=CrownShape(6.0, (2.7, 3.0, 2.9), lumpiness=0.35), attractors=1000, segment=0.32),
    TreeSpec(
        "Tree_Blossom", trunk_height=1.6, trunk_radius=0.22, crown=CrownShape(3.9, (3.0, 1.9, 3.0), kind="dome"),
        attractors=900, segment=0.28, foliage="Blossom", leaf_card=0.65, lean=0.12,
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
)  # fmt: skip
