import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import type { Material } from "@babylonjs/core/Materials/material";
import { PBRBaseMaterial } from "@babylonjs/core/Materials/PBR/pbrBaseMaterial";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";

const configurations = new WeakMap<Scene, ImageProcessingConfiguration>();

/**
 * Feste Bildverarbeitung der Materialien einer Szene (Material-Bildverarbeitung). Belichtung, Tonkurven und
 * Tonemapping wendet die Post-Process-Kette über die Bildverarbeitung der Szene an; die Materialien rechnen
 * sie nicht selbst. An einer eigenen, unveränderlichen Konfiguration bleiben ihre Shader gültig, während der
 * Himmel die Belichtung der Szene jeden Frame nachführt.
 */
export function materialImageProcessing(scene: Scene): ImageProcessingConfiguration {
  let configuration = configurations.get(scene);
  if (configuration === undefined) {
    configuration = new ImageProcessingConfiguration();
    configuration.applyByPostProcess = true;
    configurations.set(scene, configuration);
  }
  return configuration;
}

/** Hängt ein PBR- oder Standardmaterial an die feste Bildverarbeitung; andere Materialien bleiben unverändert. */
export function useMaterialImageProcessing(material: Material): void {
  if (material instanceof PBRBaseMaterial || material instanceof StandardMaterial) {
    material.imageProcessingConfiguration = materialImageProcessing(material.getScene());
  }
}
