---
name: babylon-islands
description: Schwebende Fantasie-Inseln (10–100 m Durchmesser) als fertige glb-Modelle entwerfen und bauen — Gestaltungsregeln (Silhouette, Proportionen, Farbwerte, typische Fehler), Inselkörper als Distanzfeld (Grasnarbe mit Lippe, Erdband, Felswand mit Schichten, Blöcken und Rissen, hängende Felsspitzen), Teich, Bach und Wasserfall, hängende Wurzeln, Bäume per Space Colonization mit Blattkarten, Büsche, Grasbüschel, Blumen und Felsbrocken als eigene Teile, Zusammenbau mit GPU-Instanzierung und Ankerpunkten für interaktive Teile, Prüfung im Model Lab. Laden, wenn eine schwebende Insel oder ein Inselteil (Baum, Busch, Blume, Gras, Fels, Wasserfall, Wurzeln) entworfen, erzeugt, bepflanzt, überarbeitet oder geprüft wird. Baut auf Skill babylon-modeling auf.
---

# Schwebende Inseln

Baut auf Skill `babylon-modeling` auf: Python-Pipeline (`tools/models/`, `modelkit`), Build
(`npm run models`), Model Lab und Konventionen gelten unverändert. Dieser Skill ergänzt, was
eine gute schwebende Insel ausmacht und wie sie aus Teilen entsteht.

## Grundsätze

- **Gestaltung vor Technik.** Vor jeder neuen Insel die Regeln in
  [references/design.md](references/design.md) lesen: Silhouette, Proportionen, Farbwerte und
  die Details, die eine Insel glaubwürdig machen.
- **Teile einzeln, Zusammenbau danach.** Bäume, Büsche, Gras, Blumen und Steine sind eigene
  glb-Dateien (`island_flora.py`), jede für sich im Lab begutachtet. Der Inselgenerator
  (`sky_islands.py`) baut Körper, Wurzeln und Wasser und übernimmt die Teile aus ihren Dateien.
  Ein Teil lässt sich so jederzeit gegen ein besseres oder ein CC0-Modell tauschen.
- **Interaktives bleibt eigenständig.** Was im Spiel reagiert (Wasserfall, Bäume, Blumen,
  Früchte …), backt der Zusammenbau nicht ein: Die Insel trägt dort einen **Ankerknoten**
  (Position, Drehung, `extras` mit Teilname), das Spiel setzt das Teil zur Laufzeit ein.
  Statische Massenware (Gras, Kiesel, Deko-Blumen) wird per GPU-Instanzierung eingebaut. Die
  Einteilung „statisch" oder „interaktiv" steht im Brief jeder Insel.
- **Fertige Dateien.** Jede Insel ist ein glb mit Texturen; das Spiel erzeugt keine Geometrie,
  es platziert Teile an Ankern und verschiebt Texturen fließenden Wassers.

## Anatomie einer Insel

| Zone (von oben) | Anteil | Merkmale |
|---|---|---|
| Grasnarbe | Plateau, Hügel ~1,6 % D | sanfte Kuppel, kahle Erd- und Kiesflecken, Teich, Bach |
| Lippe | Verrundung ~1 % D | Gras wölbt sich über die Kante und wirft eine dunkle Schattenlinie |
| Erdband | Dicke ~4,8 % D, um ~1,2 % D zurückversetzt | Wurzelfasern, Kiesel, hängende Wurzeln |
| Felswand | bis ~0,5 der Tiefe | steil, Gesteinsschichten (Abstand D/24), versetzte Blöcke, Risse, Moos auf Simsen |
| Felsspitzen | bis zur vollen Tiefe 0,6–0,9 D | Hauptspitze nahe der Mitte, 3–7 Nebenspitzen weiter außen, verschieden lang; dunkler und kühler |

D = Durchmesser. Herleitung und Parameter: [references/design.md](references/design.md),
[references/body.md](references/body.md).

## Werkzeuge und Vorlagen

| Vorlage | Inhalt | Ziel im Projekt |
|---|---|---|
| `templates/islandkit/` | Paket: Steckbrief, Inselfeld, Bemalung, Körper, Wasser, Wurzeln, Pflanzen, Bäume, Blattatlanten, Felsen, Textursätze, Zusammenbau | `tools/models/islandkit/` |
| `templates/island_flora.py` | Generator aller Teile, `--only`, `--catalog` | `tools/models/` |
| `templates/sky_islands.py` | Inselgenerator mit Liste `ISLANDS`, `--only`, `--texture` | `tools/models/` |
| `modelkit` (Skill `babylon-modeling`) | Rauschen (numba), Sweeps, Kachelmuster, Feldmodell-Backen, Normal-Maps, Tangenten, Instanzierung, glb-Import | vorhanden |

Bausteine ohne Vorlage, beschrieben in den Referenzen: Platzierungsregeln der Bepflanzung
(`assembly.md`), Ankerknoten im Zusammenbau, Nadelbaum mit Astquirlen (`flora.md`), schwebende
Felsbrocken um die Insel, LOD-Stufe des Inselkörpers.

## Einrichtung (einmal, nach Skill `babylon-modeling`)

1. `templates/islandkit/` nach `tools/models/islandkit/`, `island_flora.py` und
   `sky_islands.py` nach `tools/models/` kopieren.
2. `tools/models/build_all.py`: `GENERATORS = (…, island_flora, sky_islands)` — die Flora vor den
   Inseln, weil der Zusammenbau ihre fertigen Dateien liest.
3. `uv sync --project tools/models` (bringt `numba` aus der Vorlage mit).
4. Probe: `uv run --project tools/models tools/models/island_flora.py --catalog` und
   `uv run --project tools/models tools/models/sky_islands.py --texture 1024`, dann im Lab
   `lab.html?model=/.temp/models/flora-catalog.glb` und
   `lab.html?model=/.temp/models/islands/island-meadow.glb`.

## Arbeitsablauf je Insel

1. **Brief** als `IslandSpec` in `ISLANDS` plus Docstring-Notiz: Zweck im Spiel und
   Kameradistanz, Durchmesser, Tiefe, Teich/Bach, Baumzahl, statische und interaktive Teile.
2. **Teile** prüfen: fehlende Arten in `island_flora.py` ergänzen, `--catalog` im Lab ansehen
   (Proportionen der Teile zueinander, Kronendichte, Farben).
3. **Formprobe:** `sky_islands.py --only <Name> --texture 1024` (~25 s bei 40 m) →
   Kontaktbogen. Silhouette gegen die Regeln in `design.md` prüfen; Seeds und Planwerte
   (`TerrainPlan`) variieren, bis die Form trägt.
4. **Oberfläche, Wasser, Wurzeln:** Nahaufnahmen von Kante, Bachmündung und Felswand
   (`&view=close-up&focus=x,y,z&focusSize=s&focusDir=x,y,z`; die Mündung liefert
   `terrain.stream_outlet()`).
5. **Bepflanzung** nach den Regeln in [references/assembly.md](references/assembly.md);
   interaktive Teile als Anker.
6. **Endfassung** ohne `--texture`, dann `npm run models` (validiert, optimiert).
7. **Review:** Agent `babylon-model-reviewer` mit Brief, Lab-URL und der Insel-Checkliste unten.
8. **Übergabe:** Wirkung im Spiellicht, Wind und fließendes Wasser beurteilt der User.

## Größenklassen

Startwerte aus dem Steckbrief (`IslandSpec`), gemessen auf Core Ultra 9 285H (Arc 140T):

| Durchmesser | Körper-Dreiecke | Textur (5 cm/Texel) | Bau der Insel ohne Bepflanzung |
|---|---|---|---|
| 12 m | 12.000 | 512² | 7 s, Roh-glb 2,9 MB |
| 40 m | 41.000 | 2048² | ~50 s; mit `--texture 1024` 25 s, Roh-glb 6,1 MB → 1,4 MB optimiert |
| 95 m | 93.000 | 4096² (ORM 2048²) | 178 s, Roh-glb 34 MB |

Alle drei gebaut, validiert und im Lab angesehen. Dazu kommen Wurzeln (5.000–24.000 Dreiecke),
Wasser (~3.300) und die Bepflanzung. Texturspeicher auf der GPU: WebP liegt dort unkomprimiert
(4096² RGBA ≈ 89 MB mit Mipmaps je Textur) — für große Inseln KTX2 einplanen (Skill
`babylon-modeling`, „Texturformat"; Installation nur nach Freigabe durch den User).

## Konventionen

- **Dateien:** Teile `.temp/models/flora/<teil>.glb` (`tree-oak-a.glb`), Inseln
  `.temp/models/islands/island-<name>.glb`; ausgeliefert unter `public/assets/models/` mit
  gleichen Unterordnern.
- **Knoten:** `Island_<Name>` → `Terrain`, `Roots`, `Water` (`Pond`, `Stream`, `Waterfall`,
  `WaterfallMist`), `Flora` (`<Teil>_<Kachel>`), `Anchors` (`<Teil>_<Nr>`).
- **Materialien:** Insel `Island_Body`, `Island_Root`, `Island_Pond`, `Island_Stream`,
  `Island_Waterfall`; Teile `Flora_Plant`, `Flora_Bark`, `Flora_Leaves_<Atlas>`, `Rock_<Name>`.
  Gleichnamige Materialien sind identisch; Materialien, die das Spiel getrennt ansteuert,
  unterscheiden sich in mindestens einem Wert (Fallstricke).
- **Fließendes Wasser:** Knoten-`extras` `{"flow": {"speed": <UV/s>, "material": "<Name>"}}`; v
  wächst in Fließrichtung, das Spiel erhöht `vOffset` der Basisfarb- und Normaltextur.
- **Ursprung:** Insel in der Plateaumitte auf Höhe der Grasnarbe; Teile am Fuß (y = 0),
  Felsbrocken bei 25 % ihrer Höhe (stecken im Boden).

## Insel-Checkliste (Review)

1. Silhouette: oben am breitesten, steile Felswand, mehrere verschieden lange Spitzen,
   asymmetrisch, unregelmäßiger Umriss — kein gespiegelter Kegel.
2. Kante: Grasnarbe wölbt sich über das Erdband, dunkle Schattenlinie, Erdband sichtbar.
3. Fels: Schichten mit wechselnder Härte, versetzte Blöcke, Risse; kein gleichmäßiges
   Streifenmuster; nach unten dunkler und kühler.
4. Wurzeln hängen (nicht waagrecht abstehend), schmiegen sich an die Wand, stehen in Gruppen.
5. Wasser: Teich ohne Lücken am Ufer, Bach folgt seinem Bett bis zur Kerbe, Wasserfall setzt in
   der Kerbe an, wird nach unten breiter und blasser; nasse Spur darunter.
6. Bepflanzung: Kronen dicht, Teile im richtigen Größenverhältnis, nichts schwebt oder steckt
   im Wasser, Gras an der Kante hängt leicht über.
7. Normal-Map: Simse von oben beleuchtet (keine invertierte Wirkung), keine Nähte im Atlas.
8. Kennzahlen: Dreiecke, Texturgrößen, Draw Calls gegen das Budget; Konsole leer.

## Fallstricke

- `gltf-transform optimize` führt gleich definierte Materialien zusammen — Teich und Bach
  erhielten sonst ein gemeinsames Material, und der Teich flösse mit (getestet).
- Normal-Maps brauchen `TANGENT` (Validator-Warnung `MESH_PRIMITIVE_GENERATED_TANGENT_SPACE`);
  Röhren, Bänder, Wasser und Feldmodelle liefern Tangenten mit.
- Netz und Normal-Map müssen dasselbe Feld beschreiben: grobes Feld = feines Feld ohne die
  kurzen Oktaven (`Fractal(..., min_wavelength)`), nie zwei getrennt gewürfelte Felder.
- Wurzeln, Pflanzen und Platzierung lesen das grobe Feld (`body.mesh_terrain`), auf dem das
  Netz liegt — das feine Feld liegt Zentimeter daneben.
- Der Leittrieb eines Baums muss die Krone erreichen, sonst wächst nichts (Einflussradius
  `influence × segment` größer als die Lücke Stamm–Krone).
- Die Nahaufnahme blickt standardmäßig von vorne rechts; Stellen auf der Rückseite mit
  `focusDir` von außen ansehen, sonst zeigt das Bild das Innere des Körpers.
- Weitere je Thema in den Referenzen.

## Wegweiser

| Thema | Datei |
|---|---|
| Was eine gute Insel ausmacht: Silhouette, Proportionen, Farben, Details, Fehler, Quellen | [references/design.md](references/design.md) |
| Inselkörper: Feld, Profil, Fels, Plateau, Ausschnitte, Bemalung, Backen, Laufzeiten | [references/body.md](references/body.md) |
| Teich, Bach, Wasserfall, Gischt; Wasser im Spiel | [references/water.md](references/water.md) |
| Bäume, Büsche, Nadelbäume, Gras, Blumen, Felsbrocken, Blattatlanten | [references/flora.md](references/flora.md) |
| Zusammenbau, Platzierungsregeln, Instanzierung, Anker, Laden im Spiel | [references/assembly.md](references/assembly.md) |
| Pipeline, Model Lab, Budgets, Konventionen | Skill `babylon-modeling` |
| Licht, Wind-Shader, Wasser-Material im Spiel | Skill `babylon-graphics` |
