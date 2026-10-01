---
name: babylon-performance
description: Leistung von Babylon.js-Spielen messen und optimieren — Budgets, Messprotokoll (Profil-Build, Debug-API, GPU-Zeit per timestamp-query, Chrome-Trace, Inspector-CLI), CPU- oder GPU-Grenze erkennen, Qualitätsstufen und dynamische Auflösung, Optimierungskatalog (Thin Instances, Instances, LOD, Einfrieren, performancePriority, Snapshot-Rendering, Occlusion Queries, Texturkompression, Shader-Vorkompilierung). Laden bei Ruckeln, vor Abnahmen, beim Festlegen von Qualitätsstufen oder wenn Szenen wachsen.
---

# Leistung messen und optimieren

## Budgets

Richtwerte — Babylon nennt keine festen Zahlen; die Spec legt Zielgeräte und Framerate fest,
die Messung am Zielgerät entscheidet.

| Größe | Desktop, integrierte GPU der Mittelklasse | Mobilgerät |
|---|---|---|
| Frame-Zeit | 16,6 ms (60 fps) | 16,6–33 ms (60–30 fps) |
| Draw Calls | bis ~1.000 | 100–300 |
| Sichtbare Dreiecke | 1–3 Mio. | 100–500 Tsd. |
| Texturspeicher (komprimiert) | bis ~1 GB | bis ~256 MB |

Der Entwicklungsrechner mit integrierter Intel-Arc-GPU ist ein guter Mittelklasse-Bezug.

## Messprotokoll

1. **Build:** Profil-Build (`npm run build:profile`, dann `npm run preview`,
   `http://127.0.0.1:4173/`). Zahlen aus dem Dev-Server sind nur Tendenzen (unminifiziert, HMR).
2. **Durchführung:** Agent `babylon-perf-profiler` beauftragen — mit URL, Szenario und
   Budget. Nie parallel zu einem visuellen Review im selben Browser.
3. **Gleiche Bedingungen:** fester Viewport (1280×720; Full-HD-Gegenprobe per
   `resize_page` 1920×1080), feste Qualitätsstufe (`setQuality`), gleicher Kamerapunkt.
4. **Aufwärmen:** 3 s laufen lassen (Shader-Kompilierung, Nachladen), dann `measure(10)`.
5. **Diagnose:**
   - **GPU-gebunden:** `avgGpuFrameMs` liegt nahe an der Frame-Zeit; höheres
     Hardware-Scaling (`engine.setHardwareScalingLevel(1.5)`) oder kleinerer Viewport senkt die
     Frame-Zeit deutlich.
   - **CPU-gebunden:** `cpuFrameTimeMs` hoch, GPU-Zeit niedrig; Auflösung ändert wenig;
     Draw Calls oder aktive Meshes hoch; CPU-Drosselung (`emulate`, `cpuThrottlingRate: 4`)
     verschlechtert stark.
   - **Ausreißer** (p99 ≫ p50): Shader-Kompilierung
     (`EngineInstrumentation.captureShaderCompilationTime`), Garbage Collection, Nachladen,
     Physik.
6. **CPU-Hotspots:** Chrome-Trace (`performance_start_trace` mit `reload: false`,
   `autoStop: false`; Szenario laufen lassen; `performance_stop_trace`).
7. **Gegenprobe:** Inspector-CLI `start-perf-instrumentation`, dann `get-frame-stats`
   (Skill `babylon-visual-qa`).

Headless-Chrome taugt für Vergleiche (vorher/nachher, Stufe A/B). Die gefühlte Flüssigkeit
beurteilt der User im eigenen Browser — Übergabe mit URL, Qualitätsstufe und Hinweis, worauf
zu achten ist.

## Messgrößen in Babylon

| Größe | Quelle |
|---|---|
| GPU-Zeit je Frame | `EngineInstrumentation.captureGPUFrameTime = true` → `gpuFrameTimeCounter` (**Nanosekunden**). WebGPU braucht `timestamp-query` (Engine-Option `enableAllFeatures`), WebGL die Timer-Imports (Skill `babylon-game-dev`). |
| CPU-Zeit je Frame | `SceneInstrumentation.captureFrameTime` → `frameTimeCounter` (ms); dazu `captureRenderTime`, `captureActiveMeshesEvaluationTime`, `capturePhysicsTime`, `captureAnimationsTime`, `captureRenderTargetsRenderTime`, `captureParticlesRenderTime` |
| Draw Calls | `SceneInstrumentation.drawCallsCounter` |
| Szene | `scene.getActiveMeshes().length`, `getTotalVertices()`, `getActiveIndices()`, `getActiveParticles()`, `getActiveBones()` |
| FPS | `engine.getFps()`, `engine.getDeltaTime()` |

Jeder `PerfCounter` bietet `current`, `average`, `lastSecAverage`, `min`, `max`, `total`, `count`.
Werte im `scene.onAfterRenderObservable` lesen. Die Debug-API bündelt das in `stats()` und
`measure()`.

## Qualitätsstufen und dynamische Auflösung

- Ein `QualityManager` wendet Stufen (`low`, `medium`, `high`, `ultra`) an; welche Effekte je
  Stufe aktiv sind, steht in der Qualitätstabelle des Skills `babylon-graphics`.
- **Startwahl:** Software-Rendering (`gpuInfo().isSoftware`) → `low`; WebGL2 → höchstens
  `medium`; sonst kurzer Testlauf (2 s auf `high`) und bei p95 über Budget eine Stufe tiefer.
  Der User kann die Stufe im Menü überschreiben; die Wahl wird gespeichert.
- **Dynamische Auflösung:** `engine.setHardwareScalingLevel()` zwischen 1,0 und 1,5 nach
  gleitender GPU-Zeit nachführen — mit Hysterese, höchstens eine Änderung pro Sekunde, damit
  das Bild nicht pumpt.
- `SceneOptimizer`-Presets (`SceneOptimizerOptions.Low/Moderate/HighDegradationAllowed`)
  schalten pauschal Schatten, Post-Processing und Partikel ab und verschmelzen Meshes — für ein
  Spiel mit Grafikanspruch nur als letzte Notstufe.

## Optimierungskatalog

Reihenfolge nach Diagnose: erst das, was die begrenzende Ressource entlastet.

**CPU / Draw Calls**

- **Thin Instances** für viele gleiche Objekte (Gras, Blumen, Steine):
  `thinInstanceSetBuffer("matrix", buffer, 16, staticBuffer)`, `thinInstanceAdd`,
  `thinInstanceSetMatrixAt`, `thinInstanceBufferUpdated`. Sie werden als **ein Block**
  gecullt und gepickt — deshalb räumlich in Kacheln aufteilen (z. B. je Geländekachel ein
  Thin-Instance-Mesh), damit Frustum Culling greift. Hinzufügen und Entfernen ist teuer;
  `staticBuffer: false` nur für Puffer, die sich laufend ändern.
- **Instances** (`createInstance`) für verstreute Objekte mit eigenem Culling und Picking.
- **Statisches einfrieren:** `mesh.freezeWorldMatrix()`, `material.freeze()`,
  `scene.freezeActiveMeshes()` (Meshes, die trotzdem sichtbar bleiben müssen, brauchen
  `alwaysSelectAsActiveMesh`).
- **`scene.performancePriority`** (`ScenePerformancePriority` aus `@babylonjs/core/scene`) vor
  dem Laden setzen — wirkt nur auf danach erzeugte Meshes. `Intermediate` schaltet
  `skipPointerMovePicking` ein und `autoClear` aus und setzt bei neuen Meshes
  `alwaysSelectAsActiveMesh` und `isPickable = false`. Das hebt Frustum Culling für diese
  Meshes auf: In großen Welten mit Kachel-Inhalten dort `alwaysSelectAsActiveMesh = false`
  zurücksetzen. `Aggressive` geht weiter (`skipFrustumClipping`, zwischengespeicherte
  Instanz-Batches).
- **Picking sparen:** `scene.skipPointerMovePicking = true`, Deko-Meshes `isPickable = false`.
- **Massenänderungen:** `scene.blockMaterialDirtyMechanism = true` während des Umbaus.
- **Snapshot-Rendering (nur WebGPU):** `engine.snapshotRendering = true`,
  `engine.snapshotRenderingMode = Constants.SNAPSHOTRENDERING_FAST` (aus
  `@babylonjs/core/Engines/constants`) mit `SnapshotRenderingHelper`
  (`@babylonjs/core/Misc/snapshotRenderingHelper`) für bewegte Meshes (`updateMesh`).
  Nach Hinzufügen oder Entfernen von Meshes `engine.snapshotRenderingReset()`;
  `isVisible`/`setEnabled`-Wechsel brauchen ein Aus-/Einschalten. Spart nur CPU; der Helper
  setzt `performancePriority` währenddessen auf `BackwardCompatible`.
- **JavaScript im Spieltakt:** keine Allokationen pro Frame — `…ToRef`-Methoden und
  vorab angelegte Vektoren (`TmpVectors` aus `@babylonjs/core/Maths/math.vector`), keine
  Closures in heißen Schleifen.

**GPU**

- **Auflösung:** Hardware-Scaling und dynamische Auflösung (oben).
- **Vollbild-Effekte** kosten pro Pixel: Volumetrie, Wolken und SSAO mit halber Auflösung,
  SSR nur auf `ultra` (Skill `babylon-graphics`).
- **Schatten:** Kaskadenzahl und Shadow-Map-Größe dominieren; Schattenwerfer-Liste schlank
  halten.
- **LOD:** `mesh.addLODLevel(distanceOrCoverage, meshOrNull)` (`null` = ab dort nicht
  zeichnen), `useLODScreenCoverage` für Bildschirmabdeckung 0–1. LOD-Stufen offline mit
  `gltf-transform simplify` erzeugen (Skill `babylon-assets`).
- **Occlusion Queries** für große Verdecker: `mesh.occlusionType =
  AbstractMesh.OCCLUSION_TYPE_OPTIMISTIC`, `occlusionQueryAlgorithmType`,
  `occlusionRetryCount`; Imports laut Side-Effect-Tabelle, sonst wirkungslos.
- **Texturen:** KTX2 (ETC1S/UASTC) bleibt mit `enableAllFeatures` auf der GPU komprimiert
  (BC7/ASTC/ETC2) — ohne diese Option landet es unkomprimiert (etwa 4× VRAM). Mipmaps an,
  Größen passend zur Bildschirmgröße des Objekts.
- **Partikel:** große Mengen als GPU-Partikel.

**Ausreißer**

- **Shader vorkompilieren:** `await scene.whenReadyAsync(true)` vor dem Spielstart,
  `material.forceCompilationAsync(mesh)` für später erscheinende Objekte, glTF-Optionen
  `compileMaterials` und `compileShadowGenerators` (`pluginOptions.gltf`).
- **Nachladen** außerhalb des Spielgeschehens bündeln (Ladebildschirm, Levelwechsel).
- **Physik:** einfache Kollisionsformen (Box, Kugel, Kapsel) vor Mesh-Formen (Skill
  `babylon-gameplay`).
