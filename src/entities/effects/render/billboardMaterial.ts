// Gemeinsames Material aller Effekt-Billboards: ShaderMaterial mit vormultiplizierter Mischung,
// ohne Tiefenschreiben, je Frame mit Bildgröße, Zeit und Sonnenrichtung versorgt.
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Constants } from "@babylonjs/core/Engines/constants";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { BillboardFragmentShader, BillboardVertexShader } from "./billboardShader";

/** Wie stark aufgeblähte (unter der Mindestgröße liegende) Teile abgedunkelt werden: 0 = gar nicht, 1 = energieerhaltend. */
const InflateExponent = 0.3;
/** Untergrenze des Umgebungslichts für Rauch und Schleim (Nacht, Szenen ohne Himmelslicht). */
const AmbientFloor = 0.16;

/** Material der Effekt-Billboards mit seinen Frame-Uniforms (Billboard-Material). */
export class BillboardMaterial {
  public readonly material: ShaderMaterial;
  private readonly scene: Scene;
  private readonly camera: Camera;
  private readonly viewportSize = new Vector2(1280, 720);
  private readonly lightDirection = new Vector3(0.3, 0.8, 0.5);
  private readonly lightColor = new Color3(1, 1, 1);
  private readonly ambientColor = new Color3(AmbientFloor, AmbientFloor, AmbientFloor);
  private readonly toLight = new Vector3();
  private readonly viewLight = new Vector3();

  public constructor(scene: Scene, camera: Camera) {
    this.scene = scene;
    this.camera = camera;
    this.material = new ShaderMaterial(
      "fxBillboardMaterial",
      scene,
      { vertexSource: BillboardVertexShader, fragmentSource: BillboardFragmentShader, spectorName: "fxBillboard" },
      {
        attributes: ["position"],
        uniforms: ["viewProjection", "projection", "cameraPosition", "viewportSize", "inflateExponent", "time", "lightDirection", "lightColor", "ambientColor"],
        needAlphaBlending: true,
        useClipPlane: false,
      },
    );
    this.material.alphaMode = Constants.ALPHA_PREMULTIPLIED_PORTERDUFF;
    this.material.disableDepthWrite = true;
    this.material.backFaceCulling = false;
    // Vektoren werden als Referenz gebunden: update() ändert nur ihre Werte.
    this.material.setVector2("viewportSize", this.viewportSize);
    this.material.setVector3("lightDirection", this.lightDirection);
    this.material.setColor3("lightColor", this.lightColor);
    this.material.setColor3("ambientColor", this.ambientColor);
    this.material.setFloat("inflateExponent", InflateExponent);
    this.material.setFloat("time", 0);
  }

  /** Aktualisiert Bildgröße, Zeit und Licht für den nächsten Frame. */
  public update(time: number): void {
    const engine = this.scene.getEngine();
    this.viewportSize.set(Math.max(1, engine.getRenderWidth(true)), Math.max(1, engine.getRenderHeight(true)));
    this.material.setFloat("time", time);
    this.updateLight();
  }

  private updateLight(): void {
    const sun = this.findSun();
    if (sun !== undefined) {
      sun.direction.scaleToRef(-1, this.toLight);
      const scale = Math.min(1.5, sun.intensity / Math.PI);
      this.lightColor.set(sun.diffuse.r * scale, sun.diffuse.g * scale, sun.diffuse.b * scale);
    } else {
      this.toLight.set(0.35, 0.85, -0.4);
      this.lightColor.set(1, 1, 1);
    }
    this.toLight.normalize();
    Vector3.TransformNormalToRef(this.toLight, this.camera.getViewMatrix(), this.viewLight);
    // Bildraum des Shaders: x rechts, y oben, z zur Kamera (Babylons Sichtraum zeigt mit z in die Szene)
    this.lightDirection.set(this.viewLight.x, this.viewLight.y, -this.viewLight.z).normalize();
    const ambient = this.scene.ambientColor;
    this.ambientColor.set(
      Math.min(1.2, Math.max(AmbientFloor, ambient.r)),
      Math.min(1.2, Math.max(AmbientFloor, ambient.g)),
      Math.min(1.2, Math.max(AmbientFloor, ambient.b)),
    );
  }

  private findSun(): DirectionalLight | undefined {
    for (const light of this.scene.lights) {
      if (light instanceof DirectionalLight && light.isEnabled()) {
        return light;
      }
    }
    return undefined;
  }

  public dispose(): void {
    this.material.dispose(true, false);
  }
}
