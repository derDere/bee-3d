# Anforderungen – Abnahme-Checkliste

Jede Zeile ist eine prüfbare Anforderung. Spalte **Quelle**: `U` = Vorgabe des Users,
`2D` = Funktion des Vorgängers `bee-bee` (2D), `E` = eigene Ergänzung im Rahmen der Freigabe
„Quests, Upgrades und lustigen Content ausdenken“. Spalte **Prüfung** nennt, wie der Punkt
nachgewiesen wird.

## Projekt und Technik

| ID | Anforderung | Quelle | Prüfung |
|---|---|---|---|
| T01 | Privates Projekt: keine firmeneigenen Inhalte, Namen, Logos oder Favicons | U | Repo-Suche nach Firmennamen, eigenes Favicon |
| T02 | Docker-Mono-Repo nach Hausstandard (spec/, docs/, dev/, tools/, Makefile, docker-compose, env.example) | U | `make start wait init seed` auf frischem Klon |
| T03 | Client in Babylon.js mit TypeScript (strict), Backend SpacetimeDB mit TypeScript-Modul | U | `make compile` ohne Fehler |
| T04 | Multiplayer: mehrere Spieler sehen sich gegenseitig in Echtzeit | U, 2D | zwei Browser-Tabs |
| T05 | Automatisches Wiederverbinden nach Verbindungsabbruch | 2D | `__game.net.dropConnection()` |
| T06 | Verbindungsstatus sichtbar (verbinden, online, getrennt) | 2D | HUD |
| T07 | Koordinatenanzeige der eigenen Biene | 2D | HUD |
| T08 | Spiel bleibt ohne Server startbar (Erkundungsmodus statt Absturz) | 2D (Demo-Modus) | Server stoppen, Seite laden |
| T09 | Performant im Browser: Zielwert 60 fps auf integrierter GPU (1280×720, Stufe `high`), Qualitätsstufen low–ultra | U | `__game.measure(10)` |
| T10 | WebGPU bevorzugt, WebGL2 als Rückfallebene | E | `?engine=webgl2` |
| T11 | Paketversionen aktuell und live ermittelt | U | `package.json` gegen Registry |
| T12 | Name des Spiels „Bee3D“ | U | Titel, Startbildschirm |

## Oberfläche

| ID | Anforderung | Quelle | Prüfung |
|---|---|---|---|
| O01 | Verspielter, bieniger Look im Stil eines Fantasy- bzw. Kinderspiels, nicht Sci-Fi | U | HUD |
| O02 | Eigenes Layout, das nicht an EVE erinnert; nur die Steuerung folgt EVE | U | HUD |
| O03 | Knöpfe mit Symbolen statt Text (Tooltip und Tastenabzeichen) | U | HUD |
| O04 | Alle Texte im Spiel auf Englisch; wo möglich Symbole statt Text | U | Spiel, HUD |
| O05 | Kompakte Oberfläche; Größe im Menü einstellbar (UI scale) | U | Menü, 1280×720 und 1920×1080 |
| O06 | Andocken: die Biene bleibt im Hangar sichtbar; die Funktionen des Stocks stehen in einer Seitenleiste, jede öffnet ein eigenes Fenster im Spiel | U | Andocken |
| O07 | Rechtsklick-Kreis ohne Überlappung von Symbolen und Beschriftungen | U | Kontextmenü an Stock und Fliege |

## Welt

| ID | Anforderung | Quelle | Prüfung |
|---|---|---|---|
| W01 | Spielwelt im Himmel, Durchmesser ≥ 10 km (gewählt: Kugel mit 7 km Radius = 14 km) | U | `shared/world.ts` |
| W02 | Welt ist eine Kugel (Grenze = Abstand zum Ursprung); zum Rand hin immer wolkiger, außerhalb sehr wolkig; die Kollisionsgrenze selbst ist unsichtbar und undurchdringlich | U, 2D | an den Rand fliegen (Seite, oben, unten) |
| W03 | Sehr große Welt mit sehr vielen Inseln (≥ 500), wild im Raum verteilt (Höhe, Abstand, Gruppen) | U | `__game.state().world` |
| W04 | Inseln 10–100 m groß, Bäume und Blumen in realistischer Größe | U | Model Lab, Szene |
| W05 | Inseln mit Felswand, Grasnarbe, Bäumen, Blumen, Teich mit Seerosen (teils mit Blüte) | 2D | Szene |
| W06 | Inseln können zwischen und in Wolken liegen | U | Kamerapunkt `islandBand` |
| W07 | Bienenstöcke schweben frei wie Inseln, kleiner als große Inseln, groß genug zum Hineinfliegen (Andocken wie Raumstation in EVE) | U | Andocken |
| W08 | Fliegennester als Herkunft der Schmeißfliegen | E | Overview |

## Himmel, Licht, Wetter

| ID | Anforderung | Quelle | Prüfung |
|---|---|---|---|
| S01 | Tageszeiten Morgen, Mittag, Abend, Nacht im Zyklus, für alle Spieler gleich | U, 2D | `__game.sky.skyState()` |
| S02 | Sonne und Mond mit Übergabe des Hauptlichts, Sterne in der Nacht | 2D | Zeitraffer |
| S03 | Sonnen- und Mondstrahlen zwischen den Wolken und durch die Bäume der Inseln | U, 2D (rotierende Sonnenstrahlen) | Kamerapunkt `towardSun`, Insel vor der Sonne |
| S04 | Volumetrische Wolken überall, sie ziehen und verändern sich | U, 2D (ziehende Wolken) | Zeitraffer |
| S05 | Spiel findet in und zwischen massigen Wolken statt (3D-Wolkenmassen in allen Höhen, schon von weitem groß, beim Hineinfliegen neblig) — Fluggefühl wie „Watte aus dem Flugzeugfenster“ | U | Flug durch eine Wolke |
| S06 | Volumetrischer Nebel; morgens neblig auf und um die Inseln | U | Sonnenaufgang |
| S07 | Roter Sonnenaufgang, der auch in den Wolken glüht | U | Sonnenaufgang `towardSun` |
| S08 | Wetter: Sonne, Wolken, Regen, Gewitter mit Blitzen in den Wolken | U | `__game.sky.setWeather` |
| S09 | Wetterwechsel fließend und für alle Spieler gleich | E | zwei Tabs |
| S10 | Nachts ein fast schwarzer, tief nachtblauer Sternenhimmel mit vielen Sternen und hellem Mond; Wolken mondhell blau-weiß, Inseln als Silhouetten mit kühlen Lichtkanten | U | Nacht |
| S11 | Mittags bei gutem Wetter blauer Himmel zwischen den Wolken | U | Kamerapunkt `overview` mittags |

## Figuren und Leuchten

| ID | Anforderung | Quelle | Prüfung |
|---|---|---|---|
| F01 | Spieler steuern Bienen (~20 cm lang) | U | `state().player` |
| F02 | Bienen leuchten nachts | U, 2D | Nacht |
| F03 | Blumen auf den Inseln leuchten nachts | U, 2D | Nacht |
| F04 | Seerosenblüten leuchten nachts | 2D | Nacht |
| F05 | Böse Schmeißfliegen als realistisch-monströse Gegner | U | Model Lab, Kampf |
| F06 | Fliegen haben im Dunkeln rot leuchtende Augen | U | Nacht |
| F07 | Fliegen spucken auf Bienen | U | Kampf |
| F08 | Flügelschlag der Bienen animiert | 2D | Szene |
| F09 | Lebensbalken (HP) über Bienen | 2D | Szene |
| F10 | Tod: die Biene wird zum Geist (durchscheinend, kann nicht kämpfen) und wird im Bienenstock wiederbelebt | U, 2D | Kampf verlieren |
| F11 | Laser-Zustand: Augen glühen rot, Mund offen beim Feuern | 2D | Feuern |
| F12 | Bienenhaftes Flugbild: die Biene schwirrt leicht um ihre Flugbahn, statt starr wie ein Raumschiff zu gleiten | U | Flug, Schweben |

## Steuerung (EVE-Online-Vorbild, `dev/eve-online-steuerung.md`)

| ID | Anforderung | Quelle | Prüfung |
|---|---|---|---|
| C01 | Orbit-Kamera um die eigene Biene (linke Maustaste ziehen = drehen, Mausrad = Zoom); Kamera ändert die Flugrichtung nicht | U | Bedienung |
| C02 | Doppelklick in den Raum: Biene dreht träge in diese Richtung und fliegt los | U | Bedienung |
| C03 | Befehle mit Taste + Klick auf Objekt: Q hinfliegen, W umkreisen, E Abstand halten, A ausrichten, S Warp, D andocken, Leertaste anhalten | U | Bedienung |
| C04 | Rechtsklick-Kontextmenü mit denselben Befehlen | U | Bedienung |
| C05 | Overview: Objektliste mit Typ, Name, Entfernung, sortierbar, Klick wählt aus | U | HUD |
| C06 | Q ohne Ziel öffnet die Q-Wählscheibe (Richtung/Entfernung, dann Höhe) | U | Bedienung |
| C07 | Tempo über Klick auf den Tachometer; Trägheit beim Beschleunigen und Bremsen | U | Bedienung |
| C08 | Orbit vs. Abstand halten: bei zerstörtem Ziel fliegt Orbit weiter, Abstand halten bleibt stehen | U | Kampf |
| C09 | Direkte Tastatursteuerung als Zusatz (Pfeiltasten) | U | Bedienung |
| C10 | Touch: zwei virtuelle Sticks (links Richtung, rechts zielen und Laser feuern) | 2D | Touch-Emulation |
| C11 | Ziele aufschalten (Strg+Klick), mehrere Ziele gleichzeitig | U (EVE-Waffen) | Kampf |
| C12 | Modulleiste mit Tastenkürzeln F1–F8 | U (EVE-Module) | HUD |
| C13 | Ansehen wie in EVE: Kamera auf andere Objekte richten – Fliegen, Bienen, Blumenfelder, Inseln, Stöcke, Nester – und zurück zur eigenen Biene | U | Bedienung |
| C14 | Sanftes Losfliegen: Trägheit nach der EVE-Formel v = v_max · (1 − e^(−t/τ)) | U | Tempo über die Zeit messen |
| C15 | Die Biene bleibt bei schnellem Flug und im Warp in der Kameramitte; Serverkorrekturen gleiten statt zu springen | U | Flug, Warp |

## Waffen und Kampf

| ID | Anforderung | Quelle | Prüfung |
|---|---|---|---|
| K01 | Laseraugen: jedes Auge ist ein eigenes Modul und kann auf ein anderes Ziel feuern | U | zwei Ziele aufschalten |
| K02 | Pollen-Gatling: aus allen 6 Beinen, schnelle Feuerrate, verbraucht Pollen als Munition | U | Kampf |
| K03 | Stachelraketen: mehrere Stachel pro Salve, zielsuchend | U | Kampf |
| K04 | Waffen nach EVE-Art: Aktivierung als Modul mit Zykluszeit, optimaler Reichweite, Falloff, Tracking (Laser, Projektile) bzw. Explosionswerten (Raketen) | U | Waffeninfo im HUD |
| K05 | Server entscheidet Treffer und Schaden (Cheat-Schutz) | E | Modul-Review |
| K06 | Fliegen greifen an, umkreisen ihr Ziel, spucken; Nacht macht sie aggressiver | E | Kampf |
| K07 | Laser per Maus wie im Vorbild (gedrückt halten zielt und feuert) | 2D | Bedienung |

## Sammeln, Bienenstock, Fortschritt

| ID | Anforderung | Quelle | Prüfung |
|---|---|---|---|
| P01 | Pollen an Blumen der Inseln sammeln wie Asteroiden-Mining in EVE (Modul, Zyklus, Reichweite, Ladung) | U | Sammeln |
| P02 | Blumenfelder leeren sich und wachsen nach | E | Sammeln |
| P03 | Pollen im eigenen Bienenstock abliefern → Honig | U | Andocken |
| P04 | Bienenstock-Menü: Abliefern, Reparatur, Wiederbelebung, Upgrades, Quests | U, E | Andocken |
| P05 | Upgrades für die Biene (Laser, Gatling, Raketen, Sammler, Ladung, Flügel, Panzer, Antennen, Nektartank) | U | Shop |
| P06 | Quests (Einführung, Sammeln, Jagd, Erkundung, Geschichte mit Endgegner) | U | Quest-Brett |
| P07 | Lustiger Inhalt: witzige Quest-Texte, Fliegen-Sprüche, Summen-Emote, Erfolge | U | Spiel |
| P08 | Rangliste (Honig) | E | Bienenstock-Menü |
