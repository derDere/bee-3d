# Prüfprotokoll

Prüfung des Spiels gegen `spec/anforderungen.md`, Stand 3. Oktober 2026.

## Umgebung

- Windows 11, Chrome 154 (über das Chrome-DevTools-MCP), WebGPU auf Intel Xe-LPG (integrierte GPU);
  WebGL2-Rückfall über `?engine=webgl2`.
- Lokaler Stack mit SpacetimeDB 2.10.2 (Docker), Client als Profil-Build (`npx vite build --mode profile`).
- Werkzeuge: Debug-API `window.__game`, Screenshots, Konsole und Leistungsmessung im Browser, zweiter
  Spieler in einem isolierten Browser-Kontext, Lasttest-Bots unter `tools/loadtest/`.

## Ergebnis

Alle Anforderungen sind erfüllt. Offene Punkte zur Optik stehen am Ende.

### Technik

| ID | Ergebnis | Nachweis |
|---|---|---|
| T01 | erfüllt | Repo-Suche ohne Firmennamen; eigenes Favicon `public/favicon.svg` (Biene vor Himmel) |
| T02 | erfüllt | `make help` listet alle Ziele, `make compile` läuft fehlerfrei |
| T03 | erfüllt | `strict` in `tsconfig.json` und `server/tsconfig.json`, beide Typprüfungen fehlerfrei |
| T04 | erfüllt | Zwei Browser-Kontexte sehen die Biene des anderen in Echtzeit |
| T05 | erfüllt | `__game.net.dropConnection()` → „Reconnecting…“ → nach etwa 1 s wieder online |
| T06 | erfüllt | Statusplakette: verbinden, online, getrennt; ohne Server „Offline – exploring on your own“ |
| T07 | erfüllt | x, z, Höhe und Kurs unten links, laufend aktualisiert |
| T08 | erfüllt | Build mit unerreichbarem Server: Startbildschirm „No server found – you can still explore on your own.“, Fliegen im Erkundungsmodus; Module und Andocken melden, dass sie eine Verbindung brauchen |
| T09 | erfüllt | 60 fps in allen gemessenen Ansichten, siehe Abschnitt Leistung |
| T10 | erfüllt | `?engine=webgl2`: WebGL2 über ANGLE, Bild vollständig, keine Fehler in der Konsole |
| T11 | erfüllt | `npm outdated` im Repo, in `server/` und `tools/loadtest/` ohne Einträge; Babylon 9.29.0 und SpacetimeDB 2.10.2 sind die neuesten Versionen |
| T12 | erfüllt | Seitentitel und Startbildschirm „Bee3D“ |

### Optik der Oberfläche

| ID | Ergebnis | Nachweis |
|---|---|---|
| O01 | erfüllt | Honig- und Wabenlook, Holz, Blüten-Kompass, Pusteblumen-Tacho; runde, kindliche Formen |
| O02 | erfüllt | Eigenes Layout: Plakette oben links, Objektliste links, Auswahl-Blase mit Blüten-Befehlsring am Objekt, Wabenleiste unten |
| O03 | erfüllt | Wabenknöpfe mit SVG-Symbol, Abzeichen der F-Taste und Tooltip; ebenso Befehlsring, Stationsreiter und Menü |
| O04 | erfüllt | Alle sichtbaren Texte Englisch: HUD, Station, Hilfe, Menü, Quests, Protokoll, Startfehlerseite |
| O05 | erfüllt | Grundgröße kompakt (eine HUD-Einheit 11,5 px bei 720p); Regler „UI scale“ 70–130 % im Menü, wirkt sofort und wird gespeichert; bei 70 % und 130 % in 1280×720 und 1920×1080 nichts überlappt oder abgeschnitten |
| O06 | erfüllt | Angedockt schwebt die Biene sichtbar in der Wabenhalle, die Kamera kreist um sie; Seitenleiste mit Deposit, Workshop, Quests, Healer, Leaderboard, Medals, Heimatstock und Undock; beim Andocken öffnet sich kein Fenster, jeder Knopf öffnet sein eigenes Fenster, Esc schließt es |
| O07 | erfüllt | Blütenkreis wächst mit der Zahl der Einträge; vermessen ohne Überlappung bei 8 und 9 Einträgen und bei UI scale 70, 100 und 130 % |

### Welt

| ID | Ergebnis | Nachweis |
|---|---|---|
| W01 | erfüllt | Kugel mit 7 km Radius (`shared/world.ts`) |
| W02 | erfüllt | Flug zum Rand (Seite, oben, unten, diagonal, mit Boost): Böen ab 6540 m, die harte Grenze bei 6940 m wird nie überschritten, keine sichtbare Wand; der Server klemmt Posen ebenfalls |
| W03 | erfüllt | 640 Inseln von y = −5602 m bis +5616 m in allen Oktanten; Abstand zum nächsten Nachbarn 51 m bis 2,1 km (Gruppen und Einzelgänger) |
| W04 | erfüllt | Inseldurchmesser 10,2–99,9 m; Blumen 0,28–0,48 m, Baumkronen bis etwa 12 m über der Grasnarbe |
| W05 | erfüllt | Felswand, Grasnarbe, Bäume, Blumen; Teiche mit Seerosen, z. B. Grove Isle 17: 27 Blätter, 20 Blüten |
| W06 | erfüllt | Kamerapunkt `islandBand`: Inseln zwischen und in Wolken |
| W07 | erfüllt | 9 Stöcke, etwa 17 × 19 × 14 m, frei schwebend; Andocken ist der Einflug in die Wabenhalle |
| W08 | erfüllt | 12 Fliegennester in der Objektliste; Fliegen entstehen und patrouillieren am Nest |

### Himmel und Wetter

| ID | Ergebnis | Nachweis |
|---|---|---|
| S01 | erfüllt | Tageszeit aus der Serverzeit, für alle Spieler gleich (`__game.sky.skyState()`) |
| S02 | erfüllt | Hauptlicht wechselt bei −12° Sonnenhöhe von der Sonne zum Mond; nachts Sterne mit Milchstraße |
| S03 | erfüllt | Sonnen- und Mondstrahlen durch Wolkenlücken und an Inseln vorbei (Kamerapunkt `towardSun`) |
| S04 | erfüllt | Volumenwolken ziehen mit dem Wind und verändern ihre Form |
| S05 | erfüllt | Massige Wolken in allen Höhen, darunter ein Wolkenmeer bis zum Horizont; beim Durchfliegen neblig |
| S06 | erfüllt | Wetter `misty-morning`: Nebelschleier um die Inseln |
| S07 | erfüllt | Sonnenaufgang mit korall- bis orangefarbenen Wolken und lavendelfarbenen Schatten |
| S08 | erfüllt | Wetterlagen clear, fair, misty-morning, overcast, shower und storm; Gewitter mit verästelten Blitzen in den Wolken, Donner mit Schallverzögerung; nach Regen mit etwas Glück ein Regenbogen |
| S09 | erfüllt | Wetter aus der Servertabelle `world_weather`, Übergänge werden überblendet |
| S10 | erfüllt | Tief nachtblauer Sternenhimmel, Mond mit Phase und Hof, Wolken blau-weiß mit Silberrändern |
| S11 | erfüllt | Mittags kräftiges Blau in großen Lücken zwischen den Wolken |

### Figuren

| ID | Ergebnis | Nachweis |
|---|---|---|
| F01 | erfüllt | Bienenmodell 0,199 m lang |
| F02 | erfüllt | Nachts Materialvariante „Night“ mit leuchtenden Ringen |
| F03 | erfüllt | Alle Blütenmaterialien leuchten nachts |
| F04 | erfüllt | Seerosenblüten leuchten nachts |
| F05 | erfüllt | Schmeißfliege 0,45 m, metallisch grün mit Facettenaugen und Borsten; Brummer 0,9 m; Königin 2,8 m |
| F06 | erfüllt | Fliegenaugen glühen nachts rot |
| F07 | erfüllt | Spuckeballen mit Effekt und Schaden (Protokoll „Splat! Fly spit hit you“) |
| F08 | erfüllt | Animationsgruppe `WingFlap` läuft, ihr Tempo folgt der Fluggeschwindigkeit |
| F09 | erfüllt | Lebensbalken über fremden Bienen |
| F10 | erfüllt | Tod → Geist (Variante „Ghost“, durchscheinend), Rückkehr nach Hause und Wiederbelebung im Stock |
| F11 | erfüllt | Beim Feuern Variante „Laser“ mit roten Augen; beide Mundteile öffnen sich über ihr Morph-Ziel |
| F12 | erfüllt | Die Biene schwirrt um ihre Flugbahn: im Schweben ±3,5 cm seitlich mit bis zu 8° Rollen, im Flug ±5 cm, im Warp ruhig; durchscheinende Teile (Flügel, Geist) bleiben vor Wolken sichtbar |

### Steuerung

| ID | Ergebnis | Nachweis |
|---|---|---|
| C01 | erfüllt | Ziehen dreht die Kamera, das Mausrad zoomt; Flugrichtung und Befehl bleiben unverändert |
| C02 | erfüllt | Doppelklick in den Raum: Drehung in etwa 0,85 s, Beschleunigung auf 14 m/s in etwa 3 s |
| C03 | erfüllt | Q, W, E, A, S, D mit Klick und die Leertaste lösen die Befehle aus; liegt das Ziel genau hinter der Biene, wendet sie |
| C04 | erfüllt | Rechtsklick auf einen Stock: Select, Approach, Orbit, Keep range, Align, Warp, Dock; weitere Abstände bietet der Befehlsring der Auswahl |
| C05 | erfüllt | Reiter Everything, Enemies, Flowers, Places; Sortierung nach Entfernung, Name und Art; Klick wählt aus |
| C06 | erfüllt | Q ohne Auswahl öffnet die Wählscheibe, Esc schließt sie |
| C07 | erfüllt | Klick auf den Tacho setzt das Tempo; Bremsen 14 → 7 m/s in etwa 0,5 s |
| C08 | erfüllt | Verschwindet das Ziel, fliegt Orbit weiter („Holding course“) und Keep range hält an („Target lost“) |
| C09 | erfüllt | Pfeiltasten steuern direkt, R/F ändern den Schub |
| C10 | erfüllt | Touch: linker Stick fliegt, rechter Stick zielt und feuert die Laser |
| C11 | erfüllt | Strg+Klick schaltet mehrere Ziele gleichzeitig auf, mit Fortschrittsanzeige |
| C12 | erfüllt | Modulleiste F1–F8 mit Zyklusfortschritt |
| C13 | erfüllt | Ansehen über Rechtsklick-Menü und Augen-Knopf im Befehlsring für Fliegen, Bienen, Blumenfelder, Inseln, Stöcke und Nester; Kamera kreist im dreifachen Objektradius (Islet 12: 25 m); „Look at my bee“ bzw. verschwundenes Ziel führt zurück |
| C14 | erfüllt | Aus dem Stand gemessen: 2,2 m/s nach 0,5 s, 4,0 m/s nach 1 s, 10,6 m/s (75 %) nach 4,2 s, 13,3 m/s nach 9 s – die EVE-Kurve mit τ = 3 s; Bremsen endet sauber im Stillstand |
| C15 | erfüllt | Kameraziel und Bienenmodell liegen in jedem Frame auf derselben Lage (gemessen 0 mm Abstand, auch im Warp); Serverkorrekturen gleiten in 0,15 s aus |

### Kampf

| ID | Ergebnis | Nachweis |
|---|---|---|
| K01 | erfüllt | Beide Laseraugen feuern unabhängig, auch auf verschiedene Ziele |
| K02 | erfüllt | Gatling aus sechs Beinen, 1 Pollen je Zyklus als Munition |
| K03 | erfüllt | Salve aus mehreren Stacheln folgt der Fliege; Schaden nach Raketenformel |
| K04 | erfüllt | Tooltips: Laser und Gatling mit Zyklus, optimaler Reichweite, Falloff und Tracking; Stachelraketen mit Tempo, Flugzeit, Reichweite, Explosionsradius und -tempo |
| K05 | erfüllt | Der Client meldet nur Modul an/aus; Reichweite, Energie, Munition, Treffer und Schaden rechnet der Server (`server/src/combat.ts`) |
| K06 | erfüllt | Fliegen kreisen auf ihrer Orbitdistanz und spucken; nachts greifen sie aus größerer Entfernung an |
| K07 | erfüllt | Gedrückte Maustaste zielt und feuert beide Laser |

### Pollen, Stock und Fortschritt

| ID | Ergebnis | Nachweis |
|---|---|---|
| P01 | erfüllt | Sammler: 6 Pollen je 3-s-Zyklus, mit Upgrade 8 |
| P02 | erfüllt | Feld 231 → 111 durch Sammeln, danach 1 Pollen je 6 s Nachwuchs |
| P03 | erfüllt | Abliefern im eigenen Stock: 120 Pollen → 120 Honig |
| P04 | erfüllt | Reiter Abliefern, Werkstatt, Quests, Heilen, Rangliste, Medaillen; Wiederbelebung beim Andocken |
| P05 | erfüllt | Alle 9 Upgrade-Arten vorhanden; gekaufte Stufen wirken (Lebenspunkte, Energie, Ladung, Tempo, Stachelzahl) |
| P06 | erfüllt | Quests schalten sich der Reihe nach frei; „Storm Runner“ am Wolkenrand (erreicht bei 6593 m) öffnet den Weg zum Endgegner |
| P07 | erfüllt | Witzige Quest-Texte, Fliegensprüche im Protokoll, Summen-Emote beim anderen Spieler sichtbar und hörbar, Medaillen |
| P08 | erfüllt | Top 10 nach Honig mit Abschüssen |

## Leistung

Integrierte GPU (Intel Xe-LPG), WebGPU, 1280 × 720, Qualitätsstufe `high`, je 6 s mit
`__game.measure(6)`:

| Ansicht | fps | Bildzeit p50 / p95 | CPU je Frame | Draw Calls |
|---|---|---|---|---|
| `chase` (Mittag) | 60 | 16,6 / 18,9 ms | 6,2 ms | 393 |
| `islandBand` (Mittag) | 60 | 16,7 / 18,9 ms | 6,1 ms | 634 |
| `hive` (Mittag) | 60 | 16,7 / 18,7 ms | 6,2 ms | 581 |
| `insideCloud` (Mittag) | 60 | 16,7 / 17,6 ms | 3,2 ms | 165 |
| `towardSun` (Mittag) | 60 | 16,7 / 18,7 ms | 5,6 ms | 351 |
| `towardSun` (Morgen mit Strahlen) | 60 | – / 18,4 ms | – | 331 |
| `islandBand` (Gewitter) | 60 | – / 19,4 ms | – | 640 |

Bildzeit, Draw Calls und Dreiecke halten die Budgets aus `spec/technik.md`. Im Wolkeninneren rechnet
der Raymarcher 1,5-fach gröber; der Nebel zeigt dort kaum Detail.

Speicher: Nach dem Laden aller 33 Modelle (alle neun Inseltypen) liegt der JavaScript-Heap bei
303 MB, davon 25 MB Geometriedaten.

Stabilität: Rundflüge über viele Inseln mit Wechseln aller Qualitätsstufen laufen ohne GPU-Fehler;
Inselkopien teilen die Instanzpuffer ihrer Quelle.

Mehrspieler-Last: siehe Lasttest in `spec/technik.md` (50 Bots, Weltakt unter 1 ms, Download
17,6 KB/s je Client bei verteilten Spielern).

## Offene Punkte zur Optik

Abgleich mit den Zielbildern des Users (`spec/look/`):

- Sonnen- und Mondstrahlen entstehen im Bildraum: Sie fehlen, wenn Sonne oder Mond deutlich
  außerhalb des Bilds stehen.
- Abends bleiben die Inseln Silhouetten ohne warmes Randlicht; im letzten Grad über dem Horizont
  färbt sich der Himmel karminrot.
- Der Mond zeigt seine Phase; das Zielbild zeigt einen Vollmond.
