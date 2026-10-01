---
name: babylon-visual-qa
description: Ein Babylon.js-Spiel im Browser ansehen und die Optik bewerten — Dev-Server starten, Chrome-DevTools-MCP (headless, eigene Seite je Agent), Debug-API für reproduzierbare Standbilder, Screenshot-Protokoll, Look-Dev-Checkliste, Konsolen- und Engine-Prüfung, Inspector-CLI für Szenenabfragen und die Übergabe an den User. Laden, wenn ein Babylon-Spiel gestartet, angesehen, per Screenshot geprüft oder optisch bewertet werden soll.
---

# Babylon-Spiele im Browser prüfen

## Rollen

- **Hauptagent:** startet den Server, beauftragt `babylon-visual-reviewer` mit Prüfauftrag und
  URL, setzt den Bericht um. Screenshots bleiben so außerhalb des Hauptkontexts.
- **Direkt im Hauptkontext** nur für eine schnelle Einzelprüfung (ein Screenshot, eine Zahl).
- **Himmel und Wetter** (Tageszeiten, Wolken, Nebel, Strahlen, Wetter, Flug durch Wolken) prüft
  Agent `babylon-sky-reviewer` nach dem Protokoll des Skills `babylon-sky`.
- Review und Performance-Messung laufen **nacheinander**, nie gleichzeitig im selben Browser.

## Server starten

| Zweck | Befehl (im Hintergrund) | URL |
|---|---|---|
| Entwicklung, Optik | `npm run dev` | `http://127.0.0.1:5173/` |
| Messungen | `npm run build:profile`, dann `npm run preview` | `http://127.0.0.1:4173/` |

Immer `127.0.0.1` verwenden: sicherer Kontext für WebGPU, und der Firmen-Webfilter lässt die
IP durch. Vor dem Öffnen prüfen, dass der Server antwortet (HTTP 200).

## Browser: Chrome-DevTools-MCP

- Projektkonfiguration (`.mcp.json`): headless, eigenes temporäres Profil je Sitzung
  (`--isolated`), Viewport 1280×720, Telemetrie aus. Headless liefert unter Windows
  Hardware-WebGPU (geprüft mit einem Intel-Arc-Adapter, kein Fallback).
- Läuft eine andere Konfiguration (z. B. die Benutzer-Definition ohne Viewport), werden
  Screenshots so groß wie das Fenster mal Display-Skalierung. Dann vor dem ersten Screenshot
  `emulate` mit `viewport: "1280x720x1"` aufrufen.
- **Ein Browser für alle:** Alle Agenten einer Sitzung teilen sich eine Chrome-Instanz. Jeder
  Beteiligte — auch der Hauptagent — öffnet eine eigene Seite (`new_page`), arbeitet nur dort
  und schließt sie am Ende. Fremde Seiten bleiben unangetastet.
- Tools laden:
  `ToolSearch` mit `select:mcp__chrome-devtools__new_page,mcp__chrome-devtools__navigate_page,mcp__chrome-devtools__evaluate_script,mcp__chrome-devtools__take_screenshot,mcp__chrome-devtools__list_console_messages,mcp__chrome-devtools__get_console_message,mcp__chrome-devtools__list_pages,mcp__chrome-devtools__close_page,mcp__chrome-devtools__resize_page,mcp__chrome-devtools__press_key,mcp__chrome-devtools__take_snapshot,mcp__chrome-devtools__click`.
- Zum Mitschauen im sichtbaren Fenster kann der User lokal überschreiben (Scope `local` hat
  Vorrang vor `project`):
  `claude mcp add chrome-devtools --scope local -- npx -y chrome-devtools-mcp@latest --isolated --viewport=1280x720 --chrome-arg=--force-device-scale-factor=1`

## Screenshot-Protokoll

1. **Öffnen:** `new_page` mit der URL.
2. **Bereitschaft abwarten** (`evaluate_script`):
   ```js
   async () => {
     const deadline = performance.now() + 30000;
     while (!window.__game?.ready) {
       if (performance.now() > deadline) return { ready: false };
       await new Promise((resolve) => setTimeout(resolve, 250));
     }
     return { ready: true, stats: window.__game.stats(), gpu: await window.__game.gpuInfo() };
   }
   ```
3. **Umgebung prüfen:** Engine laut `stats().engine` (WebGPU erwartet), `gpuInfo().isSoftware`
   muss `false` sein — sonst sind alle Optik- und Leistungsurteile ungültig.
4. **Konsole prüfen:** `list_console_messages` mit `types: ["error", "warn"]`. Relevant:
   Zeilen mit `BJS -`, `Unable to compile effect`, `WebGPU uncaptured error`, Warnungen über
   fehlende Side-Effect-Imports, 404 auf Assets.
5. **Startbildschirm:** Braucht das Spiel einen Klick (Audio, Pointer Lock), per
   `take_snapshot` die uid des Buttons holen und `click` ausführen — CDP-Klicks zählen als
   Nutzeraktion.
6. **Je Kamerapunkt × Tageszeit:** `pause()`, `setTimeOfDay(h)`, `setViewpoint(name)`,
   `waitFrames(30)` (TAA und zeitliche Effekte konvergieren), `frameCheck()` als
   Plausibilitätsprüfung, dann `take_screenshot` mit `format: "jpeg"`, `quality: 80`.
7. **Vorher/Nachher:** `setEffect(name, false)` → Screenshot → `setEffect(name, true)` →
   Screenshot. So lässt sich der Beitrag eines Effekts isoliert bewerten.
8. **Rückfallebene:** mindestens einen Kamerapunkt mit `?engine=webgl2` gegenprüfen.
9. **Schließen:** `close_page`.

**Stichprobe:** die von der Änderung betroffenen Kamerapunkte plus eine Übersicht, die
relevanten Tageszeiten (z. B. Sonnenaufgang und Mittag). Ein 1280×720-Screenshot kostet rund
1.200 Tokens — Fragen, die Zahlen beantworten (`state()`, `stats()`, `frameCheck()`), ohne
Screenshot klären.

**Schwarzbild-Indikatoren** aus `frameCheck()`: `meanLuminance < 0.02` oder
`stdDevLuminance < 0.01` → leeres oder schwarzes Bild; `whiteRatio > 0.2` → überstrahlt.

## Look-Dev-Checkliste

1. **Belichtung und Tonwerte:** keine großflächig ausgefressenen Lichter, keine abgesoffenen
   Schatten, filmisches Tonemapping, Helligkeit passend zur Tageszeit.
2. **Licht:** klare Hauptlichtrichtung (Sonne), warm-kalt-Kontrast bei tiefer Sonne,
   Umgebungslicht aus dem Himmel (IBL), das Schattenseiten passend einfärbt, keine
   übersättigten Farben.
3. **Schatten:** auf allen relevanten Objekten vorhanden, Weichheit passend zur Sonne, keine
   Streifen (Shadow Acne), keine abgelösten Schatten (Peter Panning), keine sichtbaren
   Kaskaden-Nähte, Kontaktschatten wo Objekte den Boden berühren.
4. **Atmosphäre und Tiefe:** Fernes verblasst Richtung Himmelsfarbe (Luftperspektive),
   Nebelfarbe passt zum Horizont, kein harter Horizontschnitt, plausibler Himmelsverlauf.
5. **Volumetrie:** Lichtstrahlen dezent, in Sonnenrichtung, ohne Banding oder Rauschen, keine
   Nebelwand.
6. **Materialien:** plausible Rauheit (kein Plastik-Einheitslook), Metallanteil nur bei Metall,
   Pflanzen im Gegenlicht durchscheinend, Texturen scharf, keine verzerrten UVs, Normal Maps
   mit richtiger Lichtrichtung.
7. **Bildruhe im Standbild:** Treppenstufen an dünner Geometrie (Gras, Äste), Moiré.
8. **Komposition:** Spielfigur und Ziele heben sich vom Hintergrund ab, Silhouetten lesbar,
   HUD gut lesbar, Farbwelt laut Spec.
9. **Technik:** keine fehlenden Texturen (schwarz, pink, Schachbrett), kein Z-Fighting, keine
   abgeschnittene Nahebene, keine schwarzen Frames.

## Inspector-CLI (strukturierte Szenenabfragen)

Die Inspector-CLI aus `@babylonjs/inspector` fragt die laufende Szene ab und liefert JSON —
damit lassen sich Werte (Lichtstärken, Materialparameter, Pipeline-Einstellungen) exakt
prüfen. Status: experimentell.

1. Spiel verbinden: URL-Parameter `?inspectable` oder `__game.startInspectable()`.
2. `npx babylon-inspector --session` — listet Sitzungen; startet die Bridge bei Bedarf
   (Ports 4400 Browser / 4401 CLI, änderbar über eine `.babyloninspector`-Datei). Erscheint
   keine Sitzung, die Seite neu laden.
3. `npx babylon-inspector --session <n> --command` — listet die verfügbaren Befehle.
4. `npx babylon-inspector --session <n> --command <befehl> --<argument> <wert>`, z. B.
   `query-mesh --uniqueId 42`.
5. `npx babylon-inspector --stop` beendet die Bridge.

Nützliche Befehle: `query-mesh`, `query-material`, `query-light`, `query-camera`,
`query-texture`, `query-postProcess`, `query-renderingPipeline`, `query-frameGraph`,
`get-count-stats`, `get-system-stats`, `start-perf-instrumentation` + `get-frame-stats`,
`get-shader-code`, `take-screenshot` (`--cameraUniqueId`, `--width`, `--height`; gibt rohes
Base64-PNG aus, z. B. `… | base64 -d > .temp/shot.png`, danach mit `Read` ansehen).

## Übergabe an den User

Standbilder zeigen keine Bewegung. An den User gehen: Kamera- und Fluggefühl, Animationen,
zeitliche Artefakte (TAA-Schlieren, flimmernde Schatten in Bewegung, LOD-Springen), Übergänge,
Ton, Eingabeverzögerung. Form:

> Gebaut, läuft unter `http://127.0.0.1:5173/`. Bitte einmal ansehen: <Ablauf>.
> Achte auf <X> und <Y>.
