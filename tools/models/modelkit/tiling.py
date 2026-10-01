"""Nahtlos kachelnde Bildmuster: periodisches Spektralrauschen und Normal-Maps aus Höhen (Kachelmuster).

Spektralrauschen entsteht per inverser FFT aus einem zufälligen Spektrum und ist dadurch in
beiden Richtungen periodisch — die Textur kachelt ohne Naht (REPEAT-Sampler). Bildkonvention
wie in glTF: Zeile 0 liegt bei v = 0 (oben im Bild).
"""

from __future__ import annotations

import numpy as np
import numpy.typing as npt

type FloatArray = npt.NDArray[np.float64]
type ByteImage = npt.NDArray[np.uint8]


def periodic_noise(
    height: int,
    width: int,
    seed: int,
    *,
    exponent: float = 2.0,
    stretch: tuple[float, float] = (1.0, 1.0),
    shortest: float = 2.0,
    longest: float | None = None,
) -> FloatArray:
    """Periodisches Rauschen (H, W) mit Mittelwert 0 und Standardabweichung 1.

    Amplitude ∝ 1/f^(exponent/2); ``stretch`` (quer, längs) dehnt die Strukturen — (1, 6) ergibt
    senkrechte Fasern. ``shortest``/``longest`` begrenzen die Wellenlängen in Pixeln.
    """
    rng = np.random.default_rng(seed)
    fy = np.fft.fftfreq(height)[:, None] * height
    fx = np.fft.rfftfreq(width)[None, :] * width
    across, along = stretch
    radius = np.sqrt((fx * across / width) ** 2 + (fy * along / height) ** 2)
    with np.errstate(divide="ignore"):
        amplitude = np.where(radius > 0, radius ** (-exponent / 2.0), 0.0)
    frequency = np.sqrt((fx / width) ** 2 + (fy / height) ** 2)
    amplitude *= frequency <= 1.0 / shortest
    if longest is not None:
        amplitude *= frequency >= 1.0 / longest
    spectrum = amplitude * (rng.normal(size=amplitude.shape) + 1j * rng.normal(size=amplitude.shape))
    field = np.fft.irfft2(spectrum, s=(height, width))
    return (field - field.mean()) / max(field.std(), 1e-12)


def height_to_normal(heights: FloatArray, strength: float) -> FloatArray:
    """Tangentenraum-Normalen (H, W, 3) aus einem periodischen Höhenbild; +Y zeigt im Bild nach oben."""
    d_col = (np.roll(heights, -1, axis=1) - np.roll(heights, 1, axis=1)) * 0.5
    d_row = (np.roll(heights, -1, axis=0) - np.roll(heights, 1, axis=0)) * 0.5
    normals = np.stack([-d_col * strength, d_row * strength, np.ones_like(heights)], axis=-1)
    return normals / np.linalg.norm(normals, axis=-1, keepdims=True)


def encode_normal(normals: FloatArray) -> ByteImage:
    """Kodiert Normalen (−1..1) als 8-Bit-RGB."""
    return np.round(np.clip(normals * 0.5 + 0.5, 0.0, 1.0) * 255.0).astype(np.uint8)


def encode_linear(values: FloatArray) -> ByteImage:
    """Kodiert lineare Werte 0..1 als 8 Bit (Masken, Alpha, ORM)."""
    return np.round(np.clip(values, 0.0, 1.0) * 255.0).astype(np.uint8)
