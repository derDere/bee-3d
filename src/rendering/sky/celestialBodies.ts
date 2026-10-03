import { Constants } from "@babylonjs/core/Engines/constants";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import type { Scene } from "@babylonjs/core/scene";
import { SunLatitudeDeg } from "./celestial";
import { BillboardVertexShader, MoonFragmentShader, StarsFragmentShader, StarsVertexShader, SunFragmentShader } from "./shaders/celestialShaders";

const SkyDistance = 900;
/** Scheibendurchmesser (Grad): Sonne und Mond deutlich größer als am echten Himmel, wie in den Zielbildern. */
const SunDiscDegrees = 2.0;
const MoonDiscDegrees = 5.0;
/** Fläche der Sonne relativ zur Scheibe: Platz für Saum und Strahlenkranz. */
const SunCoronaScale = 14;
/** Fläche des Monds relativ zur Scheibe: Platz für den Hof. */
const MoonHaloScale = 4;

/** Zustand der Himmelskörper eines Frames (Himmelskörper-Zustand). */
export interface CelestialFrame {
  readonly toSun: Vector3;
  readonly toMoon: Vector3;
  readonly sunColor: Color3;
  readonly sunIntensity: number;
  /** Größe der Sonne relativ zur Grundgröße (Scheibe, Saum und Strahlenkranz). */
  readonly sunScale: number;
  /** Stärke des Strahlenkranzes um die Sonne (0 = keiner). */
  readonly sunCorona: number;
  readonly moonIntensity: number;
  /** Stärke des Mondhofs (folgt der Mondhelligkeit). */
  readonly moonGlow: number;
  readonly moonPhase: number;
  readonly starIntensity: number;
  readonly starRotation: number;
  readonly time: number;
}

/**
 * Sonnenscheibe, Mond und Sterne in Rendering-Gruppe 0 ohne Tiefenschreiben (Himmelskörper): Ihre Pixel
 * behalten die ferne Tiefe, der Himmels-Compositor der Atmosphäre schwächt sie physikalisch ab und legt
 * die Himmelsstrahlung darüber — Sterne verblassen am Tag, die Sonne rötet sich am Horizont.
 */
export class CelestialBodies {
  public readonly sun: Mesh;
  private readonly moon: Mesh;
  private readonly stars: Mesh;
  private readonly sunMaterial: ShaderMaterial;
  private readonly moonMaterial: ShaderMaterial;
  private readonly starsMaterial: ShaderMaterial;
  private readonly starMatrix = new Matrix();
  private readonly poleRotation: Quaternion;
  private readonly spin = new Quaternion();
  private readonly combined = new Quaternion();
  private readonly scratch = new Vector3();
  private readonly sunParams = new Vector2(1 / SunCoronaScale, 1);

  public constructor(scene: Scene) {
    const sunSize = 2 * SkyDistance * Math.tan(((SunDiscDegrees / 2) * Math.PI) / 180) * SunCoronaScale;
    this.sun = CreatePlane("sunDisc", { size: sunSize }, scene);
    this.sunMaterial = this.createBillboardMaterial("sunMaterial", SunFragmentShader, ["sunColor", "sunParams"], scene);
    this.configure(this.sun, this.sunMaterial);

    const moonSize = 2 * SkyDistance * Math.tan(((MoonDiscDegrees / 2) * Math.PI) / 180) * MoonHaloScale;
    this.moon = CreatePlane("moonDisc", { size: moonSize }, scene);
    this.moonMaterial = this.createBillboardMaterial("moonMaterial", MoonFragmentShader, ["moonColor", "phase", "sunSide", "haloParams"], scene);
    this.configure(this.moon, this.moonMaterial);

    this.stars = CreateSphere("stars", { diameter: SkyDistance * 2.1, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
    this.starsMaterial = new ShaderMaterial(
      "starsMaterial",
      scene,
      { vertexSource: StarsVertexShader, fragmentSource: StarsFragmentShader },
      { attributes: ["position"], uniforms: ["worldViewProjection", "starRotation", "starIntensity", "time"] },
    );
    this.configure(this.stars, this.starsMaterial);
    this.stars.billboardMode = Mesh.BILLBOARDMODE_NONE;
    // Himmelspol um die Breite gekippt: Die Sterne drehen sich einmal je Spieltag um ihn.
    this.poleRotation = Quaternion.RotationAxis(Vector3.Right(), ((90 - SunLatitudeDeg) * Math.PI) / 180);
  }

  private createBillboardMaterial(name: string, fragment: string, uniforms: string[], scene: Scene): ShaderMaterial {
    return new ShaderMaterial(
      name,
      scene,
      { vertexSource: BillboardVertexShader, fragmentSource: fragment },
      { attributes: ["position", "uv"], uniforms: ["worldViewProjection", ...uniforms] },
    );
  }

  private configure(mesh: Mesh, material: ShaderMaterial): void {
    material.disableDepthWrite = true;
    material.alphaMode = Constants.ALPHA_ADD;
    material.needAlphaBlending = () => true;
    material.backFaceCulling = false;
    mesh.material = material;
    mesh.infiniteDistance = true;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.renderingGroupId = 0;
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    mesh.applyFog = false;
  }

  public update(frame: CelestialFrame): void {
    frame.toSun.scaleToRef(SkyDistance, this.sun.position);
    this.sun.scaling.setAll(frame.sunScale);
    this.sun.setEnabled(frame.toSun.y > -0.12);
    this.sunMaterial.setColor3("sunColor", frame.sunColor.scale(frame.sunIntensity));
    this.sunParams.y = frame.sunCorona;
    this.sunMaterial.setVector2("sunParams", this.sunParams);

    frame.toMoon.scaleToRef(SkyDistance, this.moon.position);
    this.moon.setEnabled(frame.toMoon.y > -0.1 && frame.moonIntensity > 0.001);
    this.moonMaterial.setColor3("moonColor", new Color3(0.9, 0.93, 1.0).scaleInPlace(frame.moonIntensity));
    this.moonMaterial.setFloat("phase", frame.moonPhase);
    this.moonMaterial.setVector2("haloParams", new Vector2(MoonHaloScale, frame.moonGlow));
    // Seite der Sonne aus Sicht des Monds (links oder rechts im Bild)
    Vector3.CrossToRef(frame.toMoon, frame.toSun, this.scratch);
    this.moonMaterial.setFloat("sunSide", this.scratch.y >= 0 ? 1 : -1);

    Quaternion.RotationAxisToRef(Vector3.Up(), frame.starRotation, this.spin);
    this.poleRotation.multiplyToRef(this.spin, this.combined);
    Matrix.FromQuaternionToRef(this.combined, this.starMatrix);
    this.starsMaterial.setMatrix("starRotation", this.starMatrix);
    this.starsMaterial.setFloat("starIntensity", frame.starIntensity);
    this.starsMaterial.setFloat("time", frame.time);
    this.stars.setEnabled(frame.starIntensity > 0.001);
  }

  public setStarsEnabled(enabled: boolean): void {
    this.stars.isVisible = enabled;
  }

  public dispose(): void {
    this.sun.dispose();
    this.moon.dispose();
    this.stars.dispose();
    this.sunMaterial.dispose();
    this.moonMaterial.dispose();
    this.starsMaterial.dispose();
  }
}
