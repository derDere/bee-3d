# Frame Graph und volumetrisches Licht

## Was sich mit `scene.frameGraph` ändert

`scene.render()` führt weiterhin Animationen, `onBeforeRender`/`onAfterRender`,
`customRenderTargets` und Partikel-Animation aus und ruft dann `frameGraph.execute()` auf.
**Ausgelassen** werden Kamera-Post-Processes (einschließlich der `DefaultRenderingPipeline`),
Effect Layers (GlowLayer) und klassische `ShadowGenerator`s — jede dieser Funktionen wird als Task
gebaut. Frame Graph ist seit 9.0 „v1" und läuft auf WebGL2 und WebGPU.

## DRP-Funktion → Task

| Funktion | Task (Pfad unter `@babylonjs/core/FrameGraph/Tasks/…`) |
|---|---|
| Bloom | `FrameGraphBloomTask(name, fg, weight = 0.25, kernel = 64, threshold = 0.2, hdr = false, bloomScale = 0.5)` (`PostProcesses/bloomTask`) — Standardwerte weichen von der DRP ab |
| Tonemapping, Belichtung, Kontrast, Dithering, Vignette | `FrameGraphImageProcessingTask` (`PostProcesses/imageProcessingTask`), Einstellungen über `.postProcess.*`; am Object Renderer `disableImageProcessing = true` |
| Weitere Tonemapper | `FrameGraphTonemapTask` (Hable, Reinhard, HejiDawson, Photographic) |
| FXAA, Chromatische Aberration, Grain, Sharpen | `FrameGraphFXAATask`, `…ChromaticAberrationTask`, `…GrainTask`, `…SharpenTask` |
| MSAA | `samples` an Farb- und Tiefentextur |
| TAA | `FrameGraphTAATask` (braucht `objectRendererTask`, `samples` 1) |
| DOF, Motion Blur | `FrameGraphDepthOfFieldTask`, `FrameGraphMotionBlurTask` |
| SSAO2 / SSR | `FrameGraphSSAO2RenderingPipelineTask` / `FrameGraphSSRRenderingPipelineTask` (G-Buffer über `FrameGraphGeometryRendererTask`) |
| Glow | `FrameGraphGlowLayerTask` (`Layers/glowLayerTask`) |
| Schatten | `FrameGraphShadowGeneratorTask` / `FrameGraphCascadedShadowGeneratorTask`, am Object Renderer in `shadowGenerators` |
| Frustum Culling | `FrameGraphCullObjectsTask` (`Misc/cullObjectsTask`) — der Object Renderer cullt nicht selbst |
| Volumetrisches Licht | `FrameGraphLightingVolumeTask` (`Misc/lightingVolumeTask`) + `FrameGraphVolumetricLightingTask` (`PostProcesses/volumetricLightingTask`) |

## Volumetrisches Licht

**Kette:** nicht-kaskadierter `FrameGraphShadowGeneratorTask` → `FrameGraphLightingVolumeTask` →
`FrameGraphVolumetricLightingTask`.

- Das `LightingVolume` liest `light.orthoLeft/Right/Bottom/Top`, `shadowMinZ/MaxZ` und eine
  2D-Shadow-Map. Es braucht eine feste Ortho-Box (`autoUpdateExtends = false`), die der Kamera
  folgt.
- Mit CSM kombinierbar: zweiter Shadow-Task am selben Licht (CSM je Kamera für die Materialien,
  der einfache Generator nur für das Volumen).
- **Parameter:**
  - `lightPower` (Color3) ist **unabhängig** von Lichtfarbe und -stärke — aus `sun.diffuse`
    selbst nachführen. Ohne Extinktion wächst die Einstreuung linear mit der Distanz: 0,25 machte
    in der Testszene alles weiß, 0,0015–0,004 passte für ein ~120-m-Volumen.
  - `phaseG`: Henyey-Greenstein-Anisotropie −1…1, positiv = Vorwärtsstreuung (0,6 für
    Sonnenstrahlen).
  - `extinction` (Vector3 pro Welteinheit, ≥ 1e-5) wirkt nur mit Konstruktor-Flag
    `enableExtinction`, das Dual-Source-Blending verlangt (`IsSupported(engine, true)`,
    WebGPU nur mit `enableAllFeatures`). Die Extinktion multipliziert den **ganzen Bildschirm
    einschließlich Himmel** — draußen aus oder sehr klein.
  - `frequency` (Aktualisierung alle N Frames), `tesselation` (gerade Zahl ≥ 2).
- **WebGPU vs. WebGL2:** WebGPU aktualisiert das Volumen per Compute Shader jeden Frame
  (Side-Effect-Import `@babylonjs/core/Engines/WebGPU/Extensions/engine.computeShader`). WebGL2
  liest die Shadow-Map auf die CPU zurück und aktualisiert verzögert. Doku-Empfehlung: `frequency`
  1 / 4, `tesselation` 1024 / 256. Testszene: ~50 fps WebGPU, ~32 fps WebGL2.
- Node Render Graph: Blöcke `NodeRenderGraphLightingVolumeBlock` und
  `NodeRenderGraphVolumetricLightingBlock`; Beispiel-Playground `#WLGEJB#46` (lädt
  `#MLGTEH` / `#4S8LNP#6`), klassenbasiert `#WLGEJB#45`.

## Frame Graph mit Atmosphäre-Brücke (Code)

Ohne Brücke: `buildAsync()` läuft in einen Timeout („First task not ready: render"), mit
`buildAsync(false)` fehlen Himmel, Sonnenfarbe und Umgebungslicht. Ursache: Der Frame Graph löst
`onBeforeCameraRenderObservable` nicht aus, und der Himmel wird nur im `RenderingManager` der Szene
gezeichnet, der Object Renderer hat einen eigenen. Die zwei Hooks unten beheben beides — auf
WebGPU und WebGL2 mit Himmel, Luftperspektive, Sonnenfarbe, CSM, Volumetrie, Bloom, ACES und FXAA
getestet. **Inoffizieller Weg — nach jedem Babylon-Update erneut prüfen.**

```ts
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { Atmosphere } from "@babylonjs/addons/atmosphere";
import { Constants } from "@babylonjs/core/Engines/constants";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { FrameGraph } from "@babylonjs/core/FrameGraph/frameGraph";
import { backbufferColorTextureHandle } from "@babylonjs/core/FrameGraph/frameGraphTypes";
import { FrameGraphClearTextureTask } from "@babylonjs/core/FrameGraph/Tasks/Texture/clearTextureTask";
import { FrameGraphCascadedShadowGeneratorTask } from "@babylonjs/core/FrameGraph/Tasks/Rendering/csmShadowGeneratorTask";
import { FrameGraphShadowGeneratorTask } from "@babylonjs/core/FrameGraph/Tasks/Rendering/shadowGeneratorTask";
import { FrameGraphObjectRendererTask } from "@babylonjs/core/FrameGraph/Tasks/Rendering/objectRendererTask";
import { FrameGraphExecuteTask } from "@babylonjs/core/FrameGraph/Tasks/Misc/executeTask";
import { FrameGraphLightingVolumeTask } from "@babylonjs/core/FrameGraph/Tasks/Misc/lightingVolumeTask";
import { FrameGraphVolumetricLightingTask } from "@babylonjs/core/FrameGraph/Tasks/PostProcesses/volumetricLightingTask";
import { FrameGraphBloomTask } from "@babylonjs/core/FrameGraph/Tasks/PostProcesses/bloomTask";
import { FrameGraphImageProcessingTask } from "@babylonjs/core/FrameGraph/Tasks/PostProcesses/imageProcessingTask";
import { FrameGraphFXAATask } from "@babylonjs/core/FrameGraph/Tasks/PostProcesses/fxaaTask";
import "@babylonjs/core/Engines/WebGPU/Extensions/engine.computeShader"; // Compute Shader für das Lighting Volume

/** Baut den Frame Graph mit Volumetrie und Atmosphäre-Brücke (Render-Graph). */
export async function buildVolumetricFrameGraphAsync(
  scene: Scene,
  camera: Camera,
  sun: DirectionalLight,
  atmosphere: Atmosphere,
  shadowCasters: AbstractMesh[],
): Promise<FrameGraph> {
  const engine = scene.getEngine();
  const fg = new FrameGraph(scene);
  scene.frameGraph = fg; // vor buildAsync setzen
  scene.cameraToUseForPointers = camera; // activeCamera ist außerhalb der Tasks null

  const createTarget = (name: string, type: number, format: number) =>
    fg.textureManager.createRenderTargetTexture(name, {
      size: { width: 100, height: 100 },
      sizeIsPercentage: true,
      options: { createMipMaps: false, types: [type], formats: [format], samples: 4, useSRGBBuffers: [false], labels: [name] },
    });

  const clear = new FrameGraphClearTextureTask("clear", fg);
  clear.clearColor = true;
  clear.clearDepth = true;
  clear.color = new Color4(0, 0, 0, 1);
  clear.targetTexture = createTarget("color", Constants.TEXTURETYPE_HALF_FLOAT, Constants.TEXTUREFORMAT_RGBA);
  clear.depthTexture = createTarget("depth", Constants.TEXTURETYPE_UNSIGNED_BYTE, Constants.TEXTUREFORMAT_DEPTH32_FLOAT);
  fg.addTask(clear);

  const casters = { meshes: shadowCasters, particleSystems: [] };
  const csmTask = new FrameGraphCascadedShadowGeneratorTask("csm", fg);
  csmTask.light = sun;
  csmTask.camera = camera;
  csmTask.objectList = casters;
  csmTask.mapSize = 2048;
  csmTask.shadowMaxZ = 400;
  csmTask.lambda = 0.85;
  csmTask.stabilizeCascades = true;
  fg.addTask(csmTask);

  // Das Lighting Volume braucht eine nicht-kaskadierte Shadow-Map mit fester Ortho-Box
  sun.autoUpdateExtends = false;
  sun.shadowOrthoScale = 0;
  sun.orthoLeft = -80;
  sun.orthoRight = 80;
  sun.orthoBottom = -80;
  sun.orthoTop = 80;
  sun.shadowMinZ = 0;
  sun.shadowMaxZ = 500;
  const volumeShadow = new FrameGraphShadowGeneratorTask("volumeShadow", fg);
  volumeShadow.light = sun;
  volumeShadow.camera = camera;
  volumeShadow.objectList = casters;
  volumeShadow.mapSize = 1024;
  fg.addTask(volumeShadow);

  // Brücke 1: Kamera-Update und LUTs der Atmosphäre (der Frame Graph löst onBeforeCameraRenderObservable nicht aus)
  const bridge = new FrameGraphExecuteTask("atmosphereCameraUpdate", fg);
  bridge.func = () => scene.onBeforeCameraRenderObservable.notifyObservers(camera);
  fg.addTask(bridge);

  const render = new FrameGraphObjectRendererTask("render", fg, scene);
  render.targetTexture = clear.outputTexture;
  render.depthTexture = clear.outputDepthTexture;
  render.objectList = { meshes: scene.meshes, particleSystems: scene.particleSystems };
  render.camera = camera;
  render.shadowGenerators = [csmTask];
  render.disableImageProcessing = true;
  render.isMainObjectRenderer = true;
  render.resolveMSAADepth = true;
  fg.addTask(render);

  // Brücke 2: Himmel in den RenderingManager des Object Renderers zeichnen
  scene.onAfterRenderingGroupObservable.add((info) => {
    if (info.renderingManager === render.objectRenderer.renderingManager && info.renderingGroupId === atmosphere.skyRenderingGroup) {
      atmosphere.drawSkyCompositor();
    }
  });

  const volume = new FrameGraphLightingVolumeTask("lightingVolume", fg);
  volume.shadowGenerator = volumeShadow;
  volume.lightingVolume.frequency = engine.isWebGPU ? 1 : 4;
  volume.lightingVolume.tesselation = engine.isWebGPU ? 512 : 256;
  fg.addTask(volume);

  const shafts = new FrameGraphVolumetricLightingTask("volumetricLighting", fg, false); // Extinktion aus
  shafts.targetTexture = render.outputTexture;
  shafts.depthTexture = render.outputDepthTexture;
  shafts.camera = camera;
  shafts.lightingVolumeMesh = volume.outputMeshLightingVolume;
  shafts.light = sun;
  shafts.phaseG = 0.6;
  shafts.lightPower = new Color3(0.003, 0.0027, 0.0022);
  fg.addTask(shafts);

  const bloom = new FrameGraphBloomTask("bloom", fg, 0.25, 64, 1.0, true, 0.5);
  bloom.sourceTexture = shafts.outputTexture;
  fg.addTask(bloom);

  const imageProcessing = new FrameGraphImageProcessingTask("imageProcessing", fg);
  imageProcessing.sourceTexture = bloom.outputTexture;
  imageProcessing.postProcess.toneMappingEnabled = true;
  imageProcessing.postProcess.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  imageProcessing.postProcess.ditheringEnabled = true;
  fg.addTask(imageProcessing);

  const fxaa = new FrameGraphFXAATask("fxaa", fg);
  fxaa.sourceTexture = imageProcessing.outputTexture;
  fxaa.targetTexture = backbufferColorTextureHandle;
  fg.addTask(fxaa);

  engine.onResizeObservable.add(() => void fg.buildAsync(false)); // kein automatischer Neuaufbau bei Größenänderung
  await fg.buildAsync(false); // mit true (Standard) läuft die Atmosphäre in einen Timeout
  return fg;
}
```

- **Ortho-Box nachführen** (Prinzip): pro Frame `sun.position = volumeCenter − sun.direction ×
  250` mit `volumeCenter` an der Kamera; `lightPower` aus `sun.diffuse` skaliert nachführen.
- Tonemapping `TONEMAPPING_KHR_PBR_NEUTRAL`: über `imageProcessing.postProcess.toneMappingType`
  setzen; der Image-Processing-Task kennt ACES und KHR PBR Neutral.

## Node Render Graph (NRGE)

- Editor: https://nrge.babylonjs.com — FILE-Panel speichert `nodeRenderGraph.json` und erzeugt
  Code; SNIPPET-Panel speichert öffentlich auf dem Snippet-Server.
- Laden zur Laufzeit:

```ts
import { NodeRenderGraph } from "@babylonjs/core/FrameGraph/Node/nodeRenderGraph";
import type { NodeRenderGraphInputBlock } from "@babylonjs/core/FrameGraph/Node/Blocks/inputBlock";
import "@babylonjs/core/FrameGraph/Node/Blocks/index"; // registriert die Blockklassen für Parse

const json: unknown = await (await fetch(`${import.meta.env.BASE_URL}assets/graphs/outdoor.json`)).json();
const graph = NodeRenderGraph.Parse(json, scene, { autoFillExternalInputs: false });
graph.onBeforeBuildObservable.add(() => {
  // läuft auch bei Neuaufbauten nach Größenänderung
  graph.getBlockByName<NodeRenderGraphInputBlock>("Camera")!.value = camera;
  graph.getBlockByName<NodeRenderGraphInputBlock>("Object List")!.value = { meshes: scene.meshes, particleSystems: scene.particleSystems };
});
await graph.buildAsync(); // setzt scene.frameGraph
```

- Weitere API: `ParseFromSnippetAsync(id, scene, options?, existingGraph?, skipBuild = true)`,
  `CreateDefaultAsync(name, scene, options?)` (danach `scene.frameGraph = graph.frameGraph`),
  `buildAsync(dontBuildFrameGraph?, waitForReadiness?, setAsSceneFrameGraph = true)`,
  `serialize()`, `generateCode()`. Optionen: `rebuildGraphOnEngineResize` (true),
  `autoFillExternalInputs` (true, nimmt `scene.cameras[i]`).
- Ausgeliefert wird das JSON oder der erzeugte Code, keine Snippet-ID.
- Editor im Spiel (nur Dev): `NodeRenderGraphEditor.Show({ nodeRenderGraph, hostScene })` aus
  `@babylonjs/node-render-graph-editor` (bündelt Core und GUI).

## Weitere Punkte im Frame-Graph-Modus

- Ein von Hand gebauter Frame Graph baut sich bei Größenänderung nicht selbst neu auf; ein
  `NodeRenderGraph` schon.
- Skyboxen brauchen `camera.ignoreCameraMaxZ = true`; Mirror- und Refraction-Texturen gehören in
  `scene.customRenderTargets`.
- Der Inspector kann Pipelines in diesem Modus nicht einstellen.
- Doku und Playgrounds rufen teils `build()` auf; in 9.x gibt es nur `buildAsync()`.
