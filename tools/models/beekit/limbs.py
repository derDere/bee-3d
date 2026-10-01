"""Glieder der Biene: Beine mit Krallen, Fühler mit Kugeln, Stachel (Glieder).

Beine und Fühler sind eigene, bewegliche Teile mit Pivot im Gelenk (Hüfte bzw. Fühleransatz). Sie
werden an der Körperhülle beschnitten: In Ruhehaltung endet jedes Glied genau auf der Haut, nichts
durchdringt den Körper. Der Stachel gehört zur Hülle.
"""

from __future__ import annotations

from dataclasses import dataclass

import manifold3d as m3d
import numpy as np
import numpy.typing as npt
from modelkit.geometry import ShadedMesh, TriangleMesh, shade_with_creases, to_manifold, union_all
from modelkit.sdf import TubeChain
from modelkit.sweep import catmull_rom, sweep_tube

from beekit.anatomy import PX, Antenna, Leg, Tube

type FloatArray = npt.NDArray[np.float64]


def _normalized(vectors: FloatArray) -> FloatArray:
    return vectors / np.maximum(np.linalg.norm(vectors, axis=-1, keepdims=True), 1e-12)


def _arc_lengths(path: FloatArray) -> FloatArray:
    return np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))])


def _resample(path: FloatArray, stations: FloatArray) -> FloatArray:
    """Punkte der dichten Kurve ``path`` an den Bogenlängen ``stations``."""
    arc = _arc_lengths(path)
    return np.stack([np.interp(stations, arc, path[:, axis]) for axis in range(3)], axis=1)


def _rounded_end(path: FloatArray, radii: FloatArray, steps: int = 4) -> tuple[FloatArray, FloatArray]:
    """Hängt eine halbkugelige Kappe an das Ende einer Röhre (Zehe)."""
    tangent = _normalized(path[-1] - path[-2])
    angles = np.linspace(0.0, 0.5 * np.pi, steps + 1)[1:]
    cap = path[-1] + tangent * (radii[-1] * np.sin(angles))[:, None]
    return np.concatenate([path, cap]), np.concatenate([radii, radii[-1] * np.cos(angles)])


def tube_solid(path: FloatArray, radii: FloatArray, sides: int) -> m3d.Manifold:
    """Geschlossene Röhre: nach hinten gewandter Fächer am Ansatz, Spitze am Ende."""
    tube = sweep_tube(path, radii, sides)
    first_ring = np.arange(sides)
    cap_center = len(tube.vertices)
    cap = np.stack([np.full(sides, cap_center), (first_ring + 1) % sides, first_ring], axis=1)
    # Die doppelte Nahtspalte der Röhre verschmilzt to_manifold mit der ersten Spalte
    vertices = np.concatenate([tube.vertices, path[:1]])
    return to_manifold(TriangleMesh(vertices, np.concatenate([tube.faces, cap])))


@dataclass(frozen=True, slots=True)
class LimbPart:
    """Bewegliches Glied: Netze je Material im Rahmen seines Gelenks (Gliedteil)."""

    name: str
    pivot: FloatArray
    pieces: dict[str, ShadedMesh]

    def solids_in_model(self) -> list[TriangleMesh]:
        """Netze im Modellrahmen (Ruhehaltung) — als Verdecker für die gebackene AO."""
        return [TriangleMesh(mesh.vertices + self.pivot, mesh.faces) for mesh in self.pieces.values()]


def _trimmed(solid: m3d.Manifold, body: m3d.Manifold, pivot: FloatArray) -> ShadedMesh:
    """Schneidet ein Glied an der Körperhülle ab und legt es in den Rahmen seines Gelenks."""
    mesh = shade_with_creases(solid - body, sharp_angle_degrees=55.0)
    return ShadedMesh(mesh.vertices - pivot, mesh.normals, mesh.faces)


def leg_part(leg: Leg, body: m3d.Manifold, sides: int = 6) -> LimbPart:
    """Bein mit kräftigem Schenkel, Kniegelenk, keuliger Schiene, drei Fußgliedern und zwei Krallen; Pivot in der Hüfte."""
    dense = catmull_rom(leg.joints, 40)
    arc = _arc_lengths(dense)
    knee, ankle, toe = arc[40], arc[80], arc[120]
    stations = np.concatenate(
        [np.linspace(0.0, knee, 8, endpoint=False), np.linspace(knee, ankle, 9, endpoint=False), np.linspace(ankle, toe, 13)]
    )
    femur = np.clip(stations / knee, 0.0, 1.0)
    tibia = np.clip((stations - knee) / (ankle - knee), 0.0, 1.0)
    tarsus = np.clip((stations - ankle) / (toe - ankle), 0.0, 1.0)
    radii = np.where(
        stations < knee,
        leg.femur_radius * (1.0 - 0.18 * femur),
        np.where(
            stations < ankle,
            leg.tibia_radius * (0.86 + 0.30 * tibia**1.6),
            leg.tarsus_radius * (0.80 + 0.28 * np.abs(np.sin(np.pi * 3.0 * tarsus)) ** 0.6),
        ),
    )
    radii += leg.femur_radius * 0.12 * np.exp(-(((stations - knee) / (0.9 * leg.femur_radius)) ** 2))
    blend = np.clip((stations - ankle) / (1.6 * leg.tarsus_radius), 0.0, 1.0)
    radii = np.where(stations >= ankle, radii * blend + leg.tibia_radius * 1.1 * (1.0 - blend), radii)
    path, radii = _rounded_end(_resample(dense, stations), radii)
    solids = [tube_solid(path, radii, sides)]
    # Zwei gebogene Krallen an der Zehe, leicht gespreizt und nach unten eingerollt
    toe_point, tangent = leg.joints[3], _normalized(dense[-1] - dense[-6])
    side = _normalized(np.cross(tangent, [0.0, 1.0, 0.0]))
    for spread in (-1.0, 1.0):
        base = toe_point + side * spread * 0.45 * PX - tangent * 0.4 * PX
        heading = _normalized(tangent + side * spread * 0.45)
        points = np.stack(
            [
                base,
                base + heading * 1.4 * PX,
                base + heading * 2.4 * PX + np.array([0.0, -0.9, 0.0]) * PX,
                base + heading * 2.7 * PX + np.array([0.0, -2.0, 0.0]) * PX,
            ]
        )
        claw = catmull_rom(points, 2)
        solids.append(tube_solid(claw, np.linspace(0.42, 0.06, len(claw)) * PX, 4))
    pivot = leg.joints[0]
    return LimbPart(leg.name, pivot, {"Bee_Leg": _trimmed(union_all(solids), body, pivot)})


def antenna_part(antenna: Antenna, body: m3d.Manifold, sides: int = 6) -> LimbPart:
    """Fühler: glatter Schaft, Gelenkwulst am Knick, gegliederte Geißel und Kugel; Pivot am Ansatz."""
    dense = catmull_rom(antenna.path, 30)
    arc = _arc_lengths(dense)
    elbow, end = arc[antenna.elbow * 30], arc[-1]
    rings = antenna.flagellum_rings
    stations = np.concatenate([np.linspace(0.0, elbow, 7, endpoint=False), np.linspace(elbow, end, 3 * rings + 1)])
    flagellum = np.clip((stations - elbow) / (end - elbow), 0.0, 1.0)
    radii = np.where(
        stations < elbow,
        antenna.radius * (1.06 - 0.08 * stations / elbow),
        antenna.radius * (0.86 + 0.14 * np.abs(np.cos(np.pi * rings * flagellum)) ** 0.5) * (1.0 - 0.12 * flagellum),
    )
    radii += antenna.radius * 0.18 * np.exp(-(((stations - elbow) / (1.2 * antenna.radius)) ** 2))
    pivot = antenna.path[0]
    tip = m3d.Manifold.sphere(antenna.tip_radius, 22).translate(tuple(antenna.tip))
    stalk = tube_solid(_resample(dense, stations), radii, sides) - tip
    return LimbPart(
        antenna.name,
        pivot,
        {"Bee_Chitin": _trimmed(stalk, body, pivot), "Bee_AntennaTip": _trimmed(tip, body, pivot)},
    )


def stinger_solid(stinger: Tube, sides: int = 10) -> m3d.Manifold:
    """Stachel: schlanker, leicht nach unten gebogener Kegel mit feiner Spitze (Teil der Körperhülle)."""
    dense = catmull_rom(stinger.points, 30)
    arc = _arc_lengths(dense)
    stations = np.linspace(0.0, arc[-1], 18)
    knots = _arc_lengths(stinger.points)
    radii = np.interp(stations / arc[-1] * knots[-1], knots, stinger.radii)
    radii[-1] = 0.0
    return tube_solid(_resample(dense, stations), radii, sides)


def stinger_distance(stinger: Tube, points: FloatArray) -> FloatArray:
    """Näherungsabstand zum Stachel (Kette verjüngter Kapseln) für die Bemalung."""
    return TubeChain(stinger.points, stinger.radii).distance(points)
