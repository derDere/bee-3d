// Szene der Effekt-Werkstatt: dunkelblauer Himmelsverlauf, Sonne und Himmelslicht, HDR-Pipeline mit
// Bloom (Schwelle 1,1) und ACES wie im Spiel, Orbit-Kamera sowie Blumenfeld und Flugloch als Requisiten.
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Meshes/thinInstanceMesh";

const SkyVertexShader = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDirection;
void main(void) {
  vDirection = position;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const SkyFragmentShader = /* glsl */ `
precision highp float;
varying vec3 vDirection;
uniform vec3 zenithColor;
uniform vec3 horizonColor;
uniform vec3 nadirColor;
void main(void) {
  float y = normalize(vDirection).y;
  vec3 color = y > 0.0 ? mix(horizonColor, zenithColor, pow(y, 0.55)) : mix(horizonColor, nadirColor, pow(-y, 0.4));
  gl_FragColor = vec4(color, 1.0);
}
`;

/** Lage der Requisiten in der Werkstatt (Requisitenpunkte). */
export const LabProps = {
  flowerField: new Vector3(4.5, -1.6, 3),
  hiveEntrance: new Vector3(-9, 1.5, 7),
} as const;

/** Szene, Kamera und Bildkette der Effekt-Werkstatt (Werkstattszene). */
export class LabScene {
  public readonly scene: Scene;
  public readonly camera: ArcRotateCamera;
  public readonly pipeline: DefaultRenderingPipeline;
  public readonly sun: DirectionalLight;

  public constructor(engine: AbstractEngine) {
    this.scene = new Scene(engine);
    this.scene.clearColor = new Color4(0, 0, 0, 1);
    this.scene.skipPointerMovePicking = true;

    this.camera = new ArcRotateCamera("fxLabCamera", -Math.PI * 0.62, Math.PI * 0.42, 3, Vector3.Zero(), this.scene);
    this.camera.fov = (62 * Math.PI) / 180;
    this.camera.minZ = 0.05;
    this.camera.maxZ = 0; // unendliche Fernebene wie im Spiel
    this.camera.lowerRadiusLimit = 0.3;
    this.camera.upperRadiusLimit = 400;
    this.camera.wheelDeltaPercentage = 0.03;
    this.camera.panningSensibility = 0;
    this.camera.attachControl(true);
    this.scene.activeCamera = this.camera;

    this.sun = new DirectionalLight("fxLabSun", new Vector3(-0.45, -0.7, 0.55), this.scene);
    this.sun.intensity = 2.4;
    this.sun.diffuse = new Color3(1, 0.95, 0.86);
    const fill = new HemisphericLight("fxLabFill", new Vector3(0, 1, 0), this.scene);
    fill.intensity = 0.55;
    fill.diffuse = new Color3(0.55, 0.65, 0.9);
    fill.groundColor = new Color3(0.08, 0.08, 0.12);

    this.createSky();
    this.createFlowerField();
    this.createHiveEntrance();
    this.pipeline = this.createPipeline();
    // Effekte in Gruppe 1 sehen die Tiefe der Szene (Gruppe 0) wie im Spiel
    this.scene.setRenderingAutoClearDepthStencil(1, false, false, false);
  }

  /** Setzt den Kameraabstand zum Ziel (Meter). */
  public setDistance(distance: number): void {
    this.camera.radius = Math.max(0.3, distance);
  }

  private createSky(): void {
    const sky = CreateSphere("fxLabSky", { diameter: 1800, segments: 24, sideOrientation: Mesh.BACKSIDE }, this.scene);
    const material = new ShaderMaterial(
      "fxLabSkyMaterial",
      this.scene,
      { vertexSource: SkyVertexShader, fragmentSource: SkyFragmentShader },
      { attributes: ["position"], uniforms: ["worldViewProjection", "zenithColor", "horizonColor", "nadirColor"] },
    );
    material.setColor3("zenithColor", new Color3(0.004, 0.012, 0.05));
    material.setColor3("horizonColor", new Color3(0.06, 0.12, 0.26));
    material.setColor3("nadirColor", new Color3(0.012, 0.02, 0.05));
    material.disableDepthWrite = true;
    material.backFaceCulling = false;
    sky.material = material;
    sky.infiniteDistance = true;
    sky.isPickable = false;
    sky.renderingGroupId = 0;
  }

  private createFlowerField(): void {
    const ground = CreateDisc("fxLabMeadow", { radius: 0.9, tessellation: 40 }, this.scene);
    ground.rotation.x = Math.PI / 2;
    ground.position.copyFrom(LabProps.flowerField);
    const groundMaterial = new StandardMaterial("fxLabMeadowMaterial", this.scene);
    groundMaterial.diffuseColor = new Color3(0.12, 0.28, 0.08);
    groundMaterial.specularColor = Color3.Black();
    groundMaterial.backFaceCulling = false;
    ground.material = groundMaterial;

    const blossom = CreateSphere("fxLabBlossom", { diameter: 0.05, segments: 6 }, this.scene);
    const blossomMaterial = new StandardMaterial("fxLabBlossomMaterial", this.scene);
    blossomMaterial.diffuseColor = new Color3(1, 0.85, 0.25);
    blossomMaterial.emissiveColor = new Color3(0.25, 0.18, 0.04);
    blossom.material = blossomMaterial;
    const matrices = new Float32Array(28 * 16);
    const matrix = new Matrix();
    for (let i = 0; i < 28; i++) {
      const angle = i * 2.399963;
      const radius = 0.78 * Math.sqrt((i + 0.5) / 28);
      Matrix.TranslationToRef(
        LabProps.flowerField.x + Math.cos(angle) * radius,
        LabProps.flowerField.y + 0.06 + (i % 3) * 0.03,
        LabProps.flowerField.z + Math.sin(angle) * radius,
        matrix,
      );
      matrix.copyToArray(matrices, i * 16);
    }
    blossom.thinInstanceSetBuffer("matrix", matrices, 16, true);
  }

  private createHiveEntrance(): void {
    const rim = CreateTorus("fxLabHiveRim", { diameter: 3, thickness: 0.6, tessellation: 40 }, this.scene);
    rim.position.copyFrom(LabProps.hiveEntrance);
    rim.rotation.x = Math.PI / 2;
    rim.rotation.y = Math.atan2(-LabProps.hiveEntrance.x, -LabProps.hiveEntrance.z);
    const rimMaterial = new StandardMaterial("fxLabHiveMaterial", this.scene);
    rimMaterial.diffuseColor = new Color3(0.55, 0.36, 0.12);
    rimMaterial.specularColor = new Color3(0.2, 0.15, 0.08);
    rim.material = rimMaterial;
    const hole = CreateDisc("fxLabHiveHole", { radius: 1.35, tessellation: 40 }, this.scene);
    hole.parent = rim;
    hole.rotation.x = -Math.PI / 2;
    const holeMaterial = new StandardMaterial("fxLabHiveHoleMaterial", this.scene);
    holeMaterial.diffuseColor = new Color3(0.02, 0.015, 0.01);
    holeMaterial.specularColor = Color3.Black();
    holeMaterial.backFaceCulling = false;
    hole.material = holeMaterial;
  }

  private createPipeline(): DefaultRenderingPipeline {
    const pipeline = new DefaultRenderingPipeline("fxLabPost", true, this.scene, [this.camera]);
    pipeline.samples = 4;
    pipeline.bloomEnabled = true;
    pipeline.bloomThreshold = 1.1;
    pipeline.bloomWeight = 0.22;
    pipeline.bloomKernel = 64;
    pipeline.bloomScale = 0.5;
    const imageProcessing = this.scene.imageProcessingConfiguration;
    imageProcessing.toneMappingEnabled = true;
    imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    imageProcessing.ditheringEnabled = true;
    imageProcessing.vignetteEnabled = true;
    imageProcessing.vignetteWeight = 1.1;
    imageProcessing.vignetteStretch = 0.2;
    imageProcessing.vignetteColor = new Color4(0.02, 0.03, 0.06, 0);
    imageProcessing.contrast = 1.06;
    return pipeline;
  }

  public dispose(): void {
    this.pipeline.dispose();
    this.scene.dispose();
  }
}
