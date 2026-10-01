# Model Lab

Dev-Seite des Spielprojekts, die ein glb unter neutralem Studiolicht als **Kontaktbogen**
rendert: sechs Ansichten in einem 1280×720-Bild. Ein Screenshot kostet rund 1.200 Tokens und
zeigt Form, Proportionen, Farben, Transparenz und Schatten aus allen Richtungen. Getestet mit
WebGPU und WebGL2 (Babylon 9.29, Vite 8, TypeScript 7 mit `strict`, `erasableSyntaxOnly`,
`noUncheckedIndexedAccess`).

## Einrichtung

1. `templates/model-lab/lab.html` → Repo-Root, `templates/model-lab/src/lab/` → `src/lab/`.
2. Fertig: Der Vite-Dev-Server liefert jede HTML-Datei im Root aus
   (`http://127.0.0.1:5173/lab.html`). Der Produktions-Build übernimmt nur `index.html`, das Lab
   bleibt draußen. `npm run typecheck` prüft `src/lab/` mit.
3. Abhängigkeiten: `@babylonjs/core` und `@babylonjs/loaders` (im Spiel vorhanden).

Das Lab hat eine eigene kleine Engine-Fabrik (`engineFactory.ts`): ohne Geräteskalierung und
mit `preserveDrawingBuffer` unter WebGL2 — ein Renderpixel entspricht einem Screenshotpixel.

| Datei | Aufgabe |
|---|---|
| `main.ts` | Ablauf: Engine, Modell laden, Pose setzen, Box messen, Studio, Kontaktbogen, `__lab` |
| `params.ts`, `types.ts` | URL-Parameter, Union-Typen |
| `modelLoader.ts` | `LoadAssetContainerAsync`, Bounding Box, Stichprobe der Eckpunkte für das Einpassen |
| `studio.ts` | IBL (8-Bit-Würfeltextur aus Canvas-Flächen, ohne Netzwerk), Key-Light mit PCF-Schatten, Boden mit adaptivem Raster, Achsenkreuz im Ursprung |
| `views.ts`, `cameraFit.ts`, `contactSheet.ts` | Ansichten, Kamera-Einpassung (orthografisch auf die Box, perspektivisch auf die Geometrie), Viewports |
| `overlay.ts` | Kopfzeile und Kachelbeschriftungen als HTML |
| `animationControl.ts` | Animationen auf einen festen Zeitpunkt setzen und pausieren |
| `debugModes.ts`, `normalMaterial.ts` | Wireframe, UV, Vertexfarben, Material-IDs über `MeshDebugPluginMaterial`; Normalen über ein Node Material |
| `modelStats.ts`, `labApi.ts` | Kennzahlen, `window.__lab` |

## Aufruf

`http://127.0.0.1:5173/lab.html?model=/assets/models/<name>.glb` — fertiges glb (WebP, meshopt)
`http://127.0.0.1:5173/lab.html?model=/.temp/models/<name>.glb` — Roh-glb direkt aus dem Generator

| Parameter | Werte |
|---|---|
| `model` | URL des glb (Pflicht) |
| `backend` | `webgpu` (Standard), `webgl2` |
| `view` | `sheet` (Standard), `front`, `right`, `back`, `top`, `three-quarter`, `close-up` |
| `debug` | `none`, `wireframe`, `normals`, `uv`, `vertexcolors`, `materialid` |
| `anim`, `t` | Animationsname (ohne Angabe: alle) und Zeitpunkt in Sekunden; die Pose wird vor dem Vermessen gesetzt |
| `focus`, `focusSize` | Fokuspunkt `x,y,z` und Kantenlänge des Ausschnitts in Metern für `close-up` |

## Bildaufbau

- **Kopfzeile:** Dateiname, Bounding Box (X, Y, Z in m), Rasterweite, Dreiecke, Animation mit
  `t`, Backend.
- **Raster 3×2:** FRONT (+Z), RIGHT (Kamera bei −X, rechte Seite der Figur), BACK (−Z) — oben;
  TOP (+Y, vorne zeigt nach oben im Bild), 3/4 von vorne rechts oben, CLOSE-UP — unten.
- Achsansichten orthografisch mit Maßangabe in der Beschriftung („ortho 0.194 x 0.310 m"),
  3/4 und Nahaufnahme perspektivisch.
- Boden bei `bbox.min.y` mit adaptivem Raster (~10 Zellen über das Modell, jede fünfte Linie
  dunkler); Achsenkreuz im Ursprung: X rot, Y grün, Z blau. In den Seitenansichten erscheint
  der Boden als helle Linie.
- Szene rechtshändig (`useRightHandedSystem`), das Modell erscheint in glTF-Koordinaten.

## `window.__lab`

| Mitglied | Ergebnis |
|---|---|
| `status`, `ready`, `error`, `backend` | `loading` → `ready` oder `error` mit Meldung |
| `stats()` | Meshes, Vertices, Dreiecke, Materialien (Alpha-Modus, doppelseitig, Vertexfarben, UV0), Texturen mit Größe, Animationen (Dauer, Loop, Ziele), Bounding Box, Lage des Ursprungs in der Box (`origin.fraction` 0 = Min-Kante, 1 = Max-Kante), Knotenhierarchie mit Dreiecken |
| `setView(mode)`, `setDebug(mode)`, `setAnimationTime(name, t)` | Promise, das nach drei gerenderten Bildern auflöst — danach direkt Screenshot |

## Protokoll für eine Modellprüfung

Chrome-DevTools-Tools und Regeln für den geteilten Browser: Skill `babylon-visual-qa`,
Abschnitt „Browser" (eigene Seite, am Ende schließen).

1. `new_page` mit der Lab-URL.
2. Bereitschaft abwarten (`evaluate_script`):
   ```js
   async () => {
     const deadline = performance.now() + 30000;
     while (!window.__lab || window.__lab.status === "loading") {
       if (performance.now() > deadline) return { status: "timeout" };
       await new Promise((resolve) => setTimeout(resolve, 250));
     }
     return window.__lab.status === "ready"
       ? { status: "ready", backend: window.__lab.backend, stats: window.__lab.stats() }
       : { status: "error", error: window.__lab.error };
   }
   ```
3. `list_console_messages` mit `types: ["error", "warn"]` — muss leer sein.
4. Kontaktbogen: `take_screenshot` mit `format: "jpeg"`, `quality: 80`.
5. Bei Bedarf `await window.__lab.setDebug("wireframe")` → Screenshot (Dreiecksverteilung),
   `setDebug("normals")` → Screenshot, danach `setDebug("none")`.
6. Details: `navigate_page` auf dieselbe URL mit `&view=close-up&focus=x,y,z&focusSize=s`.
7. Animierte Teile: zweite Pose über `&anim=<name>&t=<s>` (z. B. oberer und unterer
   Umkehrpunkt).
8. `close_page`.

## Debug-Ansichten lesen

- **wireframe:** Dreiecke über dem schattierten Modell — gleichmäßige Verteilung, Dichte dort,
  wo die Silhouette sie braucht, keine Nadeldreiecke.
- **normals:** Weltnormale als Farbe (xyz · 0,5 + 0,5: +X rot, +Y grün, +Z blau). Die Farbe
  hängt von der Ausrichtung ab — ein gekippter Flügel ist zu Recht anders gefärbt. Befund sind
  **abrupte Farbsprünge** auf einer glatt gedachten Fläche (umgedrehte Normalen, Nähte, Dellen).
- **vertexcolors / materialid:** Farbzonen ohne Licht bzw. Materialzuordnung je Primitive.
- **uv:** UV0 als Schachbrett — gleichmäßige Kästchen ohne starke Verzerrung, Sprünge nur an
  Nähten in verdeckten Bereichen.

## Grenzen

- `setAnimationTime` setzt nur die Pose; Kameras und Boden behalten die beim Laden gemessene
  Box. Ragt eine Pose darüber hinaus, die Pose per URL-Parameter `t` setzen (Neuladen).
- Das Studio-IBL ist eine einfache, nicht vorgefilterte 8-Bit-Umgebung — für Basisfarben und
  raue Materialien neutral, für stark spiegelnde Metalle eine Näherung. Die Wirkung im
  Spiellicht prüft Skill `babylon-visual-qa`.
- Die Stichprobe für das Einpassen ist auf 20.000 Punkte begrenzt.
- Geprüft im Bild: Kontaktbogen (WebGPU, WebGL2), Wireframe, Normalen und UV-Ansicht (WebGPU),
  texturiertes Modell mit WebP-Texturen und meshopt.
- meshopt-komprimierte Modelle laden den Decoder standardmäßig vom Babylon-CDN; mit selbst
  gehosteten Decodern (Skill `babylon-assets`) läuft das Lab offline.
