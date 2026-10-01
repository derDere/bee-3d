import "@babylonjs/loaders/glTF";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Scene } from "@babylonjs/core/scene";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

/** Achsparallele Begrenzungsbox des Modells in Metern (Bounding Box). */
export interface ModelBounds {
  min: Vector3;
  max: Vector3;
  center: Vector3;
  size: Vector3;
  /** Längste Kante. */
  maxExtent: number;
  /** Radius der umschließenden Kugel. */
  radius: number;
  /** Gleichmäßige Stichprobe der Eckpunkte in Weltkoordinaten (für enges Einpassen der Kameras). */
  samplePoints: Vector3[];
}

const MAX_SAMPLE_POINTS = 20000;

function sampleWorldPoints(meshes: readonly AbstractMesh[]): Vector3[] {
  const total = meshes.reduce((sum, mesh) => sum + mesh.getTotalVertices(), 0);
  const stride = Math.max(1, Math.ceil(total / MAX_SAMPLE_POINTS));
  const points: Vector3[] = [];
  for (const mesh of meshes) {
    const data = mesh.getVerticesData(VertexBuffer.PositionKind);
    if (!data) continue;
    const world = mesh.getWorldMatrix();
    for (let i = 0; i + 2 < data.length; i += 3 * stride) {
      points.push(Vector3.TransformCoordinates(new Vector3(data[i], data[i + 1], data[i + 2]), world));
    }
  }
  return points;
}

export interface LoadedModel {
  container: AssetContainer;
  /** Alle Meshes mit Geometrie. */
  meshes: AbstractMesh[];
}

/** Berechnet die Weltbox über alle Meshes mit Geometrie. */
export function computeBounds(meshes: readonly AbstractMesh[]): ModelBounds {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true);
    const box = mesh.getBoundingInfo().boundingBox;
    min.minimizeInPlace(box.minimumWorld);
    max.maximizeInPlace(box.maximumWorld);
  }
  const size = max.subtract(min);
  return {
    min,
    max,
    center: min.add(max).scale(0.5),
    size,
    maxExtent: Math.max(size.x, size.y, size.z),
    radius: size.length() / 2,
    samplePoints: sampleWorldPoints(meshes),
  };
}

/** Lädt ein glb/gltf und fügt es der Szene hinzu; die Box wird erst nach dem Setzen der Animationspose vermessen. Die Szene muss rechtshändig sein (glTF-Koordinaten). */
export async function loadModel(scene: Scene, url: string): Promise<LoadedModel> {
  const container = await LoadAssetContainerAsync(url, scene);
  container.addAllToScene();
  const meshes = container.meshes.filter((mesh) => mesh.getTotalVertices() > 0);
  if (meshes.length === 0) {
    throw new Error(`Das Modell enthält keine Geometrie: ${url}`);
  }
  return { container, meshes };
}
