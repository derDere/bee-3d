---
name: babylon-modeling
description: Eigene 3D-Modelle für Babylon.js-Spiele lokal erzeugen und als fertige glb-Dateien mit PBR-Materialien und Texturen ausliefern — Python-Generatoren als versioniertes Werkzeug (SDF mit Smooth-Union → Marching Cubes → isotropes Remeshing auf Dreiecksbudget, manifold3d-Booleans und Hüllen-Röhren, UV-Abwicklung mit xatlas, gebackene Basisfarb- und ORM-Texturen mit AO, Knoten mit Pivots, Keyframe-Animation, LODs), Build-Schritt mit Validierung und Optimierung (gltf-transform, WebP, meshopt), Model Lab mit Kontaktbogen aus sechs Ansichten, Konventionen und Budgets, lokale KI-Modelle für Referenzbilder. Laden, wenn ein 3D-Modell, eine Figur, ein Tier, eine Pflanze, ein Requisit oder ein Felsen erzeugt, überarbeitet oder geprüft wird.
---

# Eigene 3D-Modelle

## Grundsätze

- **Ausgeliefert werden fertige Dateien.** Jedes Modell liegt als glb mit PBR-Materialien und
  eingebetteten Texturen unter `public/assets/models/`. Das Spiel lädt, platziert und
  instanziiert Modelle; es erzeugt keine Modellgeometrie zur Laufzeit. Generator-Code
  (`tools/models/`) und Model Lab sind Werkzeuge im Repo und gehören nicht ins Build-Artefakt.
- **Alles lokal.** Modelle entstehen ohne DCC-Programme (Blender, Maya, Unity …) und ohne
  Cloud-Generatoren oder APIs. Lokale KI-Modelle nur nach Freigabe durch den User und innerhalb
  der Ressourcengrenzen ([references/local-ai.md](references/local-ai.md)).
- **Jedes Modell hat einen Generator.** `tools/models/<name>.py` beschreibt das Modell
  parametrisch und seedbar und wird versioniert. `npm run models` erzeugt daraus die fertigen
  glb, die ebenfalls eingecheckt werden. Jede Änderung am Modell ist eine Änderung am Generator
  mit anschließendem `npm run models`.
- **Jeder Schritt wird angesehen.** Nach jedem Arbeitsschritt den Kontaktbogen im Model Lab
  ansehen; den Abschluss prüft der Agent `babylon-model-reviewer`.
- **Fremd-Assets sind gleichwertig.** Passt ein CC0-Modell (Skill `babylon-assets`), spart das
  Zeit. Massenware (Gras, Kiesel, Blüten) ist ein einfaches glb, das das Spiel per Thin Instances
  vervielfältigt.

## Ablauf vom Generator zum Build

| Schritt | Werkzeug | Ergebnis |
|---|---|---|
| Generator ausführen | `tools/models/<name>.py` (Python, uv) | Roh-glb mit PNG-Texturen in `.temp/models/` |
| Validieren | `npx gltf-transform validate` | 0 Fehler, 0 Warnungen, sonst Abbruch |
| Optimieren | `npx gltf-transform optimize` (WebP-Texturen, meshopt, Hierarchie bleibt) | fertiges glb in `public/assets/models/` |
| Alles zusammen | `npm run models` (`tools/models/build_all.py`) | alle Modelle neu erzeugt |
| Spiel bauen | `npm run build` | kopiert `public/` ins Artefakt; ruft kein Python auf |

## Werkzeuge

| Werkzeug | Zweck | Bereitstellung |
|---|---|---|
| `tools/models/` (uv-Projekt, Paket `modelkit`) | Generatoren: Felder, Vernetzung, Booleans, UVs, Texturen backen, glb | Vorlage `templates/tools-models/` → [references/pipeline.md](references/pipeline.md) |
| Model Lab (`lab.html`, `src/lab/`, nur Dev) | Kontaktbogen aus sechs Ansichten, Debug-Ansichten, Kennzahlen über `window.__lab` | Vorlage `templates/model-lab/` → [references/model-lab.md](references/model-lab.md) |
| `npx gltf-transform` | `validate`, `inspect`, `optimize`, `simplify` | devDependency `@gltf-transform/cli` |
| Agent `babylon-model-reviewer` | Modell im Lab begutachten, Textbericht | `.claude/agents/` |
| MCP `chrome-devtools` | Browser für Lab und Reviewer | `.mcp.json` |

## Einrichtung (einmal je Projekt, nach dem Grundgerüst des Spiels)

1. `templates/tools-models/` nach `tools/models/` kopieren, `uv lock --upgrade --project tools/models`
   und `uv sync --project tools/models` (lädt Python 3.13 und rund 180 MB Pakete).
2. `templates/model-lab/lab.html` in den Repo-Root, `templates/model-lab/src/lab/` nach `src/lab/`.
3. `package.json`: Skript `"models": "uv run --project tools/models tools/models/build_all.py"`
   (Skill `babylon-game-dev`, `references/setup.md`).
4. `.gitignore`: `.venv/`, `__pycache__/`, `.ruff_cache/` und `.temp/`.
5. Probe: `npm run models`, dann
   `http://127.0.0.1:5173/lab.html?model=/assets/models/bee.glb` öffnen. Das Beispiel danach
   löschen oder als Vorlage behalten — Entscheidung des Users.

## Arbeitsablauf je Modell

1. **Brief festhalten** (im Docstring des Generators): Zweck und Kameradistanz im Spiel, Stil
   laut Spec, Maße in Metern, Dreiecksbudget, Texturgrößen, Materialzonen, bewegte Teile mit
   Pivots, Animationen. Referenzen vom User (Bild oder Beschreibung) in eine
   **Proportionsliste** übersetzen (Verhältnisse wie „Kopf = 0,6 × Brustbreite").
2. **Blockout:** nur Grundkörper (Ellipsoide, Kapseln, Boxen), kleines Budget, kleine Texturen →
   Kontaktbogen. Silhouette und Proportionen in den orthografischen Ansichten gegen die
   Proportionsliste prüfen — die Beschriftungen nennen die Maße.
3. **Form:** Smooth-Union-Breiten, Gliedmaßen als Röhren, Einkerbungen, Details; volles Budget.
4. **Oberfläche:** Zonen mit Farbe, Rauheit und Metallizität, Muster, AO; Texturen backen.
5. **Struktur:** Knoten, Pivots, Animation; Posen im Lab prüfen (`&anim=…&t=…`).
6. **LOD-Stufen** ableiten (neu abwickeln, kleinere Texturen) und im Lab vergleichen.
7. **Build:** `npm run models` — validiert und erzeugt die fertigen Dateien.
8. **Review:** Agent `babylon-model-reviewer` mit Brief und Lab-URL; Befunde umsetzen. Nach
   höchstens drei Runden dem User zeigen.
9. **Übergabe:** Bewegung und Wirkung im Spiellicht beurteilt der User:
   „Modell gebaut, Lab: `<URL>`. Bitte ansehen: Achte auf X und Y."

Für schnelle Iterationen einen einzelnen Generator direkt ausführen
(`uv run --project tools/models tools/models/<name>.py`) und das Roh-glb im Lab ansehen
(`lab.html?model=/.temp/models/<name>.glb` — der Dev-Server liefert `.temp/` aus, der Build
nicht); vor dem Review läuft `npm run models`. Je Iteration eine zusammenhängende Änderung, dann ein
Kontaktbogen. Zahlenfragen (Maße, Dreiecke, Ursprung, Texturgrößen) beantwortet
`__lab.stats()` ohne Screenshot.

## Technikwahl

| Asset | Technik |
|---|---|
| Tiere, Figuren, Früchte, weiche Steine | SDF-Teilformen mit Smooth-Union → `remesh_to_budget` |
| Beine, Fühler, Stiele, Äste | `TubeChain` → `hull_tube` → Boolean mit dem Rumpf |
| Kisten, Bauten, Werkzeuge | manifold3d-CSG, Abrundung über `RoundedBox`-Feld oder `smooth_out` + `refine` |
| Flügel, Blüten- und Laubblätter | offene Membran- bzw. Ribbon-Netze, RGBA-Textur, doppelseitiges Material |
| Bäume, Sträucher | L-System oder Space Colonization → Röhren + Blattkarten |
| Varianten (Blumen, Steine) | mehrere Varianten per Seed im Generator, je Variante ein glb oder ein Knoten |
| Zustände (Leuchten, Geist, Laser), Mundformen | Materialvarianten mit Leuchtmasken, Formziele, geschlossene Hülle für Durchsichtigkeit → [references/techniques.md](references/techniques.md) |
| Schwebende Inseln und ihre Teile (Bäume, Gras, Blumen, Felsen, Wasserfall) | Skill `babylon-islands` |
| Gelände, Gras und Wasser im Spiel (Shader, Thin-Instance-Felder) | Skill `babylon-graphics` |

Parameter und Rezepte: [references/techniques.md](references/techniques.md).

## Konventionen

- **Einheiten und Achsen:** Meter, +Y oben, **+Z vorne** (glTF); die linke Körperseite der Figur
  liegt auf +X. Der glTF-Loader gleicht die Händigkeit über den Wurzelknoten `__root__` aus.
- **Ursprung:** Bodenobjekte mittig am Fuß (y = 0), fliegende Figuren im Schwerpunkt, bewegte
  Teile mit Pivot im Gelenk (Knotenposition).
- **Benennung:** Knoten PascalCase (`Bee`, `Body`, `Wing_L`, `Wing_R` — L/R aus Sicht der Figur),
  Materialien `<Modell>_<Zone>`, Texturen `<Material>_<lod>_<kanal>`, Animationen PascalCase
  (`WingFlap`). Der Spielcode greift über diese Namen zu.
- **Materialien:** glTF-PBR (Metallic-Roughness). Deckende Teile: Basisfarbtextur (sRGB) und
  ORM-Textur (R = Occlusion, G = Roughness, B = Metallic, linear; als metallicRoughness- und
  occlusion-Textur eingebunden). Transparente Teile: RGBA-Basisfarbtextur, `BLEND`,
  doppelseitig. So wenige Materialien wie möglich — jede Primitive mit eigenem Material ist ein
  Draw Call.
- **Texturgrößen:** Spielfigur 1024², Kleinteile 256–512², LOD1 halbe Kantenlänge; Paletten in
  sRGB notieren, gerechnet wird linear.
- **Dateien:** Roh `.temp/models/<name>.glb`, fertig `public/assets/models/<name>.glb` (LODs:
  `<name>-lod1.glb`); Eintrag in `docs/assets.md` mit Quelle „eigener Generator
  `tools/models/<name>.py`".

**Budgets** (Richtwerte für eine Arc-iGPU im Browser, an der Zielhardware messen):

| Kategorie | Dreiecke LOD0 |
|---|---|
| Spielfigur | 5.000–15.000 |
| Kleintiere, NPCs | 1.000–5.000 |
| Steine | 200–1.500 |
| Blumen (Thin Instances) | 100–600 |
| Bäume inkl. Blattkarten | 3.000–10.000; LOD1 ~30 %, LOD2 ~10 % oder Impostor |
| Szene sichtbar | 0,5–1,5 Mio., unter ~300–500 Draw Calls |

## Model Lab

`http://127.0.0.1:5173/lab.html?model=/assets/models/<name>.glb` (Dev-Server des Spiels).
Ein Screenshot zeigt FRONT, RIGHT, BACK, TOP (orthografisch, mit Maßen), 3/4 und eine
Nahaufnahme, dazu Kopfzeile mit Bounding Box, Rasterweite und Dreiecken.

| Parameter | Zweck |
|---|---|
| `view=<id>` | Einzelansicht bildfüllend (`front`, `right`, `back`, `top`, `three-quarter`, `close-up`) |
| `debug=<modus>` | `wireframe`, `normals`, `uv`, `vertexcolors`, `materialid` |
| `anim=<name>&t=<s>` | Pose einer Animation |
| `focus=x,y,z&focusSize=<m>` | Ausschnitt der Nahaufnahme |
| `focusDir=x,y,z` | Blickrichtung der Nahaufnahme (vom Fokus zur Kamera), z. B. für Rückseiten großer Modelle |
| `backend=webgl2` | Gegenprobe |

Protokoll, `window.__lab`-API und Lesehilfe für die Debug-Ansichten:
[references/model-lab.md](references/model-lab.md).

## Fallstricke

- Texturwerte aus der Weltposition je Texel berechnen (`evaluate_zones` auf `TexelMap.positions`)
  — Muster bleiben dadurch unabhängig von der Netzdichte scharf und überstehen Decimation.
- Validieren vor dem Komprimieren (der Validator prüft meshopt-komprimierte Dateien nicht).
- `gltf-transform optimize` mit `--flatten false --join false --instance false --palette false
  --simplify false --prune false`, sonst gehen Knoten, Anker, Pivots und Materialien verloren;
  bewegliche Knoten tragen ihr Mesh am Kindknoten `<Name>_Mesh` (Quantisierung verschiebt sonst
  den Pivot).
- Dünne Teile nicht ins SDF-Raster, sondern als Hüllen-Röhren.
- Die Normalen-Ansicht färbt nach Weltrichtung — gekippte Teile sind zu Recht anders gefärbt;
  Befund sind abrupte Sprünge auf glatten Flächen.
- Weitere: [references/pipeline.md](references/pipeline.md), Abschnitt „Fallstricke".

## Wegweiser

| Thema | Datei |
|---|---|
| Einrichtung, Bibliotheken, `modelkit`, Generator-Muster, Build, Fallstricke | [references/pipeline.md](references/pipeline.md) |
| Organisch, Hard-Surface, Pflanzen, Texturen, Animation, LOD | [references/techniques.md](references/techniques.md) |
| Model Lab: Einrichtung, Aufruf, API, Prüfprotokoll | [references/model-lab.md](references/model-lab.md) |
| Lokale KI-Modelle (Referenzbilder, Blockouts) | [references/local-ai.md](references/local-ai.md) |
| Fremd-Assets, Lizenzen, Decoder, Texturkompression | Skill `babylon-assets` |
| Schwebende Inseln, Bäume, Gras, Blumen, Felsbrocken, Wasserfall | Skill `babylon-islands` |
| Modell im Spiel: Licht, Materialien, Wind | Skill `babylon-graphics` |
