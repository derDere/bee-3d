"""Außenhülle des Bienenstocks: Strohkorb, Bodenplatte, Naturwaben, Flugloch, Anflugbrett und Zierrat (Außenhülle).

Eine Detailstufe (``ExteriorDetail``) steuert Auflösung und Umfang: LOD0 mit Zellbechern,
Tropfen, Laternen, Töpfchen und Wimpeln; LOD1 (ab ~300 m) mit groben Wülsten, glatten Waben und
leuchtenden Honigflecken, einer dunklen Scheibe im Flugloch und den Leuchtpunkten der Laternen.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import manifold3d as m3d
import numpy as np
import numpy.typing as npt

from hivekit.combs import CombPalette, HangingComb, build_comb, face_surface, visible_regions
from hivekit.decor import (
    PENNANT_COLORS,
    PropParts,
    bunting,
    cylinder,
    hanging_lantern,
    honey_pot,
    mast,
    pennant,
    teardrop,
)
from hivekit.entrance import draped_ring, landing_board, lantern_post, skep_depth, tunnel_sleeve
from hivekit.honeycomb import CellKind, CellSet, CellStyle, HexLattice, build_cells, cells_inside, comb_outline
from hivekit.layout import HiveLayout
from hivekit.mesh import MeshPart, fan_cap, plank
from hivekit.skep import CoilSettings, CoilShell, base_plate, entrance_cutter, knob, rim_rope

type FloatArray = npt.NDArray[np.float64]

# Warmer Goldton des Strohs (Multiplikator der Strohtextur): weniger Blau, sattes Strohgold auch im Mittagslicht
STRAW_WARMTH = (1.0, 0.97, 0.88)


@dataclass(frozen=True, slots=True)
class ExteriorDetail:
    """Umfang und Auflösung der Außenhülle einer Detailstufe (Außendetail)."""

    coil: CoilSettings = field(
        default_factory=lambda: CoilSettings(cross_segments=5, chord=0.7, fine_chord=0.18, fine_half_angle=0.28)
    )
    cells: bool = True
    comb_samples: int = 22
    comb_rim_sides: int = 3
    base_rings: int = 7
    base_sides: int = 40
    frame_sides: int = 40
    frame_segments: tuple[int, int] = (1, 2)
    tunnel: bool = True
    props: bool = True
    bunting_detail: int = 14


@dataclass(frozen=True, slots=True)
class ExteriorParts:
    """Teile der Außenhülle nach Material (Außenteile)."""

    straw: list[MeshPart]
    props: PropParts


class ExteriorBuilder:
    """Baut die Außenhülle in einer Detailstufe (Außenbau)."""

    def __init__(self, layout: HiveLayout, detail: ExteriorDetail, seed: int) -> None:
        self._layout = layout
        self._detail = detail
        self._rng = np.random.default_rng(seed)
        self._parts = PropParts.empty()
        self._straw: list[MeshPart] = []

    def build(self) -> ExteriorParts:
        """Alle Teile der Außenhülle."""
        self._skep()
        self._combs()
        self._entrance()
        self._top()
        if self._detail.props:
            self._decor()
        else:
            self._beacons()
        return ExteriorParts(self._straw, self._parts)

    # Strohkorb ----------------------------------------------------------------------------------

    def _skep(self) -> None:
        layout, detail = self._layout, self._detail
        curve = layout.groove_curve
        end = float(
            curve.arc[
                np.argmin(np.abs(curve.points[:, 0] - (layout.knob_radius - 0.25)) + (curve.points[:, 1] < 3.0) * 100.0)
            ]
        )
        reach = layout.entrance_radius + layout.frame_width + 0.25

        def near_entrance(lower: FloatArray, upper: FloatArray) -> bool:
            low, high = min(lower[1], upper[1]), max(lower[1], upper[1])
            return high > layout.entrance_height - reach and low < layout.entrance_height + reach

        shell = CoilShell.along_curve(
            curve, 0.0, end, layout.coil_pitch, layout.coil_bulge, 1.0, detail.coil, self._rng, near_entrance
        )
        clearance = 0.25 if detail.tunnel else 0.12
        straw = [
            *shell.meshes(entrance_cutter(layout, clearance), first_skirt=True, last_skirt=True),
            rim_rope(layout, detail.coil, self._rng),
            knob(layout, detail.coil),
        ]
        self._straw.extend(part.tinted(STRAW_WARMTH) for part in straw)
        plate = base_plate(layout, detail.base_rings, detail.base_sides, 1.2)
        self._parts.wax.append(plate.tinted(np.array([0.86, 0.56, 0.26])))

    # Naturwaben ---------------------------------------------------------------------------------

    def _combs(self) -> None:
        layout, detail = self._layout, self._detail
        combs = []
        for spec in layout.combs:
            outline = comb_outline(
                spec.half_width,
                spec.length,
                layout.comb_top,
                spec.tip_shift,
                detail.comb_samples,
                np.random.default_rng(spec.seed),
                0.07,
            )
            combs.append(HangingComb(outline, spec.z, layout.comb_thickness, layout.comb_top, spec.length))

        def ceiling(x: FloatArray, z: float) -> FloatArray:
            return layout.base_plate_height(np.hypot(x, z))

        regions = visible_regions(combs, ceiling, 0.05, 0.15, 0.35)
        lattice = HexLattice(layout.comb_cell)
        palette = CombPalette()
        for comb, comb_regions in zip(combs, regions, strict=True):
            if detail.cells:
                meshes = build_comb(comb, comb_regions, lattice, CellStyle(), palette, detail.comb_rim_sides, self._rng)
                self._parts.wax.append(meshes.wax)
                self._parts.honey.append(meshes.honey)
                self._drips(comb)
            else:
                meshes = build_comb(comb, {}, lattice, CellStyle(), palette, detail.comb_rim_sides, self._rng)
                self._parts.wax.append(meshes.wax)
                self._honey_patches(comb, comb_regions)

    def _drips(self, comb: HangingComb) -> None:
        """Wachs- und Honigtropfen am unteren Wabenrand."""
        rim = comb.outline.rim
        low = rim[rim[:, 1] < rim[:, 1].min() + 0.3 * comb.length]
        chosen = low[self._rng.choice(len(low), size=min(len(low), 2), replace=False)]
        for point in chosen:
            for side in (-0.2, 0.2):
                top = np.array([point[0], point[1] + 0.05, comb.plane_z + side * comb.thickness])
                size = self._rng.uniform(0.6, 1.25)
                drop = teardrop(top, 0.42 * size, 0.09 * size, 6)
                if self._rng.uniform() < 0.45:
                    self._parts.honey.append(drop)
                else:
                    self._parts.wax.append(drop.tinted(np.array([1.0, 0.92, 0.75])))

    def _honey_patches(self, comb: HangingComb, regions: dict[float, m3d.CrossSection | None]) -> None:
        """LOD1: leuchtende Honigsechsecke knapp vor den sichtbaren Wabenflächen."""
        lattice = HexLattice(0.85)
        for side, region in regions.items():
            if region is None or region.is_empty():
                continue
            x_min, y_min, x_max, y_max = region.bounds()
            centers = lattice.centers((x_min, y_min), (x_max, y_max), self._rng.uniform(0.0, 1.0, 2))
            centers = centers[cells_inside(lattice, centers, region)]
            centers = centers[self._rng.uniform(0.0, 1.0, len(centers)) < 0.6]
            if len(centers) == 0:
                continue
            surface = face_surface(comb, side)
            cells = CellSet(
                centers,
                tuple(CellKind.FLAT for _ in centers),
                np.zeros(len(centers)),
                np.zeros(len(centers)),
                np.ones((len(centers), 3)),
            )
            patches = build_cells(surface, HexLattice(0.68), cells, CellStyle(), self._rng).wax
            normal = surface.normal(centers[:1])[0]
            self._parts.honey.append(patches.transformed(None, 0.01 * normal))

    # Flugloch und Anflugbrett -------------------------------------------------------------------

    def _entrance(self) -> None:
        layout, detail = self._layout, self._detail
        depth = skep_depth(layout)
        frame = draped_ring(
            layout.entrance_height,
            layout.entrance_radius - 0.02,
            layout.entrance_radius + layout.frame_width,
            depth,
            layout.frame_protrusion,
            0.32,
            1.0,
            detail.frame_sides,
            detail.frame_segments,
        )
        self._parts.wood.append(frame)
        if detail.tunnel:
            self._parts.wood.append(tunnel_sleeve(layout, 40, 4))
            self._parts.wood.extend(landing_board(layout, 5))
        else:
            angles = np.linspace(0.0, 2.0 * np.pi, detail.frame_sides, endpoint=False)
            ring_x = layout.entrance_radius * np.cos(angles)
            ring_y = layout.entrance_height + layout.entrance_radius * np.sin(angles)
            ring = np.stack([ring_x, ring_y, depth(ring_x, ring_y) - 0.25], axis=1)
            center = np.array(
                [0.0, layout.entrance_height, float(depth(np.zeros(1), np.full(1, layout.entrance_height))[0]) - 0.35]
            )
            self._parts.wax.append(fan_cap(ring, center, (0.0, 0.0, 1.0), 1.0).tinted(np.full(3, 0.05)))
            top = layout.entrance_height - layout.entrance_radius - 0.02
            back = float(depth(np.zeros(1), np.full(1, top))[0]) - 0.35
            self._parts.wood.append(
                plank(
                    np.array([0.0, top - 0.09, back]),
                    np.array([0.0, top - 0.09, layout.board_front]),
                    (0.0, 1.0, 0.0),
                    2 * layout.board_half_width,
                    layout.board_thickness,
                    0.05,
                    1.0,
                )
            )

    # Knauf, Mast, Leuchtschale -----------------------------------------------------------------

    def _top(self) -> None:
        if self._detail.props:
            self._parts.extend(mast(self._layout, self._rng))
            return
        layout = self._layout
        self._parts.wood.append(
            cylinder(np.array([0.0, layout.knob_top - 0.35, 0.0]), np.array([0.0, layout.mast_top, 0.0]), 0.09, 5, 2.0)
        )
        self._parts.honey.append(teardrop(np.array([0.0, layout.mast_top + 0.32, 0.0]), 0.38, 0.2, 5, samples=4))

    # Zierrat ------------------------------------------------------------------------------------

    def _decor(self) -> None:
        layout, rng = self._layout, self._rng
        depth = skep_depth(layout)
        # Laternen am Flugloch, an Haken im Stroh
        for side in (-1.0, 1.0):
            x, y = side * 2.35, layout.entrance_height + 1.0
            surface_z = float(depth(np.array([x]), np.array([y]))[0])
            anchor = np.array([x, y, surface_z + 0.28])
            self._parts.wood.append(
                plank(
                    np.array([x, y + 0.02, surface_z - 0.15]),
                    anchor + np.array([0.0, 0.03, 0.0]),
                    (0.0, 1.0, 0.0),
                    0.07,
                    0.07,
                    0.02,
                    2.0,
                )
            )
            self._parts.extend(hanging_lantern(anchor, 0.22, 0.34, rng))
        # Laternenpfosten mit Wimpeln an den vorderen Brettecken
        board_top = layout.entrance_height - layout.entrance_radius - 0.02
        for side in (-1.0, 1.0):
            base = np.array([side * (layout.board_half_width - 0.25), board_top, layout.board_front - 0.35])
            wood, hook, tip = lantern_post(base, 1.15, 0.34, side)
            self._parts.wood.append(wood)
            self._parts.extend(hanging_lantern(hook, 0.1, 0.3, rng))
            flag = pennant(
                tip - np.array([0.0, 0.04, 0.0]),
                tip - np.array([0.0, 0.26, 0.0]),
                np.array([side * 0.5, 0.0, 0.85]),
                0.55,
                0.05,
                rng.uniform(0, 6.28),
            )
            self._parts.cloth.append(flag.tinted(PENNANT_COLORS[0] if side < 0 else PENNANT_COLORS[1]))
        # Honigtöpfchen auf dem Brett, seitlich der Flugbahn
        for x, z, size in ((-1.55, 7.55, 0.3), (-1.85, 8.05, 0.22), (1.5, 7.45, 0.27), (1.78, 7.95, 0.2)):
            self._parts.extend(honey_pot(np.array([x, board_top, z]), size, rng))
        # Laternen unter dem Randwulst und Tropfen am Rand
        rim_radius, rim_height = layout.rim_center[0] + 0.1, layout.rim_center[1] - layout.rim_radius
        for angle in np.radians([35.0, 90.0, 150.0, 210.0, 270.0, 325.0]):
            anchor = np.array([rim_radius * np.sin(angle), rim_height + 0.06, rim_radius * np.cos(angle)])
            self._parts.extend(hanging_lantern(anchor, rng.uniform(0.45, 0.8), 0.36, rng))
        for angle in rng.uniform(np.radians(40.0), np.radians(320.0), 10):
            radius = layout.rim_center[0] + rng.uniform(-0.15, 0.25)
            top = np.array([radius * np.sin(angle), rim_height + 0.08, radius * np.cos(angle)])
            size = rng.uniform(0.6, 1.2)
            drop = teardrop(top, 0.38 * size, 0.08 * size, 6)
            if rng.uniform() < 0.5:
                self._parts.honey.append(drop)
            else:
                self._parts.wax.append(drop.tinted(np.array([1.0, 0.9, 0.7])))
        self._parts.extend(bunting(layout, 0.55, 12, 0.5, PENNANT_COLORS, rng, self._detail.bunting_detail))

    def _beacons(self) -> None:
        """LOD1: Leuchtpunkte der Laternen und eine Wimpelkette mit wenigen Stützpunkten."""
        layout, rng = self._layout, self._rng
        rim_radius, rim_height = layout.rim_center[0] + 0.1, layout.rim_center[1] - layout.rim_radius
        for angle in np.radians([35.0, 90.0, 150.0, 210.0, 270.0, 325.0]):
            hook = np.array([rim_radius * np.sin(angle), rim_height - 0.45, rim_radius * np.cos(angle)])
            self._parts.honey.append(teardrop(hook, 0.42, 0.2, 4, samples=4))
        self._parts.extend(bunting(layout, 0.55, 12, 0.5, PENNANT_COLORS, rng, self._detail.bunting_detail, pegs=False))
