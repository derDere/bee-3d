"""Rotationen und Quaternionen in glTF-Konvention (x, y, z, w), rechtshändig, +Y oben, +Z vorne."""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
import numpy.typing as npt

type FloatArray = npt.NDArray[np.float64]


def rotation_matrix(axis: Sequence[float], angle_degrees: float) -> FloatArray:
    """Rotationsmatrix (lokal → Welt) um eine Achse nach Rodrigues."""
    a = np.asarray(axis, dtype=np.float64)
    a /= np.linalg.norm(a)
    angle = np.radians(angle_degrees)
    cross = np.array([[0.0, -a[2], a[1]], [a[2], 0.0, -a[0]], [-a[1], a[0], 0.0]])
    return np.eye(3) + np.sin(angle) * cross + (1.0 - np.cos(angle)) * cross @ cross


def axis_angle_quaternions(axis: Sequence[float], angles_degrees: FloatArray) -> FloatArray:
    """Quaternionen (K, 4) im glTF-Format xyzw für eine Folge von Winkeln um eine Achse."""
    a = np.asarray(axis, dtype=np.float64)
    a /= np.linalg.norm(a)
    half = np.radians(np.asarray(angles_degrees, dtype=np.float64)) * 0.5
    return np.concatenate([np.sin(half)[:, None] * a[None, :], np.cos(half)[:, None]], axis=1)
