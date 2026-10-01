"""Proportionen der Biene nach dem CSS-Vorbild aus dem Spiel bee-bee (Anatomie).

Die Maße stammen aus ``www/css/bee.css`` des Spiels bee-bee: Bienenbox 100 × 50 px mit Blick
nach links, Körperteile als Kreise mit 3 px Rand. Ein CSS-Pixel entspricht ``PX`` Metern; der
Ursprung liegt in der Boxmitte (CSS 50 | 25), dem Bezugspunkt der Biene im Spiel. Achsen nach
glTF: +X linke Körperseite, +Y oben, +Z vorne. Koordinaten in diesem Modul sind in CSS-Pixeln
notiert (x seitlich, y über der Mitte, z vor der Mitte) und werden mit ``scaled`` zu Metern.

Proportionsliste (CSS → Modell, Pixel):

| Teil | CSS | Modell |
|---|---|---|
| Kopf | Kreis Ø 30 bei (25, 15) | Ellipsoid 15,6 × 15 × 15 bei (0, 10,5, 30), mit Bäckchen |
| Hals | Kreis Ø 35 bei (32,5, 22,5), dunkelbraun | schlanker dunkelbrauner Hals 10,5 × 10 × 9 |
| Brust | Kreis Ø 40 bei (40, 25) | Ellipsoid 19,5 × 19 × 19,5 |
| Taille | 40 × 30 bei (55, 25) | Wespentaille Ø 23 zwischen Brust und Hinterleib |
| Hinterleib | 6 Kreise Ø 40 × (0,95 1 0,95 0,9 0,85 0,8) im Abstand 6 | 6 überlappende Platten ab x = 74 im Abstand 5,65, Ringe 1, 3, 5 dunkel |
| Stachel | Dreieck 30 × 10, Spitze bei x = 140 | Kegel r 5 bis z = −95 |
| Augen | weiß Ø 12 mit Rand, Pupille Ø 5 | Kugeln r 6, weich eingebettet, Pupillen als Aufleger |
| Mund | Lächeln Ø 10, offen 25 × 13, Geist 8 × 8 | Aufleger mit Formzielen |
| Fühler | 3 px Bogen nach vorn, Kugel Ø 7 | Schaft und Geißel r 1,5, Kugel r 3,5 |
| Beine | Schenkel 5 × 15, Schiene 3 × 24 | Schenkel, Schiene, Fußglieder, Krallen |
| Flügel | Tropfen 54 × 15, um 20° angehoben | Vorderflügel 54,3 × 15, Hinterflügel 33 × 10 |

Im CSS-Vorbild liegen die Kreise übereinander; im Modell bilden alle Teile eine einzige
geschlossene Hülle. Die Hinterleibsplatten (Tergite) überlappen wie Dachziegel; ihre Ränder
liegen an den Bandgrenzen des Vorbilds: goldene Taille, breites dunkles Band, gleich breite
Bänder von 7,5–8 px, goldenes Ende mit Stachel.

Realistische Züge nach der Bienen- und Wespenanatomie: pelzige Brust und pelziger Kopf der Biene,
schlanker Hals und Wespentaille, glänzende Tergite mit Randwulst, geknickte Fühler aus Schaft und
gegliederter Geißel, Beine aus Schenkel, Schiene, Fußgliedern und Krallen, vier Flügel, drei
Punktaugen auf dem Scheitel.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from modelkit.sdf import Ellipsoid

type FloatArray = npt.NDArray[np.float64]

PX = 0.004  # Meter je CSS-Pixel: Bienenbox 0,4 × 0,2 m, Kopf bis Stachelspitze 0,56 m

SEGMENT_SCALES = (0.945, 0.972, 0.972, 0.938, 0.872, 0.76)  # Radien als Anteil der CSS-Kreise (Ø 40)
SEGMENT_STRETCH = (1.0, 1.0, 1.0, 1.0, 1.0, 1.35)  # Längsstreckung; das letzte Tergit läuft wespenartig spitz zu
SEGMENT_START = 74.0  # CSS-x der ersten Hinterleibskugel (Taille sichtbar zwischen Brust und Hinterleib)
SEGMENT_SPACING = 5.65  # CSS-px zwischen den Kugelmitten


def scaled(values: Sequence[float] | FloatArray) -> FloatArray:
    """Rechnet CSS-Pixel in Meter um."""
    return np.asarray(values, dtype=np.float64) * PX


def css(x: float, y: float) -> tuple[float, float, float]:
    """CSS-Position des Vorbilds (x nach hinten, y nach unten) als Modellpunkt in Pixeln."""
    return (0.0, 25.0 - y, 50.0 - x)


def mirrored(points: FloatArray) -> FloatArray:
    """Spiegelt Punkte auf die rechte Körperseite (x → −x)."""
    return np.asarray(points) * np.array([-1.0, 1.0, 1.0])


def direction(azimuth_degrees: float, elevation_degrees: float) -> FloatArray:
    """Einheitsvektor aus Azimut (um +Y, 0 = vorne, positiv = links) und Höhenwinkel."""
    azimuth, elevation = np.radians(azimuth_degrees), np.radians(elevation_degrees)
    return np.array([np.sin(azimuth) * np.cos(elevation), np.sin(elevation), np.cos(azimuth) * np.cos(elevation)])


@dataclass(frozen=True, slots=True)
class Eye:
    """Comic-Auge: runder Augapfel in der Kopfhülle, Pupille als Aufleger in Blickrichtung (Auge)."""

    name: str
    center: FloatArray
    radius: float
    outward: FloatArray
    gaze: FloatArray
    pupil_degrees: float  # Winkelradius der Pupille auf dem Augapfel


@dataclass(frozen=True, slots=True)
class Tube:
    """Glied als Kette von Kugeln mit Radien (Beinabschnitt, Fühler, Kralle, Stachel)."""

    name: str
    points: FloatArray
    radii: FloatArray


@dataclass(frozen=True, slots=True)
class Leg:
    """Bein aus Hüfte, Knie, Fußgelenk und Zehe mit zwei Krallen (Bein)."""

    name: str
    joints: FloatArray
    femur_radius: float
    tibia_radius: float
    tarsus_radius: float


@dataclass(frozen=True, slots=True)
class Antenna:
    """Geknickter Fühler: Schaft vom Scheitel nach oben, Geißel nach vorn, Kugel an der Spitze (Fühler)."""

    name: str
    path: FloatArray
    elbow: int
    radius: float
    tip_radius: float
    flagellum_rings: int

    @property
    def tip(self) -> FloatArray:
        """Mittelpunkt der Fühlerkugel."""
        return self.path[-1]


@dataclass(frozen=True, slots=True)
class Mouth:
    """Mundformen in Bogenpixeln auf dem Gesicht um die Kopfmitte (Mund).

    u läuft quer über das Gesicht (positiv = links), v nach oben. Lächeln ist die Grundform,
    ``Shout`` der offene Lasermund mit rotem Rand, ``Ghost`` der heulende Bogenmund des Geistes.
    """

    smile_center: tuple[float, float] = (0.0, -3.6)
    smile_radius: float = 5.6
    smile_thickness: float = 2.2
    shout_center: tuple[float, float] = (0.0, -7.2)
    shout_size: tuple[float, float] = (20.0, 10.4)
    shout_corners: tuple[float, float] = (4.0, 6.4)
    shout_rim: float = 1.25
    ghost_base: float = -12.0
    ghost_size: tuple[float, float] = (8.0, 10.0)
    lift: float = 0.3


@dataclass(frozen=True, slots=True)
class WingLobe:
    """Tropfenförmige Flügelfläche: spitz an der Wurzel, rund am Ende (Flügellappen).

    Umriss wie im CSS-Vorbild: gerade Flanken bis 29 % der Länge, danach eine Halbellipse um 59 %.
    ``offset`` verschiebt den Lappen im Flügelrahmen, ``sweep_degrees`` dreht ihn nach hinten.
    """

    length: float
    width: float
    offset: tuple[float, float, float] = (0.0, 0.0, 0.0)
    sweep_degrees: float = 0.0

    _TANGENT = 0.293
    _CENTER = 0.586
    _SEMI_AXIS = 0.414

    def half_width(self, span: FloatArray) -> FloatArray:
        """Halbe Breite (m) an den Spannweitenanteilen ``span`` (0 = Wurzel, 1 = Spitze)."""
        span = np.clip(np.asarray(span, dtype=np.float64), 0.0, 1.0)
        half = 0.5 * self.width
        flank = half * 0.707 * span / self._TANGENT
        rounded = half * np.sqrt(np.clip(1.0 - ((span - self._CENTER) / self._SEMI_AXIS) ** 2, 0.0, None))
        return np.where(span <= self._TANGENT, flank, rounded)


@dataclass(frozen=True, slots=True)
class Wing:
    """Flügelpaar einer Seite: Vorderflügel nach dem Vorbild, kleiner Hinterflügel dahinter (Flügel)."""

    name: str
    root: FloatArray
    side: float
    forewing: WingLobe
    hindwing: WingLobe
    sweep_degrees: float
    raise_degrees: float


@dataclass(frozen=True, slots=True)
class BeeAnatomy:
    """Alle Teile der Biene in Metern, abgeleitet aus dem CSS-Vorbild (Anatomie)."""

    head: Ellipsoid
    cheeks: tuple[Ellipsoid, ...]
    eyes: tuple[Eye, ...]
    neck: Ellipsoid
    thorax: Ellipsoid
    waist: Ellipsoid
    segments: tuple[Ellipsoid, ...]
    stinger: Tube
    legs: tuple[Leg, ...]
    antennae: tuple[Antenna, ...]
    mouth: Mouth
    wings: tuple[Wing, ...]
    ocelli: tuple[tuple[float, float], ...]
    health_bar: FloatArray

    @classmethod
    def from_css(cls) -> BeeAnatomy:
        """Baut die Biene aus den Maßen von ``bee.css``."""
        head_center = scaled((0.0, 10.5, 30.0))
        head = Ellipsoid(head_center, scaled((15.6, 15.0, 15.0)))
        segments = tuple(
            Ellipsoid(
                scaled(css(SEGMENT_START + SEGMENT_SPACING * index, 25.0)),
                scaled((20.0 * scale, 20.0 * scale, 20.0 * scale * stretch)),
            )
            for index, (scale, stretch) in enumerate(zip(SEGMENT_SCALES, SEGMENT_STRETCH, strict=True))
        )
        return cls(
            head=head,
            cheeks=tuple(
                Ellipsoid(head_center + 11.5 * PX * direction(40.0 * side, -22.0), scaled((5.5, 4.5, 5.0)))
                for side in (1.0, -1.0)
            ),
            eyes=_eyes(head_center),
            neck=Ellipsoid(scaled((0.0, 4.5, 19.0)), scaled((10.5, 10.0, 9.0))),
            thorax=Ellipsoid(scaled(css(40.0, 25.0)), scaled((19.5, 19.0, 19.5))),
            waist=Ellipsoid(scaled((0.0, -0.5, -6.0)), scaled((11.5, 11.5, 8.0))),
            segments=segments,
            stinger=_stinger(),
            legs=_legs(),
            antennae=_antennae(),
            mouth=Mouth(),
            wings=tuple(
                Wing(
                    name,
                    scaled((6.0 * side, 16.5, 3.0)),
                    side,
                    forewing=WingLobe(54.3 * PX, 15.0 * PX),
                    hindwing=WingLobe(33.0 * PX, 10.0 * PX, offset=scaled((1.5, -0.6, -4.0)), sweep_degrees=14.0),
                    sweep_degrees=35.0,
                    raise_degrees=28.0,
                )
                for name, side in (("Wing_L", 1.0), ("Wing_R", -1.0))
            ),
            ocelli=((0.0, 17.6), (2.3, 16.0), (-2.3, 16.0)),
            health_bar=scaled((0.0, 44.0, 0.0)),
        )

    @property
    def head_radius(self) -> float:
        """Mittlerer Kopfradius (Bezug für Bogenpixel im Gesicht)."""
        return float(self.head.radii[1])

    def band_edges(self) -> FloatArray:
        """Bandgrenzen des Hinterleibs entlang z (m), von vorn nach hinten, plus Hinterleibsende."""
        front = [self.thorax, self.waist]
        edges = []
        for segment in self.segments:
            edges.append(_emergence(segment, front))
            front.append(segment)
        last = self.segments[-1]
        return np.array([*edges, last.center[2] - last.radii[2]])

    def face_direction(self, u: float | FloatArray, v: float | FloatArray) -> FloatArray:
        """Richtung von der Kopfmitte zu Bogenpixeln (u quer, v hoch) um die Gesichtsmitte."""
        radius = self.head_radius
        u = np.asarray(u, dtype=np.float64) * PX / radius
        v = np.asarray(v, dtype=np.float64) * PX / radius
        return np.stack([np.sin(u) * np.cos(v), np.sin(v), np.cos(u) * np.cos(v)], axis=-1)


def _radius_at(ball: Ellipsoid, z: FloatArray) -> FloatArray:
    t = (np.asarray(z, dtype=np.float64) - ball.center[2]) / ball.radii[2]
    return ball.radii[1] * np.sqrt(np.clip(1.0 - t * t, 0.0, None))


def _emergence(segment: Ellipsoid, front: Sequence[Ellipsoid]) -> float:
    """Stelle z, an der ``segment`` hinter den vorderen Teilen aus der Hülle tritt."""
    z = np.linspace(segment.center[2] + segment.radii[2], segment.center[2] - segment.radii[2], 4001)
    envelope = np.max([_radius_at(ball, z) for ball in front], axis=0)
    own = _radius_at(segment, z)
    emerging = np.nonzero((own[1:] > envelope[1:]) & (own[:-1] <= envelope[:-1]))[0]
    if len(emerging) == 0:
        raise ValueError("Ein Hinterleibsring tritt nicht aus der Hülle der vorderen Teile.")
    return float(z[int(emerging[0]) + 1])


def _eyes(head_center: FloatArray) -> tuple[Eye, ...]:
    # Große runde Augen oben vorn, dicht beieinander wie im Vorbild, weich in den Kopf gebettet.
    # Pupillen blicken leicht nach oben und zur Gesichtsmitte: freundlich, ein wenig verschmitzt.
    eyes = []
    for name, side in (("Eye_L", 1.0), ("Eye_R", -1.0)):
        outward = direction(27.0 * side, 19.0)
        eyes.append(
            Eye(
                name,
                center=head_center + 12.3 * PX * outward,
                radius=6.0 * PX,
                outward=outward,
                gaze=direction(12.0 * side, 23.0),
                pupil_degrees=31.0,
            )
        )
    return tuple(eyes)


def _stinger() -> Tube:
    path = scaled([(0.0, -0.5, -55.0), (0.0, -1.1, -68.0), (0.0, -1.9, -81.0), (0.0, -3.0, -95.0)])
    return Tube("Stinger", path, np.array([5.0, 3.6, 2.0, 0.35]) * PX)


def _legs() -> tuple[Leg, ...]:
    # Linke Seite in Pixeln: Hüfte unter Brust bzw. Taille, Knie außen, Fußgelenk, Zehe leicht nach vorn
    left = {
        "Leg_Front": ((6.0, -14.0, 19.0), (12.5, -20.5, 25.0), (13.5, -27.5, 22.0), (14.0, -30.0, 25.0)),
        "Leg_Middle": ((7.0, -16.0, 8.0), (14.0, -21.5, 8.0), (15.0, -28.5, 3.5), (15.5, -31.0, 6.5)),
        "Leg_Hind": ((6.0, -14.0, -3.0), (13.0, -20.0, -11.0), (14.0, -27.5, -16.0), (14.5, -30.0, -13.0)),
    }
    legs = []
    for name, joints in left.items():
        points = scaled(joints)
        for suffix, side_points in (("_L", points), ("_R", mirrored(points))):
            # CSS: Schenkel 5 px, Schiene 3 px stark; Hinterbeine mit breiterer Schiene
            tibia = 1.9 if name == "Leg_Hind" else 1.6
            legs.append(Leg(name + suffix, side_points, 2.5 * PX, tibia * PX, 1.15 * PX))
    return tuple(legs)


def _antennae() -> tuple[Antenna, ...]:
    # Linker Fühler in Pixeln: Ansatz im Scheitel, Schaft nach oben, Knick, Geißel nach vorn zur Kugel
    path = scaled(
        [
            (4.2, 23.5, 33.1),
            (4.8, 28.0, 33.4),
            (5.5, 32.0, 34.0),
            (6.1, 34.3, 35.6),
            (6.8, 35.1, 38.6),
            (7.6, 34.5, 41.8),
            (8.2, 33.1, 44.5),
            (8.5, 32.0, 46.0),
        ]
    )
    return (
        Antenna("Antenna_L", path, 3, 1.5 * PX, 3.5 * PX, 9),
        Antenna("Antenna_R", mirrored(path), 3, 1.5 * PX, 3.5 * PX, 9),
    )
