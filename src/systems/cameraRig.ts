import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import type { FrameSystem } from "../core/gameLoop";

/** Betriebsart der Kamera (Kameramodus). */
export type CameraMode = "orbit" | "free";

/** Ziel der Orbit-Kamera: Position und Tempo dessen, was die Kamera zeigt (Kameraziel). */
export interface CameraSubject {
  readonly position: Vector3;
  readonly speed: number;
}

/** Verhindert, dass die Kamera in Inseln steckt: liefert den erlaubten Abstand entlang eines Strahls. */
export type CameraObstruction = (from: Vector3, to: Vector3) => number;

const MinDistance = 0.45;
const MaxDistance = 420;
const BaseFovDeg = 62;

/**
 * Orbit-Kamera nach EVE-Vorbild (Kamera): kreist um ihr Ziel – die eigene Biene, im Hangar die Biene in der
 * Wabenhalle oder ein angesehenes Objekt. Ziehen mit der linken Maustaste dreht, das Mausrad zoomt; die
 * Blickrichtung ändert die Flugrichtung nicht. Zusätzlich freie Kamerapunkte für die Debug-API.
 */
export class CameraRig implements FrameSystem {
  public readonly camera: TargetCamera;
  public mode: CameraMode = "free";
  /** Gier und Neigung der Orbit-Kamera um das Ziel (rad). */
  public yaw = Math.PI * 0.85;
  public pitch = 0.18;
  public distance = 1.6;
  private targetYaw = this.yaw;
  private targetPitch = this.pitch;
  private targetDistance = this.distance;
  private subject: CameraSubject | undefined;
  private obstruction: CameraObstruction | undefined;
  private readonly smoothedTarget = new Vector3();
  private readonly desired = new Vector3();
  private readonly freeTarget = new Vector3();
  private readonly offset = new Vector3();
  private fovKick = 0;
  private shake = 0;

  public constructor(scene: Scene) {
    this.camera = new TargetCamera("camera", new Vector3(0, 140, -30), scene);
    this.camera.fov = (BaseFovDeg * Math.PI) / 180;
    this.camera.minZ = 0.05;
    this.camera.maxZ = 0;
    scene.activeCamera = this.camera;
  }

  public follow(subject: CameraSubject, obstruction?: CameraObstruction): void {
    this.subject = subject;
    this.obstruction = obstruction;
    this.smoothedTarget.copyFrom(subject.position);
    this.mode = "orbit";
  }

  /** Dreht die Orbit-Kamera um Pixel-Deltas der Maus. */
  public rotate(deltaX: number, deltaY: number, sensitivity = 1): void {
    this.targetYaw += deltaX * 0.0055 * sensitivity;
    this.targetPitch = Math.max(-1.45, Math.min(1.45, this.targetPitch + deltaY * 0.0045 * sensitivity));
  }

  /** Setzt Abstand und optional Neigung und Gier der Orbit-Kamera sofort (Kamerapunkte). */
  public setOrbit(distance: number, pitch?: number, yaw?: number): void {
    this.distance = this.targetDistance = Math.max(MinDistance, Math.min(MaxDistance, distance));
    if (pitch !== undefined) {
      this.pitch = this.targetPitch = pitch;
    }
    if (yaw !== undefined) {
      this.yaw = this.targetYaw = yaw;
    }
  }

  /** Zoomt logarithmisch (Mausrad-Raster). */
  public zoom(steps: number): void {
    this.targetDistance = Math.max(MinDistance, Math.min(MaxDistance, this.targetDistance * Math.pow(1.15, steps)));
  }

  /** Setzt die Kamera frei an einen Punkt mit Blickziel (Kamerapunkt). */
  public setFree(position: Vector3, target: Vector3): void {
    this.mode = "free";
    this.camera.position.copyFrom(position);
    this.freeTarget.copyFrom(target);
    this.camera.setTarget(this.freeTarget);
  }

  /** Kehrt zur Orbit-Kamera zurück. */
  public resumeOrbit(): void {
    if (this.subject !== undefined) {
      this.mode = "orbit";
      this.smoothedTarget.copyFrom(this.subject.position);
    }
  }

  /** Kurzes Wackeln (Turbulenz, Treffer), 0..1. */
  public addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  /** Sichtfeld-Kick (Tempo, Warp), 0..1. */
  public setFovKick(amount: number): void {
    this.fovKick = amount;
  }

  /** Blickrichtung der Kamera als Einheitsvektor. */
  public forward(result: Vector3): Vector3 {
    this.camera.getDirectionToRef(Vector3.Forward(), result);
    return result;
  }

  public frameUpdate(dt: number): void {
    const fovTarget = ((BaseFovDeg + this.fovKick * 14) * Math.PI) / 180;
    this.camera.fov += (fovTarget - this.camera.fov) * (1 - Math.exp(-5 * Math.max(dt, 0.001)));
    if (this.mode !== "orbit" || this.subject === undefined) {
      return;
    }
    const k = 1 - Math.exp(-14 * Math.max(dt, 0.001));
    this.yaw += (this.targetYaw - this.yaw) * k;
    this.pitch += (this.targetPitch - this.pitch) * k;
    this.distance += (this.targetDistance - this.distance) * (1 - Math.exp(-9 * Math.max(dt, 0.001)));
    // Ohne Nachlauf: die Figur ist bereits zwischen den Logikschritten interpoliert; Nachlauf ließe sie im Warp aus dem Bild fallen
    this.smoothedTarget.copyFrom(this.subject.position);
    const cosPitch = Math.cos(this.pitch);
    this.offset.set(Math.sin(this.yaw) * cosPitch, Math.sin(this.pitch), Math.cos(this.yaw) * cosPitch);
    this.desired.copyFrom(this.offset).scaleInPlace(this.distance).addInPlace(this.smoothedTarget);
    if (this.obstruction !== undefined) {
      const allowed = this.obstruction(this.smoothedTarget, this.desired);
      if (allowed < this.distance) {
        this.desired.copyFrom(this.offset).scaleInPlace(Math.max(MinDistance * 0.8, allowed)).addInPlace(this.smoothedTarget);
      }
    }
    if (this.shake > 0.001) {
      const amplitude = this.shake * 0.04 * Math.min(4, this.distance);
      this.desired.x += (Math.random() - 0.5) * amplitude;
      this.desired.y += (Math.random() - 0.5) * amplitude;
      this.desired.z += (Math.random() - 0.5) * amplitude;
      this.shake *= Math.exp(-6 * Math.max(dt, 0.001));
    }
    this.camera.position.copyFrom(this.desired);
    this.camera.setTarget(this.smoothedTarget);
  }
}
