import { MeshDebugMode, MeshDebugPluginMaterial } from "@babylonjs/core/Materials/meshDebugPluginMaterial";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Material } from "@babylonjs/core/Materials/material";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import { createNormalMaterial } from "./normalMaterial";
import type { DebugMode } from "./types";

/** Zuordnung der Lab-Modi zu den Modi von MeshDebugPluginMaterial. */
const PLUGIN_MODES: Partial<Record<DebugMode, MeshDebugMode>> = {
  wireframe: MeshDebugMode.TRIANGLES,
  uv: MeshDebugMode.UV0,
  vertexcolors: MeshDebugMode.VERTEXCOLORS,
  materialid: MeshDebugMode.MATERIALIDS,
};

/** Schaltet Wireframe, Normalen, UV-Raster, Vertexfarben und Material-IDs für das Modell um. */
export class DebugModes {
  private readonly plugins = new Map<Material, MeshDebugPluginMaterial>();
  private readonly originalMaterials = new Map<AbstractMesh, Material | null>();
  private rollbacks: (() => void)[] = [];
  private normalMaterial: Material | null = null;
  private current: DebugMode = "none";

  private readonly scene: Scene;
  private readonly meshes: readonly AbstractMesh[];

  constructor(scene: Scene, meshes: readonly AbstractMesh[]) {
    this.scene = scene;
    this.meshes = meshes;
  }

  get mode(): DebugMode {
    return this.current;
  }

  set(mode: DebugMode): void {
    this.reset();
    this.current = mode;
    if (mode === "none") return;
    if (mode === "normals") {
      this.applyNormals();
      return;
    }
    const pluginMode = PLUGIN_MODES[mode];
    if (pluginMode === undefined) return;
    if (mode === "wireframe") {
      // Dreiecksmodus braucht nicht-indizierte Geometrie; Rollback stellt die Indizes wieder her.
      for (const mesh of this.meshes) {
        this.rollbacks.push(MeshDebugPluginMaterial.PrepareMeshForTrianglesAndVerticesMode(mesh as Mesh, true));
      }
    }
    for (const mesh of this.meshes) {
      const material = mesh.material;
      if (!(material instanceof PBRMaterial || material instanceof StandardMaterial)) continue;
      let plugin = this.plugins.get(material);
      if (!plugin) {
        plugin = new MeshDebugPluginMaterial(material);
        this.plugins.set(material, plugin);
      }
      plugin.mode = pluginMode;
      plugin.isEnabled = true;
    }
  }

  private reset(): void {
    for (const plugin of this.plugins.values()) plugin.isEnabled = false;
    for (const rollback of this.rollbacks) rollback();
    this.rollbacks = [];
    for (const [mesh, material] of this.originalMaterials) mesh.material = material;
    this.originalMaterials.clear();
  }

  private applyNormals(): void {
    this.normalMaterial ??= createNormalMaterial(this.scene);
    for (const mesh of this.meshes) {
      this.originalMaterials.set(mesh, mesh.material);
      mesh.material = this.normalMaterial;
    }
  }
}
