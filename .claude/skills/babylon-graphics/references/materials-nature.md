# Materialien und Natur

## Materialwahl

- **`PBRMaterial`** (`@babylonjs/core/Materials/PBR/pbrMaterial`): Standard für alles — stabil,
  WGSL nativ, `subSurface`, `sheen`, `clearCoat`, Material-Plugins, bekommt das
  Atmosphäre-Plugin und TAA-Jitter.
- **`PBRMetallicRoughnessMaterial`**: glTF-artige Teilmenge.
- **`OpenPBRMaterial`** (`@babylonjs/core/Materials/PBR/openpbrMaterial`): vorhanden, Status
  Alpha; bekommt das Atmosphäre-Plugin nicht. glTF-Loader-Option `useOpenPBR` ist experimentell.
- Licht und Umgebung: mit Atmosphäre liefert das Addon die diffuse IBL; ohne Atmosphäre `.env`
  per `CubeTexture.CreateFromPrefilteredData` (Datei-Erzeugung: Skill `babylon-assets`).

## Node Materials

- Bauen im Editor (https://nme.babylonjs.com) oder über das MCP `babylon-nme` (Graph anlegen,
  Blöcke verbinden, `validate_material`, als JSON exportieren). JSON mit dem Spiel ausliefern.
- Laden:
  - `NodeMaterial.ParseFromFileAsync(name, url, scene, rootUrl?, skipBuild?, targetMaterial?, urlRewriter?, options?)`
  - `NodeMaterial.Parse(json, scene, rootUrl?, shaderLanguage?)`
  - `NodeMaterial.ParseFromSnippetAsync(id, …)` nur für Prototypen.
  - Sprache mitgeben: `options.shaderLanguage = engine.isWebGPU ? ShaderLanguage.WGSL : ShaderLanguage.GLSL`
    (`@babylonjs/core/Materials/shaderLanguage`); sie steht nicht im JSON.
  - `import "@babylonjs/core/Materials/Node/Blocks/allBlocks";` — unbekannte Blöcke überspringt der
    Parser still.
- Node Materials bekommen keine Plugins (auch nicht das Atmosphäre-Plugin) und keinen TAA-Jitter.
  Für Luftperspektive auf Node-Gelände die Atmosphäre-Option `depthTexture` nutzen.
- `PBRMetallicRoughnessBlock` existiert; einen OpenPBR-Block gibt es nicht.

## ShaderMaterial in WGSL

Regeln: Code in `ShaderStore.ShadersStoreWGSL`, Option `shaderLanguage: ShaderLanguage.WGSL`;
keine `@group/@binding` schreiben; Eingänge als `vertexInputs.x` / `fragmentInputs.x`, eigene
Uniforms als `uniforms.x`; `var xSampler: sampler` paart sich automatisch mit der Textur `x`;
`meshUboDeclaration` definiert `WORLD_UBO`, Instanz-Defines und -Attribute kommen automatisch.

```ts
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";

ShaderStore.ShadersStoreWGSL["grassVertexShader"] = `
#include<sceneUboDeclaration>
#include<meshUboDeclaration>
#include<instancesDeclaration>
attribute position: vec3<f32>;
uniform time: f32;
@vertex fn main(input: VertexInputs) -> FragmentInputs {
  var positionUpdated = vertexInputs.position;
#include<instancesVertex>
  var worldPos = finalWorld * vec4<f32>(positionUpdated, 1.0);
  worldPos.x += sin(uniforms.time + worldPos.z) * 0.1 * positionUpdated.y;
  vertexOutputs.position = scene.viewProjection * worldPos;
}`;

const grass = new ShaderMaterial("grass", scene, { vertex: "grass", fragment: "grass" }, {
  attributes: ["position"],
  uniforms: ["time"],
  uniformBuffers: ["Scene", "Mesh"],
  shaderLanguage: ShaderLanguage.WGSL,
});
```

ShaderMaterial schreibt nicht in den Prepass (SSAO2/SSR sehen es nicht), bekommt kein
Atmosphäre-Plugin und keinen TAA-Jitter — für sichtbare Spielwelt-Flächen PBR mit Plugin oder
Node Material bevorzugen. Unter WebGL2 zusätzlich eine GLSL-Fassung in `ShaderStore.ShadersStore`.

## Wind auf PBR: MaterialPluginBase

- Konstruktor `(material, name, priority, defines?, addToPluginList?, enable?, resolveIncludes?)`.
- **`isCompatible` akzeptiert standardmäßig nur GLSL**; ein inkompatibles Plugin wirft unter
  WebGPU — überschreiben.
- Zeitabhängige Uniforms in `hardBindForSubMesh` setzen (läuft auch bei eingefrorenen Materialien).
- Der Code landet vor dem Marker `CUSTOM_VERTEX_UPDATE_WORLDPOS`, der Marker bleibt erhalten:
  `material.shadowDepthWrapper = new ShadowDepthWrapper(material, scene)`
  (`@babylonjs/core/Materials/shadowDepthWrapper`) lässt die Schatten mitschwingen.
- `#include<prePassVertex>` (berechnet `vViewPos`) läuft **vor** dem Marker — das Plugin muss
  `vPositionW` und `vViewPos` neu schreiben, sonst sehen SSAO2/SSR unverschobene Tiefe.

Entwurf (Struktur gegen die Typings geprüft, Shader-Code noch nicht kompiliert — beim Einbau
testen):

```ts
import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import type { Material } from "@babylonjs/core/Materials/material";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";

const windWgsl = `
#ifdef WIND_SWAY
let windBend = uniforms.windParams.y * positionUpdated.y * positionUpdated.y;
let windWave = sin(uniforms.windParams.x * 1.7 + dot(worldPos.xz, vec2f(0.21, 0.17)));
worldPos.x += uniforms.windParams.z * windWave * windBend;
worldPos.z += uniforms.windParams.w * windWave * windBend;
vertexOutputs.vPositionW = worldPos.xyz;
#ifdef PREPASS_DEPTH
vertexOutputs.vViewPos = (scene.view * worldPos).rgb;
#endif
#endif`;

const windGlsl = `
#ifdef WIND_SWAY
float windBend = windParams.y * positionUpdated.y * positionUpdated.y;
float windWave = sin(windParams.x * 1.7 + dot(worldPos.xz, vec2(0.21, 0.17)));
worldPos.xz += windParams.zw * windWave * windBend;
vPositionW = vec3(worldPos);
#ifdef PREPASS_DEPTH
vViewPos = (view * worldPos).rgb;
#endif
#endif`;

/** Biegt Halme und Blüten im Wind (Windanimation); lokales y = Höhe über der Wurzel. */
export class WindSwayPlugin extends MaterialPluginBase {
  public time = 0;
  public strength = 0.12;
  public directionX = 1;
  public directionZ = 0.3;

  public constructor(material: Material) {
    super(material, "WindSway", 200, { WIND_SWAY: false });
    this._enable(true);
  }

  public override getClassName(): string {
    return "WindSwayPlugin";
  }

  public override isCompatible(language: ShaderLanguage): boolean {
    return language === ShaderLanguage.GLSL || language === ShaderLanguage.WGSL;
  }

  public override prepareDefines(defines: MaterialDefines): void {
    defines["WIND_SWAY"] = true;
  }

  public override getUniforms(language?: ShaderLanguage) {
    const ubo = [{ name: "windParams", size: 4, type: "vec4" }];
    return language === ShaderLanguage.WGSL ? { ubo } : { ubo, vertex: "#ifdef WIND_SWAY\nuniform vec4 windParams;\n#endif\n" };
  }

  public override hardBindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat4("windParams", this.time, this.strength, this.directionX, this.directionZ);
  }

  public override getCustomCode(shaderType: string, language?: ShaderLanguage) {
    if (shaderType !== "vertex") {
      return null;
    }
    return { CUSTOM_VERTEX_UPDATE_WORLDPOS: language === ShaderLanguage.WGSL ? windWgsl : windGlsl };
  }
}
// Zeit fortschreiben: scene.onBeforeRenderObservable.add(() => { wind.time += scene.getEngine().getDeltaTime() / 1000; });
```

## Blätter und Blüten (subSurface)

- Durchscheinen: `subSurface.isTranslucencyEnabled`, `translucencyIntensity` (1),
  `translucencyColor` (sonst `tintColor`), `translucencyColorTexture`,
  `translucencyIntensityTexture`.
- Dicke: `thicknessTexture`, `minimumThickness`/`maximumThickness` (Dicke = min + t·(max−min)),
  `useMaskFromThicknessTexture`.
- `isScatteringEnabled` braucht `scene.enableSubSurfaceForPrePass()` und den Import
  `@babylonjs/core/Rendering/subSurfaceSceneComponent` (zusätzlicher Pass).
- Alpha-Ausschnitt: `albedoTexture.hasAlpha = true`, `useAlphaFromAlbedoTexture = true`,
  `transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST`; `alphaCutOff` ist ein Define (Ändern
  kompiliert neu). Dazu `backFaceCulling = false`, `twoSidedLighting = true`.
- Startwerte: `roughness` 0,6, `translucencyIntensity` 0,6–0,9, `translucencyColor` ≈
  (0,55; 0,8; 0,2), `maximumThickness` 0,3.

## Gras- und Blumenfelder (Thin Instances in Kacheln)

```ts
import "@babylonjs/core/Meshes/thinInstanceMesh"; // Pflicht, sonst stille Platzhalter
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { GroundMesh } from "@babylonjs/core/Meshes/groundMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";

/** Baut eine Wiesenkachel aus Thin Instances (Wiesenkachel). */
export function buildGrassTile(blade: Mesh, ground: GroundMesh, x0: number, z0: number, size: number, count: number, random: () => number): Mesh {
  const tile = blade.clone(`grass_${x0}_${z0}`);
  tile.makeGeometryUnique(); // Instanzpuffer liegen in der Geometrie
  const matrices = new Float32Array(count * 16);
  const rotation = new Quaternion();
  const scale = new Vector3();
  const position = new Vector3();
  const matrix = new Matrix();
  for (let index = 0; index < count; index++) {
    position.set(x0 + random() * size, 0, z0 + random() * size);
    position.y = ground.getHeightAtCoordinates(position.x, position.z);
    Quaternion.RotationYawPitchRollToRef(random() * Math.PI * 2, 0, 0, rotation);
    scale.set(1, 0.7 + random() * 0.6, 1);
    Matrix.ComposeToRef(scale, rotation, position, matrix).copyToArray(matrices, index * 16);
  }
  tile.thinInstanceSetBuffer("matrix", matrices, 16, true);
  tile.cullingStrategy = AbstractMesh.CULLINGSTRATEGY_OPTIMISTIC_INCLUSION_THEN_BSPHERE_ONLY;
  tile.freezeWorldMatrix();
  return tile;
}
```

- `blade` (Halm, Blume) stammt aus einem fertigen glb (Skill `babylon-modeling`); zur Laufzeit
  entstehen nur die Platzierungsmatrizen.
- Culling gilt je Mesh — deshalb Kacheln. Pufferarten: `"matrix"`, `"previousMatrix"`,
  `"color"` (→ `instanceColor`, multipliziert Albedo und Alpha); eigene über
  `thinInstanceRegisterAttribute`.
- `thinInstanceCount = 0` rendert das Basis-Mesh einmal; Kachel ausblenden mit
  `setEnabled(false)`.
- `addLODLevel` greift nicht für Thin Instances: Je Kachel `thinInstanceCount` auf einem
  vorab gemischten Puffer senken oder je LOD ein eigenes Mesh.
- `ScenePerformancePriority.Aggressive` setzt `alwaysSelectAsActiveMesh` und
  `skipFrustumClipping` — das hebelt das Kachel-Culling aus.
- Zufall über den seedbaren Generator des Spiels (reproduzierbare Felder).

## Bäume

- Hunderte Bäume: `InstancedMesh` (`createInstance`, Import `@babylonjs/core/Meshes/instancedMesh`)
  — Culling je Instanz, das LOD des Quell-Meshes gilt für alle Instanzen. Zehntausende
  Kleinobjekte: Thin Instances.
- LOD: `addLODLevel(distanceOrCoverage, mesh | null)`; mit `useLODScreenCoverage` Werte 0..1
  (größer = detaillierter). Eingebaute Impostors gibt es nicht — letzte Stufe als Quad mit
  `billboardMode = Mesh.BILLBOARDMODE_Y`.
- LOD-Meshes offline erzeugen (Skills `babylon-modeling` und `babylon-assets`); glTF `MSFT_lod` steuert progressives
  Laden, kein Distanz-Umschalten.

## Gelände

- `CreateGroundFromHeightMap(name, url | { data, width, height }, { width, height, subdivisions, minHeight, maxHeight, colorFilter, alphaFilter, updatable, onReady, onError, passHeightBufferInCallback }, scene)`
  aus `@babylonjs/core/Meshes/Builders/groundBuilder`.
- 8-bit-Graustufen ergeben ~256 Stufen (Terrassen). 16 bit: R = High-Byte, G = Low-Byte mit
  `colorFilter = new Color3(0.99611, 0.0038911, 0)`.
- `getHeightAtCoordinates` / `getNormalAtCoordinates` nehmen Weltkoordinaten.
- Texturmischung per Node Material oder PBR-Plugin; `TerrainMaterial` und `MixMaterial` aus
  `@babylonjs/materials` sind Blinn-Phong ohne IBL und passen nicht zu PBR. Die
  `DynamicTerrain`-Erweiterung ist UMD-only und wird nicht gepflegt.

## Wasser

- `new WaterMaterial(name, scene, renderTargetSize = 512², forceGLSL = false)` aus
  `@babylonjs/materials/water/waterMaterial`; WGSL nativ seit 9.5. Standardwerte: `windForce` 6,
  `waveHeight` 0,4, `bumpHeight` 0,4, `waveLength` 0,1, `colorBlendFactor` 0,2.
  `addToRenderList(mesh)` — zwei Render-Targets rendern die Liste erneut, Liste klein halten.
- Mit Atmosphäre fehlt der Himmel in jeder Spiegelung (siehe `sky-light-shadows.md`) — Wasser
  braucht eine eigene Himmelsquelle (Sky-View-LUT im Shader oder gebackene SkyMaterial-Probe).
- Alternativen: NME-Ozean (Playground `#9B0DNU#36`), PBR mit animierter Normal Map plus SSR.
- Wasser in Rendering-Gruppe 1 (Himmels-Composite).
