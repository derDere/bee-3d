"""Bewegliche Augäpfel der Biene mit aufgemalter Pupille (Augen).

Jeder Augapfel ist eine Kugel um seinen Mittelpunkt (Pivot) und sitzt mit etwas Luft in seiner
Augenhöhle. Dreht das Spiel den Knoten, wandert die Pupille mit — wie die gedrehten Augen des
Vorbilds beim Laser. Die UVs projizieren polar um die Blickrichtung (nahtlos, Pupille in der
Bildmitte); Tag, Laser und Geist tauschen nur die Textur.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from modelkit.shading import linear_to_srgb, smoothstep

from beekit.anatomy import Eye
from beekit.look import Swatch

type FloatArray = npt.NDArray[np.float64]
type IndexArray = npt.NDArray[np.int64]
type ByteImage = npt.NDArray[np.uint8]

UV_REACH_DEGREES = 125.0  # Winkel zur Blickrichtung, der auf den Bildrand fällt (dahinter liegt die Höhle)
IRIS_DEGREES = (17.0, 27.0)  # Iris zwischen dunkler Mitte und dunklem Rand (Winkel zur Blickrichtung)
GHOST_EYE_DEGREES = (36.0, 44.0)  # Geisterauge: dunkles Hochoval (quer, hoch), Ø 7 px wie im Vorbild
GHOST_EYE_DROOP = 7.0  # Geisterauge sitzt tiefer (müder, leicht gruseliger Blick)
CATCHLIGHTS = (((-0.18, 0.22), 0.085), ((0.17, -0.16), 0.035))  # (Lage quer/hoch, Radius) im Augenrahmen


def _normalized(vectors: FloatArray) -> FloatArray:
    return vectors / np.maximum(np.linalg.norm(vectors, axis=-1, keepdims=True), 1e-12)


def eye_frame(gaze: FloatArray) -> FloatArray:
    """Rahmen des Auges: z = Blickrichtung, x waagrecht (Weltrichtung +X), y nach oben (Spalten = Achsen)."""
    z = _normalized(gaze)
    x = _normalized(np.cross([0.0, 1.0, 0.0], z))
    return np.stack([x, np.cross(z, x), z], axis=1)


@dataclass(frozen=True, slots=True)
class EyeballMesh:
    """Augapfel im eigenen Rahmen (Ursprung = Augenmitte) mit polaren UVs (Augapfelnetz)."""

    vertices: FloatArray
    normals: FloatArray
    faces: IndexArray
    uvs: FloatArray


def eyeball_mesh(eye: Eye, rings: int = 14, segments: int = 32) -> EyeballMesh:
    """Kugel um die Blickrichtung: Pol vorn in der Pupille, Ringe zur Höhle hin gröber."""
    frame = eye_frame(eye.gaze)
    theta = np.pi * (np.arange(1, rings) / rings) ** 1.25
    phi = 2.0 * np.pi * np.arange(segments) / segments
    local = np.stack(
        [
            (np.sin(theta)[:, None] * np.cos(phi)[None, :]).ravel(),
            (np.sin(theta)[:, None] * np.sin(phi)[None, :]).ravel(),
            np.repeat(np.cos(theta), segments),
        ],
        axis=1,
    )
    directions = np.concatenate([[[0.0, 0.0, 1.0]], local, [[0.0, 0.0, -1.0]]]) @ frame.T
    faces = []
    back = 1 + (rings - 1) * segments
    for j in range(segments):
        k = (j + 1) % segments
        faces.append((0, 1 + j, 1 + k))
        for ring in range(rings - 2):
            a, b = 1 + ring * segments + j, 1 + ring * segments + k
            c, d = a + segments, b + segments
            faces += [(a, c, d), (a, d, b)]
        last = 1 + (rings - 2) * segments
        faces.append((last + j, back, last + k))
    return EyeballMesh(directions * eye.radius, directions, np.asarray(faces, dtype=np.int64), eye_uvs(directions, frame))


def eye_uvs(directions: FloatArray, frame: FloatArray) -> FloatArray:
    """Polare UVs um die Blickrichtung; vom Betrachter aus links oben = Bild links oben."""
    local = directions @ frame
    angle = np.arccos(np.clip(local[:, 2], -1.0, 1.0))
    radius = 0.5 * np.minimum(angle / np.radians(UV_REACH_DEGREES), 1.0)
    heading = np.arctan2(local[:, 1], local[:, 0])
    return np.stack([0.5 + radius * np.cos(heading), 0.5 - radius * np.sin(heading)], axis=1)


@dataclass(frozen=True, slots=True)
class EyeImages:
    """Texturen der Augäpfel: Tag, Leuchtmaske Laser, Geist (RGBA) und Leuchtmaske Geist (Augentexturen)."""

    day: ByteImage
    laser: ByteImage
    ghost: ByteImage
    ghost_glow: ByteImage


def _to_bytes(values: FloatArray) -> ByteImage:
    return np.round(np.clip(values, 0.0, 1.0) * 255.0).astype(np.uint8)


def eye_textures(resolution: int = 256) -> EyeImages:
    """Comic-Augen: warmes Weiß, große dunkle Pupille mit warmer Iris und zwei festen Glanzlichtern.

    Geist: das Weiß wird durchscheinend cyan, die Pupille zum dunklen, tiefer sitzenden Hochoval mit
    leuchtendem Lichtpunkt. Laser: die Pupille leuchtet rot.
    """
    centers = (np.arange(resolution) + 0.5) / resolution
    u, v = np.meshgrid(centers, centers)
    du, dv = u - 0.5, 0.5 - v
    angle = np.radians(UV_REACH_DEGREES) * np.minimum(2.0 * np.hypot(du, dv), 1.0)
    heading = np.arctan2(dv, du)
    # Lage auf dem Augapfel im Augenrahmen (quer, hoch) und Winkel zur Blickrichtung in Grad
    across, up = np.sin(angle) * np.cos(heading), np.sin(angle) * np.sin(heading)
    degrees = np.degrees(angle)

    pupil = 1.0 - smoothstep(IRIS_DEGREES[1] + 2.5, IRIS_DEGREES[1] + 4.0, degrees)
    iris = smoothstep(IRIS_DEGREES[0] - 2.0, IRIS_DEGREES[0] + 2.0, degrees) * (1.0 - smoothstep(IRIS_DEGREES[1] - 1.5, IRIS_DEGREES[1] + 1.0, degrees))
    glint = np.zeros_like(degrees)
    for (cx, cy), radius in CATCHLIGHTS:
        glint = np.maximum(glint, 1.0 - smoothstep(radius * 0.8, radius, np.hypot(across - cx, up - cy)))
    sclera = np.asarray(Swatch.EYE.linear)[None, None, :] * (1.0 - 0.18 * smoothstep(70.0, 115.0, degrees))[..., None]
    pupil_color = np.asarray(Swatch.PUPIL.linear)[None, None, :] * (1.0 - iris[..., None]) + np.asarray(Swatch.IRIS.linear)[None, None, :] * iris[..., None]
    day = sclera * (1.0 - pupil[..., None]) + pupil_color * pupil[..., None]
    day = day * (1.0 - glint[..., None]) + np.asarray(Swatch.GLINT.linear)[None, None, :] * glint[..., None]
    laser = np.asarray(Swatch.LASER.linear)[None, None, :] * (pupil * (1.0 - glint))[..., None]

    droop = np.radians(GHOST_EYE_DROOP)
    oval = np.hypot(np.degrees(np.arcsin(np.clip(across, -1.0, 1.0))) / GHOST_EYE_DEGREES[0], np.degrees(np.arcsin(np.clip(up + np.sin(droop), -1.0, 1.0))) / GHOST_EYE_DEGREES[1])
    hollow = 1.0 - smoothstep(0.92, 1.0, oval)
    ghost_glint = 1.0 - smoothstep(0.035, 0.05, np.hypot(across + 0.12, up - 0.08))
    ghost_rgb = np.asarray(Swatch.GHOST_FILL.linear)[None, None, :] * (1.0 - hollow[..., None]) + np.asarray(Swatch.GHOST_EYE.linear)[None, None, :] * hollow[..., None]
    ghost_rgb = ghost_rgb * (1.0 - ghost_glint[..., None]) + np.asarray(Swatch.GHOST_GLINT.linear)[None, None, :] * ghost_glint[..., None]
    ghost_alpha = 0.3 + 0.62 * hollow + 0.08 * ghost_glint
    ghost_glow = np.asarray(Swatch.GHOST_GLINT.linear)[None, None, :] * np.clip(ghost_glint + 0.18 * (1.0 - hollow), 0.0, 1.0)[..., None]
    return EyeImages(
        day=_to_bytes(linear_to_srgb(day)),
        laser=_to_bytes(linear_to_srgb(laser)),
        ghost=_to_bytes(np.concatenate([linear_to_srgb(ghost_rgb), ghost_alpha[..., None]], axis=2)),
        ghost_glow=_to_bytes(linear_to_srgb(ghost_glow)),
    )
