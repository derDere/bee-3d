# Bee3D

Ein Multiplayer-Bienenspiel im Browser: Bienen von 20 cm fliegen zwischen massigen Volumenwolken
und schwebenden Inseln einer 14 km großen Himmelskugel, sammeln Pollen wie Asteroiden-Mining in
EVE Online, docken an schwebenden Bienenstöcken an und kämpfen mit Laseraugen, Pollen-Gatling und
Stachelraketen gegen spuckende Schmeißfliegen. Die Steuerung folgt EVE Online, das Aussehen ist
verspielt und bienig; alle Texte im Spiel sind Englisch.

| Teil | Technik |
|---|---|
| Client | Babylon.js 9 (WebGPU, Rückfall WebGL2), TypeScript strict, Vite |
| Server und Datenbank | SpacetimeDB 2, Modul in TypeScript (`server/`) |
| Gemeinsamer Code | `shared/` – Weltgenerator, Regeln, Quests (Client und Modul) |
| Modelle | Python-Generatoren unter `tools/models/` (uv) |

## Voraussetzungen

- Docker (Engine läuft; die Makefile-Targets starten sie nicht selbst)
- Node.js mit npm, Python 3, GNU make
- für Modell-Neubauten zusätzlich [uv](https://docs.astral.sh/uv/)

## Schnellstart

```
make start wait init seed open
```

`make start` kopiert beim ersten Mal `env.example` nach `.env`, baut Client und Modul, startet
SpacetimeDB, veröffentlicht das Modul und startet in `APP_ENV=dev` den Vite-Dev-Server unter
`http://127.0.0.1:5173/`. `make init` legt den Weltzustand an (Bienenstöcke, Nester, Fliegen,
Blumenfelder), `make seed` die Demodaten aus `dev/seed/world.yaml`.

| Befehl | Wirkung |
|---|---|
| `make help` | alle Befehle |
| `make compile` | Abhängigkeiten, Typprüfung, Modul-Bündel, Client-Bindings |
| `make stop start wait` | Neustart nach Code-Änderungen, Daten bleiben erhalten |
| `make clear` | Laufzeitdaten löschen und Weltzustand neu anlegen |
| `make logs` | Service-Logs |
| `npm run models` | alle Modelle neu erzeugen (`-- --only fly,hive` grenzt ein) |

Ohne laufenden Server startet das Spiel im Erkundungsmodus: Fliegen über die Inseln geht, Kampf,
Sammeln und Andocken brauchen die Verbindung.

## Steuerung (Kurzfassung)

| Eingabe | Wirkung |
|---|---|
| Linke Maustaste ziehen / Mausrad | Kamera drehen / zoomen |
| Doppelklick in den Raum | in diese Richtung fliegen |
| Klick auf Objekt bzw. Overview-Zeile | auswählen |
| Q / W / E / A / S / D + Klick (ohne Klick: Auswahl) | hinfliegen, umkreisen, Abstand halten, ausrichten, Warp, andocken |
| Q ohne Auswahl | Wählscheibe: Richtung und Entfernung, dann Höhe |
| Strg + Klick / Strg + Umschalt + Klick | Ziel aufschalten / lösen |
| F1 – F8 | Module: Laserauge links/rechts, Pollen-Gatling, Stachelraketen, Pollensammler, Boost, Heilung, Duftscanner |
| Alt + linke Maustaste halten | Laseraugen auf den Mauszeiger feuern |
| Pfeiltasten, R / F | Handflug, schneller / langsamer |
| Strg + Leertaste | anhalten |
| Tab, B, H, Esc | nächstes Ziel aktiv, summen, Hilfe, Menü |

Vollständig: `spec/steuerung.md`. Touch: zwei virtuelle Sticks (Flug links, Zielen und Laser rechts).

## Projektaufbau

```
spec/        Anforderungen (spec/anforderungen.md), Spieldesign, Steuerung, Technik
docs/        Asset-Herkunft und Lizenzen (assets.md), Hinweise für den Betrieb (betrieb.md)
dev/         Demodaten (dev/seed/), Referenzen
shared/      Weltkonstanten, Weltgenerator, Regeln, Quests – Client und Modul
server/      SpacetimeDB-Modul
src/         Client: core, rendering (Himmel, Wolken), world, entities, systems, hud, net, debug
tools/       Befehlslogik der Makefile-Targets, Modell-Generatoren
docker/      Konfiguration der Container
public/      Modelle (public/assets/models/), selbst gehostete Engine-Bibliotheken
```

## Debug-API

Im Dev-Build und im Profil-Build (`npm run build:profile`, dann `npx vite preview --mode profile`)
steht `window.__game` bereit, z. B. `__game.play("Testbee")`, `__game.setViewpoint("islandBand")`,
`__game.setTimeOfDay(5.3)`, `__game.sky.setWeather("storm")`, `__game.state()`,
`__game.net.state()`, `__game.measure(10)`. `__game.gameplay.actions` löst dieselben Aktionen aus
wie die Oberfläche (z. B. `command("dock", { type: "hive", id: 0 })`), `__game.gameplay.hud()`
liefert das aktuelle HUD-Modell. Kamerapunkte und Effektnamen: `spec/technik.md`.

Der Profil-Build eignet sich für Messungen und Tests, während am Code gearbeitet wird: Der
Dev-Server lädt jede offene Seite bei jeder Dateiänderung neu.
