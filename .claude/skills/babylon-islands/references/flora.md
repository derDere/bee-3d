# Teile: Bäume, Büsche, Gras, Blumen, Felsbrocken

Jedes Teil ist ein eigenes glb aus `island_flora.py` (`--only <Name>`, `--catalog` für einen
Kontaktbogen aller Teile). Ursprung am Fuß (y = 0), lokales y = Höhe über der Wurzel — der
Wind-Shader des Spiels (Skill `babylon-graphics`, `WindSwayPlugin`) biegt ab dem Boden.

## Laubbäume und Büsche (`trees.py`, Space Colonization)

Ablauf `build_tree(spec, seed)`:

1. **Stamm** vom Fuß (y = −0,3) bis `trunk_height`, leicht geneigt und gekrümmt; mehrere
   Stämme (`stems`) für Büsche.
2. **Kronenpunkte** (`attractors`) in der Hülle (`ellipsoid`, `dome`, `cone`), mit Rauschen
   ausgebeult (`lumpiness`), zur Hülle hin verdichtet.
3. **Wachstum:** je Schritt sucht jeder Punkt den nächsten Knoten im Einflussradius
   (`influence × segment`); jeder angezogene Knoten treibt einen Knoten in Richtung der
   gemittelten Zugrichtung plus `upward`; Punkte innerhalb `kill × segment` verschwinden. Liegt
   die Krone außer Reichweite, wächst der Leittrieb zuerst auf sie zu.
4. **Astdicken** nach dem Röhrenmodell, Exponent 2,4, auf `trunk_radius` skaliert; Stammfuß
   bis 1,55-fach verbreitert.
5. **Röhren** je Astkette (dickstes Kind setzt fort), zweimal geglättet, 4–12 Seiten nach Radius;
   Zweige unter `min_branch_radius` entfallen (die Blätter verdecken sie). 4–6
   **Wurzelanläufe** greifen schräg in den Boden.
6. **Blattkarten** an Astenden und dünnen Zweigen: 2 × 2 Felder, quer gewölbt, am Ast ansetzend,
   nach außen geneigt; **Normalen 70 % von der Kronenmitte weg** (weiche, wolkige
   Schattierung); Vertexfarbe dunkelt das Kroneninnere ab (0,62–1,0).

| Teil | Höhe | Dreiecke | Besonderheit |
|---|---|---|---|
| `Tree_Oak_A` | ~8 m | ~10.300 | breite Krone 3,4 × 2,6 m Halbachsen |
| `Tree_Oak_B` | ~9 m | ~8.900 | höher, unregelmäßiger |
| `Tree_Blossom` | ~6 m | ~7.800 | flache Kuppelkrone, Blütenatlas, stärker geneigt |
| `Bush_Round` | ~1,6 m | ~3.200 | drei Stämme, kleine Karten (0,42 m) |
| `Bush_Blossom` | ~1,4 m | ~2.600 | Blütenatlas |

Bauzeit 0,3–0,9 s je Gehölz (getestet). Startwerte für dichte Kronen: 2–3 Karten je Spitze,
Kartengröße 0,65–1,0 m bei 8-m-Bäumen, 900–1.400 Kronenpunkte, Segment 0,28–0,32 m.

**Materialien:** `Flora_Bark` (kachelnde Borke 512², Farbe + Normal-Map, Rauheit 0,9, u um den
Umfang je 0,6 m, v je 0,9 m), `Flora_Leaves_<Atlas>` (RGBA 1024², `MASK` mit Schwelle 0,45,
doppelseitig, Rauheit 0,7). Im Spiel: Durchscheinen über `subSurface` und Wind-Plugin auf die
Blattmaterialien (Skill `babylon-graphics`, „Blätter und Blüten").

## Blattatlanten (`foliage.py`)

2 × 2 Zellen, je ein Zweig vom unteren Rand nach oben: `Green` (Laub mit Mittelrippe,
Seitenadern, dunklerem Rand), `Blossom` (Laub mit fünfblättrigen Blüten), `Needles`
(Nadelzweige). Alpha mit einem Pixel Kantenweichheit, Farbe unter transparenten Pixeln
fortgesetzt (keine dunklen Mipmap-Säume). Zeichnen dauert 1–6 s je Atlas.

## Nadelbäume (beschrieben, ohne Vorlage)

Space Colonization in einer Kegelhülle ergibt dünne, lichte Kiefern (getestet). Nadelbäume
bekommen einen eigenen Aufbau:

1. Durchgehender Stamm bis zur Spitze, Radius linear auf ~2 cm.
2. **Astquirle** alle 0,35–0,5 m ab der Kronenbasis, je 5–7 Äste im goldenen Winkel versetzt;
   Astlänge ∝ ((Höhe − y)/(Höhe − Kronenbasis))^0,95 × Kronenradius — unten lang, oben kurz.
3. Äste waagrecht ansetzen und zur Spitze hin hängen lassen (wie `_bent_path` mit Durchhang
   0,2–0,4); oben leicht aufgerichtet.
4. Nadelkarten (`Needles`-Atlas) alle 0,3–0,4 m entlang jedes Astes, Kartenachse in
   Astrichtung, Fläche nach oben gekippt; ein Kartenbüschel an der Spitze.
5. Normalen von der Stammachse weg und nach oben gemischt.

Budget ~6.000–9.000 Dreiecke für 10 m.

## Grasbüschel (`plants.py`)

Halme als leicht gekehlte Bänder mit 4 Segmenten, Breite zur Spitze auf ~4 %, nach außen geneigt
und durchhängend; Vertexfarbe dunkel am Fuß → hell an der Spitze, je Halm leicht im Farbton
verschoben; Normalen zu 55 % nach oben geneigt (weiche, gleichmäßige Schattierung).

| Teil | Halme | Höhe | Dreiecke |
|---|---|---|---|
| `Grass_Meadow` | 22 | 0,28–0,5 m | 176 |
| `Grass_Short` | 16 | 0,12–0,26 m | 128 |
| `Grass_Tall` | 14 + 3 Ähren | 0,5–0,85 m | 316 |

Halme aus Geometrie: kein Überzeichnen, scharf mit MSAA, im Wind sauber biegbar.

## Blumen (`plants.py`)

Stängel als Röhre (4 Seiten), Grundblätter als gekehlte Bänder, Blütenblätter als Bänder mit
Breitenprofil sin(πt)^0,7 und Querwölbung, Mitte als flache Halbkugel. Stilisiert 1,6-fach
vergrößert (`FLOWER_SCALE`) — in realer Größe verschwinden Blüten auf Inselmaßstab (getestet).

| Teil | Aufbau | Dreiecke |
|---|---|---|
| `Flower_Daisy` | 18 weiße Blütenblätter, gelbe Mitte | 550 |
| `Flower_Poppy` | 4 breite, gewölbte rote Blütenblätter, dunkle Mitte | 270 |
| `Flower_Bluebell` | nickender Stängel, 6 hängende Glocken | 860 |
| `Flower_Buttercup` | 3 Stängel, je 5 gelbe gewölbte Blütenblätter | 750 |
| `Flower_Lupine` | Ähre mit 26 kleinen Blüten, nach oben kleiner | 1.720 |

Alle Gräser und Blumen teilen `Flora_Plant` (Vertexfarben, doppelseitig, Rauheit 0,65, ohne
Textur). Neue Arten: `FlowerSpec` mit `PetalSpec` in `FLOWERS` ergänzen.

## Felsbrocken (`rocks.py`)

Verrundete Box (Kantenradius 35 % der kleinsten Halbachse), von 4–7 schrägen Ebenen weich
beschnitten (Bruchflächen), Rauschen 3,5 % und Zellrisse; gebacken wie der Inselkörper
(`modelkit.sdf_asset`): Farbe mit Korn und Moos auf Oberseiten, Normal-Map, ORM. Ursprung bei 25 %
der Höhe.

| Teil | Maße | Dreiecke | Textur |
|---|---|---|---|
| `Rock_Boulder_A` | 1,6 × 1,1 × 1,3 m | ~1.270 | 512² |
| `Rock_Boulder_B` | 1,0 × 1,4 × 0,9 m | ~1.120 | 512² |
| `Rock_Slab` | 2,2 × 0,7 × 1,5 m | ~1.280 | 512² |
| `Rock_Pebble` | 0,22 × 0,13 × 0,17 m | ~220 | 128² |

Bauzeit ~1,1 s je Brocken (getestet). Schwebende Felsbrocken um die Insel sind dieselben Teile,
größer skaliert und frei im Raum gesetzt.

## Fallstricke

1. **Normal-Maps brauchen `TANGENT`:** `SweptMesh` liefert Tangenten (u um den Umfang, w = −1);
   ohne sie warnt der Validator.
2. **Gemeinsame Materialnamen** bedeuten identische Definition — der Zusammenbau nimmt das erste
   und verwirft spätere gleichnamige.
3. **Kronen wirken licht und dunkel**, wenn Karten zu klein, zu wenige oder Blattfarben zu dunkel
   sind; die weichen Kronennormalen sind Pflicht, sonst flackert die Krone facettiert.
4. **Alpha-Test** (`MASK`) mit Mipmaps lässt Kronen in der Ferne ausdünnen; Schwelle 0,45 und
   fortgesetzte Farbe unter Alpha 0 halten das klein.
