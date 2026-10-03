"""Leuchtmasken der Blüten: Blütenblatt-Maske × Blütenfarbe als kleine Emissive-Textur (Blütenleuchten).

Jede Blütenart hat ein eigenes Material ``Flora_Blossom_<Art>`` mit dieser Textur als
``emissiveTexture`` und ``emissiveFactor`` (0, 0, 0). Tagsüber leuchtet nichts; nachts setzt das
Spiel die Emissive-Farbe hoch, dann leuchten nur die Blüten (Stängel und Blätter liegen im
Material ``Flora_Plant`` ohne Leuchttextur).

Aufteilung in UV (``islandkit.plants``): links (u 0…0,75) die Blütenblätter — u quer über das
Blatt, v vom Ansatz (0) zur Spitze (1) —, rechts (u ab 0,75) die Blütenmitte mit v von innen nach
außen. Die Textur ist sRGB-kodiert wie jede Farbtextur in glTF.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from modelkit.shading import linear_to_srgb, smoothstep, srgb_to_linear

from islandkit.plants import PETAL_U

type FloatArray = npt.NDArray[np.float64]
type ByteImage = npt.NDArray[np.uint8]
type Srgb = tuple[float, float, float]

GLOW_TEXTURE_SIZE = 64


@dataclass(frozen=True, slots=True)
class BlossomGlow:
    """Leuchtfarben einer Blütenart (Blütenleuchten): Verlauf der Blütenblätter, Mitte, Leuchtanteil der Mitte."""

    petal_colors: Sequence[Srgb]
    center_colors: Sequence[Srgb]
    center_glow: float


def _gradient(stops: Sequence[Srgb], t: FloatArray) -> FloatArray:
    colors = np.array([srgb_to_linear(c) for c in stops])
    if len(colors) == 1:
        return np.broadcast_to(colors[0], (*t.shape, 3)).copy()
    position = np.clip(t, 0.0, 1.0) * (len(colors) - 1)
    low = np.floor(position).astype(int).clip(0, len(colors) - 2)
    blend = (position - low)[..., None]
    return colors[low] * (1.0 - blend) + colors[low + 1] * blend


def _luminous(color: FloatArray, level: float) -> FloatArray:
    """Hebt eine Farbe bei gleichem Farbton auf die Leuchthelligkeit an (stärkster Kanal = ``level``)."""
    peak = np.maximum(color.max(axis=-1, keepdims=True), 1e-6)
    return color / peak * level


def build_glow_texture(glow: BlossomGlow, size: int = GLOW_TEXTURE_SIZE) -> ByteImage:
    """Zeichnet die Leuchtmaske (size × size, RGB, sRGB): Blütenblätter links, Blütenmitte rechts."""
    coords = (np.arange(size) + 0.5) / size
    u, v = np.meshgrid(coords, coords)  # Zeile = v (glTF: v = 0 oben im Bild)
    petal_u = np.clip((u - PETAL_U[0]) / (PETAL_U[1] - PETAL_U[0]), 0.0, 1.0)
    across = 0.6 + 0.4 * (1.0 - np.abs(2.0 * petal_u - 1.0)) ** 0.7
    along = 0.45 + 0.55 * smoothstep(0.0, 0.4, v)
    petals = _luminous(_gradient(glow.petal_colors, v), 0.95) * (across * along)[..., None]
    center_t = np.clip((v - 0.1) / 0.8, 0.0, 1.0)
    center = _luminous(_gradient(glow.center_colors, center_t), 0.9) * glow.center_glow
    linear = np.where((u < PETAL_U[1])[..., None], petals, center)
    srgb = linear_to_srgb(linear.reshape(-1, 3)).reshape(linear.shape)
    return np.round(np.clip(srgb, 0.0, 1.0) * 255.0).astype(np.uint8)
