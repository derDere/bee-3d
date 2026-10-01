import { NodeMaterial } from "@babylonjs/core/Materials/Node/nodeMaterial";
import { NodeMaterialSystemValues } from "@babylonjs/core/Materials/Node/Enums/nodeMaterialSystemValues";
import { AddBlock } from "@babylonjs/core/Materials/Node/Blocks/addBlock";
import { FragmentOutputBlock } from "@babylonjs/core/Materials/Node/Blocks/Fragment/fragmentOutputBlock";
import { InputBlock } from "@babylonjs/core/Materials/Node/Blocks/Input/inputBlock";
import { NormalizeBlock } from "@babylonjs/core/Materials/Node/Blocks/normalizeBlock";
import { ScaleBlock } from "@babylonjs/core/Materials/Node/Blocks/scaleBlock";
import { TransformBlock } from "@babylonjs/core/Materials/Node/Blocks/transformBlock";
import { VertexOutputBlock } from "@babylonjs/core/Materials/Node/Blocks/Vertex/vertexOutputBlock";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

function attribute(name: string, attributeName: string): InputBlock {
  const block = new InputBlock(name);
  block.setAsAttribute(attributeName);
  return block;
}

function systemValue(name: string, value: NodeMaterialSystemValues): InputBlock {
  const block = new InputBlock(name);
  block.setAsSystemValue(value);
  return block;
}

function constant(name: string, value: number): InputBlock {
  const block = new InputBlock(name);
  block.value = value;
  return block;
}

/** Unbeleuchtetes Material, das die Weltnormale als Farbe zeigt (xyz * 0.5 + 0.5). */
export function createNormalMaterial(scene: Scene): NodeMaterial {
  const material = new NodeMaterial("lab-normals", scene, { emitComments: false });

  const world = systemValue("world", NodeMaterialSystemValues.World);
  const viewProjection = systemValue("viewProjection", NodeMaterialSystemValues.ViewProjection);

  const worldPosition = new TransformBlock("worldPosition");
  attribute("position", "position").output.connectTo(worldPosition.vector);
  world.output.connectTo(worldPosition.transform);

  const clipPosition = new TransformBlock("clipPosition");
  worldPosition.output.connectTo(clipPosition.vector);
  viewProjection.output.connectTo(clipPosition.transform);

  const vertexOutput = new VertexOutputBlock("vertexOutput");
  clipPosition.output.connectTo(vertexOutput.vector);

  // Normale als Richtung (w = 0) in den Weltraum
  const worldNormal = new TransformBlock("worldNormal");
  worldNormal.complementW = 0;
  attribute("normal", "normal").output.connectTo(worldNormal.vector);
  world.output.connectTo(worldNormal.transform);

  const normalize = new NormalizeBlock("normalize");
  worldNormal.xyz.connectTo(normalize.input);

  const half = new InputBlock("half");
  half.value = new Vector3(0.5, 0.5, 0.5);
  const scaled = new ScaleBlock("scaled");
  normalize.output.connectTo(scaled.input);
  constant("halfFactor", 0.5).output.connectTo(scaled.factor);
  const shifted = new AddBlock("shifted");
  scaled.output.connectTo(shifted.left);
  half.output.connectTo(shifted.right);

  const fragmentOutput = new FragmentOutputBlock("fragmentOutput");
  shifted.output.connectTo(fragmentOutput.rgb);

  material.addOutputNode(vertexOutput);
  material.addOutputNode(fragmentOutput);
  material.build(false);
  return material;
}
