import type { Camera } from "@babylonjs/core/Cameras/camera";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { ColorCurves } from "@babylonjs/core/Materials/colorCurves";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import type { Scene } from "@babylonjs/core/scene";
import { Atmosphere, AtmospherePhysicalProperties } from "@babylonjs/addons/atmosphere";
import type { QualitySettings } from "../core/quality";

/** Bausteine der Außenbeleuchtung (Außenbeleuchtung). */
export interface OutdoorLighting {
  readonly keyLight: DirectionalLight;
  /** Aufhellung von unten (Streulicht des Wolkenmeers) für Unterseiten und Felswände; Stärke setzt der Himmel. */
  readonly fill: HemisphericLight;
  readonly atmosphere: Atmosphere;
  readonly shadows: CascadedShadowGenerator;
  readonly pipeline: DefaultRenderingPipeline;
  readonly curves: ColorCurves;
}

/**
 * Höhe des Weltmittelpunkts über dem Planetenboden des Atmosphäre-Addons (km). Die Weltkugel reicht 7 km nach
 * unten; so liegt die ganze Spielwelt über dem Boden, und Himmel, Luftperspektive und Licht gelten überall.
 */
export const AtmosphereOriginHeightKm = 7.2;
/**
 * Rayleigh-Streuung relativ zur Erde: gleicht die dünnere Luftsäule über der Spielwelt (7 km Höhe) aus, das Blau
 * zwischen den Wolken ist hell und klar wie ein Mittagshimmel am Boden.
 */
const RayleighScatteringScale = 2.4;
/** Mie-Streuung relativ zur Erde: etwas Dunst um die Sonne, wenig Grau im Himmelsblau. */
const MieScatteringScale = 1.2;

/**
 * Baut Himmel, Hauptlicht, Schatten und Post-Processing auf (Licht-Stack). Muss vor allen PBR-Materialien
 * und glTF-Ladevorgängen laufen: Das Atmosphäre-Plugin hängt sich nur an später erzeugte PBR-Materialien.
 */
export async function createOutdoorLightingAsync(scene: Scene, camera: Camera, quality: QualitySettings): Promise<OutdoorLighting> {
  scene.clearColor = new Color4(0, 0, 0, 1);
  camera.minZ = 0.05;
  camera.maxZ = 0; // unendliche Fernebene wie in den offiziellen Atmosphäre-Beispielen

  const keyLight = new DirectionalLight("keyLight", new Vector3(0, -1, 0), scene); // muss das erste Licht sein
  keyLight.intensity = Math.PI;

  const atmosphere = new Atmosphere("atmosphere", scene, [keyLight], {
    isLinearSpaceLight: true,
    isLinearSpaceComposition: true,
    originHeight: AtmosphereOriginHeightKm,
    minimumMultiScatteringIntensity: 0.12,
    aerialPerspectiveIntensity: 1.6,
    groundAlbedo: { r: 0.8, g: 0.8, b: 0.82 },
    physicalProperties: new AtmospherePhysicalProperties({ rayleighScatteringScale: RayleighScatteringScale, mieScatteringScale: MieScatteringScale }),
  });
  await atmosphere.preloadMaterialPluginShaderIncludesAsync();

  // Nach dem Hauptlicht: nur Licht von unten (Bodenfarbe), kein Glanz; die Himmelspässe nutzen keine Szenenlichter.
  const fill = new HemisphericLight("fillLight", new Vector3(0, 1, 0), scene);
  fill.diffuse = new Color3(0, 0, 0);
  fill.groundColor = new Color3(0.85, 0.85, 0.9);
  fill.specular = new Color3(0, 0, 0);
  fill.intensity = 0.3;

  const shadows = new CascadedShadowGenerator(quality.shadowMapSize, keyLight, undefined, camera);
  shadows.numCascades = quality.shadowCascades;
  shadows.shadowMaxZ = 420; // Pflicht bei camera.maxZ = 0
  shadows.lambda = 0.88;
  shadows.cascadeBlendPercentage = 0.06;
  shadows.stabilizeCascades = true;
  shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  shadows.bias = 0.0015;
  shadows.normalBias = 0.012;
  shadows.darkness = 0.0;

  const pipeline = new DefaultRenderingPipeline("post", true, scene, [camera]);
  pipeline.samples = quality.msaaSamples;
  pipeline.fxaaEnabled = quality.fxaa;
  pipeline.bloomEnabled = quality.bloom;
  pipeline.bloomThreshold = 1.1;
  pipeline.bloomWeight = 0.22;
  pipeline.bloomKernel = 64;
  pipeline.bloomScale = 0.5;
  const imageProcessing = scene.imageProcessingConfiguration; // überlebt Pipeline-Neuaufbauten
  imageProcessing.toneMappingEnabled = true;
  imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  imageProcessing.ditheringEnabled = true; // gegen Banding im Himmelsverlauf
  imageProcessing.vignetteEnabled = true;
  imageProcessing.vignetteWeight = 1.1;
  imageProcessing.vignetteStretch = 0.2;
  imageProcessing.vignetteColor = new Color4(0.02, 0.03, 0.06, 0);
  imageProcessing.contrast = 1.12;
  const curves = new ColorCurves();
  imageProcessing.colorCurvesEnabled = true;
  imageProcessing.colorCurves = curves;

  // Wasser, Regen, Effekte in Gruppe 1: Tiefe aus Gruppe 0 bleibt erhalten, damit sie korrekt verdeckt werden.
  scene.setRenderingAutoClearDepthStencil(1, false, false, false);
  scene.setRenderingAutoClearDepthStencil(2, false, false, false);
  return { keyLight, fill, atmosphere, shadows, pipeline, curves };
}

/**
 * Anteil der Sättigung, den die Lichter zusätzlich bekommen: Wolkenlichter leuchten farbig, der Weißpunkt (Sonne,
 * Mond) bleibt weiß, weil Sättigung Grau und Weiß nicht verändert.
 */
const HighlightsSaturationShare = 0.6;

/** Färbt die Tonkurven nach Farbskript und Wetter (Farbkorrektur). */
export function applyGrading(curves: ColorCurves, saturation: number, highlightsHue: number, highlightsDensity: number, shadowsHue: number, shadowsDensity: number): void {
  curves.globalSaturation = saturation - 100;
  curves.highlightsSaturation = (saturation - 100) * HighlightsSaturationShare;
  curves.highlightsHue = highlightsHue;
  curves.highlightsDensity = highlightsDensity;
  curves.shadowsHue = shadowsHue;
  curves.shadowsDensity = shadowsDensity;
}

/** Linearer Farbwert aus sRGB-Hex. */
export function linearColor(hex: string): Color3 {
  return Color3.FromHexString(hex).toLinearSpace();
}
