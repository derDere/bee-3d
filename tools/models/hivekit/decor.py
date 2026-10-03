"""Zierrat im Bienenmaßstab: Laternen, Honigtöpfchen, Tropfen, Wimpel, Wimpelketten, Banner, Blüten, Mast mit Leuchtschale (Zierrat).

Die Spielerbiene ist 0,2 m lang; Laternen (0,3–0,45 m), Töpfchen (0,2–0,3 m), Blüten (0,2 m)
und Wimpel (0,3–1 m) haben ihre Größe. Laternen und Töpfchen sind Drehkörper; die Leuchtkörper
und Honigspiegel tragen das Honigmaterial, damit sie nachts glühen. Stoff und Blüten färbt die
Tönung je Eckpunkt in kräftigen Bilderbuchfarben (``PENNANT_COLORS``).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt

from hivekit.layout import HiveLayout
from hivekit.mesh import MeshPart, fan_cap, grid_faces, normalized, revolve

type FloatArray = npt.NDArray[np.float64]
type Color = tuple[float, float, float]

_WAX_TILE = 1.0 / 1.2  # Kacheln je Meter auf Wachs

# Wimpel- und Bannerfarben als lineare Multiplikatoren der hellen Leinentextur: Rot, Himmelblau, Wiesengrün, Honiggelb, Creme
PENNANT_COLORS: tuple[Color, ...] = (
    (0.95, 0.2, 0.1),
    (0.25, 0.55, 1.0),
    (0.35, 0.8, 0.2),
    (1.0, 0.72, 0.12),
    (1.0, 0.95, 0.85),
)
# Blütenfarben: Rosa, Weiß, Himmelblau, Violett; die Mitte leuchtet gelb
BLOSSOM_COLORS: tuple[Color, ...] = ((1.0, 0.42, 0.62), (1.0, 0.97, 0.92), (0.42, 0.65, 1.0), (0.72, 0.45, 1.0))
_BLOSSOM_HEART: Color = (1.0, 0.82, 0.12)


@dataclass(frozen=True, slots=True)
class PropParts:
    """Teile eines Requisits nach Material (Requisitenteile)."""

    wax: list[MeshPart]
    honey: list[MeshPart]
    wood: list[MeshPart]
    cloth: list[MeshPart]

    @staticmethod
    def empty() -> PropParts:
        """Leere Sammlung."""
        return PropParts([], [], [], [])

    def extend(self, other: PropParts) -> None:
        """Hängt die Teile einer anderen Sammlung an."""
        self.wax.extend(other.wax)
        self.honey.extend(other.honey)
        self.wood.extend(other.wood)
        self.cloth.extend(other.cloth)


def lathe(profile: Sequence[tuple[float, float]], sides: int, uv_per_meter: float | None) -> MeshPart:
    """Drehkörper aus einem Profil (Radius, Höhe) von unten nach oben; Normalen aus der Profilsteigung.

    Mit ``uv_per_meter`` kacheln die UVs (u um den Körper, v entlang des Profils); ohne Angabe
    liegen sie auf der Mittellinie der Honigtextur (u = 0,5, v von 0 bis 1) — der Körper glüht
    in der Mitte am hellsten und rundum gleich.
    """
    points = np.asarray(profile, dtype=np.float64)
    tangent = normalized(np.asarray(np.gradient(points, axis=0)))
    # Profile laufen von unten nach oben, deshalb zeigt die im Uhrzeigersinn gedrehte Tangente nach außen
    normals = np.stack([tangent[:, 1], -tangent[:, 0]], axis=1)
    lengths = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(points, axis=0), axis=1))])
    thetas = np.linspace(-np.pi, np.pi, sides + 1)
    if uv_per_meter is None:
        return revolve(points, normals, 0.06 + 0.88 * lengths / lengths[-1], thetas, np.full(len(thetas), 0.5))
    radius = float(points[:, 0].max())
    return revolve(points, normals, lengths * uv_per_meter, thetas, (thetas + np.pi) * radius * uv_per_meter)


def glow_disc(center: FloatArray, radius: float, sides: int, normal: Sequence[float] = (0.0, 1.0, 0.0)) -> MeshPart:
    """Runde Honigfläche (Spiegel in Topf, Schale, Becken); UVs mittig auf der Honigtextur."""
    angles = np.linspace(0.0, 2.0 * np.pi, sides, endpoint=False)
    ring = np.stack([radius * np.sin(angles), np.zeros(sides), radius * np.cos(angles)], axis=1) + np.asarray(
        center, dtype=np.float64
    )
    disc = fan_cap(ring, np.asarray(center, dtype=np.float64), normal, 1.0)
    relative = disc.vertices - np.asarray(center, dtype=np.float64)
    return disc.with_uvs(0.5 + 0.45 * relative[:, [0, 2]] / radius)


def cylinder(
    start: FloatArray, end: FloatArray, radius: float, sides: int, uv_per_meter: float, cap_end: bool = True
) -> MeshPart:
    """Schlanker Zylinder von ``start`` nach ``end`` (Stäbe, Pflöcke, Schnüre), optional mit Deckel am Ende."""
    begin, finish = np.asarray(start, dtype=np.float64), np.asarray(end, dtype=np.float64)
    along = normalized(finish - begin)
    helper = np.array([0.0, 1.0, 0.0]) if abs(along[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
    first = normalized(np.cross(helper, along))
    second = np.cross(along, first)
    angles = np.linspace(0.0, 2.0 * np.pi, sides + 1)
    ring = np.cos(angles)[:, None] * first + np.sin(angles)[:, None] * second
    vertices = np.concatenate([begin + radius * ring, finish + radius * ring])
    length = float(np.linalg.norm(finish - begin))
    uvs = np.concatenate(
        [
            np.stack([np.zeros(sides + 1), angles * radius], axis=1),
            np.stack([np.full(sides + 1, length), angles * radius], axis=1),
        ]
    )
    body = MeshPart.create(
        vertices, np.concatenate([ring, ring]), grid_faces(2, sides + 1), uvs * uv_per_meter
    ).oriented()
    if not cap_end:
        return body
    return MeshPart.concatenate([body, fan_cap(finish + radius * ring[:-1], finish, along, uv_per_meter)])


def lantern(hook: FloatArray, height: float, rng: np.random.Generator, sides: int = 6) -> PropParts:
    """Wachslaterne, an ``hook`` hängend: Wachskappe, leuchtender Honigkörper, Wachsfuß (Kappe und Fuß verdecken die offenen Enden)."""
    h = height
    cap = lathe([(0.38 * h, -0.22 * h), (0.14 * h, -0.07 * h), (0.0, 0.02 * h)], sides, _WAX_TILE)
    body = lathe(
        [(0.3 * h, -0.86 * h), (0.37 * h, -0.64 * h), (0.37 * h, -0.42 * h), (0.3 * h, -0.18 * h)], sides, None
    )
    foot = lathe([(0.0, -1.0 * h), (0.3 * h, -0.93 * h), (0.38 * h, -0.83 * h)], sides, _WAX_TILE)
    turn = rng.uniform(-np.pi, np.pi)
    rotation = np.array([[np.cos(turn), 0.0, np.sin(turn)], [0.0, 1.0, 0.0], [-np.sin(turn), 0.0, np.cos(turn)]])
    tint = np.array([0.82, 0.58, 0.3]) * rng.uniform(0.9, 1.05)
    return PropParts(
        wax=[cap.transformed(rotation, hook).tinted(tint), foot.transformed(rotation, hook).tinted(tint)],
        honey=[body.transformed(rotation, hook)],
        wood=[],
        cloth=[],
    )


def hanging_lantern(anchor: FloatArray, drop: float, height: float, rng: np.random.Generator) -> PropParts:
    """Laterne an einer Schnur unter ``anchor``."""
    hook = np.asarray(anchor, dtype=np.float64) - np.array([0.0, drop, 0.0])
    parts = lantern(hook, height, rng)
    cord = cylinder(anchor + np.array([0.0, 0.03, 0.0]), hook, 0.012, 3, 4.0, cap_end=False)
    parts.cloth.append(cord.tinted((0.25, 0.16, 0.08)))
    return parts


def honey_pot(base: FloatArray, height: float, rng: np.random.Generator, sides: int = 8) -> PropParts:
    """Honigtöpfchen aus dunklem Wachs mit Honigspiegel und Tropfnase."""
    h = height
    profile = [
        (0.0, 0.0),
        (0.36 * h, 0.0),
        (0.53 * h, 0.3 * h),
        (0.46 * h, 0.7 * h),
        (0.32 * h, 0.88 * h),
        (0.38 * h, 1.0 * h),
        (0.28 * h, 0.97 * h),
        (0.27 * h, 0.86 * h),
    ]
    pot = lathe(profile, sides, _WAX_TILE)
    honey = glow_disc(np.array([0.0, 0.86 * h, 0.0]), 0.27 * h, sides)
    drip = teardrop(np.array([0.0, 0.99 * h, 0.39 * h]), 0.35 * h, 0.07 * h, 5)
    turn = rng.uniform(-np.pi, np.pi)
    rotation = np.array([[np.cos(turn), 0.0, np.sin(turn)], [0.0, 1.0, 0.0], [-np.sin(turn), 0.0, np.cos(turn)]])
    tint = np.array([0.7, 0.42, 0.18]) * rng.uniform(0.85, 1.1)
    origin = np.asarray(base, dtype=np.float64)
    return PropParts(
        wax=[pot.transformed(rotation, origin).tinted(tint)],
        honey=[honey.transformed(rotation, origin), drip.transformed(rotation, origin)],
        wood=[],
        cloth=[],
    )


def teardrop(top: FloatArray, length: float, radius: float, sides: int, samples: int = 5) -> MeshPart:
    """Hängender Tropfen ab ``top``: Tropfenkurve x = sin t · sin^1,4(t/2), runde Perle unten, spitzer Ansatz oben."""
    t = np.linspace(np.pi, 0.0, samples)
    shape = np.sin(t) * np.sin(0.5 * t) ** 1.4
    profile = np.stack([radius * shape / 0.65, -0.5 * length * (1.0 - np.cos(t))], axis=1)
    profile[0, 0], profile[-1, 0] = 0.0, 0.0
    profile[-1, 1] = 0.04 * length
    return lathe([(float(r), float(y)) for r, y in profile], sides, None).transformed(None, top)


def pennant(
    attach_top: FloatArray,
    attach_bottom: FloatArray,
    direction: FloatArray,
    length: float,
    wave: float,
    phase: float,
    segments: int = 6,
) -> MeshPart:
    """Schwalbenschwanz-Wimpel: an der Stange zwischen ``attach_top`` und ``attach_bottom``, weht in ``direction``."""
    top, bottom = np.asarray(attach_top, dtype=np.float64), np.asarray(attach_bottom, dtype=np.float64)
    out = normalized(np.asarray(direction, dtype=np.float64))
    height = float(np.linalg.norm(top - bottom))
    down = normalized(bottom - top)
    side = normalized(np.cross(out, down))
    t = np.linspace(0.0, 1.0, segments + 1)
    half = 0.5 * height * (1.0 - 0.45 * t)
    middle = top + 0.5 * (bottom - top)
    rows = []
    for offset in (-1.0, 0.0, 1.0):
        # Mittlere Reihe bildet die Kerbe des Schwalbenschwanzes
        reach = t * length * (1.0 - 0.28 * (offset == 0.0) * t**6)
        sway = wave * np.sin(2.0 * np.pi * (t * 1.3) + phase) * t
        droop = 0.12 * length * t**2
        rows.append(
            middle[None, :]
            + reach[:, None] * out
            + (offset * half)[:, None] * (-down)
            + (sway[:, None] * side)
            + (droop[:, None] * down)
        )
    vertices = np.stack(rows, axis=0).reshape(-1, 3)
    faces = grid_faces(3, segments + 1)
    uvs = np.stack(np.meshgrid(t, np.array([0.0, 0.5, 1.0])), axis=-1).reshape(-1, 2)
    part = MeshPart.create(vertices, np.zeros_like(vertices), faces, uvs)
    return part.smoothed()


def bunting(
    layout: HiveLayout,
    height: float,
    spans: int,
    sag: float,
    colors: Sequence[tuple[float, float, float]],
    rng: np.random.Generator,
    detail: int,
    pegs: bool = True,
) -> PropParts:
    """Wimpelkette rund um den Korb: Pflöcke, durchhängende Schnur auf dem Stroh, dreieckige Wimpel in wechselnden Farben."""
    parts = PropParts.empty()
    offset = np.pi / spans
    span = 2.0 * np.pi / spans
    flag_index = 0
    for peg in range(spans):
        start = offset + peg * span
        t = np.linspace(0.0, 1.0, detail + 1)
        theta = start + t * span
        y = height - sag * np.sin(np.pi * t) - 0.04 * np.sin(2.0 * np.pi * t)
        lift = 0.045 + 0.12 * (1.0 - np.sin(np.pi * t)) ** 6
        radius = layout.envelope_radius(y) + lift
        path = np.stack([radius * np.sin(theta), y, radius * np.cos(theta)], axis=1)
        parts.cloth.append(_cord_ribbon(path, 0.03).tinted((0.85, 0.75, 0.55)))
        lengths = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))])
        flags = int(lengths[-1] // 0.62)
        for k in range(flags):
            center = (k + 0.5) * lengths[-1] / flags
            corners = np.interp([center - 0.17, center + 0.17], lengths, t)
            tip_t = np.interp(center, lengths, t)
            tip_theta = start + tip_t * span
            tip_y = float(np.interp(tip_t, t, y)) - 0.4
            tip_radius = float(layout.envelope_radius(tip_y)) + 0.04
            tip = np.array([tip_radius * np.sin(tip_theta), tip_y, tip_radius * np.cos(tip_theta)])
            top_points = np.stack([np.interp(corners, t, path[:, i]) for i in range(3)], axis=1)
            vertices = np.concatenate([top_points, tip[None, :]]) + np.array([[0.0, -0.012, 0.0]])
            normal = normalized(np.array([np.sin(tip_theta), 0.15, np.cos(tip_theta)]))
            flag = MeshPart.create(
                vertices,
                np.broadcast_to(normal, (3, 3)),
                np.array([[0, 1, 2]]),
                np.array([[0.0, 0.0], [1.0, 0.0], [0.5, 1.0]]),
            ).oriented()
            color = np.asarray(colors[(flag_index + int(rng.integers(0, 2))) % len(colors)])
            parts.cloth.append(flag.tinted(color * rng.uniform(0.9, 1.05)))
            flag_index += 1
        if not pegs:
            continue
        anchor_theta = start
        anchor_y = height
        anchor_radius = float(layout.envelope_radius(anchor_y))
        inner = np.array(
            [(anchor_radius - 0.15) * np.sin(anchor_theta), anchor_y, (anchor_radius - 0.15) * np.cos(anchor_theta)]
        )
        outer = np.array(
            [
                (anchor_radius + 0.2) * np.sin(anchor_theta),
                anchor_y + 0.03,
                (anchor_radius + 0.2) * np.cos(anchor_theta),
            ]
        )
        parts.wood.append(cylinder(inner, outer, 0.035, 5, 4.0))
    return parts


def hanging_garland(
    start: FloatArray,
    end: FloatArray,
    sag: float,
    facing: FloatArray,
    colors: Sequence[Color],
    rng: np.random.Generator,
    spacing: float = 0.36,
    segments: int = 10,
) -> PropParts:
    """Wimpelkette zwischen zwei Aufhängepunkten: durchhängende Schnur, darunter Dreieckswimpel zur Richtung ``facing``."""
    parts = PropParts.empty()
    toward = normalized(np.asarray(facing, dtype=np.float64))
    t = np.linspace(0.0, 1.0, segments + 1)[:, None]
    path = (
        np.asarray(start)
        + (np.asarray(end) - np.asarray(start)) * t
        - sag * np.sin(np.pi * t) * np.array([0.0, 1.0, 0.0])
    )
    parts.cloth.append(_cord_ribbon(path, 0.025, toward).tinted((0.85, 0.75, 0.55)))
    lengths = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))])
    count = max(1, int(lengths[-1] // spacing))
    offset = int(rng.integers(0, len(colors)))
    for k in range(count):
        center = (k + 0.5) * lengths[-1] / count
        top = np.stack([np.interp([center - 0.12, center + 0.12], lengths, path[:, i]) for i in range(3)], axis=1)
        tip = top.mean(axis=0) + np.array([0.0, -0.3, 0.0]) + 0.03 * toward
        vertices = np.concatenate([top, tip[None, :]]) + np.array([[0.0, -0.01, 0.0]])
        flag = MeshPart.create(
            vertices,
            np.broadcast_to(toward, (3, 3)),
            np.array([[0, 1, 2]]),
            np.array([[0.0, 0.0], [1.0, 0.0], [0.5, 1.0]]),
        ).oriented()
        parts.cloth.append(flag.tinted(np.asarray(colors[(k + offset) % len(colors)]) * rng.uniform(0.92, 1.04)))
    return parts


def banner(top: FloatArray, facing: FloatArray, width: float, length: float, color: Color, phase: float) -> PropParts:
    """Stoffbanner mit Schwalbenschwanz an einer Holzstange; hängt von ``top`` herab und zeigt nach ``facing``."""
    toward = normalized(np.asarray(facing, dtype=np.float64) * np.array([1.0, 0.0, 1.0]))
    side = normalized(np.cross(np.array([0.0, 1.0, 0.0]), toward))
    t = np.linspace(0.0, 1.0, 6)
    rows = []
    for across in (-1.0, 0.0, 1.0):
        # Die Mittelspalte endet höher: Kerbe des Schwalbenschwanzes
        drop = t * length * (1.0 - 0.2 * (across == 0.0) * t**8)
        bulge = 0.05 * np.sin(np.pi * t + phase) * (1.0 - 0.6 * abs(across))
        rows.append(
            np.asarray(top)
            + across * 0.5 * width * side
            - drop[:, None] * np.array([0.0, 1.0, 0.0])
            + bulge[:, None] * toward
        )
    vertices = np.stack(rows, axis=1).reshape(-1, 3)
    uvs = np.stack(np.meshgrid(np.array([0.0, 0.5, 1.0]), t), axis=-1).reshape(-1, 2)
    cloth = (
        MeshPart.create(vertices, np.broadcast_to(toward, vertices.shape), grid_faces(len(t), 3), uvs)
        .oriented()
        .smoothed()
    )
    rod = cylinder(
        np.asarray(top) - (0.5 * width + 0.06) * side, np.asarray(top) + (0.5 * width + 0.06) * side, 0.025, 5, 4.0
    )
    return PropParts(wax=[], honey=[], wood=[rod], cloth=[cloth.tinted(color)])


def blossom(
    center: FloatArray, normal: FloatArray, radius: float, color: Color, rng: np.random.Generator, petals: int = 5
) -> MeshPart:
    """Blüte als leicht gewölbter Stern mit ``petals`` Blütenblättern; die Mitte leuchtet gelb (Tönung je Eckpunkt)."""
    up = normalized(np.asarray(normal, dtype=np.float64))
    helper = np.array([1.0, 0.0, 0.0]) if abs(up[0]) < 0.9 else np.array([0.0, 0.0, 1.0])
    first = normalized(np.cross(helper, up))
    second = np.cross(up, first)
    count = 2 * petals
    angles = rng.uniform(0.0, 2.0 * np.pi) + np.arange(count) * np.pi / petals
    reach = np.where(np.arange(count) % 2 == 0, radius, 0.38 * radius)
    rim = (
        np.asarray(center)
        + reach[:, None] * (np.cos(angles)[:, None] * first + np.sin(angles)[:, None] * second)
        + (0.25 * radius * (reach / radius) ** 2)[:, None] * up
    )
    vertices = np.concatenate([np.asarray(center)[None, :] - 0.02 * radius * up, rim])
    faces = np.stack(
        [np.zeros(count, dtype=np.int64), 1 + np.arange(count), 1 + (np.arange(count) + 1) % count], axis=1
    )
    tint = np.concatenate(
        [
            [_BLOSSOM_HEART],
            np.where((np.arange(count) % 2 == 0)[:, None], color, 0.5 * (np.asarray(color) + _BLOSSOM_HEART)),
        ]
    )
    uvs = 0.5 + 0.5 * np.concatenate(
        [[[0.0, 0.0]], np.stack([np.cos(angles), np.sin(angles)], axis=1) * (reach / radius)[:, None]]
    )
    part = MeshPart.create(vertices, np.broadcast_to(up, vertices.shape), faces, uvs, tint).oriented()
    return part.smoothed()


def _cord_ribbon(path: FloatArray, width: float, facing: FloatArray | None = None) -> MeshPart:
    """Schmales Band entlang einer Kurve (Schnur); flach zur Richtung ``facing``, ohne Angabe von der Hochachse weg."""
    tangent = normalized(np.asarray(np.gradient(path, axis=0)))
    outward = normalized(path * np.array([1.0, 0.0, 1.0])) if facing is None else np.broadcast_to(facing, path.shape)
    side = normalized(np.cross(tangent, outward))
    normal = normalized(np.cross(side, tangent))
    vertices = np.stack([path - 0.5 * width * side, path + 0.5 * width * side], axis=1).reshape(-1, 3)
    normals = np.repeat(normal, 2, axis=0)
    lengths = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))])
    uvs = np.stack(np.broadcast_arrays(lengths[:, None] * 2.0, np.array([[0.0, 1.0]])), axis=-1).reshape(-1, 2)
    return MeshPart.create(vertices, normals, grid_faces(len(path), 2), uvs).oriented()


def mast(layout: HiveLayout, rng: np.random.Generator) -> PropParts:
    """Holzmast auf dem Knauf mit Wachsschale voller Honig (Leuchtfeuer) und einem Wimpel."""
    parts = PropParts.empty()
    bottom = np.array([0.0, layout.knob_top - 0.35, 0.0])
    top = np.array([0.0, layout.mast_top, 0.0])
    parts.wood.append(cylinder(bottom, top + np.array([0.0, 0.02, 0.0]), 0.075, 8, 2.0))
    cup = lathe(
        [(0.0, -0.06), (0.1, -0.06), (0.24, 0.05), (0.33, 0.18), (0.35, 0.22), (0.3, 0.2), (0.27, 0.13)], 12, _WAX_TILE
    )
    parts.wax.append(cup.transformed(None, top).tinted((0.85, 0.6, 0.32)))
    parts.honey.append(glow_disc(top + np.array([0.0, 0.135, 0.0]), 0.28, 12))
    flag = pennant(
        top - np.array([0.0, 0.32, 0.0]),
        top - np.array([0.0, 0.72, 0.0]),
        np.array([0.75, 0.0, -0.66]),
        1.15,
        0.09,
        rng.uniform(0, 6.28),
    )
    parts.cloth.append(flag.tinted(PENNANT_COLORS[0]))
    return parts
