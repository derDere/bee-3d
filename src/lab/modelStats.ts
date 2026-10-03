import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { Material } from "@babylonjs/core/Materials/material";
import type { Node } from "@babylonjs/core/node";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { LoadedModel, ModelBounds } from "./modelLoader";
import type { Vec3Tuple } from "./types";

export interface MaterialInfo {
  name: string;
  /** OPAQUE, MASK (Alpha-Test), BLEND (Alpha-Blend) oder MASK+BLEND. */
  alphaMode: string;
  doubleSided: boolean;
  usedByMeshes: number;
  /** true, wenn mindestens ein Mesh dieses Materials Vertexfarben (COLOR_0) hat. */
  vertexColors: boolean;
  /** true, wenn mindestens ein Mesh dieses Materials UV-Koordinaten (TEXCOORD_0) hat. */
  uv0: boolean;
}

export interface TextureInfo {
  name: string;
  width: number;
  height: number;
}

export interface AnimationInfo {
  name: string;
  durationSeconds: number;
  framesPerSecond: number;
  loop: boolean;
  targets: number;
}

export interface HierarchyNode {
  name: string;
  type: string;
  triangles?: number;
  children: HierarchyNode[];
}

export interface LabStats {
  meshes: number;
  vertices: number;
  triangles: number;
  materials: MaterialInfo[];
  textures: TextureInfo[];
  animations: AnimationInfo[];
  /** Bounding Box in Metern, glTF-Koordinaten (+Y oben, +Z vorne). */
  boundingBox: { min: Vec3Tuple; max: Vec3Tuple; size: Vec3Tuple };
  /** Lage des Ursprungs relativ zur Box: 0 = Min-Kante, 1 = Max-Kante, je Achse. */
  origin: { fraction: Vec3Tuple; insideBox: boolean; description: string };
  hierarchy: HierarchyNode[];
}

const round = (value: number): number => Math.round(value * 10000) / 10000;
const tuple = (x: number, y: number, z: number): Vec3Tuple => [round(x), round(y), round(z)];

function alphaModeOf(material: Material): string {
  if (material instanceof PBRMaterial) {
    return ["OPAQUE", "MASK", "BLEND", "MASK+BLEND"][material.transparencyMode ?? 0] ?? "OPAQUE";
  }
  if (material instanceof StandardMaterial) return material.alpha < 1 ? "BLEND" : "OPAQUE";
  return material.needAlphaBlending() ? "BLEND" : "OPAQUE";
}

function describeOrigin(fraction: Vec3Tuple): string {
  const axisText = (value: number, low: string, mid: string, high: string): string =>
    value < 0.02 ? low : value > 0.98 ? high : mid;
  const [fx, fy, fz] = fraction;
  return [
    `X: ${axisText(fx, "min edge", "centre/inside", "max edge")} (${fx.toFixed(2)})`,
    `Y: ${axisText(fy, "bottom (feet)", "centre/inside", "top")} (${fy.toFixed(2)})`,
    `Z: ${axisText(fz, "back edge", "centre/inside", "front edge")} (${fz.toFixed(2)})`,
  ].join(", ");
}

function buildHierarchy(node: Node): HierarchyNode {
  const mesh = node as AbstractMesh;
  const info: HierarchyNode = { name: node.name, type: node.getClassName(), children: [] };
  if (typeof mesh.getTotalIndices === "function" && mesh.getTotalVertices() > 0) {
    info.triangles = mesh.getTotalIndices() / 3;
  }
  info.children = node.getChildren().map(buildHierarchy);
  return info;
}

/** Sammelt alle Kennzahlen des geladenen Modells. */
export function collectStats(model: LoadedModel, bounds: ModelBounds): LabStats {
  const { meshes, container } = model;
  const materials: MaterialInfo[] = container.materials.map((material) => {
    const users = meshes.filter((mesh) => mesh.material === material);
    return {
      name: material.name,
      alphaMode: alphaModeOf(material),
      doubleSided: !material.backFaceCulling,
      usedByMeshes: users.length,
      vertexColors: users.some((mesh) => mesh.isVerticesDataPresent(VertexBuffer.ColorKind)),
      uv0: users.some((mesh) => mesh.isVerticesDataPresent(VertexBuffer.UVKind)),
    };
  });

  const textureMap = new Map<string, TextureInfo>();
  for (const material of container.materials) {
    for (const texture of material.getActiveTextures()) {
      const size = texture.getSize();
      textureMap.set(texture.uniqueId.toString(), { name: texture.name, width: size.width, height: size.height });
    }
  }

  const { min, max, size } = bounds;
  const fraction = tuple(
    size.x > 0 ? -min.x / size.x : 0,
    size.y > 0 ? -min.y / size.y : 0,
    size.z > 0 ? -min.z / size.z : 0,
  );
  const insideBox = fraction.every((value) => value >= 0 && value <= 1);
  const rootNodes = container.rootNodes.flatMap((root) => (root.name === "__root__" ? root.getChildren() : [root]));

  return {
    meshes: meshes.length,
    vertices: meshes.reduce((sum, mesh) => sum + mesh.getTotalVertices(), 0),
    triangles: meshes.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0),
    materials,
    textures: [...textureMap.values()],
    animations: container.animationGroups.map((group) => {
      const framesPerSecond = group.targetedAnimations[0]?.animation.framePerSecond ?? 60;
      return {
        name: group.name,
        durationSeconds: round((group.to - group.from) / framesPerSecond),
        framesPerSecond,
        loop: group.loopAnimation,
        targets: group.targetedAnimations.length,
      };
    }),
    boundingBox: { min: tuple(min.x, min.y, min.z), max: tuple(max.x, max.y, max.z), size: tuple(size.x, size.y, size.z) },
    origin: { fraction, insideBox, description: describeOrigin(fraction) },
    hierarchy: rootNodes.map(buildHierarchy),
  };
}
