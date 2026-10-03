# Offene Punkte

Was am Spiel noch offen ist. Erledigte Punkte verlassen diese Liste; ihr Nachweis steht im
Prüfprotokoll (`docs/pruefprotokoll.md`).

## Wartet auf Rückmeldung des Users

- Spielgefühl: Trägheit beim Losfliegen (Ausrichtzeit 4,2 s), Umherschwirren der Biene, Kamera,
  Ansehen, Hangar mit Seitenleiste.
- Optik: Die verbleibenden Abweichungen von den Zielbildern stehen im Prüfprotokoll unter „Offene
  Punkte zur Optik“ (Strahlen nur bei Sonne bzw. Mond im Bild, Randlicht der Inseln am Abend,
  Mondphase). Weiter angleichen oder so lassen?

## Hinweise

- Das SpacetimeDB-MCP braucht die `spacetime`-CLI auf dem Host.
- `__game.stats()` und `__game.measure()` liefern keine GPU-Zeit: Der aktuelle Chrome kennt den von
  Babylon genutzten Zeitstempel-Weg (`writeTimestamp`) nicht mehr.
