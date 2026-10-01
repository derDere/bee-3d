"""Schreibt glTF-2.0-Binärdateien (.glb) mit Knotenhierarchie, PBR-Materialien, eingebetteten Texturen,
Keyframe-Animation und GPU-Instanzierung; übernimmt Meshes aus fertigen glb-Dateien (glTF-Schreiber)."""

from __future__ import annotations

import copy
import io
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import numpy as np
import numpy.typing as npt
import pygltflib as gl
from PIL import Image

type FloatArray = npt.NDArray[np.float64]
type IndexArray = npt.NDArray[np.int64]
type ByteImage = npt.NDArray[np.uint8]
type AlphaMode = Literal["OPAQUE", "MASK", "BLEND"]
type TextureWrap = Literal["clamp", "repeat"]
type TextureIndex = int

_UINT16_LIMIT = 65_535  # 0xFFFF ist als Primitive-Restart reserviert
_WRAP_MODES = {"clamp": 33_071, "repeat": 10_497}  # CLAMP_TO_EDGE für Atlanten, REPEAT für Kachelmuster
_LINEAR_MIPMAP_LINEAR = 9_987  # trilineare Filterung für verkleinerte Darstellung
_INSTANCING = "EXT_mesh_gpu_instancing"


@dataclass(frozen=True, slots=True)
class MaterialSpec:
    """PBR-Material nach glTF metallic/roughness (Material).

    Faktoren multiplizieren sich mit den Texturwerten. Die ORM-Textur (R = Occlusion,
    G = Roughness, B = Metallic) wird über ``metallic_roughness_texture`` und
    ``occlusion_texture`` mit demselben Index eingebunden. Farbfaktoren sind linear.
    ``alpha_cutoff`` gilt im Modus MASK.
    """

    name: str
    base_color: tuple[float, float, float, float] = (1.0, 1.0, 1.0, 1.0)
    metallic: float = 0.0
    roughness: float = 0.6
    alpha_mode: AlphaMode = "OPAQUE"
    alpha_cutoff: float = 0.5
    double_sided: bool = False
    base_color_texture: TextureIndex | None = None
    metallic_roughness_texture: TextureIndex | None = None
    occlusion_texture: TextureIndex | None = None
    occlusion_strength: float = 1.0
    normal_texture: TextureIndex | None = None
    normal_scale: float = 1.0


@dataclass(frozen=True, slots=True)
class PrimitiveData:
    """Render-Primitive (Teilnetz): Geometrie, Normalen, Material und optionale Attribute.

    ``uvs`` sind Texturkoordinaten (v nach unten wie in glTF), ``tangents`` Tangenten
    (xyz plus Vorzeichen w) und ``colors`` lineare Vertexfarben (RGB oder RGBA).
    """

    positions: FloatArray
    normals: FloatArray
    faces: IndexArray
    material: str
    uvs: FloatArray | None = None
    tangents: FloatArray | None = None
    colors: FloatArray | None = None


@dataclass(frozen=True, slots=True)
class RotationTrack:
    """Rotations-Keyframes eines Knotens, Quaternionen xyzw (Animationsspur)."""

    node: str
    times: FloatArray
    quaternions: FloatArray


@dataclass(frozen=True, slots=True)
class InstanceSet:
    """Transformationen vieler Kopien eines Meshes (Instanzsatz).

    ``translations`` (K, 3), ``rotations`` (K, 4) als Quaternionen xyzw, ``scales`` (K, 3) —
    relativ zum Knoten, der den Satz trägt.
    """

    translations: FloatArray
    rotations: FloatArray
    scales: FloatArray

    @property
    def count(self) -> int:
        """Anzahl der Instanzen."""
        return int(len(self.translations))

    def subset(self, mask: npt.NDArray[np.bool_]) -> InstanceSet:
        """Liefert die ausgewählten Instanzen in unveränderter Reihenfolge."""
        return InstanceSet(self.translations[mask], self.rotations[mask], self.scales[mask])


class GltfBuilder:
    """Baut ein glTF-Dokument schrittweise auf und schreibt es als .glb (glTF-Schreiber)."""

    def __init__(self, generator: str) -> None:
        self._gltf = gl.GLTF2(asset=gl.Asset(version="2.0", generator=generator), scene=0)
        self._blob = bytearray()
        self._materials: dict[str, int] = {}
        self._nodes: dict[str, int] = {}
        self._roots: list[int] = []
        self._samplers: dict[tuple[int, int, int | None, int | None], int] = {}
        self._extensions: set[str] = set()

    @property
    def material_names(self) -> frozenset[str]:
        """Namen der registrierten Materialien."""
        return frozenset(self._materials)

    def add_texture(self, name: str, image: ByteImage, wrap: TextureWrap = "clamp") -> TextureIndex:
        """Bettet ein 8-Bit-Bild (H, W, 3 oder 4) als PNG ein und liefert den Texturindex.

        ``clamp`` passt zu UV-Atlanten, ``repeat`` zu Kachelmustern (Rinde, Wasser).
        """
        mode = _WRAP_MODES[wrap]
        sampler = self._sampler(mode, mode, gl.LINEAR, _LINEAR_MIPMAP_LINEAR)
        encoded = io.BytesIO()
        Image.fromarray(image).save(encoded, format="PNG", optimize=True)
        view = self._buffer_view(encoded.getvalue(), target=None)
        self._gltf.images.append(gl.Image(name=name, bufferView=view, mimeType="image/png"))
        self._gltf.textures.append(gl.Texture(name=name, source=len(self._gltf.images) - 1, sampler=sampler))
        return len(self._gltf.textures) - 1

    def add_material(self, spec: MaterialSpec) -> None:
        """Registriert ein Material unter seinem Namen."""
        self._materials[spec.name] = len(self._gltf.materials)
        occlusion = (
            None
            if spec.occlusion_texture is None
            else gl.OcclusionTextureInfo(index=spec.occlusion_texture, strength=spec.occlusion_strength)
        )
        normal = (
            None
            if spec.normal_texture is None
            else gl.NormalMaterialTexture(index=spec.normal_texture, scale=spec.normal_scale)
        )
        self._gltf.materials.append(
            gl.Material(
                name=spec.name,
                pbrMetallicRoughness=gl.PbrMetallicRoughness(
                    baseColorFactor=list(spec.base_color),
                    metallicFactor=spec.metallic,
                    roughnessFactor=spec.roughness,
                    baseColorTexture=_texture_info(spec.base_color_texture),
                    metallicRoughnessTexture=_texture_info(spec.metallic_roughness_texture),
                ),
                occlusionTexture=occlusion,
                normalTexture=normal,
                alphaMode=spec.alpha_mode,
                alphaCutoff=spec.alpha_cutoff if spec.alpha_mode == "MASK" else None,
                doubleSided=spec.double_sided,
            )
        )

    def add_mesh(self, name: str, primitives: Sequence[PrimitiveData]) -> int:
        """Legt ein Mesh aus einem oder mehreren Primitiven an und liefert dessen Index."""
        gltf_primitives = []
        for primitive in primitives:
            attributes = gl.Attributes(
                POSITION=self._accessor(
                    primitive.positions.astype(np.float32), gl.FLOAT, "VEC3", gl.ARRAY_BUFFER, bounds=True
                ),
                NORMAL=self._accessor(primitive.normals.astype(np.float32), gl.FLOAT, "VEC3", gl.ARRAY_BUFFER),
            )
            if primitive.uvs is not None:
                attributes.TEXCOORD_0 = self._accessor(
                    primitive.uvs.astype(np.float32), gl.FLOAT, "VEC2", gl.ARRAY_BUFFER
                )
            if primitive.tangents is not None:
                attributes.TANGENT = self._accessor(
                    primitive.tangents.astype(np.float32), gl.FLOAT, "VEC4", gl.ARRAY_BUFFER
                )
            if primitive.colors is not None:
                attributes.COLOR_0 = self._color_accessor(primitive.colors)
            index_type = np.uint16 if len(primitive.positions) < _UINT16_LIMIT else np.uint32
            indices = self._accessor(
                primitive.faces.reshape(-1).astype(index_type),
                gl.UNSIGNED_SHORT if index_type is np.uint16 else gl.UNSIGNED_INT,
                "SCALAR",
                gl.ELEMENT_ARRAY_BUFFER,
            )
            gltf_primitives.append(
                gl.Primitive(
                    attributes=attributes,
                    indices=indices,
                    material=self._materials[primitive.material],
                    mode=gl.TRIANGLES,
                )
            )
        self._gltf.meshes.append(gl.Mesh(name=name, primitives=gltf_primitives))
        return len(self._gltf.meshes) - 1

    def add_node(
        self,
        name: str,
        *,
        parent: str | None = None,
        mesh: int | None = None,
        translation: Sequence[float] | None = None,
        rotation: Sequence[float] | None = None,
        scale: Sequence[float] | None = None,
        extras: Mapping[str, Any] | None = None,
    ) -> None:
        """Fügt einen benannten Knoten ein; ``translation`` legt den Pivot relativ zum Elternknoten fest.

        ``extras`` landen im glTF-Feld ``extras`` und in Babylon unter ``node.metadata.gltf.extras``.
        """
        self._append_node(
            gl.Node(
                name=name,
                mesh=mesh,
                translation=_floats(translation),
                rotation=_floats(rotation),
                scale=_floats(scale),
                extras=dict(extras) if extras else {},
            ),
            parent,
        )

    def add_instanced_node(self, name: str, *, parent: str | None, mesh: int, instances: InstanceSet) -> None:
        """Fügt einen Knoten ein, der ``mesh`` per ``EXT_mesh_gpu_instancing`` vervielfältigt.

        Babylon lädt solche Knoten als Thin Instances (ein Draw Call je Primitive und Knoten).
        """
        extension = {
            "attributes": {
                "TRANSLATION": self._accessor(instances.translations.astype(np.float32), gl.FLOAT, "VEC3", None),
                "ROTATION": self._accessor(instances.rotations.astype(np.float32), gl.FLOAT, "VEC4", None),
                "SCALE": self._accessor(instances.scales.astype(np.float32), gl.FLOAT, "VEC3", None),
            }
        }
        self._extensions.add(_INSTANCING)
        self._append_node(gl.Node(name=name, mesh=mesh, extensions={_INSTANCING: extension}), parent)

    def import_glb_mesh(self, path: Path, mesh_name: str | None = None) -> int:
        """Übernimmt ein Mesh samt Materialien und Texturen aus einer fertigen .glb-Datei.

        Ohne ``mesh_name`` wird das erste Mesh übernommen. Materialien, deren Name bereits
        registriert ist, werden wiederverwendet — gleichnamige Materialien gelten als identisch.
        Liefert den Index des neuen Meshes.
        """
        source = gl.GLTF2().load_binary(str(path))
        blob = source.binary_blob() or b""
        meshes = [mesh for mesh in source.meshes if mesh_name is None or mesh.name == mesh_name]
        if not meshes:
            raise ValueError(f"{path.name}: Mesh {mesh_name!r} nicht gefunden.")
        importer = _GlbImporter(self, source, blob)
        primitives = []
        for primitive in meshes[0].primitives:
            attributes = gl.Attributes(
                **{
                    key: importer.accessor(index)
                    for key, index in vars(primitive.attributes).items()
                    if index is not None
                }
            )
            primitives.append(
                gl.Primitive(
                    attributes=attributes,
                    indices=importer.accessor(primitive.indices) if primitive.indices is not None else None,
                    material=importer.material(primitive.material) if primitive.material is not None else None,
                    mode=primitive.mode,
                )
            )
        self._gltf.meshes.append(gl.Mesh(name=meshes[0].name, primitives=primitives))
        return len(self._gltf.meshes) - 1

    def add_rotation_animation(self, name: str, tracks: Sequence[RotationTrack]) -> None:
        """Schreibt eine Animation aus Rotationsspuren (Interpolation LINEAR = Slerp)."""
        animation = gl.Animation(name=name)
        for track in tracks:
            sampler = gl.AnimationSampler(
                input=self._accessor(track.times.astype(np.float32), gl.FLOAT, "SCALAR", None, bounds=True),
                output=self._accessor(track.quaternions.astype(np.float32), gl.FLOAT, "VEC4", None),
                interpolation=gl.ANIM_LINEAR,
            )
            animation.samplers.append(sampler)
            animation.channels.append(
                gl.AnimationChannel(
                    sampler=len(animation.samplers) - 1,
                    target=gl.AnimationChannelTarget(node=self._nodes[track.node], path="rotation"),
                )
            )
        self._gltf.animations.append(animation)

    def write_glb(self, path: Path) -> None:
        """Schließt das Dokument ab und schreibt die .glb-Datei."""
        self._gltf.scenes = [gl.Scene(name="Scene", nodes=list(self._roots))]
        self._gltf.buffers = [gl.Buffer(byteLength=len(self._blob))]
        self._gltf.extensionsUsed = sorted(self._extensions)
        self._gltf.set_binary_blob(bytes(self._blob))
        path.parent.mkdir(parents=True, exist_ok=True)
        self._gltf.save_binary(str(path))

    def _append_node(self, node: gl.Node, parent: str | None) -> None:
        index = len(self._gltf.nodes)
        self._gltf.nodes.append(node)
        self._nodes[node.name] = index
        if parent is None:
            self._roots.append(index)
        else:
            self._gltf.nodes[self._nodes[parent]].children.append(index)

    def _sampler(self, wrap_s: int, wrap_t: int, mag_filter: int | None, min_filter: int | None) -> int:
        key = (wrap_s, wrap_t, mag_filter, min_filter)
        if key not in self._samplers:
            self._gltf.samplers.append(
                gl.Sampler(magFilter=mag_filter, minFilter=min_filter, wrapS=wrap_s, wrapT=wrap_t)
            )
            self._samplers[key] = len(self._gltf.samplers) - 1
        return self._samplers[key]

    def _color_accessor(self, colors: FloatArray) -> int:
        """COLOR_0 als normalisierte Bytes: RGB → VEC3 mit 4-Byte-Stride (deckend), RGBA → VEC4.

        Babylon setzt bei VEC4-Farben ``hasVertexAlpha``; deckende Teile bekommen daher VEC3.
        """
        quantized = np.round(np.clip(colors, 0.0, 1.0) * 255.0).astype(np.uint8)
        if colors.shape[1] == 4:
            return self._accessor(quantized, gl.UNSIGNED_BYTE, "VEC4", gl.ARRAY_BUFFER, normalized=True)
        padded = np.zeros((len(quantized), 4), dtype=np.uint8)
        padded[:, :3] = quantized
        return self._accessor(padded, gl.UNSIGNED_BYTE, "VEC3", gl.ARRAY_BUFFER, normalized=True, byte_stride=4)

    def _accessor(
        self,
        data: np.ndarray,
        component_type: int,
        accessor_type: str,
        target: int | None,
        *,
        normalized: bool = False,
        bounds: bool = False,
        byte_stride: int | None = None,
    ) -> int:
        view = self._buffer_view(np.ascontiguousarray(data).tobytes(), target, byte_stride)
        rows = data.reshape(len(data), -1)
        self._gltf.accessors.append(
            gl.Accessor(
                bufferView=view,
                componentType=component_type,
                normalized=normalized or None,
                count=len(data),
                type=accessor_type,
                min=rows.min(axis=0).tolist() if bounds else None,
                max=rows.max(axis=0).tolist() if bounds else None,
            )
        )
        return len(self._gltf.accessors) - 1

    def _buffer_view(self, payload: bytes, target: int | None, byte_stride: int | None = None) -> int:
        """Hängt Nutzdaten an den Puffer an und legt einen BufferView an; liefert dessen Index."""
        # Pufferabschnitte auf 4 Byte ausrichten (glTF-Pflicht für Vertexattribute)
        self._blob.extend(b"\x00" * (-len(self._blob) % 4))
        self._gltf.bufferViews.append(
            gl.BufferView(
                buffer=0,
                byteOffset=len(self._blob),
                byteLength=len(payload),
                byteStride=byte_stride,
                target=target,
            )
        )
        self._blob.extend(payload)
        return len(self._gltf.bufferViews) - 1


class _GlbImporter:
    """Überträgt Accessoren, Texturen und Materialien eines Quell-glb in einen ``GltfBuilder``."""

    def __init__(self, builder: GltfBuilder, source: gl.GLTF2, blob: bytes) -> None:
        self._builder = builder
        self._source = source
        self._blob = blob
        self._textures: dict[int, int] = {}

    def accessor(self, index: int) -> int:
        """Kopiert einen Accessor mit seinem BufferView (sparse Accessoren werden nicht unterstützt)."""
        accessor = self._source.accessors[index]
        if accessor.sparse is not None or accessor.bufferView is None:
            raise ValueError("Sparse Accessoren werden beim Import nicht unterstützt.")
        view = self._source.bufferViews[accessor.bufferView]
        start = view.byteOffset or 0
        payload = self._blob[start : start + view.byteLength]
        new_view = self._builder._buffer_view(payload, view.target, view.byteStride)
        copied = copy.deepcopy(accessor)
        copied.bufferView = new_view
        self._builder._gltf.accessors.append(copied)
        return len(self._builder._gltf.accessors) - 1

    def material(self, index: int) -> int:
        """Kopiert ein Material samt Texturen oder verwendet ein gleichnamiges wieder."""
        material = copy.deepcopy(self._source.materials[index])
        existing = self._builder._materials.get(material.name)
        if existing is not None:
            return existing
        pbr = material.pbrMetallicRoughness
        slots = [material.normalTexture, material.occlusionTexture, material.emissiveTexture]
        if pbr is not None:
            slots += [pbr.baseColorTexture, pbr.metallicRoughnessTexture]
        for slot in slots:
            if slot is not None:
                slot.index = self._texture(slot.index)
        self._builder._gltf.materials.append(material)
        self._builder._materials[material.name] = len(self._builder._gltf.materials) - 1
        return self._builder._materials[material.name]

    def _texture(self, index: int) -> int:
        if index in self._textures:
            return self._textures[index]
        texture = self._source.textures[index]
        image = self._source.images[texture.source]
        view = self._source.bufferViews[image.bufferView]
        start = view.byteOffset or 0
        new_view = self._builder._buffer_view(self._blob[start : start + view.byteLength], target=None)
        self._builder._gltf.images.append(gl.Image(name=image.name, bufferView=new_view, mimeType=image.mimeType))
        sampler = self._source.samplers[texture.sampler] if texture.sampler is not None else gl.Sampler()
        sampler_index = self._builder._sampler(
            sampler.wrapS or _WRAP_MODES["repeat"],
            sampler.wrapT or _WRAP_MODES["repeat"],
            sampler.magFilter,
            sampler.minFilter,
        )
        self._builder._gltf.textures.append(
            gl.Texture(name=texture.name, source=len(self._builder._gltf.images) - 1, sampler=sampler_index)
        )
        self._textures[index] = len(self._builder._gltf.textures) - 1
        return self._textures[index]


def _texture_info(index: TextureIndex | None) -> gl.TextureInfo | None:
    return None if index is None else gl.TextureInfo(index=index)


def _floats(values: Sequence[float] | None) -> list[float] | None:
    return [float(v) for v in values] if values is not None else None
