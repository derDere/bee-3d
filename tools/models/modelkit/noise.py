"""Seedbares Rauschen für Formen und Texturen, parallel kompiliert mit numba (Rauschen).

Alle Felder arbeiten auf Punktmengen ``(N, 3)`` in Metern und liefern ``(N,)``. Das
Gradientenrauschen folgt Ken Perlins „Improved Noise" (2002), das Zellrauschen Steven Worley
(1996). Die Kernel laufen parallel über alle Kerne; ``cache=True`` legt den Maschinencode in
``__pycache__`` ab, sodass nur der erste Lauf kompiliert.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

import numpy as np
import numpy.typing as npt
from numba import njit, prange

type FloatArray = npt.NDArray[np.float64]
type NoiseFunction = Callable[[FloatArray], FloatArray]


@njit(cache=True, inline="always")
def _gradient(hashed: int, x: float, y: float, z: float) -> float:
    h = hashed & 15
    u = x if h < 8 else y
    v = y if h < 4 else (x if h in (12, 14) else z)
    return (u if (h & 1) == 0 else -u) + (v if (h & 2) == 0 else -v)


@njit(cache=True, inline="always")
def _lerp(t: float, a: float, b: float) -> float:
    return a + t * (b - a)


@njit(cache=True, fastmath=True)
def _perlin(x: float, y: float, z: float, perm: npt.NDArray[np.int32]) -> float:
    fx, fy, fz = np.floor(x), np.floor(y), np.floor(z)
    cx, cy, cz = int(fx) & 255, int(fy) & 255, int(fz) & 255
    x -= fx
    y -= fy
    z -= fz
    u = x * x * x * (x * (x * 6.0 - 15.0) + 10.0)
    v = y * y * y * (y * (y * 6.0 - 15.0) + 10.0)
    w = z * z * z * (z * (z * 6.0 - 15.0) + 10.0)
    a = perm[cx] + cy
    aa = perm[a] + cz
    ab = perm[a + 1] + cz
    b = perm[cx + 1] + cy
    ba = perm[b] + cz
    bb = perm[b + 1] + cz
    return _lerp(
        w,
        _lerp(
            v,
            _lerp(u, _gradient(perm[aa], x, y, z), _gradient(perm[ba], x - 1, y, z)),
            _lerp(u, _gradient(perm[ab], x, y - 1, z), _gradient(perm[bb], x - 1, y - 1, z)),
        ),
        _lerp(
            v,
            _lerp(u, _gradient(perm[aa + 1], x, y, z - 1), _gradient(perm[ba + 1], x - 1, y, z - 1)),
            _lerp(u, _gradient(perm[ab + 1], x, y - 1, z - 1), _gradient(perm[bb + 1], x - 1, y - 1, z - 1)),
        ),
    )


@njit(parallel=True, cache=True, fastmath=True)
def _fractal_kernel(
    points: FloatArray,
    perm: npt.NDArray[np.int32],
    rotations: FloatArray,
    shifts: FloatArray,
    active: int,
    frequency: float,
    lacunarity: float,
    gain: float,
    ridged: bool,
    norm: float,
) -> FloatArray:
    result = np.empty(points.shape[0])
    for i in prange(points.shape[0]):
        total = 0.0
        amplitude = 1.0
        scale = frequency
        for octave in range(active):
            sx = points[i, 0] * scale
            sy = points[i, 1] * scale
            sz = points[i, 2] * scale
            r = rotations[octave]
            value = _perlin(
                sx * r[0, 0] + sy * r[1, 0] + sz * r[2, 0] + shifts[octave, 0],
                sx * r[0, 1] + sy * r[1, 1] + sz * r[2, 1] + shifts[octave, 1],
                sx * r[0, 2] + sy * r[1, 2] + sz * r[2, 2] + shifts[octave, 2],
                perm,
            )
            if ridged:
                value = (1.0 - abs(value)) ** 2
            total += amplitude * value
            amplitude *= gain
            scale *= lacunarity
        result[i] = total / norm
    return result


@njit(parallel=True, cache=True, fastmath=True)
def _cellular_kernel(
    points: FloatArray, offsets: FloatArray, perm: npt.NDArray[np.int32], frequency: float
) -> FloatArray:
    result = np.empty((points.shape[0], 4))
    for i in prange(points.shape[0]):
        px = points[i, 0] * frequency
        py = points[i, 1] * frequency
        pz = points[i, 2] * frequency
        cx, cy, cz = np.floor(px), np.floor(py), np.floor(pz)
        first = 1e9
        second = 1e9
        nearest = 0
        runner_up = 0
        for dx in range(-1, 2):
            for dy in range(-1, 2):
                for dz in range(-1, 2):
                    x = (int(cx) + dx) & 4095
                    y = (int(cy) + dy) & 4095
                    z = (int(cz) + dz) & 4095
                    feature = perm[perm[perm[x] + y] + z]
                    ex = cx + dx + offsets[feature, 0] - px
                    ey = cy + dy + offsets[feature, 1] - py
                    ez = cz + dz + offsets[feature, 2] - pz
                    distance = np.sqrt(ex * ex + ey * ey + ez * ez)
                    if distance < first:
                        second = first
                        runner_up = nearest
                        first = distance
                        nearest = feature
                    elif distance < second:
                        second = distance
                        runner_up = feature
        result[i, 0] = first
        result[i, 1] = second
        result[i, 2] = offsets[nearest, 3]
        result[i, 3] = offsets[runner_up, 3]
    return result


def hash01(values: FloatArray) -> FloatArray:
    """Pseudozufall 0..1 je Wert, gleich für gleiche Eingabe (z. B. je Gesteinsschicht oder Index)."""
    return np.modf(np.abs(np.sin(np.asarray(values, dtype=np.float64) * 12.9898 + 78.233) * 43758.5453))[0]


def _random_rotation(rng: np.random.Generator) -> FloatArray:
    """Zufällige Drehmatrix (gleichverteilt), damit Oktaven keine gemeinsamen Gitterachsen haben."""
    q, r = np.linalg.qr(rng.normal(size=(3, 3)))
    q *= np.sign(np.diag(r))
    return q if np.linalg.det(q) > 0 else -q


def _points(points: FloatArray) -> FloatArray:
    return np.ascontiguousarray(points, dtype=np.float64)


@dataclass(frozen=True, slots=True)
class Fractal:
    """Fraktale Summe von Gradientenrauschen (fBm) mit Grundfrequenz in 1/m (Fraktalrauschen).

    Jede Oktave ist gedreht und verschoben, damit keine Gitterartefakte entstehen.
    ``ridged`` faltet jede Oktave zu Graten (1 − |n|)², wie bei Felsrippen und Kämmen.
    Wertebereich: fBm etwa [-1, 1] (Standardabweichung ~0,2), ridged [0, 1].

    ``min_wavelength`` beim Aufruf lässt Oktaven mit kürzerer Wellenlänge weg; die Normierung
    bleibt gleich. Das grobe Feld ist dadurch exakt der Anfang des feinen — Netz und Normal-Map
    beschreiben dieselbe Fläche.
    """

    seed: int
    frequency: float
    octaves: int = 5
    lacunarity: float = 2.03
    gain: float = 0.5
    ridged: bool = False
    _perm: npt.NDArray[np.int32] = field(init=False, repr=False)
    _rotations: FloatArray = field(init=False, repr=False)
    _shifts: FloatArray = field(init=False, repr=False)

    def __post_init__(self) -> None:
        rng = np.random.default_rng(self.seed)
        permutation = rng.permutation(256).astype(np.int32)
        rotations, shifts = [], []
        for _ in range(self.octaves):
            rotations.append(_random_rotation(rng))
            shifts.append(rng.uniform(-100.0, 100.0, 3))
        object.__setattr__(self, "_perm", np.concatenate([permutation, permutation]))
        object.__setattr__(self, "_rotations", np.stack(rotations))
        object.__setattr__(self, "_shifts", np.stack(shifts))

    def active_octaves(self, min_wavelength: float) -> int:
        """Anzahl der Oktaven mit Wellenlänge ≥ ``min_wavelength`` (mindestens eine)."""
        if min_wavelength <= 0.0:
            return self.octaves
        wavelengths = 1.0 / (self.frequency * self.lacunarity ** np.arange(self.octaves))
        return max(1, int(np.count_nonzero(wavelengths >= min_wavelength)))

    def __call__(self, points: FloatArray, min_wavelength: float = 0.0) -> FloatArray:
        norm = float(np.sum(self.gain ** np.arange(self.octaves)))
        return _fractal_kernel(
            _points(points),
            self._perm,
            self._rotations,
            self._shifts,
            self.active_octaves(min_wavelength),
            self.frequency,
            self.lacunarity,
            self.gain,
            self.ridged,
            norm,
        )


@dataclass(frozen=True, slots=True)
class Cellular:
    """Zellrauschen: Abstände F1, F2 zum nächsten und zweitnächsten Merkmalspunkt (Worley-Rauschen).

    ``frequency`` in Zellen je Meter; ``jitter`` (0..1) streut die Merkmalspunkte in der Zelle.
    F2 − F1 ist null auf den Zellgrenzen — Grundlage für Risse, Platten und Kiesel. Jede Zelle
    trägt zusätzlich einen Zufallswert 0..1 (z. B. für versetzte Felsblöcke).
    """

    seed: int
    frequency: float
    jitter: float = 0.9
    _offsets: FloatArray = field(init=False, repr=False)
    _perm: npt.NDArray[np.int32] = field(init=False, repr=False)

    def __post_init__(self) -> None:
        rng = np.random.default_rng(self.seed)
        features = 0.5 + (rng.random((4096, 3)) - 0.5) * self.jitter
        object.__setattr__(self, "_offsets", np.concatenate([features, rng.random((4096, 1))], axis=1))
        object.__setattr__(self, "_perm", np.concatenate([rng.permutation(4096)] * 2).astype(np.int32))

    def evaluate(self, points: FloatArray) -> CellularSample:
        """Wertet Abstände und Zellwerte der beiden nächsten Zellen aus."""
        result = _cellular_kernel(_points(points), self._offsets, self._perm, self.frequency)
        return CellularSample(result[:, 0], result[:, 1], result[:, 2], result[:, 3])


@dataclass(frozen=True, slots=True)
class CellularSample:
    """Ergebnis des Zellrauschens (Zellprobe): Abstände F1, F2 und Zufallswerte beider Zellen."""

    first: FloatArray
    second: FloatArray
    value: FloatArray
    second_value: FloatArray

    @property
    def edge(self) -> FloatArray:
        """F2 − F1: null auf der Zellgrenze, wächst zur Zellmitte."""
        return self.second - self.first

    def blended_value(self, width: float) -> FloatArray:
        """Zellwert mit stetigem Übergang der Breite ``width`` (Zellen-Einheiten) an der Grenze.

        Auf der Grenze treffen sich beide Seiten beim Mittelwert — Stufen zwischen Zellen
        bleiben scharf, das Feld bleibt stetig.
        """
        blend = 0.5 * (1.0 - np.clip(self.edge / width, 0.0, 1.0))
        return self.value + (self.second_value - self.value) * blend


@dataclass(frozen=True, slots=True)
class DomainWarp:
    """Verzerrt die Eingabepunkte mit einem Vektorfeld aus drei Fraktalfeldern (Domänenverzerrung).

    ``amplitude`` in Metern; das verzerrte Feld wirkt geflossen und geknetet.
    """

    field: NoiseFunction
    warp: Fractal
    amplitude: float

    def displacement(self, points: FloatArray, min_wavelength: float = 0.0) -> FloatArray:
        """Verschiebungsvektoren (N, 3) in Metern."""
        offsets = np.array([[0.0, 0.0, 0.0], [31.7, -12.3, 7.1], [-5.9, 44.2, -23.8]])
        return self.amplitude * np.stack(
            [self.warp(points + offset, min_wavelength) for offset in offsets], axis=1
        )

    def __call__(self, points: FloatArray) -> FloatArray:
        return self.field(points + self.displacement(points))
