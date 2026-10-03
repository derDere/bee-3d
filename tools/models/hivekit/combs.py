"""Hängende Naturwaben: Scheiben mit rundem Rand, Zellen auf den sichtbaren Flächen, Honig und Deckel (Naturwaben).

Eine Wabe liegt in der Ebene z = const und hängt mit ihrer Oberkante im Wachsboden. Zellen
entstehen nur dort, wo eine Wabenfläche zu sehen ist — die Nachbarwabe verdeckt den Rest; die
verdeckten Flächen bleiben glatt. Honig lagert oben (überwiegend verdeckelt), in der Mitte
glänzen offene Honigzellen, unten am frischen, hellen Wachs bleiben viele Zellen leer.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import manifold3d as m3d
import numpy as np
import numpy.typing as npt

from hivekit.honeycomb import (
    CellKind,
    CellMeshes,
    CellSet,
    CellStyle,
    CombOutline,
    HexLattice,
    PlaneSurface,
    build_cells,
    cells_inside,
    comb_rim,
    hexagon_union,
    triangulated_region,
)
from hivekit.mesh import MeshPart

type FloatArray = npt.NDArray[np.float64]
type TintFunction = Callable[[FloatArray], FloatArray]


@dataclass(frozen=True, slots=True)
class CombPalette:
    """Wachstöne einer Wabe als lineare Multiplikatoren der Wachstextur (Wabenfarben)."""

    old_wax: tuple[float, float, float] = (0.95, 0.64, 0.28)
    fresh_wax: tuple[float, float, float] = (1.0, 0.96, 0.86)
    cap: tuple[float, float, float] = (1.0, 0.92, 0.74)


@dataclass(frozen=True, slots=True)
class HangingComb:
    """Eine Wabe: Umriss, Ebene, Dicke, Oberkante und Länge (hängende Wabe)."""

    outline: CombOutline
    plane_z: float
    thickness: float
    top: float
    length: float

    def age(self, y: FloatArray) -> FloatArray:
        """Alter des Wachses 1 (oben, dunkler) bis 0 (unten, frisch)."""
        return np.clip(1.0 - (self.top - y) / self.length, 0.0, 1.0)

    def tint(self, palette: CombPalette) -> TintFunction:
        """Wachstönung nach Höhe: oben bernsteinfarben, unten hell."""
        old, fresh = np.asarray(palette.old_wax), np.asarray(palette.fresh_wax)

        def color(points: FloatArray) -> FloatArray:
            age = self.age(points[:, 1]) ** 1.4
            return fresh[None, :] * (1.0 - age[:, None]) + old[None, :] * age[:, None]

        return color


def face_surface(comb: HangingComb, side: float) -> PlaneSurface:
    """Wabenfläche auf der Seite ``side`` (+1 vorn bei +z, −1 hinten); Parameter (side · x, y)."""
    return PlaneSurface(
        np.array([0.0, 0.0, comb.plane_z + side * 0.5 * comb.thickness]),
        np.array([side, 0.0, 0.0]),
        np.array([0.0, 1.0, 0.0]),
    )


def to_face_params(polygon: FloatArray, side: float) -> FloatArray:
    """Weltpolygon (x, y) in Flächenparameter der Seite; die Umlaufrichtung bleibt gegen den Uhrzeigersinn."""
    mirrored = polygon * np.array([side, 1.0])
    return mirrored if side > 0.0 else mirrored[::-1].copy()


def classify_cells(
    centers: FloatArray, comb: HangingComb, rng: np.random.Generator, palette: CombPalette, depth: float
) -> CellSet:
    """Verteilt Honig, Deckel und leere Zellen nach der Lage in der Wabe."""
    age = comb.age(centers[:, 1])
    roll = rng.uniform(0.0, 1.0, len(centers))
    capped_share = 0.12 + 0.6 * age**1.5
    honey_share = 0.32 + 0.25 * np.sin(np.pi * np.clip(age * 1.1, 0.0, 1.0))
    kinds = tuple(
        CellKind.CAPPED if r < c else CellKind.HONEY if r < c + h else CellKind.EMPTY
        for r, c, h in zip(roll, capped_share, honey_share, strict=True)
    )
    old, fresh, cap = (np.asarray(color) for color in (palette.old_wax, palette.fresh_wax, palette.cap))
    blend = (age**1.4)[:, None]
    wax = fresh[None, :] * (1.0 - blend) + old[None, :] * blend
    wax *= rng.uniform(0.92, 1.05, (len(centers), 1))
    tints = np.where(
        np.array([kind == CellKind.CAPPED for kind in kinds])[:, None], cap[None, :] * (0.9 + 0.1 * (1.0 - blend)), wax
    )
    depths = depth * rng.uniform(0.85, 1.05, len(centers))
    fills = rng.uniform(0.35, 0.85, len(centers))
    return CellSet(centers, kinds, depths, fills, tints)


def neighbor(combs: list[HangingComb], index: int, side: float) -> HangingComb | None:
    """Nächste Wabe auf der Seite ``side`` (in z-Richtung)."""
    own = combs[index].plane_z
    candidates = [comb for comb in combs if side * (comb.plane_z - own) > 1e-6]
    return min(candidates, key=lambda comb: abs(comb.plane_z - own)) if candidates else None


def below_ceiling(ceiling: Callable[[FloatArray], FloatArray], reach: float, margin: float) -> m3d.CrossSection:
    """Bereich unterhalb der Kurve y = ``ceiling(x)`` − ``margin`` für |x| ≤ ``reach``."""
    x = np.linspace(-reach, reach, 121)
    heights = ceiling(x) - margin
    # Gegen den Uhrzeigersinn: unten links → unten rechts → Deckenkante von rechts nach links
    polygon = np.concatenate([[[-reach, -40.0], [reach, -40.0]], np.stack([x, heights], axis=1)[::-1]])
    return m3d.CrossSection([polygon])


def to_face_section(region: m3d.CrossSection, side: float) -> m3d.CrossSection:
    """Weltregion (x, y) in Flächenparameter der Wabenseite (side · x, y) umrechnen."""
    contours = [contour * np.array([side, 1.0]) for contour in region.to_polygons()]
    if side < 0.0:
        contours = [contour[::-1].copy() for contour in contours]
    return m3d.CrossSection(contours) if contours else m3d.CrossSection()


def visible_regions(
    combs: list[HangingComb],
    ceiling: Callable[[FloatArray, float], FloatArray],
    edge_margin: float,
    top_margin: float,
    overlap: float,
) -> list[dict[float, m3d.CrossSection | None]]:
    """Zellbereiche je Wabe und Seite: innerhalb des Umrisses, unter der Decke und nicht hinter der Nachbarwabe.

    ``ceiling(x, z)`` liefert die Unterkante der Decke (Wachsboden, Kuppel) über der Wabenebene;
    ``overlap`` lässt die Zellen ein Stück hinter den Rand der Nachbarwabe reichen.
    """
    regions = []
    for index, comb in enumerate(combs):
        reach = float(np.abs(comb.outline.polygon[:, 0]).max()) + 1.0
        allowed = comb.outline.section().offset(-edge_margin) ^ below_ceiling(
            lambda x, z=comb.plane_z: ceiling(x, z), reach, top_margin
        )
        sides: dict[float, m3d.CrossSection | None] = {}
        for side in (1.0, -1.0):
            other = neighbor(combs, index, side)
            region = allowed if other is None else allowed - other.outline.section().offset(-overlap)
            sides[side] = to_face_section(region, side)
        regions.append(sides)
    return regions


def build_comb(
    comb: HangingComb,
    regions: dict[float, m3d.CrossSection | None],
    lattice: HexLattice,
    style: CellStyle,
    palette: CombPalette,
    rim_sides: int,
    rng: np.random.Generator,
) -> CellMeshes:
    """Wabe mit Rand, beiden Flächen und den Zellen in den sichtbaren Bereichen ``regions`` je Seite."""
    tint = comb.tint(palette)
    wax: list[MeshPart] = []
    honey: list[MeshPart] = []
    rim = comb_rim(comb.outline, comb.plane_z, comb.thickness, rim_sides, style.uv_tile)
    wax.append(rim.tinted(tint(rim.vertices)))
    for side in (1.0, -1.0):
        surface = face_surface(comb, side)
        outline = m3d.CrossSection([to_face_params(comb.outline.polygon, side)])
        region = regions.get(side)
        cells = CellSet(np.zeros((0, 2)), (), np.zeros(0), np.zeros(0), np.zeros((0, 3)))
        if region is not None and not region.is_empty():
            x_min, y_min, x_max, y_max = region.bounds()
            phase = rng.uniform(0.0, 1.0, 2) * np.array([lattice.width, lattice.row_spacing])
            centers = lattice.centers((x_min, y_min), (x_max, y_max), phase)
            centers = centers[cells_inside(lattice, centers, region)]
            # Das Alter hängt nur von der Höhe ab; die Spiegelung der Rückseite spielt keine Rolle
            cells = classify_cells(centers, comb, rng, palette, 0.42 * comb.thickness)
        margin = outline - hexagon_union(lattice, cells.centers) if cells.count else outline
        face = triangulated_region(margin, surface, style.uv_tile)
        wax.append(face.tinted(tint(face.vertices)))
        if cells.count:
            meshes = build_cells(surface, lattice, cells, style, rng)
            wax.append(meshes.wax)
            honey.append(meshes.honey)
    return CellMeshes(MeshPart.concatenate(wax), MeshPart.concatenate(honey))
