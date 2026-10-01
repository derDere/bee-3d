import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { CubeTexture } from "@babylonjs/core/Materials/Textures/cubeTexture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateLineSystem } from "@babylonjs/core/Meshes/Builders/linesBuilder";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { ModelBounds } from "./modelLoader";

const GRID_STEPS_M = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];

/** Wählt die kleinste runde Rasterweite, die das Modell in höchstens ~10 Zellen abdeckt. */
export function pickGridStep(maxExtent: number): number {
  return GRID_STEPS_M.find((step) => step >= maxExtent / 10) ?? 100;
}

/** Zeichnet eine Würfelfläche des Studio-Himmels: Verlauf von oben (hell) nach unten (dunkel). */
function createFaceUrl(kind: "side" | "top" | "bottom", softbox: boolean): string {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D-Kontext für die Umgebungstextur nicht verfügbar.");
  if (kind === "side") {
    const gradient = ctx.createLinearGradient(0, 0, 0, size);
    gradient.addColorStop(0, "#cfd4dc");
    gradient.addColorStop(0.5, "#a4a8ae");
    gradient.addColorStop(0.5, "#7d7f83");
    gradient.addColorStop(1, "#56585b");
    ctx.fillStyle = gradient;
  } else {
    ctx.fillStyle = kind === "top" ? "#e6eaf0" : "#5a5c5f";
  }
  ctx.fillRect(0, 0, size, size);
  if (softbox) {
    // Softbox: helle Fläche als Lichtquelle in der Reflexion
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(size * 0.2, size * 0.18, size * 0.6, size * 0.32);
  }
  return canvas.toDataURL("image/png");
}

/** Neutrale Studio-Umgebung als 8-Bit-Würfeltextur (Reihenfolge +X, +Y, +Z, -X, -Y, -Z), ohne Netzwerk. */
function createStudioEnvironment(scene: Scene): CubeTexture {
  const urls = [
    createFaceUrl("side", false), createFaceUrl("top", false), createFaceUrl("side", true),
    createFaceUrl("side", true), createFaceUrl("bottom", false), createFaceUrl("side", false),
  ];
  return CubeTexture.CreateFromImages(urls, scene);
}

/** Studio-Aufbau: Umgebungslicht (IBL), Key-Light mit weichem Schatten, Boden mit Maßraster. */
export class Studio {
  readonly gridStep: number;
  private readonly shadowGenerator: ShadowGenerator;

  constructor(scene: Scene, bounds: ModelBounds) {
    this.gridStep = pickGridStep(bounds.maxExtent);
    scene.clearColor = new Color4(0.2, 0.21, 0.23, 1);

    scene.environmentTexture = createStudioEnvironment(scene);
    scene.environmentIntensity = 0.9;

    const fill = new HemisphericLight("fill", Vector3.Up(), scene);
    fill.intensity = 0.15;

    const key = new DirectionalLight("key", new Vector3(0.45, -1, -0.25).normalize(), scene);
    key.intensity = 2.2;
    key.position = bounds.center.add(key.direction.scale(-bounds.maxExtent * 4));
    this.shadowGenerator = new ShadowGenerator(2048, key);
    this.shadowGenerator.usePercentageCloserFiltering = true;
    this.shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_HIGH;
    this.shadowGenerator.bias = 0.0005;
    this.shadowGenerator.normalBias = bounds.maxExtent * 0.004;

    const image = scene.imageProcessingConfiguration;
    image.toneMappingEnabled = true;
    image.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
    image.exposure = 1;

    this.createGround(scene, bounds);
    this.createOriginAxes(scene, bounds);
  }

  /** Meshes, die einen Schatten werfen sollen. */
  addShadowCasters(meshes: readonly AbstractMesh[]): void {
    for (const mesh of meshes) {
      this.shadowGenerator.addShadowCaster(mesh);
    }
  }

  private createGround(scene: Scene, bounds: ModelBounds): void {
    const step = this.gridStep;
    const reach = Math.max(
      Math.abs(bounds.min.x), Math.abs(bounds.max.x), Math.abs(bounds.min.z), Math.abs(bounds.max.z),
    );
    const half = Math.max(3, Math.ceil((reach * 1.6) / step)) * step;
    const y = bounds.min.y;

    const ground = CreateGround("lab-ground", { width: half * 2, height: half * 2 }, scene);
    ground.position.y = y;
    ground.receiveShadows = true;
    const material = new PBRMaterial("lab-ground-mat", scene);
    material.albedoColor = new Color3(0.62, 0.64, 0.66);
    material.metallic = 0;
    material.roughness = 0.95;
    ground.material = material;

    // Rasterlinien knapp über dem Boden; jede 5. Linie als Hauptlinie.
    const lift = bounds.maxExtent * 0.0015;
    const minor: Vector3[][] = [];
    const major: Vector3[][] = [];
    const count = Math.round(half / step);
    for (let i = -count; i <= count; i++) {
      const target = i % 5 === 0 ? major : minor;
      target.push([new Vector3(i * step, y + lift, -half), new Vector3(i * step, y + lift, half)]);
      target.push([new Vector3(-half, y + lift, i * step), new Vector3(half, y + lift, i * step)]);
    }
    const minorLines = CreateLineSystem("lab-grid-minor", { lines: minor }, scene);
    minorLines.color = new Color3(0.45, 0.47, 0.5);
    const majorLines = CreateLineSystem("lab-grid-major", { lines: major }, scene);
    majorLines.color = new Color3(0.28, 0.3, 0.33);
    for (const line of [minorLines, majorLines]) line.isPickable = false;
  }

  /** Achsenkreuz im Ursprung: X rot, Y grün, Z blau (glTF-Koordinaten). */
  private createOriginAxes(scene: Scene, bounds: ModelBounds): void {
    const length = bounds.maxExtent * 0.3;
    const o = Vector3.Zero();
    const red = new Color4(1, 0.2, 0.2, 1);
    const green = new Color4(0.3, 0.9, 0.3, 1);
    const blue = new Color4(0.3, 0.5, 1, 1);
    const axes = CreateLineSystem("lab-origin-axes", {
      lines: [[o, new Vector3(length, 0, 0)], [o, new Vector3(0, length, 0)], [o, new Vector3(0, 0, length)]],
      colors: [[red, red], [green, green], [blue, blue]],
    }, scene);
    axes.isPickable = false;
  }
}
