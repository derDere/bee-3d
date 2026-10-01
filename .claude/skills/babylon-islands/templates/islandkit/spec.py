"""Steckbrief einer schwebenden Insel und die daraus abgeleiteten Maße (Inselsteckbrief)."""

from __future__ import annotations

import math
from dataclasses import dataclass

MIN_DIAMETER = 10.0
MAX_DIAMETER = 100.0


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


@dataclass(frozen=True, slots=True)
class IslandSpec:
    """Steckbrief einer schwebenden Insel (Inselsteckbrief).

    ``diameter`` in Metern (10–100). ``depth_ratio`` ist die Tiefe der Felsunterseite relativ
    zum Durchmesser. ``pond`` legt einen Teich an, ``stream`` einen Bach vom Teich zum Rand mit
    Wasserfall. Dichten sind Faktoren auf die Grunddichte der Bepflanzung. ``texel_size`` ist
    die Kantenlänge eines Texels der Inseltextur in Metern, gedeckelt durch ``max_texture``.
    """

    name: str
    seed: int
    diameter: float
    depth_ratio: float = 0.75
    pond: bool = True
    stream: bool = True
    tree_count: int | None = None
    grass_density: float = 1.0
    flower_density: float = 1.0
    texel_size: float = 0.05
    max_texture: int = 4096
    faces_per_meter: float = 1000.0

    def __post_init__(self) -> None:
        if not MIN_DIAMETER <= self.diameter <= MAX_DIAMETER:
            raise ValueError(f"Durchmesser {self.diameter} m liegt außerhalb von 10–100 m.")
        if self.stream and not self.pond:
            raise ValueError("Ein Bach braucht einen Teich als Quelle.")
        if not 0.4 <= self.depth_ratio <= 1.2:
            raise ValueError("depth_ratio muss zwischen 0,4 und 1,2 liegen.")

    @property
    def dimensions(self) -> IslandDimensions:
        """Abgeleitete Maße in Metern."""
        return IslandDimensions.of(self)

    @property
    def face_budget(self) -> int:
        """Dreiecksbudget des Inselkörpers."""
        return int(self.faces_per_meter * self.diameter)

    @property
    def default_tree_count(self) -> int:
        """Bäume aus der Größe: ~1 je 160 m² Plateaufläche, mindestens einer."""
        return self.tree_count if self.tree_count is not None else max(1, round(self.diameter**2 / 200.0))


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
            relief=0.016 * d,
            dome=0.022 * d,
        )

    @property
    def texture_area(self) -> float:
        """Grobe Oberfläche des Inselkörpers (Plateau + Unterseite) für die Texturgröße."""
        r, h = self.radius, self.depth
        return math.pi * r * r + 1.4 * math.pi * r * math.hypot(r, h)

    def texture_size(self, texel_size: float, maximum: int) -> int:
        """Zweierpotenz für die gewünschte Texelgröße bei ~70 % Atlasbelegung."""
        texels = math.sqrt(self.texture_area / 0.7) / texel_size
        return int(min(maximum, max(512, 2 ** math.ceil(math.log2(texels)))))
