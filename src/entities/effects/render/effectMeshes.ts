// Einfache Effekt-Meshes ohne Modelldatei: Stachelrakete (Drehkörper) und Flügelsplitter (flaches Vieleck).
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Scene } from "@babylonjs/core/scene";
import { useMaterialImageProcessing } from "../../../rendering/materialImageProcessing";

/** Profil des Stachels entlang +z, Spitze vorne (Länge 6 cm): Paare aus z und Radius in Metern. */
const StingerProfile: ReadonlyArray<readonly [number, number]> = [
  [-0.028, 0],
  [-0.0265, 0.0038],
  [-0.021, 0.0062],
  [-0.013, 0.0058],
  [-0.002, 0.0038],
  [0.014, 0.0018],
  [0.032, 0],
];
const StingerSegments = 8;

/** Umriss eines Flügelsplitters in der xy-Ebene, Einheitsgröße um den Schwerpunkt. */
const WingShardOutline: ReadonlyArray<readonly [number, number]> = [
  [-0.48, -0.22],
  [0.08, -0.16],
  [0.52, 0.02],
  [0.36, 0.3],
  [-0.06, 0.26],
  [-0.4, 0.1],
];

/** Erzeugt den Stachel einer Stachelrakete als Drehkörper mit dunklem Chitin-Material (Stachel-Mesh). */
export function createStingerMesh(scene: Scene): Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const stride = StingerSegments + 1;
  for (const [z, radius] of StingerProfile) {
    for (let s = 0; s <= StingerSegments; s++) {
      const angle = (s / StingerSegments) * Math.PI * 2;
      positions.push(radius * Math.cos(angle), radius * Math.sin(angle), z);
    }
  }
  for (let ring = 0; ring < StingerProfile.length - 1; ring++) {
    for (let s = 0; s < StingerSegments; s++) {
      const a = ring * stride + s;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  const mesh = new Mesh("fxStinger", scene);
  data.applyToMesh(mesh, false);

  const material = new StandardMaterial("fxStingerMaterial", scene);
  material.diffuseColor = new Color3(0.07, 0.05, 0.03);
  material.specularColor = new Color3(0.55, 0.5, 0.45);
  material.specularPower = 48;
  material.emissiveColor = new Color3(0.015, 0.01, 0.005);
  material.backFaceCulling = false;
  useMaterialImageProcessing(material);
  mesh.material = material;
  return mesh;
}

/** Erzeugt einen durchscheinenden, schillernden Flügelsplitter für platzende Fliegen (Flügelsplitter-Mesh). */
export function createWingShardMesh(scene: Scene): Mesh {
  const positions: number[] = [0, 0, 0];
  const normals: number[] = [0, 0, 1];
  const indices: number[] = [];
  for (const [x, y] of WingShardOutline) {
    positions.push(x, y, 0);
    normals.push(0, 0, 1);
  }
  for (let i = 0; i < WingShardOutline.length; i++) {
    const next = (i + 1) % WingShardOutline.length;
    indices.push(0, i + 1, next + 1);
  }
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  const mesh = new Mesh("fxWingShard", scene);
  data.applyToMesh(mesh, false);

  const material = new StandardMaterial("fxWingShardMaterial", scene);
  material.diffuseColor = new Color3(0.62, 0.66, 0.72);
  material.specularColor = new Color3(0.9, 0.95, 1);
  material.specularPower = 24;
  material.emissiveColor = new Color3(0.05, 0.06, 0.07);
  material.alpha = 0.55;
  material.backFaceCulling = false;
  material.twoSidedLighting = true;
  useMaterialImageProcessing(material);
  mesh.material = material;
  return mesh;
}
