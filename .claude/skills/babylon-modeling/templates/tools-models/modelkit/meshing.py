"""Vom Distanzfeld zum budgetgerechten Netz: Marching Cubes, Remeshing, Decimation (Vernetzung)."""

from __future__ import annotations

import math

import numpy as np
import pymeshlab as ml
from skimage import measure

from modelkit.geometry import TriangleMesh
from modelkit.sdf import Sdf

_SLAB_POINTS = 2_000_000  # Obergrenze an Punkten je Auswertungsblock (begrenzt den RAM-Bedarf)


def sample_grid(sdf: Sdf, voxel_size: float) -> tuple[np.ndarray, np.ndarray]:
    """Wertet das Feld auf einem regelmäßigen Raster aus; liefert (Volumen, Ursprung)."""
    box = sdf.bounds().padded(2.0 * voxel_size)
    shape = np.ceil((box.upper - box.lower) / voxel_size).astype(int) + 1
    axes = [box.lower[i] + np.arange(shape[i]) * voxel_size for i in range(3)]
    volume = np.empty(tuple(shape), dtype=np.float32)
    slab = max(1, _SLAB_POINTS // int(shape[0] * shape[1]))
    for z0 in range(0, shape[2], slab):
        zs = axes[2][z0 : z0 + slab]
        grid = np.stack(np.meshgrid(axes[0], axes[1], zs, indexing="ij"), axis=-1).reshape(-1, 3)
        volume[:, :, z0 : z0 + len(zs)] = sdf.distance(grid).reshape(shape[0], shape[1], len(zs))
    return volume, box.lower


def mesh_from_sdf(sdf: Sdf, voxel_size: float) -> TriangleMesh:
    """Extrahiert die Nullfläche per Marching Cubes (Lewiner) als geschlossenes Netz."""
    volume, origin = sample_grid(sdf, voxel_size)
    vertices, faces, _, _ = measure.marching_cubes(volume, level=0.0, spacing=(voxel_size,) * 3)
    mesh = TriangleMesh(vertices.astype(np.float64) + origin, faces.astype(np.int64))
    return mesh.with_outward_faces()


def edge_length_for_budget(surface_area: float, face_budget: int) -> float:
    """Kantenlänge, mit der gleichseitige Dreiecke die Fläche in ``face_budget`` Dreiecken füllen."""
    return math.sqrt(4.0 * surface_area / (math.sqrt(3.0) * face_budget))


def _run_meshlab(mesh: TriangleMesh, *filters: tuple[str, dict[str, object]]) -> TriangleMesh:
    meshset = ml.MeshSet()
    meshset.add_mesh(ml.Mesh(vertex_matrix=mesh.vertices, face_matrix=mesh.faces.astype(np.int32)))
    for name, parameters in filters:
        getattr(meshset, name)(**parameters)
    result = meshset.current_mesh()
    return TriangleMesh(
        np.asarray(result.vertex_matrix(), dtype=np.float64),
        np.asarray(result.face_matrix(), dtype=np.int64),
    )


def remesh_isotropic(mesh: TriangleMesh, edge_length: float, iterations: int = 8) -> TriangleMesh:
    """Gleichmäßige Dreiecke mit Zielkantenlänge (gut für Texturbacken, AO und Deformation)."""
    return _run_meshlab(
        mesh,
        (
            "meshing_isotropic_explicit_remeshing",
            {
                "iterations": iterations,
                "targetlen": ml.PureValue(edge_length),
                "featuredeg": 60.0,
                "reprojectflag": True,
            },
        ),
    )


def decimate_quadric(mesh: TriangleMesh, face_budget: int) -> TriangleMesh:
    """QEM-Decimation auf ein Dreiecksbudget; erhält Topologie und Normalenrichtung."""
    return _run_meshlab(
        mesh,
        (
            "meshing_decimation_quadric_edge_collapse",
            {
                "targetfacenum": face_budget,
                "qualitythr": 0.5,
                "preservenormal": True,
                "preservetopology": True,
                "optimalplacement": True,
                "planarquadric": True,
                "autoclean": True,
            },
        ),
    )


def remesh_to_budget(sdf: Sdf, face_budget: int, voxel_divisor: float = 3.0) -> TriangleMesh:
    """SDF → Marching Cubes → isotropes Remeshing auf Budget → Rückprojektion auf die exakte Fläche."""
    rough = mesh_from_sdf(sdf, voxel_size=_voxel_for_budget(sdf, face_budget, voxel_divisor))
    edge = edge_length_for_budget(rough.surface_area(), face_budget)
    remeshed = remesh_isotropic(rough, edge)
    return TriangleMesh(sdf.project_to_surface(remeshed.vertices), remeshed.faces)


def _voxel_for_budget(sdf: Sdf, face_budget: int, voxel_divisor: float) -> float:
    # Grobe Flächenschätzung über einen Probelauf mit 64 Zellen auf der längsten Achse
    box = sdf.bounds()
    probe_voxel = float((box.upper - box.lower).max()) / 64.0
    probe = mesh_from_sdf(sdf, probe_voxel)
    return edge_length_for_budget(probe.surface_area(), face_budget) / voxel_divisor
