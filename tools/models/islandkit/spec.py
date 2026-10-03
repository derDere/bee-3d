"""Steckbrief einer schwebenden Insel und die daraus abgeleiteten Maße (Inselsteckbrief).

Der Steckbrief bündelt Größe und Seed, den Formcharakter (``ShapeStyle``), die Bepflanzung
(``PlantingStyle``), das Landschaftsbild (``Biome``) und die Budgets der Detailstufen.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Literal

MIN_DIAMETER = 10.0
MAX_DIAMETER = 100.0
MAX_BODY_FACES = 60_000  # Körperbudget LOD0, auch für die größte Insel
BUDGET_MARGIN = 0.97  # Remeshing-Ziel unter der Obergrenze; Überschreitungen kürzt build_body per QEM
LOD1_FACE_RATIO = 0.15
LOD2_FACE_RATIO = 0.03
LOD1_MAX_TEXTURE = 512

type Biome = Literal["meadow", "rot"]
type FlowerSpecies = Literal["daisy", "poppy", "lupine", "buttercup", "bluebell"]

ALL_SPECIES: tuple[FlowerSpecies, ...] = ("daisy", "poppy", "lupine", "buttercup", "bluebell")


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


@dataclass(frozen=True, slots=True)
class ShapeStyle:
    """Formcharakter einer Insel (Formstil): Spannweiten der Zufallswerte im Inselplan und Zusatzformen.

    ``core_depth``, ``shoulder`` und ``taper`` formen die Felswand (``TerrainPlan``), ``hang``
    ist der seitliche Versatz der Unterseite relativ zum Radius,
    ``side_spire_depth`` ist das Ende der Nebenspitzen relativ zur Tiefe, ``extra_spires`` legt
    weitere Nebenspitzen an. ``pond_radius``/``pond_offset`` sind relativ zum Radius.
    ``hill_height`` (m) setzt einen Hügel auf das Plateau, ``terrace_height`` (m) hebt einen Teil
    des Plateaus als obere Ebene über eine Felsstufe der Breite ``terrace_width`` (m).
    ``relief``/``dome`` sind Faktoren auf Hügeligkeit und Kuppel.
    """

    core_depth: tuple[float, float] = (0.42, 0.55)
    shoulder: tuple[float, float] = (1.6, 2.4)
    taper: tuple[float, float] = (0.55, 0.75)
    side_spire_depth: tuple[float, float] = (0.55, 0.85)
    extra_spires: int = 0
    pond_radius: tuple[float, float] = (0.15, 0.22)
    pond_offset: tuple[float, float] = (0.05, 0.35)
    hang: tuple[float, float] = (0.1, 0.22)
    hill_height: float = 0.0
    hill_radius: float = 0.32
    terrace_height: float = 0.0
    terrace_width: float = 2.6
    relief: float = 1.0
    dome: float = 1.0


@dataclass(frozen=True, slots=True)
class PlantingStyle:
    """Bepflanzung einer Insel (Bepflanzungsstil).

    ``trees`` sind Baumarten mit Gewicht, ``upper_trees`` die Arten der oberen Terrassenebene,
    ``solitary`` der Solitärbaum (am Teich, sonst nahe der Mitte). ``grove`` ist die Schwelle des
    Hain-Rauschens (kleiner = mehr Wald). ``thicket`` setzt weitere, etwas kleinere Bäume eng
    zwischen und neben die Hainbäume (Anteil der Hainbäume), damit die Kronen zu einem dichten Dach
    zusammenwachsen. ``patches`` Blumenfelder mit Radius ``patch_radius``
    (m) aus den Arten ``species``. ``deco_flowers`` sind Deko-Blumen je m² außerhalb der
    Felder, ``grass`` ein Faktor auf die Grasdichte, ``lilies`` der Anteil der Teichfläche mit
    Seerosen, davon ``lily_blossoms`` mit Blüte.
    """

    trees: tuple[tuple[str, float], ...] = (("Tree_Oak_A", 1.0), ("Tree_Oak_B", 1.0))
    upper_trees: tuple[tuple[str, float], ...] = ()
    solitary: str | None = "Tree_Blossom"
    tree_count: int | None = None
    grove: float = 0.0
    thicket: float = 0.0
    tree_spacing: tuple[float, float] = (5.0, 7.0)
    bushes: float = 1.5
    boulders: float = 1.0
    patches: int = 3
    patch_radius: tuple[float, float] = (2.0, 3.0)
    species: tuple[FlowerSpecies, ...] = ALL_SPECIES
    deco_flowers: float = 0.02
    grass: float = 1.0
    lilies: float = 0.0
    lily_blossoms: float = 0.3


@dataclass(frozen=True, slots=True)
class IslandSpec:
    """Steckbrief einer schwebenden Insel (Inselsteckbrief).

    ``diameter`` in Metern (10–100). ``depth_ratio`` ist die Tiefe der Felsunterseite relativ
    zum Durchmesser. ``pond`` legt einen Teich an, ``stream`` einen Bach vom Teich zum Rand mit
    Wasserfall, ``springs`` Quellen in der Felswand unter dem Erdband, jede mit eigenem
    Wasserfall. ``biome`` wählt Palette und Bepflanzungsregeln (``rot``: verrottete
    Fliegennest-Insel). ``barren`` (0–1) vergrößert die kahlen Erd- und Kiesflächen auf dem
    Plateau. ``texel_size`` ist die Kantenlänge eines Texels der Inseltextur in Metern,
    gedeckelt durch ``max_texture``.
    """

    name: str
    seed: int
    diameter: float
    depth_ratio: float = 0.75
    pond: bool = True
    stream: bool = True
    springs: int = 0
    biome: Biome = "meadow"
    barren: float = 0.0
    shape: ShapeStyle = field(default_factory=ShapeStyle)
    planting: PlantingStyle = field(default_factory=PlantingStyle)
    texel_size: float = 0.05
    max_texture: int = 1024
    faces_per_meter: float = 1000.0

    def __post_init__(self) -> None:
        if not MIN_DIAMETER <= self.diameter <= MAX_DIAMETER:
            raise ValueError(f"Durchmesser {self.diameter} m liegt außerhalb von 10–100 m.")
        if self.stream and not self.pond:
            raise ValueError("Ein Bach braucht einen Teich als Quelle.")
        if not 0.4 <= self.depth_ratio <= 1.2:
            raise ValueError("depth_ratio muss zwischen 0,4 und 1,2 liegen.")

    @property
    def key(self) -> str:
        """Schlüssel der Insel im Katalog und in Dateinamen (``Meadow`` → ``meadow``)."""
        return self.name.lower()

    @property
    def dimensions(self) -> IslandDimensions:
        """Abgeleitete Maße in Metern."""
        return IslandDimensions.of(self)

    @property
    def face_budget(self) -> int:
        """Dreiecksbudget des Inselkörpers (LOD0)."""
        return int(min(BUDGET_MARGIN * MAX_BODY_FACES, self.faces_per_meter * self.diameter))

    @property
    def lod1_face_budget(self) -> int:
        """Dreiecksbudget des Körpers in LOD1 (~15 %)."""
        return int(LOD1_FACE_RATIO * self.face_budget)

    @property
    def lod2_face_budget(self) -> int:
        """Dreiecksbudget des Körpers in LOD2 (~3 %)."""
        return int(LOD2_FACE_RATIO * self.face_budget)

    @property
    def texture_size(self) -> int:
        """Texturgröße des Körpers in LOD0."""
        return self.dimensions.texture_size(self.texel_size, self.max_texture)

    @property
    def lod1_texture_size(self) -> int:
        """Texturgröße des Körpers in LOD1 (halbe Kantenlänge von LOD0, 256–512)."""
        return int(_clamp(self.texture_size // 2, 256, LOD1_MAX_TEXTURE))

    @property
    def default_tree_count(self) -> int:
        """Bäume aus der Größe: ~1 je 200 m² Plateaufläche, mindestens einer."""
        count = self.planting.tree_count
        return count if count is not None else max(1, round(self.diameter**2 / 200.0))


@dataclass(frozen=True, slots=True)
class IslandDimensions:
    """Abgeleitete Maße einer Insel in Metern (Inselmaße).

    ``soil_depth``: Dicke des Erdbands unter der Grasnarbe; ``lip_depth``: Tiefe der
    Grasnarbe am Rand; ``overhang``: Überstand der Grasnarbe über das Erdband;
    ``lip_rounding``: Verrundung der Kante; ``strata_spacing``: Abstand der Gesteinsschichten.
    """

    radius: float
    depth: float
    soil_depth: float
    lip_depth: float
    overhang: float
    lip_rounding: float
    strata_spacing: float
    relief: float
    dome: float

    @staticmethod
    def of(spec: IslandSpec) -> IslandDimensions:
        """Leitet die Maße aus dem Steckbrief ab (Faustformeln relativ zum Durchmesser)."""
        d = spec.diameter
        soil = _clamp(0.048 * d, 0.6, 3.6)
        return IslandDimensions(
            radius=0.5 * d,
            depth=spec.depth_ratio * d,
            soil_depth=soil,
            lip_depth=0.3 * soil,
            overhang=_clamp(0.012 * d, 0.15, 1.1),
            lip_rounding=_clamp(0.01 * d, 0.12, 0.8),
            strata_spacing=_clamp(d / 24.0, 0.4, 4.0),
            relief=0.016 * d * spec.shape.relief,
            dome=0.022 * d * spec.shape.dome,
        )

    @property
    def texture_area(self) -> float:
        """Grobe Oberfläche des Inselkörpers (Plateau + Unterseite) für die Texturgröße."""
        r, h = self.radius, self.depth
        return math.pi * r * r + 1.4 * math.pi * r * math.hypot(r, h)

    def texture_size(self, texel_size: float, maximum: int) -> int:
        """Nächste Zweierpotenz zur gewünschten Texelgröße bei ~70 % Atlasbelegung (512 bis ``maximum``)."""
        texels = math.sqrt(self.texture_area / 0.7) / texel_size
        return int(min(maximum, max(512, 2 ** round(math.log2(texels)))))
