"""Blattatlanten für Baumkronen: Laub-, Blüten- und Nadelzweige als RGBA-Textur (Blattatlas).

Ein Atlas hat 2 × 2 Zellen; jede Zelle zeigt einen Zweig, der am unteren Rand in der Mitte
ansetzt und nach oben wächst. Blattkarten im Baum setzen mit dieser Kante am Astende an. Alpha
ist mit einem Pixel Kantenweichheit gezeichnet (Alpha-Test mit Schwelle 0,5, glatte Mipmaps).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
import numpy.typing as npt
from modelkit.shading import linear_to_srgb, smoothstep, srgb_to_linear
from modelkit.tiling import encode_linear
from scipy import ndimage

type FloatArray = npt.NDArray[np.float64]
type ByteImage = npt.NDArray[np.uint8]
type Srgb = tuple[float, float, float]
type FoliageKind = Literal["broadleaf", "blossom", "needles"]

CELLS = 2  # Zellen je Achse


@dataclass(frozen=True, slots=True)
class FoliagePalette:
    """Farben eines Blattatlas in sRGB (Laubpalette)."""

    kind: FoliageKind
    leaf_dark: Srgb
    leaf_light: Srgb
    vein: Srgb
    twig: Srgb = (0.30, 0.22, 0.14)
    petal: Srgb = (0.98, 0.80, 0.86)
    petal_center: Srgb = (0.95, 0.55, 0.65)


FOLIAGE: dict[str, FoliagePalette] = {
    "Green": FoliagePalette("broadleaf", (0.17, 0.37, 0.09), (0.46, 0.65, 0.19), (0.55, 0.70, 0.30)),
    "Blossom": FoliagePalette("blossom", (0.20, 0.38, 0.10), (0.42, 0.60, 0.20), (0.5, 0.65, 0.3)),
    "Needles": FoliagePalette("needles", (0.06, 0.18, 0.08), (0.18, 0.36, 0.14), (0.25, 0.4, 0.2), twig=(0.32, 0.20, 0.12)),
}


class _Canvas:
    """RGBA-Leinwand einer Zelle in linearen Farben mit „über"-Verknüpfung (Zeichenfläche)."""

    def __init__(self, size: int) -> None:
        self.size = size
        coords = (np.arange(size) + 0.5) / size
        self.x, self.y = np.meshgrid(coords, 1.0 - coords)  # y wächst im Bild nach oben
        self.color = np.zeros((size, size, 3))
        self.alpha = np.zeros((size, size))

    @property
    def pixel(self) -> float:
        return 1.0 / self.size

    def paint(self, coverage: FloatArray, color: FloatArray) -> None:
        coverage = np.clip(coverage, 0.0, 1.0)
        self.color = self.color * (1.0 - coverage[..., None]) + color * coverage[..., None]
        self.alpha = self.alpha + coverage * (1.0 - self.alpha)

    def stroke(self, start: FloatArray, end: FloatArray, width: float, color: Srgb) -> None:
        """Strecke mit runden Enden (Zweig, Stiel)."""
        direction = end - start
        length_sq = float(direction @ direction)
        px, py = self.x - start[0], self.y - start[1]
        t = np.clip((px * direction[0] + py * direction[1]) / length_sq, 0.0, 1.0)
        distance = np.hypot(px - t * direction[0], py - t * direction[1])
        coverage = np.clip((0.5 * width - distance) / self.pixel + 0.5, 0.0, 1.0)
        self.paint(coverage, np.broadcast_to(srgb_to_linear(color), (*coverage.shape, 3)))


def _leaf(canvas: _Canvas, base: FloatArray, angle: float, length: float, width: float, palette: FoliagePalette, rng: np.random.Generator) -> None:
    """Eiförmiges Blatt mit Spitze, Mittelrippe, Seitenadern und dunklerem Rand."""
    cos_a, sin_a = np.cos(angle), np.sin(angle)
    px, py = canvas.x - base[0], canvas.y - base[1]
    along = (px * cos_a + py * sin_a) / length
    across = (-px * sin_a + py * cos_a) / length
    s = np.clip(along, 0.0, 1.0)
    half = (width / length) * np.sin(np.pi * s**0.75) ** 0.85 * (1.0 - 0.25 * s)
    edge = (half - np.abs(across)) * length / canvas.pixel
    coverage = np.clip(edge + 0.5, 0.0, 1.0) * (along >= 0.0) * (along <= 1.0)
    relative = np.abs(across) / np.maximum(half, 1e-6)
    tone = rng.uniform(0.0, 1.0)
    dark, light = srgb_to_linear(palette.leaf_dark), srgb_to_linear(palette.leaf_light)
    base_color = dark + (light - dark) * (0.25 + 0.6 * tone)
    shade = (0.75 + 0.35 * s - 0.2 * relative**2)[..., None]
    color = base_color * shade
    vein = srgb_to_linear(palette.vein)
    midrib = 1.0 - smoothstep(0.0, 0.06, relative)
    laterals = (1.0 - smoothstep(0.0, 0.08, np.abs(np.modf((s * 7.0 - relative * 2.2) + 10.0)[0] - 0.5) - 0.42)) * (relative < 0.85)
    color = color + (vein - color) * (0.7 * midrib + 0.25 * laterals)[..., None]
    rim = 1.0 - smoothstep(0.0, 1.5, edge)
    color = color * (1.0 - 0.35 * rim)[..., None]
    canvas.paint(coverage, color)


def _blossom(canvas: _Canvas, center: FloatArray, radius: float, palette: FoliagePalette, rng: np.random.Generator) -> None:
    """Fünfblättrige Blüte (Kirschblüte) mit dunklerer Mitte."""
    px, py = canvas.x - center[0], canvas.y - center[1]
    distance = np.hypot(px, py) / radius
    angle = np.arctan2(py, px) + rng.uniform(0.0, 2.0 * np.pi)
    petal_edge = 0.75 + 0.25 * np.abs(np.cos(2.5 * angle)) ** 0.6
    coverage = np.clip((petal_edge - distance) * radius / canvas.pixel + 0.5, 0.0, 1.0)
    petal, middle = srgb_to_linear(palette.petal), srgb_to_linear(palette.petal_center)
    mix = (1.0 - smoothstep(0.1, 0.55, distance))[..., None]
    color = petal * (0.9 + 0.1 * rng.random()) * (1.0 - mix) + middle * mix
    canvas.paint(coverage, color)


def _cell_broadleaf(canvas: _Canvas, palette: FoliagePalette, rng: np.random.Generator, with_blossoms: bool) -> None:
    twig_end = np.array([0.5 + rng.uniform(-0.1, 0.1), 0.88])
    canvas.stroke(np.array([0.5, 0.0]), twig_end, 0.022, palette.twig)
    count = int(rng.integers(7, 11))
    for index in range(count):
        t = 0.15 + 0.8 * index / count
        anchor = np.array([0.5, 0.0]) + t * (twig_end - np.array([0.5, 0.0]))
        side = 1.0 if index % 2 else -1.0
        angle = np.pi / 2 + side * np.radians(rng.uniform(45.0, 80.0)) * (1.0 - 0.4 * t)
        length = rng.uniform(0.3, 0.46) * (1.0 - 0.3 * t)
        canvas.stroke(anchor, anchor + 0.04 * np.array([np.cos(angle), np.sin(angle)]), 0.008, palette.twig)
        _leaf(canvas, anchor + 0.03 * np.array([np.cos(angle), np.sin(angle)]), angle, length, 0.38 * length, palette, rng)
    _leaf(canvas, twig_end - np.array([0.0, 0.03]), np.pi / 2 + rng.normal(0, 0.15), 0.22, 0.09, palette, rng)
    if with_blossoms:
        for _ in range(int(rng.integers(9, 14))):
            center = np.array([rng.uniform(0.15, 0.85), rng.uniform(0.2, 0.95)])
            _blossom(canvas, center, rng.uniform(0.045, 0.07), palette, rng)


def _cell_needles(canvas: _Canvas, palette: FoliagePalette, rng: np.random.Generator) -> None:
    twig_end = np.array([0.5 + rng.uniform(-0.08, 0.08), 0.95])
    canvas.stroke(np.array([0.5, 0.0]), twig_end, 0.02, palette.twig)
    dark, light = srgb_to_linear(palette.leaf_dark), srgb_to_linear(palette.leaf_light)
    for side_branch in range(5):
        t = 0.15 + 0.17 * side_branch
        anchor = np.array([0.5, 0.0]) + t * (twig_end - np.array([0.5, 0.0]))
        for side in (-1.0, 1.0):
            angle = np.pi / 2 + side * np.radians(rng.uniform(45.0, 65.0))
            end = anchor + rng.uniform(0.25, 0.38) * (1.0 - 0.4 * t) * np.array([np.cos(angle), np.sin(angle)])
            canvas.stroke(anchor, end, 0.012, palette.twig)
            for needle in np.linspace(0.05, 1.0, 14):
                root = anchor + needle * (end - anchor)
                for flank in (-1.0, 1.0):
                    needle_angle = angle + flank * np.radians(rng.uniform(40.0, 60.0))
                    tip = root + rng.uniform(0.06, 0.1) * np.array([np.cos(needle_angle), np.sin(needle_angle)])
                    shade = dark + (light - dark) * rng.uniform(0.2, 1.0)
                    canvas.stroke(root, tip, 0.009, tuple(linear_to_srgb(shade[None, :])[0]))


def build_foliage_atlas(name: str, seed: int, size: int = 1024) -> ByteImage:
    """Zeichnet den Atlas ``name`` (``FOLIAGE``) als sRGB-RGBA-Bild (size × size)."""
    palette = FOLIAGE[name]
    rng = np.random.default_rng(seed)
    cell_size = size // CELLS
    image = np.zeros((size, size, 4))
    for row in range(CELLS):
        for col in range(CELLS):
            canvas = _Canvas(cell_size)
            if palette.kind == "needles":
                _cell_needles(canvas, palette, rng)
            else:
                _cell_broadleaf(canvas, palette, rng, with_blossoms=palette.kind == "blossom")
            image[row * cell_size : (row + 1) * cell_size, col * cell_size : (col + 1) * cell_size] = _finish(canvas)
    return encode_linear(image)


def _finish(canvas: _Canvas) -> FloatArray:
    """Entmultipliziert die Farbe und setzt sie unter transparente Pixel fort (keine dunklen Mipmap-Säume)."""
    opaque = canvas.alpha > 0.5
    linear = canvas.color / np.maximum(canvas.alpha, 1e-6)[..., None]
    if np.any(opaque):
        _, (rows, cols) = ndimage.distance_transform_edt(~opaque, return_indices=True)
        linear = np.where(opaque[..., None], linear, linear[rows, cols])
    srgb = linear_to_srgb(linear.reshape(-1, 3)).reshape(linear.shape)
    return np.concatenate([srgb, canvas.alpha[..., None]], axis=-1)


def cell_rect(index: int) -> tuple[float, float, float, float]:
    """UV-Rechteck (u0, v0, u1, v1) der Zelle ``index`` (0..3); v0 oben im Bild wie in glTF."""
    row, col = divmod(index % (CELLS * CELLS), CELLS)
    inset = 0.004
    return (col / CELLS + inset, row / CELLS + inset, (col + 1) / CELLS - inset, (row + 1) / CELLS - inset)
