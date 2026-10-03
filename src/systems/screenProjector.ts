import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Viewport } from "@babylonjs/core/Maths/math.viewport";
import type { Scene } from "@babylonjs/core/scene";

/** Bildschirmlage eines Weltpunkts in CSS-Pixeln (Bildschirmpunkt). */
export interface ScreenPoint {
  x: number;
  y: number;
  /** Abstand zur Kamera entlang der Blickrichtung in Metern; ≤ 0 = hinter der Kamera. */
  depth: number;
  /** Liegt vor der Kamera und im sichtbaren Bereich. */
  onScreen: boolean;
}

/**
 * Projiziert Weltpunkte auf den Bildschirm und erzeugt Blickstrahlen aus Bildschirmpunkten (Bildschirmprojektion).
 * Einmal je Frame `update` aufrufen; alle Angaben in CSS-Pixeln relativ zur Zeichenfläche.
 */
export class ScreenProjector {
  private readonly scene: Scene;
  private readonly camera: Camera;
  private readonly canvas: HTMLCanvasElement;
  private readonly viewport = new Viewport(0, 0, 1, 1);
  private readonly projected = new Vector3();
  private readonly forward = new Vector3();
  private readonly offset = new Vector3();
  private transform = Matrix.Identity();

  public constructor(scene: Scene, camera: Camera, canvas: HTMLCanvasElement) {
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
  }

  public get width(): number {
    return this.canvas.clientWidth;
  }

  public get height(): number {
    return this.canvas.clientHeight;
  }

  /** Übernimmt Kamera und Zeichenflächengröße des aktuellen Frames. */
  public update(): void {
    this.viewport.width = this.canvas.clientWidth;
    this.viewport.height = this.canvas.clientHeight;
    this.transform = this.scene.getTransformMatrix();
    this.camera.getDirectionToRef(Vector3.Forward(), this.forward);
  }

  /** Bildschirmlage eines Weltpunkts. */
  public project(world: Vector3, result: ScreenPoint): ScreenPoint {
    world.subtractToRef(this.camera.globalPosition, this.offset);
    result.depth = Vector3.Dot(this.offset, this.forward);
    Vector3.ProjectToRef(world, Matrix.IdentityReadOnly, this.transform, this.viewport, this.projected);
    result.x = this.projected.x;
    result.y = this.projected.y;
    result.onScreen = result.depth > 0 && result.x >= 0 && result.y >= 0 && result.x <= this.viewport.width && result.y <= this.viewport.height;
    return result;
  }

  /** Größe eines Objekts mit Radius `radius` in Pixeln bei Tiefe `depth`. */
  public pixelSize(radius: number, depth: number): number {
    const fov = this.camera.fov;
    return depth <= 0 ? 0 : (radius / (depth * Math.tan(fov / 2))) * (this.viewport.height / 2) * 2;
  }

  /** Blickrichtung (Einheitsvektor) durch einen Bildschirmpunkt. */
  public rayDirection(x: number, y: number, result: Vector3): Vector3 {
    const ray = this.scene.createPickingRay(x, y, null, this.camera);
    return result.copyFrom(ray.direction).normalize();
  }

  /** Lage der Kamera. */
  public get origin(): Vector3 {
    return this.camera.globalPosition;
  }
}
