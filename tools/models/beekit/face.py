"""Mund der Biene als Aufleger auf dem Kopf, mit Formzielen für Lasermund und Geistermund (Gesicht).

Der Aufleger liegt knapp über der Körperhülle und durchdringt sie nicht, damit durchscheinende
Zustände sauber bleiben. Er besteht aus der Mundfläche und einem Lippenwulst.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from modelkit.gltf_writer import MorphTarget
from modelkit.sweep import sweep_closed_tube

from beekit.anatomy import PX, BeeAnatomy
from beekit.body import BodyField

type FloatArray = npt.NDArray[np.float64]
type IndexArray = npt.NDArray[np.int64]


@dataclass(frozen=True, slots=True)
class DecalMesh:
    """Aufleger mit Formzielen: Grundform und je Ziel vollständige Positionen und Normalen (Aufleger)."""

    vertices: FloatArray
    normals: FloatArray
    faces: IndexArray
    targets: dict[str, tuple[FloatArray, FloatArray]]

    def translated(self, offset: FloatArray) -> DecalMesh:
        """Verschiebt Grundform und Ziele in den Rahmen eines Knotens."""
        return DecalMesh(
            self.vertices - offset,
            self.normals,
            self.faces,
            {name: (positions - offset, normals) for name, (positions, normals) in self.targets.items()},
        )

    def morph_targets(self) -> tuple[MorphTarget, ...]:
        """Formziele als Verschiebungen gegenüber der Grundform."""
        return tuple(
            MorphTarget(name, positions - self.vertices, normals - self.normals)
            for name, (positions, normals) in self.targets.items()
        )


@dataclass(frozen=True, slots=True)
class MouthDecals:
    """Mundfläche und Lippenwulst mit denselben Formzielen, dazu der Strahlursprung (Mundaufleger)."""

    fill: DecalMesh
    rim: DecalMesh
    laser_origin: FloatArray


def _smile_shape(anatomy: BeeAnatomy, s: FloatArray, w: FloatArray) -> FloatArray:
    mouth = anatomy.mouth
    phi = np.pi + np.pi * s
    half = 0.5 * mouth.smile_thickness * np.sin(np.pi * s) ** 0.45
    radius = mouth.smile_radius - w[None, :] * half[:, None]
    cu, cv = mouth.smile_center
    # Mundwinkel leicht nach oben gezogen: freundlicheres Lächeln
    lift = 0.6 * (np.cos(np.pi * s) ** 8)[:, None]
    return np.stack([cu + radius * np.cos(phi)[:, None], cv + radius * np.sin(phi)[:, None] + lift], axis=-1)


def _shout_shape(anatomy: BeeAnatomy, s: FloatArray, w: FloatArray) -> FloatArray:
    mouth = anatomy.mouth
    width, height = mouth.shout_size
    top_radius, bottom_radius = mouth.shout_corners
    u = -0.5 * width * np.cos(np.pi * s)
    reach = np.abs(u)
    top = np.where(
        reach <= 0.5 * width - top_radius,
        0.5 * height,
        0.5 * height - top_radius + np.sqrt(np.clip(top_radius**2 - (reach - (0.5 * width - top_radius)) ** 2, 0.0, None)),
    )
    bottom = np.where(
        reach <= 0.5 * width - bottom_radius,
        -0.5 * height,
        -0.5 * height + bottom_radius - np.sqrt(np.clip(bottom_radius**2 - (reach - (0.5 * width - bottom_radius)) ** 2, 0.0, None)),
    )
    middle, half = 0.5 * (top + bottom), 0.5 * (top - bottom)
    cu, cv = mouth.shout_center
    v = cv + middle[:, None] + w[None, :] * half[:, None]
    return np.stack([np.broadcast_to(cu + u[:, None], v.shape), v], axis=-1)


def _ghost_shape(anatomy: BeeAnatomy, s: FloatArray, w: FloatArray) -> FloatArray:
    mouth = anatomy.mouth
    width, height = mouth.ghost_size
    u = -0.5 * width * np.cos(np.pi * s)
    top = height * np.sqrt(np.clip(1.0 - (2.0 * u / width) ** 2, 0.0, None))
    v = mouth.ghost_base + 0.5 * top[:, None] * (1.0 + w[None, :])
    return np.stack([np.broadcast_to(u[:, None], v.shape), v], axis=-1)


def _on_surface(field: BodyField, anatomy: BeeAnatomy, shape: FloatArray, lift: float) -> tuple[FloatArray, FloatArray]:
    """Projiziert Gesichtskoordinaten (Bogenpixel) auf die Kopfhülle und hebt sie entlang der Normale an."""
    guess = anatomy.head.center + anatomy.head_radius * anatomy.face_direction(shape[..., 0], shape[..., 1]).reshape(-1, 3)
    surface = field.project_to_surface(guess, iterations=6)
    normals = field.gradient_normals(surface)
    return surface + normals * lift, normals


def mouth_decals(field: BodyField, along: int = 28, across: int = 4, rim_sides: int = 5) -> MouthDecals:
    """Mund als Aufleger: Grundform Lächeln, Ziele ``Shout`` (Laser) und ``Ghost`` (Geist).

    Alle Formen teilen ein Raster (s entlang, w quer); die Ränder laufen an den Enden in einem Punkt
    zusammen. Der rote Lippenwulst hat nur in ``Shout`` Dicke, sonst liegt er flach im Umriss.
    """
    anatomy = field.anatomy
    lift = anatomy.mouth.lift * PX
    s = 0.5 * (1.0 - np.cos(np.pi * np.arange(along + 1) / along))
    w = np.linspace(-1.0, 1.0, across + 1)
    shapes = {
        "Smile": _smile_shape(anatomy, s, w),
        "Shout": _shout_shape(anatomy, s, w),
        "Ghost": _ghost_shape(anatomy, s, w),
    }
    grid = np.arange((along + 1) * (across + 1)).reshape(along + 1, across + 1)
    a, b = grid[:-1, :-1].ravel(), grid[1:, :-1].ravel()
    c, d = grid[:-1, 1:].ravel(), grid[1:, 1:].ravel()
    faces = np.concatenate([np.stack([a, b, c], axis=1), np.stack([b, d, c], axis=1)]).astype(np.int64)

    def rim(shape: FloatArray, radius: float) -> tuple[FloatArray, FloatArray, IndexArray]:
        # Umriss: Unterkante von links nach rechts, Oberkante zurück; die Endpunkte sind gemeinsam
        outline = np.concatenate([shape[:, 0], shape[-2:0:-1, -1]])
        points, normals = _on_surface(field, anatomy, outline, lift)
        tube = sweep_closed_tube(points, np.full(len(points), radius), normals, rim_sides)
        return tube.vertices, tube.normals, tube.faces

    surfaces = {name: _on_surface(field, anatomy, shape, lift) for name, shape in shapes.items()}
    fill = DecalMesh(*surfaces["Smile"], faces, {name: surfaces[name] for name in ("Shout", "Ghost")})
    base_vertices, base_normals, rim_faces = rim(shapes["Smile"], 0.0)
    rim_targets = {}
    for name, radius in (("Shout", anatomy.mouth.shout_rim * PX), ("Ghost", 0.0)):
        vertices, normals, _ = rim(shapes[name], radius)
        rim_targets[name] = (vertices, normals)
    rim_mesh = DecalMesh(base_vertices, base_normals, rim_faces, rim_targets)
    center = np.array([list(anatomy.mouth.shout_center)])[:, None, :]
    origin, normal = _on_surface(field, anatomy, center, 0.0)
    return MouthDecals(fill, rim_mesh, origin[0] + normal[0] * 2.0 * PX)
