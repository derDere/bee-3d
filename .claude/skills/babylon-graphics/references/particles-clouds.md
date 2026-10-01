# Partikel und Wolken

## Partikel

- **CPU:** `new ParticleSystem(name, capacity, sceneOrEngine, customEffect?, isAnimationSheetEnabled?, epsilon?, noUpdateQueue?)`.
- **GPU:** `new GPUParticleSystem(name, { capacity, randomTextureSize, emitRateControl = false, maxAttractors = 8 }, sceneOrEngine)`
  — braucht die Imports `@babylonjs/core/Particles/webgl2ParticleSystem` und
  `@babylonjs/core/Particles/computeShaderParticleSystem`, sonst Fehler. Unterstützt Rauschen,
  Flow Map, Attraktoren und die meisten Gradienten; keine Sub-Emitter, Ramp-/Remap-Gradienten oder
  eigenen Funktionen. Umwandlung: `GPUParticleSystem.fromParticleSystem(cpu, scene)`.
- Lebensdauern laufen in Update-Ticks (× `updateSpeed` 0,01 × Animationsrate), nicht in Sekunden;
  `emitRate` ebenso.
- Partikel schreiben keine Tiefe. Mit Atmosphäre und transparentem Wasser in Rendering-Gruppe 1.
- **Helfer:** `ParticleHelper.CreateAsync(type, scene, gpu?, capacity?)` mit `explosion`, `fire`,
  `rain`, `smoke`, `sun`; Laden gespeicherter Systeme über `ParticleHelper.ParseFromFileAsync` /
  `ParseFromSnippetAsync`.
- **Node Particle Editor** (https://npe.babylonjs.com, MCP `babylon-npe`): `NodeParticleSystemSet`
  (`@babylonjs/core/Particles/Node/nodeParticleSystemSet`) mit `ParseFromFileAsync(name, url)`,
  `Parse(json)`, dann `buildAsync(scene)` → `ParticleSystemSet` → `.start(emitter)`. Erzeugt nur
  CPU-Systeme. Blöcke registrieren: `import "@babylonjs/core/Particles/Node/Blocks/index";`.
- **Attraktoren** (`@babylonjs/core/Particles/attractor`): `new Attractor()`, `.position`,
  `.strength` (negativ = abstoßen); `ps.addAttractor()` auf CPU und GPU.
- **Flow Maps** (`@babylonjs/core/Particles/flowMap`) sind bildschirmausgerichtet — für Wind in der
  Wiese Rauschen verwenden.
- **Weiche Partikel** sind nicht eingebaut (Eigenbau mit Depth Renderer und eigenem Effekt).

### Pollen und Staub im Sonnenlicht

```ts
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { NoiseProceduralTexture } from "@babylonjs/core/Materials/Textures/Procedurals/noiseProceduralTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

const pollen = new ParticleSystem("pollen", 3000, scene);
pollen.particleTexture = new Texture(`${import.meta.env.BASE_URL}assets/textures/mote.png`, scene);
pollen.emitter = pollenAnchor; // leerer Knoten, folgt der Kamera
pollen.createBoxEmitter(new Vector3(-0.05, 0.02, -0.05), new Vector3(0.05, 0.08, 0.05), new Vector3(-15, 0.3, -15), new Vector3(15, 6, 15));
pollen.emitRate = 250;
pollen.minLifeTime = 6;
pollen.maxLifeTime = 10;
pollen.minSize = 0.015;
pollen.maxSize = 0.04;
pollen.gravity = new Vector3(0, -0.01, 0);
pollen.addColorGradient(0, new Color4(1, 0.95, 0.8, 0));
pollen.addColorGradient(0.2, new Color4(1.6, 1.45, 1.1, 0.5)); // > 1 → trifft den Bloom der HDR-Kette
pollen.addColorGradient(1, new Color4(1, 0.9, 0.7, 0));
pollen.blendMode = ParticleSystem.BLENDMODE_ADD;
pollen.noiseTexture = new NoiseProceduralTexture("pollenNoise", 256, scene);
pollen.noiseStrength = new Vector3(0.4, 0.15, 0.4);
pollen.preWarmCycles = 120;
pollen.renderingGroupId = 1;
pollen.start();
```

## Wolken

**Nichts eingebaut.** Optionen nach Aufwand:

| Ansatz | Bewertung |
|---|---|
| Wolken in der Himmelstextur bzw. ein Wolken-Dome mit Node Material (`CloudBlock`, fBm) | günstig, statisch wirkend; WGSL über Node Material |
| Geschichtete Billboards / Sprites (Community-Playground `#1G2LLJ#108`) | gut für stilisierte Szenen, bewegt sich mit Parallaxe |
| `CloudProceduralTexture` (`@babylonjs/procedural-textures/cloud/cloudProceduralTexture`) | 2D-fBm, **nur GLSL** → lädt unter WebGPU glslang/twgsl vom CDN |
| Eigener Raymarch-Post-Process | echte Volumenwolken mit Licht und Schatten; Aufwand und GPU-Kosten hoch |

`SkyMaterial.cloudiness` weicht nur die Sonne auf. Community-Beispiel `#MAONNT#13`
(Volumenwolken im SkyMaterial) steht unter CC-BY-NC-SA — nicht übernehmen.

### Raymarch-Post-Process (Gerüst)

APIs gegen die Typings geprüft; die Raymarch-Mathematik ist zu schreiben und zu testen.

```ts
import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess";
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import { RawTexture3D } from "@babylonjs/core/Materials/Textures/rawTexture3D";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Rendering/depthRendererSceneComponent"; // scene.enableDepthRenderer

ShaderStore.ShadersStore["cloudsFragmentShader"] = `precision highp float; precision highp sampler3D;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D depthSampler; // Kamera-Z in Metern, 0 = Himmel
uniform sampler3D noiseSampler;
uniform vec3 sunDirection;
void main(void) { vec4 scene = texture2D(textureSampler, vUV); /* Raymarch */ gl_FragColor = scene; }`;

ShaderStore.ShadersStoreWGSL["cloudsFragmentShader"] = `varying vUV: vec2f;
var textureSamplerSampler: sampler;
var textureSampler: texture_2d<f32>;
var depthSamplerSampler: sampler;
var depthSampler: texture_2d<f32>;
var noiseSamplerSampler: sampler;
var noiseSampler: texture_3d<f32>;
uniform sunDirection: vec3f;
@fragment fn main(input: FragmentInputs) -> FragmentOutputs {
  fragmentOutputs.color = textureSample(textureSampler, textureSamplerSampler, input.vUV);
}`;

// storeCameraSpaceZ: funktioniert mit camera.maxZ = 0
const depth = scene.enableDepthRenderer(camera, false, true, undefined, true);
const noise = new RawTexture3D(noiseData, 64, 64, 64, Constants.TEXTUREFORMAT_R, scene, false, false,
  Constants.TEXTURE_BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
noise.wrapU = Constants.TEXTURE_WRAP_ADDRESSMODE;
noise.wrapV = Constants.TEXTURE_WRAP_ADDRESSMODE;
noise.wrapR = Constants.TEXTURE_WRAP_ADDRESSMODE;
const clouds = new PostProcess("clouds", "clouds", {
  uniforms: ["sunDirection"],
  samplers: ["depthSampler", "noiseSampler"],
  camera: null,
  engine,
  textureType: Constants.TEXTURETYPE_HALF_FLOAT,
  shaderLanguage: engine.isWebGPU ? ShaderLanguage.WGSL : ShaderLanguage.GLSL,
});
camera.attachPostProcess(clouds, 0); // vor die DRP-Kette: HDR, vor dem Tonemapping
clouds.samples = 4; // die Szene rendert in den Eingang dieses ersten Post-Process
clouds.onApply = (effect) => {
  effect.setTexture("depthSampler", depth.getDepthMap());
  effect.setTexture("noiseSampler", noise);
  effect.setVector3("sunDirection", sun.direction);
};
```

- **Tiefe:** `storeCameraSpaceZ` schreibt die Kamera-Z in Metern, 0 für den Himmel. Der
  linear-normalisierte Modus versagt mit `maxZ = 0`.
- **Kamera-Uniforms:** `camera.globalPosition`, Basisvektoren und FOV übergeben (robust über GL und
  WebGPU) oder inverse Matrizen. Die `vUV`-Orientierung einmal mit einem Verlaufstest prüfen.
- **Halbe Auflösung und zeitliche Akkumulation:** Die Eingangsgröße eines Kamera-Post-Process ist
  die Ausgabegröße des vorherigen Passes. Deshalb die Wolken mit `EffectRenderer`/`EffectWrapper`
  in ein eigenes `RenderTargetTexture`-Paar (Ping-Pong) in halber Auflösung rendern und in voller
  Auflösung mischen (`Effect.setTextureFromPostProcess()` /
  `setTextureFromPostProcessOutput()`). Die Atmosphäre nutzt dasselbe Muster für ihre LUTs.
- **Im Frame Graph:** von `FrameGraphPostProcessTask` ableiten und die Tiefe per
  `context.bindTextureHandle(this._postProcessDrawWrapper.effect!, "depthSampler", depthHandle)`
  plus `pass.addDependencies(depthHandle)` binden; Verlaufstexturen über
  `createRenderTargetTexture({ …, isHistoryTexture: true })`.
- **Wolkenschatten:** `projectionTexture` gibt es nur an SpotLights — für Wolkenschatten auf dem
  Boden ein Material-Plugin, das die Wolkendichte entlang der Sonnenrichtung abtastet.
- Licht der Wolken über die Sonnenfarbe der Atmosphäre (`sun.diffuse`) und die Himmelsstrahlung
  (`scene.ambientColor`) speisen, damit sie zur Tageszeit passen.
