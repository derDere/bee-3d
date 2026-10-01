---
name: babylon-graphics
description: Hochwertige Optik für Babylon.js-9-Browserspiele — Standard-Licht-Stack für Außenszenen (Atmosphäre-Addon mit Tageszeit, Sonne, Kaskaden-Schatten, Lichtstrahlen, HDR-Post-Processing mit Bloom und Tonemapping), Frame Graph mit volumetrischem Licht, Nebel und Dunst, Wolken, PBR- und Node-Materialien, Wind auf Vegetation, Gras- und Blumenfelder mit Thin Instances, Gelände, Wasser, Partikel und Qualitätsstufen. Laden bei allem, was Licht, Himmel, Schatten, Materialien, Effekte oder den Gesamtlook betrifft.
---

# Optik und Rendering

Verifiziert gegen Babylon 9.29 (Typings, Quelltext, Laufzeittests auf WebGPU und WebGL2).
Signaturen vor dem Einbau gegen die installierten Typings prüfen (Skill `babylon-game-dev`).

- [references/sky-light-shadows.md](references/sky-light-shadows.md) — Atmosphäre, Sonne, Tageszeit, Schatten, Nebel, IBL
- [references/post-processing.md](references/post-processing.md) — Default-Pipeline, Tonemapping, Bloom, SSAO2, SSR, TAA, Lichtstrahlen
- [references/frame-graph-volumetrics.md](references/frame-graph-volumetrics.md) — Frame Graph, volumetrisches Licht, Atmosphäre-Brücke
- [references/materials-nature.md](references/materials-nature.md) — PBR, Node Materials, WGSL, Wind, Blätter, Gras, Bäume, Gelände, Wasser
- [references/particles-clouds.md](references/particles-clouds.md) — Partikel, Pollen, Wolken

## Look-Dev-Prinzipien

1. **Eine Lichtquelle führt:** die Sonne (`DirectionalLight`), Farbe und Umgebungslicht kommen aus
   der Atmosphäre.
2. **Physikalisch plausibel:** PBR-Materialien, lineares Licht, HDR-Kette bis zum Tonemapping.
3. **Tiefe** durch Luftperspektive und dezente Lichtstrahlen.
4. **Verankerung** durch weiche Kaskaden-Schatten und Kontaktschatten (SSAO).
5. **Lebendigkeit** durch Bewegung: Wind in Gras und Blüten, Pollen im Gegenlicht, ziehende Wolken.
6. **Farbe:** Tonemapping `TONEMAPPING_KHR_PBR_NEUTRAL` hält Farbton und Sättigung von Blüten und
   Laub; `TONEMAPPING_ACES` wirkt filmischer und verschiebt gesättigte Farben — im Look-Dev
   vergleichen. Stimmung über Color Curves (z. B. warme Lichter).
7. **Reihenfolge der Arbeit:** Licht und Himmel → Materialien → Post-Processing; jeder Schritt mit
   Screenshots geprüft (Skill `babylon-visual-qa`), Vorher/Nachher über `__game.setEffect`.

## Standard-Stack für Außenszenen

Klassische Renderschleife — zur Laufzeit auf WebGPU und WebGL2 geprüft:

| Baustein | Umsetzung |
|---|---|
| Himmel, Sonnenfarbe, Umgebungslicht, Luftperspektive | Atmosphäre-Addon (`@babylonjs/addons/atmosphere`, experimentell) |
| Sonne | `DirectionalLight` als **erstes** Licht der Szene, `intensity = Math.PI`, Tageszeit über `direction` |
| Sonnenscheibe | Billboard mit emissivem Material (das Addon zeichnet keine) |
| Schatten | `CascadedShadowGenerator` |
| Lichtstrahlen | `VolumetricLightScatteringPostProcess` mit der Sonnenscheibe als Lichtquelle |
| Kontaktschatten | `SSAO2RenderingPipeline` (ab Stufe `high`) |
| Post-Processing | `DefaultRenderingPipeline`: HDR, MSAA 4, Bloom, Tonemapping, Dithering, Vignette, Color Curves |

**Aufbaureihenfolge:**

1. Engine mit `enableAllFeatures: true` (Skill `babylon-game-dev`).
2. Szene, Kamera (`minZ = 0.1`, `maxZ = 0`), Sonne als erstes Licht.
3. Atmosphäre anlegen, `await atmosphere.preloadMaterialPluginShaderIncludesAsync()`.
4. **Erst danach** Materialien erzeugen und Modelle laden — das Atmosphäre-Plugin hängt sich nur
   an `PBRMaterial`s, die nach der Atmosphäre entstehen.
5. Schatten (`shadowMaxZ` explizit setzen), Post-Processing.
6. Transparentes (Wasser, Partikel, Wolken) in Rendering-Gruppe 1.

Code: [references/sky-light-shadows.md](references/sky-light-shadows.md), Abschnitt
„Standard-Stack".

## Option: Frame Graph mit volumetrischem Licht

Physikalisch basierte Lichtstrahlen durch Dunst (`FrameGraphVolumetricLightingTask`) gibt es nur im
Frame Graph. Ist `scene.frameGraph` gesetzt, rendert die Szene ausschließlich über dessen Tasks:
`DefaultRenderingPipeline`, GlowLayer und klassische Shadow-Generatoren bleiben wirkungslos, jede
Funktion wird als Task gebaut. Das Atmosphäre-Addon
unterstützt den Frame Graph nicht von sich aus; eine Brücke aus zwei Hooks bringt Himmel,
Luftperspektive, Sonnenfarbe und Umgebungslicht zurück. Diese Brücke ist ein inoffizieller Weg über
öffentliche API und wird nach jedem Babylon-Update erneut geprüft.

Kosten in der Testszene: ~50 fps unter WebGPU, ~32 fps unter WebGL2 → nur für `high`/`ultra` unter
WebGPU. Die Wahl zwischen Bildschirm-Lichtstrahlen und volumetrischem Licht trifft der User im
Look-Dev anhand von Vergleichsbildern.
Code: [references/frame-graph-volumetrics.md](references/frame-graph-volumetrics.md).

## Qualitätsstufen

Startwerte — per Messung justieren (Skill `babylon-performance`):

| Effekt | `low` | `medium` | `high` | `ultra` |
|---|---|---|---|---|
| Renderauflösung (Hardware-Scaling) | 1,5 | 1,25 | 1,0 | 1,0 |
| Kaskaden-Schatten | 2 × 1024, `QUALITY_LOW` | 3 × 2048, `QUALITY_MEDIUM` | 4 × 2048, `QUALITY_MEDIUM` | 4 × 4096, PCSS |
| Atmosphäre (LUTs) | an | an | an | an |
| Lichtstrahlen | aus | VLS, Ratio 0,5, 50 Samples | VLS, 100 Samples | VLS oder Frame-Graph-Volumetrie (WebGPU) |
| Bloom | aus | an, `bloomScale` 0,5 | an | an |
| SSAO2 | aus | aus | Ratio 0,5, 8 Samples | Ratio 0,5, 16 Samples |
| SSR | aus | aus | aus | nur Wasser |
| Kantenglättung | FXAA | MSAA 2 | MSAA 4 | MSAA 4 |
| Gras- und Blumendichte | 25 % | 50 % | 100 % | 100 %, größere Sichtweite |
| Partikel | 25 % | 50 % | 100 % | 100 % |
| Wolken | Mesh- oder Sprite-Wolken + 2D-Schichten | Raymarch ¼ Auflösung, zeitlich wiederverwendet | fern ½, nah ¼ Auflösung | wie `high` + Lichtvolumen (WebGPU) |

Unter WebGL2 höchstens `medium` als Startwert. Mit Volumenwolken gelten für Wolken, Nebel und
Lichtstrahlen die Stufen des Skills `babylon-sky`.

## Fallstricke

1. **Atmosphäre zuerst:** vor allen `PBRMaterial`s und glTF-Ladevorgängen anlegen; genau ein
   Licht übergeben, das zugleich das erste Licht der Szene ist (das Plugin nutzt fest `light0`).
2. **Sonnenfarbe nicht selbst setzen:** Das Addon überschreibt `sun.diffuse`/`specular` mit der
   Transmissionsfarbe und `scene.ambientColor` mit der Himmelsstrahlung.
3. **Kein Reverse-Depth-Buffer** mit dem Atmosphäre-Addon — der Himmel wird schwarz.
4. **`camera.maxZ = 0`** (unendliche Fernebene) → beim `CascadedShadowGenerator` `shadowMaxZ`
   explizit setzen, sonst keine Schatten.
5. **Transparentes** vor dem Himmels-Composite wird überdeckt: Wasser, Wolken und Partikel in
   Rendering-Gruppe 1, dazu `scene.setRenderingAutoClearDepthStencil(1, false, false, false)`.
6. **HDR durchreichen:** SSAO2, SSR, TAA und Motion Blur mit
   `Constants.TEXTURETYPE_HALF_FLOAT` erzeugen; die Standardtypen klemmen HDR vor Bloom und
   Tonemapping.
7. **MSAA oder TAA:** Vertex-Wind liefert keine Bewegungsvektoren — TAA zieht bei wehendem Gras
   Schlieren. Für Wiesen ist MSAA 4 die robuste Wahl.
8. **GlowLayer** wird vor der Default-Pipeline eingerechnet und doppelt geblüht — nur für gezielte
   Leuchtobjekte (`addIncludedOnlyMesh`), Highlights über Bloom.
9. **GLSL-only-Shader unter WebGPU** (eigene GLSL-Shader, `CloudProceduralTexture`) laden glslang
   und twgsl vom Babylon-CDN nach. Eigene Shader als WGSL plus GLSL oder als Node Material (erzeugt
   beides).
10. **Keine Himmelsspiegelung:** Das Addon setzt die spekulare Umgebung gleich der diffusen; auch
    Reflection Probes und Mirror-Texturen enthalten den Himmel nicht. Wasser und Metall brauchen
    eine eigene Spiegelquelle (siehe Materialien).
11. **Szenennebel** wirkt auf Meshes, der Atmosphäre-Himmel bleibt ungenebelt → Horizontbruch.
    Dunst über die Atmosphäre steuern (`mieScatteringScale`, `aerialPerspective*`).
12. **Material-Plugins** akzeptieren standardmäßig nur GLSL und werfen unter WebGPU —
    `isCompatible` für WGSL überschreiben.
13. **`scene.iblIntensity`** ist der physikalische Regler; `scene.environmentIntensity` dient laut
    Typings eher der Fehlersuche.
14. **Bloom-Schwelle** ist hart (kein Soft Knee): Mit HDR und Schwelle ≥ 1,0 blühen nur echte
    Highlights.
15. **VLS sieht nur Meshes:** Mit geraymarchten Wolken scheinen die Strahlen durch die Wolken
    hindurch — dann Radial-Blur mit Wolkenmaske (Skill `babylon-sky`).

## Nebel, Dunst, Wolken — Kurzfassung

- **Dunst:** physikalisch über die Atmosphäre (`physicalProperties.mieScatteringScale`,
  `aerialPerspectiveIntensity`); eingebauten Höhennebel oder volumetrischen Nebel gibt es nicht.
- **Wolken:** nichts eingebaut. Prototyp mit Himmelstextur oder geschichteten Billboards; für
  `medium`+ ein eigener Raymarch-Pass (halbe Auflösung, zeitliche Akkumulation) — Gerüst in
  [references/particles-clouds.md](references/particles-clouds.md).
- **Himmelswelt komplett** — ein Medium für Wolken, Wolkenmeer und Nebel, Komposition nach
  Rendering-Gruppe 0, Tag-Nacht-Zyklus mit Mond, Strahlen, Wetter, Fluggefühl: Skill
  `babylon-sky`.

## Materialien und Natur — Kurzfassung

- `PBRMaterial` als Standard (WGSL nativ, `subSurface`, Plugins); `OpenPBRMaterial` existiert,
  Status Alpha.
- Eigene Shader bevorzugt als Node Material (MCP `babylon-nme`, JSON ausliefern) — kompiliert für
  WGSL und GLSL. Wind auf PBR über ein `MaterialPluginBase`.
- Gras und Blumen als Thin Instances in Kacheln (Frustum Culling je Kachel), Bäume als
  `InstancedMesh` mit LOD, Gelände aus Heightmap, Wasser mit `WaterMaterial` (WGSL seit 9.5).
- Partikel: Pollen und Staub als CPU-Partikel mit Rauschen; Partikel-Graphen über MCP
  `babylon-npe`.
