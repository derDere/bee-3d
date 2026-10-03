import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Constants } from "@babylonjs/core/Engines/constants";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { Random } from "../../../shared/random";
import { LightningFragmentShader, LightningVertexShader } from "./shaders/lightningShaders";

/** Ein Stück des Blitzkanals (Kanalstück). */
interface BoltSegment {
  readonly a: Vector3;
  readonly b: Vector3;
  readonly halfWidth: number;
  readonly brightness: number;
  readonly level: number;
}

/** Rendering-Gruppe des Kanals: vor den Wolken, mit der Tiefe der Inseln aus Gruppe 0. */
const BoltRenderingGroup = 1;
/** Höchstzahl der Kanalstücke (Hauptkanal und Äste). */
const MaxSegments = 512;
/** Teilungsrunden der Mittelpunktverschiebung (Reed und Wyvill): 2⁶ = 64 Stücke im Hauptkanal. */
const Generations = 6;
/** Seitliche Verschiebung je Teilung relativ zur Stücklänge. */
const Roughness = 0.24;
/** Halbe Breite des Hauptkanals (m); Äste werden je Stufe schmaler und dunkler. */
const MainHalfWidth = 2.4;
const BranchWidthFactor = 0.55;
const BranchBrightnessFactor = 0.5;
/** Wahrscheinlichkeit eines Asts je Stück und Teilung, nach Aststufe. */
const BranchChance: readonly number[] = [0.18, 0.12];
/** Abknickwinkel der Äste (rad). */
const BranchAngleMin = 0.35;
const BranchAngleMax = 0.9;
/** Stützstellen der Sichtbarkeit durch Wolken entlang des Kanals. */
const VisibilityProbes = 12;

/** Zufällige Einheitsrichtung senkrecht zu `direction`. */
function perpendicular(direction: Vector3, random: Random, result: Vector3): Vector3 {
  const helper = Math.abs(direction.y) < 0.9 ? Vector3.UpReadOnly : Vector3.RightReadOnly;
  const u = Vector3.Cross(direction, helper).normalize();
  const v = Vector3.Cross(direction, u).normalize();
  const angle = random.range(0, 2 * Math.PI);
  return result.copyFrom(u.scaleInPlace(Math.cos(angle)).addInPlace(v.scaleInPlace(Math.sin(angle))));
}

/**
 * Sichtbarer, verzweigter Blitzkanal (Blitzkanal): selbstleuchtende Bänder in HDR über der Bloom-Schwelle,
 * erzeugt durch Mittelpunktverschiebung mit Ästen. Ein Netz mit fester Höchstzahl an Stücken, das je Blitz
 * neu befüllt wird; ein Draw Call, nur sichtbar während des Blitzes.
 */
export class LightningBolt {
  private readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly positions = new Float32Array(MaxSegments * 4 * 3);
  private readonly axes = new Float32Array(MaxSegments * 4 * 3);
  private readonly infos = new Float32Array(MaxSegments * 4 * 4);
  private readonly visibility = new Float32Array(VisibilityProbes);
  private readonly color = new Color3();
  private readonly haze = new Vector2(6000, 0.5);
  private readonly start = new Vector3();
  private readonly end = new Vector3();
  private segmentCount = 0;

  public constructor(scene: Scene) {
    this.material = new ShaderMaterial(
      "lightningBoltMaterial",
      scene,
      { vertexSource: LightningVertexShader, fragmentSource: LightningFragmentShader },
      {
        attributes: [VertexBuffer.PositionKind, "boltAxis", "boltInfo"],
        uniforms: ["viewProjection", "cameraPosition", "pixelAngle", "boltColor", "hazeParams"],
        needAlphaBlending: true,
      },
    );
    this.material.alphaMode = Constants.ALPHA_ONEONE;
    this.material.disableDepthWrite = true;
    this.material.backFaceCulling = false;

    this.mesh = new Mesh("lightningBolt", scene);
    this.mesh.setVerticesData(VertexBuffer.PositionKind, this.positions, true, 3);
    this.mesh.setVerticesData("boltAxis", this.axes, true, 3);
    this.mesh.setVerticesData("boltInfo", this.infos, true, 4);
    const indices = new Uint32Array(MaxSegments * 6);
    for (let i = 0; i < MaxSegments; i++) {
      const base = i * 4;
      indices.set([base, base + 1, base + 2, base, base + 2, base + 3], i * 6);
    }
    this.mesh.setIndices(indices);
    this.mesh.material = this.material;
    this.mesh.renderingGroupId = BoltRenderingGroup;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.doNotSyncBoundingInfo = true;
    this.mesh.setEnabled(false);
  }

  /** Zahl der Kanalstücke des aktuellen Blitzes. */
  public get segments(): number {
    return this.segmentCount;
  }

  /**
   * Erzeugt einen neuen verzweigten Kanal von `start` nach `end`.
   * @param visibility Sichtbarkeit eines Punkts von der Kamera aus (Transmission durch Wolken, 0..1).
   */
  public build(start: Vector3, end: Vector3, random: Random, visibility: (point: Vector3) => number): void {
    this.start.copyFrom(start);
    this.end.copyFrom(end);
    const segments = this.subdivide(start, end, random);
    const probe = new Vector3();
    for (let i = 0; i < VisibilityProbes; i++) {
      Vector3.LerpToRef(start, end, i / (VisibilityProbes - 1), probe);
      this.visibility[i] = visibility(probe);
    }
    this.segmentCount = Math.min(MaxSegments, segments.length);
    this.positions.fill(0);
    this.axes.fill(0);
    this.infos.fill(0);
    const axis = new Vector3();
    for (let i = 0; i < this.segmentCount; i++) {
      const segment = segments[i];
      if (segment === undefined) {
        continue;
      }
      segment.b.subtractToRef(segment.a, axis);
      const length = axis.length();
      if (length <= 1e-4) {
        continue;
      }
      axis.scaleInPlace(1 / length);
      const seen = this.visibilityAt(segment.a, segment.b);
      this.writeVertex(i * 4, segment.a, axis, -1, segment, seen);
      this.writeVertex(i * 4 + 1, segment.a, axis, 1, segment, seen);
      this.writeVertex(i * 4 + 2, segment.b, axis, 1, segment, seen);
      this.writeVertex(i * 4 + 3, segment.b, axis, -1, segment, seen);
    }
    this.mesh.updateVerticesData(VertexBuffer.PositionKind, this.positions);
    this.mesh.updateVerticesData("boltAxis", this.axes);
    this.mesh.updateVerticesData("boltInfo", this.infos);
  }

  /** Zeigt den Kanal mit Farbe × Helligkeit (HDR); 0 blendet ihn aus. */
  public show(color: Color3, brightness: number, pixelAngle: number): void {
    const visible = brightness > 0.001 && this.segmentCount > 0;
    this.mesh.setEnabled(visible);
    if (!visible) {
      return;
    }
    color.scaleToRef(brightness, this.color);
    this.material.setColor3("boltColor", this.color);
    this.material.setFloat("pixelAngle", pixelAngle);
    this.material.setVector2("hazeParams", this.haze);
  }

  /** Luftperspektive wie bei den Wolken: Dunstweite (m) und Dunststärke. */
  public setHaze(distance: number, strength: number): void {
    this.haze.set(Math.max(1, distance), strength);
  }

  /** Mittelpunktverschiebung mit Ästen; jede Runde halbiert die Stücke. */
  private subdivide(start: Vector3, end: Vector3, random: Random): BoltSegment[] {
    let segments: BoltSegment[] = [{ a: start.clone(), b: end.clone(), halfWidth: MainHalfWidth, brightness: 1, level: 0 }];
    const direction = new Vector3();
    const offset = new Vector3();
    for (let generation = 0; generation < Generations; generation++) {
      const next: BoltSegment[] = [];
      for (let index = 0; index < segments.length; index++) {
        const segment = segments[index];
        if (segment === undefined) {
          continue;
        }
        // Platz für den Rest dieser Runde freihalten: ungeteilt weiter, sobald das Netz voll wäre
        if (next.length + (segments.length - index) * 2 > MaxSegments) {
          next.push(segment);
          continue;
        }
        segment.b.subtractToRef(segment.a, direction);
        const length = direction.length();
        direction.scaleInPlace(1 / Math.max(length, 1e-4));
        const mid = Vector3.Center(segment.a, segment.b);
        perpendicular(direction, random, offset);
        mid.addInPlace(offset.scaleInPlace(length * Roughness * random.range(-1, 1)));
        next.push({ ...segment, b: mid }, { ...segment, a: mid });
        const chance = BranchChance[segment.level];
        if (chance !== undefined && next.length + 1 + (segments.length - index - 1) * 2 <= MaxSegments && random.chance(chance)) {
          const bend = perpendicular(direction, random, new Vector3()).scaleInPlace(Math.tan(random.range(BranchAngleMin, BranchAngleMax)));
          const branchDirection = direction.add(bend).normalize();
          const branchEnd = mid.add(branchDirection.scaleInPlace(length * random.range(0.5, 0.85)));
          next.push({ a: mid, b: branchEnd, halfWidth: segment.halfWidth * BranchWidthFactor, brightness: segment.brightness * BranchBrightnessFactor, level: segment.level + 1 });
        }
      }
      segments = next;
    }
    return segments;
  }

  /** Sichtbarkeit eines Stücks aus den Stützstellen entlang der Linie Start–Ende. */
  private visibilityAt(a: Vector3, b: Vector3): number {
    const axisX = this.end.x - this.start.x;
    const axisY = this.end.y - this.start.y;
    const axisZ = this.end.z - this.start.z;
    const lengthSquared = Math.max(1e-6, axisX * axisX + axisY * axisY + axisZ * axisZ);
    const midX = (a.x + b.x) * 0.5 - this.start.x;
    const midY = (a.y + b.y) * 0.5 - this.start.y;
    const midZ = (a.z + b.z) * 0.5 - this.start.z;
    const t = Math.min(1, Math.max(0, (midX * axisX + midY * axisY + midZ * axisZ) / lengthSquared));
    const position = t * (VisibilityProbes - 1);
    const lower = Math.floor(position);
    const upper = Math.min(VisibilityProbes - 1, lower + 1);
    const fraction = position - lower;
    return (this.visibility[lower] ?? 1) * (1 - fraction) + (this.visibility[upper] ?? 1) * fraction;
  }

  private writeVertex(vertex: number, point: Vector3, axis: Vector3, side: number, segment: BoltSegment, visibility: number): void {
    this.positions[vertex * 3] = point.x;
    this.positions[vertex * 3 + 1] = point.y;
    this.positions[vertex * 3 + 2] = point.z;
    this.axes[vertex * 3] = axis.x;
    this.axes[vertex * 3 + 1] = axis.y;
    this.axes[vertex * 3 + 2] = axis.z;
    this.infos[vertex * 4] = side;
    this.infos[vertex * 4 + 1] = segment.halfWidth;
    this.infos[vertex * 4 + 2] = segment.brightness;
    this.infos[vertex * 4 + 3] = visibility;
  }

  public dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
  }
}
