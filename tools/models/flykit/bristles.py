"""Borsten der Fliege: Großborsten in Reihen, verstreute Grundhaare, Fühlerborsten, Borstenkrone (Beborstung).

Jede Borste ist eine dünne Röhre mit dreieckigem Querschnitt. Ihr Ansatz steckt in der Haut, sie
tritt senkrecht aus und kippt zur Spitze in die Kämmrichtung (quadratische Bézierkurve). Die
Vertexfarben laufen von der dunklen Wurzel zur helleren Spitze, Akzentborsten enden in der
Akzentfarbe der Art; jede Borste variiert leicht in Helligkeit.

Großborsten (Makrochaeten) stehen wie bei Schmeißfliegen in festen Reihen: Brustrücken
(Dorsozentral-, Akrostichal-, Intraalar-, Supraalarreihen), Schulterbeulen, Flanken,
Schildchenrand, Hinterränder der Rückenplatten, Gesichtsrand (Vibrissen), Stirnreihen und
Scheitel. Grundhaare verteilen sich per Poisson-Ausdünnung über Rumpf und Kopf.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Protocol

import numpy as np
import numpy.typing as npt
from modelkit.geometry import ShadedMesh
from modelkit.sdf import Ellipsoid, Sdf
from modelkit.sweep import sweep_tube
from scipy.spatial import cKDTree

from flykit.anatomy import MIRROR, AbdomenShape, AntennaShape, FlyAnatomy, normalized
from flykit.fields import PLATE_SHARE
from flykit.species import Species, linear

type FloatArray = npt.NDArray[np.float64]
type IndexArray = npt.NDArray[np.int64]
type DensityFunction = Callable[[FloatArray, FloatArray], FloatArray]

SIDES = 3
MACRO_STATIONS = (0.0, 0.4, 0.75, 1.0)  # Bézier-Parameter der Großborsten (3 Ringe + Spitze)
GROUND_STATIONS = (0.0, 0.5, 1.0)  # Grundhaare (2 Ringe + Spitze)


def tube_triangles(stations: Sequence[float]) -> int:
    """Dreiecke einer Borstenröhre: Mantel zwischen den Ringen plus Spitzenfächer."""
    return (len(stations) - 2) * SIDES * 2 + SIDES


GROUND_TRIANGLES = tube_triangles(GROUND_STATIONS)


@dataclass(frozen=True, slots=True)
class Bristle:
    """Eine Borste: Ansatz auf der Haut, Hautnormale, Spitzenrichtung, Maße (Borste)."""

    root: FloatArray
    normal: FloatArray
    direction: FloatArray
    length: float
    radius: float
    stations: tuple[float, ...] = MACRO_STATIONS
    accent: bool = False

    @property
    def triangles(self) -> int:
        """Dreiecke der Röhre."""
        return tube_triangles(self.stations)


@dataclass(frozen=True, slots=True)
class HairMesh:
    """Alle Borsten eines Knotens als ein Netz mit linearen Vertexfarben (Borstennetz)."""

    vertices: FloatArray
    normals: FloatArray
    faces: IndexArray
    colors: FloatArray

    def translated(self, offset: FloatArray) -> HairMesh:
        """Verschiebt das Netz in den Rahmen eines Knotens."""
        return HairMesh(self.vertices - offset, self.normals, self.faces, self.colors)


def _tangential(vectors: FloatArray, normals: FloatArray) -> FloatArray:
    return normalized(vectors - normals * np.einsum("ij,ij->i", vectors, normals)[:, None])


def settle(field: Sdf, anchors: FloatArray, combs: FloatArray, leans: FloatArray) -> tuple[FloatArray, FloatArray, FloatArray]:
    """Projiziert Ansätze auf die Haut; Richtung = Normale gemischt mit der Kämmrichtung in der Tangentialebene."""
    roots = field.project_to_surface(anchors, iterations=8)
    normals = field.gradient_normals(roots)
    combs = _tangential(np.broadcast_to(combs, roots.shape).copy(), normals)
    leans = np.asarray(leans, dtype=np.float64)[:, None]
    directions = normalized(normals * (1.0 - leans) + combs * leans)
    return roots, normals, directions


def make_bristles(
    roots: FloatArray,
    normals: FloatArray,
    directions: FloatArray,
    lengths: FloatArray,
    radii: FloatArray,
    stations: tuple[float, ...] = MACRO_STATIONS,
    accents: npt.NDArray[np.bool_] | None = None,
) -> list[Bristle]:
    """Bündelt Ansätze, Richtungen und Maße zu Borsten."""
    accents = np.zeros(len(roots), dtype=bool) if accents is None else accents
    return [
        Bristle(roots[i], normals[i], directions[i], float(lengths[i]), float(radii[i]), stations, bool(accents[i]))
        for i in range(len(roots))
    ]


def bristle_path(bristle: Bristle) -> FloatArray:
    """Stützpunkte der Borste: senkrechter Austritt, Biegung in die Kämmrichtung."""
    t = np.asarray(bristle.stations)[:, None]
    root = bristle.root - bristle.normal * 0.9 * bristle.radius
    control = bristle.root + bristle.normal * 0.35 * bristle.length
    tip = bristle.root + bristle.direction * bristle.length
    return (1.0 - t) ** 2 * root + 2.0 * (1.0 - t) * t * control + t**2 * tip


def grow(bristles: Sequence[Bristle], species: Species, rng: np.random.Generator) -> HairMesh:
    """Baut die Röhren aller Borsten mit Vertexfarben von der Wurzel zur Spitze."""
    palette = species.palette
    root_color, tip_color, accent = linear(palette.hair_root), linear(palette.hair_tip), linear(palette.accent)
    vertices, normals, faces, colors = [], [], [], []
    offset = 0
    for bristle in bristles:
        path = bristle_path(bristle)
        profile = np.linspace(1.0, 0.0, len(path)) ** 0.8 * bristle.radius
        tube = sweep_tube(path, profile, SIDES)
        along = tube.along[:, None]
        tip = accent if bristle.accent else tip_color
        shade = 0.75 + 0.5 * rng.random()
        blend = along**2.2 if bristle.accent else along**1.4
        colors.append(np.clip((root_color[None, :] * (1.0 - blend) + tip[None, :] * blend) * shade, 0.0, 1.0))
        vertices.append(tube.vertices)
        normals.append(tube.normals)
        faces.append(tube.faces + offset)
        offset += len(tube.vertices)
    if not vertices:
        return HairMesh(np.zeros((0, 3)), np.zeros((0, 3)), np.zeros((0, 3), dtype=np.int64), np.zeros((0, 3)))
    return HairMesh(np.concatenate(vertices), np.concatenate(normals), np.concatenate(faces), np.concatenate(colors))


def scatter(mesh: ShadedMesh, count: int, density: DensityFunction, rng: np.random.Generator) -> tuple[FloatArray, FloatArray]:
    """Verteilt ``count`` Punkte flächengewichtet nach ``density`` (0..1) und dünnt sie per Poisson-Abstand aus."""
    if count <= 0:
        return np.zeros((0, 3)), np.zeros((0, 3))
    a, b, c = (mesh.vertices[mesh.faces[:, i]] for i in range(3))
    areas = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    candidates = 14 * count
    chosen = rng.choice(len(areas), candidates, p=areas / areas.sum())
    r1, r2 = np.sqrt(rng.random(candidates)), rng.random(candidates)
    weights = np.stack([1.0 - r1, r1 * (1.0 - r2), r1 * r2], axis=1)
    corners = mesh.faces[chosen]
    points = np.einsum("nk,nkc->nc", weights, mesh.vertices[corners])
    normals = normalized(np.einsum("nk,nkc->nc", weights, mesh.normals[corners]))
    keep = rng.random(candidates) < np.clip(density(points, normals), 0.0, 1.0)
    points, normals = points[keep], normals[keep]
    if len(points) == 0:
        return points, normals
    accepted_area = areas.sum() * len(points) / candidates
    spacing = 0.75 * np.sqrt(accepted_area / count)
    neighbors = cKDTree(points).query_ball_point(points, spacing)
    blocked = np.zeros(len(points), dtype=bool)
    selected: list[int] = []
    for index in rng.permutation(len(points)):
        if blocked[index]:
            continue
        selected.append(int(index))
        blocked[neighbors[index]] = True
        if len(selected) == count:
            break
    return points[selected], normals[selected]


def _on_ellipsoid(ellipsoid: Ellipsoid, fractions: FloatArray) -> FloatArray:
    """Punkte auf der Oberseite eines achsparallelen Ellipsoids aus (x-, z-Anteil)."""
    fx, fz = fractions[:, 0], fractions[:, 1]
    fy = np.sqrt(np.clip(1.0 - fx**2 - fz**2, 0.02, None))
    return np.asarray(ellipsoid.center) + np.stack([fx, fy, fz], axis=1) * np.asarray(ellipsoid.radii)


@dataclass(frozen=True, slots=True)
class Row:
    """Borstenreihe der linken Körperseite in Anteilen eines Ellipsoids (Borstenreihe)."""

    fractions: tuple[tuple[float, float], ...]
    lengths: tuple[float, ...]  # Referenz-mm
    radius: float  # Referenz-mm
    lean: float
    comb: tuple[float, float, float]


_THORAX_ROWS = (
    Row(((0.3, 0.62), (0.31, 0.32), (0.31, 0.02), (0.3, -0.3), (0.28, -0.58)), (0.7, 0.8, 1.0, 1.2, 1.35), 0.06, 0.45, (0.0, 0.35, -1.0)),
    Row(((0.1, 0.55), (0.1, 0.2), (0.1, -0.15), (0.1, -0.5)), (0.5, 0.55, 0.6, 0.65), 0.04, 0.55, (0.0, 0.3, -1.0)),
    Row(((0.55, 0.1), (0.53, -0.3), (0.5, -0.6)), (0.9, 1.1, 1.25), 0.06, 0.45, (0.2, 0.35, -1.0)),
    Row(((0.75, 0.3), (0.74, -0.15)), (1.15, 1.15), 0.065, 0.4, (0.5, 0.3, -1.0)),
)


def body_macrochaetae(anatomy: FlyAnatomy, field: Sdf) -> list[Bristle]:
    """Großborsten von Brust, Schildchen und Hinterleib."""
    species, unit = anatomy.species, anatomy.unit
    scale, thickness = species.hair.macro, species.hair.thickness
    thorax, abdomen = anatomy.thorax, anatomy.abdomen
    anchors, combs, lengths, radii, leans = [], [], [], [], []

    def add(points: FloatArray, comb: FloatArray, length: Sequence[float] | float, radius: float, lean: float) -> None:
        count = len(points)
        anchors.append(points)
        combs.append(np.broadcast_to(comb, (count, 3)))
        lengths.append(np.broadcast_to(np.asarray(length, dtype=np.float64) * unit * scale, (count,)))
        radii.append(np.full(count, radius * unit * thickness))
        leans.append(np.full(count, lean))

    for row in _THORAX_ROWS:
        left = _on_ellipsoid(thorax.scutum, np.asarray(row.fractions))
        comb = np.asarray(row.comb)
        add(np.concatenate([left, left * MIRROR]), np.concatenate([np.broadcast_to(comb, left.shape), np.broadcast_to(comb * MIRROR, left.shape)]), np.tile(row.lengths, 2), row.radius, row.lean)
    scutum, scutellum = thorax.scutum, thorax.scutellum
    c, r = np.asarray(scutum.center), np.asarray(scutum.radii)
    # Schulterbeulen, Notopleuren, Postalare, Sternopleuren (linke Seite, gespiegelt)
    side_rows = (
        ([(0.82, 0.55, 0.62), (0.9, 0.35, 0.55)], (0.6, 0.4, 0.6), (1.0, 0.9), 0.06, 0.4),
        ([(0.98, 0.22, 0.32), (0.98, 0.18, 0.1)], (0.7, 0.3, -0.4), (1.1, 1.0), 0.06, 0.45),
        ([(0.62, 0.6, -0.74)], (0.3, 0.3, -1.0), (1.2,), 0.065, 0.4),
        ([(0.96, -0.32, 0.2), (0.95, -0.4, -0.02), (0.92, -0.48, -0.22)], (0.3, -1.0, -0.4), (0.8, 0.85, 0.8), 0.05, 0.55),
    )
    for fractions, comb, length, radius, lean in side_rows:
        left = c + np.asarray(fractions) * r
        comb_left = np.broadcast_to(np.asarray(comb), left.shape)
        add(np.concatenate([left, left * MIRROR]), np.concatenate([comb_left, comb_left * MIRROR]), np.tile(length, 2), radius, lean)
    # Schildchenrand: drei Paare, das hintere am längsten
    angles = np.radians([18.0, 50.0, 82.0])
    sc, sr = np.asarray(scutellum.center), np.asarray(scutellum.radii)
    left = sc + np.stack([np.sin(angles) * sr[0] * 0.92, np.full(3, 0.15 * sr[1]), -np.cos(angles) * sr[2] * 0.92], axis=1)
    comb_left = np.stack([np.sin(angles) * 0.5, np.full(3, 0.45), -np.ones(3)], axis=1)
    add(np.concatenate([left, left * MIRROR]), np.concatenate([comb_left, comb_left * MIRROR]), np.tile((1.5, 1.35, 1.1), 2), 0.07, 0.35)
    # Hinterränder der Rückenplatten: seitlich an Platte 1+2, breiter an 3, ganz an 4, Ring auf Platte 5
    edges = abdomen.band_edges
    rows = ((1, (70.0, 105.0), 2, 0.75), (2, (40.0, 112.0), 4, 0.85), (3, (6.0, 115.0), 8, 0.95))
    for index, (low, high), count, length in rows:
        band = edges[index - 1] - edges[index]
        z = edges[index] + band * (0.03 + (1.0 - PLATE_SHARE) * abdomen.bloat)
        add(*_ring(abdomen, z, np.radians(np.linspace(low, high, count))), length, 0.055, 0.62)
    z = edges[3] - 0.5 * (edges[3] - edges[4])
    add(*_ring(abdomen, z, np.radians(np.linspace(10.0, 125.0, 6))), 0.9, 0.055, 0.6)
    roots, normals, directions = settle(field, np.concatenate(anchors), np.concatenate(combs), np.concatenate(leans))
    return make_bristles(roots, normals, directions, np.concatenate(lengths), np.concatenate(radii), accents=_accents(species, len(roots)))


def _ring(abdomen: AbdomenShape, z: float, angles: FloatArray) -> tuple[FloatArray, FloatArray]:
    """Ansätze und Kämmrichtungen auf einem Querschnitt des Hinterleibs (lokales z, Winkel ab Rückenmitte, beide Seiten)."""
    radii = np.asarray(abdomen.ellipsoid.radii)
    t = np.clip(z / radii[2], -0.98, 0.98)
    scale = np.sqrt(1.0 - t * t)
    local = np.stack([radii[0] * scale * np.sin(angles), radii[1] * scale * np.cos(angles), np.full(len(angles), z)], axis=1)
    left = abdomen.at(local)
    comb = np.stack([0.15 * np.sin(angles), 0.1 * np.cos(angles), -np.ones(len(angles))], axis=1) @ abdomen.rotation.T
    return np.concatenate([left, left * MIRROR]), np.concatenate([comb, comb * MIRROR])


def _accents(species: Species, count: int) -> npt.NDArray[np.bool_]:
    rng = np.random.default_rng(species.seed + 101)
    return rng.random(count) < species.hair.accent_tips


def eye_clearance(anatomy: FlyAnatomy, points: FloatArray) -> FloatArray:
    """Abstand zur nächsten Augenfläche (negativ unter der Augenkappe)."""
    return np.min([Ellipsoid(eye.center, eye.radii, eye.frame).distance(points) for eye in anatomy.eyes], axis=0)


def head_macrochaetae(anatomy: FlyAnatomy, field: Sdf) -> list[Bristle]:
    """Großborsten des Kopfes: Vibrissen, Stirnreihen, Punktaugen-, Scheitel- und Hinterkopfborsten."""
    species, unit = anatomy.species, anatomy.unit
    scale, thickness = species.hair.macro * species.proportions.head, species.hair.thickness * species.proportions.head
    head = anatomy.head
    face, core, vertex = head.face, head.core, head.vertex
    fc, fr = np.asarray(face.center), np.asarray(face.radii)
    hc, hr = np.asarray(core.center), np.asarray(core.radii)
    vc, vr = np.asarray(vertex.center), np.asarray(vertex.radii)
    groups = (
        # Vibrissen am Mundrand: kräftig, nach vorn unten innen
        (fc + np.array([[0.6, -0.78, 0.5]]) * fr, (-0.3, -0.45, 1.0), 1.15, 0.075, 0.5),
        # Stirnreihen neben der Mittellinie, nach innen vorn gekämmt
        (hc + np.array([[0.2, 0.3, 0.92], [0.2, 0.5, 0.82], [0.19, 0.68, 0.68], [0.17, 0.84, 0.5], [0.15, 0.95, 0.3]]) * hr, (-1.0, 0.25, 0.7), 0.6, 0.045, 0.5),
        # Scheitel: innere und äußere Vertikalborsten, nach hinten innen
        (vc + np.array([[0.55, 0.55, -0.65], [1.25, 0.1, -0.85]]) * vr, (-0.4, 0.4, -1.0), 0.85, 0.055, 0.45),
        # Punktaugenborsten, nach vorn außen
        (vc + np.array([[0.35, 0.9, 0.4]]) * vr, (0.4, 0.3, 1.0), 0.6, 0.045, 0.5),
    )
    anchors, combs, lengths, radii, leans = [], [], [], [], []
    for points, comb, length, radius, lean in groups:
        left = np.atleast_2d(points)
        comb_left = np.broadcast_to(np.asarray(comb, dtype=np.float64), left.shape)
        anchors.append(np.concatenate([left, left * MIRROR]))
        combs.append(np.concatenate([comb_left, comb_left * MIRROR]))
        lengths.append(np.full(2 * len(left), length * unit * scale))
        radii.append(np.full(2 * len(left), radius * unit * thickness))
        leans.append(np.full(2 * len(left), lean))
    roots, normals, directions = settle(field, np.concatenate(anchors), np.concatenate(combs), np.concatenate(leans))
    visible = eye_clearance(anatomy, roots) > 0.02 * unit
    bristles = make_bristles(roots, normals, directions, np.concatenate(lengths), np.concatenate(radii), accents=_accents(species, len(roots)))
    return [bristle for bristle, keep in zip(bristles, visible, strict=True) if keep]


def crown_spikes(anatomy: FlyAnatomy, field: Sdf) -> list[Bristle]:
    """Borstenkrone der Königin: kräftige, nach hinten gebogene Stacheln im Bogen über den Scheitel."""
    count = anatomy.species.hair.crown
    if count == 0:
        return []
    unit, scale = anatomy.unit, anatomy.species.proportions.head
    core = anatomy.head.core
    hc, hr = np.asarray(core.center), np.asarray(core.radii)
    angles = np.radians(np.linspace(-78.0, 78.0, count))
    anchors = hc + np.stack([np.sin(angles) * 0.82, 0.86 * np.cos(angles) ** 0.5, -0.45 - 0.2 * np.cos(angles)], axis=1) * hr
    combs = np.stack([np.sin(angles) * 0.9, np.full(count, 0.7), np.full(count, -1.0)], axis=1)
    roots, normals, directions = settle(field, anchors, combs, np.full(count, 0.42))
    lengths = (2.4 + 1.5 * np.cos(angles) ** 2) * unit * scale
    radii = np.full(count, 0.24 * unit * scale)
    return make_bristles(roots, normals, directions, lengths, radii, accents=np.ones(count, dtype=bool))


def arista_bristles(antenna: AntennaShape, unit: float, thickness: float) -> list[Bristle]:
    """Fühlerborste mit gefiederten Seitenhaaren (wie bei Schmeißfliegen)."""
    axis = antenna.arista_direction
    side = normalized(np.cross(axis, [0.0, 0.0, 1.0]))
    main = Bristle(antenna.arista_base, axis, normalized(axis + side * 0.25), antenna.arista_length, 0.035 * unit * thickness)
    bristles = [main]
    path = bristle_path(main)
    for t in (0.35, 0.55, 0.75):
        point = path[0] + (path[-1] - path[0]) * t
        for sign in (1.0, -1.0):
            bristles.append(
                Bristle(point, sign * side, normalized(sign * side + axis * 0.6), 0.22 * unit, 0.016 * unit * thickness, (0.0, 0.5, 1.0))
            )
    return bristles


class Coat(Protocol):
    """Verteilung und Strich der Grundhaare auf einer Fläche (Haarkleid)."""

    def density(self, points: FloatArray, normals: FloatArray) -> FloatArray:
        """Dichte 0..1 je Punkt."""
        ...

    def comb(self, points: FloatArray, normals: FloatArray) -> FloatArray:
        """Kämmrichtung je Punkt (wird in die Tangentialebene gelegt)."""
        ...


class BodyCoat:
    """Grundhaare des Rumpfs: dicht auf Brust und Schildchen, oben auf dem Hinterleib dichter als unten (Rumpfhaar).

    Hals, Flügelwurzeln und Schwingkölbchen bleiben frei. Der Strich zeigt nach hinten, an
    Flanken und Unterseite nach hinten unten.
    """

    def __init__(self, anatomy: FlyAnatomy) -> None:
        self._anatomy = anatomy
        self._wing_roots = np.stack([wing.root for wing in anatomy.wings])

    def density(self, points: FloatArray, normals: FloatArray) -> FloatArray:
        anatomy, unit = self._anatomy, self._anatomy.unit
        thorax = anatomy.thorax
        on_thorax = anatomy.abdomen.axial(points) > anatomy.abdomen.band_edges[0] - 0.3 * unit
        upper = 0.35 + 0.65 * np.clip(normals[:, 1] + 0.3, 0.0, 1.0)
        value = np.where(on_thorax, 0.9, 0.75 * upper)
        near_wing = np.min(np.linalg.norm(points[:, None, :] - self._wing_roots[None, :, :], axis=2), axis=1) < 0.45 * unit
        near_neck = points[:, 2] > float(thorax.neck.center[2]) - 0.2 * unit
        near_halter = np.min([np.linalg.norm(points - halter.knob_center, axis=1) for halter in thorax.halteres], axis=0) < 0.45 * unit
        return np.where(near_wing | near_neck | near_halter, 0.0, value)

    def comb(self, points: FloatArray, normals: FloatArray) -> FloatArray:
        back, down = np.array([0.0, 0.2, -1.0]), np.array([0.0, -1.0, -0.7])
        t = np.clip(-normals[:, 1:2] * 1.5, 0.0, 1.0)
        return back[None, :] * (1.0 - t) + down[None, :] * t


class HeadCoat:
    """Grundhaare des Kopfes auf Wangen, Hinterkopf und Gesichtsrändern; nie unter den Augen (Kopfhaar).

    Der Strich zeigt an den Wangen nach unten vorn, am Hinterkopf nach außen.
    """

    def __init__(self, anatomy: FlyAnatomy) -> None:
        self._anatomy = anatomy

    def density(self, points: FloatArray, normals: FloatArray) -> FloatArray:
        anatomy, unit = self._anatomy, self._anatomy.unit
        head = anatomy.head
        local = (points - head.center) / np.asarray(head.core.radii)
        face_center = (np.abs(local[:, 0]) < 0.3) & (local[:, 2] > 0.3)
        mouth = head.mouth.distance(points) < 0.1 * unit
        hidden = eye_clearance(anatomy, points) < 0.06 * unit
        value = 0.4 + 0.6 * np.clip(-local[:, 1] + 0.2, 0.0, 1.0)
        return np.where(hidden | face_center | mouth, 0.0, value)

    def comb(self, points: FloatArray, normals: FloatArray) -> FloatArray:
        center = self._anatomy.head.center
        outward = points - center
        outward[:, 2] = 0.0
        down = np.array([0.0, -1.0, 0.4])
        t = np.clip(-(points[:, 1:2] - center[1]) / (0.6 * self._anatomy.unit), 0.0, 1.0)
        return normalized(outward) * (1.0 - t) + down[None, :] * t


def ground_hairs(anatomy: FlyAnatomy, mesh: ShadedMesh, field: Sdf, count: int, coat: Coat, rng: np.random.Generator) -> list[Bristle]:
    """Kurze Grundhaare, verteilt und gekämmt nach dem Haarkleid ``coat``."""
    points, _ = scatter(mesh, count, coat.density, rng)
    if len(points) == 0:
        return []
    hair, unit = anatomy.species.hair, anatomy.unit
    combs = coat.comb(points, field.gradient_normals(points))
    roots, normals, directions = settle(field, points, combs, np.full(len(points), 0.62))
    lengths = (0.34 + 0.16 * rng.random(len(points))) * unit * hair.ground_length
    radii = np.full(len(points), 0.03 * unit * hair.thickness)
    return make_bristles(roots, normals, directions, lengths, radii, GROUND_STATIONS)
