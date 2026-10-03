"""Kachelnde Texturen des Bienenstocks: Stroh mit Halmen und Bindungen, Wachs, Holz, Honig, Stoff (Kacheltexturen).

Alle Muster sind in u periodisch (Sampler REPEAT), Wachs, Holz, Honig und Stoff auch in v. Die
Strohkachel bildet genau einen Wulst ab: v läuft von Rille zu Rille quer über den Wulst, u
entlang des Wulstes über 2 m mit drei Bindungen aus gespaltenem Rohr. Bildzeile 0 entspricht
v = 0 (glTF). Farben werden linear gerechnet und als sRGB kodiert; ORM ist linear.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from modelkit.shading import linear_to_srgb, smoothstep, srgb_to_linear
from modelkit.tiling import encode_linear, encode_normal, height_to_normal, periodic_noise
from PIL import Image

type FloatArray = npt.NDArray[np.float64]
type ByteImage = npt.NDArray[np.uint8]


def _hex(color: str) -> FloatArray:
    value = color.lstrip("#")
    return srgb_to_linear([int(value[i : i + 2], 16) / 255.0 for i in (0, 2, 4)])


@dataclass(frozen=True, slots=True)
class TextureSet:
    """Gebackene Bilder eines Materials (Texturensatz): Farbe (sRGB), ORM (linear), optional Normal- und Leuchtkarte."""

    color: ByteImage
    orm: ByteImage
    normal: ByteImage | None = None
    emissive: ByteImage | None = None

    def resized(self, width: int, height: int, orm_divisor: int = 1) -> TextureSet:
        """Verkleinert alle Bilder (Flächenmittel); die niederfrequente ORM-Karte zusätzlich um ``orm_divisor``."""

        def shrink(image: ByteImage, size: tuple[int, int]) -> ByteImage:
            if image.shape[1] == size[0] and image.shape[0] == size[1]:
                return image
            return np.asarray(Image.fromarray(image).resize(size, Image.Resampling.BOX))

        size = (width, height)
        return TextureSet(
            shrink(self.color, size),
            shrink(self.orm, (max(1, width // orm_divisor), max(1, height // orm_divisor))),
            None if self.normal is None else shrink(self.normal, size),
            None if self.emissive is None else shrink(self.emissive, size),
        )


def _encode_color(linear: FloatArray) -> ByteImage:
    return encode_linear(linear_to_srgb(np.clip(linear, 0.0, 1.0)))


def _orm(occlusion: FloatArray, roughness: FloatArray, metallic: FloatArray | float = 0.0) -> ByteImage:
    metal = np.broadcast_to(np.asarray(metallic, dtype=np.float64), occlusion.shape)
    return encode_linear(np.stack([occlusion, roughness, metal], axis=-1))


def _periodic_distance(a: FloatArray, b: FloatArray) -> FloatArray:
    """Abstand auf dem Einheitskreis (Periode 1)."""
    d = np.abs(a - b) % 1.0
    return np.minimum(d, 1.0 - d)


def _stalk_layout(
    height: int, width: int, stalks: int, rng: np.random.Generator
) -> tuple[npt.NDArray[np.int64], FloatArray]:
    """Halm je Texel und Lage quer im Halm (0..1); die Halmgrenzen wandern leicht entlang u (in u periodisch)."""
    u = ((np.arange(width) + 0.5) / width)[None, :]
    v = ((np.arange(height) + 0.5) / height)[:, None]
    spacing = 1.0 / stalks
    edges = (np.arange(stalks + 1) + np.concatenate([[0.0], rng.uniform(-0.25, 0.25, stalks - 1), [0.0]])) * spacing
    boundaries = [np.zeros_like(u)]
    for k in range(1, stalks):
        first, second = (int(f) for f in rng.integers(1, 5, 2))
        drift = 0.22 * np.sin(2.0 * np.pi * first * u + rng.uniform(0, 2 * np.pi)) + 0.12 * np.sin(
            2.0 * np.pi * second * u + rng.uniform(0, 2 * np.pi)
        )
        boundaries.append(edges[k] + spacing * drift)
    boundaries.append(np.ones_like(u))
    index = np.zeros((height, width), dtype=np.int64)
    lower = np.zeros((height, width))
    upper = np.ones((height, width))
    for k in range(1, stalks + 1):
        inside = (v >= boundaries[k - 1]) & (v < boundaries[k])
        index = np.where(inside, k - 1, index)
        lower = np.where(inside, boundaries[k - 1], lower)
        upper = np.where(inside, boundaries[k], upper)
    return index, np.clip((v - lower) / np.maximum(upper - lower, 1e-6), 0.0, 1.0)


def straw_textures(width: int, height: int, seed: int) -> TextureSet:
    """Strohwulst: 19 glänzende Halme quer (je ~5 cm), Halmknoten, feine Fasern, drei schräge Bindungen je Kachel, dunkle Rillen.

    Eine Bindung besteht aus zwei verdrehten Strängen gespaltenen Rohrs (rötliches Hellbraun),
    die das Stroh unter sich zusammendrücken.
    """
    rng = np.random.default_rng(seed)
    u = ((np.arange(width) + 0.5) / width)[None, :]
    v = ((np.arange(height) + 0.5) / height)[:, None]
    stalks = 19
    index, t = _stalk_layout(height, width, stalks, rng)
    profile = np.sqrt(np.clip(1.0 - (2.0 * t - 1.0) ** 2, 0.0, 1.0))
    gap = 1.0 - smoothstep(0.0, 0.1, np.minimum(t, 1.0 - t))
    shine = np.exp(-(((t - 0.36) / 0.09) ** 2))

    palette = np.stack([_hex("#eec258"), _hex("#f6d888"), _hex("#dca244"), _hex("#eaa94a"), _hex("#dcc07a")])
    weights = rng.dirichlet(np.array([3.0, 2.0, 1.5, 1.2, 0.4]), stalks)
    stalk_color = (weights @ palette) * rng.uniform(0.9, 1.07, (stalks, 1))
    along = np.stack([periodic_noise(1, width, seed + 10 + k, exponent=2.5, shortest=16.0)[0] for k in range(stalks)])
    color = stalk_color[index] * (1.0 + 0.09 * along[index, np.arange(width)[None, :]])[..., None]

    streak = periodic_noise(height, width, seed + 1, exponent=1.6, stretch=(40.0, 1.0), shortest=2.0)
    blotch = periodic_noise(height, width, seed + 2, exponent=3.0, shortest=24.0)
    color *= (1.0 + 0.05 * streak + 0.05 * blotch + 0.2 * shine)[..., None]

    # Halmknoten: schmale dunkle Ringe in unregelmäßigen Abständen je Halm (Profil je Halm entlang u)
    node_profiles = np.zeros((stalks, width))
    for k in range(stalks):
        count = int(rng.integers(4, 7))
        positions = (np.arange(count) + rng.uniform(-0.3, 0.3, count) + rng.uniform()) / count
        distance = np.min([_periodic_distance(u[0], position) for position in positions], axis=0)
        node_profiles[k] = np.exp(-((distance / 0.003) ** 2))
    nodes = node_profiles[index, np.arange(width)[None, :]]
    color *= (1.0 - 0.25 * nodes)[..., None]

    # Bindungen: zwei verdrehte Stränge je Bindung, schräg über den Wulst
    bindings = np.zeros((height, width))
    strand_shape = np.zeros((height, width))
    pinch = np.zeros((height, width))
    for j in range(3):
        middle = (j + 0.5 + rng.uniform(-0.1, 0.1)) / 3.0
        center = middle + 0.05 * (v - 0.5)
        for strand in (-1.0, 1.0):
            offset = strand * (0.011 + 0.002 * np.sin(2.0 * np.pi * (5.0 * v + j)))
            distance = _periodic_distance(u, center + offset) * 2.0  # Meter (Kachel = 2 m)
            half = 0.0095
            band = 1.0 - smoothstep(0.75 * half, half, distance)
            bindings = np.maximum(bindings, band)
            strand_shape = np.maximum(strand_shape, np.sqrt(np.clip(1.0 - (distance / half) ** 2, 0.0, 1.0)) * band)
        pinch = np.maximum(pinch, np.exp(-((_periodic_distance(u, center) * 2.0 / 0.06) ** 2)))
    cane_fiber = periodic_noise(height, width, seed + 3, exponent=1.4, stretch=(1.0, 14.0), shortest=2.0)
    cane = (
        _hex("#b8874c")[None, None, :] * (1.0 + 0.12 * cane_fiber[..., None]) * (0.75 + 0.35 * strand_shape[..., None])
    )
    color = color * (1.0 - 0.3 * pinch * (1.0 - bindings))[..., None]
    color = color * (1.0 - bindings[..., None]) + cane * bindings[..., None]

    groove = smoothstep(0.0, 0.13, v) * smoothstep(0.0, 0.13, 1.0 - v)
    stalk_shade = 0.8 + 0.2 * profile
    color *= (
        (0.68 + 0.32 * groove) * np.where(bindings > 0.5, 1.0, stalk_shade) * (1.0 - 0.3 * gap * (1.0 - bindings))
    )[..., None]

    straw_height = (0.6 * profile - 0.2 * gap) * (1.0 - 0.35 * pinch) + 0.04 * streak + 0.1 * nodes
    relief = straw_height * (1.0 - bindings) + (0.55 + 0.45 * strand_shape + 0.04 * cane_fiber) * bindings
    normal = height_to_normal(relief * 16.0, 1.0)
    occlusion = (0.42 + 0.58 * groove) * (1.0 - 0.3 * gap * (1.0 - bindings)) * (1.0 - 0.25 * pinch * (1.0 - bindings))
    roughness = np.where(bindings > 0.5, 0.44 + 0.05 * cane_fiber, 0.62 - 0.18 * shine + 0.05 * streak) + 0.2 * (
        1.0 - groove
    )
    return TextureSet(
        _encode_color(color), _orm(np.clip(occlusion, 0.0, 1.0), np.clip(roughness, 0.05, 1.0)), encode_normal(normal)
    )


def wax_textures(size: int, seed: int) -> TextureSet:
    """Bienenwachs: helles Goldgelb, weiche Wolken, feine Sprenkel, leichte Fließspuren; seidiger Glanz."""
    blotch = periodic_noise(size, size, seed, exponent=3.2, shortest=48.0)
    speckle = periodic_noise(size, size, seed + 1, exponent=1.0, shortest=2.0, longest=24.0)
    flow = periodic_noise(size, size, seed + 2, exponent=2.2, stretch=(1.0, 7.0), shortest=4.0)
    base = _hex("#f3d47c")
    color = base[None, None, :] * (1.0 + 0.07 * blotch + 0.025 * speckle + 0.035 * flow)[..., None]
    color = color * np.array([1.0, 0.985, 0.95])[None, None, :] ** (np.clip(blotch, 0.0, None)[..., None])
    bumps = periodic_noise(size, size, seed + 3, exponent=3.0, shortest=10.0)
    normal = height_to_normal(bumps * 0.7 + flow * 0.35, 1.0)
    roughness = 0.42 + 0.05 * blotch + 0.02 * speckle
    occlusion = 1.0 - 0.06 * np.clip(-bumps, 0.0, None)
    return TextureSet(
        _encode_color(color), _orm(np.clip(occlusion, 0.0, 1.0), np.clip(roughness, 0.05, 1.0)), encode_normal(normal)
    )


def wood_textures(width: int, height: int, seed: int) -> TextureSet:
    """Altes Holz: Jahresringe quer (v), Fasern längs (u), zwei Äste je Kachel, leicht verwittert."""
    rng = np.random.default_rng(seed)
    u = ((np.arange(width) + 0.5) / width)[None, :]
    v = ((np.arange(height) + 0.5) / height)[:, None]
    warp = periodic_noise(height, width, seed, exponent=3.4, stretch=(6.0, 1.0), shortest=16.0)
    fiber = periodic_noise(height, width, seed + 1, exponent=1.3, stretch=(28.0, 1.0), shortest=2.0)
    rings = v * 14.0 + 0.55 * warp
    for _ in range(2):
        cu, cv = rng.uniform(0.0, 1.0, 2)
        du = _periodic_distance(u, cu) * width / height
        dv = _periodic_distance(v, cv)
        distance = np.sqrt((du * 0.45) ** 2 + dv**2)
        knot = np.exp(-((distance / 0.05) ** 2))
        rings = rings + 2.2 * np.exp(-((distance / 0.11) ** 2)) * np.sign(v - cv + 1e-9) * 0.3 + 3.0 * knot
    phase = rings % 1.0
    late = smoothstep(0.62, 0.86, phase) * (1.0 - smoothstep(0.9, 1.0, phase))
    base, dark, light = _hex("#8d5d35"), _hex("#5c3a20"), _hex("#a9794b")
    color = base[None, None, :] * (1.0 - late[..., None]) + dark[None, None, :] * late[..., None]
    color = color + (light - base)[None, None, :] * np.clip(0.5 * warp, 0.0, 1.0)[..., None]
    color *= (1.0 + 0.1 * fiber)[..., None]
    grey = np.array([0.24, 0.22, 0.2])
    weather = np.clip(0.25 + 0.2 * periodic_noise(height, width, seed + 2, exponent=3.0, shortest=32.0), 0.0, 0.5)
    color = color * (1.0 - weather[..., None]) + grey[None, None, :] * weather[..., None] * 0.9
    relief = -0.6 * late + 0.25 * fiber
    normal = height_to_normal(relief * 4.0, 1.0)
    roughness = 0.72 + 0.06 * fiber + 0.06 * late
    occlusion = 1.0 - 0.18 * late
    return TextureSet(_encode_color(color), _orm(occlusion, np.clip(roughness, 0.05, 1.0)), encode_normal(normal))


def honey_textures(size: int, seed: int) -> TextureSet:
    """Honig: Bernstein mit Schlieren und hellen Bläschen, zur Bildmitte hin heller.

    Honigflächen legen ihre UVs mittig auf die Kachel (Zellspiegel, Becken, Laternenkörper); das
    radiale Glühen ist symmetrisch und deshalb auch über u = 0/1 nahtlos.
    """
    swirl = periodic_noise(size, size, seed, exponent=3.0, shortest=8.0)
    fine = periodic_noise(size, size, seed + 1, exponent=1.5, shortest=2.0, longest=16.0)
    rng = np.random.default_rng(seed)
    yy, xx = (np.mgrid[0:size, 0:size] + 0.5) / size
    radial = 2.0 * np.hypot(xx - 0.5, yy - 0.5)
    center = 1.0 - smoothstep(0.15, 1.05, radial)
    bubbles = np.zeros((size, size))
    for cx, cy, radius in zip(rng.uniform(0, 1, 24), rng.uniform(0, 1, 24), rng.uniform(0.004, 0.012, 24), strict=True):
        distance = np.hypot(_periodic_distance(xx, cx), _periodic_distance(yy, cy))
        bubbles = np.maximum(bubbles, 1.0 - smoothstep(0.6 * radius, radius, distance))
    mix = np.clip(0.35 + 0.45 * center + 0.25 * swirl, 0.0, 1.0)[..., None]
    color = _hex("#eba322")[None, None, :] * mix + _hex("#a8560b")[None, None, :] * (1.0 - mix)
    color = color * (1.0 + 0.05 * fine)[..., None] + 0.15 * bubbles[..., None]
    glow_mix = np.clip(0.25 + 0.6 * center + 0.2 * swirl + 0.05 * fine, 0.0, 1.0)[..., None]
    glow = _hex("#ffcf5c")[None, None, :] * glow_mix + _hex("#d97f16")[None, None, :] * (1.0 - glow_mix)
    glow = glow * (0.55 + 0.45 * center)[..., None] + 0.25 * bubbles[..., None]
    # Etwas matter als reiner Honig: flache Becken spiegeln sonst unter streifendem Blick die helle Umgebung grau
    roughness = 0.3 + 0.05 * fine
    return TextureSet(
        _encode_color(color), _orm(np.ones((size, size)), np.clip(roughness, 0.03, 1.0)), None, _encode_color(glow)
    )


def cloth_textures(size: int, seed: int) -> TextureSet:
    """Leinen: feine Leinwandbindung in hellem Naturweiß; die Wimpelfarben kommen aus der Tönung je Eckpunkt."""
    yy, xx = np.mgrid[0:size, 0:size] / size
    weave = np.sin(2.0 * np.pi * 24.0 * xx) * np.sin(2.0 * np.pi * 24.0 * yy)
    noise = periodic_noise(size, size, seed, exponent=2.0, shortest=2.0)
    color = _hex("#fbf8f1")[None, None, :] * (1.0 + 0.03 * weave + 0.02 * noise)[..., None]
    roughness = 0.86 + 0.04 * noise
    return TextureSet(_encode_color(color), _orm(1.0 - 0.06 * np.clip(-weave, 0.0, None), roughness))
