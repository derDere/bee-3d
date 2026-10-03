"""Kachelnde Materialtexturen aus Spektralrauschen: Rinde und Wurzeln (Textursätze).

Jeder Satz besteht aus Basisfarbe (sRGB) und Normal-Map und kachelt in u und v (REPEAT).
u läuft um den Umfang, v entlang der Länge — Fasern und Furchen liegen längs.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from modelkit.shading import linear_to_srgb, smoothstep, srgb_to_linear
from modelkit.tiling import encode_linear, encode_normal, height_to_normal, periodic_noise

type FloatArray = npt.NDArray[np.float64]
type ByteImage = npt.NDArray[np.uint8]
type Srgb = tuple[float, float, float]


@dataclass(frozen=True, slots=True)
class TextureSet:
    """Kachelnder Textursatz (Textursatz): Basisfarbe sRGB, Normal-Map, Rauheit als Faktor."""

    color: ByteImage
    normal: ByteImage
    roughness: float


def _encode_color(linear: FloatArray) -> ByteImage:
    return encode_linear(linear_to_srgb(linear.reshape(-1, 3)).reshape(linear.shape))


def bark(seed: int, *, size: int = 512, light: Srgb = (0.47, 0.37, 0.28), dark: Srgb = (0.18, 0.13, 0.10)) -> TextureSet:
    """Borke mit Längsfurchen und Platten; dunkle Furchen, hellere Rücken."""
    fibers = periodic_noise(size, size, seed, exponent=2.2, stretch=(1.0, 7.0), shortest=2.0)
    plates = periodic_noise(size, size, seed + 1, exponent=3.0, stretch=(1.0, 2.5), shortest=4.0)
    ridges = 1.0 - np.abs(np.tanh(0.9 * fibers))
    height = 0.65 * ridges + 0.35 * smoothstep(-1.0, 1.0, plates)
    shade = smoothstep(0.25, 0.85, height)
    speckle = periodic_noise(size, size, seed + 2, exponent=1.2, shortest=2.0)
    color = srgb_to_linear(dark)[None, None, :] + (srgb_to_linear(light) - srgb_to_linear(dark))[None, None, :] * shade[..., None]
    color *= (0.9 + 0.1 * np.tanh(speckle))[..., None]
    return TextureSet(_encode_color(color), encode_normal(height_to_normal(height * 6.0, strength=1.0)), 0.9)


def root(seed: int, *, size: int = 256) -> TextureSet:
    """Wurzelrinde: feiner, dunkler und erdiger als Borke."""
    return bark(seed, size=size, light=(0.42, 0.31, 0.21), dark=(0.17, 0.11, 0.07))


def dead_root(seed: int, *, size: int = 256) -> TextureSet:
    """Abgestorbene Wurzeln der Nest-Insel: grau verwittert mit dunklen Furchen."""
    return bark(seed, size=size, light=(0.36, 0.33, 0.30), dark=(0.10, 0.09, 0.09))


def dead_bark(seed: int, *, size: int = 512) -> TextureSet:
    """Totholz: silbergrau verwittert, tiefe dunkle Risse, rauer als lebende Borke."""
    texture = bark(seed, size=size, light=(0.60, 0.57, 0.52), dark=(0.20, 0.18, 0.17))
    return TextureSet(texture.color, texture.normal, 0.95)
