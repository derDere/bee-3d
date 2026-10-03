import type { InstantiatedEntries } from "@babylonjs/core/assetContainer";
import type { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { Flies, flyInfo } from "../../shared/rules";
import type { FrameSystem } from "../core/gameLoop";
import type { ModelLibrary } from "../core/modelLibrary";
import type { Replica } from "../net/replica";

/** Leuchtfarbe der Fliegenaugen in der Dunkelheit (rot glühend). */
const EyeGlowColor = new Color3(1, 0.02, 0);
const EyeGlowNight = 1.6;
const EyeGlowDay = 0.25;

interface FlyView {
  readonly kind: number;
  readonly root: TransformNode;
  readonly entries: InstantiatedEntries;
  readonly meshes: AbstractMesh[];
  readonly position: Vector3;
  previousYaw: number;
  bank: number;
}

/**
 * Stellt Schmeißfliegen, Brummer und Königinnen aus dem Server-Spiegel dar (Fliegen): Modellkopien je Art
 * aus Pools, Flügelschlag und Leerlauf als Schleifen, rot glühende Augen im Dunkeln.
 */
export class FlyViews implements FrameSystem {
  private readonly scene: Scene;
  private readonly library: ModelLibrary;
  private readonly replica: Replica;
  private readonly shadows: CascadedShadowGenerator;
  private readonly views = new Map<number, FlyView>();
  private readonly pools = new Map<number, FlyView[]>();
  private readonly scales = new Map<number, number>();
  private readonly eyeMaterials = new Set<PBRMaterial>();
  private readonly seen = new Set<number>();
  private readonly rotation = new Quaternion();
  private glow = -1;
  private created = 0;

  public constructor(scene: Scene, library: ModelLibrary, replica: Replica, shadows: CascadedShadowGenerator) {
    this.scene = scene;
    this.library = library;
    this.replica = replica;
    this.shadows = shadows;
  }

  /** Lädt alle Fliegenmodelle vor (damit Pools im Frame-Takt sofort Kopien erzeugen können). */
  public async preloadAsync(): Promise<void> {
    await Promise.all(Flies.map((info) => this.library.load(info.model)));
  }

  /** Nachtleuchten der Augen 0..1 (Dämmerung blendet). */
  public setNightGlow(amount: number): void {
    if (Math.abs(amount - this.glow) < 0.01) {
      return;
    }
    this.glow = amount;
    this.applyGlow();
  }

  /** Lage einer dargestellten Fliege (für Effekte und Klammern). */
  public positionOf(flyId: number): Vector3 | undefined {
    return this.views.get(flyId)?.position;
  }

  public frameUpdate(dt: number): void {
    this.seen.clear();
    this.replica.flies.forEach((flyId, pose, row) => {
      const view = this.views.get(flyId) ?? this.acquire(flyId, row.kind);
      if (view === undefined) {
        return;
      }
      this.seen.add(flyId);
      const yawRate = Math.atan2(Math.sin(pose.yaw - view.previousYaw), Math.cos(pose.yaw - view.previousYaw)) / Math.max(dt, 1e-3);
      view.previousYaw = pose.yaw;
      view.bank += (Math.max(-0.6, Math.min(0.6, -yawRate * 0.3)) - view.bank) * Math.min(1, dt * 4);
      view.position.set(pose.x, pose.y, pose.z);
      view.root.position.copyFrom(view.position);
      Quaternion.FromEulerAnglesToRef(-pose.pitch, pose.yaw, view.bank, this.rotation);
      view.root.rotationQuaternion?.copyFrom(this.rotation);
    });
    for (const [flyId, view] of this.views) {
      if (!this.seen.has(flyId)) {
        this.release(flyId, view);
      }
    }
  }

  public dispose(): void {
    for (const [flyId, view] of this.views) {
      this.release(flyId, view);
    }
    for (const pool of this.pools.values()) {
      for (const view of pool) {
        view.entries.dispose();
        view.root.dispose();
      }
    }
    this.pools.clear();
  }

  private acquire(flyId: number, kind: number): FlyView | undefined {
    const view = this.pools.get(kind)?.pop() ?? this.create(kind);
    if (view === undefined) {
      return undefined;
    }
    view.root.setEnabled(true);
    for (const group of view.entries.animationGroups) {
      group.start(true, 0.9 + Math.random() * 0.2);
    }
    for (const mesh of view.meshes) {
      this.shadows.addShadowCaster(mesh, false);
    }
    this.views.set(flyId, view);
    return view;
  }

  private release(flyId: number, view: FlyView): void {
    this.views.delete(flyId);
    view.root.setEnabled(false);
    for (const group of view.entries.animationGroups) {
      group.stop();
    }
    for (const mesh of view.meshes) {
      this.shadows.removeShadowCaster(mesh, false);
    }
    let pool = this.pools.get(view.kind);
    if (pool === undefined) {
      pool = [];
      this.pools.set(view.kind, pool);
    }
    pool.push(view);
  }

  private create(kind: number): FlyView | undefined {
    const info = flyInfo(kind);
    const name = `fly${this.created++}`;
    const entries = this.library.instantiateLoaded(info.model, name);
    const gltfRoot = entries?.rootNodes[0] as TransformNode | undefined;
    if (entries === undefined || gltfRoot === undefined) {
      return undefined;
    }
    const root = new TransformNode(name, this.scene);
    root.rotationQuaternion = Quaternion.Identity();
    gltfRoot.parent = root;
    gltfRoot.scaling.scaleInPlace(this.scaleFor(kind, gltfRoot, info.length));
    const meshes = gltfRoot.getChildMeshes(false);
    for (const mesh of meshes) {
      mesh.isPickable = false;
      const material = mesh.material;
      if (material !== null && material.name.endsWith("_Eye") && !this.eyeMaterials.has(material as PBRMaterial)) {
        this.eyeMaterials.add(material as PBRMaterial);
        this.applyGlow();
      }
    }
    return { kind, root, entries, meshes, position: new Vector3(), previousYaw: 0, bank: 0 };
  }

  /** Maßstab aus der Modelllänge entlang Z gegen die Spiellänge der Art (einmal je Art gemessen). */
  private scaleFor(kind: number, gltfRoot: TransformNode, length: number): number {
    const known = this.scales.get(kind);
    if (known !== undefined) {
      return known;
    }
    const { min, max } = gltfRoot.getHierarchyBoundingVectors(true);
    const modelLength = Math.max(0.01, max.z - min.z);
    const scale = length / modelLength;
    this.scales.set(kind, scale);
    return scale;
  }

  private applyGlow(): void {
    const intensity = EyeGlowDay + Math.max(0, this.glow) * (EyeGlowNight - EyeGlowDay);
    for (const material of this.eyeMaterials) {
      material.emissiveColor.copyFrom(EyeGlowColor).scaleInPlace(intensity);
      material.emissiveIntensity = 1;
    }
  }
}
