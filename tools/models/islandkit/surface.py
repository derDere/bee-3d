"""Oberfläche des Inselkörpers je Punkt: Gras, kahle Stellen, Erdband, Fels, Moos, Ufer, Bachbett (Inseloberfläche).

Alle Farben werden linear gerechnet; die Palette wird in sRGB notiert. Die Zonen entstehen aus
den Geländemerkmalen (``TerrainSample``), der Flächenneigung und der gebackenen Verdeckung.
Steile Flächen auf dem Plateau (Felsstufe der Terrasse) zeigen Fels. Für ferne Detailstufen
färben ``PatchTint``-Flecken die Wiese dort, wo in LOD0 Blumenfelder stehen. Die Palette der
Fliegennester (``ROT_PALETTE``) zeigt faulige, dunkle Erde mit violetten Flecken und giftgrünem
Schleim.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from modelkit.noise import Cellular, Fractal, hash01
from modelkit.shading import smoothstep, srgb_to_linear

from islandkit.spec import Biome
from islandkit.terrain import IslandTerrain, TerrainSample

type FloatArray = npt.NDArray[np.float64]
type Srgb = tuple[float, float, float]


@dataclass(frozen=True, slots=True)
class IslandPalette:
    """Farbpalette der Insel in sRGB (Inselpalette): Plateau hell und satt, Unterseite dunkler und kühler.

    ``bare_threshold`` steuert den Anteil kahler Stellen (kleiner = mehr kahle Erde),
    ``slime``/``blotch`` färben Schleim- und Fäulnisflecken auf dem Plateau (nur Nest-Inseln).
    """

    grass: Srgb = (0.34, 0.54, 0.17)
    grass_dark: Srgb = (0.19, 0.36, 0.10)
    grass_light: Srgb = (0.52, 0.64, 0.22)
    grass_dry: Srgb = (0.60, 0.58, 0.28)
    soil: Srgb = (0.40, 0.27, 0.17)
    soil_dark: Srgb = (0.22, 0.14, 0.08)
    soil_light: Srgb = (0.55, 0.41, 0.27)
    rock_layers: Sequence[Srgb] = (
        (0.60, 0.55, 0.48),
        (0.64, 0.56, 0.44),
        (0.54, 0.51, 0.47),
        (0.60, 0.50, 0.40),
        (0.66, 0.62, 0.55),
        (0.57, 0.53, 0.48),
    )
    rock_deep: Srgb = (0.30, 0.31, 0.37)
    moss: Srgb = (0.30, 0.43, 0.13)
    sand: Srgb = (0.74, 0.66, 0.49)
    mud: Srgb = (0.27, 0.23, 0.16)
    pebble: Srgb = (0.66, 0.64, 0.60)
    bare_threshold: tuple[float, float] = (0.32, 0.5)
    slime: Srgb | None = None
    blotch: Srgb | None = None


ROT_PALETTE = IslandPalette(
    grass=(0.20, 0.18, 0.11),
    grass_dark=(0.10, 0.08, 0.07),
    grass_light=(0.28, 0.25, 0.13),
    grass_dry=(0.27, 0.19, 0.20),
    soil=(0.17, 0.11, 0.10),
    soil_dark=(0.07, 0.05, 0.05),
    soil_light=(0.22, 0.15, 0.14),
    rock_layers=((0.33, 0.30, 0.33), (0.36, 0.32, 0.34), (0.29, 0.28, 0.31), (0.34, 0.29, 0.30), (0.31, 0.30, 0.34)),
    rock_deep=(0.13, 0.13, 0.17),
    moss=(0.24, 0.34, 0.06),
    sand=(0.24, 0.19, 0.15),
    mud=(0.12, 0.10, 0.08),
    pebble=(0.32, 0.30, 0.30),
    bare_threshold=(0.0, 0.3),
    slime=(0.38, 0.66, 0.06),
    blotch=(0.30, 0.10, 0.32),
)


def palette_for(biome: Biome) -> IslandPalette:
    """Palette eines Landschaftsbilds."""
    return ROT_PALETTE if biome == "rot" else IslandPalette()


@dataclass(frozen=True, slots=True)
class PatchTint:
    """Farbfleck eines Blumenfelds für ferne Detailstufen (Feldtönung): Mitte (x, z), Radius, Blütenfarbe sRGB, Stärke."""

    center: FloatArray
    radius: float
    color: Srgb
    strength: float = 1.0


@dataclass(frozen=True, slots=True)
class PaintedSurface:
    """Ergebnis der Bemalung je Punkt (bemalte Oberfläche): lineare Farbe (N, 3), Rauheit (N,)."""

    color: FloatArray
    roughness: FloatArray


@dataclass(frozen=True, slots=True)
class _PaintNoises:
    """Rauschfelder für Muster der Bemalung; Frequenzen relativ zur Inselgröße."""

    edge: Fractal
    patches: Fractal
    meadow: Fractal
    clumps: Fractal
    bare: Fractal
    roots: Fractal
    streaks: Fractal
    moss: Fractal
    speckle: Fractal
    slime: Fractal
    pebbles: Cellular

    @staticmethod
    def create(seed: int, diameter: float, soil_depth: float) -> _PaintNoises:
        return _PaintNoises(
            edge=Fractal(seed + 1, 0.9, octaves=4),
            patches=Fractal(seed + 2, 6.0 / diameter, octaves=4),
            meadow=Fractal(seed + 3, 3.0 / diameter, octaves=4),
            clumps=Fractal(seed + 4, 1.4, octaves=4),
            bare=Fractal(seed + 5, 9.0 / diameter, octaves=4),
            roots=Fractal(seed + 6, 1.6 / soil_depth, octaves=3, ridged=True),
            streaks=Fractal(seed + 8, 14.0 / diameter, octaves=3),
            moss=Fractal(seed + 9, 12.0 / diameter, octaves=4),
            speckle=Fractal(seed + 10, 9.0, octaves=3),
            slime=Fractal(seed + 11, 0.45, octaves=4),
            pebbles=Cellular(seed + 7, 7.0, jitter=0.9),
        )


def _mix(a: FloatArray, b: FloatArray, t: FloatArray) -> FloatArray:
    return a + (b - a) * t[:, None]


def _uniform(srgb: Srgb, count: int) -> FloatArray:
    return np.tile(srgb_to_linear(srgb), (count, 1))


class IslandPainter:
    """Bemalt Punkte des Inselkörpers (Inselmaler); seedbar, Muster in Weltkoordinaten."""

    def __init__(self, terrain: IslandTerrain, palette: IslandPalette | None = None, tints: Sequence[PatchTint] = ()) -> None:
        self.terrain = terrain
        self.palette = palette or palette_for(terrain.spec.biome)
        self.tints = tuple(tints)
        dims = terrain.dims
        self._noise = _PaintNoises.create(terrain.spec.seed + 100, 2.0 * dims.radius, dims.soil_depth)
        self._outlet = terrain.stream_outlet()

    def paint(
        self, points: FloatArray, normals: FloatArray, sample: TerrainSample, occlusion: FloatArray
    ) -> PaintedSurface:
        """Farbe und Rauheit je Punkt; ``normals`` sind die Detailnormalen, ``occlusion`` 1 = frei."""
        dims = self.terrain.dims
        up = normals[:, 1]
        water_distance = np.minimum(sample.pond, sample.stream)

        bed = 1.0 - smoothstep(-0.05, 0.12, water_distance)
        edge = self._noise.edge(points)
        lip = dims.lip_depth
        grass = 1.0 - smoothstep(0.5 * lip, 1.2 * lip, sample.below_top + 0.4 * lip * edge)
        grass *= smoothstep(0.25, 0.6, up) * (1.0 - bed)
        rock = smoothstep(0.75, 1.25, (sample.below_top + 0.4 * dims.soil_depth * edge) / dims.soil_depth)
        # Steile Flächen auf dem Plateau (Felsstufe) zeigen Fels
        cliff = (1.0 - smoothstep(0.42, 0.72, up)) * (1.0 - smoothstep(0.9, 0.97, sample.radial)) * (1.0 - bed)
        cliff *= 1.0 - smoothstep(0.6, 1.0, sample.below_top / dims.soil_depth)
        rock = np.maximum(rock, cliff)
        grass *= 1.0 - cliff
        rock *= 1.0 - grass
        soil = np.clip(1.0 - grass - rock - bed, 0.0, 1.0)

        color = (
            grass[:, None] * self._grass(points, sample)
            + soil[:, None] * self._soil(points)
            + rock[:, None] * self._rock(points, up, sample, occlusion)
            + bed[:, None] * self._bed(sample)
        )
        roughness = 0.92 * grass + 0.95 * soil + (0.84 - 0.12 * sample.crag) * rock + 0.5 * bed

        # Schleim der Nest-Inseln glänzt
        if self.palette.slime is not None:
            slime = self._slime_mask(points, sample) * grass
            roughness += (0.25 - roughness) * slime

        # Ufer: Sandsaum knapp über dem Wasserspiegel
        shore = (1.0 - smoothstep(0.0, 0.9, water_distance)) * (1.0 - smoothstep(0.05, 0.35, sample.waterline))
        shore *= 1.0 - bed
        color = _mix(color, self._sand(points), 0.9 * shore)
        roughness += (0.6 - roughness) * shore

        # Nasse Felswand unter dem Wasserfall
        wet = self._waterfall_wetness(points)
        color *= (1.0 - 0.45 * wet)[:, None]
        roughness += (0.3 - roughness) * wet

        # Ferne Detailstufen: Blumenfelder als Farbflecken in der Wiese
        if self.tints:
            color = self._tint(points, color, grass)

        # Höhlungen etwas dunkler; die volle Verdeckung trägt die ORM-Textur
        color *= (0.78 + 0.22 * occlusion)[:, None]
        return PaintedSurface(np.clip(color, 0.0, 1.0), np.clip(roughness, 0.05, 1.0))

    def bare_ground(self, points: FloatArray, sample: TerrainSample) -> FloatArray:
        """Anteil kahler Erd- und Kiesflecken im Gras (0..1), gehäuft zur Kante hin (kahle Stellen)."""
        shift = 0.35 * self.terrain.spec.barren
        low, high = self.palette.bare_threshold[0] - shift, self.palette.bare_threshold[1] - shift
        return smoothstep(low, high, self._noise.bare(points)) * (0.5 + 0.5 * smoothstep(0.8, 1.0, sample.radial))

    # --- Zonen ----------------------------------------------------------------------------

    def _grass(self, points: FloatArray, sample: TerrainSample) -> FloatArray:
        palette, noise = self.palette, self._noise
        meadow, patches, clumps = noise.meadow(points), noise.patches(points), noise.clumps(points)
        color = _mix(_uniform(palette.grass_dark, len(points)), srgb_to_linear(palette.grass), smoothstep(-0.35, 0.25, meadow))
        color = _mix(color, srgb_to_linear(palette.grass_light), 0.55 * smoothstep(0.05, 0.45, patches))
        dry = 0.5 * smoothstep(0.2, 0.55, -patches) * smoothstep(0.75, 1.0, sample.radial)
        color = _mix(color, srgb_to_linear(palette.grass_dry), dry)
        color *= (0.88 + 0.24 * smoothstep(-0.4, 0.4, clumps))[:, None]
        # Kahle Stellen mit Erde und Kies, gehäuft zur Kante hin
        color = _mix(color, self._soil(points, light=True), 0.85 * self.bare_ground(points, sample))
        if palette.blotch is not None:
            blotch = smoothstep(0.15, 0.4, noise.patches(points * 1.7 + 13.0))
            color = _mix(color, srgb_to_linear(palette.blotch), 0.7 * blotch)
        if palette.slime is not None:
            color = _mix(color, srgb_to_linear(palette.slime), 0.85 * self._slime_mask(points, sample))
        return color

    def _slime_mask(self, points: FloatArray, sample: TerrainSample) -> FloatArray:
        """Giftgrüne Schleimpfützen als Flecken auf dem Plateau, zur Kante hin ausgeblendet."""
        return smoothstep(0.28, 0.42, self._noise.slime(points)) * (1.0 - smoothstep(0.85, 0.98, sample.radial))

    def _soil(self, points: FloatArray, light: bool = False) -> FloatArray:
        palette, noise = self.palette, self._noise
        base = srgb_to_linear(palette.soil_light if light else palette.soil)
        color = base[None, :] * (0.85 + 0.3 * smoothstep(-0.4, 0.4, noise.speckle(points)))[:, None]
        # Feine Wurzelfasern als dunkle, waagrecht gestreckte Linien
        roots = smoothstep(0.86, 0.96, noise.roots(points * np.array([1.0, 2.5, 1.0])))
        color = _mix(color, srgb_to_linear(palette.soil_dark), 0.8 * roots)
        cells = noise.pebbles.evaluate(points)
        pebbles = (1.0 - smoothstep(0.2, 0.28, cells.first)) * (cells.value > 0.82)
        return _mix(color, srgb_to_linear(palette.pebble) * (0.55 + 0.25 * cells.value[:, None]), pebbles)

    def _rock(self, points: FloatArray, up: FloatArray, sample: TerrainSample, occlusion: FloatArray) -> FloatArray:
        palette, terrain = self.palette, self.terrain
        layers = np.array([srgb_to_linear(c) for c in palette.rock_layers])
        index = np.floor(sample.layer)
        fraction = sample.layer - index
        seed = terrain.spec.seed
        lower = (hash01(index + seed) * len(layers)).astype(int) % len(layers)
        upper = (hash01(index + 1.0 + seed) * len(layers)).astype(int) % len(layers)
        color = _mix(layers[lower], layers[upper], smoothstep(0.88, 1.0, fraction))
        seam = 1.0 - smoothstep(0.0, 0.07, np.minimum(fraction, 1.0 - fraction))
        color *= (1.0 - 0.18 * seam)[:, None]
        color *= (0.82 + 0.32 * sample.block)[:, None]
        color *= (1.0 - 0.55 * sample.crack)[:, None]
        color *= (0.88 + 0.28 * sample.crag)[:, None]
        # Senkrechte Wasserspuren unter Simsen
        streaks = self._noise.streaks(points * np.array([1.0, 0.18, 1.0]))
        color *= (1.0 - 0.28 * smoothstep(0.05, 0.45, streaks))[:, None]
        # Zur Spitze hin dunkler und kühler (Werteabstufung zum hellen Plateau)
        depth = terrain.rock_fraction(points[:, 1])
        color = _mix(color, srgb_to_linear(palette.rock_deep), 0.7 * smoothstep(0.05, 0.9, depth))
        # Moos auf nach oben weisenden Simsen der oberen Felswand
        moss = smoothstep(0.3, 0.65, up) * (1.0 - smoothstep(0.15, 0.5, depth))
        moss *= smoothstep(-0.1, 0.35, self._noise.moss(points)) * (0.6 + 0.4 * occlusion)
        return _mix(color, srgb_to_linear(palette.moss), 0.9 * moss)

    def _bed(self, sample: TerrainSample) -> FloatArray:
        depth = np.clip(-sample.waterline, 0.0, None)
        return _mix(_uniform(self.palette.sand, len(depth)), srgb_to_linear(self.palette.mud), smoothstep(0.05, 0.6, depth))

    def _sand(self, points: FloatArray) -> FloatArray:
        speckle = self._noise.speckle(points * 2.3)
        return srgb_to_linear(self.palette.sand)[None, :] * (0.85 + 0.25 * smoothstep(-0.4, 0.4, speckle))[:, None]

    def _tint(self, points: FloatArray, color: FloatArray, grass: FloatArray) -> FloatArray:
        """Blütenfarbe der Blumenfelder als weicher, fleckiger Schleier über der Wiese."""
        speckle = smoothstep(-0.3, 0.5, self._noise.clumps(points * 2.0))
        for tint in self.tints:
            distance = np.hypot(points[:, 0] - tint.center[0], points[:, 2] - tint.center[1]) / tint.radius
            weight = (1.0 - smoothstep(0.55, 1.05, distance)) * (0.45 + 0.35 * speckle) * grass * tint.strength
            color = _mix(color, srgb_to_linear(tint.color), weight)
        return color

    def _waterfall_wetness(self, points: FloatArray) -> FloatArray:
        outlet = self._outlet
        if outlet is None:
            return np.zeros(len(points))
        offset = points[:, [0, 2]] - outlet.position[[0, 2]]
        across = offset @ np.array([-outlet.direction[1], outlet.direction[0]])
        drop = outlet.position[1] - points[:, 1]
        spread = 1.4 * outlet.half_width + 0.08 * np.clip(drop, 0.0, None)
        falloff = 1.0 - smoothstep(0.0, 0.35 * self.terrain.dims.depth, drop)
        return np.exp(-((across / spread) ** 2)) * smoothstep(-0.3, 0.3, drop) * falloff
