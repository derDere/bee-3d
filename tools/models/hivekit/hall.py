"""Wabenhalle hinter dem Flugloch: Zellwände, Boden mit Honigbecken, Galerien, Säulen, Kuppel, Türen (Wabenhalle).

Die Wand ist ein umlaufendes Sechseckgitter mit ganzzahliger Zellzahl je Reihe; jede Zelle ist
ein Becher (leer oder mit leuchtendem Honig), ein Deckel oder — hinter Säulen, an Galerien und
am Boden — eine glatte Füllfläche. Öffnungen (Flugloch, Türen) lassen Zellen aus; der Rest bis
zur Öffnungskante wird als Fläche trianguliert, die ein Holzrahmen fasst. Über der oberen
Galerie zeigt sich die Innenseite des Strohkorbs; acht Wachssäulen steigen als Rippen bis zum
Scheitel, an dem drei Kronleuchterwaben hängen. Eine dunkle Rückschale zwischen Halle und Korb
schließt jeden Durchblick auf die Außenhülle.

Farbgebung: dunkles, rötliches Altwachs an Wänden und Boden, helles Frischwachs an Säulen,
Galerien und Becken, golden leuchtender Honig als Lichtquelle; Banner, Wimpel und Blüten setzen
Farbtupfer, die Kammern hinter den Bogentüren glühen warm.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import manifold3d as m3d
import numpy as np
import numpy.typing as npt

from hivekit.combs import CombPalette, HangingComb, build_comb, visible_regions
from hivekit.decor import (
    BLOSSOM_COLORS,
    PENNANT_COLORS,
    PropParts,
    banner,
    blossom,
    hanging_garland,
    hanging_lantern,
    honey_pot,
    lathe,
    teardrop,
)
from hivekit.entrance import draped_ring, hall_depth
from hivekit.honeycomb import (
    CellKind,
    CellSet,
    CellStyle,
    HexLattice,
    PlaneSurface,
    build_cells,
    comb_outline,
    hexagon_union,
    polygon_contains,
    triangulated_region,
)
from hivekit.layout import DoorwaySpec, HiveLayout
from hivekit.mesh import MeshPart, grid_faces, normalized, plank, revolve, rounded_rectangle, sweep_section
from hivekit.profiles import ProfileCurve
from hivekit.skep import CoilSettings, CoilShell, entrance_cutter

type FloatArray = npt.NDArray[np.float64]
type BoolArray = npt.NDArray[np.bool_]

_WAX_TILE = 1.2
_WOOD_TILE = 1.0
# Wachstöne der Halle als lineare Multiplikatoren der Wachstextur
_OLD_WAX = np.array([0.82, 0.44, 0.2])  # dunkles, rötliches Altwachs: Zellwände und Füllflächen
_FLOOR_WAX = np.array([0.68, 0.36, 0.17])  # Wabenboden, noch dunkler
_FRESH_WAX = np.array([1.0, 0.84, 0.55])  # helles Frischwachs: Säulen, Beckenlippe, Nabe
_GALLERY_WAX = np.array([0.98, 0.74, 0.42])  # Galerien
_CAP_WAX = np.array([1.0, 0.9, 0.68])  # Zelldeckel
_HONEY_SHARE = 0.55  # Anteil der Wandzellen mit leuchtendem Honig
_CHAMBER_DEPTH = 0.6  # Tiefe der Kammern hinter den Bogentüren (bleibt vor der Rückschale)
_PILLAR_RADIUS = 0.36
_FRONT_BAY = np.radians(22.5)  # halbe Breite des Eingangsjochs (zwischen den vorderen Säulen)
_GALLERY_CONTACT = (0.46, 0.3)  # Galerieprofil an der Wand: so weit unter bzw. über der Lauffläche


@dataclass(frozen=True, slots=True)
class HallSettings:
    """Auflösung der Halle (Halleneinstellungen)."""

    around: int = 42
    pillar_sides: int = 8
    pillar_rings: int = 16
    coil: CoilSettings = field(
        default_factory=lambda: CoilSettings(cross_segments=4, chord=0.7, tile_length=2.0, skirt=0.07)
    )


@dataclass(frozen=True, slots=True)
class WallSurface:
    """Hallenwand als Zellfläche: Parameter (a, y) mit a = θ · ``reference`` (Bogenlänge), Normale zur Hallenmitte (Hallenwand)."""

    layout: HiveLayout
    reference: float

    def theta(self, params: FloatArray) -> FloatArray:
        """Azimut ab +Z über +X."""
        return params[:, 0] / self.reference

    def point(self, params: FloatArray) -> FloatArray:
        theta = self.theta(params)
        radius = self.layout.hall_radius(params[:, 1])
        return np.stack([radius * np.sin(theta), params[:, 1], radius * np.cos(theta)], axis=1)

    def normal(self, params: FloatArray) -> FloatArray:
        theta = self.theta(params)
        step = 0.02
        slope = (self.layout.hall_radius(params[:, 1] + step) - self.layout.hall_radius(params[:, 1] - step)) / (
            2.0 * step
        )
        return normalized(np.stack([-np.sin(theta), slope, -np.cos(theta)], axis=1))

    def into_wall(self, params: FloatArray) -> FloatArray:
        """Waagrechte Richtung von der Halle in die Wand hinein."""
        theta = self.theta(params)
        return np.stack([np.sin(theta), np.zeros(len(theta)), np.cos(theta)], axis=1)


@dataclass(frozen=True, slots=True)
class HallParts:
    """Teile der Halle (Hallenteile): Requisiten nach Material, Stroh der Kuppel und das unbeleuchtete Wachs der dunklen Kammern."""

    props: PropParts
    straw: list[MeshPart]
    chambers: list[MeshPart]


@dataclass(frozen=True, slots=True)
class Opening:
    """Öffnung in der Wand: Polygon in Wandparametern (gegen den Uhrzeigersinn) und sichtbare Kante ohne Bodenlinie (Öffnung)."""

    polygon: FloatArray
    frame: FloatArray


def facing(part: MeshPart, reference: FloatArray) -> MeshPart:
    """Kehrt alle Normalen um, wenn sie überwiegend gegen ``reference`` (V, 3) zeigen, und passt die Wicklung an."""
    if np.einsum("ij,ij->", part.normals, reference) < 0.0:
        part = part.with_normals(-part.normals)
    return part.oriented()


class HallBuilder:
    """Baut alle Teile der Wabenhalle (Hallenbau)."""

    def __init__(self, layout: HiveLayout, settings: HallSettings, rng: np.random.Generator) -> None:
        self._layout = layout
        self._settings = settings
        self._rng = rng
        self._surface = WallSurface(layout, float(layout.hall_radius(layout.floor_height + 1.5)))
        count = round(2.0 * np.pi * self._surface.reference / layout.hall_cell)
        self._lattice = HexLattice(2.0 * np.pi * self._surface.reference / count)
        self._parts = PropParts.empty()
        self._straw: list[MeshPart] = []
        self._chambers: list[MeshPart] = []
        self._pillar_angles = (np.arange(layout.pillar_count) + 0.5) * 2.0 * np.pi / layout.pillar_count

    @property
    def wall_top(self) -> float:
        """Oberkante der Zellwand (darüber beginnt die Strohkuppel)."""
        return self._layout.gallery_heights[1] + 0.35

    def build(self) -> HallParts:
        """Alle Teile der Halle nach Material."""
        doors = [self._doorway_opening(door) for door in self._layout.doorways]
        self._wall([self._entrance_opening(), *doors])
        self._floor_and_pool()
        self._galleries()
        self._pillars()
        self._dome()
        for door, opening in zip(self._layout.doorways, doors, strict=True):
            self._doorway(door, opening)
        layout = self._layout
        frame = draped_ring(
            layout.entrance_height,
            layout.entrance_radius - 0.03,
            layout.entrance_radius + 0.42,
            hall_depth(layout),
            0.13,
            0.25,
            -1.0,
            32,
            (1, 2),
        )
        self._parts.wood.append(frame)
        self._chandelier()
        self._props()
        self._accents()
        self._back_shell()
        return HallParts(self._parts, self._straw, self._chambers)

    # Wand --------------------------------------------------------------------------------------

    def _entrance_opening(self) -> Opening:
        layout = self._layout
        angles = np.linspace(0.0, 2.0 * np.pi, 48, endpoint=False)
        radius = layout.entrance_radius + 0.02
        x = radius * np.cos(angles)
        y = layout.entrance_height + radius * np.sin(angles)
        theta = np.arcsin(np.clip(x / layout.hall_radius(y), -1.0, 1.0))
        polygon = np.stack([theta * self._surface.reference, y], axis=1)
        area = 0.5 * np.sum(polygon[:, 0] * np.roll(polygon[:, 1], -1) - np.roll(polygon[:, 0], -1) * polygon[:, 1])
        polygon = polygon if area > 0.0 else polygon[::-1].copy()
        return Opening(polygon, polygon)

    def _doorway_opening(self, door: DoorwaySpec) -> Opening:
        center = np.radians(door.azimuth) * self._surface.reference
        half = 0.5 * door.width
        spring = door.base + door.height - half
        arc = np.linspace(np.pi, 0.0, 13)
        # Kante: links aufwärts, Bogen nach rechts, rechts abwärts (im Uhrzeigersinn)
        frame = np.concatenate(
            [
                np.stack([np.full(4, center - half), np.linspace(door.base - 0.05, spring, 4)], axis=1),
                np.stack([center + half * np.cos(arc[1:-1]), spring + half * np.sin(arc[1:-1])], axis=1),
                np.stack([np.full(4, center + half), np.linspace(spring, door.base - 0.05, 4)], axis=1),
            ]
        )
        # Die Unterkante liegt knapp unter der Schwelle und damit im Boden bzw. in der Galerie verborgen
        return Opening(frame[::-1].copy(), frame)

    def _wall(self, openings: list[Opening]) -> None:
        layout, lattice, surface = self._layout, self._lattice, self._surface
        circumference = 2.0 * np.pi * surface.reference
        centers = lattice.centers(
            (-0.5 * circumference, layout.floor_height - 0.8),
            (0.5 * circumference, self.wall_top + 0.6),
            (0.0, layout.floor_height),
        )
        centers = centers[(centers[:, 0] >= -0.5 * circumference) & (centers[:, 0] < 0.5 * circumference - 1e-6)]
        corners = lattice.corners(centers)
        y_min, y_max = corners[:, :, 1].min(axis=1), corners[:, :, 1].max(axis=1)
        theta = centers[:, 0] / surface.reference
        # Unter dem Boden und über der Wand entfallen Zellen; wo Boden, Galerie oder Säule ansetzt, wird die Zelle zur Füllfläche
        keep = (y_max > layout.floor_height + 0.02) & (y_min < self.wall_top)
        flat = (y_min < layout.floor_height + 0.05) | (y_max > self.wall_top - 0.05)
        for index, height in enumerate(layout.gallery_heights):
            spans = np.abs(theta) > _FRONT_BAY if index == 0 else np.ones(len(theta), dtype=bool)
            slab_bottom, slab_top = height - _GALLERY_CONTACT[0], height + _GALLERY_CONTACT[1]
            keep &= ~(spans & (y_min > slab_bottom) & (y_max < slab_top))
            flat |= spans & (y_max > slab_bottom) & (y_min < slab_top)
        reach = float(layout.hall_radius(layout.floor_height))
        for angle in self._pillar_angles:
            gap = np.abs(np.angle(np.exp(1j * (theta - angle)))) * reach
            flat |= gap < _PILLAR_RADIUS - 0.05
        omitted = np.zeros(len(centers), dtype=bool)
        for opening in openings:
            touching = polygon_contains(corners.reshape(-1, 2), [opening.polygon]).reshape(-1, 6).any(axis=1)
            touching = (touching | polygon_contains(centers, [opening.polygon])) & keep
            omitted |= touching
            region = hexagon_union(lattice, centers[touching]) - m3d.CrossSection([opening.polygon])
            self._parts.wax.append(triangulated_region(region, surface, _WAX_TILE).tinted(_OLD_WAX * 0.95))
        keep &= ~omitted
        centers, flat = centers[keep], flat[keep]
        roll = self._rng.uniform(0.0, 1.0, len(centers))
        kinds = tuple(
            CellKind.FLAT
            if is_flat
            else CellKind.HONEY
            if r < _HONEY_SHARE
            else CellKind.CAPPED
            if r < _HONEY_SHARE + 0.2
            else CellKind.EMPTY
            for is_flat, r in zip(flat, roll, strict=True)
        )
        height = np.clip((centers[:, 1] - layout.floor_height) / (self.wall_top - layout.floor_height), 0.0, 1.0)
        tints = _OLD_WAX[None, :] * self._rng.uniform(0.86, 1.06, (len(centers), 1)) * (0.85 + 0.15 * height)[:, None]
        capped = np.array([kind == CellKind.CAPPED for kind in kinds])
        tints[capped] = _CAP_WAX * self._rng.uniform(0.92, 1.02, (int(capped.sum()), 1))
        cells = CellSet(
            centers,
            kinds,
            0.34 * self._rng.uniform(0.85, 1.1, len(centers)),
            self._rng.uniform(0.35, 0.85, len(centers)),
            tints,
        )
        meshes = build_cells(surface, lattice, cells, CellStyle(uv_tile=_WAX_TILE), self._rng)
        self._parts.wax.append(meshes.wax)
        self._parts.honey.append(meshes.honey)

    # Boden und Becken ---------------------------------------------------------------------------

    def _floor_and_pool(self) -> None:
        layout = self._layout
        floor = layout.floor_height
        outer = float(layout.hall_radius(floor)) + 0.15
        rim_outer = layout.pool_radius + 0.42
        surface = PlaneSurface(np.array([0.0, floor, 0.0]), np.array([0.0, 0.0, 1.0]), np.array([1.0, 0.0, 0.0]))
        lattice = HexLattice(1.0)
        centers = lattice.centers((-outer, -outer), (outer, outer), (0.13, 0.07))
        distance = np.linalg.norm(lattice.corners(centers), axis=2)
        tiles = centers[(distance.min(axis=1) > rim_outer - 0.12) & (distance.max(axis=1) < outer - 0.2)]
        angles = np.linspace(0.0, 2.0 * np.pi, 72, endpoint=False)
        ring = np.stack([np.cos(angles), np.sin(angles)], axis=1)
        annulus = m3d.CrossSection([outer * ring, (rim_outer - 0.2) * ring[::-1]])
        base = triangulated_region(annulus - hexagon_union(lattice, tiles), surface, _WAX_TILE)
        self._parts.wax.append(base.tinted(_FLOOR_WAX * 0.85))
        tile_tints = _FLOOR_WAX[None, :] * self._rng.uniform(0.88, 1.12, (len(tiles), 1))
        cells = CellSet(
            tiles, tuple(CellKind.CAPPED for _ in tiles), np.zeros(len(tiles)), np.zeros(len(tiles)), tile_tints
        )
        self._parts.wax.append(
            build_cells(surface, lattice, cells, CellStyle(cap_bulge=0.035, uv_tile=_WAX_TILE), self._rng).wax
        )
        # Honigbecken mit Wachslippe; das Profil läuft nach außen, die Normale ist die gegen den Uhrzeigersinn gedrehte Tangente
        radius = layout.pool_radius
        offsets = [(-0.05, -0.2), (-0.02, -0.06), (0.06, 0.08), (0.17, 0.13), (0.29, 0.09), (0.38, 0.03), (0.46, -0.02)]
        profile = np.array([[radius + dr, floor + dy] for dr, dy in offsets])
        tangent = normalized(np.gradient(profile, axis=0))
        normals = np.stack([-tangent[:, 1], tangent[:, 0]], axis=1)
        thetas = np.linspace(-np.pi, np.pi, 49)
        lengths = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(profile, axis=0), axis=1))])
        lip = revolve(profile, normals, lengths / _WAX_TILE, thetas, (thetas + np.pi) * radius / _WAX_TILE)
        self._parts.wax.append(lip.tinted(_FRESH_WAX))
        disc_profile = np.array([[radius + 0.02, floor - 0.12], [0.6 * radius, floor - 0.13], [0.0, floor - 0.135]])
        disc = revolve(disc_profile, np.tile([[0.0, 1.0]], (3, 1)), np.zeros(3), thetas, np.zeros(len(thetas)))
        self._parts.honey.append(disc.with_uvs(0.5 + 0.45 * disc.vertices[:, [0, 2]] / (radius + 0.02)))

    # Galerien -----------------------------------------------------------------------------------

    def _galleries(self) -> None:
        layout = self._layout
        below, above = _GALLERY_CONTACT
        for index, height in enumerate(layout.gallery_heights):
            wall = float(layout.hall_radius(height))
            front = wall - layout.gallery_depth
            # (Bezug, Abstand, Höhe): Wandpunkte folgen der Wand auf ihrer eigenen Höhe, damit kein Spalt bleibt
            offsets = [
                ("wall", 0.2, -below - 0.06), ("wall", -0.3, -below + 0.08), ("front", 0.35, -0.32), ("front", 0.02, -0.26),
                ("front", -0.04, -0.05), ("front", -0.01, 0.22), ("front", 0.08, 0.33), ("front", 0.2, 0.3), ("front", 0.24, 0.08),
                ("front", 0.34, 0.0), ("wall", -0.32, 0.0), ("wall", -0.12, 0.06), ("wall", -0.07, above - 0.02), ("wall", 0.2, above),
            ]  # fmt: skip
            points = [
                [float(layout.hall_radius(height + dy)) + offset if anchor == "wall" else front + offset, height + dy]
                for anchor, offset, dy in offsets
            ]
            profile = _resampled(np.array(points), 0.3)
            start, stop = (_FRONT_BAY, 2.0 * np.pi - _FRONT_BAY) if index == 0 else (-np.pi, np.pi)
            thetas = np.linspace(start, stop, int(self._settings.around * (stop - start) / (2.0 * np.pi)) + 1)
            lengths = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(profile, axis=0), axis=1))])
            part = revolve(
                profile, np.zeros_like(profile), lengths / _WAX_TILE, thetas, thetas * wall / _WAX_TILE
            ).smoothed()
            planar = np.hypot(part.vertices[:, 0], part.vertices[:, 2])
            radial = part.vertices * np.array([1.0, 0.0, 1.0]) / np.maximum(planar, 1e-9)[:, None]
            away = radial * (planar - (wall - 0.5 * layout.gallery_depth))[:, None] + np.array([0.0, 1.0, 0.0]) * (
                part.vertices[:, 1:2] - height + 0.1
            )
            self._parts.wax.append(facing(part, away).tinted(_GALLERY_WAX))
            for angle in self._rng.uniform(start, stop, 7):
                top = np.array([(front + 0.12) * np.sin(angle), height - 0.34, (front + 0.12) * np.cos(angle)])
                size = self._rng.uniform(0.7, 1.2)
                drop = teardrop(top, 0.28 * size, 0.06 * size, 6)
                if self._rng.uniform() < 0.4:
                    self._parts.honey.append(drop)
                else:
                    self._parts.wax.append(drop.tinted(_FRESH_WAX))

    # Säulen -------------------------------------------------------------------------------------

    def _pillars(self) -> None:
        layout, settings = self._layout, self._settings
        rib = layout.hall_curve.offset(-layout.pillar_inset)
        start = float(rib.arc_at_height(layout.floor_height - 0.2))
        end = float(rib.arc[_index_near_radius(rib, 0.85)])
        meridian = rib.at(np.linspace(start, end, settings.pillar_rings + 1))
        heights = meridian[:, 1]
        radius = np.full(len(heights), _PILLAR_RADIUS)
        radius += 0.22 * np.exp(-(((heights - layout.floor_height) / 0.45) ** 2))
        for gallery in layout.gallery_heights:
            radius += 0.12 * np.exp(-(((heights - gallery + 0.15) / 0.3) ** 2))
        radius *= np.where(heights > self.wall_top, np.interp(heights, [self.wall_top, 4.3], [1.0, 0.62]), 1.0)
        radius *= 1.0 + 0.05 * np.sin(heights * 3.1)
        sides = settings.pillar_sides
        angles = np.linspace(0.0, 2.0 * np.pi, sides + 1)
        for angle in self._pillar_angles:
            path = np.stack([meridian[:, 0] * np.sin(angle), heights, meridian[:, 0] * np.cos(angle)], axis=1)
            tangent = normalized(np.gradient(path, axis=0))
            side = normalized(np.cross(tangent, np.array([np.sin(angle), 0.0, np.cos(angle)])))
            normal = np.cross(side, tangent)
            lengths = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))])
            # Herabgelaufenes Wachs: unregelmäßige Rinnen um die Säule (ganzzahlige Frequenzen, nahtlos)
            flute = 1.0 + 0.08 * np.sin(5.0 * angles[None, :] + 1.3 * lengths[:, None] + angle)
            flute += 0.04 * np.sin(9.0 * angles[None, :] - 2.1 * lengths[:, None] + 2.0 * angle)
            ring = np.cos(angles)[None, :, None] * normal[:, None, :] + np.sin(angles)[None, :, None] * side[:, None, :]
            vertices = path[:, None, :] + (radius[:, None] * flute)[..., None] * ring
            uvs = np.stack(np.broadcast_arrays(lengths[:, None], angles[None, :] * _PILLAR_RADIUS), axis=-1) / _WAX_TILE
            part = MeshPart.create(
                vertices.reshape(-1, 3), ring.reshape(-1, 3), grid_faces(len(path), sides + 1), uvs.reshape(-1, 2)
            ).smoothed()
            part = facing(part, ring.reshape(-1, 3))
            shade = 0.86 + 0.14 * np.clip((part.vertices[:, 1] - layout.floor_height) / 6.0, 0.0, 1.0)
            self._parts.wax.append(part.tinted(_FRESH_WAX[None, :] * shade[:, None]))

    # Kuppel -------------------------------------------------------------------------------------

    def _dome(self) -> None:
        layout = self._layout
        grooves = layout.hall_curve.offset(layout.dome_bulge)
        start = float(grooves.arc_at_height(layout.gallery_heights[1] + 0.05))
        end = float(grooves.arc[_index_near_radius(grooves, 0.95)])
        shell = CoilShell.along_curve(grooves, start, end, 0.8, layout.dome_bulge, -1.0, self._settings.coil, self._rng)
        self._straw.extend(shell.meshes(first_skirt=True, last_skirt=True))
        apex = float(layout.hall_curve.points[-1, 1])
        boss = lathe(
            [
                (0.0, apex - 0.55),
                (0.45, apex - 0.48),
                (0.8, apex - 0.3),
                (1.05, apex - 0.05),
                (1.1, apex + 0.3),
                (0.0, apex + 0.35),
            ],
            16,
            1.0 / _WAX_TILE,
        )
        self._parts.wax.append(boss.tinted(_FRESH_WAX * 0.95))

    # Türen --------------------------------------------------------------------------------------

    def _doorway(self, door: DoorwaySpec, opening: Opening) -> None:
        surface = self._surface
        rim = surface.point(opening.frame)
        into_wall = surface.into_wall(opening.frame)
        depth = _CHAMBER_DEPTH
        depths = depth * np.array([0.0, 0.3, 0.65, 1.0])
        vertices = (rim[None, :, :] + depths[:, None, None] * into_wall[None, :, :]).reshape(-1, 3)
        lengths = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(rim, axis=0), axis=1))])
        uvs = np.stack(np.broadcast_arrays(lengths[None, :], depths[:, None]), axis=-1).reshape(-1, 2) / _WAX_TILE
        tunnel = MeshPart.create(vertices, np.zeros_like(vertices), grid_faces(len(depths), len(rim)), uvs).smoothed()
        center = surface.point(
            np.array([[np.radians(door.azimuth) * surface.reference, door.base + 0.45 * door.height]])
        )[0]
        direction = normalized(into_wall.mean(axis=0))
        axis_points = center[None, :] + np.repeat(depths, len(rim))[:, None] * direction[None, :]
        tunnel = facing(tunnel, axis_points - tunnel.vertices)
        shade = 1.0 - 0.6 * (np.repeat(depths, len(rim)) / depth) ** 0.7
        self._chambers.append(tunnel.tinted(_OLD_WAX[None, :] * shade[:, None] * 0.7))
        # Dunkle Rückwand; eine Laterne unter dem Bogenscheitel lässt die Kammer von innen warm glühen
        back = surface.point(opening.polygon) + depth * surface.into_wall(opening.polygon)
        back[:, 1] = np.maximum(back[:, 1], door.base - 0.02)
        self._chambers.append(_planar_polygon(back, -direction).tinted(_OLD_WAX * 0.12))
        apex = rim[np.argmax(rim[:, 1])] + 0.5 * depth * direction
        self._parts.extend(hanging_lantern(apex, 0.22, 0.3, self._rng))
        floor_quad = np.array([rim[0], rim[-1], rim[-1] + depth * into_wall[-1], rim[0] + depth * into_wall[0]])
        floor_quad[:, 1] = door.base - 0.01
        floor_part = MeshPart.create(
            floor_quad,
            np.tile([0.0, 1.0, 0.0], (4, 1)),
            np.array([[0, 1, 2], [0, 2, 3]]),
            floor_quad[:, [0, 2]] / _WAX_TILE,
        )
        self._chambers.append(
            floor_part.oriented().tinted(np.array([[1.0], [1.0], [0.45], [0.45]]) * _FLOOR_WAX[None, :])
        )
        # Holzrahmen entlang der Bogenkante
        normal = surface.normal(opening.frame)
        path = rim + 0.06 * normal
        tangent = normalized(np.gradient(path, axis=0))
        side = normalized(np.cross(normal, tangent))
        section, section_normals = rounded_rectangle(0.28, 0.16, 0.05, 1)
        self._parts.wood.append(
            sweep_section(
                path, side, normal, section, section_normals, lengths / _WOOD_TILE, np.linspace(0.0, 0.9, len(section))
            )
        )
        # Wandlaterne neben der Tür
        hook_params = np.array(
            [[np.radians(door.azimuth) * surface.reference - 0.5 * door.width - 0.5, door.base + door.height - 0.45]]
        )
        wall_point, wall_normal = surface.point(hook_params)[0], surface.normal(hook_params)[0]
        hook = wall_point + 0.32 * wall_normal
        self._parts.wood.append(
            plank(
                wall_point - 0.1 * wall_normal,
                hook + np.array([0.0, 0.03, 0.0]),
                (0.0, 1.0, 0.0),
                0.07,
                0.07,
                0.02,
                2.0,
            )
        )
        self._parts.extend(hanging_lantern(hook, 0.12, 0.36, self._rng))

    # Kronleuchterwaben --------------------------------------------------------------------------

    def _chandelier(self) -> None:
        layout = self._layout
        apex = float(layout.hall_curve.points[-1, 1])
        top = apex - 0.1
        lattice = HexLattice(0.4)
        style = CellStyle(uv_tile=_WAX_TILE)
        palette = CombPalette(old_wax=(0.86, 0.58, 0.28), fresh_wax=(1.0, 0.9, 0.7), cap=(1.0, 0.9, 0.72))
        specs = ((0.75, 1.05, 2.25, 0.08), (0.0, 1.35, 2.85, -0.1), (-0.75, 1.05, 2.25, 0.1))
        combs = [
            HangingComb(comb_outline(half, length, top, shift, 18, self._rng, 0.03), z, 0.3, top, length)
            for z, half, length, shift in specs
        ]
        dome = layout.hall_curve.offset(-0.05)

        def ceiling(x: FloatArray, z: float) -> FloatArray:
            return dome.height_at_radius(np.hypot(x, z))

        for comb, regions in zip(combs, visible_regions(combs, ceiling, 0.07, 0.12, 0.15), strict=True):
            meshes = build_comb(comb, regions, lattice, style, palette, 4, self._rng)
            self._parts.wax.append(meshes.wax)
            self._parts.honey.append(meshes.honey)
            tip = comb.outline.rim[np.argmin(comb.outline.rim[:, 1])]
            for offset in (-0.25, 0.0, 0.3):
                drop_top = np.array([tip[0] + offset, tip[1] + 0.03 + 0.2 * abs(offset), comb.plane_z])
                self._parts.honey.append(teardrop(drop_top, self._rng.uniform(0.18, 0.32), 0.05, 6))
        center_tip = combs[1].outline.rim[np.argmin(combs[1].outline.rim[:, 1])]
        self._parts.extend(hanging_lantern(np.array([center_tip[0], center_tip[1] + 0.05, 0.0]), 0.6, 0.45, self._rng))

    # Requisiten ---------------------------------------------------------------------------------

    def _props(self) -> None:
        layout = self._layout
        upper = layout.gallery_heights[1]
        for angle in np.radians([90.0, 135.0, 180.0, 225.0, 270.0]):
            radius = float(layout.hall_radius(upper)) - layout.gallery_depth + 0.15
            anchor = np.array([radius * np.sin(angle), upper - 0.32, radius * np.cos(angle)])
            self._parts.extend(hanging_lantern(anchor, self._rng.uniform(0.35, 0.6), 0.4, self._rng))
        lower = layout.gallery_heights[0]
        for angle in np.radians([118.0, 160.0, 205.0, 243.0]):
            radius = float(layout.hall_radius(lower)) - 0.62
            self._parts.extend(
                honey_pot(
                    np.array([radius * np.sin(angle), lower, radius * np.cos(angle)]),
                    self._rng.uniform(0.22, 0.32),
                    self._rng,
                )
            )
        for angle, distance in ((150.0, 2.75), (205.0, 2.62)):
            base = np.array(
                [distance * np.sin(np.radians(angle)), layout.floor_height + 0.02, distance * np.cos(np.radians(angle))]
            )
            self._parts.extend(honey_pot(base, self._rng.uniform(0.25, 0.34), self._rng))

    # Farbtupfer -------------------------------------------------------------------------------

    def _accents(self) -> None:
        """Banner unter der oberen Galerie, eine Wimpelkette an der unteren Galerie und Blüten am Becken und auf der Galerie."""
        layout, rng = self._layout, self._rng
        upper, lower = layout.gallery_heights[1], layout.gallery_heights[0]
        hang = float(layout.hall_radius(upper)) - layout.gallery_depth + 0.1
        for index, angle in enumerate(np.radians([123.0, 147.0, 168.0, 192.0, 213.0, 237.0])):
            radial = np.array([np.sin(angle), 0.0, np.cos(angle)])
            top = hang * radial + np.array([0.0, upper - 0.34, 0.0])
            color = PENNANT_COLORS[index % 4]
            self._parts.extend(banner(top, -radial, 0.44, 1.15, color, float(rng.uniform(0.0, 2.0 * np.pi))))
        rail = float(layout.hall_radius(lower)) - layout.gallery_depth - 0.06
        for start, stop in np.radians([[112.5, 157.5], [157.5, 202.5], [202.5, 247.5]]):
            ends = [
                rail * np.array([np.sin(a), 0.0, np.cos(a)]) + np.array([0.0, lower + 0.32, 0.0]) for a in (start, stop)
            ]
            middle = 0.5 * (start + stop)
            self._parts.extend(
                hanging_garland(
                    ends[0], ends[1], 0.3, -np.array([np.sin(middle), 0.0, np.cos(middle)]), PENNANT_COLORS, rng
                )
            )
        lip = layout.pool_radius + 0.17
        for index, angle in enumerate(np.sort(rng.uniform(0.0, 2.0 * np.pi, 12))):
            radial = np.array([np.sin(angle), 0.0, np.cos(angle)])
            center = lip * radial + np.array([0.0, layout.floor_height + 0.135, 0.0])
            color = BLOSSOM_COLORS[index % len(BLOSSOM_COLORS)]
            self._parts.cloth.append(
                blossom(center, radial * 0.35 + np.array([0.0, 1.0, 0.0]), rng.uniform(0.09, 0.12), color, rng)
            )
        for index, angle in enumerate(np.radians([125.0, 166.0, 198.0, 250.0])):
            radius = float(layout.hall_radius(lower)) - 0.45
            center = np.array([radius * np.sin(angle), lower + 0.01, radius * np.cos(angle)])
            color = BLOSSOM_COLORS[(index + 1) % len(BLOSSOM_COLORS)]
            self._parts.cloth.append(blossom(center, np.array([0.0, 1.0, 0.0]), 0.1, color, rng))

    # Rückschale -------------------------------------------------------------------------------

    def _back_shell(self) -> None:
        """Dunkle, zur Halle gewandte Schale hinter allen Hallenwänden: schließt jeden Durchblick auf die Außenhülle.

        Sie liegt bis zu 0,72 m hinter der Wand (hinter Zellen und Kammern) und mindestens 0,15 m vor
        dem Stroh; um die Holzröhre des Fluglochs bleibt sie offen.
        """
        layout = self._layout
        hall = layout.hall_curve
        arcs = np.linspace(float(hall.arc_at_height(layout.floor_height - 0.15)), hall.length, 14)
        points, normals = hall.at(arcs), hall.normal(arcs)
        straw = layout.groove_curve.points[layout.groove_curve.points[:, 0] >= 1.0]
        clearance = np.min(np.linalg.norm(points[:, None, :] - straw[None, :, :], axis=2), axis=1)
        offset = np.minimum(0.72, clearance - 0.15)
        profile = points + offset[:, None] * normals
        profile = np.concatenate([profile, [[0.0, profile[-1, 1] + 0.02]]])
        inward = np.concatenate([-normals, [[0.0, -1.0]]])
        thetas = np.linspace(-np.pi, np.pi, 29)
        lengths = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(profile, axis=0), axis=1))])
        shell = revolve(profile, inward, lengths / _WAX_TILE, thetas, (thetas + np.pi) * 6.0 / _WAX_TILE)
        tunnel = entrance_cutter(layout, 0.1)(shell.vertices)
        shell = shell.compact(~tunnel[shell.faces].any(axis=1))
        self._chambers.append(shell.tinted(_OLD_WAX * 0.08))


# Hilfsfunktionen ----------------------------------------------------------------------------


def _index_near_radius(curve: ProfileCurve, radius: float) -> int:
    """Index des Kurvenpunkts nahe ``radius`` auf dem Kuppelabschnitt (oberhalb y = 2)."""
    penalty = np.abs(curve.points[:, 0] - radius) + (curve.points[:, 1] < 2.0) * 100.0
    return int(np.argmin(penalty))


def _resampled(polyline: FloatArray, step: float) -> FloatArray:
    """Unterteilt lange Strecken einer Polylinie, damit glatte Normalen nur an den Ecken mitteln."""
    points = [polyline[0]]
    for start, end in zip(polyline[:-1], polyline[1:], strict=True):
        count = max(1, int(np.ceil(np.linalg.norm(end - start) / step)))
        points.extend(start + (end - start) * (np.arange(1, count + 1) / count)[:, None])
    return np.asarray(points)


def _planar_polygon(points: FloatArray, normal: FloatArray) -> MeshPart:
    """Trianguliert ein nahezu ebenes Polygon im Raum (Projektion auf die Ebene senkrecht zu ``normal``)."""
    helper = np.array([0.0, 1.0, 0.0]) if abs(normal[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
    first = normalized(np.cross(helper, normal))
    second = np.cross(normal, first)
    flat = np.stack([points @ first, points @ second], axis=1)
    area = 0.5 * np.sum(flat[:, 0] * np.roll(flat[:, 1], -1) - np.roll(flat[:, 0], -1) * flat[:, 1])
    if area < 0.0:
        points, flat = points[::-1].copy(), flat[::-1].copy()
    triangles = np.asarray(m3d.triangulate([flat]), dtype=np.int64)
    part = MeshPart.create(points, np.broadcast_to(normal, points.shape), triangles, flat / _WAX_TILE)
    return part.oriented().compact()
