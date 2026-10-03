import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { Material } from "@babylonjs/core/Materials/material";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

/** Materialien eines Quell-Meshes: Grundmaterial und eines je Variante (Variantenmaterialien). */
interface MeshVariants {
  readonly original: Material | null;
  readonly variants: ReadonlyMap<string, Material>;
}

/** Eine Zeile der KHR_materials_variants-Metadaten des glTF-Laders. */
interface VariantEntry {
  readonly mesh: AbstractMesh;
  readonly material: Material;
}

/** Metadaten, die der glTF-Lader für KHR_materials_variants am Wurzelknoten ablegt. */
interface VariantMetadata {
  readonly original: readonly VariantEntry[];
  readonly variants: Readonly<Record<string, readonly VariantEntry[]>>;
}

/**
 * Materialvarianten eines geladenen Modells (KHR_materials_variants) als Tabelle je Quell-Mesh-Name
 * (Variantentabelle). Kopien aus `instantiateModelsToScene` setzen ihre Materialien damit selbst; die
 * Auswahlfunktion des Laders wirkt bei Kopien auf die falschen Meshes. Die Tabelle entsteht direkt nach dem
 * Laden, vor der ersten Kopie: Beim Klonen schreibt der Lader die Metadaten des Wurzelknotens auf die Kopie um.
 */
export class MaterialVariantTable {
  private readonly bySourceName = new Map<string, MeshVariants>();

  public constructor(container: AssetContainer) {
    const root = container.rootNodes[0];
    const metadata = (root?._internalMetadata as { gltf?: { KHR_materials_variants?: VariantMetadata } } | undefined)?.gltf?.KHR_materials_variants;
    if (metadata === undefined) {
      return;
    }
    const originals = new Map<AbstractMesh, Material>();
    for (const entry of metadata.original) {
      originals.set(entry.mesh, entry.material);
    }
    const variantsByMesh = new Map<AbstractMesh, Map<string, Material>>();
    for (const [variant, entries] of Object.entries(metadata.variants)) {
      for (const entry of entries) {
        const map = variantsByMesh.get(entry.mesh) ?? new Map<string, Material>();
        map.set(variant, entry.material);
        variantsByMesh.set(entry.mesh, map);
      }
    }
    for (const [mesh, variants] of variantsByMesh) {
      this.bySourceName.set(mesh.name, { original: originals.get(mesh) ?? mesh.material, variants });
    }
  }

  /** Anzahl der Quell-Meshes mit Varianten (0 = Modell ohne Varianten). */
  public get size(): number {
    return this.bySourceName.size;
  }

  /** Bindet die Tabelle an die Meshes einer Kopie, deren Namen mit `prefix_` beginnen. */
  public bind(meshes: readonly AbstractMesh[], prefix: string): BoundVariants {
    const bound: Array<{ mesh: AbstractMesh; materials: MeshVariants }> = [];
    for (const mesh of meshes) {
      const sourceName = mesh.name.startsWith(`${prefix}_`) ? mesh.name.slice(prefix.length + 1) : mesh.name;
      const materials = this.bySourceName.get(sourceName);
      if (materials !== undefined) {
        bound.push({ mesh, materials });
      }
    }
    return new BoundVariants(bound);
  }
}

/** Variantenmaterialien einer einzelnen Modellkopie (gebundene Varianten). */
export class BoundVariants {
  private readonly entries: ReadonlyArray<{ mesh: AbstractMesh; materials: MeshVariants }>;
  private current = "";

  public constructor(entries: ReadonlyArray<{ mesh: AbstractMesh; materials: MeshVariants }>) {
    this.entries = entries;
  }

  /** Anzahl der gebundenen Meshes. */
  public get size(): number {
    return this.entries.length;
  }

  /** Wählt eine Variante; Meshes ohne Material in dieser Variante tragen ihr Grundmaterial. */
  public select(variant: string): void {
    if (variant === this.current) {
      return;
    }
    this.current = variant;
    for (const { mesh, materials } of this.entries) {
      mesh.material = materials.variants.get(variant) ?? materials.original;
    }
  }
}
