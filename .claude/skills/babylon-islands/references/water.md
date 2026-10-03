# Wasser: Teich, Bach, Wasserfall

`islandkit.water` baut Teich und Bach aus dem Inselfeld; Becken und Bachbett hat das Feld bereits
ausgeschnitten (`references/body.md`). Wasserspiegel: `terrain.water`, Mündung:
`terrain.stream_outlet()`. Die Wasserfälle plant `islandkit.falls` (Ansätze und Bahnen) und baut
`islandkit.waterfall` (Netze).

## Flächen

| Teil | Aufbau | Material |
|---|---|---|
| Teich (`build_pond`) | Gitter (0,35 m) auf dem Wasserspiegel; Zellen, deren Ecke über Grund liegt und im Teichausschnitt; reicht eine Zelle unter das Ufer, das sie verdeckt. Alpha 0,45 (flach) → 0,85 (tief) aus dem Abstand zum Grund | `Island_Pond`: BLEND, tiefes Grünblau sRGB 0,09/0,27/0,29, Rauheit 0,05, Wellen-Normal-Map (kachelnd, 3 m) |
| Bach (`build_stream`) | Band entlang der Mittellinie vom Teich bis über die Kante, 7 Spalten über die volle Bettbreite, Höhe = Wasserspiegel je Stützpunkt; Rand transparenter | `Island_Stream`: wie Teich, Rauheit 0,09, Normalstärke 0,8 — fließt |
| Wasserfall-Ansätze (`plan_falls`) | an der Bachmündung und an Quellen in der Felswand (1,2 × Erdbanddicke unter der Grasnarbe); Quellen brauchen Felsabstand 0,5 m + 0,025 × Fallstrecke, zwei Fälle liegen ≥ 70° auseinander; Anzahl je Insel im Steckbrief (`springs`) | — |
| Wasserkörper (`build_falls`) | Wurfbahn, Fallhöhe 1,75 × Inseltiefe (weit unter die Insel in die Wolken); Körper bis 72 % der Fallhöhe, fächert in den ersten 10 % auf 1,8× und unten bis 2,5× der Quellbreite auf (Halbbreite einer Quelle 0,045 R, 0,6–2 m) | `Island_Waterfall`: Alpha-Test (MASK, Schwelle 0,4), doppelseitig, Fasertextur 256 × 1024 mit Lücken und ausgefransten Rändern, leichtes Eigenleuchten |
| Zerstäubung, Gischtschleier, Sprühwolke | Zerstäubung ab 45 % der Fallhöhe, Schleier ab 12 %, am Fuß eine Sprühwolke aus 3 gekreuzten Flächen | `Island_Spray`: BLEND, Gischt-Atlas 512² |
| Ferne Stufen | LOD1 und LOD2 tragen den Fall als deckendes Band im Detail- bzw. Silhouettennetz (`build_far_falls`), ohne eigenen Draw Call | — |

Texturen (`build_water_textures`): Wellen 512², Fasern 256 × 1024 und Gischt-Atlas 512² als
periodisches Spektralrauschen (`modelkit.tiling`) — kacheln ohne Naht. Alle Wasserflächen tragen
Tangenten (+u quer, Bitangente gegen die Fließrichtung). Alle Fälle einer Insel liegen in zwei
Knoten (Körper, Gischt), also zwei Draw Calls je Insel.

## Fließen im Spiel

- Bach und Wasserfall haben v in Fließrichtung. Ihre Knoten tragen
  `extras.flow = {"speed": <UV-Einheiten/s>, "material": "<Name>"}` (Babylon:
  `node.metadata.gltf.extras`). Das Spiel verringert je Bild `vOffset` von `albedoTexture` und
  `bumpTexture` des Materials um `speed · dt` (ein größeres `vOffset` schiebt das Muster
  stromauf) — für jedes Material dieses Namens, auch in Kopien und fernen Stufen.
- Werte (getestet in der Darstellung, Bewegung beurteilt der User): Bach 0,37 UV/s (1,1 m/s bei
  3-m-Kacheln), Wasserfall `FLOW_SPEED` 0,7 UV/s, sichtbare Endgeschwindigkeit höchstens 11 m/s.

## Was das Modell bewusst dem Spiel überlässt

- **Spiegelung und Brechung** des Teichs: im Spiel per `WaterMaterial` oder PBR mit eigener
  Himmelsquelle (Skill `babylon-graphics`, Abschnitt „Wasser") — das Material im glb ist der
  saubere Grundzustand.
- **Interaktiver Wasserfall** (z. B. Durchfliegen, Sammeln): als eigenes Teil an einem Anker;
  die Bahn liefert `falls.trajectory`, der Zusammenbau schreibt für die Insel nur den Anker
  (`references/assembly.md`).

## Fallstricke

1. **Teich und Bach getrennt halten:** `gltf-transform optimize` führt gleich definierte
   Materialien zusammen; ohne unterschiedliche Werte bekäme der Bach das Teichmaterial, und das
   Fließen erfasste beide (getestet).
2. **Wasserspiegel und Bett** stammen aus derselben groben Plateauhöhe — eigene Spiegelhöhen
   führen zu schwebendem oder versunkenem Wasser.
3. **Bach muss gerade über die Kante laufen**, sonst setzt der Wasserfall schräg zur Kerbe an.
4. **Blickrichtung prüfen:** Mündungen liegen oft hinten; Nahaufnahme mit `focusDir` von außen.
5. **Transparente Flächen vor Wolken:** Der Wolken-Compositor malt nach Rendering-Gruppe 0 über
   alles, was keine Tiefe schreibt. Deshalb ist der Wasserkörper Alpha-Test; die weiche Gischt
   (BLEND) geht vor Wolken in diesen auf. Durchscheinende Teile, die vor Wolken sichtbar bleiben
   müssen, gehören in Rendering-Gruppe 1 (Skill `babylon-graphics`, Fallstricke).
