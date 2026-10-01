"""Oberflächen der Körperhülle je Texel (Bemalung).

Jeder Texel gehört weich gewichtet zu einer Zone: Pelz von Kopf, Brust und Taille, Hals,
Hinterleibsplatten oder Stachel. Farben kommen aus dem CSS-Vorbild (``beekit.look.Swatch``). Der
Pelz der Biene (Kopf, Brust) trägt Faserstrich und Sheen, die Platten des Hinterleibs glänzen wie
bei Wespen. Ränder des Vorbilds — Kopf zum Hals, Brust zur Taille, Plattenkanten und der dunkle
Rand der Augenhöhlen — sind gemalte Linien. Leuchtmasken für die Varianten Night, Laser und Ghost
enthalten bereits ihre Farben.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from modelkit.baking import TexelMap
from modelkit.noise import Fractal
from modelkit.shading import smoothstep

from beekit.anatomy import PX
from beekit.body import BodyField
from beekit.limbs import stinger_distance
from beekit.look import Swatch

type FloatArray = npt.NDArray[np.float64]

FIBER_LENGTH = 0.003  # m, Grundwellenlänge des Faserstrichs
FIBER_STRETCH = 0.22  # Fasern laufen entlang der Körperachse (z gestaucht = längere Strähnen)
ZONE_SOFTNESS = 0.35 * PX  # Übergangsbreite zwischen Zonen
RIM_HALF_WIDTH = 0.6 * PX  # halbe Breite der Plattenkante


def _normalized(vectors: FloatArray) -> FloatArray:
    return vectors / np.maximum(np.linalg.norm(vectors, axis=-1, keepdims=True), 1e-12)


def _mix(base: FloatArray, color: tuple[float, float, float] | FloatArray, weight: FloatArray) -> FloatArray:
    return base * (1.0 - weight[:, None]) + np.asarray(color)[None, :] * weight[:, None]


@dataclass(frozen=True, slots=True)
class PaintedShell:
    """Gemalte Texelwerte der Körperhülle (Bemalung).

    ``color``, ``sheen`` und die Leuchtmasken sind linear RGB; ``roughness`` 0..1; ``normals``
    Detailnormalen in Weltkoordinaten.
    """

    color: FloatArray
    roughness: FloatArray
    normals: FloatArray
    sheen: FloatArray
    night: FloatArray
    laser: FloatArray
    ghost: FloatArray


class ShellPainter:
    """Malt die Körperhülle aus Weltposition, Normale und Verdeckung je Texel (Hüllenmaler)."""

    def __init__(self, field: BodyField, seed: int = 5) -> None:
        self._field = field
        self._fibers = Fractal(seed, frequency=1.0 / FIBER_LENGTH, octaves=4, gain=0.55)
        self._tufts = Fractal(seed + 1, frequency=1.0 / 0.018, octaves=3)

    def fur_height(self, points: FloatArray) -> FloatArray:
        """Höhenfeld der Pelzstruktur, etwa −1..1: Strähnen entlang der Körperachse plus Büschel."""
        fibers = self._fibers(points * np.array([1.0, 1.0, FIBER_STRETCH])) / 0.35
        tufts = self._tufts(points) / 0.35
        return np.clip(0.75 * fibers + 0.25 * tufts, -1.5, 1.5)

    def paint(self, texels: TexelMap, occlusion: FloatArray) -> PaintedShell:
        """Bemalt alle Texel der Körperhülle."""
        field, anatomy = self._field, self._field.anatomy
        points, normals = texels.positions, texels.normals
        height = self.fur_height(points)
        zones = {
            "chitin": stinger_distance(anatomy.stinger, points),
            "head": field.head_distance(points),
            "neck": anatomy.neck.distance(points),
            "thorax": anatomy.thorax.distance(points),
            "waist": anatomy.waist.distance(points),
            "abdomen": field.abdomen_distance(points),
        }
        stacked = np.stack(list(zones.values()), axis=1)
        weights = np.exp(-(stacked - stacked.min(axis=1, keepdims=True)) / ZONE_SOFTNESS)
        weights /= weights.sum(axis=1, keepdims=True)
        weight = {name: weights[:, index] for index, name in enumerate(zones)}

        band = field.bands(points[:, 2])
        dark = (band.index >= 0) & (band.index % 2 == 0)
        edges = anatomy.band_edges()[:-1]
        edge_distance = np.min(np.abs(points[:, 2][:, None] - edges[None, :]), axis=1)
        rim = (1.0 - smoothstep(RIM_HALF_WIDTH * 0.6, RIM_HALF_WIDTH, edge_distance)) * weight["abdomen"]

        fur, collar, stripe = np.asarray(Swatch.FUR.linear), np.asarray(Swatch.COLLAR.linear), np.asarray(Swatch.STRIPE.linear)
        zone_color = {
            "chitin": np.broadcast_to(np.asarray(Swatch.CHITIN.linear), points.shape),
            "head": np.broadcast_to(fur, points.shape),
            "neck": np.broadcast_to(collar, points.shape),
            "thorax": np.broadcast_to(fur, points.shape),
            "waist": np.broadcast_to(fur, points.shape),
            "abdomen": np.where(dark[:, None], stripe[None, :], fur[None, :]),
        }
        color = sum(weight[name][:, None] * zone_color[name] for name in zones)
        # Faserstrich (Pelz stark, Platten schwach), Lichtverlauf von oben, eingebackene Verdeckung
        fiber_contrast = 0.2 * (weight["head"] + weight["thorax"] + weight["waist"] + weight["neck"])
        fiber_contrast += weight["abdomen"] * np.where(dark, 0.08, 0.14)
        color = color * (1.0 + fiber_contrast[:, None] * height[:, None])
        # Im Gesicht nur schwache eingebackene Verdeckung: keine dunklen Ringe um die Augen
        shade = 0.2 - 0.1 * weight["head"]
        color *= (0.93 + 0.08 * normals[:, 1:2]) * (1.0 - shade * (1.0 - occlusion))[:, None]

        roughness = (
            weight["head"] * 0.78 + weight["thorax"] * 0.82 + weight["waist"] * 0.74 + weight["neck"] * 0.86
            + weight["abdomen"] * np.where(dark, 0.4, 0.56) + weight["chitin"] * 0.26
        )  # fmt: skip
        roughness += 0.05 * height * (1.0 - weight["chitin"])

        outline = np.asarray(Swatch.OUTLINE.linear)
        # Ränder des Vorbilds: Kopf zum Hals, Brust zur Taille (weich, olivbraun), Plattenkanten
        color = _mix(color, outline, 0.75 * np.clip(4.0 * weight["head"] * weight["neck"], 0.0, 1.0))
        color = _mix(color, outline, 0.7 * np.clip(4.0 * weight["thorax"] * weight["waist"], 0.0, 1.0))
        color = _mix(color, outline, rim)
        roughness = roughness * (1.0 - rim) + 0.48 * rim
        socket = self._socket_line(points)
        color = _mix(color, np.asarray(Swatch.CHITIN.linear), socket)
        roughness = roughness * (1.0 - socket) + 0.5 * socket
        ocellus = self._ocelli(points) * weight["head"]
        color = _mix(color, np.asarray(Swatch.OCELLUS.linear), ocellus)
        roughness = roughness * (1.0 - ocellus) + 0.12 * ocellus

        bump = (
            weight["thorax"] * 1.0 + weight["neck"] * 1.2 + weight["waist"] * 0.7 + weight["head"] * self._face_fur(points)
            + weight["abdomen"] * np.where(dark, 0.25, 0.45) + weight["chitin"] * 0.05
        ) * (1.0 - rim * 0.6) * (1.0 - socket)  # fmt: skip
        detail = self._detail_normals(points, normals, bump * 1.0e-4)

        fur_sheen = (weight["head"] + weight["thorax"] + weight["waist"]) * (1.0 - socket)
        sheen = (
            np.asarray(Swatch.SHEEN.scaled(0.55))[None, :] * fur_sheen[:, None]
            + np.asarray(Swatch.STRIPE_SHEEN.scaled(0.45))[None, :] * weight["neck"][:, None]
            + np.where(dark[:, None], np.asarray(Swatch.STRIPE_SHEEN.scaled(0.3))[None, :], np.asarray(Swatch.SHEEN.scaled(0.45))[None, :])
            * weight["abdomen"][:, None]
        )
        stripe_glow = weight["abdomen"] * dark * (0.4 + 0.6 * occlusion**1.2) * (1.0 - rim)
        night = np.asarray(Swatch.NIGHT_STRIPE.linear)[None, :] * stripe_glow[:, None] + np.asarray(Swatch.NIGHT_RIM.linear)[None, :] * rim[:, None]
        # Laser: Kanten der Platten glühen rot mit weichem Saum (der box-shadow des Vorbilds)
        halo = (1.0 - smoothstep(RIM_HALF_WIDTH, 4.0 * RIM_HALF_WIDTH, edge_distance)) * weight["abdomen"]
        laser = np.asarray(Swatch.LASER.linear)[None, :] * np.maximum(rim, 0.45 * halo**1.5)[:, None]
        ghost_level = np.clip(0.22 + 0.5 * rim + 0.45 * socket, 0.0, 1.0)
        ghost = np.asarray(Swatch.GHOST_EDGE.linear)[None, :] * ghost_level[:, None]
        return PaintedShell(np.clip(color, 0.0, 1.0), np.clip(roughness, 0.05, 1.0), detail, sheen, night, laser, ghost)

    def _face_fur(self, points: FloatArray) -> FloatArray:
        """Pelztiefe am Kopf: kurz im Gesicht (um Augen und Mund), dichter am Hinterkopf."""
        toward_face = _normalized(points - self._field.anatomy.head.center)[:, 2]
        return 0.6 - 0.35 * smoothstep(0.2, 0.75, toward_face)

    def _socket_line(self, points: FloatArray) -> FloatArray:
        """Augenrand wie im Vorbild: dunkle Höhlenwand und feine Linie am Höhlenrand, oben etwas kräftiger."""
        line = np.zeros(len(points))
        for eye in self._field.anatomy.eyes:
            distance = np.linalg.norm(points - eye.center, axis=1) - eye.radius
            upper = smoothstep(0.2, 0.8, (points[:, 1] - eye.center[1]) / eye.radius)
            width = (0.75 + 0.45 * upper) * PX
            ramp = np.clip((distance - 0.3 * PX) / (width - 0.3 * PX), 0.0, 1.0)
            line = np.maximum(line, 1.0 - ramp)
        return line * line * (3.0 - 2.0 * line)

    def _ocelli(self, points: FloatArray) -> FloatArray:
        """Drei Punktaugen auf dem Scheitel."""
        anatomy = self._field.anatomy
        weight = np.zeros(len(points))
        for u, v in anatomy.ocelli:
            center = anatomy.head.center + anatomy.head_radius * anatomy.face_direction(u, v)
            distance = np.linalg.norm(points - center, axis=1)
            weight = np.maximum(weight, 1.0 - smoothstep(0.6 * PX, 0.9 * PX, distance))
        return weight

    def _detail_normals(self, points: FloatArray, normals: FloatArray, bump: FloatArray) -> FloatArray:
        """Normalen der Faserstruktur: Gradient des Höhenfeldes, auf die Fläche projiziert."""
        step = 0.0005
        base = self.fur_height(points)
        gradient = np.stack([(self.fur_height(points + step * axis) - base) / step for axis in np.eye(3)], axis=1)
        tangential = gradient - normals * np.einsum("ij,ij->i", gradient, normals)[:, None]
        return _normalized(normals - bump[:, None] * tangential)
