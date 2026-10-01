# Wasser: Teich, Bach, Wasserfall

`islandkit.water` baut fertige Netze aus dem Inselfeld; Becken und Bachbett hat das Feld bereits
ausgeschnitten (`references/body.md`). Wasserspiegel: `terrain.water`, Mündung:
`terrain.stream_outlet()`.

## Flächen

| Teil | Aufbau | Material |
|---|---|---|
| Teich (`build_pond`) | Gitter (0,35 m) auf dem Wasserspiegel; Zellen, deren Ecke über Grund liegt und im Teichausschnitt; reicht eine Zelle unter das Ufer, das sie verdeckt. Alpha 0,45 (flach) → 0,85 (tief) aus dem Abstand zum Grund | `Island_Pond`: BLEND, tiefes Grünblau sRGB 0,09/0,27/0,29, Rauheit 0,05, Wellen-Normal-Map (kachelnd, 3 m) |
| Bach (`build_stream`) | Band entlang der Mittellinie vom Teich bis über die Kante, 7 Spalten über die volle Bettbreite, Höhe = Wasserspiegel je Stützpunkt; Rand transparenter | `Island_Stream`: wie Teich, Rauheit 0,09, Normalstärke 0,8 — fließt |
| Wasserfall (`build_waterfall`) | Wurfparabel ab der Mündung (Austritt 1,6 + 0,02 R m/s), 64 Stützpunkte dichter am Ansatz, Fallhöhe 1,05 × Inseltiefe; Breite wächst mit der Fallstrecke, quer leicht nach außen gewölbt; Alpha blendet ab 25 % der Fallhöhe aus und an den Seiten weich | `Island_Waterfall`: BLEND, doppelseitig, Rauheit 0,2, RGBA-Schleiertextur (Fasern längs, Schaum), Normal-Map |
| Gischtschleier (`mist=True`) | gleiche Bahn, 25 % breiter, etwas außen vor dem Wasserfall, Alpha 0,35 und früh verblassend | `Island_Waterfall` |

Texturen (`build_water_textures`): Wellen 512² und Schleier 256 × 1024 als periodisches
Spektralrauschen (`modelkit.tiling`) — kacheln ohne Naht. Alle Wasserflächen tragen Tangenten
(+u quer, Bitangente gegen die Fließrichtung).

## Fließen im Spiel

- Bach und Wasserfall haben v in Fließrichtung. Ihre Knoten tragen
  `extras.flow = {"speed": <UV-Einheiten/s>, "material": "<Name>"}` (Babylon:
  `node.metadata.gltf.extras`). Das Spiel erhöht je Bild `vOffset` von `albedoTexture` und
  `bumpTexture` des Materials um `speed · dt` — eine Zeile Laufzeitcode, keine Geometrie.
- Der Gischtschleier teilt das Material des Wasserfalls und fließt mit.
- Werte (getestet in der Darstellung, Bewegung beurteilt der User): Bach 0,37 UV/s (1,1 m/s bei
  3-m-Kacheln), Wasserfall ≈ Fallgeschwindigkeit × 2,2 / 5 m.

## Was das Modell bewusst dem Spiel überlässt

- **Gischt am Fuß** und Sprühnebel: Partikel (Skill `babylon-graphics`, `particles-clouds.md`,
  MCP `babylon-npe`) an der Position des Wasserfall-Endes — die Insel kann dafür einen Anker
  `WaterfallBase` tragen.
- **Spiegelung und Brechung** des Teichs: im Spiel per `WaterMaterial` oder PBR mit eigener
  Himmelsquelle (Skill `babylon-graphics`, Abschnitt „Wasser") — das Material im glb ist der
  saubere Grundzustand.
- **Interaktiver Wasserfall** (z. B. Durchfliegen, Sammeln): als eigenes Teil an einem Anker;
  die Bahn liefert `build_waterfall`, der Zusammenbau schreibt für die Insel nur den Anker
  (`references/assembly.md`).

## Fallstricke

1. **Teich und Bach getrennt halten:** `gltf-transform optimize` führt gleich definierte
   Materialien zusammen; ohne unterschiedliche Werte bekäme der Bach das Teichmaterial, und das
   Fließen erfasste beide (getestet).
2. **Wasserspiegel und Bett** stammen aus derselben groben Plateauhöhe — eigene Spiegelhöhen
   führen zu schwebendem oder versunkenem Wasser.
3. **Bach muss gerade über die Kante laufen**, sonst setzt der Wasserfall schräg zur Kerbe an.
4. **Blickrichtung prüfen:** Mündungen liegen oft hinten; Nahaufnahme mit `focusDir` von außen.
5. **Transparente Flächen** im Spiel in Rendering-Gruppe 1 (Skill `babylon-graphics`,
   Fallstricke) — sonst überdeckt sie der Himmel.
