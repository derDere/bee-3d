"""Distanzfelder von Rumpf und Kopfkapsel der Fliege (Felder).

Der Rumpf vereinigt Brust (Rückenschild, Schildchen, Schulterbeulen, Flanken, Hinterrücken,
Halsstummel) und Hinterleib mit eigenen Übergangsbreiten. Der Hinterleib trägt ein Profil aus
Rückenplatten: Die Vorderkante jeder Platte taucht unter die vorige, die Hinterkante steht als
Wulst über; mit ``bloat`` werden die Platten zu erhabenen Schilden auf gedehnter, eingesunkener
Zwischenhaut. Die Kopfkapsel hat einen flachen Hinterkopf, eine Gesichtsplatte mit zwei
Fühlerrinnen, Wangen, einen Scheitelhöcker und eine Mundhöhle für den Rüssel. Augen, Fühler und
Rüssel sind eigene Teile.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from modelkit.sdf import Aabb, Ellipsoid, Sdf, smooth_min
from modelkit.shading import smoothstep

from flykit.anatomy import FlyAnatomy

type FloatArray = npt.NDArray[np.float64]
type IntArray = npt.NDArray[np.int64]

EYE_INSET = 0.035  # Referenz-mm: Augenlager der Kopfkapsel liegen so tief unter der Augenkappe

TUCK = 0.03  # Vorderkante einer Platte taucht um diesen Anteil des Radius unter die vorige
LIP = 0.016  # Hinterkante steht um diesen Anteil als Wulst über
EDGE_SOFTNESS = 0.05  # Anteil der Bandbreite, über den die Stufe an der Plattenkante verläuft
PLATE_RISE = 0.028  # gedehnter Hinterleib: Platten erhaben
MEMBRANE_SINK = 0.04  # gedehnter Hinterleib: Zwischenhaut eingesunken
PLATE_SHARE = 0.8  # gedehnter Hinterleib: Anteil der Platte an einem Band


def smooth_max(a: FloatArray, b: FloatArray, k: float) -> FloatArray:
    """Weiches Maximum (glatte Schnittmenge zweier Felder)."""
    return -smooth_min(-a, -b, k)


@dataclass(frozen=True, slots=True)
class BandSample:
    """Lage auf dem Hinterleib: Plattenindex (−1 außerhalb) und Anteil im Band (Bandlage)."""

    index: IntArray
    fraction: FloatArray


class BodyField(Sdf):
    """Distanzfeld von Brust, Hinterleib und Halsstummel ohne Glieder (Rumpffeld)."""

    def __init__(self, anatomy: FlyAnatomy) -> None:
        self._anatomy = anatomy
        self._unit = anatomy.unit

    @property
    def anatomy(self) -> FlyAnatomy:
        """Die zugrunde liegende Anatomie."""
        return self._anatomy

    def bands(self, points: FloatArray) -> BandSample:
        """Platte und Lage im Band entlang der Längsachse des Hinterleibs (Grenzen absteigend)."""
        edges = self._anatomy.abdomen.band_edges
        z = self._anatomy.abdomen.axial(points)
        index = np.searchsorted(-edges, -z, side="right") - 1
        inside = (index >= 0) & (index < len(edges) - 1)
        safe = np.clip(index, 0, len(edges) - 2)
        fraction = (edges[safe] - z) / (edges[safe] - edges[safe + 1])
        return BandSample(np.where(inside, safe, -1), np.where(inside, fraction, 0.0))

    def _plate_mask(self, band: BandSample) -> FloatArray:
        """Gedehnter Hinterleib: 1 auf der Platte, 0 auf der Zwischenhaut dahinter (letzte Platte ohne Haut)."""
        t = band.fraction
        last = len(self._anatomy.abdomen.band_edges) - 2
        front = smoothstep(0.02, 0.1, t)
        plate = front * (1.0 - smoothstep(PLATE_SHARE - 0.06, PLATE_SHARE, t))
        return np.where(band.index < last, plate, front)

    def plate_profile(self, band: BandSample) -> FloatArray:
        """Radiale Auslenkung (Anteil des Radius) der Rückenplatten; positiv = erhaben."""
        t = band.fraction
        last = len(self._anatomy.abdomen.band_edges) - 2
        tight = -TUCK * (1.0 - t) ** 2.2 + np.where(band.index < last, LIP * t**3, 0.0)
        step = np.where(band.index < last, smoothstep(1.0 - EDGE_SOFTNESS, 1.0, t), 0.0)
        tight = tight * (1.0 - step) - TUCK * step
        plate = self._plate_mask(band)
        bloated = PLATE_RISE * plate - MEMBRANE_SINK * (1.0 - plate)
        bloat = self._anatomy.abdomen.bloat
        return np.where(band.index >= 0, (1.0 - bloat) * tight + bloat * bloated, 0.0)

    def membrane_weight(self, points: FloatArray) -> FloatArray:
        """Anteil sichtbarer Zwischenhaut (0 = Platte, 1 = Zwischenhaut) — für die Bemalung."""
        band = self.bands(points)
        membrane = np.where(band.index >= 0, 1.0 - self._plate_mask(band), 0.0)
        return membrane * self._anatomy.abdomen.bloat

    def thorax_distance(self, points: FloatArray) -> FloatArray:
        """Brust aus Rückenschild, Schildchen, Schulterbeulen, Flanken, Hinterrücken und Halsstummel."""
        thorax, unit = self._anatomy.thorax, self._unit
        distance = smooth_min(thorax.scutum.distance(points), thorax.scutellum.distance(points), 0.35 * unit)
        for humerus in thorax.humeri:
            distance = smooth_min(distance, humerus.distance(points), 0.4 * unit)
        for pleuron in thorax.pleura:
            distance = smooth_min(distance, pleuron.distance(points), 0.5 * unit)
        distance = smooth_min(distance, thorax.postnotum.distance(points), 0.45 * unit)
        return smooth_min(distance, thorax.neck.distance(points), 0.3 * unit)

    def abdomen_distance(self, points: FloatArray) -> FloatArray:
        """Hinterleib mit dem Profil der Rückenplatten."""
        abdomen = self._anatomy.abdomen.ellipsoid
        profile = self.plate_profile(self.bands(points))
        return abdomen.distance(points) - profile * float(abdomen.radii[1])

    def distance(self, points: FloatArray) -> FloatArray:
        return smooth_min(self.thorax_distance(points), self.abdomen_distance(points), 0.55 * self._unit)

    def bounds(self) -> Aabb:
        thorax, abdomen = self._anatomy.thorax, self._anatomy.abdomen
        parts = [thorax.scutum, thorax.scutellum, *thorax.humeri, *thorax.pleura, thorax.postnotum, thorax.neck, abdomen.ellipsoid]
        box = parts[0].bounds()
        for part in parts[1:]:
            box = box.union(part.bounds())
        return box.padded(0.25 * self._unit)


class HeadField(Sdf):
    """Distanzfeld der Kopfkapsel ohne Augen, Fühler und Rüssel (Kopffeld)."""

    def __init__(self, anatomy: FlyAnatomy) -> None:
        self._anatomy = anatomy
        self._unit = anatomy.unit

    @property
    def anatomy(self) -> FlyAnatomy:
        """Die zugrunde liegende Anatomie."""
        return self._anatomy

    def capsule_distance(self, points: FloatArray) -> FloatArray:
        """Kapsel mit flachem Hinterkopf, Gesicht, Wangen, Scheitel und Augenlagern (ohne Rinnen und Mundhöhle).

        Die Augenlager sind die um ``EYE_INSET`` geschrumpften Augenellipsoide: Die Kapsel liegt
        dicht unter jeder Augenkappe und setzt sich hinter dem Kappenrand als Augenrand fort.
        """
        head, unit = self._anatomy.head, self._unit
        distance = smooth_max(head.core.distance(points), head.back_z - points[:, 2], 0.25 * unit)
        distance = smooth_min(distance, head.face.distance(points), 0.3 * unit)
        for gena in head.genae:
            distance = smooth_min(distance, gena.distance(points), 0.35 * unit)
        distance = smooth_min(distance, head.vertex.distance(points), 0.25 * unit)
        for eye in self._anatomy.eyes:
            bed = Ellipsoid(eye.center, eye.radii - EYE_INSET * unit, eye.frame)
            distance = smooth_min(distance, bed.distance(points), 0.1 * unit)
        return distance

    def distance(self, points: FloatArray) -> FloatArray:
        head, unit = self._anatomy.head, self._unit
        distance = self.capsule_distance(points)
        for groove in head.grooves:
            distance = smooth_max(distance, -groove.distance(points), 0.08 * unit)
        return smooth_max(distance, -head.mouth.distance(points), 0.12 * unit)

    def bounds(self) -> Aabb:
        head = self._anatomy.head
        box = head.core.bounds()
        for part in (head.face, *head.genae, head.vertex):
            box = box.union(part.bounds())
        for eye in self._anatomy.eyes:
            box = box.union(Ellipsoid(eye.center, eye.radii, eye.frame).bounds())
        return box.padded(0.2 * self._unit)
