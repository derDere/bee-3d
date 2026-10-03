"""Proportionen der Fliegen nach Makrofotos einer Schmeißfliege, leicht übersteigert (Anatomie).

Die Referenzfliege ist in Millimetern eines rund 10 mm langen Tiers notiert: x links, y oben,
z vorne, Brustmitte im Ursprung. ``FlyAnatomy.build`` wendet die Formfaktoren der Art an, misst
die Länge vom Kopf bis zum Hinterleibsende, skaliert auf die Ziellänge der Art und legt den
Ursprung in den Schwerpunkt der Rumpfvolumina (Kopf, Brust, Hinterleib bei gleicher Dichte).
Die rechte Körperseite entsteht durch Spiegelung der linken.

Proportionsliste der Referenzfliege (mm, vor den Formfaktoren der Art):

| Teil | Maß | Verhältnis |
|---|---|---|
| Kopf | Kapsel 3,2 breit × 3,0 hoch × 1,6 tief, flacher Hinterkopf, Gesichtsplatte, Wangen | Kopf mit Augen so breit wie die Brust |
| Augen | Ellipsoidkappen 2,1 × 3,0 (quer × hoch), Wölbung 0,93, Kappe bis 105° | bedecken die Kopfseiten, dazwischen ein schmaler Stirnstreifen |
| Brust | 3,6 × 3,4 × 3,9 mit Schildchen, Schulterbeulen, Flanken, Hinterrücken | höchster Punkt des Körpers |
| Hinterleib | 4,2 × 2,9 × 4,1, vier Rückenplatten, hinten 9° abgesenkt | Länge ≈ 0,4 × Körperlänge, Vorderkante unter dem Schildchen |
| Flügel | 8,0 lang, 3,25 tief, im Flug 24–52° nach hinten gepfeilt | Spannweite ≈ 1,9 × Körperlänge |
| Beine | Hüfte 0,6–0,7, Schenkel 1,3–1,5, Schiene 1,2–1,6, Fuß 0,9–1,1 | im Flug hängend, Knie gebeugt, leicht gespreizt |
| Rüssel | 1,4 lang, Tupfpolster 1,2 breit, Tropfen Ø 0,55 | hängt schräg nach vorn unten |
| Fühler | 1,0 in der Gesichtsrinne, Borste (Arista) 0,9 | liegen in der Gesichtsmitte |
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from modelkit.sdf import Ellipsoid, TaperedCapsule
from modelkit.transforms import rotation_matrix

from flykit.species import Species

type FloatArray = npt.NDArray[np.float64]

MIRROR = np.array([-1.0, 1.0, 1.0])
SIDES = (("_L", 1.0), ("_R", -1.0))


def direction(azimuth_degrees: float, elevation_degrees: float) -> FloatArray:
    """Einheitsvektor aus Azimut (um +Y, 0 = vorne, positiv = links) und Höhenwinkel."""
    azimuth, elevation = np.radians(azimuth_degrees), np.radians(elevation_degrees)
    return np.array([np.sin(azimuth) * np.cos(elevation), np.sin(elevation), np.cos(azimuth) * np.cos(elevation)])


def normalized(vectors: FloatArray) -> FloatArray:
    """Normiert Vektoren entlang der letzten Achse."""
    return vectors / np.maximum(np.linalg.norm(vectors, axis=-1, keepdims=True), 1e-12)


@dataclass(frozen=True, slots=True)
class Placement:
    """Abbildung der Referenzmillimeter auf Modellmeter: Ursprung abziehen, dann skalieren (Platzierung)."""

    unit: float
    origin: FloatArray

    def point(self, xyz: Sequence[float] | FloatArray) -> FloatArray:
        """Ein Referenzpunkt (mm) im Modellrahmen (m)."""
        return (np.asarray(xyz, dtype=np.float64) - self.origin) * self.unit

    def length(self, value: float) -> float:
        """Eine Referenzlänge (mm) in Metern."""
        return float(value) * self.unit

    def lengths(self, values: Sequence[float] | FloatArray) -> FloatArray:
        """Mehrere Referenzlängen (mm) in Metern."""
        return np.asarray(values, dtype=np.float64) * self.unit

    def ellipsoid(self, center: Sequence[float] | FloatArray, radii: Sequence[float] | FloatArray, rotation: FloatArray | None = None) -> Ellipsoid:
        """Ellipsoid aus Referenzmitte und -radien."""
        return Ellipsoid(self.point(center), self.lengths(radii), rotation)


@dataclass(frozen=True, slots=True)
class EyeShape:
    """Facettenauge als Ellipsoidkappe, die aus der Kopfkapsel ragt (Komplexauge).

    ``frame`` bildet lokal → Modell ab; Spalten sind die Achsen quer, hoch und außen, ``radii``
    die Halbachsen entlang dieser Achsen. Die Kappe reicht bis ``cap_degrees`` von der Außenachse;
    ihr Rand liegt verdeckt in der Kopfkapsel.
    """

    name: str
    side: float
    center: FloatArray
    frame: FloatArray
    radii: FloatArray
    cap_degrees: float

    def surface(self, directions: FloatArray) -> FloatArray:
        """Punkte der Augenfläche zu Einheitsrichtungen im lokalen Rahmen (N, 3)."""
        return self.center + (directions * self.radii) @ self.frame.T

    def normals(self, directions: FloatArray) -> FloatArray:
        """Flächennormalen der Augenfläche zu Einheitsrichtungen im lokalen Rahmen."""
        return normalized((directions / self.radii) @ self.frame.T)

    def local_directions(self, points: FloatArray) -> FloatArray:
        """Einheitsrichtungen im lokalen Rahmen zu Punkten auf oder nahe der Augenfläche."""
        return normalized(((points - self.center) @ self.frame) / self.radii)

    def mirrored(self, name: str) -> EyeShape:
        """Das gespiegelte Auge der anderen Körperseite (gleiche lokale Richtungen)."""
        return EyeShape(name, -self.side, self.center * MIRROR, self.frame * MIRROR[:, None], self.radii, self.cap_degrees)


@dataclass(frozen=True, slots=True)
class LegShape:
    """Bein aus Hüfte, Schenkelring, Knie, Fußgelenk und Zehe (Bein).

    Die Radien gelten für Hüftglied, Schenkel, Schiene und Fuß; ``joints[0]`` ist der Pivot.
    """

    name: str
    side: float
    joints: FloatArray
    coxa_radius: float
    femur_radius: float
    tibia_radius: float
    tarsus_radius: float

    @property
    def pivot(self) -> FloatArray:
        """Hüftgelenk (Pivot des Beinknotens)."""
        return self.joints[0]


@dataclass(frozen=True, slots=True)
class WingShape:
    """Flügel einer Seite mit Gelenk, Größe und Flughaltung (Flügel)."""

    name: str
    side: float
    root: FloatArray
    length: float
    chord: float
    sweep_degrees: float
    raise_degrees: float


@dataclass(frozen=True, slots=True)
class ProboscisShape:
    """Tupfrüssel: Rüsselschaft, zwei Tupfpolster und ein hängender Speicheltropfen (Rüssel)."""

    path: FloatArray
    radii: FloatArray
    lobes: tuple[Ellipsoid, Ellipsoid]
    lobe_tilt_degrees: float
    drop_center: FloatArray
    drop_radius: float
    drop_neck: FloatArray
    drop_neck_radius: float

    @property
    def pivot(self) -> FloatArray:
        """Rüsselansatz in der Mundöffnung (Pivot des Rüsselknotens)."""
        return self.path[0]

    @property
    def spit_origin(self) -> FloatArray:
        """Mitte des Speicheltropfens: hier entsteht der Spuckeball."""
        return self.drop_center


@dataclass(frozen=True, slots=True)
class AntennaShape:
    """Fühler in der Gesichtsrinne mit Fühlerborste (Arista) (Fühler)."""

    name: str
    side: float
    path: FloatArray
    radii: FloatArray
    arista_base: FloatArray
    arista_direction: FloatArray
    arista_length: float


@dataclass(frozen=True, slots=True)
class HalterShape:
    """Schwingkölbchen hinter dem Flügel: Stiel und Köpfchen (Haltere)."""

    path: FloatArray
    radii: FloatArray
    knob_center: FloatArray
    knob_radius: float


@dataclass(frozen=True, slots=True)
class HeadShape:
    """Kopfkapsel ohne Augen, Fühler und Rüssel (Kopf)."""

    core: Ellipsoid
    back_z: float  # flacher Hinterkopf: Ebene z = back_z
    face: Ellipsoid
    genae: tuple[Ellipsoid, Ellipsoid]
    vertex: Ellipsoid
    mouth: Ellipsoid
    grooves: tuple[TaperedCapsule, TaperedCapsule]
    neck_joint: FloatArray
    ocelli: tuple[FloatArray, ...]

    @property
    def center(self) -> FloatArray:
        """Mitte der Kopfkapsel."""
        return np.asarray(self.core.center)


@dataclass(frozen=True, slots=True)
class ThoraxShape:
    """Brust mit Schildchen, Schulterbeulen, Flanken, Hinterrücken und Halsstummel (Brust)."""

    scutum: Ellipsoid
    scutellum: Ellipsoid
    humeri: tuple[Ellipsoid, Ellipsoid]
    pleura: tuple[Ellipsoid, Ellipsoid]
    postnotum: Ellipsoid
    neck: Ellipsoid
    suture_z: float  # Quernaht des Brustrückens
    halteres: tuple[HalterShape, HalterShape]


@dataclass(frozen=True, slots=True)
class AbdomenShape:
    """Hinterleib mit Rückenplatten, hinten leicht abgesenkt (Hinterleib).

    ``band_edges`` sind die Plattengrenzen entlang der Längsachse des Hinterleibs (lokales z,
    von vorn nach hinten), beginnend an der Vorderkante und endend an der Spitze. ``bloat``
    dehnt die Zwischenhäute (Königin).
    """

    ellipsoid: Ellipsoid
    band_edges: FloatArray
    bloat: float

    @property
    def rotation(self) -> FloatArray:
        """Drehung lokal → Modell (Spalten: quer, hoch, längs nach vorn)."""
        return np.eye(3) if self.ellipsoid.rotation is None else np.asarray(self.ellipsoid.rotation)

    def axial(self, points: FloatArray) -> FloatArray:
        """Lage entlang der Längsachse (lokales z, vorn positiv)."""
        return ((points - np.asarray(self.ellipsoid.center)) @ self.rotation)[:, 2]

    def at(self, local: FloatArray) -> FloatArray:
        """Modellpunkte aus lokalen Koordinaten (quer, hoch, längs)."""
        return np.asarray(self.ellipsoid.center) + np.atleast_2d(local) @ self.rotation.T

    @property
    def tip(self) -> float:
        """z des Hinterleibsendes (Modellrahmen)."""
        return float(self.at(np.array([0.0, 0.0, -float(self.ellipsoid.radii[2])]))[0, 2])


@dataclass(frozen=True, slots=True)
class FlyAnatomy:
    """Alle Teile einer Fliege in Metern, Ursprung im Schwerpunkt (Anatomie)."""

    species: Species
    unit: float  # Meter je Referenzmillimeter
    head: HeadShape
    eyes: tuple[EyeShape, EyeShape]
    antennae: tuple[AntennaShape, AntennaShape]
    proboscis: ProboscisShape
    thorax: ThoraxShape
    abdomen: AbdomenShape
    legs: tuple[LegShape, ...]
    wings: tuple[WingShape, WingShape]

    @classmethod
    def build(cls, species: Species) -> FlyAnatomy:
        """Baut die Anatomie einer Art: Formfaktoren, Ziellänge, Ursprung im Schwerpunkt."""
        reference = _assemble(species, Placement(1.0, np.zeros(3)))
        front, back = reference.front_z(), reference.abdomen.tip
        unit = species.length / (front - back)
        return _assemble(species, Placement(unit, reference.volume_centroid()))

    def front_z(self) -> float:
        """Vorderster Punkt des Kopfes (Kapsel, Gesicht oder Augen)."""
        fronts = [float(self.head.core.center[2] + self.head.core.radii[2]), float(self.head.face.center[2] + self.head.face.radii[2])]
        for eye in self.eyes:
            fronts.append(float(eye.surface(cap_directions(eye.cap_degrees, 24, 48))[:, 2].max()))
        return max(fronts)

    def volume_centroid(self, resolution: int = 72) -> FloatArray:
        """Schwerpunkt der vereinigten Rumpfvolumina (Kopf, Brust, Hinterleib) bei gleicher Dichte."""
        parts = [self.head.core, self.thorax.scutum, self.thorax.scutellum, self.thorax.postnotum, self.abdomen.ellipsoid]
        lower = np.min([part.bounds().lower for part in parts], axis=0)
        upper = np.max([part.bounds().upper for part in parts], axis=0)
        axes = [np.linspace(lower[i], upper[i], resolution) for i in range(3)]
        grid = np.stack(np.meshgrid(*axes, indexing="ij"), axis=-1).reshape(-1, 3)
        inside = np.min([part.distance(grid) for part in parts], axis=0) < 0.0
        return grid[inside].mean(axis=0)

    @property
    def length(self) -> float:
        """Länge vom Kopf bis zum Hinterleibsende (m)."""
        return self.front_z() - self.abdomen.tip


def cap_directions(cap_degrees: float, rings: int, segments: int) -> FloatArray:
    """Einheitsrichtungen auf einer Kugelkappe um +z (für Messungen und Prüfungen)."""
    theta = np.radians(cap_degrees) * np.arange(rings + 1) / rings
    phi = 2.0 * np.pi * np.arange(segments) / segments
    return np.stack(
        [
            (np.sin(theta)[:, None] * np.cos(phi)[None, :]).ravel(),
            (np.sin(theta)[:, None] * np.sin(phi)[None, :]).ravel(),
            np.repeat(np.cos(theta), segments),
        ],
        axis=1,
    )


def _scaled(values: Sequence[float], factors: Sequence[float]) -> FloatArray:
    return np.asarray(values, dtype=np.float64) * np.asarray(factors, dtype=np.float64)


def _assemble(species: Species, place: Placement) -> FlyAnatomy:
    """Setzt die Referenzfliege mit den Formfaktoren der Art zusammen und platziert sie."""
    shape = species.proportions
    thorax_scale = np.asarray(shape.thorax)
    thorax = _thorax(place, thorax_scale)
    head_center = np.array([0.0, 0.0, 1.95 * thorax_scale[2] + 0.9 * shape.head])
    head = _head(place, head_center, shape.head)
    eye_l = _eye(place, head_center, shape.head, shape.eye)
    abdomen = _abdomen(place, thorax_scale, np.asarray(shape.abdomen), shape.bloat)
    return FlyAnatomy(
        species=species,
        unit=place.unit,
        head=head,
        eyes=(eye_l, eye_l.mirrored("Eye_R")),
        antennae=_antennae(place, head_center, shape.head),
        proboscis=_proboscis(place, head_center, shape.head * shape.proboscis),
        thorax=thorax,
        abdomen=abdomen,
        legs=_legs(place, thorax_scale, shape.leg_length, shape.leg_thickness),
        wings=_wings(place, thorax_scale, shape.wing),
    )


def _thorax(place: Placement, scale: FloatArray) -> ThoraxShape:
    def ellipsoid(center: Sequence[float], radii: Sequence[float]) -> Ellipsoid:
        return place.ellipsoid(_scaled(center, scale), _scaled(radii, scale))

    halteres = []
    for _, side in SIDES:
        flip = np.array([side, 1.0, 1.0])
        path = _scaled([(1.02, 0.55, -1.28), (1.16, 0.38, -1.5), (1.24, 0.24, -1.66)], scale) * flip
        knob = _scaled((1.27, 0.2, -1.72), scale) * flip
        halteres.append(
            HalterShape(
                np.stack([place.point(p) for p in path]), place.lengths([0.07, 0.06, 0.055]), place.point(knob), place.length(0.16)
            )
        )
    return ThoraxShape(
        scutum=ellipsoid((0.0, 0.12, 0.0), (1.78, 1.72, 1.95)),
        scutellum=ellipsoid((0.0, 1.2, -1.66), (0.95, 0.42, 0.62)),
        humeri=(ellipsoid((1.3, 0.7, 1.2), (0.52, 0.48, 0.52)), ellipsoid((-1.3, 0.7, 1.2), (0.52, 0.48, 0.52))),
        pleura=(ellipsoid((1.42, -0.5, 0.25), (0.55, 0.85, 0.95)), ellipsoid((-1.42, -0.5, 0.25), (0.55, 0.85, 0.95))),
        postnotum=ellipsoid((0.0, 0.25, -1.85), (1.15, 0.95, 0.55)),
        neck=ellipsoid((0.0, -0.05, 2.0), (0.5, 0.48, 0.55)),
        suture_z=float(place.point((0.0, 0.0, 0.3 * scale[2]))[2]),
        halteres=(halteres[0], halteres[1]),
    )


def _head(place: Placement, center: FloatArray, scale: float) -> HeadShape:
    def at(offset: Sequence[float]) -> FloatArray:
        return center + np.asarray(offset, dtype=np.float64) * scale

    def ellipsoid(offset: Sequence[float], radii: Sequence[float], rotation: FloatArray | None = None) -> Ellipsoid:
        return place.ellipsoid(at(offset), np.asarray(radii) * scale, rotation)

    grooves = tuple(
        TaperedCapsule(place.point(at((0.27 * side, 0.22, 0.86))), place.point(at((0.24 * side, -0.62, 0.9))), place.length(0.2 * scale), place.length(0.18 * scale))
        for _, side in SIDES
    )
    return HeadShape(
        core=ellipsoid((0.0, 0.0, 0.0), (1.6, 1.5, 0.82)),
        back_z=float(place.point(at((0.0, 0.0, -0.5)))[2]),
        face=ellipsoid((0.0, -0.48, 0.62), (0.84, 0.86, 0.45)),
        genae=(ellipsoid((0.95, -0.82, 0.18), (0.6, 0.52, 0.62)), ellipsoid((-0.95, -0.82, 0.18), (0.6, 0.52, 0.62))),
        vertex=ellipsoid((0.0, 1.32, -0.12), (0.42, 0.28, 0.36)),
        mouth=ellipsoid((0.0, -1.3, 0.28), (0.46, 0.32, 0.46)),
        grooves=(grooves[0], grooves[1]),
        neck_joint=place.point(at((0.0, -0.05, -0.62))),
        ocelli=(place.point(at((0.0, 1.55, 0.02))), place.point(at((0.17, 1.47, -0.1))), place.point(at((-0.17, 1.47, -0.1)))),
    )


def _eye(place: Placement, head_center: FloatArray, head_scale: float, eye_scale: float) -> EyeShape:
    # Linkes Auge: Außenachse schräg nach vorn außen, Hochachse leicht zur Kopfmitte geneigt (Augen stoßen oben fast zusammen)
    outward = direction(64.0, 6.0)
    across = normalized(np.cross([0.0, 1.0, 0.0], outward))
    up = np.cross(outward, across)
    tilt = rotation_matrix(outward, 8.0)
    frame = tilt @ np.stack([across, up, outward], axis=1)
    center = head_center + np.array([0.72, 0.3, 0.06]) * head_scale
    radii = np.array([1.06, 1.5, 0.93]) * head_scale * eye_scale
    return EyeShape("Eye_L", 1.0, place.point(center), frame, place.lengths(radii), 105.0)


def _antennae(place: Placement, head_center: FloatArray, scale: float) -> tuple[AntennaShape, AntennaShape]:
    path = np.array([(0.25, 0.3, 0.84), (0.27, 0.2, 0.96), (0.28, 0.05, 1.02), (0.28, -0.32, 1.0), (0.27, -0.6, 0.95)])
    radii = np.array([0.1, 0.1, 0.13, 0.12, 0.05])
    result = []
    for name, side in (("Antenna_L", 1.0), ("Antenna_R", -1.0)):
        flip = np.array([side, 1.0, 1.0])
        points = np.stack([place.point(head_center + p * flip * scale) for p in path])
        result.append(
            AntennaShape(
                name,
                side,
                points,
                place.lengths(radii * scale),
                place.point(head_center + np.array([0.33 * side, 0.0, 1.06]) * scale),
                normalized(np.array([0.55 * side, 0.55, 0.62])),
                place.length(0.9 * scale),
            )
        )
    return result[0], result[1]


def _proboscis(place: Placement, head_center: FloatArray, scale: float) -> ProboscisShape:
    def at(offset: Sequence[float]) -> FloatArray:
        return place.point(head_center + np.asarray(offset, dtype=np.float64) * scale)

    tilt = -35.0
    rotation = rotation_matrix((1.0, 0.0, 0.0), tilt)
    lobes = tuple(place.ellipsoid(head_center + np.array([0.27 * side, -2.55, 0.9]) * scale, np.array([0.36, 0.24, 0.48]) * scale, rotation) for _, side in SIDES)
    return ProboscisShape(
        path=np.stack([at((0.0, -1.12, 0.28)), at((0.0, -1.58, 0.42)), at((0.0, -2.02, 0.55)), at((0.0, -2.36, 0.76))]),
        radii=place.lengths(np.array([0.34, 0.3, 0.24, 0.22]) * scale),
        lobes=(lobes[0], lobes[1]),
        lobe_tilt_degrees=tilt,
        drop_center=at((0.0, -3.1, 1.02)),
        drop_radius=place.length(0.27 * scale),
        drop_neck=at((0.0, -2.76, 0.98)),
        drop_neck_radius=place.length(0.09 * scale),
    )


def _abdomen(place: Placement, thorax_scale: FloatArray, scale: FloatArray, bloat: float) -> AbdomenShape:
    radii = np.array([2.1, 1.45, 2.05]) * scale
    center = np.array([0.0, -0.42 - 0.4 * (scale[1] - 1.0), -1.9 * thorax_scale[2] - radii[2] + 0.85])
    # Hinten leicht abgesenkt: die Vorderkante taucht unter das Schildchen
    ellipsoid = place.ellipsoid(center, radii, rotation_matrix((1.0, 0.0, 0.0), -9.0))
    # Plattengrenzen als Anteil der Hinterleibslänge: Syntergit 1+2, Platten 3, 4, 5
    fractions = np.array([0.0, 0.3, 0.55, 0.78, 1.0])
    edges = place.lengths(radii[2] * (1.0 - 2.0 * fractions))
    return AbdomenShape(ellipsoid, edges, bloat)


def _legs(place: Placement, thorax_scale: FloatArray, length: float, thickness: float) -> tuple[LegShape, ...]:
    # Linke Seite in Referenzmillimetern: Hüfte (am Brustboden), Schenkelring, Knie, Fußgelenk, Zehe
    left = {
        "Leg_Front": ((0.42, -1.0, 1.35), (0.62, -1.62, 1.68), (1.35, -2.2, 2.55), (1.62, -3.4, 2.62), (1.9, -4.25, 3.15)),
        "Leg_Middle": ((0.72, -1.28, 0.15), (1.02, -1.82, 0.18), (2.2, -2.3, 0.4), (2.6, -3.7, 0.05), (2.88, -4.55, 0.22)),
        "Leg_Hind": ((0.62, -1.22, -0.88), (0.92, -1.76, -1.05), (2.0, -2.25, -1.9), (2.35, -3.6, -2.7), (2.6, -4.4, -3.4)),
    }
    legs = []
    for name, joints in left.items():
        points = np.asarray(joints, dtype=np.float64)
        hip = points[0] * thorax_scale
        chain = hip + (points - points[0]) * length
        for suffix, side in SIDES:
            flip = np.array([side, 1.0, 1.0])
            legs.append(
                LegShape(
                    name + suffix,
                    side,
                    np.stack([place.point(p * flip) for p in chain]),
                    place.length(0.38 * thickness),
                    place.length(0.34 * thickness),
                    place.length(0.23 * thickness),
                    place.length(0.15 * thickness),
                )
            )
    return tuple(legs)


def _wings(place: Placement, thorax_scale: FloatArray, scale: float) -> tuple[WingShape, WingShape]:
    wings = []
    for name, side in (("Wing_L", 1.0), ("Wing_R", -1.0)):
        root = _scaled((1.28 * side, 1.0, 0.65), thorax_scale)
        wings.append(WingShape(name, side, place.point(root), place.length(8.0 * scale), place.length(3.25 * scale), 38.0, 14.0))
    return wings[0], wings[1]
