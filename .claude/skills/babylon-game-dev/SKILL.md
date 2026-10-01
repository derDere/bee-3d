---
name: babylon-game-dev
description: Grundlagen und Einstieg für 3D-Browserspiele mit Babylon.js 9.x (TypeScript, Vite, ES-Module) — Stack, API-Verifikation gegen die installierten Typings, Paketversionen, Projektstruktur, Engine-Bootstrap mit WebGPU und WebGL2-Rückfallebene, Side-Effect-Imports, Debug-API und Arbeitsablauf. Wegweiser zu den Spezial-Skills für Grafik, Gameplay, Performance, visuelle Prüfung, Assets und Modellierung. Laden, sobald ein Babylon.js-Spiel oder eine Babylon-Szene geplant, aufgesetzt oder weiterentwickelt wird.
---

# Babylon.js-Browserspiele — Grundlagen

Dieser Skill legt Stack, Arbeitsweise und Projektgerüst fest und verweist auf die
Spezial-Skills. Details zum Aufsetzen: [references/setup.md](references/setup.md).
Vertrag der Debug-API: [references/debug-api.md](references/debug-api.md).

## Stack

| Bereich | Festlegung |
|---|---|
| Engine | Babylon.js 9.x, volle Engine, ES-Module `@babylonjs/*` |
| Sprache | TypeScript, `strict` |
| Bundler / Dev-Server | Vite |
| Grafik-API | WebGPU bevorzugt, WebGL2 als Rückfallebene |
| Physik | Havok (Physics V2, `@babylonjs/havok`) |
| Audio | AudioEngineV2 |
| UI / HUD | Babylon GUI oder HTML/CSS-Overlay → Skill `babylon-gameplay` |
| Diagnose | Inspector v2 und Inspector-CLI (`@babylonjs/inspector`, nur Dev), Debug-API `window.__game` |

Babylon Lite (`@babylonjs/lite`) ist eine eigenständige, reine WebGPU-Engine mit eigener API.
Atmosphäre-Addon, volumetrisches Licht, SSAO, SSR, GUI und Frame Graph fehlen dort — für Spiele
mit hohem Grafikanspruch gilt die volle Engine.

## API-Wahrheit: erst nachsehen, dann schreiben

Babylon veröffentlicht jede Woche eine Minor-Version. Trainingswissen und Beispiele im Netz
mischen Muster aus vielen Major-Versionen (globales `BABYLON.*` aus dem UMD-Build,
Callback-Lader, Physics V1 mit `PhysicsImpostor`, Legacy-`Sound`). Für **jede** Babylon-API, die
in Code landet, gilt diese Prüfreihenfolge:

1. **Installierte Typings** — `node_modules/@babylonjs/<paket>/**/*.d.ts` per Grep; maßgeblich
   für die installierte Version. Module mit Seiteneffekten bestehen aus `x.js`, `x.pure.js` und
   `x.types.d.ts`; die eigentlichen Deklarationen stehen in `x.pure.d.ts`.
2. **Context7** — Bibliothek `/websites/doc_babylonjs`, ergänzend `/babylonjs/documentation`.
3. **Doku-Quelltext** — `https://raw.githubusercontent.com/BabylonJS/Documentation/master/content/…`
   (doc.babylonjs.com liefert über WebFetch oft eine leere Seite).
4. **Engine-Quelltext** — `https://github.com/BabylonJS/Babylon.js` (`packages/dev/core/src`,
   `packages/dev/addons/src`, …).
5. **Offizielle Playgrounds und Forum** (forum.babylonjs.com) für Verhalten und Fallstricke.

Größere Recherchen übernimmt der Agent `babylon-api-verifier`: Er liefert verifizierte Snippets
und hält die Doku aus dem Hauptkontext heraus. Widersprechen sich Doku und Typings, gelten
Typings bzw. Quelltext.

Nach jeder Änderung: `npm run typecheck` fängt falsche Signaturen. Fehlende Side-Effect-Imports
fallen erst zur Laufzeit auf — dafür die Dev-Diagnose aus dem Abschnitt unten.

## Paketversionen

- Alle Framework-Pakete `@babylonjs/*` laufen auf **derselben Version** und werden in einem
  Befehl installiert und aktualisiert; die Peer-Ranges (`^9.0.0`) erzwingen das nicht.
- `@babylonjs/havok` hat eine eigene Versionsreihe.
- Versionen kommen live aus der Registry (`npm view <paket> version`), Standard ist die neueste
  Version einschließlich neuester Major.
- Unterstützt ein Werkzeug die neueste Major eines anderen noch nicht (Beispiel:
  `typescript-eslint` und TypeScript — dessen `peerDependencies` prüfen), wird die höchste
  unterstützte Version gepinnt und der Grund dokumentiert; in `package.json` über einen
  `"//"`-Eintrag, da JSON keine Kommentare kennt.

## Projektstruktur

```
index.html · lab.html (Model Lab, nur Dev) · vite.config.ts · tsconfig.json · package.json · .env.profile
tools/models/  Modell-Generatoren (Python, uv), nicht im Build → Skill babylon-modeling
public/
  assets/      models/ textures/ env/ audio/      → Skill babylon-assets
  babylon/     selbst gehostete Decoder (Draco, meshopt, KTX2)
src/
  main.ts      Einstieg: Canvas, Engine, Spiel starten
  core/        Engine-Fabrik, Game, Spieltakt, Qualitätsstufen, Einstellungen
  rendering/   Himmel und Atmosphäre, Licht, Schatten, Post-Processing, Wolken
  world/       Gelände, Vegetation, Wasser, Level-Aufbau
  entities/    Spielfigur und Spielobjekte
  systems/     Input, Kamera, Physik, Audio, HUD, Spielzustand
  assets/      Asset-Katalog und Ladefunktionen
  debug/       Debug-API und Inspector-Anbindung (Dev- und Profil-Build)
  lab/         Model Lab (Kontaktbogen für Modelle)
docs/assets.md Herkunft und Lizenz jedes Assets
```

Repo-Rahmen (`spec/`, `docs/`, `.gitignore`) und Befehls-Einstiegspunkte richten sich nach den
Hausstandard-Skills `project-structure`, `makefile-commands` und `dev-env`, soweit sie zum
Projekt passen.

## Code-Konventionen

- Klassen mit genau einer Verantwortung; Abhängigkeiten (Scene, Dienste) kommen über den
  Konstruktor. Globaler Zustand existiert nur als Debug-API im Dev- und Profil-Build.
- Jede Klasse, die Babylon-Ressourcen anlegt, hat `dispose()` und gibt Meshes, Materialien,
  Texturen und Observer frei (`observable.remove(observer)`).
- Die Vite-Vorlage setzt `erasableSyntaxOnly`: Eigene Konstantenmengen sind `as const`-Objekte
  oder Union-Typen, Felder werden explizit deklariert. Babylons eigene Enums sind normal nutzbar.
- Bezeichner Englisch, Kommentare Deutsch; Doc-Comments nennen den deutschen Fachbegriff
  („Stellt die Spielfigur dar.").
- **Modelle sind fertige Dateien:** Jedes Modell liegt als glb mit PBR-Materialien und
  Texturen unter `public/assets/models/`. Das Spiel lädt, platziert und instanziiert sie; es
  erzeugt keine Modellgeometrie zur Laufzeit. Generator-Code (`tools/models/`) und das Model Lab
  sind Werkzeuge und gehören nicht ins Build-Artefakt.
- Einheiten: 1 Einheit = 1 Meter, Y zeigt nach oben, Zeiten in Sekunden.
- Zufall über einen seedbaren Generator, damit Prüfläufe reproduzierbar sind.

## Engine-Bootstrap

```ts
const engine = await createEngine(canvas); // WebGPU mit allen Features, sonst WebGL2
const game = await Game.createAsync(engine); // Szene, Licht, Systeme, Spieltakt
game.start(); // Renderschleife; Größenänderungen übernimmt der Spieltakt (ResizeObserver)
```

Engine-Fabrik, Vite-Konfiguration, Loader-Registrierung und Inspector-Anbindung stehen
vollständig in [references/setup.md](references/setup.md). Zwei Punkte sind Pflicht:

- `WebGPUEngine` mit `enableAllFeatures: true` und `setMaximumLimits: true` erzeugen. Erst damit
  stehen Texturkompression (BC7/ASTC/ETC2 für KTX2) und `timestamp-query` (GPU-Zeitmessung)
  zur Verfügung.
- Die Fabrik fängt einen fehlgeschlagenen WebGPU-Start selbst ab und fällt auf WebGL2 zurück;
  der URL-Parameter `?engine=webgl2` erzwingt den Rückfall zum Testen.

## Side-Effect-Imports

Deep Imports (`@babylonjs/core/Meshes/meshBuilder` …) halten das Bundle klein. Die meisten
Module registrieren sich beim Import selbst — darunter `ShadowGenerator`, die
Post-Process-Pipelines, `AnimationGroup`, alle Shader und die Textur-Lader (`.env`, `.ktx2`,
`.hdr`, `.dds`, `.basis`, `.exr`, `.tga`, `.ies`). Einige Funktionen brauchen einen
zusätzlichen Import. Fehlt er, wird die Methode meist **stillschweigend** zum Platzhalter, der
`undefined` liefert:

| Funktion | Zusätzlicher Import |
|---|---|
| `scene.pick`, `createPickingRay`, `pickWithRay` | `@babylonjs/core/Culling/ray` |
| `scene.beginAnimation`, `stopAllAnimations` | `@babylonjs/core/Animations/animatable` |
| `scene.enablePhysics` mit Havok | `@babylonjs/core/Physics/joinedPhysicsEngineComponent` und `@babylonjs/core/Physics/v2/physicsEngineComponent` |
| `thinInstance*` / `createInstance` | `@babylonjs/core/Meshes/thinInstanceMesh` / `@babylonjs/core/Meshes/instancedMesh` |
| `mesh.simplify` | `@babylonjs/core/Meshes/meshSimplificationSceneComponent` |
| Meshes ohne eigenes Material (Standardmaterial der Szene) | `@babylonjs/core/Materials/standardMaterial` |
| `createDefaultEnvironment`, `createDefaultSkybox`, `createDefaultCamera…` | `@babylonjs/core/Helpers/sceneHelpers` |
| Standard-Ladebildschirm | `@babylonjs/core/Loading/loadingScreen` |
| `scene.enableDepthRenderer()`, `scene.enablePrePassRenderer()`, Bounding-Box-Anzeige | `@babylonjs/core/Rendering/depthRendererSceneComponent`, `@babylonjs/core/Rendering/prePassRendererSceneComponent`, `@babylonjs/core/Rendering/boundingBoxRenderer` |
| Subsurface-Streuung (`subSurface.isScatteringEnabled`) | `@babylonjs/core/Rendering/subSurfaceSceneComponent` |
| Node-Material-, Render-Graph-, Partikel-Graph-JSON parsen (unbekannte Blöcke werden still übersprungen) | `@babylonjs/core/Materials/Node/Blocks/allBlocks`, `@babylonjs/core/FrameGraph/Node/Blocks/index`, `@babylonjs/core/Particles/Node/Blocks/index` |
| GPU-Partikel (`GPUParticleSystem`) | `@babylonjs/core/Particles/webgl2ParticleSystem` und `@babylonjs/core/Particles/computeShaderParticleSystem` |
| Compute Shader unter WebGPU (Lighting Volume der Volumetrie) | `@babylonjs/core/Engines/WebGPU/Extensions/engine.computeShader` |
| Occlusion Queries | `@babylonjs/core/Engines/AbstractEngine/abstractEngine.query` und `@babylonjs/core/Rendering/boundingBoxRenderer`; unter WebGL zusätzlich `@babylonjs/core/Engines/Extensions/engine.query` |
| GPU-Zeitmessung unter WebGL | `@babylonjs/core/Engines/AbstractEngine/abstractEngine.timeQuery` und `@babylonjs/core/Engines/Extensions/engine.query` |
| `CreateScreenshot*` | `@babylonjs/core/Misc/screenshotTools` |

Im Dev-Build meldet Babylon jeden Aufruf eines solchen Platzhalters, wenn die Warnungen
eingeschaltet sind:

```ts
import { SetMissingSideEffectWarningsEnabled } from "@babylonjs/core/Misc/devTools";

// Meldet in der Konsole jeden Aufruf einer Funktion, deren Side-Effect-Import fehlt.
SetMissingSideEffectWarningsEnabled(true);
```

`CheckMissingImports()` aus `@babylonjs/core/Misc/checkMissingImports` listet alle nicht
registrierten Module auf — die Liste gegen die tatsächlich genutzten Funktionen abgleichen.

## Debug-API

Jedes Spiel stellt im Dev- und Profil-Build `window.__game` bereit: Darüber setzen Prüf-Agenten
und Tests den Zustand (Pause, Tageszeit, Kamerapunkte, Qualitätsstufe, einzelne Effekte) und
lesen Kennzahlen. Kamerapunkte und Tageszeiten legt die Spec des jeweiligen Spiels fest.
Vertrag und Umsetzung: [references/debug-api.md](references/debug-api.md).

## Arbeitsablauf

1. **Spec klären** — Spielablauf, Look-Ziel (Stimmung, Referenzen, Farbwelt), Zielgeräte und
   Framerate, Steuerung. Gemeinsam mit dem User; nichts dazuerfinden.
2. **Grundgerüst** — Engine, Spieltakt, Qualitätsstufen, Debug-API, Inspector.
3. **Look-Dev-Ausschnitt** — eine repräsentative Ansicht mit vollem Licht-Stack
   (`babylon-graphics`), geprüft durch `babylon-visual-reviewer`, dann zeigen.
4. **Gameplay-Kern** — `babylon-gameplay`.
5. **Inhalte und Assets** — eigene Modelle mit `babylon-modeling`, fremde Assets mit
   `babylon-assets`.
6. **Performance-Durchgang** — `babylon-perf-profiler` auf Zielhardware.
7. **Feinschliff** — Optik, Gefühl, Ton.

Jeder Schritt endet mit einem Stand, den der User im Browser ansehen kann.

## Werkzeuge

| Werkzeug | Zweck | Bereitstellung |
|---|---|---|
| MCP `chrome-devtools` | Spiel im Browser öffnen, Screenshots, Konsole, Performance-Trace | `.mcp.json` (headless, eigenes Profil je Sitzung, 1280×720) |
| MCP `babylon-nme` | Node Materials bauen, validieren, als JSON exportieren | `.mcp.json` (offizielle Babylon-MCP-Server) |
| MCP `babylon-npe` | Partikel-Graphen bauen, validieren, exportieren | `.mcp.json` |
| `tools/models/` (Python, uv) | Modell-Generatoren → fertige glb mit Texturen (Werkzeug, nicht im Build) | Skill `babylon-modeling` |
| Model Lab `lab.html` | Modelle als Kontaktbogen aus sechs Ansichten prüfen | Skill `babylon-modeling` |
| MCP `context7` | Babylon-Doku (`/websites/doc_babylonjs`) | Benutzer-Scope |
| Inspector-CLI `npx babylon-inspector` | laufende Szene abfragen (JSON), Frame-Statistiken, Off-Screen-Screenshots | devDependency `@babylonjs/inspector` |
| `npx gltf-transform` | Modelle prüfen und optimieren | devDependency `@gltf-transform/cli` |

Die Babylon-MCP-Server zeigen ihre Graphen live im Web-Editor: Session-URL (`get_session_url`)
im Editor unter „MCP Session" einfügen. `save_snippet` veröffentlicht auf dem öffentlichen
Snippet-Server — nur nach Freigabe; ausgeliefert wird exportiertes JSON.

## Wegweiser

| Thema | Skill / Agent |
|---|---|
| Licht, Himmel, Schatten, Volumetrie, Post-Processing, Materialien, Natur, Partikel | Skill `babylon-graphics` |
| Spielarchitektur, Spieltakt, Input, Kamera, Physik, Animation, Audio, HUD | Skill `babylon-gameplay` |
| Messen und Optimieren | Skill `babylon-performance`, Agent `babylon-perf-profiler` |
| Im Browser ansehen und bewerten | Skill `babylon-visual-qa`, Agent `babylon-visual-reviewer` |
| Modelle, Texturen, HDRIs, Audio, Lizenzen, glTF-Pipeline | Skill `babylon-assets` |
| Eigene 3D-Modelle per Code erzeugen und prüfen | Skill `babylon-modeling`, Agent `babylon-model-reviewer` |
| Schwebende Inseln und ihre Teile (Bäume, Gras, Blumen, Felsen, Wasserfall) | Skill `babylon-islands` |
| Babylon-API nachschlagen und verifizieren | Agent `babylon-api-verifier` |
