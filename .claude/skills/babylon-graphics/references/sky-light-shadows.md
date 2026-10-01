# Himmel, Licht, Schatten, Nebel

## Engine-Voraussetzungen

- `WebGPUEngine` mit `enableAllFeatures: true` (und `setMaximumLimits: true`): erst damit gibt
  es Dual-Source-Blending (Extinktion der Volumetrie), `float32-filterable` (32-bit-Tiefe im
  Prepass), Texturkompression und `timestamp-query`.
- Compute-Shader-Funktionen (Lighting Volume) brauchen unter WebGPU
  `import "@babylonjs/core/Engines/WebGPU/Extensions/engine.computeShader";`.
- GLSL-only-Shader unter WebGPU laden glslang/twgsl vom CDN (`initAsync(glslangOptions,
  twgslOptions)` erlaubt Selbsthosting) — eigene Shader in WGSL schreiben.

## Atmosphäre-Addon

```ts
import { Atmosphere, AtmospherePhysicalProperties } from "@babylonjs/addons/atmosphere";
```

- **Konstruktor:** `new Atmosphere(name, scene, lights: DirectionalLight[], options?)`. Wirft, wenn
  nicht genau ein Licht übergeben wird, und unter WebGL1. Vorher `Atmosphere.IsSupported(engine)`
  prüfen. Das Licht muss das **erste Licht der Szene** sein (das Plugin nutzt fest `light0`).
- **Status:** `@experimental`.

### Optionen (zugleich Laufzeit-Eigenschaften)

| Option | Standard | Hinweis |
|---|---|---|
| `isLinearSpaceLight` | false | für PBR auf `true` |
| `isLinearSpaceComposition` | false | für HDR-Ziele / Image Processing im Post-Process auf `true` |
| `exposure` | 1 | |
| `applyApproximateTransmittance` | true | |
| `isSkyViewLutEnabled` / `isAerialPerspectiveLutEnabled` | true / true | `false` = Raymarching pro Pixel (teuer) |
| `aerialPerspectiveIntensity` / `…TransmittanceScale` / `…Saturation` / `…RadianceBias` | 1 / 1 / 1 / 0 | Dunst in der Ferne |
| `isDiffuseSkyIrradianceLutEnabled` | true | nur beim Erzeugen setzbar |
| `diffuseSkyIrradianceDesaturationFactor` / `diffuseSkyIrradianceIntensity` | 0,5 / 1 | |
| `additionalDiffuseSkyIrradianceIntensity` / `…Color` | 0,01 / (163,199,255)/255 | |
| `multiScatteringIntensity` | 1 | |
| `minimumMultiScatteringColor` / `…Intensity` | (30,40,77)/255 / 0,000618 | offizielle Beispiele: 0,1 für die Nacht |
| `groundAlbedo` | (124,165,255)/255 | |
| `originHeight` | 0 | in **km** |
| `physicalProperties` | — | `AtmospherePhysicalProperties` |
| `depthTexture` | — | für Nicht-PBR-Materialien (siehe unten) |

### Physikalische Eigenschaften

`new AtmospherePhysicalProperties({ … })` — Distanzen in km, Koeffizienten pro km:
`planetRadius` 6360, `planetRadiusOffset` 0,01, `atmosphereThickness` 100,
`rayleighScatteringScale` 1 (× `peakRayleighScattering`), `mieScatteringScale`
(× `peakMieScattering` 0,003996), `mieAbsorptionScale`, `ozoneAbsorptionScale`. Jede Änderung
rendert die Transmissions-LUT neu.

### Einheiten und Ursprung

Welteinheiten sind Meter (Kameraposition × 0,001 → km). Ohne Floating Origin liegt Welt-y = 0 auf
der Planetenoberfläche plus `originHeight`. `scene.floatingOriginMode` behandelt den Ursprung als
Planetenmittelpunkt — für eine flache Spielwelt nicht einschalten.

### Laufzeitverhalten

- **Globale LUTs** (Transmission, Mehrfachstreuung, diffuse Himmelsstrahlung mit
  GPU→CPU-Readback) werden nur bei Eigenschaftsänderungen neu gerendert. Die Setter von
  `multiScattering*`, `minimumMultiScattering*` und `diffuseSkyIrradiance*` lösen Neurendern plus
  Readback aus — nicht pro Frame animieren.
- **Pro Kamera und Frame:** Sky-View-LUT (128²), Aerial-Perspective-LUT (16×64×32, 4 km je
  Schicht, 128 km Reichweite); `sun.diffuse`/`specular` werden mit der Transmissionsfarbe
  überschrieben, `scene.ambientColor` mit der Himmelsstrahlung.
- **Himmel:** Vollbild-Dreieck nach Rendering-Gruppe 0, Tiefentest `EQUAL` 1, vormultipliziertes
  „over"-Blending.

### PBR-Integration

- Ein globales Material-Plugin hängt sich nur an **`PBRMaterial`s, die nach der Atmosphäre
  erzeugt werden** — OpenPBR-, Node- und Standard-Materialien bekommen es nicht. Ablauf:
  Atmosphäre anlegen → `await atmosphere.preloadMaterialPluginShaderIncludesAsync()` → Assets
  laden.
- Das Plugin ersetzt die Farbe von `light0` durch die Transmission, nimmt die diffuse IBL aus der
  LUT (setzt `scene.environmentTexture` auf diese LUT) und wendet die Luftperspektive an
  (solange die Aerial-Perspective-LUT aktiv ist).
- **Keine Himmelsspiegelung:** Spekulare Strahlung = Irradianz. Reflection Probes und Mirror-
  Texturen enthalten den Himmel nicht. Für Wasser oder Metall: `atmosphere.skyViewLutRenderTarget`
  in einem eigenen Shader samplen oder eine aus `SkyMaterial` gebackene Probe als
  `reflectionTexture` setzen.
- **Nicht-PBR-Gelände** (z. B. Node Material): Option `depthTexture` (nichtlineare Tiefe im
  Rotkanal, `camera.maxZ = 0`) — der Luftperspektiven-Compositor läuft dann als Vollbild-Pass.

### Tageszeit und Sonnenscheibe

- Tageszeit: nur `sun.direction` drehen (zeigt von der Sonne zur Szene). `intensity = Math.PI`
  bleibt; die Farbe liefert die Atmosphäre. Offizielles Beispiel: Playground `#K1Y1Q8#90`.
- Eine Sonnenscheibe zeichnet das Addon nicht. Eigenes Billboard verwenden — es dient zugleich
  als Quelle der Bildschirm-Lichtstrahlen. `StandardMaterial` klemmt die Ausgabe auf 1; soll die
  Scheibe blühen, ein emissives `PBRMaterial` nehmen.
- Längere Dämmerung und mehr Leuchten um die Sonne: `peakMieScattering` anheben (Forum-Beispiel
  `#K1Y1Q8#96`, Wert ≈ 0,2).

Weitere offizielle Beispiele: `#K1Y1Q8#82` (Standard und Globus), `#94` (PBR), `#83`–`#87`
(Parameter, volles Raymarching).

## Standard-Stack (Code)

Getestet als UMD-Äquivalent auf WebGPU und WebGL2; Importe gegen die Typings geprüft.

```ts
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { Scene } from "@babylonjs/core/scene";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { VolumetricLightScatteringPostProcess } from "@babylonjs/core/PostProcesses/volumetricLightScatteringPostProcess";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Atmosphere, AtmospherePhysicalProperties } from "@babylonjs/addons/atmosphere";

/** Bausteine der Außenbeleuchtung (Außenbeleuchtung). */
export interface OutdoorLighting {
  readonly sun: DirectionalLight;
  readonly atmosphere: Atmosphere;
  readonly shadows: CascadedShadowGenerator;
  readonly pipeline: DefaultRenderingPipeline;
  readonly godRays: VolumetricLightScatteringPostProcess;
}

/** Baut Himmel, Sonne, Schatten und Post-Processing auf; vor allen Materialien aufrufen. */
export async function createOutdoorLightingAsync(scene: Scene, camera: Camera, getHours: () => number): Promise<OutdoorLighting> {
  const engine = scene.getEngine();
  scene.clearColor = new Color4(0, 0, 0, 1);
  camera.minZ = 0.1;
  camera.maxZ = 0; // unendliche Fernebene wie in den offiziellen Atmosphäre-Beispielen

  const sun = new DirectionalLight("sun", new Vector3(0, -1, 0), scene); // muss das erste Licht sein
  sun.intensity = Math.PI; // hebt den 1/PI-Faktor der PBR-Diffusion auf

  const atmosphere = new Atmosphere("atmosphere", scene, [sun], {
    isLinearSpaceLight: true,
    isLinearSpaceComposition: true,
    minimumMultiScatteringIntensity: 0.1,
    physicalProperties: new AtmospherePhysicalProperties({ mieScatteringScale: 2 }),
  });
  await atmosphere.preloadMaterialPluginShaderIncludesAsync();

  const shadows = new CascadedShadowGenerator(2048, sun, undefined, camera);
  shadows.shadowMaxZ = 400; // Pflicht bei camera.maxZ = 0
  shadows.lambda = 0.85;
  shadows.cascadeBlendPercentage = 0.05;
  shadows.stabilizeCascades = true;
  shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  shadows.bias = 0.002;
  shadows.normalBias = 0.02;

  const pipeline = new DefaultRenderingPipeline("post", true, scene, [camera]);
  pipeline.samples = 4;
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 1.0;
  pipeline.bloomWeight = 0.25;
  const imageProcessing = scene.imageProcessingConfiguration; // überlebt Pipeline-Neuaufbauten
  imageProcessing.toneMappingEnabled = true;
  imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL; // filmischer: TONEMAPPING_ACES
  imageProcessing.ditheringEnabled = true; // gegen Banding im Himmelsverlauf

  const sunMaterial = new StandardMaterial("sunDisc", scene);
  sunMaterial.disableLighting = true;
  const sunDisc = CreatePlane("sunDisc", { size: 35 }, scene); // runde Textur mit Alpha verwenden
  sunDisc.material = sunMaterial;
  sunDisc.billboardMode = Mesh.BILLBOARDMODE_ALL;
  const godRays = new VolumetricLightScatteringPostProcess("godRays", 1.0, camera, sunDisc, 100, Texture.BILINEAR_SAMPLINGMODE, engine, false);
  godRays.exposure = 0.25;
  godRays.decay = 0.97;

  const toSun = new Vector3();
  scene.onBeforeRenderObservable.add(() => {
    const elevation = ((getHours() - 6) / 12) * Math.PI; // 6 h Aufgang, 12 h Zenit, 18 h Untergang
    toSun.set(Math.cos(elevation) * 0.95, Math.sin(elevation), Math.cos(elevation) * 0.31);
    toSun.negateToRef(sun.direction); // Licht zeigt von der Sonne weg
    sun.shadowEnabled = toSun.y > -0.05; // nachts keine Schattenpässe
    toSun.scaleToRef(2000, sunDisc.position).addInPlace(camera.globalPosition);
    sunMaterial.emissiveColor.copyFrom(sun.diffuse); // Transmissionsfarbe der Atmosphäre
  });

  return { sun, atmosphere, shadows, pipeline, godRays };
}
```

- Getestete Reihenfolge: Default-Pipeline vor den Lichtstrahlen erzeugt — die Strahlen liegen
  dann über dem tonegemappten Bild. Die umgekehrte Reihenfolge (Strahlen durch Bloom und
  Tonemapping) im Look-Dev vergleichen.
- Schattenwerfer: `shadows.addShadowCaster(mesh, true)`, Empfänger `mesh.receiveShadows = true`.
- Transparentes in Rendering-Gruppe 1: `mesh.renderingGroupId = 1` und
  `scene.setRenderingAutoClearDepthStencil(1, false, false, false)`.

## Ohne Atmosphäre: SkyMaterial oder HDRI

- **`SkyMaterial`** (`@babylonjs/materials/sky/skyMaterial`, WGSL vorhanden): Himmel als Mesh,
  funktioniert in Reflection Probes und im Frame Graph (Skybox dort mit
  `camera.ignoreCameraMaxZ = true`). Keine Luftperspektive — Horizont über Szenennebel angleichen.
  Neu in 9.x: `cloudiness` (weicht nur die Sonne auf), `rawHdrOutput`, `dithering`, `up`.
  Wertebereiche laut Typings: `luminance` ]0,1[, `inclination` [−0,5; 0,5].
- **HDRI-Umgebung:**
  ```ts
  import { CubeTexture } from "@babylonjs/core/Materials/Textures/cubeTexture";
  import "@babylonjs/core/Helpers/sceneHelpers";

  const environment = CubeTexture.CreateFromPrefilteredData(`${import.meta.env.BASE_URL}assets/env/meadow.env`, scene);
  scene.environmentTexture = environment;
  environment.rotationY = Math.PI / 3; // Sonne im HDRI zur DirectionalLight ausrichten
  scene.iblIntensity = 1.0;
  scene.createDefaultSkybox(environment, true, 1000, 0); // (Textur, PBR, Größe, Unschärfe)
  ```

## Kaskaden-Schatten

- **Standardwerte:** `numCascades` 4 (2–4), `lambda` 0,5, `cascadeBlendPercentage` 0,1,
  `stabilizeCascades` false, `depthClamp` true (mit PCSS ignoriert), `autoCalcDepthBounds` false,
  PCF an, `filteringQuality` HIGH, `bias` 5e-5, `normalBias` 0.
- **Große Außenszene:** `new CascadedShadowGenerator(2048, sun, undefined, camera)` (4096 auf
  Desktop-WebGPU), `shadowMaxZ` 250–500 m, `lambda` 0,7–0,9, Blend 0,05, `stabilizeCascades =
  true`, `QUALITY_MEDIUM`, PCSS nur auf Desktop. `bias` ≈ 0,001–0,005 und `normalBias` ≈
  0,01–0,03 abstimmen; ggf. `forceBackFacesOnly`.
- **`shadowMaxZ` setzen**, wenn `camera.maxZ = 0` — der Splitter nutzt `camera.maxZ ||
  shadowMaxZ`.
- `autoCalcDepthBounds` passt nicht zur unendlichen Fernebene (der Depth Renderer normalisiert
  über `maxZ`).
- Nach Änderung von `minZ`/`maxZ`: `splitFrustum()`.
- Kein Culling je Kaskade; die Werferliste über `getShadowMap().getCustomRenderList` steuern.
- **IBL-Shadows** (`IblShadowsRenderPipeline`, `@babylonjs/core/Rendering/IBLShadows/iblShadowsRenderPipeline`):
  Voxel-Tracing der Umgebungstextur, statische Werfer, ≤ 256³ Voxel — für Außenszenen im
  Kilometermaßstab mit Atmosphäre ungeeignet; dort CSM + SSAO2.

## Nebel und Dunst

- **Szenennebel:** `scene.fogMode` (`Scene.FOGMODE_EXP`, `FOGMODE_EXP2`, `FOGMODE_LINEAR`),
  `fogDensity`, `fogStart`/`fogEnd`, `fogColor` — wirkt auf Meshes inklusive PBR, und zwar nach
  der Luftperspektive des Plugins. Der Atmosphäre-Himmel bleibt ungenebelt (Horizontbruch).
- **Physikalischer Dunst** über die Atmosphäre: `mieScatteringScale`,
  `aerialPerspectiveIntensity`/`Saturation`/`RadianceBias`. Für Sichtweiten von wenigen
  Kilometern anheben, da die Luftperspektive in 4-km-Schichten arbeitet.
- **Höhennebel oder volumetrischer Nebel** sind nicht eingebaut. Eigenbau: Material-Plugin am
  Marker `CUSTOM_FRAGMENT_BEFORE_FOG` oder tiefenbasierter Post-Process. Die
  Frame-Graph-Volumetrie mit Extinktion erzeugt homogenen Nebel über den ganzen Bildschirm.
