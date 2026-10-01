# Post-Processing

## DefaultRenderingPipeline (DRP)

- **Konstruktor:** `new DefaultRenderingPipeline(name = "", hdr = true, scene, cameras = scene.cameras, automaticBuild = true)`.
- **HDR:** HALF_FLOAT-Ziele, Rückfall FLOAT; ohne beides LDR (Image Processing läuft dann in den
  Materialien).
- **Feste Kette:** DOF → Bloom → Image Processing (nur HDR) → Sharpen → Grain → Chromatische
  Aberration → FXAA. `samples` setzt MSAA auf den ersten Post-Process (WebGPU max. 4).

| Feature | API (Standard) | Startwert außen |
|---|---|---|
| MSAA | `samples` (1) | 4 |
| FXAA | `fxaaEnabled` (false) | aus, wenn MSAA aktiv |
| Bloom | `bloomEnabled` (false), `bloomThreshold` 0,9, `bloomWeight` 0,15, `bloomKernel` 64, `bloomScale` 0,5 | Schwelle 1,0–1,3, Gewicht 0,2–0,3 |
| Tiefenschärfe | `depthOfFieldEnabled`, `depthOfFieldBlurLevel` (`DepthOfFieldEffectBlurLevel.Low/Medium/High`), `depthOfField.focalLength` 50, `fStop` 1,4, `focusDistance` 2000 (mm) | nur Fotomodus/Zwischensequenzen; fStop 2,8–4; Fokus = Meter × 1000 |
| Chromatische Aberration | `chromaticAberration.aberrationAmount` 30, `radialIntensity` 0 | 10–20, radial 0,5–1 |
| Grain | `grain.intensity` 30, `animated` false | 3–6, animiert |
| Sharpen | `sharpen.edgeAmount` 0,3, `colorAmount` 1 | 0,15–0,25 |

- **Bloom** extrahiert hart (`step(threshold, luma)`), ohne Soft Knee, vor dem Tonemapping.
- `bloomScale` und `depthOfFieldBlurLevel` bauen ihre Effekte beim Setzen neu — nicht animieren.
- **DOF** ruft `scene.enableDepthRenderer(camera)` auf: ein zusätzlicher Tiefenpass, teuer über
  dichtem Gras und blind für Vertex-Wind.

### Image Processing

Liegt auf `scene.imageProcessingConfiguration`; `pipeline.imageProcessing` verweist auf dasselbe
Objekt, wird aber bei jedem Neuaufbau neu erzeugt — deshalb über die Szene konfigurieren.

- Tonemapping: `ImageProcessingConfiguration.TONEMAPPING_STANDARD` (0), `TONEMAPPING_ACES` (1),
  `TONEMAPPING_KHR_PBR_NEUTRAL` (2).
- Standardwerte: `toneMappingEnabled` false, `exposure` 1 (linearer Faktor), `contrast` 1,
  Vignette aus (`vignetteWeight` 1,5, `vignetteBlendMode` `VIGNETTEMODE_MULTIPLY`, nur RGB von
  `vignetteColor` zählt), `ditheringEnabled` false, Color Curves und Color Grading aus.
- Weißabgleich (ab 9.24): `whiteBalanceEnabled`, `temperature` (Kelvin, Standard 6500), `tint`
  (±150) — neutralisiert die Lichtfarbe, kein kreatives Grading.
- Shader-Reihenfolge: Weißabgleich → Belichtung → Vignette → Tonemapping → Gamma und Sättigung →
  Kontrast → LUT → Color Curves → Dithering. Kontrast, LUT und Curves wirken also auf
  Anzeigewerte.
- LUT: `new ColorGradingTexture("lut.3dl", scene)` (nur `.3dl`); Mischgewicht über
  `colorGradingTexture.level`.

```ts
import type { Scene } from "@babylonjs/core/scene";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { ColorCurves } from "@babylonjs/core/Materials/colorCurves";
import { Color4 } from "@babylonjs/core/Maths/math.color";

/** Erzeugt den Bildlook für Außenszenen; Werte sind Startpunkte. */
export function createOutdoorPipeline(scene: Scene, camera: Camera): DefaultRenderingPipeline {
  const pipeline = new DefaultRenderingPipeline("outdoor", true, scene, [camera]);
  pipeline.samples = 4; // MSAA, WebGPU max. 4
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 1.1; // nur HDR-Spitzen: Sonne, Glanzlichter
  pipeline.bloomWeight = 0.25;
  pipeline.grainEnabled = true;
  pipeline.grain.intensity = 4;
  pipeline.grain.animated = true;
  pipeline.chromaticAberrationEnabled = true;
  pipeline.chromaticAberration.aberrationAmount = 12;
  pipeline.chromaticAberration.radialIntensity = 0.8;
  const imageProcessing = scene.imageProcessingConfiguration; // überlebt Pipeline-Neuaufbauten
  imageProcessing.toneMappingEnabled = true;
  imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL; // filmischer: TONEMAPPING_ACES
  imageProcessing.contrast = 1.15;
  imageProcessing.vignetteEnabled = true;
  imageProcessing.vignetteWeight = 1.2;
  imageProcessing.vignetteColor = new Color4(0.08, 0.05, 0.02, 0);
  imageProcessing.ditheringEnabled = true; // gegen Banding im Himmelsverlauf
  const curves = new ColorCurves(); // Hue 0..360, Density/Saturation -100..100
  curves.highlightsHue = 40; // warme Lichter
  curves.highlightsDensity = 12;
  imageProcessing.colorCurves = curves;
  imageProcessing.colorCurvesEnabled = true;
  return pipeline;
}
```

- Mit aktiver Pipeline braucht `scene.clearColor` lineare Werte (`.toLinearSpace()`); mit dem
  Atmosphäre-Addon bleibt die Löschfarbe schwarz.
- Ein eigener Post-Process, der in der Kette vor der DRP liegt, braucht selbst `samples = 4`.

### GlowLayer

Effect Layers werden nach dem Kamerabild in das Szenenziel gemischt — also **vor** der DRP-Kette,
und dann erneut geblüht und tonegemappt. Bloom für physikalische Highlights, GlowLayer nur für
gezielte Leuchtobjekte:

```ts
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { Constants } from "@babylonjs/core/Engines/constants";

const glow = new GlowLayer("glow", scene, {
  mainTextureSamples: 4,
  blurKernelSize: 32,
  mainTextureRatio: 0.5,
  mainTextureType: Constants.TEXTURETYPE_HALF_FLOAT,
  ldrMerge: false,
});
glow.addIncludedOnlyMesh(glowingMesh);
```

`pipeline.glowLayerEnabled = true` erzeugt eine GlowLayer mit Standardwerten — eigene Instanz
bevorzugen.

## SSAO2, SSR, TAA, Motion Blur, FSR1

| Klasse (Pfad unter `@babylonjs/core/PostProcesses/…`) | Konstruktor | Wichtige Standardwerte |
|---|---|---|
| `SSAO2RenderingPipeline` (`RenderPipeline/Pipelines/ssao2RenderingPipeline`) | `(name, scene, ratio \| { ssaoRatio, blurRatio }, cameras?, forceGeometryBuffer = false, textureType = UNSIGNED_BYTE)` | `samples` 8, `radius` 2, `totalStrength` 1, `maxZ` 100, `expensiveBlur` true, `textureSamples` 1 (MSAA des Prepass) |
| `SSRRenderingPipeline` (`…/ssrRenderingPipeline`) | `(name, scene, cameras?, forceGeometryBuffer = false, textureType = UNSIGNED_BYTE, useScreenspaceDepth = false)` | `step` 1, `maxSteps` 1000, `maxDistance` 1000, `thickness` 0,5, `reflectivityThreshold` 0,04; nur Standard- und PBR-Materialien |
| `TAARenderingPipeline` (`…/taaRenderingPipeline`) | `(name, scene, cameras?, textureType = UNSIGNED_BYTE)` | `samples` 8, `factor` 0,05, `msaaSamples` 1, `disableOnCameraMove` true, `reprojectHistory`/`clampHistory` false |
| `MotionBlurPostProcess` (`motionBlurPostProcess`) | `(name, scene, options, camera, samplingMode?, engine?, reusable?, textureType = 0, blockCompilation = false, forceGeometryBuffer = false)` | `motionStrength` 1, `motionBlurSamples` 32, `isObjectBased` true |
| `FSR1RenderingPipeline` (ab 9.22) | `(name, scene, cameras?)` | `scaleFactor` 1,5 (`SCALE_ULTRA_QUALITY` 1,3 … `SCALE_PERFORMANCE` 2), `sharpnessStops` 0,2 |

### Regeln für das Zusammenspiel

1. **Reihenfolge = Erzeugungsreihenfolge.** TAA zuerst, dann SSAO2 → SSR → Motion Blur, die DRP
   zuletzt.
2. **HDR durchreichen:** alle mit `Constants.TEXTURETYPE_HALF_FLOAT` erzeugen.
3. **SSR-Farbraum:** vor einer HDR-DRP `inputTextureColorIsInGammaSpace = false` und
   `generateOutputInGammaSpace = false`.
4. **MSAA mit Prepass-Effekten:** Die Szene rendert in das Prepass-MRT — `ssao.textureSamples = 4`
   setzen; `pipeline.samples` allein lässt Treppenstufen. Bei Artefakten SSAO2 mit
   `forceGeometryBuffer = true`.
5. **TAA oder MSAA:** Mit TAA gilt DRP `samples = 1` und FXAA aus; für bewegte Kamera
   `reprojectHistory = true`, `clampHistory = true`, `disableOnCameraMove = false`. Jitter
   erhalten nur Materialien mit `pluginManager` (PBR, Standard, OpenPBR); ShaderMaterial und
   NodeMaterial nicht. Vertex-Wind liefert keine Bewegungsvektoren → Schlieren auf Gras. **Für
   Wiesen: MSAA 4.**
6. **Prepass vs. Geometry Buffer:** `GeometryBufferRenderer` und `DepthRenderer` nutzen eigene
   Shader ohne Plugin-Hooks und sehen keinen Wind; der Prepass nutzt den Materialshader (das
   Wind-Plugin muss dafür die Prepass-Varyings mitschreiben, siehe Materialien).
7. **Kosten:** SSR „optimiert" ≈ 0,45 ms vs. „Qualität" ≈ 4,4 ms (RTX 3080 Ti, Doku). Draußen
   lohnt SSR praktisch nur auf Wasser; SSAO mit Ratio ≤ 0,5.

```ts
import { Constants } from "@babylonjs/core/Engines/constants";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { SSAO2RenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline";
import { SSRRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssrRenderingPipeline";
import { MotionBlurPostProcess } from "@babylonjs/core/PostProcesses/motionBlurPostProcess";

const hdrType = Constants.TEXTURETYPE_HALF_FLOAT; // HDR bis zur DRP durchreichen
const ssao = new SSAO2RenderingPipeline("ssao", scene, { ssaoRatio: 0.5, blurRatio: 1 }, [camera], false, hdrType);
ssao.radius = 1.5;
ssao.samples = 16;
ssao.maxZ = 150;
ssao.textureSamples = 4; // MSAA des Prepass-MRT
const ssr = new SSRRenderingPipeline("ssr", scene, [camera], false, hdrType);
ssr.inputTextureColorIsInGammaSpace = false; // Szenenfarbe ist vor der DRP linear
ssr.generateOutputInGammaSpace = false;
ssr.step = 4;
ssr.maxSteps = 200;
ssr.maxDistance = 150;
ssr.blurDownsample = 1;
ssr.reflectivityThreshold = 0.1; // praktisch nur Wasser
const motionBlur = new MotionBlurPostProcess("motionBlur", scene, 1.0, camera, Texture.BILINEAR_SAMPLINGMODE, scene.getEngine(), false, hdrType);
motionBlur.isObjectBased = false; // kamerabasiert, günstiger
createOutdoorPipeline(scene, camera); // DRP zuletzt
```

## Bildschirm-Lichtstrahlen (VolumetricLightScatteringPostProcess)

```ts
import { VolumetricLightScatteringPostProcess } from "@babylonjs/core/PostProcesses/volumetricLightScatteringPostProcess";
// new VolumetricLightScatteringPostProcess(name, ratio | { postProcessRatio, passRatio }, camera, mesh?, samples = 100,
//   samplingMode?, engine?, reusable?, scene?)
```

- Eigenschaften: `exposure`, `decay`, `weight`, `density`, `useCustomMeshPosition` /
  `setCustomMeshPosition`, `excludedMeshes` / `includedMeshes`; `CreateDefaultMesh` erzeugt eine
  Standard-Lichtquelle.
- Läuft zusammen mit Atmosphäre, DRP und CSM (Laufzeittest). Startwerte: `exposure` 0,25,
  `decay` 0,97; für `medium` Ratio 0,5 und 50 Samples.
- Die Farbe der Strahlen kommt vom Material des Quell-Meshes (Sonnenscheibe).
- Die volumetrischen Lichter der `StandardRenderingPipeline` gehören zu einer älteren
  HDR-Pipeline, die sich nicht mit der DRP verträgt — nicht verwenden.
