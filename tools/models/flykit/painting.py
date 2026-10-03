"""Bemalung des Chitin-Atlas je Texel: Farbe, Rauheit, Metallizität, Detailnormalen, Samtschimmer (Bemalung).

Jeder Texel kennt sein Teil (Rumpf, Kopf, Rüssel, Bein) und seine Weltposition in Ruhehaltung.

- **Rumpf:** metallischer Panzer mit Farbverschiebung zu den Flanken, dunklen Plattenrändern,
  Quernaht, feiner Punktierung (Normal-Map) und Stigmen; je nach Art Längsstreifen,
  Schachbrett-Bestäubung oder glänzende Zwischenhäute; Schwingkölbchen hell mit dunklem Köpfchen.
- **Kopf:** samtschwarzer Stirnstreifen, bestäubtes Gesicht, Wangen, metallischer Hinterkopf,
  glänzende Punktaugen, Fühler, dunkle Mundhöhle.
- **Rüssel:** häutiger Schaft mit Ringen, glänzender Endteil, nasse Tupfpolster mit Rillen,
  Speicheltropfen.
- **Beine:** schwarzes, fein behaartes Chitin mit braunen Gelenken, glänzenden Krallen und
  hellen Haftlappen.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from modelkit.baking import TexelMap
from modelkit.noise import Cellular, Fractal
from modelkit.sdf import TubeChain
from modelkit.shading import smoothstep
from scipy.spatial import cKDTree

from flykit.anatomy import MIRROR, FlyAnatomy, normalized
from flykit.atlas import ChitinAtlas, PartKind
from flykit.fields import BodyField
from flykit.limbs import Foot, LegAxis
from flykit.species import linear

type FloatArray = npt.NDArray[np.float64]
type HeightFunction = Callable[[FloatArray], FloatArray]

GRADIENT_STEP = 0.004  # Referenz-mm, Schrittweite der Detailnormalen


@dataclass(frozen=True, slots=True)
class PaintedChitin:
    """Gemalte Texelwerte des Chitin-Atlas (linear RGB, Rauheit, Metallizität, Weltnormalen, Sheen)."""

    color: FloatArray
    roughness: FloatArray
    metallic: FloatArray
    normals: FloatArray
    sheen: FloatArray


@dataclass(slots=True)
class _Layer:
    """Zwischenstand der Bemalung einer Texelgruppe."""

    color: FloatArray
    roughness: FloatArray
    metallic: FloatArray
    sheen: FloatArray
    contact: FloatArray  # Stärke der eingebackenen Kontaktschatten (1 = voll)
    heights: list[tuple[HeightFunction, FloatArray]]  # (Höhenfeld, Amplitude je Texel in m)

    @classmethod
    def blank(cls, count: int) -> _Layer:
        return cls(np.zeros((count, 3)), np.full(count, 0.5), np.zeros(count), np.zeros((count, 3)), np.ones(count), [])

    def paint(self, weight: FloatArray, color: FloatArray, roughness: float | FloatArray, metallic: float | FloatArray) -> None:
        """Mischt eine Zone mit Gewicht 0..1 über den bisherigen Stand."""
        w = np.clip(weight, 0.0, 1.0)
        self.color = self.color * (1.0 - w[:, None]) + np.broadcast_to(color, self.color.shape) * w[:, None]
        self.roughness = self.roughness * (1.0 - w) + roughness * w
        self.metallic = self.metallic * (1.0 - w) + metallic * w


def _mix(a: FloatArray, b: FloatArray, t: FloatArray) -> FloatArray:
    return a * (1.0 - t[:, None]) + b * t[:, None]


class _Canvas:
    """Sammelt die bemalten Texelgruppen zum Gesamtbild des Atlas (Leinwand)."""

    def __init__(self, texels: TexelMap, occlusion: FloatArray) -> None:
        count = texels.count
        self.texels = texels
        self.occlusion = occlusion
        self.color = np.zeros((count, 3))
        self.roughness = np.zeros(count)
        self.metallic = np.zeros(count)
        self.sheen = np.zeros((count, 3))
        self.normals = texels.normals.copy()

    def store(self, mask: npt.NDArray[np.bool_], layer: _Layer, normals: FloatArray) -> None:
        """Übernimmt eine Texelgruppe; eingebackene Kontaktschatten vertiefen Fugen und Gliedansätze."""
        shade = 1.0 - layer.contact * 0.38 * (1.0 - self.occlusion[mask] ** 1.4)
        self.color[mask] = layer.color * shade[:, None]
        self.roughness[mask] = layer.roughness
        self.metallic[mask] = layer.metallic
        self.sheen[mask] = layer.sheen
        self.normals[mask] = normals

    def result(self) -> PaintedChitin:
        """Das fertige Bild mit begrenzten Wertebereichen."""
        return PaintedChitin(
            np.clip(self.color, 0.0, 1.0), np.clip(self.roughness, 0.03, 1.0), np.clip(self.metallic, 0.0, 1.0), self.normals, self.sheen
        )


class ChitinPainter:
    """Malt alle Chitinteile einer Fliege aus Weltposition, Normale und Verdeckung je Texel (Chitinmaler)."""

    def __init__(self, anatomy: FlyAnatomy, body: BodyField) -> None:
        self._anatomy = anatomy
        self._body = body
        unit, seed = anatomy.unit, anatomy.species.seed
        self._unit = unit
        self._pits = Cellular(seed, frequency=1.0 / (0.06 * unit))
        self._grain = Fractal(seed + 1, frequency=1.0 / (0.06 * unit), octaves=3)
        self._mottle = Fractal(seed + 2, frequency=1.0 / (0.9 * unit), octaves=3)
        self._fibers = Fractal(seed + 3, frequency=1.0 / (0.035 * unit), octaves=3, gain=0.55)
        self._veins = Fractal(seed + 4, frequency=1.0 / (0.22 * unit), octaves=3, ridged=True)
        self._legs = {leg.name: (leg, LegAxis.of(leg)) for leg in anatomy.legs}

    def paint(self, texels: TexelMap, atlas: ChitinAtlas, occlusion: FloatArray) -> PaintedChitin:
        """Bemalt alle Texel des Atlas."""
        canvas = _Canvas(texels, occlusion)
        parts = atlas.part_of_face(texels.faces)
        for index, chitin in enumerate(atlas.parts):
            mask = parts == index
            if not np.any(mask):
                continue
            points, normals = texels.positions[mask], texels.normals[mask]
            match chitin.kind:
                case PartKind.BODY:
                    layer = self._paint_body(points, normals, occlusion[mask])
                case PartKind.HEAD:
                    layer = self._paint_head(points, normals, occlusion[mask])
                case PartKind.PROBOSCIS:
                    layer = self._paint_proboscis(points)
                case PartKind.LEG:
                    layer = self._paint_leg(chitin.node, points)
            canvas.store(mask, layer, self._detail_normals(points, normals, layer.heights))
        return canvas.result()

    def _detail_normals(self, points: FloatArray, normals: FloatArray, heights: list[tuple[HeightFunction, FloatArray]]) -> FloatArray:
        """Normalen der Höhenfelder: Gradient per Differenzen, in die Tangentialebene projiziert."""
        step = GRADIENT_STEP * self._unit
        gradient = np.zeros_like(points)
        for height, amplitude in heights:
            base = height(points)
            for axis in range(3):
                offset = np.zeros(3)
                offset[axis] = step
                gradient[:, axis] += amplitude * (height(points + offset) - base) / step
        tangential = gradient - normals * np.einsum("ij,ij->i", gradient, normals)[:, None]
        return normalized(normals - tangential)

    # Höhenfelder (dimensionslos, etwa 0..1)

    def _pitting(self, points: FloatArray) -> FloatArray:
        """Feine Punktierung des Panzers: kleine Grübchen in den Zellmitten."""
        sample = self._pits.evaluate(points)
        return smoothstep(0.0, 0.42, sample.first) + 0.25 * self._grain(points)

    def _wrinkles(self, points: FloatArray) -> FloatArray:
        """Zwischenhaut: Falten und Adern."""
        return self._veins(points)

    # Zonen

    def _paint_body(self, points: FloatArray, normals: FloatArray, occlusion: FloatArray) -> _Layer:
        anatomy, field, unit = self._anatomy, self._body, self._unit
        palette, pattern = anatomy.species.palette, anatomy.species.pattern
        count = len(points)
        layer = _Layer.blank(count)
        thorax_d, abdomen_d = field.thorax_distance(points), field.abdomen_distance(points)
        abdomen_w = 1.0 - smoothstep(-0.12 * unit, 0.12 * unit, abdomen_d - thorax_d)
        mottle = self._mottle(points)

        # Panzer: Grundfarbe, zu den Flanken und auf dem Hinterleib zum zweiten Schillerton verschoben, in Mulden tief
        shift = np.clip(0.45 * np.abs(normals[:, 0]) + 0.3 * abdomen_w + 0.9 * mottle, 0.0, 1.0)
        carapace = _mix(np.broadcast_to(linear(palette.carapace), (count, 3)), np.broadcast_to(linear(palette.carapace_shift), (count, 3)), shift)
        carapace = _mix(carapace, np.broadcast_to(linear(palette.carapace_deep), (count, 3)), np.clip((1.0 - occlusion) * 1.6, 0.0, 0.85))
        carapace *= (0.85 + 0.3 * smoothstep(-0.3, 0.9, normals[:, 1]))[:, None]
        layer.paint(np.ones(count), carapace, 0.24 + 0.06 * mottle, 1.0)
        layer.heights.append((self._pitting, np.full(count, 0.005 * unit)))

        # Brustrücken: Quernaht, Längsstreifen auf Bestäubung (Calliphora)
        thorax = anatomy.thorax
        dorsal = smoothstep(0.15, 0.55, normals[:, 1]) * (1.0 - abdomen_w)
        suture = (1.0 - smoothstep(0.03 * unit, 0.07 * unit, np.abs(points[:, 2] - thorax.suture_z))) * dorsal
        if pattern.thorax_stripes > 0.0:
            x = np.abs(points[:, 0] - float(thorax.scutum.center[0])) / float(thorax.scutum.radii[0])
            stripes = np.maximum(1.0 - smoothstep(0.05, 0.11, np.abs(x - 0.0)), 1.0 - smoothstep(0.05, 0.12, np.abs(x - 0.36)))
            pollen = dorsal * (1.0 - stripes)
            layer.paint(pattern.thorax_stripes * pollen, _mix(carapace, np.broadcast_to(linear(pattern.pollinose), (count, 3)), np.full(count, 0.45)), 0.5, 0.55)
            layer.paint(pattern.thorax_stripes * stripes * dorsal, np.broadcast_to(linear(palette.carapace_deep) * 0.6, (count, 3)), 0.32, 0.9)
        layer.paint(0.85 * suture, np.broadcast_to(linear(palette.carapace_rim), (count, 3)), 0.4, 0.7)

        # Hinterleib: dunklere Plattenränder (metallisch, damit das Schillern im Farbton bleibt),
        # Schachbrett-Bestäubung, gedehnte Zwischenhäute
        abdomen = anatomy.abdomen
        edges = abdomen.band_edges[1:-1]
        edge_distance = np.min(np.abs(abdomen.axial(points)[:, None] - edges[None, :]), axis=1)
        rim = (1.0 - smoothstep(0.04 * unit, 0.12 * unit, edge_distance)) * abdomen_w * (1.0 - abdomen.bloat)
        rim_color = _mix(carapace, np.broadcast_to(linear(palette.carapace_rim), (count, 3)), np.full(count, 0.6))
        layer.paint(0.85 * rim, rim_color, 0.3, 1.0)
        if pattern.tessellation > 0.0:
            band = field.bands(points)
            checker = np.sin(np.pi * points[:, 0] / (0.55 * unit)) * np.where(band.index % 2 == 0, 1.0, -1.0)
            patches = smoothstep(-0.35, 0.55, checker + 1.6 * mottle) * abdomen_w * (1.0 - rim)
            silver = _mix(carapace, np.broadcast_to(linear(pattern.pollinose), (count, 3)), np.full(count, 0.55))
            layer.paint(pattern.tessellation * patches, silver, 0.55, 0.45)
        membrane = field.membrane_weight(points) * abdomen_w
        if np.any(membrane > 0.0):
            veins = self._wrinkles(points)
            vein = smoothstep(0.66, 0.9, veins)
            tissue = _mix(np.broadcast_to(linear(palette.membrane), (count, 3)), np.broadcast_to(linear(palette.membrane) * 0.2, (count, 3)), vein)
            layer.paint(membrane, tissue, 0.08 + 0.25 * vein, 0.0)
            layer.heights.append((self._wrinkles, 0.02 * unit * membrane))

        # Stigmen (Atemöffnungen) an Brustflanke und Hinterleibsseiten
        layer.paint(self._spiracles(points), np.broadcast_to(linear(palette.accent) * 0.35, (count, 3)), 0.6, 0.0)

        # Halsstummel: dunkle Haut
        neck = 1.0 - smoothstep(0.0, 0.12 * unit, thorax.neck.distance(points) + 0.05 * unit)
        layer.paint(neck * (points[:, 2] > float(thorax.neck.center[2]) - 0.2 * unit), np.broadcast_to(linear(palette.leg_joint) * 0.6, (count, 3)), 0.65, 0.0)

        # Schwingkölbchen: heller Stiel, dunkles Köpfchen
        for halter in thorax.halteres:
            stalk = TubeChain(halter.path, halter.radii * 1.6).distance(points)
            knob = np.linalg.norm(points - halter.knob_center, axis=1) - halter.knob_radius
            layer.paint(1.0 - smoothstep(0.0, 0.04 * unit, stalk), np.broadcast_to(linear(palette.pulvillus), (count, 3)), 0.5, 0.0)
            layer.paint(1.0 - smoothstep(0.0, 0.04 * unit, knob), np.broadcast_to(linear(palette.leg_joint), (count, 3)), 0.42, 0.0)

        if anatomy.species.sheen is not None:
            pile = (1.0 - abdomen_w) * smoothstep(-0.2, 0.6, normals[:, 1])
            layer.sheen = np.broadcast_to(linear(anatomy.species.sheen), (count, 3)) * (0.85 * pile)[:, None]
        return layer

    def _spiracles(self, points: FloatArray) -> FloatArray:
        """Kleine ovale Stigmen: eines vorn an der Brustflanke, je eines seitlich auf den Rückenplatten."""
        anatomy, unit = self._anatomy, self._unit
        scutum, abdomen = anatomy.thorax.scutum, anatomy.abdomen
        centers = [np.asarray(scutum.center) + np.array([0.9, 0.12, 0.5]) * np.asarray(scutum.radii)]
        radii = np.asarray(abdomen.ellipsoid.radii)
        for front, back in zip(abdomen.band_edges[:-2], abdomen.band_edges[1:-1], strict=True):
            z = 0.5 * (front + back)
            scale = np.sqrt(max(1.0 - (z / radii[2]) ** 2, 0.05))
            centers.append(abdomen.at(np.array([0.93 * radii[0] * scale, -0.25 * radii[1] * scale, z]))[0])
        left = np.stack(centers)
        all_centers = np.concatenate([left, left * MIRROR])
        distance, _ = cKDTree(all_centers).query(points)
        return 1.0 - smoothstep(0.06 * unit, 0.1 * unit, distance)

    def _paint_head(self, points: FloatArray, normals: FloatArray, occlusion: FloatArray) -> _Layer:
        anatomy, unit = self._anatomy, self._unit
        palette, head = anatomy.species.palette, anatomy.head
        count = len(points)
        scale = anatomy.species.proportions.head
        layer = _Layer.blank(count)
        hc, hr = head.center, np.asarray(head.core.radii)
        local = (points - hc) / hr
        mottle = self._mottle(points)

        # Grundton: metallischer Hinterkopf
        occiput = _mix(np.broadcast_to(linear(palette.occiput), (count, 3)), np.broadcast_to(linear(palette.carapace_deep), (count, 3)), np.clip(1.2 * (1.0 - occlusion), 0.0, 0.8))
        layer.paint(np.ones(count), occiput, 0.3 + 0.05 * mottle, 0.85)
        layer.heights.append((self._pitting, np.full(count, 0.008 * unit)))
        # Wangen unter den Augen, bestäubtes Gesicht vorn unten samt Augenrändern
        genae = np.min([gena.distance(points) for gena in head.genae], axis=0)
        cheek = (1.0 - smoothstep(-0.05 * unit, 0.18 * unit, genae)) * smoothstep(-0.6, -0.1, local[:, 2])
        layer.paint(cheek, np.broadcast_to(linear(palette.gena), (count, 3)), 0.6, 0.15)
        face = (1.0 - smoothstep(0.05 * unit, 0.3 * unit, head.face.distance(points))) * smoothstep(0.2, 0.55, local[:, 2])
        face *= 1.0 - smoothstep(0.1, 0.3, local[:, 1])
        layer.paint(face, np.broadcast_to(linear(palette.face), (count, 3)), 0.5, 0.3)
        # Samtschwarzer Stirnstreifen zwischen den Augen, von den Fühlern bis zum Scheitel
        frons = (1.0 - smoothstep(0.22, 0.34, np.abs(local[:, 0]))) * smoothstep(0.05, 0.22, local[:, 1]) * smoothstep(-0.3, 0.1, local[:, 2])
        layer.paint(frons, np.broadcast_to(linear(palette.frons), (count, 3)), 0.88, 0.0)
        layer.contact = 1.0 - 0.6 * np.maximum(face, frons)
        # Punktaugen auf dem Scheitel
        ocelli = np.min([np.linalg.norm(points - ocellus, axis=1) for ocellus in head.ocelli], axis=0)
        layer.paint(1.0 - smoothstep(0.07 * unit * scale, 0.1 * unit * scale, ocelli), np.broadcast_to(linear(palette.eye_deep), (count, 3)), 0.08, 0.0)
        # Mundhöhle dunkel
        mouth = 1.0 - smoothstep(0.0, 0.15 * unit, head.mouth.distance(points) - 0.05 * unit)
        layer.paint(mouth, np.broadcast_to(linear(palette.proboscis) * 0.5, (count, 3)), 0.65, 0.0)
        # Fühler
        antenna = np.min([TubeChain(a.path, a.radii).distance(points) for a in anatomy.antennae], axis=0)
        layer.paint(1.0 - smoothstep(0.0, 0.04 * unit, antenna), np.broadcast_to(_mix(linear(palette.leg_joint)[None, :], linear(palette.leg)[None, :], np.array([0.35]))[0], (count, 3)), 0.45, 0.0)
        if anatomy.species.sheen is not None:
            layer.sheen = np.broadcast_to(linear(anatomy.species.sheen), (count, 3)) * (0.6 * cheek)[:, None]
        return layer

    def _paint_proboscis(self, points: FloatArray) -> _Layer:
        anatomy, unit = self._anatomy, self._unit
        palette, proboscis = anatomy.species.palette, anatomy.proboscis
        count = len(points)
        layer = _Layer.blank(count)
        path = proboscis.path
        along = np.clip(
            np.einsum("ij,j->i", points - path[0], path[-1] - path[0]) / float(np.sum((path[-1] - path[0]) ** 2)), 0.0, 1.0
        )
        # Schaft: häutig mit Ringen, zum Ende glänzender
        shaft = _mix(np.broadcast_to(linear(palette.proboscis), (count, 3)), np.broadcast_to(linear(palette.proboscis) * 1.6, (count, 3)), smoothstep(0.4, 0.8, along))
        layer.paint(np.ones(count), shaft, 0.62 - 0.3 * smoothstep(0.45, 0.85, along), 0.0)

        def rings(p: FloatArray) -> FloatArray:
            t = np.einsum("ij,j->i", p - path[0], path[-1] - path[0]) / float(np.sum((path[-1] - path[0]) ** 2))
            return np.abs(np.sin(np.pi * 9.0 * t)) ** 0.5

        layer.heights.append((rings, 0.02 * unit * (1.0 - smoothstep(0.5, 0.75, along))))
        # Tupfpolster mit Rillen (Pseudotracheen), nass glänzend
        lobes = np.min([lobe.distance(points) for lobe in proboscis.lobes], axis=0)
        pad = 1.0 - smoothstep(-0.03 * unit, 0.06 * unit, lobes)
        center = 0.5 * (np.asarray(proboscis.lobes[0].center) + np.asarray(proboscis.lobes[1].center))

        def grooves(p: FloatArray) -> FloatArray:
            offset = p - center
            angle = np.arctan2(offset[:, 2], offset[:, 0])
            return np.abs(np.sin(11.0 * angle + 18.0 * np.linalg.norm(offset, axis=1) / unit)) ** 0.6

        pattern = grooves(points)
        labellum = _mix(np.broadcast_to(linear(palette.labellum), (count, 3)), np.broadcast_to(linear(palette.labellum) * 0.35, (count, 3)), smoothstep(0.75, 0.95, pattern))
        layer.paint(pad, labellum, 0.2, 0.0)
        layer.heights.append((grooves, 0.03 * unit * pad))
        # Speicheltropfen
        drop = np.linalg.norm(points - proboscis.drop_center, axis=1) - proboscis.drop_radius
        neck_line = np.linalg.norm(points - proboscis.drop_neck, axis=1) - 2.5 * proboscis.drop_neck_radius
        wet = 1.0 - smoothstep(0.0, 0.06 * unit, np.minimum(drop, neck_line))
        layer.paint(wet, np.broadcast_to(linear(palette.drool), (count, 3)), 0.035, 0.0)
        return layer

    def _paint_leg(self, name: str, points: FloatArray) -> _Layer:
        anatomy, unit = self._anatomy, self._unit
        palette = anatomy.species.palette
        leg, axis = self._legs[name]
        count = len(points)
        layer = _Layer.blank(count)
        distance, nearest = cKDTree(axis.dense).query(points)
        arc = axis.arc[nearest]
        trochanter, knee, ankle, toe = axis.joints
        tangent = normalized(np.gradient(axis.dense, axis=0))[nearest]
        layer.paint(np.ones(count), np.broadcast_to(linear(palette.leg), (count, 3)), 0.4, 0.1)
        # Gelenke: Knie, Fußgelenk und die Grenzen der fünf Fußglieder bräunlich
        joint_arcs = [trochanter, knee, ankle]
        tarsus = ankle + (toe - ankle) * np.array([0.42, 0.565, 0.71, 0.855])
        joint_distance = np.min(np.abs(arc[:, None] - np.array([*joint_arcs, *tarsus])[None, :]), axis=1)
        joint = 1.0 - smoothstep(0.03 * unit, 0.08 * unit, joint_distance)
        layer.paint(0.8 * joint, np.broadcast_to(linear(palette.leg_joint), (count, 3)), 0.55, 0.0)
        # Dornen und Krallen: glänzend schwarz
        spike = smoothstep(1.25, 1.6, distance / np.maximum(np.interp(arc, [0.0, knee, ankle, toe], [leg.coxa_radius, leg.femur_radius, leg.tibia_radius, leg.tarsus_radius]), 1e-9))
        layer.paint(spike, np.broadcast_to(linear(palette.claw), (count, 3)), 0.24, 0.2)
        foot = Foot.of(leg, axis)
        pads = np.min([pad.distance(points) for pad in foot.pads()], axis=0)
        layer.paint(1.0 - smoothstep(-0.01 * unit, 0.03 * unit, pads), np.broadcast_to(linear(palette.pulvillus), (count, 3)), 0.72, 0.0)

        def fibers(p: FloatArray) -> FloatArray:
            # Feine Härchen entlang des Beins: Rauschen entlang der Beinachse gedehnt
            along = np.einsum("ij,ij->i", p, tangent)[:, None] * tangent
            return self._fibers(p - along * 0.8)

        hairy = (1.0 - spike) * (arc < toe)
        layer.heights.append((fibers, 0.006 * unit * hairy))
        return layer
