"""Maße und Proportionen des Bienenstocks (Grundriss).

Alle Maße in Metern; Ursprung im Mittelpunkt des Strohkorbs, +Y oben, das Flugloch zeigt nach +Z.
Meridiankurven sind als (Radius, Höhe) notiert. Die Spielerbiene ist 0,2 m lang — Laternen,
Honigtöpfchen und Wimpel haben Bienenmaßstab, Korb, Waben und Halle den Maßstab einer Station.

Proportionsliste:

| Teil | Maß |
|---|---|
| Gesamthöhe | ~18,7 m (Leuchtschale auf dem Mast +7,2 bis Tropfen unter der längsten Wabe −11,5) |
| Strohkorb | Glocke 14,2 m breit (größter Radius 7,1 m bei y ≈ −2,8), Knauf bis y ≈ 5,95 |
| Wulstringe | Randwulst + 16 Strohwülste, Steigung ~0,81 m, Wulsthöhe 0,28 m |
| Flugloch | Ø 2,8 m bei y = −2,75 in +Z, Holzrahmen 0,48 m breit |
| Anflugbrett | 4,4 m breit, ragt 2,75 m vor den Korb, Oberkante bündig mit der Lochunterkante |
| Naturwaben | 7 Waben in Ebenen z = const (Abstand 1,05 m, 0,72 m dick), mittlere 7,8 × 6 m |
| Wabenzellen | außen 0,6 m, Halle 0,56 m, Kronleuchter 0,4 m (Schlüsselweite) |
| Wabenhalle | Kuppel Ø 11,8 m, Boden y = −4,25, Scheitel y ≈ 4,3; Galerien bei −1,1 und +1,75 |
| Biene | 0,2 m — Andockpunkt 3 m vor dem Loch, Schwebepunkt 2,2 m über dem Hallenboden |
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import cached_property

import numpy as np
import numpy.typing as npt

from hivekit.profiles import ProfileCurve

type FloatArray = npt.NDArray[np.float64]

# Rillenkurve des Strohkorbs (Grund zwischen den Wülsten) oberhalb des Randwulstes, aufwärts zur Achse
_SKEP_GROOVES: tuple[tuple[float, float], ...] = (
    (6.62, -4.30),
    (6.80, -3.50),
    (6.84, -2.55),
    (6.74, -1.40),
    (6.48, -0.10),
    (6.04, 1.20),
    (5.40, 2.40),
    (4.55, 3.40),
    (3.48, 4.25),
    (2.25, 4.85),
    (1.05, 5.15),
    (0.30, 5.22),
)

# Wand der Wabenhalle (Oberfläche der Zellränder), vom Boden aufwärts zum Scheitel
_HALL_WALL: tuple[tuple[float, float], ...] = (
    (5.72, -4.75),
    (5.86, -3.60),
    (5.92, -2.60),
    (5.84, -1.40),
    (5.60, -0.20),
    (5.20, 0.95),
    (4.62, 2.00),
    (3.80, 2.95),
    (2.75, 3.70),
    (1.55, 4.15),
    (0.40, 4.32),
)


@dataclass(frozen=True, slots=True)
class CombSpec:
    """Eine hängende Naturwabe in der Ebene z = const (Wabe)."""

    z: float
    half_width: float
    length: float
    tip_shift: float
    seed: int


@dataclass(frozen=True, slots=True)
class DoorwaySpec:
    """Bogentür in der Hallenwand: Mitte als Azimut (Grad, 0 = +Z), Fußhöhe, Breite, Höhe (Tür)."""

    azimuth: float
    base: float
    width: float
    height: float


@dataclass(frozen=True)
class HiveLayout:
    """Grundriss des Bienenstocks: Kurven, Teilmaße und Ankerpunkte (Grundriss)."""

    # Strohkorb
    rim_center: tuple[float, float] = (6.08, -5.22)
    rim_radius: float = 0.46
    rim_groove_degrees: float = 50.0
    rim_inner_degrees: float = 195.0
    coil_pitch: float = 0.82
    coil_bulge: float = 0.28
    knob_radius: float = 1.3
    knob_top: float = 5.95
    mast_top: float = 7.0
    # Flugloch und Anflugbrett
    entrance_height: float = -2.75
    entrance_radius: float = 1.4
    frame_width: float = 0.48
    frame_protrusion: float = 0.14
    board_half_width: float = 2.2
    board_front: float = 9.7
    board_back: float = 6.2
    board_thickness: float = 0.18
    # Bodenplatte und Naturwaben (Abstand 1,05 m bei 0,72 m Dicke: schmale Gassen wie im Wildbau)
    base_plate_sag: float = 0.42
    comb_thickness: float = 0.72
    comb_top: float = -5.2
    comb_cell: float = 0.6
    combs: tuple[CombSpec, ...] = (
        CombSpec(0.0, 3.9, 6.0, 0.25, 11),
        CombSpec(1.05, 3.7, 5.5, -0.3, 12),
        CombSpec(-1.05, 3.7, 5.4, 0.35, 13),
        CombSpec(2.1, 3.3, 4.6, 0.2, 14),
        CombSpec(-2.1, 3.25, 4.5, -0.25, 15),
        CombSpec(3.15, 2.6, 3.5, 0.15, 16),
        CombSpec(-3.15, 2.55, 3.4, -0.2, 17),
    )
    # Wabenhalle
    floor_height: float = -4.25
    pool_radius: float = 1.9
    gallery_heights: tuple[float, float] = (-1.1, 1.75)
    gallery_depth: float = 1.15
    hall_cell: float = 0.56
    pillar_count: int = 8
    pillar_inset: float = 0.3
    dome_bulge: float = 0.22
    doorways: tuple[DoorwaySpec, ...] = field(
        default=(
            DoorwaySpec(180.0, -4.25, 1.7, 2.2),
            DoorwaySpec(135.0, -4.25, 1.6, 2.1),
            DoorwaySpec(225.0, -4.25, 1.6, 2.1),
            DoorwaySpec(90.0, -1.1, 1.3, 1.75),
            DoorwaySpec(270.0, -1.1, 1.3, 1.75),
        )
    )

    # Kurven ---------------------------------------------------------------------------------

    @cached_property
    def rim_groove(self) -> FloatArray:
        """Rille zwischen Randwulst und erstem Strohwulst (Radius, Höhe)."""
        angle = np.radians(self.rim_groove_degrees)
        return np.asarray(self.rim_center) + self.rim_radius * np.array([np.cos(angle), np.sin(angle)])

    @cached_property
    def rim_inner(self) -> FloatArray:
        """Innenkante des Randwulstes, an der die Bodenplatte ansetzt (Radius, Höhe)."""
        angle = np.radians(self.rim_inner_degrees)
        return np.asarray(self.rim_center) + self.rim_radius * np.array([np.cos(angle), np.sin(angle)])

    @cached_property
    def groove_curve(self) -> ProfileCurve:
        """Rillenkurve des Strohkorbs vom Randwulst bis zur Achse."""
        return ProfileCurve.through(((float(self.rim_groove[0]), float(self.rim_groove[1])), *_SKEP_GROOVES))

    @cached_property
    def envelope_curve(self) -> ProfileCurve:
        """Hüllkurve über die Wulstscheitel (Außenseite des Korbs)."""
        return self.groove_curve.offset(self.coil_bulge)

    @cached_property
    def hall_curve(self) -> ProfileCurve:
        """Wand der Wabenhalle (Zellränder) vom Boden bis zum Scheitel."""
        return ProfileCurve.through(_HALL_WALL)

    def envelope_radius(self, y: FloatArray | float) -> FloatArray:
        """Radius der Korbaußenseite (Wulstscheitel) bei Höhe ``y``."""
        return self.envelope_curve.radius_at_height(y)

    def surface_radius(self, y: FloatArray | float) -> FloatArray:
        """Mittlerer Radius der Strohoberfläche bei Höhe ``y`` (zwischen Rille und Scheitel)."""
        return 0.5 * (self.groove_curve.radius_at_height(y) + self.envelope_radius(y))

    def hall_radius(self, y: FloatArray | float) -> FloatArray:
        """Radius der Hallenwand bei Höhe ``y``."""
        return self.hall_curve.radius_at_height(y)

    def base_plate_height(self, radius: FloatArray | float) -> FloatArray:
        """Unterseite der Bodenplatte: flache Kuppel nach unten zwischen Randwulst und Mitte."""
        edge_radius, edge_height = float(self.rim_inner[0]), float(self.rim_inner[1])
        t = np.clip(np.asarray(radius, dtype=np.float64) / edge_radius, 0.0, 1.0)
        return edge_height - self.base_plate_sag * (1.0 - t * t)

    # Ankerpunkte ----------------------------------------------------------------------------

    @cached_property
    def entrance_point(self) -> FloatArray:
        """Mitte des Fluglochs in der Vorderfläche des Rahmens."""
        front = float(self.envelope_radius(self.entrance_height)) + self.frame_protrusion
        return np.array([0.0, self.entrance_height, front])

    @cached_property
    def dock_point(self) -> FloatArray:
        """Andockpunkt 3 m vor dem Flugloch."""
        return self.entrance_point + np.array([0.0, 0.0, 3.0])

    @cached_property
    def hangar_point(self) -> FloatArray:
        """Schwebeposition der angedockten Biene über dem Honigbecken."""
        return np.array([0.0, self.floor_height + 2.2, 0.9])

    @cached_property
    def hangar_camera(self) -> FloatArray:
        """Kameraposition in der Halle, schräg vorn links unterhalb der Biene."""
        return np.array([-0.95, self.floor_height + 1.62, 3.05])

    @cached_property
    def beacon_point(self) -> FloatArray:
        """Leuchtfeuer über der Wachsschale auf dem Mast."""
        return np.array([0.0, self.mast_top + 0.3, 0.0])

    def look_rotation(self, eye: FloatArray, target: FloatArray) -> FloatArray:
        """Drehmatrix (lokal → Welt), deren lokale +Z-Achse von ``eye`` auf ``target`` zeigt, +Y nach oben."""
        forward = (target - eye) / np.linalg.norm(target - eye)
        right = np.cross(np.array([0.0, 1.0, 0.0]), forward)
        right /= np.linalg.norm(right)
        up = np.cross(forward, right)
        return np.stack([right, up, forward], axis=1)
