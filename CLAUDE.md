# CLAUDE.md – bee-3d

## Modelle zeigen

Will der User ein Modell sehen, bekommt er den Pfad zur `.glb`-Datei als klickbaren relativen
Link, zum Beispiel `.temp/models/islands/island-meadow.glb`. Er öffnet die Datei selbst im
glb-Viewer von VS Code; Dev-Server, Model Lab und Browserfenster braucht es dafür nicht.

Das Model Lab (Skill `babylon-modeling`) ist das Werkzeug für die eigene Prüfung: Kontaktbogen,
Nahaufnahmen, Kennzahlen.

## Testen

- Geprüft und gemessen wird am Profil-Build: `npx vite build --mode profile`, dann
  `node node_modules/vite/bin/vite.js preview --mode profile` (Port 4173). Der Dev-Server lädt bei
  jeder Dateiänderung alle offenen Seiten neu und taugt nicht für Messungen.
- Laufen mehrere Prüfungen oder Agenten gleichzeitig, bekommt jede einen eigenen Build-Ordner
  (`--outDir .temp/dist-<name>`), einen eigenen Port und eine eigene Browserseite. Ein zweiter
  Spieler läuft in einem isolierten Browser-Kontext.
- Gesteuert und gemessen wird über die Debug-API `window.__game` (README, `spec/technik.md`).
- Leistung immer bei 1280×720 und Qualitätsstufe `high`. Die GPU-Zeit liefert der aktuelle Chrome
  über die Debug-API nicht; Bildzeit, p95 und Auflösungsvergleich zeigen, ob CPU oder GPU begrenzt.
- Ergebnisse gegen die Anforderungen stehen in `docs/pruefprotokoll.md`, offene Arbeit in
  `docs/offene-punkte.md`.
