"""Dreiecksnetze, Booleans und Normalen auf Basis von manifold3d (Netzgeometrie)."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass

import manifold3d as m3d
import numpy as np
import numpy.typing as npt

from modelkit.sdf import TubeChain

type FloatArray = npt.NDArray[np.float64]
type IndexArray = npt.NDArray[np.int64]


@dataclass(frozen=True, slots=True)
class TriangleMesh:
    """Indiziertes Dreiecksnetz in Metern (Dreiecksnetz)."""

    vertices: FloatArray
    faces: IndexArray

    @property
    def face_count(self) -> int:
        """Anzahl der Dreiecke."""
        return int(len(self.faces))

    def surface_area(self) -> float:
        """Gesamtfläche in Quadratmetern."""
        a, b, c = (self.vertices[self.faces[:, i]] for i in range(3))
        return float(0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1).sum())

    def signed_volume(self) -> float:
        """Vorzeichenbehaftetes Volumen; negativ bedeutet nach innen zeigende Dreiecke."""
        a, b, c = (self.vertices[self.faces[:, i]] for i in range(3))
        return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0)

    def with_outward_faces(self) -> TriangleMesh:
        """Dreht die Wicklung um, falls die Normalen nach innen zeigen."""
        return (
            self if self.signed_volume() >= 0.0 else TriangleMesh(self.vertices, self.faces[:, ::-1].copy())
        )

    @staticmethod
    def concatenate(meshes: Iterable[TriangleMesh]) -> TriangleMesh:
        """Fügt Netze ohne Boolean zu einem Netz zusammen."""
        vertices: list[FloatArray] = []
        faces: list[IndexArray] = []
        offset = 0
        for mesh in meshes:
            vertices.append(mesh.vertices)
            faces.append(mesh.faces + offset)
            offset += len(mesh.vertices)
        return TriangleMesh(np.concatenate(vertices), np.concatenate(faces))


@dataclass(frozen=True, slots=True)
class ShadedMesh:
    """Netz mit Normalen je Eckpunkt, bereit für Farbe und Export (schattiertes Netz)."""

    vertices: FloatArray
    normals: FloatArray
    faces: IndexArray

    def as_triangle_mesh(self) -> TriangleMesh:
        """Liefert nur die Geometrie (z. B. als Verdecker für AO-Strahlen)."""
        return TriangleMesh(self.vertices, self.faces)


def to_manifold(mesh: TriangleMesh) -> m3d.Manifold:
    """Wandelt ein geschlossenes Netz in ein Manifold um; wirft bei offenem Netz."""
    gl_mesh = m3d.Mesh(
        vert_properties=np.ascontiguousarray(mesh.vertices, dtype=np.float32),
        tri_verts=np.ascontiguousarray(mesh.faces, dtype=np.uint32),
    )
    gl_mesh.merge()
    solid = m3d.Manifold(gl_mesh)
    if solid.status() != m3d.Error.NoError:
        raise ValueError(f"Netz ist nicht geschlossen/mannigfaltig: {solid.status()}")
    return solid


def from_manifold(solid: m3d.Manifold) -> TriangleMesh:
    """Liefert die reine Geometrie eines Manifolds."""
    gl_mesh = solid.to_mesh()
    vertices = np.asarray(gl_mesh.vert_properties, dtype=np.float64)[:, :3]
    return TriangleMesh(vertices, np.asarray(gl_mesh.tri_verts, dtype=np.int64))


def union_all(solids: Sequence[m3d.Manifold]) -> m3d.Manifold:
    """Vereinigt beliebig viele Körper in einem Batch-Boolean."""
    return m3d.Manifold.batch_boolean(list(solids), m3d.OpType.Add)


def hull_tube(chain: TubeChain, segments: int) -> m3d.Manifold:
    """Baut einen Röhrenzug als Vereinigung konvexer Hüllen aufeinanderfolgender Kugeln."""
    hulls = [
        m3d.Manifold.batch_hull(
            [
                m3d.Manifold.sphere(r0, segments).translate(tuple(p0)),
                m3d.Manifold.sphere(r1, segments).translate(tuple(p1)),
            ]
        )
        for (p0, r0), (p1, r1) in chain.node_pairs()
    ]
    return union_all(hulls)


def ellipsoid_solid(
    center: Sequence[float], radii: Sequence[float], euler_degrees: Sequence[float], segments: int
) -> m3d.Manifold:
    """Erzeugt ein Ellipsoid als skalierte geodätische Kugel."""
    return (
        m3d.Manifold.sphere(1.0, segments)
        .scale(tuple(radii))
        .rotate(tuple(euler_degrees))
        .translate(tuple(center))
    )


def shade_with_creases(solid: m3d.Manifold, sharp_angle_degrees: float) -> ShadedMesh:
    """Berechnet Normalen; Kanten über ``sharp_angle_degrees`` bleiben hart (Eckpunkte werden geteilt)."""
    gl_mesh = solid.calculate_normals(0, sharp_angle_degrees).to_mesh()
    properties = np.asarray(gl_mesh.vert_properties, dtype=np.float64)
    normals = properties[:, 3:6]
    normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)
    return ShadedMesh(properties[:, :3].copy(), normals, np.asarray(gl_mesh.tri_verts, dtype=np.int64))


def area_weighted_normals(vertices: FloatArray, faces: IndexArray) -> FloatArray:
    """Glatte Eckpunktnormalen aus flächengewichteten Dreiecksnormalen (für offene Flächen)."""
    a, b, c = (vertices[faces[:, i]] for i in range(3))
    face_normals = np.cross(b - a, c - a)
    normals = np.zeros_like(vertices)
    for i in range(3):
        np.add.at(normals, faces[:, i], face_normals)
    return normals / np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)
