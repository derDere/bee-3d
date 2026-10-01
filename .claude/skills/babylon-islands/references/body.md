# Inselkörper

`islandkit.terrain.IslandTerrain` ist ein Distanzfeld (negativ innen, Meter, +Y oben, Ursprung
in der Plateaumitte). `islandkit.body.build_body` vernetzt es, wickelt ab und backt Farbe,
Normal-Map und ORM. Alle Zahlen sind Startwerte aus `IslandSpec`/`TerrainPlan`; „getestet"
heißt: an Probeinseln im Model Lab angesehen.

## Steckbrief und Plan

- `IslandSpec(name, seed, diameter, depth_ratio=0.75, pond, stream, tree_count, …, texel_size=0.05,
  max_texture=4096, faces_per_meter=1000)` — Durchmesser 10–100 m; ein Bach braucht einen Teich.
- `IslandDimensions.of(spec)`: Erdband 4,8 % D (0,6–3,6 m), Grasnarbe am Rand 0,3 × Erdband,
  Überstand 1,2 % D, Lippenverrundung 1 % D, Schichtabstand D/24, Hügel 1,6 % D, Kuppel 2,2 % D.
- `TerrainPlan.create(spec)` würfelt aus dem Seed: Umriss-Harmonische, Versatz der Unterseite,
  Profilform, Schichtneigung, Felsspitzen, Teich, Bachverlauf. Andere Form → anderer Seed oder
  Planwerte anpassen; der Plan ist ein Dataclass und lässt sich gezielt ersetzen
  (`dataclasses.replace`).

## Aufbau des Feldes

Reihenfolge in `IslandTerrain._evaluate`:

1. **Umriss** R(θ) = R · (1 + Σ aₖ·cos(kθ + φₖ)) · (1 + 0,05 · fBm(Kreis)), k = 2, 3, 4, 5, 7 mit
   aₖ ≈ 7 / 5 / 2,5 / 1,8 / 1 % — als Tabelle über 4096 Winkel vorberechnet.
2. **Profil** P(y) als monotone Kurve (PCHIP) durch: Plateau 1 → Lippe 1 → Erdband 1 − ü/R
   (zurückversetzt) → Felskopf 1 − 0,7 ü/R → Felswand rock_top · (1 − t^Schulter)^Verjüngung für
   t = 0,06…0,97 → 0 bei der Kerntiefe. Schulter 1,6–2,4 (hält die Wand steil), Verjüngung
   0,55–0,75, Kerntiefe 0,42–0,55 × Tiefe (getestet). Stützstellen müssen streng steigen.
3. **Seitenabstand** (r − R(θ)·P(y)·Lappen) / √(1 + (R·P′)²) mit seitlichem Versatz t²·Versatz
   (10–22 % R) und Lappen 1 + 0,4·t·fBm(Winkel, t); t = Tiefe ab Erdbandunterkante relativ zur
   Gesamttiefe.
4. **Plateau** y − h(x, z), h = Kuppel·(1 − q²) + 2,2·Hügel·fBm + 3,5 cm Grasnarbe (Oktaven bis
   ~0,1 m); weich mit dem Seitenabstand verschnitten (Smooth-Max, k = Lippenverrundung), unten
   bei der Kerntiefe abgeschlossen.
5. **Felsspitzen** als bauchige Kegel, Radius r₁ + (r₀ − r₁)·(1 − t^1,5)^0,85, Smooth-Union mit
   k = 0,35 r₀, ausgewertet nur in ihrer Hüllbox. Hauptspitze: Ansatz bei 40–60 % der Kerntiefe,
   r₀ = 45–60 % des örtlichen Kernradius, bis zur vollen Tiefe. Nebenspitzen: 3–4 + D/20, Ansatz
   bei 55–85 % des Kernradius außen, r₀ = 22–38 %, Ende bei 55–85 % der Tiefe (getestet).
6. **Fels** auf domänenverzerrten Koordinaten (3,5 % D), Gewicht von 0,6 bis 1,5 × Erdbanddicke
   unter der Grasnarbe einblenden, zur Spitze hin ausblenden:
   - Schichten: 0,5 · Abstand · Härte · sin(πf)^0,6, Härte 0,15 + 0,85 · hash(Schicht)², Schicht-
     koordinate = (y + Neigung·xz + 1,1·Abstand·fBm) / Abstand.
   - Blöcke: 3,5 % D · (Zellwert − 0,5), Zellen 10 % D, senkrecht auf das 2,2-Fache gestreckt;
     `CellularSample.blended_value(0.06)` hält das Feld an den Zellgrenzen stetig.
   - Risse an den Zellgrenzen −0,9 % D, Grate (ridged, 5 Oktaven, f = 9/D) ±1 % D, Korn (5 Oktaven,
     f = 40/D) 0,4 % D.
7. **Erdband** klumpig: 0,12 · Dicke · fBm.
8. **Teich und Bach** weich abgezogen (k = 0,35 m):
   - Teich: Ellipsoid, um 0,5 × Tiefe angehoben und 6 % größer, damit die Wasserlinie auf den
     Teichradien liegt; Ufer ±16 % unregelmäßig. Wasserspiegel = tiefste Plateauhöhe auf dem
     1,25-fachen Ufer − 0,12 m.
   - Bach: Polylinie (48 Punkte) vom Teich zur Kante mit Mäander 9 % R, auf den letzten 25 %
     gerade (Kerbe senkrecht zur Kante); Querschnitt elliptisch, Halbbreite 4,4 % R (0,35–2 m),
     Tiefe 0,45 × Halbbreite; Wasserspiegel fällt monoton (laufendes Minimum) um 0,25 + 0,01 R m.
     Die Linie reicht über die Kante hinaus und schneidet dort die Kerbe für den Wasserfall.
   - Wasserspiegel entstehen aus der groben Plateauhöhe (`_WATER_CUTOFF`) und sind für Netz- und
     Texturfeld gleich.

**Detailgrenze:** `IslandTerrain(spec, plan, min_wavelength)` lässt Oktaven unter der
Wellenlänge weg. Netz: doppelte Kantenlänge; Normal-Map und Farben: 0. `body.mesh_terrain` ist
das grobe Feld — Wurzeln und Platzierung richten sich danach.

## Netz und Texturen

| Schritt | Werte |
|---|---|
| Vernetzung | Budget `faces_per_meter × D`; Kantenlänge aus der geschätzten Fläche; Marching Cubes mit Voxel = Kante/2, isotropes Remeshing, Newton-Projektion |
| Abwicklung | xatlas, Padding max(4, Größe/512) px |
| Texturgröße | Zweierpotenz für 5 cm/Texel bei ~70 % Belegung, 512–4096 |
| Verdeckung | 48 Strahlen, Reichweite 4 % D, Raster viermal gröber |
| Detailnormalen | Tetraeder-Gradient des vollen Feldes, Schrittweite ½ Texel (glättet Unter-Texel-Rauschen) |
| Normal-Map | Tangentenraum nach glTF, `TANGENT` aus den UVs (`UnwrappedMesh.tangents`) |
| ORM | R = AO, G = Rauheit; ab 4096² in halber Größe (2 × 2 gemittelt) |
| Material | `Island_Body`: Faktoren Metallic/Roughness 1, ORM als metallicRoughness und occlusion |

**Bemalung** (`IslandPainter`, je Texel, Detailnormalen für Neigungen):

| Zone | Bedingung | Farbe / Rauheit |
|---|---|---|
| Gras | bis ~1 × Grasnarbentiefe unter dem Plateau (wellig), Normale y > 0,25–0,6 | dunkel/mittel/hell nach großem Rauschen, trocken am Rand; 0,92 |
| Kahle Stellen | Rauschen > 0,32–0,5, gehäuft ab 80 % Radius | helle Erde mit Kies |
| Erde | zwischen Gras und Fels | Braun, Wurzelfasern (ridged, waagrecht gestreckt), Kiesel (Zellen 7/m); 0,95 |
| Fels | ab 0,75–1,25 × Erdbanddicke (wellig) | Schichtfarbe je Schicht, Fugen ×0,82, Blöcke ±16 %, Risse ×0,45, Grate hell, senkrechte Wasserspuren, zur Spitze 70 % `rock_deep`; 0,84 − 0,12·Grat |
| Moos | Normale y > 0,3–0,65 in der oberen Hälfte der Wand | Moosgrün nach Fleckenrauschen |
| Bett | im Teich-/Bachausschnitt | Sand → Schlamm mit der Wassertiefe; 0,5 |
| Ufer | bis 0,9 m neben dem Wasser, bis 0,35 m über dem Spiegel | Sand; 0,6 |
| Nass | unter der Bachmündung, 35 % der Tiefe | ×0,55; 0,3 |

Zusätzlich dunkelt die AO die Farbe leicht ab (×0,78–1), die volle Verdeckung trägt die ORM.

## Laufzeiten (Core Ultra 9 285H)

| Insel | Textur | Körper | gesamt mit Wurzeln, Wasser, glb |
|---|---|---|---|
| 12 m | 512² | 12.000 Dreiecke | 7,3 s (getestet) |
| 40 m | 1024² | 41.000 Dreiecke | 25 s (getestet) |
| 40 m | 2048² | 41.000 Dreiecke | ~50 s (getestet) |
| 95 m | 4096², ORM 2048² | 93.000 Dreiecke | 178 s: Netz 28, Abwicklung 27, AO 17, Detailnormalen 46, Bemalung 28, Kodierung 13 (getestet) |

Feldauswertung ~1,6 µs je Punkt (40 m, alle Oktaven); numba-Rauschen ~10 ns je Punkt und
Oktave. Für Iterationen `--texture 1024` nutzen.

## Fallstricke

1. **Newton auf verschobenen Feldern:** Schichten und Blöcke machen |∇d| > 1;
   `Sdf.project_to_surface` rechnet d·∇d/|∇d|² und konvergiert trotzdem.
2. **Unstetige Verschiebungen** (Zellwerte ohne Übergang) erzeugen Löcher und Stufenartefakte —
   für Verschiebungen `blended_value` verwenden, `value` nur für Farben.
3. **Grobes und feines Feld** müssen denselben Seed und dieselben Oktaven-Drehungen haben;
   `Fractal` legt sie oktavweise fest, `min_wavelength` schneidet nur ab.
4. **Teure Teilfelder** (Spitzen, Teich, Bach) nur in ihrer Hüllbox auswerten; sonst kostet jede
   Spitze die volle Punktmenge.
5. **Kerbe und Wasserfall** passen nur zusammen, wenn der Bach geradlinig über die Kante läuft
   (Mäander auf den letzten 25 % ausgeblendet).
6. **Sehr kleine Inseln** (≤ 12 m): Mindestmaße greifen (Erdband ≥ 0,6 m, Schichten ≥ 0,4 m,
   Teich ≥ 1,3 m) — Proportionen im Kontaktbogen prüfen, ggf. `pond=False`.
