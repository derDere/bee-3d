# Spieldesign – Bienenwelt in der Himmelskugel

## Idee

Die Welt ist eine Kugel aus Himmel, 14 km im Durchmesser. Hunderte Inseln schweben kreuz und quer
darin, zwischen massigen Haufenwolken, die den ganzen Raum füllen — man fliegt mitten in und
zwischen den Wolken. Zum Rand der Kugel hin wird es immer wolkiger, außerhalb ist alles Wolke.
Bienen sammeln Pollen von den Blumen der Inseln und bringen ihn in schwebende Bienenstöcke. Aus
den Fliegennestern schwärmen Schmeißfliegen und machen Jagd auf alles, was nach Honig riecht.

Vorbild für Steuerung und Spielablauf ist EVE Online: Befehle statt direkter Lenkung, Ziele
aufschalten, Module aktivieren, Asteroiden-Mining als Pollensammeln, Raumstationen als
Bienenstöcke. Aussehen und Oberfläche sind dagegen verspielt und bienig wie ein Fantasy- bzw.
Kinderspiel.

Das Spiel heißt **Bee3D**. Alle Texte im Spiel sind Englisch, wo möglich stehen Symbole statt
Text; die Namen in den Tabellen unten sind die Namen im Spiel.

## Maßstab

| Größe | Wert |
|---|---|
| Weltkugel | Radius 7 000 m um den Ursprung (Durchmesser 14 km) |
| Wolken | Wolkenmassen von einigen hundert Metern bis Kilometergröße in allen Höhen, tiefer etwas dichter, zum Kugelrand hin geschlossen |
| Inseln | 640 Stück im ganzen Kugelvolumen bis 6 100 m vom Mittelpunkt, Durchmesser 10–100 m (45 % klein 10–25 m, 35 % mittel 25–55 m, 20 % groß 55–100 m), in Archipelen gehäuft, dazwischen Einzelgänger |
| Bienenstöcke | 9 Stück, je ~18 m hoch, Flugloch ~3 m |
| Fliegennester | 12 Stück an verrotteten Inseln |
| Biene | 0,20 m lang |
| Schmeißfliege | 0,45 m; Brummer 0,9 m; Fliegenkönigin 2,8 m |
| Bäume | 6–20 m hoch |
| Blumen | 0,15–0,6 m hoch |

## Weltgrenze

Die Grenze ist allein der Abstand zum Ursprung: eine Kugel mit 7 000 m Radius. Sichtbar ist sie
nur als Wolkenrand — zum Rand hin werden die Wolken immer zahlreicher und dichter, außerhalb der
Kugel ist alles Wolke; nach oben bleiben Lücken für Sonne, Mond und Sterne. Die harte Grenze selbst
ist unsichtbar: Ab 400 m davor drücken Böen die Biene zurück, durchfliegen lässt sie sich nicht.
Server und Client prüfen dieselbe Grenzfunktion (`shared/world.ts`).

## Tageslauf und Wetter

- Ein Tag dauert 24 Minuten Echtzeit; Dämmerungen bekommen mehr Zeit (Morgen 7,5 min, Mittag
  3,5 min, Abend 8 min, Nacht 5 min). Die Uhr leitet sich aus dem Server-Takt ab, alle Spieler
  sehen denselben Himmel.
- Wetterlagen: `clear`, `fair`, `misty-morning`, `overcast`, `shower`, `storm`. Der Wetterplan ist
  deterministisch aus Weltseed und Tagesnummer: neblige Morgen nach klaren Nächten, Haufenwolken
  über den Tag, Schauer und Gewitter am Nachmittag, klare Abende. Der Betreiber kann eine Lage
  per Owner-Reducer erzwingen.
- Regen fällt unter Regenzellen; Gewitter zeigen Blitze in und zwischen den Wolken, Donner folgt
  mit Schallverzögerung. Nach Regen erscheint mit etwas Glück ein Regenbogen.
- Nachts leuchten Bienen (Hinterleibsringe, Fühlerkugeln), Blumen und Seerosenblüten; Fliegen
  tragen rot glühende Augen. Fliegen sind nachts aggressiver (größerer Aggro-Radius).

### Stimmung je Tageszeit (Zielbilder des Users)

Überall gilt: massige Haufenwolken füllen den Raum, die Inseln mit Bäumen und Wasserfällen
schweben mittendrin, ferne Inseln verschwimmen im Dunst. Die Zielbilder liegen unter `spec/look/`:
[Morgen](look/morgen.jpg), [Mittag](look/mittag.jpg), [Abend](look/abend.jpg),
[Nacht](look/nacht.jpg), [Gewitter](look/gewitter.jpg).

| Zeit | Stimmung |
|---|---|
| Morgen | Wolken rosa-koralle bis pfirsich mit goldenen Rändern, Schattenseiten lavendel-rosa; tief stehende, golden-weiße Sonne mit kräftigen Lichtstrahlen durch Lücken und an Inseln vorbei; weiche Nebelschleier um die Inseln; lavendelblauer Himmel in den Lücken. |
| Mittag (gutes Wetter) | Strahlend weiße, fluffige Wolken mit kühl hellblauen Schattenseiten; große, kräftig blaue Himmelslücken; helle Sonne mit Strahlenkranz und Strahlen; hell und freundlich, leichter Nebel an den Inseln. |
| Abend | Satter und röter als der Morgen: Wolken rosa-rot bis orange, Schattenseiten violett-magenta, lila Himmel mit Schleierwolken; Sonne als heller Ball am Horizont; kein Nebel, klare Luft, Inseln mit warmem Randlicht; deutliche Lichtstrahlen. |
| Nacht | Fast schwarzer, tief nachtblauer Sternenhimmel; heller Mond mit Lichthof und Mondstrahlen durch die Wolkenlücken; Wolken mondhell blau-weiß mit silbernen Rändern und tiefblauen Schatten; Inseln als Silhouetten mit kühlen Lichtkanten. |
| Gewitter | Tiefes Indigo- und Blaugrau; dichte, blumenkohlartige Wolken mit viel Feinstruktur; mehrere gleichzeitig sichtbare, verästelte blau-weiße Blitze, die die Wolken um sich bläulich aufleuchten lassen; dichter Regen vorn und Regenvorhänge in der Tiefe. |

## Biene

| Wert | Basis | Pro Upgrade-Stufe | Stufen |
|---|---|---|---|
| Höchsttempo | 14 m/s | +8 % (Flügelmuskeln) | 5 |
| Wendigkeit | 1,6 rad/s | +8 % (Flügelmuskeln) | — |
| Trägheit τ (EVE-Formel v = v_max · (1 − e^(−t/τ))) | 3 s, Ausrichtzeit bis 75 % Tempo ≈ 4,2 s; Bremsen mit 0,6 τ | ÷ (1 + 0,08 je Stufe) (Flügelmuskeln) | — |
| Lebenspunkte | 100 | +20 (Chitinpanzer) | 5 |
| Nektar-Energie | 100, +6/s | +20, +1/s (Nektartank) | 5 |
| Ladung | 120 Pollen | +60 (Pollenhöschen) | 5 |
| Aufschaltreichweite / -anzahl | 300 m / 2 Ziele | +60 m / +1 Ziel ab Stufe 2 und 4 (Antennen) | 5 |
| Warp-Tempo | 320 m/s | — | — |

- **Warp:** nur zu Objekten ≥ 150 m entfernt; die Biene richtet sich zuerst aus (≤ 12° Abweichung,
  ≥ 75 % Tempo), dann zieht der Sturmwind sie mit 320 m/s zum Ziel und setzt sie 15 m davor ab.
  Während des Warps sind Module aus.
- **Boost (F6):** verdoppelt das Höchsttempo, kostet 10 Energie/s.
- **Flugbild:** Die Biene schwirrt sichtbar um ihre Flugbahn – seitliches Pendeln mit passendem
  Rollen (±5 cm im Flug), leichtes Auf und Ab, im Stand weiches Schweben in Achten. Im Warp fliegt
  sie ruhig. Die Kamera folgt der Flugbahn selbst.

## Module und Waffen

Module laufen in Zyklen: Aktivieren (Hotkey oder Klick) startet den ersten Zyklus sofort, jeder
Zyklus wirkt am Zyklusbeginn, Deaktivieren beendet das Modul nach dem laufenden Zyklus. Der
Server prüft Ziel, Reichweite, Energie und Munition und würfelt das Ergebnis.

| Taste | Modul | Reichweite | Zyklus | Wirkung | Kosten |
|---|---|---|---|---|---|
| F1 | Left Laser Eye (Laserauge links) | optimal 55 m, Falloff 35 m | 2,0 s | 9 Schaden, Tracking 0,35 rad/s | 4 Energie |
| F2 | Right Laser Eye (Laserauge rechts) | wie F1 | 2,0 s | wie F1, eigenes Ziel | 4 Energie |
| F3 | Pollen Gatling (6 Beine) | optimal 20 m, Falloff 45 m | 0,5 s | 6 Kugeln × 0,6 Schaden, Tracking 0,9 rad/s | 1 Pollen |
| F4 | Stinger Missiles (Stachelraketen) | Flugzeit 6 s × 45 m/s = 270 m | 8,0 s | Salve aus 3 Stacheln × 14 Schaden, Explosionsradius 0,8 m, Explosionstempo 9 m/s | 15 Energie |
| F5 | Pollen Collector (Pollensammler) | 18 m zum Blumenfeld | 3,0 s | 6 Pollen in die Ladung | 2 Energie |
| F6 | Wing Boost (Flügel-Boost) | — | 1,0 s | Höchsttempo × 2 | 10 Energie |
| F7 | Nectar Heal (Nektar-Heilung) | selbst | 4,0 s | +12 Lebenspunkte | 18 Energie |
| F8 | Scent Scanner (Duftscanner) | 2 000 m | 10 s | zeigt Goldblumen und Nester im Overview | 25 Energie |

### Formeln (EVE-Vorbild, vereinfacht)

- **Geschütze (Laser, Gatling):**
  `Trefferchance = 0,5 ^ ((ω / (Tracking · s / 0,5))² + (max(0, d − optimal) / Falloff)²)`
  mit Winkelgeschwindigkeit ω (rad/s), Signaturradius s des Ziels (m) und Entfernung d.
  Treffer streuen den Schaden auf 60–120 %.
- **Raketen:** `Schaden = Basis · min(1, s/E, (s/E · vE/vZ)^0,8)` mit Explosionsradius E,
  Explosionstempo vE und Tempo des Ziels vZ. Einschlag nach Flugzeit `d / 45 m/s`.
- **Spucke der Fliegen:** Geschoss mit 30 m/s; Trefferchance `clamp(1 − vQuer / 30 · 0,6, 0,25, 1)`.

## Upgrades (Werkstatt im Bienenstock)

Kosten je Stufe in Honig: 40, 90, 160, 260, 400.

| Upgrade | Wirkung je Stufe |
|---|---|
| Lens Polish | Laser +15 % Schaden, +8 % optimale Reichweite |
| Gatling Joints | Gatling −10 % Zykluszeit |
| Stinger Quiver | +1 Stachel je Salve |
| Collector Brushes | Pollensammler +2 Pollen je Zyklus |
| Pollen Pants | Ladung +60 |
| Wing Muscles | Tempo und Wendigkeit +8 %, Trägheit geringer |
| Chitin Armour | Lebenspunkte +20 |
| Feeler Antennae | Aufschaltreichweite +60 m, ab Stufe 2 und 4 je +1 Ziel |
| Nectar Tank | Energie +20, Regeneration +1/s |

## Sammeln (Pollen-Mining)

- Jede Insel trägt 1–7 Blumenfelder (klein 1–2, mittel 2–4, groß 4–7) mit 60–200 Pollen, skaliert mit
  der Inselgröße (×0,7 bis ×1,4, also 42–280 Pollen).
- Ein Feld wächst mit 1 Pollen je 6 s nach (bis zur Kapazität); der Wert wird beim Lesen aus
  Zeitstempel und Stand berechnet, ohne Schreiblast je Takt.
- 2 % der Felder sind **Goldblumen**: Goldpollen zählt beim Abliefern das Fünffache.
- Nachts liefern leuchtende Blumen +25 % Pollen je Zyklus.
- Abliefern im Bienenstock: 1 Pollen = 1 Honig, 1 Goldpollen = 5 Honig.

## Bienenstöcke (Stationen)

| Name | Rolle |
|---|---|
| Queen's Hive | Mitte der Welt, Startpunkt |
| Linden Hive, Clover Grove, Honeydew, Comb Castle, Sunny Comb, Misty Skep, Storm Comb, Moon Honey | in alle Raumrichtungen verteilt, Moon Honey nahe dem Wolkenrand |

- Andocken (D) aus ≤ 45 m: Die Biene fliegt ins Flugloch, die Kamera zeigt die Wabenhalle.
- Menü: **Abliefern** (Ladung → Honig), **Werkstatt** (Upgrades), **Quests**, **Heilstation**
  (volle Lebenspunkte gegen Honig: 1 Honig je 4 LP), **Rangliste**, **Heimatstock festlegen**.
- Geister werden beim Andocken wiederbelebt.
- Jeder Stock zeigt die gesamte dort abgelieferte Honigmenge (Stockbilanz).

## Gegner

| Art | Länge | LP | Tempo | Orbit | Angriff | Aggro (Tag/Nacht) | Beute |
|---|---|---|---|---|---|---|---|
| Blowfly (Schmeißfliege) | 0,45 m | 60 | 11 m/s | 25 m | Spucke 4 Schaden alle 3,2 s, 60 m | 110 / 170 m | 8 Honig |
| Bluebottle (Brummer) | 0,9 m | 220 | 8 m/s | 35 m | Spucke 10 Schaden alle 4,5 s, 90 m | 140 / 200 m | 30 Honig |
| Fly Queen (Fliegenkönigin) | 2,8 m | 2 500 | 6 m/s | 50 m | Fächer aus 5 Spuckeballen à 8 alle 5 s, 120 m; ruft Schmeißfliegen | 220 / 280 m | 600 Honig |

- Nester halten bis zu 6 Schmeißfliegen und 2 Brummer und füllen alle 40 s nach. Die Königin
  wohnt im Nest „Maggot Keep“ nahe dem Wolkenrand und kehrt 10 min nach ihrem Tod zurück.
- Höchstens 3 Fliegen eines Nests jagen gleichzeitig dieselbe Biene; die übrigen patrouillieren weiter.
- Verhalten: Patrouille um das Nest → Ziel im Aggro-Radius aufschalten → umkreisen und spucken →
  unter 20 % LP Flucht zum Nest → Leine: weiter als 450 m vom Nest zurückkehren. Geister und
  angedockte Bienen sind uninteressant.
- Der Server simuliert nur Fliegen in 700 m Umkreis eines Spielers; die übrigen ruhen.

## Tod und Geist

LP 0 → die Biene wird zum Geist: durchscheinend cyan, 60 % Tempo, keine Module, die Ladung ist
verloren. Andocken in einem beliebigen Bienenstock belebt sie mit vollen LP wieder; der
Heimatstock bietet zusätzlich „Sofort heimkehren“ (Warp ohne Mindestabstand).

## Quests

| Nr | Titel | Ziel | Belohnung |
|---|---|---|---|
| 1 | First Flight | einer Insel auf 30 m nahe kommen | 20 Honig |
| 2 | Pollen Sample | 30 Pollen sammeln | 30 Honig |
| 3 | Homecoming | Pollen in einem Bienenstock abliefern | 25 Honig |
| 4 | No Buzzing Allowed | 3 Schmeißfliegen besiegen | 60 Honig |
| 5 | Night Shift | 50 Pollen bei Nacht sammeln | 80 Honig |
| 6 | Comb Tour | an 3 verschiedenen Bienenstöcken andocken | 90 Honig |
| 7 | Gold Rush | 10 Goldpollen sammeln | 150 Honig |
| 8 | Big Bluebottles | 2 Brummer besiegen | 160 Honig |
| 9 | Storm Runner | den Wolkenrand der Welt berühren | 120 Honig |
| 10 | The Fly Queen | die Fliegenkönigin besiegen (Gruppe empfohlen) | 800 Honig |
| W1 | Delivery Order (wiederholbar) | 100 Pollen abliefern | 40 Honig |
| W2 | Pest Control (wiederholbar) | 10 Fliegen besiegen | 70 Honig |

Die Quests 1–10 bilden die Geschichte „The Storm and the Fly Queen“ und schalten sich
nacheinander frei; W1 und W2 gibt es ab Quest 3.

## Lustiger Inhalt

- Fliegen rufen beim Aufschalten Sprüche in das Ereignisprotokoll („Bzzzt! Your honey is
  mine!“, „I'll spit in your combs!“, „Buzz off, stripes!“).
- Summen-Emote (Taste B): Die Biene summt, alle in der Nähe hören und sehen es.
- Namensvorschläge beim Start („Bumble Betty“, „Sir Buzzalot“, „Buzzy McBuzzface“ …).
- Erfolge: „Erster Stich“, „Pollenprinz/-prinzessin“ (1 000 Pollen), „Geisterstunde“ (als Geist
  bei Nacht fliegen), „Kammerjäger“ (100 Fliegen), „Sturmläufer“ (Wolkenrand berührt), „Königinnenmörder“.
- Quest-Texte mit Augenzwinkern (Briefe der Stockkönigin, Fliegen-Steckbriefe).

## Rangliste

Die zehn Spieler mit dem meisten jemals abgelieferten Honig, sichtbar in jedem Bienenstock.
