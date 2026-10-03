"""Hüllen aus Distanzfeldern: Rumpf und Kopfkapsel als geschlossene, budgetgerechte Netze (Hüllen)."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import manifold3d as m3d
from modelkit.geometry import ShadedMesh, TriangleMesh, shade_with_creases, to_manifold
from modelkit.meshing import decimate_quadric, remesh_to_budget
from modelkit.sdf import Sdf

from flykit.limbs import concatenate_shaded

CREASE_DEGREES = 50.0


@dataclass(frozen=True, slots=True)
class Shell:
    """Hülle eines Körperteils (Hülle).

    ``mesh`` enthält die Hülle und ihre Anbauteile (Fühler, Schwingkölbchen) als eigene,
    eingesteckte Hüllen; ``solid`` ist das Volumen der Hülle zum Beschneiden der Glieder.
    """

    mesh: ShadedMesh
    solid: m3d.Manifold


def build_shell(field: Sdf, attachments: Sequence[m3d.Manifold], face_budget: int) -> Shell:
    """Fein vernetzen, mit Fehlerquadriken auf Budget reduzieren, auf das Feld zurückprojizieren.

    Die Fehlerquadriken verteilen die Dreiecke nach Krümmung: dicht an Kanten und Wülsten,
    sparsam auf flachen Platten.
    """
    fine = remesh_to_budget(field, 4 * face_budget, voxel_divisor=2.0)
    coarse = decimate_quadric(fine, face_budget)
    solid = to_manifold(TriangleMesh(field.project_to_surface(coarse.vertices), coarse.faces))
    meshes = [shade_with_creases(part, sharp_angle_degrees=CREASE_DEGREES) for part in (solid, *attachments)]
    return Shell(concatenate_shaded(meshes), solid)
