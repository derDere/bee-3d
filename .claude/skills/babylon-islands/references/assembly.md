# Zusammenbau, Bepflanzung, Laden im Spiel

`islandkit.assembly.write_island(IslandParts, path)` schreibt das Insel-glb: Körper, Wurzeln,
Wasser und die Platzierungen fertiger Teile (`PartPlacement`). Die Teile kommen per
`GltfBuilder.import_glb_mesh` aus ihren eigenen glb-Dateien.

## Teile übernehmen

- `PartPlacement(name, source, instances, tile_size)`: `source` ist das Roh-glb des Teils
  (`.temp/models/flora/<teil>.glb`), `instances` ein `InstanceSet` (Translation, Rotation als
  Quaternion xyzw, Skalierung) relativ zur Inselmitte.
- Jedes Quell-glb wird einmal importiert; mehrere Platzierungen desselben Teils teilen das Mesh.
  Gleichnamige Materialien werden zusammengeführt (Konvention: gleicher Name = gleiche Definition).
- `tile_size > 0` teilt die Instanzen in quadratische Kacheln (`<Teil>_<x>_<z>`) — Babylon
  verwirft Kacheln außerhalb des Sichtfelds einzeln. Startwert 16 m für Gras, Blumen, Kiesel;
  Bäume und Brocken mit `tile_size = 0` (ein Knoten je Teil) oder als Anker.
- Getestet: 525 Grasbüschel in 4 Kacheln überstehen Validator, `gltf-transform optimize`
  (WebP, meshopt, Quantisierung) und laden in Babylon als Thin Instances ohne Konsolenmeldung.

## Statisch oder interaktiv

| Art | Einbau | Beispiele |
|---|---|---|
| Statisch, Massenware | `PartPlacement` mit Kacheln (GPU-Instanzierung) | Gras, Deko-Blumen, Kiesel |
| Statisch, Einzelstück | `PartPlacement` ohne Kacheln | Felsbrocken, Hintergrundbäume |
| Interaktiv | **Anker**: leerer Knoten unter `Anchors` | Bäume mit Früchten, Nektarblumen, Wasserfall, Sammelobjekte |

Anker mit vorhandener API:

```python
builder.add_node("Anchors", parent=f"Island_{name}")
builder.add_node(
    f"{part}_{index}", parent="Anchors",
    translation=position, rotation=quaternion_xyzw, scale=(s, s, s),
    extras={"part": part, "file": "flora/tree-oak-a.glb", "interactive": True},
)
```

Das Spiel lädt jedes Teil einmal (AssetContainer) und setzt es an alle Anker mit diesem `part`
(`instantiateModelsToScene` oder `InstancedMesh`); der Anker ist zugleich der Haken für Logik
(Skill `babylon-gameplay`). Eine Insel kann dieselbe Art statisch (fern, dekorativ) und
interaktiv (nah am Weg) tragen.

## Platzierungsregeln (Startwerte)

Grundlage ist das grobe Feld `body.mesh_terrain` (darauf liegt das Netz): `sample(points)` liefert
Abstand zu Teich/Bach (`pond`, `stream`) und Radius relativ zum Umriss (`radial`), der Gradient
die Neigung. Höhe des Fußpunkts per Strahl von oben auf `body.occluder` (Embree über trimesh) —
`top_height` kennt weder Mulden noch Lippe.

Reihenfolge (große Teile zuerst, jedes Teil hält Abstand zu den vorigen):

| Teil | Abstand (Poisson) | Zulassen, wenn | Ausrichtung, Größe |
|---|---|---|---|
| Bäume | 5–7 m | `radial` < 1 − 2,5 m/R, Wasser > 2 m, Neigung y > 0,85, Hain-Rauschen (f = 3/D) > 0 — dazu ein Solitär am Teich | aufrecht (≤ 3°), Gierwinkel frei, 0,8–1,2 |
| Büsche | 2,5 m | Hainränder, Ufer (Wasser 1–3 m), 2–4 m um Stämme | aufrecht, 0,8–1,25 |
| Felsbrocken | 4 m | einige an der Kante (`radial` 0,85–0,95), einige in der Wiese, ~D/10 Stück | entlang der Normale + Zufall, 25 % eingesunken (Ursprung), 0,6–1,6 |
| Blumen | 0,35 m in Flecken | eine Art je Zelle (Zellrauschen, 6–10 m), Fleckmaske fBm > 0,2; ≥ 1,5 m von Stämmen | Normale/aufrecht 50/50, 0,85–1,15 |
| Gras | 0,5–0,9 m | überall auf dem Plateau außer Wasser und < 0,8 m um Stämme; `Grass_Tall` am Wasser und an der Kante, `Grass_Short` auf Kuppen | Normale/aufrecht 50/50, 0,8–1,3 |
| Kantengras | 0,4–0,6 m entlang des Umrisses | `radial` 0,97–1,0 | 35–60° nach außen geneigt |
| Kiesel | 0,3 m | Uferring (Wasser 0–0,8 m), Bachbett | entlang der Normale, 0,6–1,8 |
| Schwebende Brocken | — | 2–6 Stück, 0,6–1,4 R von der Achse, 0,2–0,9 Tiefe unter dem Plateau | frei gedreht, 2–6-fach skaliert |

**Instanzen mischen** (`rng.permutation`) bevor sie in Kacheln gehen: Dann ist jeder Anfang
einer Kachel eine gleichmäßige Stichprobe, und das Spiel senkt die Dichte je Qualitätsstufe über
`thinInstanceCount` (Skill `babylon-graphics`, „Qualitätsstufen").

**Budgets** (Startwerte, im Spiel messen — Skill `babylon-performance`):

| Insel | Gras-Instanzen | Blumen | Bäume + Büsche | Dreiecke gesamt |
|---|---|---|---|---|
| 12 m | ~300 | ~80 | 1 + 2 | ~120.000 |
| 40 m | ~1.200 | ~250 | 8 + 12 | ~450.000 |
| 95 m | ~5.000 | ~900 | 45 + 60 | ~1,6 Mio. (mit Qualitätsstufen ausdünnen) |

Dichtes Gras direkt um die Kamera liefert das Grasfeld des Spiels (Thin-Instance-Kacheln aus
Skill `babylon-graphics`) — die Insel trägt die Grundbepflanzung für die Fernwirkung.

## Laden im Spiel

- Insel laden **nach** der Atmosphäre (Skill `babylon-graphics`, Aufbaureihenfolge); der
  glTF-Loader erzeugt aus `EXT_mesh_gpu_instancing` Thin Instances.
- Wind-Plugin auf `Flora_Plant` und `Flora_Leaves_*`; lokales y der Teile ist die Höhe über dem
  Fuß.
- Fließendes Wasser über `extras.flow` (`references/water.md`); Wasserflächen in
  Rendering-Gruppe 1.
- **Mehrere Inseln** bringen je eine Kopie der Teile mit. Für viele Inseln entweder beim Laden
  gleichnamige Materialien und Texturen zusammenführen (Material-Cache nach Namen) oder die
  Teile nur über Anker setzen und einmal laden.

## Build

- `build_all.py`: `GENERATORS = (…, island_flora, sky_islands)`; Unterordner bleiben erhalten
  (`public/assets/models/flora/`, `…/islands/`).
- Validierung vor der Optimierung, Optimierung mit den Flags aus Skill `babylon-modeling`
  (`--instance false` erhält die vorhandene Instanzierung, `--join false` die Knoten).
- Ausgeliefert werden Inseln und Teile; Generator-Code, Kataloge (`flora-catalog.glb`) und
  Roh-glbs bleiben in `tools/` bzw. `.temp/`.

## Fallstricke

1. **Material-Zusammenführung durch `optimize`:** Materialien, die das Spiel getrennt ansteuert,
   brauchen unterschiedliche Werte (Teich/Bach, getestet).
2. **Höhe aus dem falschen Feld:** Platzierung auf dem feinen Feld lässt Teile schweben oder
   einsinken — grobes Feld bzw. Strahl auf das Netz verwenden.
3. **Wasser:** Teile mit `pond`/`stream` < Abstand ausschließen; Pflanzen im Bachbett wirken
   sofort falsch.
4. **Kachelgröße:** zu klein → viele Draw Calls (eine je Kachel und Primitive), zu groß → kein
   Culling. 16 m ist ein Startwert für 40-m-Inseln.
