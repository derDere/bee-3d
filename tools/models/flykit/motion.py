"""Leerlauf-Animation der Fliege: Beine und Rüssel zucken leicht (Bewegung).

Jedes Bein zuckt ein- bis zweimal je Schleife um eine waagrechte Achse durch die Hüfte —
schnelles Anziehen, kurzes Halten, langsameres Lösen. Der Rüssel pumpt zweimal leicht. Alle
Spuren beginnen und enden in der Ruhehaltung (nahtlose Schleife); der Spuckanker hängt am Rüssel
und zuckt mit.
"""

from __future__ import annotations

import numpy as np
import numpy.typing as npt
from modelkit.gltf_writer import RotationTrack
from modelkit.transforms import axis_angle_quaternions

from flykit.anatomy import FlyAnatomy, normalized

type FloatArray = npt.NDArray[np.float64]

IDLE_PERIOD = 1.6  # s
RISE, HOLD, RELEASE = 0.06, 0.04, 0.16  # s je Zuckung


def _twitch_track(node: str, axis: FloatArray, moments: list[tuple[float, float]], period: float) -> RotationTrack:
    """Spur aus Ruhehaltung und Zuckungen (Zeitpunkt, Winkel in Grad) um eine feste Achse."""
    times, angles = [0.0], [0.0]
    for start, angle in sorted(moments):
        times += [start, start + RISE, start + RISE + HOLD, start + RISE + HOLD + RELEASE]
        angles += [0.0, angle, 0.8 * angle, 0.0]
    times.append(period)
    angles.append(0.0)
    return RotationTrack(node, np.asarray(times), axis_angle_quaternions(axis, np.asarray(angles)))


def idle_tracks(anatomy: FlyAnatomy, rng: np.random.Generator, period: float = IDLE_PERIOD) -> list[RotationTrack]:
    """Zuckungen der sechs Beine (versetzt) und Pumpen des Rüssels."""
    latest = period - RISE - HOLD - RELEASE - 0.05
    tracks = []
    for leg in anatomy.legs:
        reach = leg.joints[-1] - leg.joints[0]
        lift = normalized(np.array([-reach[2], 0.0, reach[0]]))
        swing = np.array([1.0, 0.0, 0.0])
        axis = normalized(lift * rng.uniform(0.4, 1.0) + swing * rng.uniform(-0.6, 0.6))
        count = 1 + int(rng.random() < 0.45)
        starts = np.sort(rng.uniform(0.05, latest, count))
        if count == 2 and starts[1] - starts[0] < RISE + HOLD + RELEASE + 0.05:
            starts = starts[:1]
        moments = [(float(start), float(rng.uniform(3.0, 7.0)) * float(rng.choice([-1.0, 1.0]))) for start in starts]
        tracks.append(_twitch_track(leg.name, axis, moments, period))
    pumps = [(0.35, 6.0), (0.95, 4.5)]
    tracks.append(_twitch_track("Proboscis", np.array([1.0, 0.0, 0.0]), pumps, period))
    return tracks
