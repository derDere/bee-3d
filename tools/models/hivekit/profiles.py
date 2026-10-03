"""Meridiankurven für Rotationskörper: glatte Kurve durch Stützpunkte, Bogenlänge, Normalen (Profilkurve)."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from modelkit.sweep import catmull_rom

type FloatArray = npt.NDArray[np.float64]

_RESAMPLE_STEP = 0.01  # m; Abstand der gleichmäßig über die Bogenlänge verteilten Kurvenpunkte


@dataclass(frozen=True, slots=True)
class ProfileCurve:
    """Meridiankurve als Polylinie (Radius, Höhe), gleichmäßig über die Bogenlänge abgetastet (Profilkurve).

    Die Kurve läuft vom Rand aufwärts zur Achse; ihre Außennormale entsteht durch Drehung der
    Tangente im Uhrzeigersinn (senkrechte Wand: Tangente (0, 1) → Normale (1, 0)).
    """

    points: FloatArray
    arc: FloatArray

    @staticmethod
    def through(control: Sequence[tuple[float, float]]) -> ProfileCurve:
        """Zentripetaler Catmull-Rom-Spline durch die Stützpunkte, nach Bogenlänge neu abgetastet."""
        nodes = np.asarray(control, dtype=np.float64)
        dense = catmull_rom(np.concatenate([nodes, np.zeros((len(nodes), 1))], axis=1), 48)[:, :2]
        arc = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(dense, axis=0), axis=1))])
        samples = np.linspace(0.0, arc[-1], max(2, int(np.ceil(arc[-1] / _RESAMPLE_STEP)) + 1))
        points = np.stack([np.interp(samples, arc, dense[:, i]) for i in range(2)], axis=1)
        return ProfileCurve(points, samples)

    @property
    def length(self) -> float:
        """Gesamte Bogenlänge in Metern."""
        return float(self.arc[-1])

    def at(self, s: FloatArray | float) -> FloatArray:
        """Punkte (N, 2) bei den Bogenlängen ``s`` (außerhalb geklemmt)."""
        positions = np.atleast_1d(np.asarray(s, dtype=np.float64))
        return np.stack([np.interp(positions, self.arc, self.points[:, i]) for i in range(2)], axis=1)

    def tangent(self, s: FloatArray | float) -> FloatArray:
        """Einheitstangenten (N, 2) in Laufrichtung."""
        positions = np.atleast_1d(np.asarray(s, dtype=np.float64))
        step = 2.0 * _RESAMPLE_STEP
        delta = self.at(np.minimum(positions + step, self.length)) - self.at(np.maximum(positions - step, 0.0))
        return delta / np.maximum(np.linalg.norm(delta, axis=1, keepdims=True), 1e-12)

    def normal(self, s: FloatArray | float) -> FloatArray:
        """Außennormalen (N, 2): Tangente im Uhrzeigersinn gedreht."""
        tangent = self.tangent(s)
        return np.stack([tangent[:, 1], -tangent[:, 0]], axis=1)

    def offset(self, distance: float) -> ProfileCurve:
        """Parallelkurve im Abstand ``distance`` entlang der Außennormale (negativ: nach innen)."""
        points = self.points + distance * self.normal(self.arc)
        arc = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(points, axis=0), axis=1))])
        return ProfileCurve(points, arc)

    def radius_at_height(self, y: FloatArray | float) -> FloatArray:
        """Radius bei Höhe ``y`` auf dem in y steigenden Kurvenabschnitt (Wand)."""
        heights = self.points[:, 1]
        rising = np.concatenate([[True], np.diff(heights) > 0.0])
        end = int(np.argmin(rising)) if not rising.all() else len(heights)
        return np.interp(np.asarray(y, dtype=np.float64), heights[:end], self.points[:end, 0])

    def height_at_radius(self, radius: FloatArray | float) -> FloatArray:
        """Höhe beim Radius ``radius`` auf dem Abschnitt hinter der weitesten Stelle (Kuppel zur Achse hin)."""
        widest = int(np.argmax(self.points[:, 0]))
        dome = self.points[widest:][::-1]
        return np.interp(np.asarray(radius, dtype=np.float64), dome[:, 0], dome[:, 1])

    def arc_at_height(self, y: FloatArray | float) -> FloatArray:
        """Bogenlänge bei Höhe ``y`` auf dem in y steigenden Kurvenabschnitt."""
        heights = self.points[:, 1]
        rising = np.concatenate([[True], np.diff(heights) > 0.0])
        end = int(np.argmin(rising)) if not rising.all() else len(heights)
        return np.interp(np.asarray(y, dtype=np.float64), heights[:end], self.arc[:end])
