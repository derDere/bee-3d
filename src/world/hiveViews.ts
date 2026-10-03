import type { InstantiatedEntries } from "@babylonjs/core/assetContainer";
import type { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { HivePlacement } from "../../shared/worldgen";
import type { FrameSystem } from "../core/gameLoop";
import type { ModelLibrary } from "../core/modelLibrary";

const DetailFile = "hive.glb";
const FarFile = "hive-lod1.glb";
/** Bis zu diesem Abstand erscheint der Stock in voller Auflösung mit Wabenhalle. */
const DetailDistance = 420;

/** Weltlage der Ankerpunkte eines Stocks (Stockanker). */
export interface HiveAnchors {
  readonly dock: Vector3;
  readonly entrance: Vector3;
  readonly hangar: Vector3;
  readonly hangarCamera: Vector3;
  readonly beacon: Vector3;
}

interface HiveView {
  readonly placement: HivePlacement;
  readonly root: TransformNode;
  readonly detail: InstantiatedEntries;
  readonly far: InstantiatedEntries | undefined;
  readonly detailMeshes: AbstractMesh[];
  readonly anchors: HiveAnchors;
  detailed: boolean | undefined;
}

/**
 * Schwebende Bienenstöcke als Stationen (Bienenstöcke): Strohkorb mit Wabenhalle in der Nähe, vereinfachter
 * Korb in der Ferne. Liefert die Ankerpunkte für Andocken, Hangar-Kamera und Leuchtfeuer.
 */
export class HiveViews implements FrameSystem {
  private readonly scene: Scene;
  private readonly library: ModelLibrary;
  private readonly placements: readonly HivePlacement[];
  private readonly shadows: CascadedShadowGenerator;
  private readonly views: HiveView[] = [];
  private readonly cameraPosition: () => Vector3;
  private dockedHive: number | undefined;

  public constructor(scene: Scene, library: ModelLibrary, placements: readonly HivePlacement[], shadows: CascadedShadowGenerator, cameraPosition: () => Vector3) {
    this.scene = scene;
    this.library = library;
    this.placements = placements;
    this.shadows = shadows;
    this.cameraPosition = cameraPosition;
  }

  /** Lädt die Modelle und setzt alle Stöcke in die Welt. */
  public async initializeAsync(): Promise<void> {
    await Promise.all([this.library.load(DetailFile), this.library.load(FarFile)]);
    for (const placement of this.placements) {
      const view = this.createView(placement);
      if (view !== undefined) {
        this.views.push(view);
      }
    }
  }

  /** Ankerpunkte eines Stocks in Weltkoordinaten. */
  public anchorsOf(hiveId: number): HiveAnchors | undefined {
    return this.views.find((view) => view.placement.id === hiveId)?.anchors;
  }

  /** Merkt den Stock, in dem die eigene Biene angedockt ist (Halle bleibt sichtbar). */
  public setDocked(hiveId: number | undefined): void {
    this.dockedHive = hiveId;
  }

  public frameUpdate(): void {
    const camera = this.cameraPosition();
    for (const view of this.views) {
      const near = view.placement.id === this.dockedHive || Vector3.Distance(camera, view.root.position) < DetailDistance;
      if (near === view.detailed) {
        continue;
      }
      view.detailed = near;
      for (const node of view.detail.rootNodes) {
        node.setEnabled(near);
      }
      for (const node of view.far?.rootNodes ?? []) {
        node.setEnabled(!near);
      }
      for (const mesh of view.detailMeshes) {
        if (near) {
          this.shadows.addShadowCaster(mesh, false);
        } else {
          this.shadows.removeShadowCaster(mesh, false);
        }
      }
    }
  }

  public dispose(): void {
    for (const view of this.views) {
      view.detail.dispose();
      view.far?.dispose();
      view.root.dispose();
    }
    this.views.length = 0;
  }

  private createView(placement: HivePlacement): HiveView | undefined {
    const name = `hive${placement.id}`;
    const detail = this.library.instantiateLoaded(DetailFile, `${name}Detail`);
    if (detail === undefined) {
      return undefined;
    }
    const far = this.library.instantiateLoaded(FarFile, `${name}Far`);
    const root = new TransformNode(name, this.scene);
    root.position.set(placement.x, placement.y, placement.z);
    root.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), Math.atan2(placement.sin, placement.cos));
    for (const node of [...detail.rootNodes, ...(far?.rootNodes ?? [])]) {
      node.parent = root;
    }
    const detailRoot = detail.rootNodes[0] as TransformNode | undefined;
    const detailNodes = detailRoot?.getChildTransformNodes(false) ?? [];
    const find = (suffix: string): TransformNode | undefined => detailNodes.find((node) => node.name.endsWith(suffix));
    const detailMeshes = detailRoot?.getChildMeshes(false) ?? [];
    // Eltern vor Kindern neu berechnen, damit eingefrorene Matrizen die Platzierung enthalten
    root.computeWorldMatrix(true);
    for (const node of root.getDescendants(false)) {
      node.computeWorldMatrix(true);
    }
    for (const mesh of [...detailMeshes, ...((far?.rootNodes[0] as TransformNode | undefined)?.getChildMeshes(false) ?? [])]) {
      mesh.isPickable = false;
      mesh.freezeWorldMatrix(); // Stöcke stehen still
    }
    const anchor = (suffix: string, fallback: Vector3): Vector3 => {
      const node = find(suffix);
      if (node === undefined) {
        return fallback;
      }
      node.computeWorldMatrix(true);
      return node.getAbsolutePosition().clone();
    };
    const centre = root.position.clone();
    const anchors: HiveAnchors = {
      dock: anchor("DockPoint", centre),
      entrance: anchor("EntrancePoint", centre),
      hangar: anchor("HangarPoint", centre),
      hangarCamera: anchor("HangarCamera", centre),
      beacon: anchor("BeaconPoint", centre),
    };
    return { placement, root, detail, far, detailMeshes, anchors, detailed: undefined };
  }
}
