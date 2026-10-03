import type { AssetContainer, InstantiatedEntries } from "@babylonjs/core/assetContainer";
import type { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import type { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import type { Material } from "@babylonjs/core/Materials/material";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { IslandCatalog } from "../../shared/islandCatalog";
import type { IslandPlacement, WorldLayout } from "../../shared/worldgen";
import type { ModelLibrary } from "../core/modelLibrary";
import type { FrameSystem } from "../core/gameLoop";

/** LOD-Stufe einer Insel (Detailstufe); 3 = im Dunst verborgen, nicht gezeichnet. */
type IslandLevel = 0 | 1 | 2 | 3;

/** Grenze zwischen LOD1 und LOD2. */
const FarRange = 2300;
/** Jenseits dieser Entfernung verschwinden Inseln im Dunst und in den Wolkenmassen. */
const HiddenRange = 4600;
/** Rückfall-Hysterese, damit Inseln an der Grenze nicht flackern. */
const Hysteresis = 1.12;
const RebuildDistance = 40;
/** Instanzierte Teile mit mehr Exemplaren (Gras, Blumen) werfen keine Schatten; Körper, Bäume und Felsen schon. */
const ShadowInstanceLimit = 40;
/** Bis zu dieser Entfernung trägt eine Detailinsel ihre volle Bepflanzung. */
const FullFloraDistance = 40;
/** Kleinster Anteil der Bepflanzung am Rand der Detailreichweite. */
const MinFloraShare = 0.3;
/** Instanzierte Teile mit mehr Exemplaren je Insel (Gras, Kleinblumen) entfallen in der Ferne. */
const MaxFarInstancesPerIsland = 12;

/** Ein Basis-Mesh mit Thin Instances für alle fernen Inseln einer Variante und Stufe (Fern-Mesh). */
interface FarMaster {
  readonly mesh: Mesh;
  /** Lage des Meshes im Modell (gebacken, nur für Meshes mit vorhandenen Instanzen). */
  readonly local: Matrix | undefined;
  readonly baseInstances: Float32Array | undefined;
  buffer: Float32Array;
}

/** Instanzierte Bepflanzung einer Detailinsel mit voller Exemplarzahl (Bepflanzung). */
interface FloraBatch {
  readonly mesh: Mesh;
  readonly fullCount: number;
}

/** Vollständig dargestellte Insel in der Nähe (Detailinsel). */
interface DetailedIsland {
  readonly root: TransformNode;
  readonly entries: InstantiatedEntries;
  readonly meshes: AbstractMesh[];
  readonly casters: AbstractMesh[];
  readonly flora: FloraBatch[];
  floraShare: number;
}

/** Detailstufen-Werte aus der Qualitätsstufe (Detaileinstellungen). */
export interface IslandDetailSettings {
  /** Sichtweite der vollständigen Inseln in Metern. */
  readonly range: number;
  /** Höchstzahl gleichzeitig vollständig dargestellter Inseln. */
  readonly maxIslands: number;
  /** Anteil der Bepflanzung 0..1. */
  readonly floraDensity: number;
}

/** Fließendes Wasser aus den glTF-Extras eines Inselknotens (Wasserfluss). */
interface WaterFlow {
  readonly textures: BaseTexture[];
  readonly speed: number;
}

/**
 * Streamt die Inseln nach Entfernung (Insel-Streamer): nah als vollständige Modellkopie (LOD0) mit Schatten
 * und Bepflanzung, mittel und fern als Thin Instances je Variante (LOD1, LOD2) — wenige Draw Calls für
 * hunderte Inseln.
 */
export class IslandStreamer implements FrameSystem {
  private readonly scene: Scene;
  private readonly library: ModelLibrary;
  private readonly layout: WorldLayout;
  private readonly shadows: CascadedShadowGenerator;
  private detail: IslandDetailSettings;
  private readonly farMasters = new Map<string, FarMaster[]>();
  private readonly levels = new Int8Array(0);
  private readonly detailed = new Map<number, DetailedIsland>();
  private readonly loading = new Set<number>();
  private readonly lastRebuild = new Vector3(Number.POSITIVE_INFINITY, 0, 0);
  private readonly flows: WaterFlow[] = [];
  private readonly flowMaterials = new Set<string>();
  private readonly blossomMaterials = new Map<string, PBRMaterial>();
  private readonly onBlossomMaterial: (material: PBRMaterial) => void;
  private timeUntilUpdate = 0;
  private farDirty = true;
  private ready = false;
  private readonly matrix = new Matrix();
  private readonly composed = new Matrix();
  private readonly rotation = new Quaternion();
  private readonly scaling = new Vector3();
  private readonly translation = new Vector3();

  public constructor(scene: Scene, library: ModelLibrary, layout: WorldLayout, shadows: CascadedShadowGenerator, detail: IslandDetailSettings, onBlossomMaterial: (material: PBRMaterial) => void) {
    this.scene = scene;
    this.library = library;
    this.layout = layout;
    this.shadows = shadows;
    this.detail = detail;
    this.onBlossomMaterial = onBlossomMaterial;
    this.levels = new Int8Array(layout.islands.length).fill(-1);
  }

  /** Lädt die fernen Stufen aller Varianten; danach erscheinen die Inseln. */
  public async initializeAsync(): Promise<void> {
    // Ferne Stufen nur aus eigenen, vereinfachten Dateien; ohne sie erscheinen die Inseln erst in der Nähe.
    const withFarLevels = IslandCatalog.filter((model) => model.files[2] !== model.files[0]);
    await Promise.all(withFarLevels.map((model) => this.loadFarLevel(model.key, model.files[2], 2)));
    this.ready = true;
    this.farDirty = true;
    // Mittlere Stufe im Hintergrund nachladen
    void Promise.all(withFarLevels.filter((model) => model.files[1] !== model.files[0]).map((model) => this.loadFarLevel(model.key, model.files[1], 1))).then(() => {
      this.farDirty = true;
    });
  }

  /** Übernimmt Reichweite, Anzahl und Bepflanzungsdichte der vollständigen Inseln. */
  public setDetail(detail: IslandDetailSettings): void {
    this.detail = detail;
    this.timeUntilUpdate = 0;
  }

  /** Ob eine Insel gerade vollständig (mit Bepflanzung und Kollision im Bild) dargestellt wird. */
  public isDetailed(islandId: number): boolean {
    return this.detailed.has(islandId);
  }

  /** Alle Blütenmaterialien (für das Nachtleuchten). */
  public get blossoms(): ReadonlyMap<string, PBRMaterial> {
    return this.blossomMaterials;
  }

  private farKey(model: string, level: IslandLevel): string {
    return `${model}#${level}`;
  }

  private async loadFarLevel(model: string, file: string, level: IslandLevel): Promise<void> {
    const container = await this.library.load(file);
    if (container === undefined) {
      return;
    }
    const capacity = this.layout.islands.filter((island) => IslandCatalog[island.model]?.key === model).length;
    const masters: FarMaster[] = [];
    // Eigene Kopie: dieselbe Datei kann auch als LOD0 dienen (Platzhalterkatalog)
    const entries = container.instantiateModelsToScene((name) => `far_${level}_${name}`, false, { doNotInstantiate: true });
    for (const node of entries.rootNodes) {
      for (const mesh of node.getChildMeshes(false)) {
        if (!(mesh instanceof Mesh) || mesh.getTotalVertices() === 0) {
          continue;
        }
        mesh.computeWorldMatrix(true);
        const hasInstances = mesh.thinInstanceCount > 0;
        if (hasInstances && mesh.thinInstanceCount > MaxFarInstancesPerIsland) {
          mesh.dispose(); // Gras und Kleinblumen bleiben der Nahstufe vorbehalten
          continue;
        }
        let local: Matrix | undefined;
        let baseInstances: Float32Array | undefined;
        if (hasInstances) {
          local = mesh.getWorldMatrix().clone();
          baseInstances = new Float32Array(mesh.thinInstanceGetWorldMatrices().length * 16);
          mesh.thinInstanceGetWorldMatrices().forEach((m, index) => m.copyToArray(baseInstances!, index * 16));
          mesh.setParent(null);
          mesh.position.setAll(0);
          mesh.rotationQuaternion = Quaternion.Identity();
          mesh.scaling.setAll(1);
        } else {
          mesh.setParent(null);
          mesh.bakeCurrentTransformIntoVertices();
        }
        const instanceCount = capacity * Math.max(1, (baseInstances?.length ?? 16) / 16);
        const buffer = new Float32Array(Math.max(16, instanceCount * 16));
        mesh.thinInstanceSetBuffer("matrix", buffer, 16, false);
        mesh.thinInstanceCount = 0;
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.isPickable = false;
        mesh.receiveShadows = level === 1;
        mesh.doNotSyncBoundingInfo = true;
        masters.push({ mesh, local, baseInstances, buffer });
      }
      node.setEnabled(true);
    }
    this.collectMaterials(container);
    this.farMasters.set(this.farKey(model, level), masters);
  }

  /** Sammelt Blütenmaterialien (Nachtleuchten) und Flusswasser (Texturverschiebung) eines Modells. */
  private collectMaterials(container: AssetContainer): void {
    for (const material of container.materials) {
      if (material.name.startsWith("Flora_Blossom")) {
        const pbr = material as PBRMaterial;
        if (!this.blossomMaterials.has(material.name)) {
          this.blossomMaterials.set(material.name, pbr);
          this.onBlossomMaterial(pbr);
        }
      }
    }
    for (const node of [...container.transformNodes, ...container.meshes]) {
      const extras = (node.metadata as { gltf?: { extras?: { flow?: { speed?: number; material?: string } } } } | null)?.gltf?.extras;
      const flow = extras?.flow;
      if (flow?.material === undefined || this.flowMaterials.has(flow.material)) {
        continue;
      }
      const material = container.materials.find((candidate: Material) => candidate.name === flow.material) as PBRMaterial | undefined;
      if (material === undefined) {
        continue;
      }
      this.flowMaterials.add(flow.material);
      const textures = [material.albedoTexture, material.bumpTexture].filter((texture): texture is BaseTexture => texture !== null);
      this.flows.push({ textures, speed: flow.speed ?? 0.3 });
    }
  }

  public frameUpdate(dt: number): void {
    for (const flow of this.flows) {
      for (const texture of flow.textures) {
        const t = texture as Texture;
        t.vOffset = (t.vOffset + flow.speed * dt) % 1;
      }
    }
    if (!this.ready) {
      return;
    }
    this.timeUntilUpdate -= dt;
    if (this.timeUntilUpdate > 0) {
      return;
    }
    this.timeUntilUpdate = 0.25;
    const camera = this.scene.activeCamera;
    if (camera === null) {
      return;
    }
    const position = camera.globalPosition;
    this.updateLevels(position);
    if (this.farDirty || Vector3.Distance(position, this.lastRebuild) > RebuildDistance) {
      this.rebuildFar();
      this.lastRebuild.copyFrom(position);
      this.farDirty = false;
    }
  }

  private distanceTo(island: IslandPlacement, position: Vector3): number {
    const dx = island.x - position.x;
    const dz = island.z - position.z;
    const horizontal = Math.max(0, Math.sqrt(dx * dx + dz * dz) - island.radius);
    const dy = position.y > island.canopy ? position.y - island.canopy : position.y < island.bottom ? island.bottom - position.y : 0;
    return Math.sqrt(horizontal * horizontal + dy * dy);
  }

  private updateLevels(position: Vector3): void {
    const candidates: Array<{ id: number; distance: number }> = [];
    for (const island of this.layout.islands) {
      const distance = this.distanceTo(island, position);
      const current = this.levels[island.id] ?? -1;
      const detailLimit = current === 0 ? this.detail.range * Hysteresis : this.detail.range;
      const farLimit = current === 1 ? FarRange * Hysteresis : FarRange;
      const hiddenLimit = current === 2 ? HiddenRange * Hysteresis : HiddenRange;
      let level: IslandLevel = distance < detailLimit ? 0 : distance < farLimit ? 1 : distance < hiddenLimit ? 2 : 3;
      if (level === 0) {
        candidates.push({ id: island.id, distance });
        level = this.detailed.has(island.id) ? 0 : 1;
      }
      if (level !== current) {
        this.levels[island.id] = level;
        this.farDirty = true;
      }
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const chosen = candidates.slice(0, this.detail.maxIslands);
    const wanted = new Set(chosen.map((candidate) => candidate.id));
    for (const [id, island] of this.detailed) {
      if (!wanted.has(id)) {
        this.despawn(id, island);
      }
    }
    for (const { id, distance } of chosen) {
      const island = this.detailed.get(id);
      if (island !== undefined) {
        this.applyFlora(island, distance);
      }
    }
    for (const id of wanted) {
      if (!this.detailed.has(id) && !this.loading.has(id)) {
        void this.spawn(id);
      }
    }
  }

  private async spawn(id: number): Promise<void> {
    const island = this.layout.islands[id];
    const model = island === undefined ? undefined : IslandCatalog[island.model];
    if (island === undefined || model === undefined) {
      return;
    }
    this.loading.add(id);
    const entries = await this.library.instantiate(model.files[0], `island${id}`);
    this.loading.delete(id);
    if (entries === undefined) {
      return;
    }
    const container = await this.library.load(model.files[0]);
    if (container !== undefined) {
      this.collectMaterials(container);
    }
    const root = new TransformNode(`Island_${id}`, this.scene);
    root.position.set(island.x, island.y, island.z);
    root.rotation.y = Math.atan2(island.sin, island.cos);
    root.scaling.setAll(island.scale);
    const meshes: AbstractMesh[] = [];
    const casters: AbstractMesh[] = [];
    const flora: FloraBatch[] = [];
    for (const node of entries.rootNodes) {
      node.parent = root;
      for (const mesh of node.getChildMeshes(false)) {
        mesh.receiveShadows = true;
        mesh.isPickable = false;
        if (mesh.getTotalVertices() === 0) {
          continue;
        }
        meshes.push(mesh);
        const instances = mesh instanceof Mesh ? mesh.thinInstanceCount : 0;
        if (instances > ShadowInstanceLimit && mesh instanceof Mesh) {
          flora.push({ mesh, fullCount: instances });
        } else {
          this.shadows.addShadowCaster(mesh, false);
          casters.push(mesh);
        }
      }
    }
    root.freezeWorldMatrix();
    for (const mesh of meshes) {
      mesh.freezeWorldMatrix();
    }
    const detailed: DetailedIsland = { root, entries, meshes, casters, flora, floraShare: -1 };
    this.applyFlora(detailed, this.distanceTo(island, this.scene.activeCamera?.globalPosition ?? Vector3.Zero()));
    this.detailed.set(id, detailed);
    this.levels[id] = 0;
    this.farDirty = true;
  }

  /** Dünnt Gras und Blumen mit der Entfernung aus; die Exemplare liegen gemischt in den Puffern. */
  private applyFlora(island: DetailedIsland, distance: number): void {
    const span = Math.max(1, this.detail.range - FullFloraDistance);
    const distanceShare = 1 - (1 - MinFloraShare) * Math.min(1, Math.max(0, (distance - FullFloraDistance) / span));
    const share = Math.round(this.detail.floraDensity * distanceShare * 20) / 20;
    if (share === island.floraShare) {
      return;
    }
    island.floraShare = share;
    for (const batch of island.flora) {
      batch.mesh.thinInstanceCount = Math.max(1, Math.round(batch.fullCount * share));
    }
  }

  private despawn(id: number, island: DetailedIsland): void {
    for (const mesh of island.casters) {
      this.shadows.removeShadowCaster(mesh, false);
    }
    island.entries.dispose();
    island.root.dispose();
    this.detailed.delete(id);
    this.levels[id] = 1;
    this.farDirty = true;
  }

  private rebuildFar(): void {
    const counts = new Map<string, number>();
    for (const [key, masters] of this.farMasters) {
      counts.set(key, 0);
      for (const master of masters) {
        master.mesh.thinInstanceCount = 0;
      }
    }
    for (const island of this.layout.islands) {
      const level = this.levels[island.id] ?? 2;
      if (level === 0 || level === 3) {
        continue;
      }
      const model = IslandCatalog[island.model];
      if (model === undefined) {
        continue;
      }
      // Fehlt die mittlere Stufe noch, springt die ferne ein.
      let key = this.farKey(model.key, level as IslandLevel);
      if (!this.farMasters.has(key)) {
        key = this.farKey(model.key, 2);
      }
      const masters = this.farMasters.get(key);
      if (masters === undefined) {
        continue;
      }
      this.rotation.copyFromFloats(0, Math.sin(Math.atan2(island.sin, island.cos) / 2), 0, Math.cos(Math.atan2(island.sin, island.cos) / 2));
      this.scaling.setAll(island.scale);
      this.translation.set(island.x, island.y, island.z);
      Matrix.ComposeToRef(this.scaling, this.rotation, this.translation, this.matrix);
      const index = counts.get(key) ?? 0;
      counts.set(key, index + 1);
      for (const master of masters) {
        if (master.baseInstances === undefined || master.local === undefined) {
          this.matrix.copyToArray(master.buffer, index * 16);
          master.mesh.thinInstanceCount = index + 1;
          continue;
        }
        const perIsland = master.baseInstances.length / 16;
        for (let i = 0; i < perIsland; i++) {
          Matrix.FromArrayToRef(master.baseInstances, i * 16, this.composed);
          this.composed.multiplyToRef(master.local, this.composed);
          this.composed.multiplyToRef(this.matrix, this.composed);
          this.composed.copyToArray(master.buffer, (index * perIsland + i) * 16);
        }
        master.mesh.thinInstanceCount = (index + 1) * perIsland;
      }
    }
    for (const masters of this.farMasters.values()) {
      for (const master of masters) {
        master.mesh.thinInstanceBufferUpdated("matrix");
        master.mesh.setEnabled(master.mesh.thinInstanceCount > 0);
      }
    }
  }

  /** Zahl der vollständig dargestellten Inseln (Debug-API). */
  public get detailedCount(): number {
    return this.detailed.size;
  }

  public dispose(): void {
    for (const [id, island] of this.detailed) {
      this.despawn(id, island);
    }
    for (const masters of this.farMasters.values()) {
      for (const master of masters) {
        master.mesh.dispose();
      }
    }
    this.farMasters.clear();
  }
}
