"""Bepflanzt eine schwebende Insel nach Platzierungsregeln (Inselbepflanzung).

Große Teile zuerst, jedes weitere Teil hält Abstand zu den vorigen: Solitärbaum, Bäume in
Hainen (auf der oberen Terrassenebene eigene Arten), Büsche an Hainrändern, Ufern und Stämmen,
Felsbrocken an der Kante, in der Wiese und auf Hügeln, Blumenfelder als Sammelziele, Dickicht
(weitere Bäume eng zwischen den Hainbäumen, deren Kronen zu einem Dach zusammenwachsen),
Deko-Blumen, Gras, Kantengras, Kiesel, Seerosen. Fliegennester tragen tote Bäume, Madenhügel,
Pilze und verdorrtes Gras. Startwerte: Skill ``babylon-islands``, ``references/assembly.md``.

Die Blumenfelder stehen im Inselkatalog. Das Dickicht wächst nach ihnen und weicht ihnen aus;
Deko-Blumen, Gras, Kantengras und Kiesel richten sich nur nach den Gehölzen vor den Blumenfeldern
— Gräser und Blumen dürfen zwischen den Wurzelanläufen der Dickichtbäume stehen.

Grundlage ist das grobe Feld ``body.mesh_terrain``, auf dem das Netz liegt. Fußpunkte und
Normalen entstehen aus dem Feld selbst (Newton-Schritte entlang der Hochachse, Gradient) — das
Ergebnis hängt nur vom Seed ab, nicht von der Vernetzung, und der Inselkatalog bleibt
deterministisch.

Ein Blumenfeld ist eine Kreisfläche mit 20–200 Blüten einer Art. Seine Blumen bilden einen
eigenen, GPU-instanzierten Knoten ``FlowerPatch_<n>``; ``n`` ist der Index im Inselkatalog.
"""

from __future__ import annotations

import dataclasses
import zlib
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import numpy.typing as npt
from modelkit.gltf_writer import InstanceSet
from modelkit.noise import Cellular, Fractal
from modelkit.shading import smoothstep
from scipy.spatial import cKDTree

from islandkit.assembly import PartPlacement
from islandkit.plants import FLOWERS
from islandkit.rocks import ROCKS
from islandkit.spec import FlowerSpecies, IslandSpec, PlantingStyle
from islandkit.surface import IslandPainter
from islandkit.terrain import IslandTerrain, TerrainSample

type FloatArray = npt.NDArray[np.float64]
type IndexArray = npt.NDArray[np.int64]
type BoolArray = npt.NDArray[np.bool_]
type PartSource = Callable[[str], Path]
type PartHeight = Callable[[str], float]

_UP = np.array([0.0, 1.0, 0.0])
_CANDIDATE_DENSITY = 24.0  # Kandidaten je m² Plateau, dicht genug für 0,28 m Mindestabstand
_KNOLL_RADIUS = 3.0  # Ringradius für die Kuppenerkennung in m
_PATCH_FLOWERS = (20, 200)  # Blüten je Blumenfeld
_PATCH_SPACING = 0.24  # Mindestabstand der Blumen im Feld (m)

FLOWER_PARTS: dict[str, str] = {flower.species: flower.name for flower in FLOWERS}
_BUSHES = ("Bush_Round", "Bush_Blossom")
_BOULDERS = ("Rock_Boulder_A", "Rock_Boulder_B", "Rock_Slab")
_PEBBLE = "Rock_Pebble"
_GRASS_MEADOW = "Grass_Meadow"
_GRASS_SHORT = "Grass_Short"
_GRASS_TALL = "Grass_Tall"
_GRASS_DEAD = "Grass_Dead"
_LILY_PAD = "Lily_Pad"
_LILY_FLOWER = "Lily_Flower"
_DEAD_TREES = ("Tree_Dead_A", "Tree_Dead_B")
_MOUND_LARGE = "Nest_Mound_A"
_MOUND_SMALL = "Nest_Mound_B"
_MUSHROOM_GIANT = "Mushroom_Giant"
_MUSHROOM_CLUSTER = "Mushroom_Cluster"
_ROCK_SIZES = {rock.name: max(rock.size) for rock in ROCKS}


@dataclass(frozen=True, slots=True)
class GroundSamples:
    """Fußpunkte auf der Grasnarbe (Bodenproben).

    ``normals`` sind die Feldnormalen, ``terrain`` die Geländemerkmale des groben Feldes,
    ``bare`` der Anteil kahler Stellen (0..1) und ``knoll`` die Höhe über dem Mittel eines Rings
    von 3 m (positiv auf Kuppen).
    """

    points: FloatArray
    normals: FloatArray
    terrain: TerrainSample
    bare: FloatArray
    knoll: FloatArray

    @property
    def count(self) -> int:
        """Anzahl der Fußpunkte."""
        return int(len(self.points))

    @property
    def xz(self) -> FloatArray:
        """Grundrisslage (N, 2)."""
        return self.points[:, [0, 2]]

    @property
    def water(self) -> FloatArray:
        """Abstand zum nächsten Wasserbett (Teich oder Bach) in m; ≈ 0 im Bett selbst."""
        return np.minimum(self.terrain.pond, self.terrain.stream)

    @property
    def scarp(self) -> FloatArray:
        """Lage auf der Felsstufe der Terrasse (1 in der Mitte der Stufe, 0 auf den Ebenen)."""
        fraction = self.terrain.terrace
        return 4.0 * fraction * (1.0 - fraction)

    def take(self, selection: IndexArray) -> GroundSamples:
        """Liefert die ausgewählten Fußpunkte."""
        terrain = TerrainSample(
            **{item.name: getattr(self.terrain, item.name)[selection] for item in dataclasses.fields(TerrainSample)}
        )
        return GroundSamples(
            self.points[selection], self.normals[selection], terrain, self.bare[selection], self.knoll[selection]
        )


def surface_heights(terrain: IslandTerrain, xz: FloatArray, iterations: int = 10) -> tuple[FloatArray, BoolArray]:
    """Höhe der obersten Fläche über Grundrisspunkten aus dem Feld (Newton entlang der Hochachse).

    Start ist die Plateauhöhe ohne Wasser; im Teich, im Bach und an der Lippe führen die Schritte
    zur tatsächlichen Fläche. Liefert Höhen und eine Maske der konvergierten Punkte.
    """
    y = terrain.top_height(xz)
    active = np.arange(len(xz))
    epsilon = 0.01
    for _ in range(iterations):
        if len(active) == 0:
            break
        column = np.column_stack([xz[active, 0], y[active], xz[active, 1]])
        distance = terrain.distance(column)
        settled = np.abs(distance) < 2e-4
        moving = active[~settled]
        if len(moving) == 0:
            active = moving
            break
        column = column[~settled]
        slope = (terrain.distance(column + [0.0, epsilon, 0.0]) - distance[~settled]) / epsilon
        y[moving] -= np.clip(distance[~settled] / np.maximum(slope, 0.25), -1.5, 1.5)
        active = moving
    check = terrain.distance(np.column_stack([xz[:, 0], y, xz[:, 1]]))
    return y, np.abs(check) < 0.01


def field_normals(terrain: IslandTerrain, points: FloatArray, epsilon: float = 0.02) -> FloatArray:
    """Flächennormalen des Feldes per zentraler Differenzen."""
    return terrain.gradient_normals(points, epsilon=epsilon)


class GroundProbe:
    """Findet Fußpunkte auf dem groben Feld (Bodensonde)."""

    def __init__(self, terrain: IslandTerrain, painter: IslandPainter) -> None:
        self._terrain = terrain
        self._painter = painter

    def probe(self, xz: FloatArray) -> GroundSamples:
        """Fußpunkte unter den Grundrisspunkten ``xz`` (N, 2); nicht konvergierte Punkte entfallen."""
        y, valid = surface_heights(self._terrain, xz)
        points = np.column_stack([xz[valid, 0], y[valid], xz[valid, 1]])
        normals = field_normals(self._terrain, points)
        terrain = self._terrain.sample(points)
        return GroundSamples(
            points=points,
            normals=normals,
            terrain=terrain,
            bare=self._painter.bare_ground(points, terrain),
            knoll=self._knoll(points[:, [0, 2]]),
        )

    def height(self, xz: FloatArray) -> FloatArray:
        """Höhe der Fläche an Grundrisspunkten (Plateauhöhe, wo Newton nicht konvergiert)."""
        y, valid = surface_heights(self._terrain, xz)
        return np.where(valid, y, self._terrain.top_height(xz))

    def _knoll(self, xz: FloatArray) -> FloatArray:
        """Plateauhöhe über dem Mittel eines Rings (m): positiv auf Kuppen, negativ in Mulden."""
        angles = np.linspace(0.0, 2.0 * np.pi, 6, endpoint=False)
        ring = _KNOLL_RADIUS * np.stack([np.cos(angles), np.sin(angles)], axis=1)
        around = np.mean([self._terrain.top_height(xz + offset) for offset in ring], axis=0)
        return self._terrain.top_height(xz) - around


@dataclass(frozen=True, slots=True)
class PlantedGroup:
    """Gesetzte Exemplare einer Kategorie (Pflanzgruppe).

    Je Exemplar Teilname, Fußpunkt, Drehung (Quaternion xyzw) und gleichmäßige Skalierung.
    ``node`` legt einen festen Knotennamen fest (Blumenfelder), sonst entsteht er aus Teil und Kachel.
    """

    parts: tuple[str, ...]
    positions: FloatArray
    rotations: FloatArray
    scales: FloatArray
    tile_size: float = 0.0
    node: str | None = None

    @staticmethod
    def empty() -> PlantedGroup:
        """Gruppe ohne Exemplare."""
        return PlantedGroup((), np.zeros((0, 3)), np.zeros((0, 4)), np.zeros(0))

    @property
    def count(self) -> int:
        """Anzahl der Exemplare."""
        return len(self.parts)

    @property
    def xz(self) -> FloatArray:
        """Grundrisslage (K, 2)."""
        return self.positions[:, [0, 2]]

    def subset(self, mask: BoolArray) -> PlantedGroup:
        """Liefert die ausgewählten Exemplare in unveränderter Reihenfolge."""
        parts = tuple(part for part, kept in zip(self.parts, mask, strict=True) if kept)
        return PlantedGroup(parts, self.positions[mask], self.rotations[mask], self.scales[mask], self.tile_size, self.node)


@dataclass(frozen=True, slots=True)
class FlowerPatch:
    """Blumenfeld als Sammelziel (Blumenfeld): Mitte auf der Grasnarbe, Radius, Art, Blütenzahl."""

    center: FloatArray
    radius: float
    species: FlowerSpecies
    flowers: int


@dataclass(frozen=True, slots=True)
class PlantingResult:
    """Ergebnis der Bepflanzung (Pflanzergebnis): Platzierungen je Teil, Blumenfelder, Gruppen je Kategorie.

    ``top_height`` ist der höchste Fußpunkt auf dem Plateau (m).
    """

    placements: tuple[PartPlacement, ...]
    patches: tuple[FlowerPatch, ...]
    groups: Mapping[str, PlantedGroup]
    top_height: float

    @property
    def counts(self) -> dict[str, int]:
        """Anzahl gesetzter Exemplare je Kategorie."""
        return {name: group.count for name, group in self.groups.items()}

    def exemplars(self, *categories: str) -> list[tuple[str, FloatArray, FloatArray, float]]:
        """Einzelstücke der Kategorien: (Teil, Fußpunkt, Drehung xyzw, Skalierung)."""
        result = []
        for category in categories:
            group = self.groups.get(category)
            if group is None:
                continue
            for index, part in enumerate(group.parts):
                result.append((part, group.positions[index], group.rotations[index], float(group.scales[index])))
        return result


class IslandPlanter:
    """Bepflanzt eine Insel nach den Platzierungsregeln (Inselgärtner); seedbar über den Steckbrief.

    ``part_height`` liefert die Höhe eines Teils (m); damit überragt das Dickicht die Hainbäume nicht.
    """

    def __init__(
        self, spec: IslandSpec, terrain: IslandTerrain, painter: IslandPainter, parts: PartSource, part_height: PartHeight | None = None
    ) -> None:
        self._spec = spec
        self._style: PlantingStyle = spec.planting
        self._terrain = terrain
        self._parts = parts
        self._part_height = part_height
        self._probe = GroundProbe(terrain, painter)
        self._radius = spec.dimensions.radius
        self._tile = max(16.0, round(spec.diameter / 3.0))
        self._ground, self._plateau_area = self._plateau_candidates(self._stream("ground"))
        self._index = cKDTree(self._ground.xz)
        self._grove = _plane_noise(Fractal(spec.seed + 501, 3.0 / spec.diameter, octaves=2), self._ground.xz)
        self._outlet_distance = self._distance_to_outlet(self._ground.xz)
        self._groups: dict[str, PlantedGroup] = {}
        self._patches: list[FlowerPatch] = []

    @property
    def plateau_area(self) -> float:
        """Plateaufläche in m²."""
        return self._plateau_area

    def plant(self) -> PlantingResult:
        """Setzt alle Kategorien in fester Reihenfolge und liefert Platzierungen und Blumenfelder."""
        steps = self._rot_steps() if self._spec.biome == "rot" else self._meadow_steps()
        for name, step in steps:
            self._groups[name] = step(self._stream(name))
        placements = tuple(self._placements(self._stream("placements")))
        top = float(self._ground.points[:, 1].max()) if self._ground.count else 0.0
        return PlantingResult(placements, tuple(self._patches), dict(self._groups), top)

    def _meadow_steps(self) -> tuple[tuple[str, Callable[[np.random.Generator], PlantedGroup]], ...]:
        return (
            ("solitary", self._solitary_tree),
            ("trees", self._grove_trees),
            ("bushes", self._bushes),
            ("boulders", self._boulders),
            ("patches", self._flower_patches),
            ("thicket", self._thicket),
            ("flowers", self._deco_flowers),
            ("grass", self._grass),
            ("edge_grass", self._edge_grass),
            ("pebbles", self._pebbles),
            ("lilies", self._lilies),
        )

    def _rot_steps(self) -> tuple[tuple[str, Callable[[np.random.Generator], PlantedGroup]], ...]:
        return (
            ("trees", self._dead_trees),
            ("mounds", self._mounds),
            ("boulders", self._boulders),
            ("giant_mushrooms", self._giant_mushrooms),
            ("mushrooms", self._mushroom_clusters),
            ("grass", self._dead_grass),
            ("edge_grass", self._edge_grass),
        )

    def _stream(self, name: str) -> np.random.Generator:
        """Eigener Zufallsgenerator je Kategorie: Änderungen an einer Kategorie lassen die übrigen unverändert."""
        return np.random.default_rng([self._spec.seed, zlib.crc32(name.encode())])

    # --- Wiese: Gehölze und Steine ------------------------------------------------------------

    def _solitary_tree(self, rng: np.random.Generator) -> PlantedGroup:
        """Solitärbaum 2,5–4,5 m vom Teich (dem Bach abgewandt), ohne Teich nahe der Mitte."""
        part = self._style.solitary
        if part is None:
            return PlantedGroup.empty()
        ground = self._ground
        pond = self._terrain.plan.pond
        upright = (ground.normals[:, 1] > 0.9) & (ground.scarp < 0.1)
        if pond is not None:
            allowed = (
                upright
                & (ground.terrain.pond > 2.5)
                & (ground.terrain.pond < 4.5)
                & (ground.terrain.stream > 3.0)
                & (ground.terrain.radial < 1.0 - 3.0 / self._radius)
            )
            stream = self._terrain.plan.stream
            if stream is not None:
                downstream = stream.path[len(stream.path) // 4] - pond.center
                allowed &= (ground.xz - pond.center) @ downstream < 0.0
        else:
            target = rng.uniform(-0.2, 0.2, 2) * self._radius
            allowed = upright & (np.linalg.norm(ground.xz - target, axis=1) < 0.25 * self._radius)
        candidates = np.flatnonzero(allowed)
        if len(candidates) == 0:
            return PlantedGroup.empty()
        chosen = np.array([rng.choice(candidates)])
        return _planted_group(rng, ground.points[chosen], [part], _upright(rng, 1, 3.0), (0.95, 1.1), sink=0.1)

    def _grove_trees(self, rng: np.random.Generator) -> PlantedGroup:
        """Bäume in Hainen (Hain-Rauschen über der Schwelle, stärkste Haine zuerst), Poisson-Abstand."""
        ground, style = self._ground, self._style
        allowed = (
            (ground.terrain.radial < 1.0 - 2.5 / self._radius)
            & (ground.water > 2.0)
            & (ground.normals[:, 1] > 0.85)
            & (ground.scarp < 0.15)
            & (self._grove > style.grove)
            & (self._outlet_distance > 6.0)
            & self._free({"solitary": 6.0})
        )
        candidates = np.flatnonzero(allowed)
        priority = self._grove[candidates] + 0.15 * rng.random(len(candidates))
        limit = max(0, self._spec.default_tree_count - self._groups["solitary"].count)
        spacing = rng.uniform(*style.tree_spacing, ground.count)
        chosen = poisson_select(ground.xz, spacing, candidates[np.argsort(-priority)], limit=limit)
        upper = ground.terrain.terrace[chosen] > 0.6
        names = [
            _weighted_choice(rng, style.upper_trees if (high and style.upper_trees) else style.trees) for high in upper
        ]
        return _planted_group(rng, ground.points[chosen], names, _upright(rng, len(chosen), 3.0), (0.85, 1.15), sink=0.1)

    def _bushes(self, rng: np.random.Generator) -> PlantedGroup:
        """Büsche an Hainrändern, am Ufer (1–3 m vom Wasser) und im Ring 2–4 m um Stämme; Abstand 2,5 m."""
        ground = self._ground
        trunk_distance = _nearest_distance(self._centers("solitary", "trees"), ground.xz)
        grove_edge = np.abs(self._grove - self._style.grove) < 0.06
        shore = ground.water < 3.0
        ring = trunk_distance < 4.0
        allowed = (
            (grove_edge | shore | ring)
            & (ground.water > 1.0)
            & (trunk_distance > 2.0)
            & (ground.terrain.radial < 0.92)
            & (ground.normals[:, 1] > 0.8)
            & (ground.scarp < 0.2)
            & (self._outlet_distance > 4.0)
        )
        trees = self._groups["solitary"].count + self._groups["trees"].count
        limit = round(self._style.bushes * max(trees, 1))
        order = rng.permutation(np.flatnonzero(allowed))
        chosen = poisson_select(ground.xz, np.full(ground.count, 2.5), order, limit=limit)
        blossom = self._style.solitary == "Tree_Blossom" and any("Blossom" in name for name, _ in self._style.trees)
        names = [_BUSHES[int(value < (0.6 if blossom else 0.3))] for value in rng.random(len(chosen))]
        return _planted_group(rng, ground.points[chosen], names, _upright(rng, len(chosen), 4.0), (0.8, 1.25), sink=0.05)

    def _boulders(self, rng: np.random.Generator) -> PlantedGroup:
        """Felsbrocken (~D/10 × Stil): an der Kante, in der Wiese und gehäuft auf Hügeln und der Felsstufe; Abstand 4 m."""
        ground = self._ground
        count = max(2, round(self._spec.diameter / 10.0 * self._style.boulders))
        base = (
            (ground.water > 1.5)
            & (ground.normals[:, 1] > 0.7)
            & self._free({"solitary": 2.5, "trees": 2.5, "bushes": 1.8, "mounds": 2.0})
        )
        radial = ground.terrain.radial
        edge = rng.permutation(np.flatnonzero(base & (radial > 0.85) & (radial < 0.95)))
        rise = ground.knoll + 0.5 * ground.scarp
        high = np.flatnonzero(base & (radial < 0.85) & (rise > 0.15))
        high = high[np.argsort(-(rise[high] + 0.2 * rng.random(len(high))))]
        meadow = rng.permutation(np.flatnonzero(base & (radial < 0.8)))
        spacing = np.full(ground.count, 4.0)
        at_edge = poisson_select(ground.xz, spacing, edge, limit=(count + 2) // 3)
        on_high = poisson_select(ground.xz, spacing, np.concatenate([at_edge, high]), limit=len(at_edge) + count // 3)
        chosen = poisson_select(ground.xz, spacing, np.concatenate([on_high, meadow]), limit=count)
        names = [_BOULDERS[index] for index in rng.integers(0, len(_BOULDERS), len(chosen))]
        up = _tilted(ground.normals[chosen], rng, 15.0)
        return _planted_group(rng, ground.points[chosen], names, up, (0.6, 1.6))

    # --- Wiese: Blumen und Gras ----------------------------------------------------------------

    def _flower_patches(self, rng: np.random.Generator) -> PlantedGroup:
        """Blumenfelder: Kreisflächen einer Art, 20–200 Blüten, in offener Wiese mit Abstand zueinander.

        Die Blumen eines Felds stehen im Poisson-Abstand 0,24 m und dünnen zum Rand hin aus.
        Jedes Feld wird ein eigener Knoten; die Gruppe dieser Kategorie bleibt leer.
        """
        style = self._style
        if style.patches <= 0:
            return PlantedGroup.empty()
        ground = self._ground
        usable = (
            (ground.water > 0.8)
            & (ground.normals[:, 1] > 0.8)
            & (ground.scarp < 0.2)
            & (ground.bare < 0.55)
            & (ground.terrain.radial < 0.93)
            & (self._outlet_distance > 3.0)
            & self._free({"solitary": 1.4, "trees": 1.4, "bushes": 1.0, "boulders": 1.1})
        )
        species = [style.species[index] for index in rng.permutation(len(style.species))]
        centers: list[tuple[FloatArray, float]] = []
        for candidate in rng.permutation(np.flatnonzero(usable & (ground.terrain.radial < 0.8))):
            if len(self._patches) >= style.patches:
                break
            radius = float(rng.uniform(*style.patch_radius))
            center = ground.xz[candidate]
            if any(np.linalg.norm(center - other) < radius + reach + 2.5 for other, reach in centers):
                continue
            if np.hypot(*center) + radius > 0.9 * float(self._terrain.outline_radius(np.array([np.arctan2(center[1], center[0])]))[0]):
                continue
            disk = np.array(self._index.query_ball_point(center, radius), dtype=np.int64)
            if len(disk) == 0 or usable[disk].mean() < 0.75:
                continue
            selected = self._patch_flowers(rng, center, radius, disk[usable[disk]])
            if len(selected) < _PATCH_FLOWERS[0]:
                continue
            kind = species[len(self._patches) % len(species)]
            index = len(self._patches)
            centers.append((center, radius))
            height = float(self._probe.height(center[None, :])[0])
            self._patches.append(FlowerPatch(np.array([center[0], height, center[1]]), radius, kind, len(selected)))
            up = _normalized(0.5 * ground.normals[selected] + 0.5 * _UP)
            group = _planted_group(rng, ground.points[selected], [FLOWER_PARTS[kind]] * len(selected), up, (0.85, 1.1))
            self._groups[f"patch_{index}"] = dataclasses.replace(group, node=f"FlowerPatch_{index}")
        return PlantedGroup.empty()

    def _patch_flowers(self, rng: np.random.Generator, center: FloatArray, radius: float, disk: IndexArray) -> IndexArray:
        """Blumen eines Felds: zum Rand ausdünnend, Poisson-Abstand, höchstens 200."""
        distance = np.linalg.norm(self._ground.xz[disk] - center, axis=1) / radius
        keep = rng.random(len(disk)) < 1.0 - 0.8 * smoothstep(0.6, 1.0, distance)
        order = disk[keep][np.argsort(distance[keep] + 0.35 * rng.random(int(keep.sum())))]
        return poisson_select(self._ground.xz, np.full(self._ground.count, _PATCH_SPACING), order, limit=_PATCH_FLOWERS[1])

    def _thicket(self, rng: np.random.Generator) -> PlantedGroup:
        """Dickicht: weitere, etwas kleinere Bäume eng zwischen und neben den Hainbäumen (Poisson 3,4–4,4 m).

        Die Stämme stehen 3,2–7 m vom nächsten Hainbaum, dichte Haine zuerst; die Kronen wachsen so
        zu einem Dach zusammen und reichen bis nahe an die Kante. Blumenfelder bleiben frei, kein
        Wipfel überragt den höchsten Hainbaum.
        """
        style = self._style
        trunks = self._centers("solitary", "trees")
        limit = round(style.thicket * self._groups["trees"].count)
        if limit <= 0 or len(trunks) == 0:
            return PlantedGroup.empty()
        ground = self._ground
        nearest = _nearest_distance(trunks, ground.xz)
        allowed = (
            (ground.terrain.radial < 1.0 - 1.8 / self._radius)
            & (ground.water > 2.0)
            & (ground.normals[:, 1] > 0.85)
            & (ground.scarp < 0.15)
            & (nearest > 3.2)
            & (nearest < 7.0)
            & (self._outlet_distance > 6.0)
            & self._outside_patches(ground.xz, 1.5)
            & self._free({"solitary": 4.5, "bushes": 1.2, "boulders": 1.8})
        )
        candidates = np.flatnonzero(allowed)
        priority = self._grove[candidates] - 0.03 * nearest[candidates] + 0.15 * rng.random(len(candidates))
        spacing = rng.uniform(3.4, 4.4, ground.count)
        chosen = poisson_select(ground.xz, spacing, candidates[np.argsort(-priority)], limit=limit)
        upper = ground.terrain.terrace[chosen] > 0.6
        names = [
            _weighted_choice(rng, style.upper_trees if (high and style.upper_trees) else style.trees) for high in upper
        ]
        group = _planted_group(rng, ground.points[chosen], names, _upright(rng, len(chosen), 4.0), (0.7, 0.95), sink=0.1)
        return self._below_canopy(group)

    def _below_canopy(self, group: PlantedGroup) -> PlantedGroup:
        """Behält die Exemplare, deren Wipfel nicht höher reicht als der höchste Hainbaum oder Solitär."""
        height = self._part_height
        if height is None or group.count == 0:
            return group
        canopy = max(
            float(_tops(planted, height).max(initial=-np.inf)) for planted in (self._groups["solitary"], self._groups["trees"])
        )
        return group.subset(_tops(group, height) <= canopy)

    def _deco_flowers(self, rng: np.random.Generator) -> PlantedGroup:
        """Deko-Blumen außerhalb der Felder: lockere Flecken einer Art je Zelle (~8 m), Abstand 0,35 m."""
        style = self._style
        limit = round(style.deco_flowers * self._plateau_area)
        if limit <= 0:
            return PlantedGroup.empty()
        ground = self._ground
        seed = self._spec.seed
        spots = _plane_noise(Fractal(seed + 502, 0.22, octaves=3), ground.xz)
        cells = Cellular(seed + 503, 1.0 / 8.0).evaluate(_on_plane(ground.xz))
        kinds = (cells.value * len(style.species)).astype(np.int64) % len(style.species)
        allowed = (
            (spots > 0.15)
            & (ground.water > 0.6)
            & (ground.bare < 0.35)
            & (ground.terrain.radial < 0.95)
            & (ground.normals[:, 1] > 0.7)
            & (ground.scarp < 0.2)
            & self._outside_patches(ground.xz, 0.8)
            & self._free({"solitary": 1.5, "trees": 1.5, "bushes": 1.0, "boulders": 1.1})
        )
        candidates = np.flatnonzero(allowed)
        priority = spots[candidates] + 0.08 * rng.random(len(candidates))
        chosen = poisson_select(ground.xz, np.full(ground.count, 0.35), candidates[np.argsort(-priority)], limit=limit)
        names = [FLOWER_PARTS[style.species[index]] for index in kinds[chosen]]
        up = _normalized(0.5 * ground.normals[chosen] + 0.5 * _UP)
        return _planted_group(rng, ground.points[chosen], names, up, (0.85, 1.1), tile_size=self._tile)

    def _grass(self, rng: np.random.Generator) -> PlantedGroup:
        """Gras auf dem Plateau außer Wasser und 0,8 m um Stämme; Abstand 0,55–0,95 m, dichter nach Rauschen.

        ``Grass_Tall`` am Wasser und an der Kante, ``Grass_Short`` auf Kuppen, sonst
        ``Grass_Meadow``; kahle Stellen und Blumenfelder bleiben licht.
        """
        ground = self._ground
        density = smoothstep(-0.25, 0.25, _plane_noise(Fractal(self._spec.seed + 504, 0.12, octaves=2), ground.xz))
        spacing = (0.95 - 0.4 * density) / np.sqrt(max(self._style.grass, 0.05))
        keep = (0.35 + 0.65 * density) * (1.0 - 0.8 * ground.bare) * np.where(self._outside_patches(ground.xz, 0.0), 1.0, 0.5)
        allowed = (
            (ground.water > 0.3)
            & (ground.terrain.radial < 0.97)
            & (ground.normals[:, 1] > 0.6)
            & (ground.scarp < 0.35)
            & (rng.random(ground.count) < keep)
            & self._free({"solitary": 0.8, "trees": 0.8, "bushes": 0.7, "boulders": 0.9})
        )
        limit = round(self._style.grass * 0.95 * self._plateau_area)
        chosen = poisson_select(ground.xz, spacing, rng.permutation(np.flatnonzero(allowed)), limit=limit)
        tall = (ground.water[chosen] < 1.5) | (ground.terrain.radial[chosen] > 0.92)
        short = ~tall & (ground.knoll[chosen] > 0.06)
        names = np.where(tall, _GRASS_TALL, np.where(short, _GRASS_SHORT, _GRASS_MEADOW)).tolist()
        up = _normalized(0.5 * ground.normals[chosen] + 0.5 * _UP)
        return _planted_group(rng, ground.points[chosen], names, up, (0.8, 1.3), tile_size=self._tile)

    def _edge_grass(self, rng: np.random.Generator) -> PlantedGroup:
        """Kantengras entlang des Umrisses (radial 0,97–1,0, Abstand 0,45–0,7 m), 35–60° nach außen geneigt."""
        angles = []
        theta = float(rng.uniform(-np.pi, np.pi))
        end = theta + 2.0 * np.pi
        spacing = (0.45, 0.7) if self._spec.biome == "meadow" else (0.9, 1.4)
        while theta < end:
            angles.append(theta)
            outline = float(self._terrain.outline_radius(np.array([_wrap(theta)]))[0])
            theta += float(rng.uniform(*spacing)) / max(np.sqrt(self._style.grass), 0.4) / outline
        theta_values = _wrap(np.array(angles))
        radius = self._terrain.outline_radius(theta_values) * rng.uniform(0.97, 1.0, len(theta_values))
        ground = self._probe.probe(np.stack([np.cos(theta_values), np.sin(theta_values)], axis=1) * radius[:, None])
        allowed = (
            (ground.terrain.radial > 0.95)
            & (ground.terrain.below_top < 0.6)
            & (ground.water > 1.0)
            & self._free({"solitary": 0.8, "trees": 0.8, "boulders": 0.9, "mounds": 0.8}, ground.xz)
        )
        ground = ground.take(np.flatnonzero(allowed))
        outward = np.column_stack([ground.xz[:, 0], np.zeros(ground.count), ground.xz[:, 1]])
        lean = np.radians(rng.uniform(35.0, 60.0, ground.count))[:, None]
        up = np.cos(lean) * _UP + np.sin(lean) * _normalized(outward)
        if self._spec.biome == "rot":
            names = [_GRASS_DEAD] * ground.count
        else:
            names = [(_GRASS_TALL, _GRASS_MEADOW)[int(value < 0.5)] for value in rng.random(ground.count)]
        return _planted_group(rng, ground.points, names, up, (0.8, 1.2), tile_size=self._tile)

    def _pebbles(self, rng: np.random.Generator) -> PlantedGroup:
        """Kiesel im Uferring (bis 0,8 m vom Wasser) und im Bachbett; Abstand 0,3 m, entlang der Normale."""
        ground = self._ground
        allowed = (
            (ground.water < 0.8)
            & (ground.terrain.radial < 0.97)
            & self._free({"solitary": 0.6, "trees": 0.6, "bushes": 0.5, "boulders": 0.9})
        )
        limit = round(0.05 * self._plateau_area)
        order = rng.permutation(np.flatnonzero(allowed))
        chosen = poisson_select(ground.xz, np.full(ground.count, 0.3), order, limit=limit)
        up = _tilted(ground.normals[chosen], rng, 20.0)
        return _planted_group(rng, ground.points[chosen], [_PEBBLE] * len(chosen), up, (0.6, 1.8), tile_size=self._tile)

    def _lilies(self, rng: np.random.Generator) -> PlantedGroup:
        """Seerosen auf dem Teich: Gruppen auf tieferem Wasser, ein Teil mit Blüte; Abstand 0,45 m."""
        pond, water = self._terrain.plan.pond, self._terrain.water
        if pond is None or water is None or self._style.lilies <= 0.0:
            return PlantedGroup.empty()
        reach = float(pond.radii.max()) * 1.1
        area = np.pi * float(pond.radii[0] * pond.radii[1])
        xz = pond.center + rng.uniform(-reach, reach, (int(60 * area) + 200, 2))
        bed, valid = surface_heights(self._terrain, xz)
        points = np.column_stack([xz[:, 0], np.full(len(xz), water.pond), xz[:, 1]])
        sample = self._terrain.sample(points)
        clusters = _plane_noise(Fractal(self._spec.seed + 505, 0.35, octaves=2), xz)
        # Der Bachlauf beginnt in der Teichmitte; sein Band bleibt frei
        allowed = valid & (sample.pond < -0.35) & (sample.stream > 0.4) & (water.pond - bed > 0.25) & (clusters > -0.05)
        limit = round(self._style.lilies * area / 0.16)
        chosen = poisson_select(xz, np.full(len(xz), 0.45), rng.permutation(np.flatnonzero(allowed)), limit=limit)
        blossoms = rng.random(len(chosen)) < self._style.lily_blossoms
        names = [_LILY_FLOWER if bloom else _LILY_PAD for bloom in blossoms]
        floating = points[chosen] + np.array([0.0, 0.004, 0.0])
        return _planted_group(rng, floating, names, np.tile(_UP, (len(chosen), 1)), (0.7, 1.3))

    # --- Fliegennest ----------------------------------------------------------------------------

    def _dead_trees(self, rng: np.random.Generator) -> PlantedGroup:
        """Tote Bäume im Ring 0,15–0,75 R, Abstand 6 m."""
        ground = self._ground
        allowed = (
            (ground.terrain.radial > 0.15) & (ground.terrain.radial < 0.75) & (ground.normals[:, 1] > 0.85)
        )
        count = max(2, self._spec.default_tree_count)
        chosen = poisson_select(ground.xz, np.full(ground.count, 6.0), rng.permutation(np.flatnonzero(allowed)), limit=count)
        names = [_DEAD_TREES[int(value < 0.4)] for value in rng.random(len(chosen))]
        return _planted_group(rng, ground.points[chosen], names, _upright(rng, len(chosen), 7.0), (0.85, 1.15), sink=0.15)

    def _mounds(self, rng: np.random.Generator) -> PlantedGroup:
        """Madenhügel um die Inselmitte: große innen (radial < 0,45), kleine weiter außen; Abstand 3–4 m."""
        ground = self._ground
        base = (ground.normals[:, 1] > 0.8) & self._free({"trees": 2.6})
        large = rng.permutation(np.flatnonzero(base & (ground.terrain.radial < 0.45)))
        small = rng.permutation(np.flatnonzero(base & (ground.terrain.radial < 0.68)))
        big = poisson_select(ground.xz, np.full(ground.count, 4.2), large, limit=3)
        chosen = poisson_select(ground.xz, np.full(ground.count, 3.0), np.concatenate([big, small]), limit=len(big) + 6)
        up = _normalized(0.6 * ground.normals[chosen] + 0.4 * _UP)
        count = len(big)
        large_group = _planted_group(rng, ground.points[chosen[:count]], [_MOUND_LARGE] * count, up[:count], (1.25, 1.6), sink=0.05)
        rest = len(chosen) - count
        small_group = _planted_group(rng, ground.points[chosen[count:]], [_MOUND_SMALL] * rest, up[count:], (0.85, 1.2), sink=0.05)
        return _concatenate_groups(large_group, small_group)

    def _giant_mushrooms(self, rng: np.random.Generator) -> PlantedGroup:
        """Riesenpilze 1,5–4 m um Stämme und Madenhügel; Abstand 2,2 m."""
        ground = self._ground
        anchor_distance = _nearest_distance(self._centers("trees", "mounds"), ground.xz)
        allowed = (
            (anchor_distance > 1.5) & (anchor_distance < 4.0) & (ground.terrain.radial < 0.85) & (ground.normals[:, 1] > 0.8)
            & self._free({"trees": 1.2, "mounds": 1.4, "boulders": 1.2})
        )  # fmt: skip
        chosen = poisson_select(ground.xz, np.full(ground.count, 2.2), rng.permutation(np.flatnonzero(allowed)), limit=8)
        up = _tilted(np.tile(_UP, (len(chosen), 1)), rng, 6.0)
        return _planted_group(rng, ground.points[chosen], [_MUSHROOM_GIANT] * len(chosen), up, (0.8, 1.25))

    def _mushroom_clusters(self, rng: np.random.Generator) -> PlantedGroup:
        """Pilzgruppen verstreut, gehäuft nahe Stämmen und Hügeln; Abstand 0,9 m."""
        ground = self._ground
        anchor_distance = _nearest_distance(self._centers("trees", "mounds", "giant_mushrooms"), ground.xz)
        near = rng.random(ground.count) < np.where(anchor_distance < 3.5, 0.6, 0.12)
        allowed = (
            near & (ground.terrain.radial < 0.92) & (ground.normals[:, 1] > 0.75)
            & self._free({"trees": 0.9, "mounds": 1.0, "giant_mushrooms": 0.8, "boulders": 1.0})
        )  # fmt: skip
        limit = round(0.035 * self._plateau_area)
        chosen = poisson_select(ground.xz, np.full(ground.count, 0.9), rng.permutation(np.flatnonzero(allowed)), limit=limit)
        up = _normalized(0.5 * ground.normals[chosen] + 0.5 * _UP)
        return _planted_group(rng, ground.points[chosen], [_MUSHROOM_CLUSTER] * len(chosen), up, (0.7, 1.3), tile_size=self._tile)

    def _dead_grass(self, rng: np.random.Generator) -> PlantedGroup:
        """Verdorrtes Gras, licht und fleckig; Abstand 0,8–1,3 m."""
        ground = self._ground
        patches = smoothstep(-0.1, 0.3, _plane_noise(Fractal(self._spec.seed + 506, 0.18, octaves=2), ground.xz))
        allowed = (
            (rng.random(ground.count) < 0.25 + 0.75 * patches)
            & (ground.terrain.radial < 0.96)
            & (ground.normals[:, 1] > 0.65)
            & self._free({"trees": 0.8, "mounds": 1.0, "boulders": 0.9, "giant_mushrooms": 0.6, "mushrooms": 0.4})
        )
        limit = round(self._style.grass * 0.4 * self._plateau_area)
        chosen = poisson_select(ground.xz, rng.uniform(0.8, 1.3, ground.count), rng.permutation(np.flatnonzero(allowed)), limit=limit)
        up = _normalized(0.5 * ground.normals[chosen] + 0.5 * _UP)
        return _planted_group(rng, ground.points[chosen], [_GRASS_DEAD] * len(chosen), up, (0.8, 1.3), tile_size=self._tile)

    # --- Hilfsfunktionen ----------------------------------------------------------------------

    def _plateau_candidates(self, rng: np.random.Generator) -> tuple[GroundSamples, float]:
        """Zufällige Fußpunkte auf dem Plateau (radial < 0,985) und die Plateaufläche in m²."""
        reach = self._terrain.max_outline_radius
        square = (2.0 * reach) ** 2
        count = int(_CANDIDATE_DENSITY * square)
        xz = rng.uniform(-reach, reach, (count, 2))
        outline = self._terrain.outline_radius(np.arctan2(xz[:, 1], xz[:, 0]))
        inside = np.hypot(xz[:, 0], xz[:, 1]) < outline
        area = square * float(np.count_nonzero(inside)) / count
        ground = self._probe.probe(xz[inside])
        keep = (ground.terrain.radial < 0.985) & (ground.terrain.below_top < 2.0)
        return ground.take(np.flatnonzero(keep)), area

    def _distance_to_outlet(self, xz: FloatArray) -> FloatArray:
        """Grundrissabstand zur Bachmündung (m); ohne Bach unendlich."""
        outlet = self._terrain.stream_outlet()
        if outlet is None:
            return np.full(len(xz), np.inf)
        return np.linalg.norm(xz - outlet.position[[0, 2]], axis=1)

    def _outside_patches(self, xz: FloatArray, margin: float) -> BoolArray:
        """True außerhalb aller Blumenfelder (zuzüglich ``margin``)."""
        outside = np.ones(len(xz), dtype=bool)
        for patch in self._patches:
            outside &= np.linalg.norm(xz - patch.center[[0, 2]], axis=1) > patch.radius + margin
        return outside

    def _centers(self, *names: str) -> FloatArray:
        """Grundrisslagen der genannten Gruppen."""
        groups = [self._groups[name].xz for name in names if name in self._groups]
        return np.concatenate(groups) if groups else np.zeros((0, 2))

    def _free(self, clearances: Mapping[str, float], xz: FloatArray | None = None) -> BoolArray:
        """True, wo kein Exemplar der genannten Gruppen näher liegt als Abstand × Exemplargröße."""
        points = self._ground.xz if xz is None else xz
        free = np.ones(len(points), dtype=bool)
        for name, clearance in clearances.items():
            group = self._groups.get(name)
            if group is None or group.count == 0:
                continue
            neighbors = min(8, group.count)
            distance, index = cKDTree(group.xz).query(
                points, k=neighbors, distance_upper_bound=clearance * float(group.scales.max())
            )
            distance = distance.reshape(len(points), neighbors)
            index = index.reshape(len(points), neighbors)
            found = np.isfinite(distance)
            required = np.zeros_like(distance)
            required[found] = clearance * group.scales[index[found]]
            free &= ~np.any(found & (distance < required), axis=1)
        return free

    def _placements(self, rng: np.random.Generator) -> list[PartPlacement]:
        """Fasst Exemplare je Teil und Kachelgröße zusammen; gemischt, damit jeder Kachelanfang eine gleichmäßige Stichprobe ist.

        Gruppen mit festem Knotennamen (Blumenfelder) bleiben eigene Platzierungen.
        """
        merged: dict[tuple[str, float], list[PlantedGroup]] = {}
        placements = []
        for group in self._groups.values():
            if group.count == 0:
                continue
            if group.node is not None:
                placements.append(self._placement(group.node, group.parts[0], [group], 0.0, rng, single_node=True))
                continue
            for part in sorted(set(group.parts)):
                selection = np.array([name == part for name in group.parts])
                subset = PlantedGroup(
                    (part,) * int(selection.sum()),
                    group.positions[selection],
                    group.rotations[selection],
                    group.scales[selection],
                    group.tile_size,
                )
                merged.setdefault((part, group.tile_size), []).append(subset)
        for (part, tile_size), groups in merged.items():
            placements.append(self._placement(part, part, groups, tile_size, rng, single_node=False))
        return placements

    def _placement(
        self, name: str, part: str, groups: Sequence[PlantedGroup], tile_size: float, rng: np.random.Generator, *, single_node: bool
    ) -> PartPlacement:
        translations = np.concatenate([group.positions for group in groups])
        rotations = np.concatenate([group.rotations for group in groups])
        scales = np.concatenate([group.scales for group in groups])
        order = rng.permutation(len(translations))
        instances = InstanceSet(translations[order], rotations[order], np.repeat(scales[order, None], 3, axis=1))
        return PartPlacement(name, self._parts(part), instances, tile_size, exact_name=single_node)


def poisson_select(
    xz: FloatArray, spacing: FloatArray, order: IndexArray, limit: int | None = None
) -> IndexArray:
    """Wählt Kandidaten in der Reihenfolge ``order`` mit Mindestabstand aus (Poisson-Scheiben).

    Zwei angenommene Punkte halten den größeren ihrer beiden Abstände aus ``spacing`` ein;
    ``limit`` begrenzt die Anzahl. Liefert die Indizes der angenommenen Kandidaten.
    """
    if len(order) == 0 or limit == 0:
        return np.zeros(0, dtype=np.int64)
    cell = float(spacing[order].max())
    points: list[list[float]] = xz.tolist()
    radii: list[float] = spacing.tolist()
    grid: dict[tuple[int, int], list[int]] = {}
    accepted: list[int] = []
    for index in order.tolist():
        x, z = points[index]
        radius = radii[index]
        key = (int(x // cell), int(z // cell))
        if _conflicts(grid, points, radii, key, x, z, radius):
            continue
        grid.setdefault(key, []).append(index)
        accepted.append(index)
        if limit is not None and len(accepted) >= limit:
            break
    return np.array(accepted, dtype=np.int64)


def _conflicts(
    grid: dict[tuple[int, int], list[int]],
    points: list[list[float]],
    radii: list[float],
    key: tuple[int, int],
    x: float,
    z: float,
    radius: float,
) -> bool:
    """True, wenn ein angenommener Punkt der 3 × 3 Nachbarzellen zu nahe liegt."""
    for dx in (-1, 0, 1):
        for dz in (-1, 0, 1):
            for other in grid.get((key[0] + dx, key[1] + dz), ()):
                ox, oz = points[other]
                reach = max(radius, radii[other])
                if (ox - x) ** 2 + (oz - z) ** 2 < reach * reach:
                    return True
    return False


def _weighted_choice(rng: np.random.Generator, options: Sequence[tuple[str, float]]) -> str:
    names = [name for name, _ in options]
    weights = np.array([weight for _, weight in options], dtype=np.float64)
    return names[int(rng.choice(len(names), p=weights / weights.sum()))]


def _planted_group(
    rng: np.random.Generator,
    positions: FloatArray,
    names: Sequence[str],
    up: FloatArray,
    scale_range: tuple[float, float],
    *,
    sink: float = 0.0,
    tile_size: float = 0.0,
) -> PlantedGroup:
    """Gruppe mit freier Gierdrehung um die Wuchsrichtung und zufälliger Größe; ``sink`` senkt den Fuß ab (m)."""
    count = len(names)
    rotations = orient(up, rng.uniform(0.0, 2.0 * np.pi, count))
    scales = rng.uniform(*scale_range, count)
    lowered = positions - np.array([0.0, sink, 0.0])
    return PlantedGroup(tuple(names), lowered, rotations, scales, tile_size)


def _tops(group: PlantedGroup, height: PartHeight) -> FloatArray:
    """Wipfelhöhe je Exemplar: Fußpunkt plus Skalierung mal Höhe des Teils."""
    heights = np.array([height(part) for part in group.parts])
    return group.positions[:, 1] + group.scales * heights if group.count else np.zeros(0)


def _concatenate_groups(*groups: PlantedGroup) -> PlantedGroup:
    """Fügt Gruppen gleicher Kachelgröße zu einer zusammen."""
    return PlantedGroup(
        tuple(part for group in groups for part in group.parts),
        np.concatenate([group.positions for group in groups]),
        np.concatenate([group.rotations for group in groups]),
        np.concatenate([group.scales for group in groups]),
        groups[0].tile_size,
    )


def _upright(rng: np.random.Generator, count: int, tilt_degrees: float) -> FloatArray:
    """Aufrechte Wuchsrichtungen, zufällig um bis zu ``tilt_degrees`` geneigt."""
    return _tilted(np.tile(_UP, (count, 1)), rng, tilt_degrees)


def orient(up: FloatArray, yaw: FloatArray) -> FloatArray:
    """Quaternionen (xyzw): Gierdrehung ``yaw`` um die eigene Hochachse, dann +Y in Richtung ``up``."""
    half = 0.5 * yaw
    spin = np.column_stack([np.zeros_like(half), np.sin(half), np.zeros_like(half), np.cos(half)])
    tilt = _rotation_between(np.tile(_UP, (len(up), 1)), _normalized(up))
    return _multiply(tilt, spin)


def _rotation_between(source: FloatArray, target: FloatArray) -> FloatArray:
    """Kürzeste Drehung je Zeile von ``source`` nach ``target`` (Einheitsvektoren) als Quaternion xyzw."""
    w = 1.0 + np.einsum("ij,ij->i", source, target)
    return _normalized(np.column_stack([np.cross(source, target), w]))


def _multiply(first: FloatArray, second: FloatArray) -> FloatArray:
    """Hamilton-Produkt je Zeile (xyzw); wirkt erst ``second``, dann ``first``."""
    v1, w1 = first[:, :3], first[:, 3:]
    v2, w2 = second[:, :3], second[:, 3:]
    vector = w1 * v2 + w2 * v1 + np.cross(v1, v2)
    scalar = w1 * w2 - np.einsum("ij,ij->i", v1, v2)[:, None]
    return np.concatenate([vector, scalar], axis=1)


def _tilted(directions: FloatArray, rng: np.random.Generator, max_degrees: float) -> FloatArray:
    """Neigt Richtungen in zufällige Richtung um bis zu ``max_degrees``."""
    angle = np.radians(rng.uniform(0.0, max_degrees, len(directions)))[:, None]
    side = _normalized(np.cross(directions, rng.normal(size=directions.shape)))
    return _normalized(directions * np.cos(angle) + side * np.sin(angle))


def _normalized(vectors: FloatArray) -> FloatArray:
    return vectors / np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-12)


def _nearest_distance(centers: FloatArray, xz: FloatArray) -> FloatArray:
    """Abstand jedes Punkts zum nächsten Mittelpunkt; ohne Mittelpunkte unendlich."""
    if len(centers) == 0:
        return np.full(len(xz), np.inf)
    return cKDTree(centers).query(xz)[0]


def _on_plane(xz: FloatArray) -> FloatArray:
    """Grundrisspunkte (N, 2) als Raumpunkte auf y = 0 (Rauschen im Grundriss)."""
    return np.column_stack([xz[:, 0], np.zeros(len(xz)), xz[:, 1]])


def _plane_noise(noise: Fractal, xz: FloatArray) -> FloatArray:
    """Wertet ein Rauschfeld im Grundriss aus."""
    return noise(_on_plane(xz))


def _wrap(angles: FloatArray | float) -> FloatArray:
    """Winkel auf (−π, π]."""
    return (np.asarray(angles, dtype=np.float64) + np.pi) % (2.0 * np.pi) - np.pi
