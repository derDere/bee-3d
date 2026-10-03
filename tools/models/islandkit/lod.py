"""Vereinfachte Teile für ferne Detailstufen, abgeleitet aus den fertigen Teil-glbs (Fernteile).

Baumkronen werden zu sternförmigen Hüllkörpern um die Blattkarten (Richtungen einer
Ikosaederkugel, je Richtung die äußeren Blattkarten), Stämme zu Röhren, Felsbrocken und
Madenhügel zu vereinfachten Netzen. Alle Fernteile tragen Vertexfarben aus den mittleren Farben
ihrer Materialien (Textur × Vertexfarbe × Faktor) und kommen ohne Texturen aus. Die Insel setzt
sie mit den Transformationen der LOD0-Bepflanzung zu einem einzigen Netz zusammen.
"""

from __future__ import annotations

import io
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import numpy.typing as npt
import pygltflib
import trimesh
from modelkit.geometry import TriangleMesh, area_weighted_normals
from modelkit.meshing import decimate_quadric
from modelkit.shading import srgb_to_linear
from modelkit.sweep import sweep_tube
from PIL import Image
from scipy.spatial import cKDTree

from islandkit.assembly import VertexColoredMesh

type FloatArray = npt.NDArray[np.float64]
type IndexArray = npt.NDArray[np.int64]
type PartSource = Callable[[str], Path]

_COMPONENTS = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
_WIDTHS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


@dataclass(frozen=True, slots=True)
class PartPrimitive:
    """Eine Primitive eines Teils (Teilprimitive): Material, Positionen, Dreiecke, mittlere lineare Farbe."""

    material: str
    positions: FloatArray
    faces: IndexArray
    color: FloatArray


@dataclass(frozen=True, slots=True)
class PartGeometry:
    """Geometrie eines Teils aus seinem glb (Teilgeometrie)."""

    name: str
    primitives: tuple[PartPrimitive, ...]

    @property
    def height(self) -> float:
        """Höchster Punkt über dem Fuß in m."""
        return max(float(primitive.positions[:, 1].max()) for primitive in self.primitives)

    def by_prefix(self, prefix: str) -> list[PartPrimitive]:
        return [primitive for primitive in self.primitives if primitive.material.startswith(prefix)]


def load_part_geometry(path: Path) -> PartGeometry:
    """Liest Positionen, Dreiecke und mittlere Farben aller Primitiven des ersten Meshes."""
    document = pygltflib.GLTF2().load_binary(str(path))
    blob = document.binary_blob() or b""
    primitives = []
    for primitive in document.meshes[0].primitives:
        material = document.materials[primitive.material]
        positions = _accessor(document, blob, primitive.attributes.POSITION).astype(np.float64)
        faces = _accessor(document, blob, primitive.indices).astype(np.int64).reshape(-1, 3)
        color = _material_color(document, blob, material)
        if primitive.attributes.COLOR_0 is not None:
            vertex = _accessor(document, blob, primitive.attributes.COLOR_0)[:, :3]
            color = color * vertex.mean(axis=0)
        primitives.append(PartPrimitive(str(material.name), positions, faces, color))
    return PartGeometry(path.stem, tuple(primitives))


def _accessor(document: pygltflib.GLTF2, blob: bytes, index: int) -> FloatArray:
    """Daten eines Accessors als Feld (count, width); normalisierte Ganzzahlen auf 0..1."""
    accessor = document.accessors[index]
    view = document.bufferViews[accessor.bufferView]
    dtype = np.dtype(_COMPONENTS[accessor.componentType])
    width = _WIDTHS[accessor.type]
    element = dtype.itemsize * width
    stride = view.byteStride or element
    start = (view.byteOffset or 0) + (accessor.byteOffset or 0)
    raw = np.frombuffer(blob, dtype=np.uint8, count=stride * (accessor.count - 1) + element, offset=start)
    rows = np.lib.stride_tricks.as_strided(raw, shape=(accessor.count, element), strides=(stride, 1))
    values = np.ascontiguousarray(rows).view(dtype).reshape(accessor.count, width)
    if accessor.normalized:
        return values.astype(np.float64) / float(np.iinfo(dtype).max)
    return values.astype(np.float64)


def _material_color(document: pygltflib.GLTF2, blob: bytes, material: pygltflib.Material) -> FloatArray:
    """Mittlere lineare Basisfarbe eines Materials: Faktor × Mittel der deckenden Texel."""
    pbr = material.pbrMetallicRoughness
    factor = np.array((pbr.baseColorFactor if pbr is not None and pbr.baseColorFactor else [1.0, 1.0, 1.0, 1.0])[:3])
    if pbr is None or pbr.baseColorTexture is None:
        return factor
    image = document.images[document.textures[pbr.baseColorTexture.index].source]
    view = document.bufferViews[image.bufferView]
    start = view.byteOffset or 0
    pixels = np.asarray(Image.open(io.BytesIO(blob[start : start + view.byteLength])).convert("RGBA"), dtype=np.float64) / 255.0
    opaque = pixels[..., 3] > 0.5
    texels = pixels[..., :3][opaque] if np.any(opaque) else pixels[..., :3].reshape(-1, 3)
    return factor * _representative_color(srgb_to_linear(texels))


def _representative_color(colors: FloatArray, iterations: int = 8) -> FloatArray:
    """Kennfarbe einer Textur: zwei Farbcluster (k-Means), das hellere zählt stärker.

    Gemischte Atlanten (grüne Blätter mit rosa Blüten) mitteln sich sonst zu Grau.
    """
    luminance = colors @ np.array([0.2126, 0.7152, 0.0722])
    centers = np.stack([colors[luminance <= np.median(luminance)].mean(axis=0), colors[luminance > np.median(luminance)].mean(axis=0)])
    for _ in range(iterations):
        labels = np.argmin(((colors[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2), axis=1)
        centers = np.stack([colors[labels == k].mean(axis=0) if np.any(labels == k) else centers[k] for k in range(2)])
    bright = int(np.argmax(centers @ np.array([0.2126, 0.7152, 0.0722])))
    return 0.65 * centers[bright] + 0.35 * centers[1 - bright]


@dataclass(frozen=True, slots=True)
class FarPart:
    """Vereinfachtes Teil (Fernteil) mit Vertexfarben, im Koordinatensystem des Teils."""

    mesh: VertexColoredMesh

    def placed(self, position: FloatArray, rotation: FloatArray, scale: float, tint: float = 1.0) -> VertexColoredMesh:
        """Kopie mit Instanztransformation (Drehung xyzw, gleichmäßige Skalierung) und Helligkeitsfaktor."""
        matrix = quaternion_matrix(rotation)
        return VertexColoredMesh(
            (self.mesh.vertices * scale) @ matrix.T + position,
            self.mesh.normals @ matrix.T,
            self.mesh.faces,
            np.clip(self.mesh.colors * tint, 0.0, 1.0),
        )


def quaternion_matrix(quaternion: FloatArray) -> FloatArray:
    """Drehmatrix einer Quaternion (x, y, z, w)."""
    x, y, z, w = quaternion / np.linalg.norm(quaternion)
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )


def crown_blob(points: FloatArray, color: FloatArray, subdivisions: int, quantile: float = 0.85) -> VertexColoredMesh:
    """Sternförmiger Hüllkörper um Blattkarten: je Kugelrichtung die äußeren Karten im Kegel um die Richtung."""
    sphere = trimesh.creation.icosphere(subdivisions=subdivisions, radius=1.0)
    directions = np.asarray(sphere.vertices, dtype=np.float64)
    faces = np.asarray(sphere.faces, dtype=np.int64)
    center = points.mean(axis=0)
    relative = points - center
    distance = np.linalg.norm(relative, axis=1)
    unit = relative / np.maximum(distance, 1e-9)[:, None]
    cone = np.cos(np.radians((40.0, 26.0, 16.0)[min(subdivisions, 2)]))
    fallback = float(np.quantile(distance, 0.6))
    radii = np.empty(len(directions))
    for index, direction in enumerate(directions):
        alignment = unit @ direction
        inside = alignment > cone
        radii[index] = float(np.quantile(distance[inside] * alignment[inside], quantile)) if np.count_nonzero(inside) > 3 else fallback
    neighbors = _vertex_neighbors(faces, len(directions))
    radii = 0.5 * radii + 0.5 * np.array([radii[list(adjacent)].mean() for adjacent in neighbors])
    vertices = center + directions * radii[:, None]
    normals = _normalized(0.65 * directions + 0.35 * area_weighted_normals(vertices, faces))
    shade = 0.62 + 0.38 * (0.5 + 0.5 * directions[:, 1])
    return VertexColoredMesh(vertices, normals, faces, np.clip(color[None, :] * shade[:, None], 0.0, 1.0))


def trunk_tube(wood: PartPrimitive, top: float, sides: int = 5) -> VertexColoredMesh | None:
    """Stamm als Röhre vom Fuß bis ``top``; Radius aus dem Astwerk zwischen 1 und 2 m Höhe."""
    band = wood.positions[(wood.positions[:, 1] > 1.0) & (wood.positions[:, 1] < 2.0)]
    if len(band) == 0 or top <= 0.5:
        return None
    radius = 0.85 * float(np.median(np.hypot(band[:, 0], band[:, 2]) + 1e-3))
    path = np.array([[0.0, -0.3, 0.0], [0.0, 0.5 * top, 0.0], [0.0, top, 0.0], [0.0, top + 0.3, 0.0]])
    tube = sweep_tube(path, np.array([1.25, 1.0, 0.75, 0.3]) * radius, sides)
    colors = np.tile(wood.color * 0.8, (len(tube.vertices), 1))
    return VertexColoredMesh(tube.vertices, tube.normals, tube.faces, np.clip(colors, 0.0, 1.0))


def decimated(primitives: Iterable[PartPrimitive], face_budget: int) -> VertexColoredMesh:
    """Verschmilzt die Primitiven an gleichen Positionen und vereinfacht sie per QEM auf ``face_budget``."""
    parts = list(primitives)
    positions = np.concatenate([primitive.positions for primitive in parts])
    offsets = np.cumsum([0] + [len(primitive.positions) for primitive in parts[:-1]])
    faces = np.concatenate([primitive.faces + offset for primitive, offset in zip(parts, offsets, strict=True)])
    colors = np.concatenate([np.tile(primitive.color, (len(primitive.positions), 1)) for primitive in parts])
    welded, inverse = np.unique(np.round(positions, 5), axis=0, return_inverse=True)
    welded_faces = inverse.reshape(-1)[faces]
    keep = (welded_faces[:, 0] != welded_faces[:, 1]) & (welded_faces[:, 1] != welded_faces[:, 2]) & (welded_faces[:, 0] != welded_faces[:, 2])
    welded_colors = np.zeros((len(welded), 3))
    np.add.at(welded_colors, inverse.reshape(-1), colors)
    welded_colors /= np.maximum(np.bincount(inverse.reshape(-1), minlength=len(welded))[:, None], 1)
    mesh = TriangleMesh(welded, welded_faces[keep])
    reduced = decimate_quadric(mesh, face_budget) if len(mesh.faces) > face_budget else mesh
    # Farben vom nächsten Ursprungspunkt übernehmen
    nearest = cKDTree(welded).query(reduced.vertices)[1]
    normals = area_weighted_normals(reduced.vertices, reduced.faces)
    return VertexColoredMesh(reduced.vertices, normals, reduced.faces, np.clip(welded_colors[nearest], 0.0, 1.0))


class FarPartLibrary:
    """Baut und speichert Fernteile je Teilname und Detailstufe (Fernteil-Bibliothek)."""

    def __init__(self, parts: PartSource) -> None:
        self._parts = parts
        self._geometry: dict[str, PartGeometry] = {}
        self._cache: dict[tuple[str, int], FarPart | None] = {}

    def geometry(self, name: str) -> PartGeometry:
        if name not in self._geometry:
            self._geometry[name] = load_part_geometry(self._parts(name))
        return self._geometry[name]

    def height(self, name: str) -> float:
        """Höhe eines Teils in m (aus seinem glb)."""
        return self.geometry(name).height

    def far_part(self, name: str, lod: int) -> FarPart | None:
        """Fernteil für Detailstufe 1 oder 2; ``None``, wenn das Teil in dieser Stufe entfällt."""
        key = (name, lod)
        if key not in self._cache:
            self._cache[key] = self._build(name, lod)
        return self._cache[key]

    def _build(self, name: str, lod: int) -> FarPart | None:
        geometry = self.geometry(name)
        leaves = geometry.by_prefix("Flora_Leaves")
        wood = geometry.by_prefix("Flora_Bark")
        if leaves:
            points = np.concatenate([primitive.positions for primitive in leaves])
            color = np.mean([primitive.color for primitive in leaves], axis=0) * 1.15
            crown = crown_blob(points, color, subdivisions=1 if lod == 1 else 0)
            meshes = [crown]
            if wood and not name.startswith("Bush"):
                trunk = trunk_tube(wood[0], float(crown.vertices[:, 1].min()) + 0.4, sides=5 if lod == 1 else 3)
                if trunk is not None:
                    meshes.append(trunk)
            return FarPart(VertexColoredMesh.concatenate(meshes))
        if wood:
            return FarPart(decimated(wood, 320)) if lod == 1 else None
        if lod == 1 and name.startswith(("Rock_Boulder", "Rock_Slab", "Nest_Mound")):
            return FarPart(decimated(geometry.primitives, 60 if name.startswith("Rock") else 90))
        return None


def assemble_far_parts(
    library: FarPartLibrary,
    exemplars: Iterable[tuple[str, FloatArray, FloatArray, float]],
    lod: int,
    seed: int,
) -> list[VertexColoredMesh]:
    """Setzt die Fernteile aller Einzelstücke (Teil, Fußpunkt, Drehung, Skalierung) an ihre Plätze."""
    rng = np.random.default_rng(seed)
    meshes = []
    for part, position, rotation, scale in exemplars:
        far = library.far_part(part, lod)
        if far is not None:
            meshes.append(far.placed(position, rotation, scale, tint=float(rng.uniform(0.9, 1.08))))
    return meshes


def _vertex_neighbors(faces: IndexArray, count: int) -> list[set[int]]:
    neighbors: list[set[int]] = [set() for _ in range(count)]
    for a, b, c in faces.tolist():
        neighbors[a].update((b, c))
        neighbors[b].update((a, c))
        neighbors[c].update((a, b))
    return neighbors


def _normalized(vectors: FloatArray) -> FloatArray:
    return vectors / np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-12)
