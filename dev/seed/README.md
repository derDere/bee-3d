# Demodaten

`make seed` liest `world.yaml` und übergibt den Inhalt an den Besitzer-Reducer `seed_demo`.

| Abschnitt | Wirkung |
|---|---|
| `weather` | erzwungene Start-Wetterlage (`clear`, `fair`, `misty-morning`, `overcast`, `shower`, `storm`; `auto` = Wetterplan) |
| `keepers` | Demo-Imker ohne Login mit Honig, Siegen, Pollen und Heimatstock — füllen die Rangliste |
| `hives` | zusätzliche Honigbilanz und Besuche je Bienenstock (Index wie in `shared/worldgen.ts`) |

Der Kreislauf beim Anpassen ist `make clear` → `make seed`. `seed` bricht ab, wenn schon
Demodaten vorhanden sind. Spieler, Fliegen und Blumenfelder legt `make init` an; ihr Zustand
entsteht im Spiel.
