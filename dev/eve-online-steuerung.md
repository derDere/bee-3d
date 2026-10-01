# Referenz: Steuerung in EVE Online

Recherche als Vorbild für die Steuerung in bee-3d. Beschreibt, wie der Spieler in EVE Online
sein Schiff bewegt.

## Grundprinzip

Der Spieler lenkt das Schiff nicht direkt, sondern gibt ihm Befehle („flieg dorthin“,
„umkreise das in 10 km“). Das Schiff führt sie selbst aus, träge und mit eigener
Wendigkeit. Die Kamera ist von der Flugrichtung entkoppelt.

## Kamera

- Orbit-Kamera um das eigene Schiff: Der Spieler dreht sie mit gedrückter linker Maustaste
  und zoomt mit dem Mausrad.
- Die Kamerablickrichtung ändert die Flugrichtung nicht.
- Zusätzlich gibt es eine Ich-Perspektive aus dem Cockpit.

## Bewegung

- **Doppelklick in den leeren Raum:** Das Schiff dreht sich träge in diese Richtung und
  fliegt los. Welche Richtung herauskommt, hängt von der Kameraperspektive ab; für
  Präzision zoomt der Spieler weit heraus.
- **Befehle mit Taste plus Klick auf ein Objekt** (im Raum oder in der Objektliste, dem
  „Overview“):
  - Q: hinfliegen
  - W: in festem Abstand umkreisen
  - E: festen Abstand halten
  - A: ausrichten
  - S: Warp
  - D: andocken oder springen
  - Ctrl+Space: anhalten
- Dieselben Befehle stehen im Rechtsklick-Kontextmenü.
- Orbit und Abstand-halten unterscheiden sich, wenn das Ziel zerstört wird: Beim Orbit
  fliegt das Schiff in seiner letzten Richtung weiter, beim Abstand-halten bleibt es stehen.
- **Q-Wählscheibe:** Q ohne Ziel öffnet eine kreisförmige Scheibe. Der erste Klick legt
  Richtung und Entfernung in der Ebene fest, der zweite die Höhe. Das Schiff fliegt genau
  diese Strecke und hält dann an.
- **Tempo:** Der Spieler klickt auf den Tachometer unten in der Schiffsanzeige. Das Schiff
  beschleunigt und bremst mit Trägheit.
- **Wendigkeit und Höchsttempo** sind getrennte Schiffswerte. Große Schiffe drehen spürbar
  langsam.

## Tastatursteuerung

- CCP hat eine direkte Steuerung als Opt-in-Beta ergänzt: Pfeil links lenkt nach links,
  Pfeil hoch nach oben.
- Anlass: In Tests erwarteten neue Spieler WASD-Steuerung und empfanden das Klicksystem als
  fremd.
- Die Tasten sind standardmäßig nicht belegt; der Spieler weist sie selbst in den
  Tastatureinstellungen zu. Die Befehlssteuerung bleibt das Hauptsystem.

## Einordnung

Der Spieler sagt nur, was passieren soll (Ziel, Abstand, Tempo), und das Schiff übernimmt
das Wie mit seiner Trägheit. Das passt zu großen, trägen Schiffen und taktischem Überblick,
nicht zu schnellem Actionflug.

## Quellen

- [Manual piloting – EVE University Wiki](https://wiki.eveuniversity.org/Manual_piloting)
- [Quick, give me manual control! – EVE Online News](https://www.eveonline.com/news/view/quick-give-me-manual-control)
- [Ship Piloting – EVE Online Guide (Thonky)](https://www.thonky.com/eve-online-guide/ship-piloting)
- [The most useful EVE Online keyboard shortcuts](https://justabout.com/eve-online/33987/the-most-useful-eve-online-keyboard-shortcuts)
- [Manual control for ships on the test server – MMORPG.com](https://forums.mmorpg.com/discussion/423689/manual-control-for-ships-on-the-test-server)
