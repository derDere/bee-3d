# Gestaltung: Was eine gute schwebende Insel ausmacht

Zusammengefasst aus Concept-Art-Anleitungen und Asset-Breakdowns (Quellen am Ende) und an den
Probeinseln im Model Lab überprüft. Werte mit „getestet" stammen aus diesen Proben.

## Silhouette

- **Oben am breitesten, nach unten verjüngt.** Die Grasnarbe ist die größte Fläche; alles darunter
  tritt zurück. So liest sich die Insel als herausgebrochenes Stück Land.
- **Unterseite als Felswand, die in Spitzen ausläuft.** Ein einfach gespiegelter Berg wirkt
  künstlich („schlechtes Spiegelbild"). Unter dem Erdband beginnt eine **steile Felswand** mit
  Schichten und Brüchen; erst darunter laufen die Linien zu **mehreren Spitzen** zusammen.
- **Mehrere, verschieden lange Spitzen:** eine Hauptspitze nahe der Mitte bis zur vollen
  Tiefe, 3–7 Nebenspitzen weiter außen, die bei 55–85 % der Tiefe enden (getestet). Ein einzelner
  zentraler Kegel wirkt wie ein Blumentopf.
- **Asymmetrie:** Unterseite zur Spitze hin seitlich versetzt (10–22 % des Radius), gelappt
  (±40 % zur Tiefe hin), Umriss unregelmäßig (Harmonische 2.–7. Ordnung, 1–7 % Amplitude) —
  kein Kreis, keine Spiegelachse.
- **Tiefe:** 0,6–0,9 × Durchmesser (Standard 0,75); der Kernkörper endet bei 42–55 % der Tiefe
  mit runder Unterseite, aus der die Spitzen hängen (getestet).

## Kante und Schichtung

- **Grasnarbe mit Lippe:** Das Gras wölbt sich über die Kante (Verrundung ~1 % D) und steht über
  dem Erdband über (~1,2 % D) — die dunkle Schattenlinie darunter trennt Plateau und Unterseite.
- **Erdband sichtbar machen:** ~4,8 % D dick (bei 40 m ≈ 1,9 m), warmes Braun mit Wurzelfasern
  und Kieseln. Zu dünn liest es sich als Strich.
- **Gesteinsschichten** (Abstand D/24) mit wechselnder Härte: harte Schichten treten als Simse
  hervor, weiche weichen zurück; die Schichten sind leicht geneigt und wellig. Dazu
  **versetzte Blöcke** (Zellrauschen, ~10 % D groß, senkrecht gestreckt) mit Rissen dazwischen —
  das ergibt die „Brüche im Fels", die der Insel Charakter geben.
- **Farbkontrast zwischen Schichten gering halten** (Helligkeitsunterschied ≤ ~20 %), Fugen nur
  leicht abdunkeln (×0,82). Starke Streifen wirken wie eine Schichttorte (getestet).

## Farbwerte

- **Plateau hell und satt**, Erdband warm, **Fels nach unten dunkler und kühler** (bis 70 % zur
  Farbe `rock_deep` ≈ sRGB 0,30/0,31/0,37). Die Werteabstufung trennt Plateau und Unterseite
  auch im Gegenlicht.
- Palette (sRGB, `IslandPalette`): Gras 0,34/0,54/0,17 mit dunkler, heller und trockener
  Variante; Erde 0,40/0,27/0,17; Fels-Schichten um 0,54–0,66 grau-ocker; Moos 0,30/0,43/0,13;
  Sand 0,74/0,66/0,49.
- Klare Grundfarben mit Normal-Map wirken stilisiert und sauber; feine Farbvariation kommt aus
  großflächigem Rauschen, nicht aus Pixelrauschen.

## Details, die die Insel glaubwürdig machen

| Detail | Wirkung | Umsetzung |
|---|---|---|
| Hängende Wurzeln | verankern die Insel „biologisch", wichtigstes Detail laut aller Quellen | `roots.py`, in Gruppen, an der Wand anliegend |
| Wasserfall über die Kante | Blickfang, erzählt Herkunft des Wassers | Bach in Kerbe, Wurfparabel, Gischtschleier |
| Moos auf Simsen | Feuchtigkeit, Alter | nach oben weisende Flächen der oberen Felswand |
| Nasse Spur unter dem Wasserfall | Verbindung Wasser–Fels | dunkler, glatter (Rauheit 0,3) |
| Kahle Erd- und Kiesflecken | bricht die grüne Fläche | gehäuft zur Kante und an Kuppen |
| Gras über der Kante | weicher Übergang, Fülle | Büschel am Rand nach außen geneigt |
| Kleine schwebende Felsbrocken | Maßstab, Magie, Tiefe | Felsbrocken-Teile um und unter der Insel, langsam schwebend im Spiel |
| Bäume mit Wurzelanläufen | sitzen sichtbar im Boden | 4–6 Wurzelanläufe je Baum |

## Bepflanzung als Komposition

- Bäume in **Gruppen** (Hain) und einzelne Solitäre, nicht gleichmäßig verteilt; frei bleiben
  Sichtachsen auf Teich und Wasserfall.
- Höhenstaffel: Gras → Blumeninseln → Büsche am Hain- und Teichrand → Bäume.
- Blumen in **Flecken einer Art** (Wiesen-Logik), nicht als Konfetti.
- Ufer: Kiesel, Schilf- oder Blütenbüsche; Seerosen auf dem Teich.
- Kleine Inseln (10–15 m): ein Solitärbaum oder ein Busch, kein Teich oder nur ein kleiner —
  wenige, große Gesten.

## Typische Fehler

| Fehler | Abhilfe |
|---|---|
| Unterseite als gleichmäßiger Kegel | Kernkörper flach, Spitzen außen ansetzen, Versatz und Lappen |
| Streifen wie eine Schichttorte | Schichtfarben angleichen, Härte variieren, Blöcke darüberlegen |
| Knetiger, „geschmolzener" Fels | Grate- und Rauschamplitude klein (~1 % D), Form aus Schichten und Blöcken |
| Lichte, dunkle Baumkronen | mehr und größere Blattkarten, hellere Blattfarben, weiche Kronennormalen |
| Blumen auf Inselmaßstab unsichtbar | stilisiert vergrößern (Faktor 1,6), in Flecken setzen |
| Wurzeln stehen waagrecht ab | Schwerkraft stärker als Rauschen, steiler Start |
| Waagrechter Erdstreifen ohne Lippe | Verrundung und Überstand der Grasnarbe |

## Quellen

- [80.lv – Crafting a Stylized Floating Island with Waterfall](https://80.lv/articles/crafting-a-stylized-floating-island-with-waterfall-001agt):
  Grasfarbe nach Ausrichtung zur Hochachse, Flächen aus klaren Farben plus Normal-Maps,
  Wasserfall aus laminarer Strömung, Turbulenz, Spritzern und Gischt.
- [Map Effects – How to Draw a Floating Island](https://www.mapeffects.co/tutorials/floating-islands):
  Unterseite als Felswand, die in Spitzen zusammenläuft, Sedimentschichten und Brüche.
- [80.lv – Creating a Stylized Waterfall in Unity](https://80.lv/articles/creating-a-stylized-waterfall-in-unity-part-1)
  und [Season – waterfall](https://realtimevfx.com/t/how-we-made-waterfall-in-season-a-letter-to-the-future/23420):
  Mesh mit UVs in Fließrichtung, Schaum zum Fuß hin, Wasserfall plus Ringwellen-Mesh.
- [Infinite Photorealistic Worlds using Procedural Generation](https://arxiv.org/pdf/2306.09310):
  Felselemente als Distanzfelder, verzerrtes Rauschen für Erosion, Zellrauschen für Felsplatten.
- Runions, Lane, Prusinkiewicz (2007): *Modeling Trees with a Space Colonization Algorithm*.
