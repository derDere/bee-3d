import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { useMaterialImageProcessing } from "../../rendering/materialImageProcessing";
import type { ScreenPoint, ScreenProjector } from "../screenProjector";

const MinDistance = 3;
const MaxDistance = 3000;
const MaxHeight = 1500;
/** Über den Wolken-Compositor gezeichnet, damit die Markierung immer sichtbar bleibt. */
const OverlayGroup = 2;

/** Phase der Wählscheibe (Wählphase). */
type DialPhase = "closed" | "plane" | "height";

/**
 * Q-Wählscheibe (Wählscheibe): Der erste Klick legt Richtung und Entfernung in der waagrechten Ebene der Biene
 * fest, der zweite die Höhe; danach fliegt die Biene genau dorthin. Zeigt Ring, Leitlinie und Lot im Raum
 * sowie Entfernung und Höhe am Mauszeiger.
 */
export class QDial {
  private readonly projector: ScreenProjector;
  private readonly origin: () => Vector3;
  private readonly onPick: (point: Vector3) => void;
  private readonly root: TransformNode;
  private readonly ring: Mesh;
  private readonly guide: Mesh;
  private readonly plumb: Mesh;
  private readonly label: HTMLDivElement;
  private phase: DialPhase = "closed";
  private readonly planePoint = new Vector3();
  private readonly target = new Vector3();
  private readonly ray = new Vector3();
  private readonly scratch = new Vector3();
  private readonly centre = new Vector3();
  private readonly screenCentre: ScreenPoint = { x: 0, y: 0, depth: 0, onScreen: false };

  public constructor(scene: Scene, projector: ScreenProjector, host: HTMLElement, origin: () => Vector3, onPick: (point: Vector3) => void) {
    this.projector = projector;
    this.origin = origin;
    this.onPick = onPick;
    this.root = new TransformNode("qDial", scene);
    const material = new StandardMaterial("qDialMaterial", scene);
    material.disableLighting = true;
    material.emissiveColor = new Color3(1, 0.78, 0.25);
    material.alpha = 0.85;
    material.disableDepthWrite = true;
    useMaterialImageProcessing(material);
    this.ring = CreateTorus("qDialRing", { diameter: 2, thickness: 0.06, tessellation: 64 }, scene);
    this.guide = CreateCylinder("qDialGuide", { height: 1, diameter: 1, tessellation: 8 }, scene);
    this.plumb = CreateCylinder("qDialPlumb", { height: 1, diameter: 1, tessellation: 8 }, scene);
    for (const mesh of [this.ring, this.guide, this.plumb]) {
      mesh.material = material;
      mesh.isPickable = false;
      mesh.renderingGroupId = OverlayGroup;
      mesh.parent = this.root;
    }
    this.root.setEnabled(false);
    this.label = document.createElement("div");
    this.label.style.cssText =
      "position:absolute;left:0;top:0;pointer-events:none;display:none;padding:3px 8px;border-radius:6px;" +
      "font:600 12px system-ui,sans-serif;color:#ffe9b0;background:rgba(20,16,8,.72);border:1px solid rgba(255,200,90,.6);" +
      "white-space:nowrap;transform:translate(14px,-50%);z-index:30";
    host.appendChild(this.label);
  }

  public get isOpen(): boolean {
    return this.phase !== "closed";
  }

  /** Öffnet die Wählscheibe um die eigene Biene. */
  public open(): void {
    this.phase = "plane";
    this.centre.copyFrom(this.origin());
    this.root.setEnabled(true);
    this.label.style.display = "block";
  }

  public close(): void {
    this.phase = "closed";
    this.root.setEnabled(false);
    this.label.style.display = "none";
  }

  /** Mausbewegung: Vorschau der aktuellen Wahl. */
  public pointerMove(x: number, y: number): void {
    if (this.phase === "closed") {
      return;
    }
    this.projector.rayDirection(x, y, this.ray);
    if (this.phase === "plane") {
      this.pickPlane(this.planePoint, this.screenDistance(x, y));
      this.target.copyFrom(this.planePoint);
    } else {
      this.target.copyFrom(this.planePoint);
      this.target.y = this.pickHeight();
    }
    this.updateMarkers();
    const distance = Math.hypot(this.target.x - this.centre.x, this.target.z - this.centre.z);
    const height = this.target.y - this.centre.y;
    this.label.textContent = this.phase === "plane" ? `${formatMeters(distance)} — click: direction and distance` : `Height ${height >= 0 ? "+" : ""}${formatMeters(height)} — click: fly there`;
    this.label.style.left = `${x}px`;
    this.label.style.top = `${y}px`;
  }

  /** Klick: erste Wahl fixieren bzw. Ziel bestätigen. */
  public click(x: number, y: number): void {
    this.pointerMove(x, y);
    if (this.phase === "plane") {
      this.phase = "height";
      return;
    }
    if (this.phase === "height") {
      const point = this.target.clone();
      this.close();
      this.onPick(point);
    }
  }

  public dispose(): void {
    this.root.dispose(false, true);
    this.label.remove();
  }

  /** Schnittpunkt des Blickstrahls mit der waagrechten Ebene durch die Biene; flache Strahlen werden begrenzt. */
  /**
   * Punkt in der waagrechten Ebene der Biene: die Richtung kommt aus dem Blickstrahl (Schnitt mit der Ebene,
   * sonst seine waagrechte Richtung), die Entfernung aus dem Bildabstand zum Mauszeiger.
   */
  private pickPlane(result: Vector3, distance: number): void {
    const camera = this.projector.origin;
    const dy = this.ray.y;
    const t = Math.abs(dy) > 1e-4 ? (this.centre.y - camera.y) / dy : -1;
    if (t > 0) {
      result.copyFrom(this.ray).scaleInPlace(t).addInPlace(camera);
      result.subtractToRef(this.centre, this.scratch);
    } else {
      this.scratch.copyFrom(this.ray);
    }
    const horizontal = Math.hypot(this.scratch.x, this.scratch.z);
    if (horizontal < 1e-4) {
      this.projector.rayDirection(this.projector.width / 2, this.projector.height / 2, this.scratch);
    }
    const length = Math.max(1e-4, Math.hypot(this.scratch.x, this.scratch.z));
    result.set(this.centre.x + (this.scratch.x / length) * distance, this.centre.y, this.centre.z + (this.scratch.z / length) * distance);
  }

  /**
   * Entfernung aus dem Bildabstand des Mauszeigers zur Biene, logarithmisch: nahe der Biene wenige Meter,
   * am Rand eines Kreises von 45 % der Bildhöhe die größte Entfernung.
   */
  private screenDistance(x: number, y: number): number {
    this.projector.project(this.centre, this.screenCentre);
    const radius = this.screenCentre.depth > 0 ? Math.hypot(x - this.screenCentre.x, y - this.screenCentre.y) : this.projector.height * 0.45;
    const share = Math.min(1, Math.max(0, radius / (this.projector.height * 0.45)));
    return MinDistance * Math.pow(MaxDistance / MinDistance, share);
  }

  /** Höhe am Lot durch den Ebenenpunkt: nächster Punkt des Blickstrahls zur senkrechten Linie. */
  private pickHeight(): number {
    const camera = this.projector.origin;
    const dx = this.planePoint.x - camera.x;
    const dz = this.planePoint.z - camera.z;
    const horizontal = Math.hypot(this.ray.x, this.ray.z);
    const along = horizontal > 1e-4 ? (dx * this.ray.x + dz * this.ray.z) / (horizontal * horizontal) : 0;
    const height = camera.y + this.ray.y * Math.max(0, along);
    return Math.max(this.centre.y - MaxHeight, Math.min(this.centre.y + MaxHeight, height));
  }

  private updateMarkers(): void {
    const distance = Math.hypot(this.target.x - this.centre.x, this.target.z - this.centre.z);
    const thickness = Math.max(0.03, distance * 0.004);
    // Ring um die Biene mit dem Radius der gewählten Entfernung
    this.ring.position.copyFrom(this.centre);
    this.ring.scaling.set(distance, Math.max(1, distance * 0.02), distance);
    // Leitlinie in der Ebene
    placeBetween(this.guide, this.centre, this.planePoint, thickness);
    // Lot vom Ebenenpunkt zur gewählten Höhe
    this.plumb.setEnabled(this.phase === "height");
    if (this.phase === "height") {
      placeBetween(this.plumb, this.planePoint, this.target, thickness);
    }
  }
}

/** Richtet einen Einheitszylinder als Linie zwischen zwei Punkten aus. */
function placeBetween(mesh: Mesh, from: Vector3, to: Vector3, thickness: number): void {
  const length = Vector3.Distance(from, to);
  mesh.position.copyFrom(from).addInPlace(to).scaleInPlace(0.5);
  mesh.scaling.set(thickness, Math.max(0.001, length), thickness);
  if (length < 1e-4) {
    return;
  }
  const direction = to.subtract(from).scaleInPlace(1 / length);
  const axis = Vector3.Cross(Vector3.Up(), direction);
  const angle = Math.acos(Math.max(-1, Math.min(1, direction.y)));
  // Zylinder stehen entlang +Y; parallele Fälle drehen um X
  mesh.rotationQuaternion = axis.lengthSquared() < 1e-8 ? Quaternion.RotationAxis(Vector3.Right(), angle) : Quaternion.RotationAxis(axis.normalize(), angle);
}

function formatMeters(value: number): string {
  const absolute = Math.abs(value);
  return absolute >= 1000 ? `${(value / 1000).toFixed(2)} km` : `${Math.round(value)} m`;
}
