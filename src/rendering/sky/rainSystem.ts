import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Constants } from "@babylonjs/core/Engines/constants";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3, Vector4 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { Random } from "../../../shared/random";
import { RainFragmentShader, RainVertexShader } from "./shaders/rainShaders";
import { saturate } from "./skyMath";

/** Werte des Regens für einen Frame (Regenzustand). */
export interface RainFrame {
  /** Regenstärke 0..1: Anteil sichtbarer Tropfen. */
  readonly intensity: number;
  /** Wind in Metern je Sekunde (Weltachsen). */
  readonly wind: Vector3;
  /** Himmelslicht auf den Tropfen (linear, HDR). */
  readonly ambient: Color3;
  /** Licht von Sonne oder Mond für das Gegenlicht (linear, HDR). */
  readonly lightColor: Color3;
  readonly toLight: Vector3;
  /** Blitzlicht: Farbe × Stärke des laufenden Blitzes. */
  readonly flash: Color3;
}

/** Rendering-Gruppe des Regens: vor den Wolken, mit der Tiefe der Inseln aus Gruppe 0. */
const RainRenderingGroup = 1;
/** Fallgeschwindigkeiten der vier Tropfenklassen (m/s). */
const FallSpeeds: readonly number[] = [6.8, 7.6, 8.4, 9.2];
/** Eine Regenschicht: Größe der Box um die Kamera und Aussehen der Schlieren (Regenschicht). */
export interface RainLayer {
  readonly name: string;
  /** Kantenlänge waagerecht und Höhe der Box (m). */
  readonly boxSize: number;
  readonly boxHeight: number;
  /** Ausblendung naher und ferner Tropfen (m). */
  readonly nearFadeMeters: number;
  readonly farFadeMeters: number;
  /** Belichtungszeit der Schlieren (s) und längste Schliere bei schnellem Flug (m). */
  readonly shutterSeconds: number;
  readonly maxStreakMeters: number;
  /** Sichtbare Tropfenbreite (m). */
  readonly dropWidthMeters: number;
  /** Grundhelligkeit der Schlieren. */
  readonly brightness: number;
  /** Anteil der Tropfenzahl der Qualitätsstufe. */
  readonly dropShare: number;
  /** Zufallsstartwert der Tropfenlagen. */
  readonly seed: number;
}

/** Nahe Schicht: kurze helle Striche im Bienenmaßstab, deutlich lesbar neben der 20-cm-Biene. */
export const NearRainLayer: RainLayer = {
  name: "rainNear",
  boxSize: 18,
  boxHeight: 16,
  nearFadeMeters: 0.6,
  farFadeMeters: 8.5,
  shutterSeconds: 1 / 45,
  maxStreakMeters: 2.5,
  dropWidthMeters: 0.009,
  brightness: 1,
  dropShare: 1,
  seed: 0x7a19,
};

/** Ferne Schicht: lange, schwache Schlieren bis 60 m als Regenschleier in der Tiefe. */
export const FarRainLayer: RainLayer = {
  name: "rainFar",
  boxSize: 120,
  boxHeight: 70,
  nearFadeMeters: 8,
  farFadeMeters: 60,
  shutterSeconds: 1 / 12,
  maxStreakMeters: 6,
  dropWidthMeters: 0.04,
  brightness: 0.45,
  dropShare: 0.35,
  seed: 0x3c51,
};

/** Anteil der Windgeschwindigkeit, den die Tropfen mitnehmen (Neigung im Wind). */
const WindDrag = 0.8;
/** Gewichte von Himmelslicht, Streulicht der Wolken (Anteil des Hauptlichts), Gegenlicht und Blitz. */
const AmbientWeight = 1;
const ScatteredLightWeight = 0.07;
const GlintWeight = 0.12;
const FlashWeight = 0.6;
/** Zeitkonstante der geglätteten Kamerageschwindigkeit (s). */
const CameraVelocitySeconds = 0.12;
/** Sprünge der Kamera (Kamerapunkt, Warp-Ende) zählen nicht als Bewegung (m je Frame). */
const TeleportMeters = 60;
/** Unterhalb dieser Stärke wird nichts gezeichnet. */
const MinIntensity = 0.004;

/** Ecken eines Tropfenbands: Seite (−1/1) und Ende (0 Kopf, 1 Schweif). */
const Corners: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [1, 1],
  [-1, 1],
];

function wrap(value: number, period: number): number {
  const m = value % period;
  return m < 0 ? m + period : m;
}

/**
 * Regen um die Kamera (Regensystem): Schlieren einer Schicht in einer mitwandernden Box, ein Draw Call, keine
 * CPU-Arbeit je Tropfen. Dichte nach Wetter, Neigung nach Wind, Schlierenlänge nach Fall- und Fluggeschwindigkeit;
 * hell im Gegenlicht und im Blitz.
 */
export class RainSystem {
  private readonly scene: Scene;
  private readonly camera: Camera;
  private readonly layer: RainLayer;
  private readonly material: ShaderMaterial;
  private mesh: Mesh | undefined;
  private dropCount = 0;
  private enabled = true;
  private shownIntensity = 0;
  private readonly offsets: number[] = new Array<number>(16).fill(0);
  private readonly streaks: number[] = new Array<number>(16).fill(0);
  private readonly cameraVelocity = new Vector3();
  private readonly lastCameraPosition = new Vector3();
  private hasLastCameraPosition = false;
  private readonly boxParams: Vector4;
  private readonly rainParams = new Vector4();
  private readonly ambient = new Color3();
  private readonly glint = new Color3();
  private readonly flash = new Color3();

  public constructor(scene: Scene, camera: Camera, dropCount: number, layer: RainLayer = NearRainLayer) {
    this.scene = scene;
    this.camera = camera;
    this.layer = layer;
    this.boxParams = new Vector4(layer.boxSize, layer.boxHeight, layer.nearFadeMeters, layer.farFadeMeters);
    this.material = new ShaderMaterial(
      `${layer.name}Material`,
      scene,
      { vertexSource: RainVertexShader, fragmentSource: RainFragmentShader },
      {
        attributes: [VertexBuffer.PositionKind, "dropData"],
        uniforms: ["viewProjection", "cameraPosition", "boxParams", "classOffset", "classStreak", "rainParams", "toLight", "ambientColor", "glintColor", "flashColor"],
        needAlphaBlending: true,
      },
    );
    this.material.alphaMode = Constants.ALPHA_ONEONE;
    this.material.disableDepthWrite = true;
    this.material.backFaceCulling = false;
    this.setDropCount(dropCount);
  }

  /** Aktuell gezeichnete Regenstärke 0..1. */
  public get intensity(): number {
    return this.shownIntensity;
  }

  /** Effektschalter der Debug-API. */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Tropfenzahl der Qualitätsstufe; baut das Tropfennetz bei Änderung neu. */
  public setDropCount(count: number): void {
    const dropCount = Math.max(0, Math.round(count * this.layer.dropShare));
    if (dropCount === this.dropCount && this.mesh !== undefined) {
      return;
    }
    this.dropCount = dropCount;
    this.mesh?.dispose();
    this.mesh = dropCount > 0 ? this.buildMesh(dropCount) : undefined;
  }

  /** Rückt den Regen um `dt` Sekunden vor (0 = Pause) und setzt Licht und Dichte. */
  public update(dt: number, frame: RainFrame): void {
    this.updateCameraVelocity(dt);
    const intensity = this.enabled ? saturate(frame.intensity) : 0;
    this.shownIntensity = this.mesh !== undefined && intensity > MinIntensity ? intensity : 0;
    const mesh = this.mesh;
    if (mesh === undefined) {
      return;
    }
    mesh.setEnabled(this.shownIntensity > 0);
    if (this.shownIntensity <= 0) {
      return;
    }
    this.advanceClasses(dt, frame.wind);
    const pixelAngle = (2 * Math.tan(this.camera.fov / 2)) / Math.max(1, this.scene.getEngine().getRenderHeight());
    this.rainParams.set(this.shownIntensity, this.layer.dropWidthMeters, this.layer.brightness, pixelAngle);
    frame.ambient.scaleToRef(AmbientWeight, this.ambient);
    frame.lightColor.scaleAndAddToRef(ScatteredLightWeight, this.ambient);
    frame.lightColor.scaleToRef(GlintWeight, this.glint);
    frame.flash.scaleToRef(FlashWeight, this.flash);
    const material = this.material;
    material.setArray4("classOffset", this.offsets);
    material.setArray4("classStreak", this.streaks);
    material.setVector4("boxParams", this.boxParams);
    material.setVector4("rainParams", this.rainParams);
    material.setVector3("toLight", frame.toLight);
    material.setColor3("ambientColor", this.ambient);
    material.setColor3("glintColor", this.glint);
    material.setColor3("flashColor", this.flash);
  }

  /** Strecke und Schlierenvektor je Fallklasse: Fall plus Wind, relativ zur bewegten Kamera. */
  private advanceClasses(dt: number, wind: Vector3): void {
    const camera = this.cameraVelocity;
    for (let c = 0; c < FallSpeeds.length; c++) {
      const vx = wind.x * WindDrag;
      const vy = -(FallSpeeds[c] ?? 8);
      const vz = wind.z * WindDrag;
      const o = c * 4;
      this.offsets[o] = wrap((this.offsets[o] ?? 0) + vx * dt, this.layer.boxSize);
      this.offsets[o + 1] = wrap((this.offsets[o + 1] ?? 0) + vy * dt, this.layer.boxHeight);
      this.offsets[o + 2] = wrap((this.offsets[o + 2] ?? 0) + vz * dt, this.layer.boxSize);
      let sx = (vx - camera.x) * this.layer.shutterSeconds;
      let sy = (vy - camera.y) * this.layer.shutterSeconds;
      let sz = (vz - camera.z) * this.layer.shutterSeconds;
      const length = Math.sqrt(sx * sx + sy * sy + sz * sz);
      if (length > this.layer.maxStreakMeters) {
        const scale = this.layer.maxStreakMeters / length;
        sx *= scale;
        sy *= scale;
        sz *= scale;
      }
      this.streaks[o] = sx;
      this.streaks[o + 1] = sy;
      this.streaks[o + 2] = sz;
      this.streaks[o + 3] = Math.min(length, this.layer.maxStreakMeters);
    }
  }

  private updateCameraVelocity(dt: number): void {
    const position = this.camera.globalPosition;
    if (!this.hasLastCameraPosition) {
      this.lastCameraPosition.copyFrom(position);
      this.hasLastCameraPosition = true;
      return;
    }
    if (dt <= 0) {
      return;
    }
    const dx = position.x - this.lastCameraPosition.x;
    const dy = position.y - this.lastCameraPosition.y;
    const dz = position.z - this.lastCameraPosition.z;
    if (dx * dx + dy * dy + dz * dz > TeleportMeters * TeleportMeters) {
      this.cameraVelocity.setAll(0);
    } else {
      const blend = 1 - Math.exp(-dt / CameraVelocitySeconds);
      this.cameraVelocity.x += (dx / dt - this.cameraVelocity.x) * blend;
      this.cameraVelocity.y += (dy / dt - this.cameraVelocity.y) * blend;
      this.cameraVelocity.z += (dz / dt - this.cameraVelocity.z) * blend;
    }
    this.lastCameraPosition.copyFrom(position);
  }

  private buildMesh(count: number): Mesh {
    const random = new Random(this.layer.seed);
    const positions = new Float32Array(count * 4 * 3);
    const data = new Float32Array(count * 4 * 4);
    const indices = new Uint32Array(count * 6);
    for (let i = 0; i < count; i++) {
      const x = random.next();
      const y = random.next();
      const z = random.next();
      const select = random.next();
      const size = random.next();
      for (let corner = 0; corner < 4; corner++) {
        const vertex = i * 4 + corner;
        const [side, end] = Corners[corner] ?? [0, 0];
        positions[vertex * 3] = x;
        positions[vertex * 3 + 1] = y;
        positions[vertex * 3 + 2] = z;
        data[vertex * 4] = side;
        data[vertex * 4 + 1] = end;
        data[vertex * 4 + 2] = select;
        data[vertex * 4 + 3] = size;
      }
      const base = i * 4;
      indices.set([base, base + 1, base + 2, base, base + 2, base + 3], i * 6);
    }
    const mesh = new Mesh(this.layer.name, this.scene);
    mesh.setVerticesData(VertexBuffer.PositionKind, positions, false, 3);
    mesh.setVerticesData("dropData", data, false, 4);
    mesh.setIndices(indices);
    mesh.material = this.material;
    mesh.renderingGroupId = RainRenderingGroup;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;
    mesh.setEnabled(false);
    return mesh;
  }

  public dispose(): void {
    this.mesh?.dispose();
    this.mesh = undefined;
    this.material.dispose();
  }
}
