# Technik

## Komponenten

| Komponente | Technik | Container |
|---|---|---|
| Spiel-Client | Babylon.js 9, TypeScript strict, Vite | Entwicklung: Vite-Dev-Server auf dem Host (`http://127.0.0.1:5173/`); Produktion: `web` (nginx, liefert `dist/` aus und leitet `/stdb/` an SpacetimeDB weiter) |
| Spielserver und Datenbank | SpacetimeDB, Modul in TypeScript (`server/`) | `spacetimedb` (offizielles Image) |
| Gemeinsamer Code | reines TypeScript (`shared/`): Weltkonstanten, Weltgenerator, Regeln, Formeln, Quests | — |
| Modell-Generatoren | Python (uv) unter `tools/models/` | — (Werkzeug) |
| SpacetimeDB-CLI | Host-CLI, sonst derselbe Image-Stand per `docker compose run` (Profil `tools`) | `cli` (nur bei Bedarf) |

## Verzeichnisse

```
spec/ docs/ dev/ tools/        Hausstandard
shared/                        Weltkonstanten, Weltgenerator, Regeln (Modul + Client)
server/                        SpacetimeDB-Modul
src/core/                      Engine, Spieltakt, Qualitätsstufen, Einstellungen
src/rendering/                 Licht-Stack, Post-Processing
src/rendering/sky/             Uhr, Himmelskörper, Wolken, Nebel, Strahlen, Regen, Blitze
src/world/                     Inseln, Flora, Bienenstöcke, Nester, Weltgrenze
src/entities/                  Bienen, Fliegen, Effekte
src/systems/                   Input, Befehle, Flug, Kamera, Ziele, Module, Audio
src/hud/                       HTML-Oberfläche
src/net/                       SpacetimeDB-Anbindung, Bindings
src/debug/                     Debug-API
src/lab/                       Model Lab (nur Entwicklung)
public/assets/                 Modelle, Texturen
docker/                        Konfiguration der Container
```

## Autorität

- **Bewegung:** validierte Client-Autorität. Der Client simuliert die eigene Biene (Befehle,
  Trägheit, Grenze) und meldet Posen mit 15 Hz; der Weltakt (20 Hz) prüft Tempo, Grenze und
  Warp-Freigabe und kappt Sprünge.
- **Alles andere entscheidet der Server:** Fliegen-KI, Modulzyklen, Treffer, Schaden, Sammeln,
  Andocken, Tod, Upgrades, Quests, Belohnungen.
- **Statische Welt** (Inseln, Blumenfelder, Bienenstöcke, Nester) entsteht deterministisch aus
  dem Weltseed in `shared/worldgen.ts`; Server und Client erzeugen dieselbe Liste. Tabellen
  halten nur veränderlichen Zustand.

## Datenmodell (SpacetimeDB)

| Tabelle | Sicht | Inhalt | Schreibrate |
|---|---|---|---|
| `bee_state` | öffentlich, Zellen-Abo | Spieler-ID, Zelle, Position, Gier/Neigung (i16), Takt, Flags (Geist, angedockt, Boost, Warp, Feuer), LP | bis 20 Hz je bewegter Biene |
| `fly_state` | öffentlich, Zellen-Abo | Fliegen-ID, Zelle, Position, Gier, Art, LP, Zustand, Ziel, Takt | 10 Hz je aktiver Fliege |
| `combat_event` | Ereignistabelle, Zellen-Abo | Art, Quelle, Ziel, Wert | je Ereignis |
| `flower_patch` | öffentlich, Zellen-Abo | Feld-ID, Zelle, Pollenstand, Zeitstempel | je Sammelzyklus |
| `player_profile` | öffentlich | Spieler-ID, Identität, Name, Farbe, Heimatstock | selten |
| `player_score` | öffentlich | Spieler-ID, Honig gesamt, Siege | selten |
| `hive_state` | öffentlich | Stock-ID, abgelieferter Honig | selten |
| `world_weather` | öffentlich | erzwungene Wetterlage (Betreiber) | selten |
| `player_stats`, `module_activation`, `quest_progress` | privat, je Spieler über Views | Wallet, Ladung, Energie, Upgrades, Module, Quests | je Ereignis |
| `account`, `session`, `pose_inbox`, `fly_brain`, `nest_state`, `pending_impact`, `warp_state`, `cooldown`, `config`, `tick_timer` | privat | Verwaltung, KI, Einschläge, Zeitpläne | je Ereignis |

- Zellen 256 m (gepackter `u32`), Abo-Radius 1 → 768 m Sichtbereich für Bienen, Fliegen,
  Ereignisse und Blumenfelder.
- Tageszeit = Funktion des Server-Takts; Wetter = Funktion von Seed, Tagesnummer und optionaler
  Betreiber-Vorgabe — keine Schreiblast je Takt.

## Rendering

| Baustein | Technik |
|---|---|
| Himmel | Atmosphäre-Addon (`originHeight` 1 km), eine Hauptlicht-Richtung mit Sonne-Mond-Übergabe |
| Sonne, Mond, Sterne | Billboards bzw. Sternkugel in Gruppe 0 hinter dem Himmels-Compositor |
| Wolken | eigener Raymarcher (GLSL, unter WebGPU über Babylons Shader-Übersetzung): Wolkenmassen aus 3D-Rauschen im ganzen Kugelvolumen, Verdichtung zum Kugelrand, Gewitterzellen, Nebelvolumen an Inseln; Renderdistanz 5,6 km, dahinter analytische Wolkenhülle auf dem Kugelrand (oben mit Lücken); reduzierte Auflösung, zeitliche Wiederverwendung, tiefenbewusstes Hochskalieren, Compositor nach Gruppe 0 |
| Rauschdaten | 3D-Formrauschen (Perlin-Worley) und Detailrauschen, beim Start in einem Web Worker erzeugt; dieselben Daten liefert die CPU-Dichtefunktion für Flug-im-Wolken-Effekte |
| Lichtstrahlen | Radialunschärfe mit Wolkenmaske (Sonne und Mond) |
| Schatten | Kaskaden-Schatten für Inselkörper, Bäume, Felsen, Bienen, Fliegen, Stöcke; Gras und Blumen ohne Schatten |
| Post-Processing | HDR, Bloom, Tonemapping, Color Curves je Tagesphase, Dithering, MSAA/FXAA |
| Inseln | glb-Varianten, skaliert und gedreht instanziert; LOD0 als Modellkopie für die nächsten Inseln (Anzahl und Reichweite je Stufe), Bepflanzung mit der Entfernung ausgedünnt; LOD1/LOD2 als Thin Instances je Variante |
| Flora | Thin Instances aus den Insel-glb; Leuchten nachts über Emissive je Material |
| Effekte | Laserstrahlen, Pollen-Leuchtspuren, Stachelraketen mit Spur, Spucke, Treffer, Sammelstrom, Warp, Regen (GPU-Partikel), Blitze |
| HUD | HTML/CSS-Overlay im verspielten Bienen-Stil, Symbolknöpfe (selbst gezeichnete SVG), englische Texte, `pointer-events` nur auf Bedienelementen |
| Ton | AudioEngineV2, alle Klänge prozedural erzeugt (keine Audiodateien) |

## Qualitätsstufen

| Effekt | low | medium | high | ultra |
|---|---|---|---|---|
| Renderauflösung | 1,5 | 1,25 | 1,0 | 1,0 |
| Wolken | Raymarch ¼, 40 Schritte | Raymarch ¼, 64 Schritte, zeitlich | Fern ½ zeitlich, nah ¼, 96 Schritte | wie high, 128 Schritte |
| Schatten | 2 × 1024 | 3 × 2048 | 4 × 2048 | 4 × 4096 |
| Lichtstrahlen | aus | 32 Samples | 64 Samples | 64 Samples |
| Bloom | aus | an | an | an |
| Kantenglättung | FXAA | MSAA 2 | MSAA 4 | MSAA 4 |
| Flora-Dichte | 15 % | 30 % | 50 % | 100 % |
| Vollständige Inseln (Anzahl, Reichweite) | 3, 160 m | 4, 220 m | 6, 300 m | 9, 420 m |
| Regen-Tropfen | 2 000 | 4 000 | 8 000 | 15 000 |

Startwahl: Software-Rendering → low; WebGL2 → höchstens medium; sonst high. Wählbar im Menü,
gespeichert im `localStorage`.

## Budgets

| Größe | Ziel (integrierte GPU, 1280×720, high) |
|---|---|
| Frame | 16,6 ms |
| Himmel gesamt | ≤ 4,5 ms |
| Draw Calls | ≤ 600 |
| Sichtbare Dreiecke | ≤ 1,5 Mio. |
| Weltakt des Servers | p95 ≤ 10 ms bei 50 Spielern |
| Download je Client | ≤ 30 KB/s in Kämpfen |

### Lasttest

Kopflose Bots unter `tools/loadtest/` nutzen den `NetClient` des Spiels (gleiche Abos, Posen und
Korrekturen wie der Browser). Aufruf: `node tools/loadtest/node_modules/tsx/dist/cli.mjs
tools/loadtest/src/bots.ts --bots 50 --seconds 30 --warmup 60 --area 1600 --metrics
http://127.0.0.1:3000/v1/metrics` (vorher `npm install --prefix tools/loadtest`; danach
`make clear` und `make seed`, die Bots legen Konten an).

| Lauf (lokaler Stack, SpacetimeDB 2.10.2) | 50 Bots, verteilt bis 800 m um einen Stock | 50 Bots, alle in 210 m um einen Stock |
|---|---|---|
| Download je Client | 17,6 KB/s | 49,8 KB/s |
| Latenz eigene Pose → eigene Zeile | p50 35 ms, p95 54 ms | p50 37 ms, p95 55 ms |
| Weltakt (Mittel je Aufruf) | 0,76 ms | 0,71 ms |
| Datenbank-Thread ausgelastet | 3,1 % | 3,2 % |
| Verspätete Takte, abgelehnte Reducer | 0, 0 | 0, 0 |

Ballen sich alle Spieler an einem Ort, sieht jeder alle anderen in denselben Zellen; der Download
steigt dann linear mit der Spielerzahl in Sichtweite.

## Debug-API

`window.__game` nach Skill `babylon-game-dev` mit Erweiterungen `__game.sky` (Skill
`babylon-sky`) und `__game.net` (Skill `spacetimedb-babylon`).

| Kamerapunkt | Bild |
|---|---|
| `overview` | Blick zwischen Wolken auf den Stock „Queen's Hive“ |
| `chase` | Spielkamera hinter der Biene |
| `closeUp` | Biene nah, Seitenansicht |
| `lookDown` | schräger Blick nach unten in die Wolken |
| `islandBand` | zwischen Inseln und Haufenwolken |
| `towardSun` / `awayFromSun` | zur Sonne bzw. von ihr weg |
| `insideCloud` | mitten in einer Wolke |
| `belowCloudBase` | unter einer Wolkenbasis |
| `hive` | Stock „Queen's Hive“ von außen |
| `hiveInterior` | Wabenhalle |
| `nest` | Fliegennest mit Fliegen |
| `worldEdge` | am Wolkenrand der Weltkugel |

Effekte für `setEffect`: `clouds`, `cloudTemporal`, `haze`, `mist`, `lightShafts`, `stars`,
`rain`, `lightning`, `rainbow`, `shadows`, `bloom`, `flora`, `hud`.
