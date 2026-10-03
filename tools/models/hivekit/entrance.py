"""Flugloch mit Holzrahmen und Holzröhre, Anflugbrett mit Streben (Eingang).

Der Rahmen liegt auf der gewölbten Strohaußenseite (seine Vorderfläche folgt der Hüllkurve des
Korbs), die Röhre führt durch die Wand bis in die Halle, ein zweiter Rahmen fasst die Öffnung an
der Hallenwand. Das Anflugbrett liegt bündig unter der Lochkante; seine Bretter enden im Stroh.
"""

from __future__ import annotations

from collections.abc import Callable

import numpy as np
import numpy.typing as npt

from hivekit.layout import HiveLayout
from hivekit.mesh import MeshPart, grid_faces, plank, rounded_rectangle

type FloatArray = npt.NDArray[np.float64]
type DepthFunction = Callable[[FloatArray, FloatArray], FloatArray]

_WOOD_TILE = 1.0  # Kacheln je Meter auf Holz (Faser entlang u)


def skep_depth(layout: HiveLayout) -> DepthFunction:
    """z der Korbaußenseite (Wulstscheitel) über den Punkten (x, y) vor dem Korb."""

    def depth(x: FloatArray, y: FloatArray) -> FloatArray:
        radius = layout.envelope_radius(y)
        return np.sqrt(np.maximum(radius**2 - x**2, 0.0))

    return depth


def hall_depth(layout: HiveLayout) -> DepthFunction:
    """z der Hallenwand über den Punkten (x, y) vorn in der Halle."""

    def depth(x: FloatArray, y: FloatArray) -> FloatArray:
        radius = layout.hall_radius(y)
        return np.sqrt(np.maximum(radius**2 - x**2, 0.0))

    return depth


def draped_ring(
    center_y: float,
    inner: float,
    outer: float,
    depth: DepthFunction,
    raise_by: float,
    sink_by: float,
    facing: float,
    sides: int,
    segments: tuple[int, int] = (2, 3),
) -> MeshPart:
    """Ringrahmen um eine Öffnung in +Z, auf eine gewölbte Fläche gelegt.

    Der Querschnitt (Radius, Höhe über der Fläche) ist ein abgerundetes Rechteck von ``inner`` bis
    ``outer``; ``facing`` +1 hebt ihn nach +z (Außenseite), −1 nach −z (Innenseite der Halle).
    ``segments`` unterteilt Ecken bzw. gerade Seiten des Querschnitts.
    """
    width, height = outer - inner, raise_by + sink_by
    section, _ = rounded_rectangle(width, height, min(0.06, 0.3 * width, 0.3 * height), *segments)
    radial = section[:, 0] + 0.5 * (inner + outer)
    lift = section[:, 1] + 0.5 * (raise_by - sink_by)
    angles = np.linspace(0.0, 2.0 * np.pi, sides + 1)
    x = radial[None, :] * np.cos(angles)[:, None]
    y = center_y + radial[None, :] * np.sin(angles)[:, None]
    z = depth(x, y) + facing * lift[None, :]
    vertices = np.stack([x, y, z], axis=-1)
    perimeter = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(section, axis=0), axis=1))])
    uvs = np.stack(
        np.broadcast_arrays(angles[:, None] * 0.5 * (inner + outer) * _WOOD_TILE, perimeter[None, :] * _WOOD_TILE),
        axis=-1,
    )
    faces = grid_faces(sides + 1, len(section))
    part = MeshPart.create(
        vertices.reshape(-1, 3), np.zeros((vertices.size // 3, 3)), faces, uvs.reshape(-1, 2)
    ).smoothed()
    # Außenseite des Querschnitts: Normalen zeigen vom Querschnittsmittelpunkt weg
    middle = np.stack(
        [0.5 * (inner + outer) * np.cos(angles), center_y + 0.5 * (inner + outer) * np.sin(angles)], axis=1
    )
    centers = np.concatenate(
        [middle, (depth(middle[:, 0], middle[:, 1]) + facing * 0.5 * (raise_by - sink_by))[:, None]], axis=1
    )
    outward = part.vertices - np.repeat(centers, len(section), axis=0)
    flip = np.einsum("ij,ij->i", part.normals, outward) < 0.0
    return part.with_normals(np.where(flip[:, None], -part.normals, part.normals)).oriented()


def tunnel_sleeve(layout: HiveLayout, sides: int, rings: int) -> MeshPart:
    """Holzröhre durch die Korbwand: beginnt hinter dem Außenrahmen, endet knapp vor der Hallenwand im Innenrahmen.

    Die Normalen zeigen zur Lochachse (man sieht die Röhre von innen).
    """
    radius = layout.entrance_radius - 0.015
    angles = np.linspace(0.0, 2.0 * np.pi, sides + 1)
    x, y = radius * np.cos(angles), layout.entrance_height + radius * np.sin(angles)
    start = skep_depth(layout)(x, y) - 0.12
    end = hall_depth(layout)(x, y) - 0.06
    blend = np.linspace(0.0, 1.0, rings + 1)[:, None]
    z = start[None, :] * (1.0 - blend) + end[None, :] * blend
    vertices = np.stack(np.broadcast_arrays(x[None, :], y[None, :], z), axis=-1).reshape(-1, 3)
    normals = np.stack(
        np.broadcast_arrays(-np.cos(angles)[None, :], -np.sin(angles)[None, :], np.zeros((rings + 1, 1))), axis=-1
    )
    uvs = np.stack(np.broadcast_arrays(z * _WOOD_TILE, angles[None, :] * radius * _WOOD_TILE), axis=-1)
    part = MeshPart.create(vertices, normals.reshape(-1, 3), grid_faces(rings + 1, sides + 1), uvs.reshape(-1, 2))
    return part.oriented()


def landing_board(layout: HiveLayout, planks: int) -> list[MeshPart]:
    """Anflugbrett aus Längsbrettern mit Querbalken und zwei Streben in den Randwulst."""
    depth = skep_depth(layout)
    top = layout.entrance_height - layout.entrance_radius - 0.02
    gap = 0.025
    width = (2.0 * layout.board_half_width - (planks - 1) * gap) / planks
    parts = []
    rng = np.random.default_rng(31)
    for index in range(planks):
        x = -layout.board_half_width + width * (index + 0.5) + gap * index
        back = float(depth(np.array([x]), np.array([top]))[0]) - 0.35
        front = layout.board_front - rng.uniform(0.0, 0.12)
        center_y = top - 0.5 * layout.board_thickness + rng.uniform(-0.008, 0.008)
        board = plank(
            np.array([x, center_y, back]),
            np.array([x, center_y, front]),
            (0.0, 1.0, 0.0),
            width,
            layout.board_thickness,
            0.035,
            _WOOD_TILE,
        )
        parts.append(board.tinted(np.full(3, rng.uniform(0.88, 1.06))))
    beam_y = top - layout.board_thickness - 0.07
    for beam_z in (layout.board_front - 0.6, layout.board_back + 1.25):
        parts.append(
            plank(
                np.array([-layout.board_half_width + 0.1, beam_y, beam_z]),
                np.array([layout.board_half_width - 0.1, beam_y, beam_z]),
                (0.0, 1.0, 0.0),
                0.18,
                0.14,
                0.03,
                _WOOD_TILE,
            )
        )
    for x in (-layout.board_half_width + 0.55, layout.board_half_width - 0.55):
        upper = np.array([x, beam_y - 0.02, layout.board_front - 0.6])
        rim_z = float(np.sqrt(max((layout.rim_center[0] + layout.rim_radius) ** 2 - x**2, 0.0)))
        lower = np.array([x, layout.rim_center[1] + 0.1, rim_z - 0.3])
        parts.append(plank(upper, lower, (0.0, 0.6, 0.8), 0.16, 0.15, 0.03, _WOOD_TILE))
    return parts


def lantern_post(
    base: FloatArray, height: float, arm: float, direction: float
) -> tuple[MeshPart, FloatArray, FloatArray]:
    """Laternenpfosten mit Ausleger; liefert das Holz, den Aufhängepunkt am Ausleger und die Pfostenspitze."""
    top = base + np.array([0.0, height, 0.0])
    post = plank(
        base - np.array([0.0, 0.05, 0.0]),
        top + np.array([0.0, 0.25, 0.0]),
        (0.0, 0.0, 1.0),
        0.09,
        0.09,
        0.02,
        _WOOD_TILE * 2.0,
    )
    arm_end = top + np.array([direction * arm, 0.0, 0.0])
    beam = plank(
        top - np.array([direction * 0.05, 0.0, 0.0]), arm_end, (0.0, 1.0, 0.0), 0.06, 0.06, 0.015, _WOOD_TILE * 2.0
    )
    return (
        MeshPart.concatenate([post, beam]),
        arm_end - np.array([direction * 0.04, 0.03, 0.0]),
        top + np.array([0.0, 0.25, 0.0]),
    )
