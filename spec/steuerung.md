# Steuerung und HUD

Grundlage: `dev/eve-online-steuerung.md`. Der Spieler gibt Befehle, die Biene führt sie mit
eigener Trägheit aus; die Kamera ist von der Flugrichtung entkoppelt.

## Maus

| Eingabe | Wirkung |
|---|---|
| Linke Maustaste ziehen (Raum) | Kamera um die Biene drehen |
| Mausrad | Zoom (0,5 m … 400 m Abstand) |
| Linksklick auf Objekt (Raum oder Overview) | auswählen → Infofeld „Auswahl“ |
| Doppelklick in den leeren Raum | Biene dreht in diese Richtung und fliegt los |
| Strg + Linksklick auf Objekt | Ziel aufschalten |
| Strg + Umschalt + Linksklick | Ziel lösen |
| Rechtsklick auf Objekt oder Raum | Kontextmenü mit allen Befehlen |
| Klick auf den Tachometer | Tempo in Prozent des Höchsttempos setzen |
| Alt + linke Maustaste halten | beide Laseraugen feuern auf den Punkt unter dem Mauszeiger; liegt dort ein Gegner, trifft der Laser ihn ohne Aufschalten (Steuerung des 2D-Vorbilds) |

## Kamera

- Die Orbit-Kamera folgt der gezeichneten Lage der Biene: Die Biene bleibt auch im Warp in der
  Bildmitte. Korrekturen des Servers gleiten in etwa 0,15 s aus, statt zu springen.
- **Ansehen** (Look at, wie in EVE): Kontextmenü oder Augen-Knopf im Befehlsring der Auswahl. Die
  Kamera kreist dann um das Objekt – Fliege, Biene, Blumenfeld, Insel, Stock oder Nest – im Abstand
  des dreifachen Objektradius, mindestens 2 m. „Look at my bee“ bzw. erneut das Auge kehrt zur
  eigenen Biene zurück; verschwindet das Objekt, kehrt die Kamera von selbst zurück.
- Angedockt schwebt die Biene in der Wabenhalle des Stocks; die Kamera kreist um sie (Zoom bis
  2,5 m).

## Befehle

Taste gedrückt halten und Objekt anklicken; ohne Klick gilt der Befehl für die aktuelle Auswahl.

| Taste | Befehl | Hinweis |
|---|---|---|
| Q | Hinfliegen | ohne Auswahl öffnet Q die Wählscheibe: erster Klick Richtung und Entfernung in der Ebene, zweiter Klick die Höhe; die Biene fliegt genau dorthin und hält an |
| W | Umkreisen | Standardabstand 20 m (Infofeld: 10/20/40/80 m) |
| E | Abstand halten | Standardabstand 15 m (Infofeld: 5/15/30/60 m) |
| A | Ausrichten | dreht die Flugrichtung zum Ziel |
| S | Warp | ab 150 m Entfernung |
| D | Andocken | nur Bienenstöcke, ≤ 45 m |
| Leertaste | Anhalten | |
| F1–F8 | Module | auf das aktive Ziel; erneut drücken beendet nach dem Zyklus |
| B | Summen | Emote |
| Tab | nächstes aufgeschaltetes Ziel aktiv | |
| Esc | Menü / Abbrechen | |

**Ziel weg:** Beim Umkreisen fliegt die Biene in der letzten Richtung weiter, beim Abstand halten
bleibt sie stehen.

## Direkte Tastatursteuerung

Ergänzend zu den Befehlen: Pfeiltasten drehen die Flugrichtung (links/rechts gieren,
hoch/runter neigen), R beschleunigt, F bremst. Jede Pfeiltaste beendet einen laufenden Befehl
und setzt die Biene in den Handflug.

## Touch

- Linke Bildschirmhälfte: virtueller Stick für die Flugrichtung (Handflug).
- Rechte Bildschirmhälfte: virtueller Stick zum Zielen; solange er gehalten wird, feuern beide
  Laseraugen in die Stickrichtung (wie im 2D-Vorbild).
- Tippen wählt aus, Doppeltippen fliegt hin, Zwei-Finger-Ziehen dreht die Kamera, Spreizen zoomt.
- Befehle und Module über die Schaltflächen des HUD.

## HUD

| Bereich | Inhalt |
|---|---|
| oben links | Bienenplakette: Porträt (Klick = Summen), Name, Verbindungsstatus, Lebenspunkte, Energie, Ladung |
| links darunter | Liste „Nearby“ mit Reitern Everything, Enemies, Flowers, Places; Symbol, Name, Typ, Entfernung, Tempo; sortierbar nach Entfernung, Name und Art; einklappbar |
| oben rechts | Honig, Uhr mit Tagesphase und Wetter, Hilfe, Menü |
| unten Mitte | Hinweis beim Ansehen, aufgeschaltete Ziele als Blasen mit Blütenring (LP) und Aufschaltfortschritt, Wabenleiste der Module F1–F8 mit Zyklusfortschritt; links daneben die Flugsteuerung mit Pusteblumen-Tacho (klickbar) und Stopp (Space) |
| unten links | Kompass mit Kurs, Koordinaten und Höhe |
| unten rechts | Ereignisprotokoll (Kampf, Sammeln, Sprüche der Fliegen, Systemmeldungen) |
| im Raum | Klammern um Objekte (Fliegen rot, Bienen himmelblau, Bienenstöcke honiggelb, Blumenfelder rosa, Inseln grün, Nester violett), Namen bei Auswahl und Aufschaltung, LP-Balken über Bienen; Auswahl-Blase am Objekt mit Blüten-Befehlsring (Approach, Orbit, Keep range, Align, Warp, Dock, Lock, Look at) |
| angedockt | Biene schwebt in der Wabenhalle; Seitenleiste links mit Stockwappen, den Seiten Deposit, Workshop, Quests, Heal, Leaderboard und Medals sowie Set as home und Undock; jede Seite öffnet ein eigenes Fenster (höchstens eins, Esc schließt es) |
| Start | Namenseingabe mit Vorschlag, Startknopf (schaltet Ton frei) |
| Menü (Esc) | Qualitätsstufe, Lautstärke, Maus invertieren, weniger Blitze, UI scale (70–130 %), Steuerungshilfe |

Alle Maße der Oberfläche hängen an einer HUD-Einheit; „UI scale“ wirkt als Faktor darauf. Auf
Touch-Geräten bleibt die Grundgröße fingergerecht, der Regler wirkt zusätzlich.
