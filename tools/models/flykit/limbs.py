"""Glieder der Fliege: Beine mit Dornen, Krallen und Haftlappen, Fühler, Rüssel, Schwingkölbchen (Glieder).

Beine und Rüssel sind bewegliche Teile mit Pivot im Gelenk; sie werden an ihrem Elternkörper
beschnitten (Beine am Rumpf, Rüssel an der Kopfkapsel) und enden in Ruhehaltung auf der Haut.
Fühler gehören zur Kopfkapsel, Schwingkölbchen zum Rumpf.
"""

from __future__ import annotations

from dataclasses import dataclass

import manifold3d as m3d
import numpy as np
import numpy.typing as npt
from modelkit.geometry import ShadedMesh, ellipsoid_solid, shade_with_creases, union_all
from modelkit.sdf import Ellipsoid
from modelkit.sweep import catmull_rom, transport_frames

from flykit.anatomy import AntennaShape, HalterShape, LegShape, ProboscisShape, normalized
from flykit.tubes import arc_lengths, resample, rounded_end, spike_solid, tube_solid

type FloatArray = npt.NDArray[np.float64]

SAMPLES = 40  # Stützpunkte je Gliedabschnitt der dichten Kurve
CREASE_DEGREES = 55.0


@dataclass(frozen=True, slots=True)
class LimbPart:
    """Bewegliches Glied im Modellrahmen (Ruhehaltung) mit seinem Gelenk (Gliedteil)."""

    name: str
    pivot: FloatArray
    mesh: ShadedMesh


@dataclass(frozen=True, slots=True)
class LegAxis:
    """Mittellinie eines Beins: dichte Kurve, Bogenlängen und Bogenlänge der Gelenke (Beinachse).

    ``joints`` sind die Bogenlängen von Schenkelring, Knie, Fußgelenk und Zehe.
    """

    dense: FloatArray
    arc: FloatArray
    joints: FloatArray

    @classmethod
    def of(cls, leg: LegShape) -> LegAxis:
        """Achse eines Beins als Catmull-Rom-Kurve durch seine Gelenke."""
        dense = catmull_rom(leg.joints, SAMPLES)
        arc = arc_lengths(dense)
        return cls(dense, arc, arc[[SAMPLES, 2 * SAMPLES, 3 * SAMPLES, 4 * SAMPLES]])


def _leg_radii(leg: LegShape, stations: FloatArray, joints: FloatArray) -> FloatArray:
    """Radienprofil: kräftige Hüfte, keuliger Schenkel, zum Ende dickere Schiene, schlanker Fuß.

    Die fünf Fußglieder zeichnet die Bemalung (Gelenkringe); die Form bleibt glatt.
    """
    trochanter, knee, ankle, toe = joints
    coxa = np.clip(stations / trochanter, 0.0, 1.0)
    femur = np.clip((stations - trochanter) / (knee - trochanter), 0.0, 1.0)
    tibia = np.clip((stations - knee) / (ankle - knee), 0.0, 1.0)
    tarsus = np.clip((stations - ankle) / (toe - ankle), 0.0, 1.0)
    radii = np.select(
        [stations < trochanter, stations < knee, stations < ankle],
        [
            leg.coxa_radius * (1.0 - 0.18 * coxa),
            leg.femur_radius * (0.82 + 0.26 * np.sin(np.pi * femur) ** 0.8),
            leg.tibia_radius * (0.82 + 0.3 * tibia**1.5),
        ],
        leg.tarsus_radius * (1.0 - 0.2 * tarsus),
    )
    # Gelenkwülste an Knie und Fußgelenk
    radii += leg.femur_radius * 0.12 * np.exp(-(((stations - knee) / (0.8 * leg.femur_radius)) ** 2))
    radii += leg.tibia_radius * 0.1 * np.exp(-(((stations - ankle) / (0.8 * leg.tibia_radius)) ** 2))
    return radii


def _down_radial(tangent: FloatArray) -> FloatArray:
    """Richtung quer zum Glied, die am stärksten nach unten zeigt."""
    down = np.array([0.0, -1.0, 0.0]) + tangent * float(tangent[1])
    if np.linalg.norm(down) < 1e-6:
        down = np.cross(tangent, [1.0, 0.0, 0.0])
    return normalized(down)


def leg_part(leg: LegShape, body: m3d.Manifold, sides: int, spines: int, rng: np.random.Generator) -> LimbPart:
    """Bein mit Hüfte, Schenkel, Schiene, fünf Fußgliedern, Dornen, zwei Krallen und Haftlappen; Pivot in der Hüfte."""
    axis = LegAxis.of(leg)
    dense, arc, joints = axis.dense, axis.arc, axis.joints
    trochanter, knee, ankle, toe = joints
    stations = np.concatenate(
        [
            np.linspace(0.0, trochanter, 2, endpoint=False),
            np.linspace(trochanter, knee, 4, endpoint=False),
            np.linspace(knee, ankle, 4, endpoint=False),
            np.linspace(ankle, toe, 5),
        ]
    )
    radii = _leg_radii(leg, stations, joints)
    path, radii = rounded_end(resample(dense, stations), radii, steps=2)
    # Nur das Glied wird am Rumpf beschnitten; Dornen, Krallen und Haftlappen stecken als eigene
    # geschlossene Hüllen im Glied (spart die Schnittkanten der Booleans)
    shells = [tube_solid(path, radii, sides) - body]
    shells += _leg_spines(leg, dense, arc, joints, spines, rng)
    shells += _foot(leg, axis, pad_segments=4 if sides <= 6 else 6)
    meshes = [shade_with_creases(shell, sharp_angle_degrees=CREASE_DEGREES) for shell in shells]
    return LimbPart(leg.name, leg.pivot, concatenate_shaded(meshes))


def _leg_spines(leg: LegShape, dense: FloatArray, arc: FloatArray, joints: FloatArray, count: int, rng: np.random.Generator) -> list[m3d.Manifold]:
    """Kräftige Dornen: eine Reihe unter dem Schenkel, versetzte Dornen auf der Schiene bis zum Endkranz."""
    trochanter, knee, ankle, _ = joints
    tangents, _, _ = transport_frames(dense)
    femur_count = max(1, count // 3)
    stations = np.concatenate(
        [
            np.linspace(trochanter + 0.3 * (knee - trochanter), knee - 0.12 * (knee - trochanter), femur_count),
            np.linspace(knee + 0.25 * (ankle - knee), ankle - 0.04 * (ankle - knee), count - femur_count),
        ]
    )
    solids = []
    for index, station in enumerate(stations):
        i = int(np.clip(np.searchsorted(arc, station), 1, len(dense) - 1))
        tangent = tangents[i]
        on_femur = bool(station < knee)
        around = 0.0 if on_femur else index * 2.4 + rng.uniform(-0.4, 0.4)
        radial = _down_radial(tangent)
        radial = normalized(radial * np.cos(around) + np.cross(tangent, radial) * np.sin(around))
        radius = leg.femur_radius if on_femur else leg.tibia_radius
        base = dense[i] + radial * 0.55 * radius
        length = (2.1 if on_femur else 1.7) * leg.tibia_radius * (0.85 + 0.3 * rng.random())
        tip = base + normalized(radial * 0.62 + tangent * 0.78) * length
        solids.append(spike_solid(base, tip, tangent * 0.08 * length, 0.24 * leg.tibia_radius))
    return solids


@dataclass(frozen=True, slots=True)
class Foot:
    """Letztes Fußglied mit Rahmen, zwei Krallen und zwei Haftlappen (Fuß)."""

    toe: FloatArray
    tangent: FloatArray
    side: FloatArray
    down: FloatArray
    size: float

    PAD_RADII = (0.34, 0.58, 0.92)  # entlang unten, seitlich, längs (Anteile des Fußradius)

    @classmethod
    def of(cls, leg: LegShape, axis: LegAxis) -> Foot:
        """Fuß am Ende der Beinachse."""
        dense = axis.dense
        tangent = normalized(dense[-1] - dense[-6])
        side = normalized(np.cross(tangent, [0.0, 1.0, 0.0]))
        return cls(dense[-1], tangent, side, normalized(np.cross(side, tangent)), leg.tarsus_radius)

    @property
    def frame(self) -> FloatArray:
        """Rechtshändiger Rahmen der Haftlappen (Spalten: unten, seitlich, längs)."""
        return np.stack([self.down, self.side, self.tangent], axis=1)

    def pads(self) -> list[Ellipsoid]:
        """Die beiden Haftlappen unter den Krallen."""
        size = self.size
        radii = np.asarray(self.PAD_RADII) * size
        return [
            Ellipsoid(self.toe + self.tangent * 0.6 * size + self.side * spread * 0.52 * size + self.down * 0.52 * size, radii, self.frame)
            for spread in (-1.0, 1.0)
        ]

    def claw_paths(self) -> list[FloatArray]:
        """Mittellinien der beiden Krallen, gespreizt und nach unten eingerollt."""
        size, paths = self.size, []
        for spread in (-1.0, 1.0):
            base = self.toe + self.side * spread * 0.38 * size - self.tangent * 0.15 * size
            heading = normalized(self.tangent + self.side * spread * 0.55)
            paths.append(
                np.stack(
                    [
                        base,
                        base + heading * 1.05 * size,
                        base + heading * 2.0 * size + self.down * 0.45 * size,
                        base + heading * 2.4 * size + self.down * 1.4 * size,
                    ]
                )
            )
        return paths


def _foot(leg: LegShape, axis: LegAxis, pad_segments: int) -> list[m3d.Manifold]:
    """Zwei gebogene Krallen und zwei Haftlappen am letzten Fußglied."""
    foot = Foot.of(leg, axis)
    euler = _euler_degrees(foot.frame)
    solids = [tube_solid(path, np.array([0.4, 0.28, 0.14, 0.0]) * foot.size, 3) for path in foot.claw_paths()]
    solids += [ellipsoid_solid(pad.center, pad.radii, euler, pad_segments) for pad in foot.pads()]
    return solids


def concatenate_shaded(meshes: list[ShadedMesh]) -> ShadedMesh:
    """Fügt schattierte Netze ohne Boolean zu einem Netz zusammen (sich durchdringende Hüllen)."""
    offsets = np.cumsum([0] + [len(mesh.vertices) for mesh in meshes[:-1]])
    return ShadedMesh(
        np.concatenate([mesh.vertices for mesh in meshes]),
        np.concatenate([mesh.normals for mesh in meshes]),
        np.concatenate([mesh.faces + offset for mesh, offset in zip(meshes, offsets, strict=True)]),
    )


def _euler_degrees(rotation: FloatArray) -> tuple[float, float, float]:
    """Euler-Winkel in Grad einer Drehmatrix für ``Manifold.rotate`` (erst um x, dann y, dann z)."""
    y = np.degrees(np.arcsin(np.clip(-rotation[2, 0], -1.0, 1.0)))
    x = np.degrees(np.arctan2(rotation[2, 1], rotation[2, 2]))
    z = np.degrees(np.arctan2(rotation[1, 0], rotation[0, 0]))
    return float(x), float(y), float(z)


def antenna_solid(antenna: AntennaShape, sides: int = 5) -> m3d.Manifold:
    """Fühler aus Grundglied, Wendeglied und abgeflachtem Endglied (Teil der Kopfkapsel)."""
    dense = catmull_rom(antenna.path, 8)
    knots = arc_lengths(antenna.path)
    arc = arc_lengths(dense)
    stations = np.linspace(0.0, arc[-1], 8)
    radii = np.interp(stations / arc[-1] * knots[-1], knots, antenna.radii)
    path, radii = rounded_end(resample(dense, stations), radii, steps=2)
    return tube_solid(path, radii, sides)


def halter_solid(halter: HalterShape, sides: int = 5) -> m3d.Manifold:
    """Schwingkölbchen: dünner Stiel mit kugeligem Köpfchen (Teil des Rumpfs)."""
    stalk = tube_solid(*rounded_end(halter.path, halter.radii, steps=1), sides)
    knob = m3d.Manifold.sphere(halter.knob_radius, 8).translate(tuple(halter.knob_center))
    return union_all([stalk, knob])


def proboscis_part(proboscis: ProboscisShape, head: m3d.Manifold, sides: int) -> LimbPart:
    """Rüssel mit Schaft, zwei Tupfpolstern und hängendem Tropfen; an der Kopfkapsel beschnitten."""
    dense = catmull_rom(proboscis.path, 10)
    knots = arc_lengths(proboscis.path)
    arc = arc_lengths(dense)
    stations = np.linspace(0.0, arc[-1], 7)
    radii = np.interp(stations / arc[-1] * knots[-1], knots, proboscis.radii)
    path, radii = rounded_end(resample(dense, stations), radii, steps=1)
    # Der Schaft wird an der Kopfkapsel beschnitten; Tupfpolster und Tropfen stecken als eigene Hüllen am Schaftende
    shells = [tube_solid(path, radii, sides) - head]
    for lobe in proboscis.lobes:
        shells.append(ellipsoid_solid(lobe.center, lobe.radii, (proboscis.lobe_tilt_degrees, 0.0, 0.0), sides + 2))
    shells.append(
        m3d.Manifold.batch_hull(
            [
                m3d.Manifold.sphere(proboscis.drop_neck_radius, sides).translate(tuple(proboscis.drop_neck)),
                m3d.Manifold.sphere(proboscis.drop_radius, sides + 2).translate(tuple(proboscis.drop_center)),
            ]
        )
    )
    meshes = [shade_with_creases(shell, sharp_angle_degrees=CREASE_DEGREES) for shell in shells]
    return LimbPart("Proboscis", proboscis.pivot, concatenate_shaded(meshes))
