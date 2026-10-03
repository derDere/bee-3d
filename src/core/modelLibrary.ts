import type { AssetContainer, InstantiatedEntries } from "@babylonjs/core/assetContainer";
import { BoundingInfo } from "@babylonjs/core/Culling/boundingInfo";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Logger } from "@babylonjs/core/Misc/logger";
import type { Scene } from "@babylonjs/core/scene";
import { useMaterialImageProcessing } from "../rendering/materialImageProcessing";
import { MaterialVariantTable } from "./materialVariants";

const ModelBase = `${import.meta.env.BASE_URL}assets/models/`;

/** Lädt jedes Modell einmal und erzeugt beliebig viele Kopien (Modellbibliothek). */
export class ModelLibrary {
  private readonly scene: Scene;
  private readonly containers = new Map<string, Promise<AssetContainer | undefined>>();
  private readonly loaded = new Map<string, AssetContainer>();
  private readonly variantTables = new Map<string, MaterialVariantTable>();

  public constructor(scene: Scene) {
    this.scene = scene;
  }

  /** Lädt ein Modell relativ zu `public/assets/models/`; Fehler werden protokolliert, das Ergebnis ist dann undefined. */
  public load(file: string): Promise<AssetContainer | undefined> {
    let pending = this.containers.get(file);
    if (pending === undefined) {
      // Ohne Transmission-Helfer: Er rendert für durchscheinende Flügel und Stoffe jeden Frame die ganze Szene ein zweites Mal.
      pending = LoadAssetContainerAsync(`${ModelBase}${file}`, this.scene, { pluginOptions: { gltf: { compileMaterials: true, dontUseTransmissionHelper: true } } })
        .then((container) => {
          for (const material of container.materials) {
            useMaterialImageProcessing(material);
          }
          // Varianten vor der ersten Kopie erfassen (siehe MaterialVariantTable)
          this.variantTables.set(file, new MaterialVariantTable(container));
          this.loaded.set(file, container);
          return container;
        })
        .catch((error: unknown) => {
          Logger.Warn(`Modell ${file} nicht geladen: ${String(error)}`);
          return undefined;
        });
      this.containers.set(file, pending);
    }
    return pending;
  }

  /** Erzeugt eine Kopie eines geladenen Modells; Meshes werden geklont, GPU-Instanzen (Bepflanzung) übernommen. */
  public async instantiate(file: string, name: string): Promise<InstantiatedEntries | undefined> {
    const container = await this.load(file);
    return container === undefined ? undefined : ModelLibrary.cloneContainer(container, name);
  }

  /** Der geladene Container eines Modells oder undefined, solange er fehlt. */
  public loadedContainer(file: string): AssetContainer | undefined {
    return this.loaded.get(file);
  }

  /** Materialvarianten eines geladenen Modells (KHR_materials_variants) oder undefined, solange es fehlt. */
  public variantTable(file: string): MaterialVariantTable | undefined {
    return this.variantTables.get(file);
  }

  /** Erzeugt sofort eine Kopie, sofern das Modell schon geladen ist (für Pools im Frame-Takt). */
  public instantiateLoaded(file: string, name: string): InstantiatedEntries | undefined {
    const container = this.loaded.get(file);
    return container === undefined ? undefined : ModelLibrary.cloneContainer(container, name);
  }

  private static cloneContainer(container: AssetContainer, name: string): InstantiatedEntries {
    const entries = container.instantiateModelsToScene((source) => `${name}_${source}`, false, { doNotInstantiate: true });
    ModelLibrary.copyThinInstances(container, entries, name);
    return entries;
  }

  /**
   * Übernimmt die GPU-Instanzen (EXT_mesh_gpu_instancing: Matrizen und Farben) der Quell-Meshes in die Kopien;
   * das Klonen in instantiateModelsToScene lässt sie weg. Kopien teilen die Geometrie mit ihrer Quelle, und Babylon
   * hängt die Instanzpuffer an die Geometrie: Die Kopien zeichnen deshalb mit den Puffern der Quelle aus dem
   * geladenen Container und setzen nur ihre Exemplarzahl (Ausdünnen). Eigene Puffer je Kopie würden beim Entladen
   * einer Kopie die Puffer freigeben, an denen die übrigen Kopien noch hängen.
   */
  private static copyThinInstances(container: AssetContainer, entries: InstantiatedEntries, name: string): void {
    const sources = container.meshes.filter((mesh): mesh is Mesh => mesh instanceof Mesh && mesh.thinInstanceCount > 0);
    if (sources.length === 0) {
      return;
    }
    const clones = new Map<string, Mesh[]>();
    for (const root of entries.rootNodes) {
      for (const mesh of root.getChildMeshes(false)) {
        if (mesh instanceof Mesh) {
          const list = clones.get(mesh.name) ?? [];
          list.push(mesh);
          clones.set(mesh.name, list);
        }
      }
    }
    const used = new Map<string, number>();
    for (const source of sources) {
      const key = `${name}_${source.name}`;
      const index = used.get(key) ?? 0;
      used.set(key, index + 1);
      const clone = clones.get(key)?.[index];
      if (clone === undefined || clone.source !== source) {
        continue;
      }
      clone.thinInstanceCount = source.thinInstanceCount;
      // Begrenzung über alle Exemplare aus der Quelle (eigenes Objekt: jede Kopie führt ihre Weltlage selbst)
      const box = source.getBoundingInfo().boundingBox;
      clone.setBoundingInfo(new BoundingInfo(box.minimum.clone(), box.maximum.clone()));
    }
  }

  public dispose(): void {
    for (const pending of this.containers.values()) {
      void pending.then((container) => container?.dispose());
    }
    this.containers.clear();
    this.loaded.clear();
    this.variantTables.clear();
  }
}
