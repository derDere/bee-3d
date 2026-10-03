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
| Strg + Leertaste | Anhalten | |
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
| oben links | Verbindungsstatus, Name, Honig, Ladung |
| oben Mitte | aufgeschaltete Ziele als Kreise mit LP-Ring und Entfernung; das aktive Ziel ist hervorgehoben |
| rechts oben | Infofeld „Auswahl“: Name, Typ, Entfernung, Tempo, Befehlsknöpfe Q W E A S D, Aufschalten |
| rechts | Overview mit Reitern „Alle“, „Kampf“, „Sammeln“, „Navigation“; Spalten Symbol, Name, Typ, Entfernung, Tempo; sortierbar |
| unten Mitte | Schiffs-HUD: LP- und Energiering, Tachometer (klickbar), Stopp, Modulleiste F1–F8 mit Zyklusfortschritt |
| unten links | Koordinaten, Höhe, Kompass, Ereignisprotokoll (Kampf, Sammeln, Sprüche der Fliegen) |
| im Raum | Klammern um Objekte (Fliegen rot, Bienen blau, Bienenstöcke gelb, Blumenfelder weiß, Nester violett), Namen bei Auswahl und Aufschaltung, LP-Balken über Bienen |
| angedockt | Wabenhalle als Hintergrund, Stationsmenü mit den Reitern aus `spieldesign.md` |
| Start | Namenseingabe mit Vorschlag, Knopf „Losfliegen“ (schaltet Ton frei) |
| Menü (Esc) | Qualitätsstufe, Lautstärke, Maus invertieren, Steuerungshilfe |
