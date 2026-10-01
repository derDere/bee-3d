# Modelliertechniken

Parameter mit „getestet" stammen aus der Beispielbiene; die übrigen sind Startwerte zum
Einstellen am Kontaktbogen.

## Organische Formen (SDF)

- **Teilformen** als Felder: `Ellipsoid` (optional gedreht), `TaperedCapsule`, `TubeChain`,
  `RoundedBox`. Formeln nach Inigo Quilez (iquilezles.org/articles/distfunctions) — weitere
  Primitive (Torus, Rundkegel, Bézier-Röhre) von dort übernehmen und vektorisiert umsetzen.
- **Smooth-Union-Breite `k`** in Metern, etwa 10–40 % des kleineren Teilradius. Biene:
  Kopf–Brust 0,012, Brust–Hinterleib 0,020, Hinterleib–Spitze 0,030 (getestet). Verschachtelte
  `SmoothUnion`s erlauben verschiedene Breiten je Übergang.
- **`SmoothSubtraction`** für Mulden, Augenhöhlen, Kerben.
- **Vernetzung:** `remesh_to_budget(sdf, face_budget)` — Marching Cubes mit Voxelgröße
  Zielkante / 3, isotropes Remeshing (`targetlen` aus dem Budget: e = √(4A / (√3·F)),
  8 Iterationen, `featuredeg` 60), danach 3 Newton-Schritte zurück auf die analytische Fläche.
  Das entfernt die Treppenstufen von Marching Cubes und verteilt die Dreiecke gleichmäßig
  (getestet).
- **Normalen:** `shade_with_creases(solid, 60)` — Kanten über 60° bleiben hart (Ansätze von
  Beinen), sonst glatt (getestet). Für reine Felder liefert `Sdf.gradient_normals` exakte
  Normalen.
- **Dünne Teile** (Beine, Fühler, Stiele, Äste unter ~3 Voxel Radius): `TubeChain` als
  Stützpunkte mit Radien, gebaut mit `hull_tube` (konvexe Hüllen aufeinanderfolgender Kugeln,
  8–10 Segmente), dann `union_all` mit dem Rumpf (getestet).

## Hard-Surface

- manifold3d-CSG mit `Manifold.cube`, `cylinder`, `sphere`, `extrude`/`revolve` aus 2D-`CrossSection`.
- **Abrundungen:**
  1. Feld-`RoundedBox` bzw. `SmoothSubtraction`, dann vernetzen — ideal für Steine, Sockel,
     Kisten mit weichen Kanten.
  2. `smooth_out(min_sharp_angle=52.5, min_smoothness=0.1–0.3)` + `refine_to_tolerance(0.0005–0.002)`;
     `min_smoothness > 0` ergibt eine kleine Hohlkehle.
  3. `calculate_normals` → `smooth_by_normals` → `refine_to_tolerance` (so baut manifolds
     eigener Fillet-Test seine Rundung).
  4. `minkowski_sum` mit kleiner Kugel nur für konvexe Körper — bei nicht-konvexen wächst der
     Aufwand mit dem Produkt der Flächenzahlen.
- Low-Poly-Stil: wenige Segmente, harte Kanten über `shade_with_creases` mit kleinem Winkel
  (z. B. 20°) oder vollständig flach schattiert: Ecken je Dreieck duplizieren und die
  Flächennormale setzen (als Funktion in `modelkit.geometry` ergänzen).

## Pflanzen

- **L-System:** Ersetzungsregeln + Turtle → Stützpunkte mit Radien → `TubeChain` + Hüllen-Röhren
  oder ein Ring-Sweep (verallgemeinerter Zylinder, UV-fähig). Astradien nach dem Pipe-Modell:
  r_Eltern² = Σ r_Kinder².
- **Space Colonization** (Runions 2007) für Kronen: 300–1000 Attraktoren in der Kronenhülle,
  Segmentlänge 2–5 % der Baumhöhe, Einflussradius 4–8 Segmente, Kill-Distanz 1–2 Segmente.
- **Blätter:** Alphakarten aus 2 Dreiecken (`alphaMode` MASK, doppelseitig, Textur) oder
  Geometrieblätter mit 8–16 Dreiecken, im Spiel als Instanzen bzw. Thin Instances.
- **Blütenblätter als Ribbon:** Catmull-Rom-Rückgrat, Breitenprofil sin(πt)^0,7, quer gewölbt,
  6–10 × 2–4 Segmente (24–80 Dreiecke); Anordnung im goldenen Winkel 137,5°.
- **Membranen** (Flügel, Blätter, Blüten): offene Netze als Ringfächer um einen Punkt nahe der
  Wurzel, leicht gewölbt; doppelseitiges Material. `BeeModel.wing_lobe` ist das Muster
  (getestet).
- Wind und Wiegen entstehen im Shader (Skill `babylon-graphics`), nicht als Keyframes.

## Oberfläche und Texturen

- **Ablauf:** `unwrap` (xatlas, Padding 4 px bei 1024², 2 px bei 512²) → `rasterize_uv` →
  Werte je Texel → `bake_base_color` / `bake_orm` (mit 8 px Dilatation) →
  `GltfBuilder.add_texture` (getestet).
- **Oberflächenzonen:** `SurfaceZone(region, color, roughness, metallic)` je Teilform;
  `evaluate_zones` mischt Farbe, Rauheit und Metallizität per Softmin der Distanzen (Weichheit
  4 mm bei der Biene, getestet). Muster über `banded_color` entlang einer lokalen Achse
  (`Ellipsoid.to_local`), Kantenweichheit `feather` 0,03 der normierten Achse.
- **Rauheit je Zone:** pelzig/matt 0,75–0,85, Chitin 0,45–0,55, glänzend 0,1–0,2 (Augen, Lack),
  Metallizität nur bei Metall (getestet an der Biene: Bruststück 0,85, Kopf 0,75, Hinterleib
  0,55, Beine 0,45).
- **Gebackene AO** (`bake_occlusion`): 64 kosinusgewichtete Strahlen, Reichweite 5 cm bei einer
  0,5-m-Figur (≈ 10 % der Größe), auf einem viermal gröberen Raster geschossen und bilinear
  hochgerechnet (`downscale=4`, 1/16 der Strahlen) — Kontakt-AO an Beinansätzen bleibt sichtbar
  (getestet). Getrennte Teile (Augen) als Verdecker mitgeben.
- **Feine Muster** als Funktion der Position bzw. lokaler Koordinaten: Facettenaugen als
  hexagonales Raster in Blickwinkeln (7° bei 256², 14° bei 128²), Flügeladern als Strecken in
  normierten Flügelkoordinaten mit 0,5–1 mm Breite und 0,25 mm Kantenweichheit (≈ 1 Texel bei
  512²) — `BeeModel.eye_surface` und `wing_surface` sind die Muster (getestet).
- **Transparenz:** RGBA-Basisfarbtextur, Alpha linear (Membran 0,18–0,5, Adern 0,9), `BLEND`,
  doppelseitig; Rauheit als Faktor, wenn sie über die Fläche konstant ist.
- **Normal-Maps** lohnen, wenn das Netz deutlich gröber als die Form ist (LOD, Hard-Surface mit
  Fasen): Tangentenraum-Normale aus dem SDF-Gradienten gegenüber der Netznormale backen und
  `TANGENT` mitschreiben. Als Baustein in `modelkit.baking` ergänzen, wenn ein Modell es braucht.

## Struktur und Animation

- **Knoten:** Wurzelknoten mit dem Modellnamen, darunter Teile mit eigener Bewegung. Die
  Knotenposition (`translation`) ist der Pivot; die Geometrie liegt lokal ab dem Ursprung.
- **Keyframes** über `GltfBuilder.add_rotation_animation`: Beispiel `WingFlap` — Rotation um +Z,
  12° + 48°·sin(2πt/T), T = 0,125 s, 9 Keys mit erstem = letztem Key für die nahtlose Schleife,
  rechte Seite mit negiertem Winkel (getestet). Für Translation und Skalierung den Builder um
  passende Spuren erweitern.
- **Prozedurale Bewegung** (Flügelschlag mit variabler Frequenz, Kopfdrehung) läuft oft besser
  im Spielcode auf den benannten Knoten (Skill `babylon-gameplay`); dann liefert das glb nur
  Knoten und Pivots.
- **Skinning** ist per Code machbar: Gelenke als Knoten, inverse Bind-Matrizen,
  `JOINTS_0`/`WEIGHTS_0` aus Distanzen zu den Knochensegmenten (höchstens 4 Gewichte, Summe 1);
  pygltflib kann `Skin` schreiben. Für starre Teile ist Knotenanimation billiger.

## LOD

- LOD1 per `decimate_quadric` auf ~30 % des LOD0-Budgets, LOD2 ~10 % oder ein Impostor; je Stufe
  neu abwickeln und mit halber Texturkantenlänge backen.
- Im Kontaktbogen beide Stufen vergleichen: Silhouette muss erhalten bleiben.
- Einbindung im Spiel per `addLODLevel` (Skill `babylon-performance`).
