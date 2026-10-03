# Assets – Herkunft und Lizenz

Alle Modelle des Spiels sind eigene Arbeit: Python-Generatoren unter `tools/models/` erzeugen
sie als fertige glb-Dateien mit PBR-Materialien und Texturen (Skill `babylon-modeling`).
`uv run --project tools/models tools/models/build_all.py` baut sie neu (`--only bee,fly` grenzt ein).
Klänge entstehen zur Laufzeit prozedural; das Wolkenrauschen erzeugt ein Web Worker beim Start.
Es gibt keine Audiodateien, keine fremden Texturen und keine fremden Modelle.

## Modelle

| Datei unter `public/assets/models/` | Inhalt | Generator | Lizenz |
|---|---|---|---|
| `bee.glb` | Spielerbiene (0,58 m Modellmaß, im Spiel auf 0,2 m skaliert), Varianten Day/Night/Ghost/Laser, Flügelschlag, Mund-Morphs | `tools/models/bee.py`, `tools/models/beekit/` | eigene Arbeit |
| `fly.glb` | Schmeißfliege mit Augen-Emissive-Maske, Animationen `WingFlap` und `Idle` | `tools/models/fly.py`, `tools/models/flykit/` | eigene Arbeit |
| `fly-brummer.glb` | Brummer (große Fliege) | `tools/models/fly.py` | eigene Arbeit |
| `fly-queen.glb` | Fliegenkönigin (Endgegner) | `tools/models/fly.py` | eigene Arbeit |
| `hive.glb` | Bienenstock-Station: Strohkorb, Waben, Flugloch, Wabenhalle; Anker `DockPoint`, `EntrancePoint`, `HangarPoint`, `HangarCamera`, `BeaconPoint` | `tools/models/hive.py`, `tools/models/hivekit/` | eigene Arbeit |
| `hive-lod1.glb` | Bienenstock für die Ferne (ohne Halle) | `tools/models/hive.py` | eigene Arbeit |
| `islands/island-<name>.glb`, `-lod1`, `-lod2` | Schwebende Inseln (tiny, blossom, hill, meadow, cliff, grove, terrace, lake, nest) in drei Detailstufen | `tools/models/sky_islands.py`, `tools/models/islandkit/` | eigene Arbeit |
| `flora/*.glb` | Gräser, Blumen, Büsche, Bäume, Felsen, Seerosen, Pilze, Madenhügel | `tools/models/island_flora.py`, `tools/models/islandkit/` | eigene Arbeit |

`shared/islandCatalog.ts` (Maße, Blumenfelder, Kollisionsfelder der Inseln) schreibt
`tools/models/sky_islands.py`.

## Selbst gehostete Bibliotheken

Die Engine lädt diese Dateien vom eigenen Server, nie von einem CDN:

| Datei unter `public/babylon/` | Zweck | Herkunft | Lizenz |
|---|---|---|---|
| `glslang/glslang.js`, `glslang.wasm` | GLSL → SPIR-V für eigene Shader unter WebGPU | Babylon.js-CDN, GLSLang v11.8.0 der Khronos Group | Apache 2.0 |
| `twgsl/twgsl.js`, `twgsl.wasm` | SPIR-V → WGSL unter WebGPU | Babylon.js-CDN, [TWGSL](https://github.com/BabylonJS/twgsl) | Apache 2.0 |
| `meshopt/meshopt_decoder.js` | Decoder für `EXT_meshopt_compression` der Modelle | Babylon.js-CDN (`v9.29.0`), [meshoptimizer](https://github.com/zeux/meshoptimizer) von Arseny Kapoulkine | MIT |

Die Lizenzangaben stehen in `node_modules/@babylonjs/core/NOTICE.md` und im Kopf von
`meshopt_decoder.js`.

## Schriften

Die Oberfläche (HUD) setzt ihre Texte in der runden Schrift Fredoka. `src/hud/hud.css` bindet sie
per `@font-face` vom eigenen Server ein:

| Datei unter `public/assets/fonts/` | Inhalt | Herkunft | Lizenz |
|---|---|---|---|
| `fredoka/Fredoka-Latin.woff2` | Fredoka von Milena Brandão (Hafontia) als WOFF2: variable Strichstärke 300–700, Breite fest auf 100, Zeichen von Basic Latin, Latin-1 und Latin Extended-A, dazu Satzzeichen, Pfeile, € und ™ | [google/fonts](https://github.com/google/fonts/tree/main/ofl/fredoka), Datei `ofl/fredoka/Fredoka[wdth,wght].ttf`, mit fonttools zugeschnitten | SIL Open Font License 1.1 |
| `fredoka/OFL.txt` | Lizenztext mit Copyright-Vermerk der Fredoka Project Authors | [google/fonts](https://github.com/google/fonts/tree/main/ofl/fredoka) | – |

Die Lizenz reserviert keinen Schriftnamen, deshalb trägt auch die zugeschnittene Fassung den Namen
Fredoka. So entsteht die Datei aus der Originaldatei neu:

```bash
uvx --from fonttools fonttools varLib.instancer "Fredoka[wdth,wght].ttf" wdth=100 -o Fredoka-wght.ttf
uvx --from fonttools --with brotli pyftsubset Fredoka-wght.ttf --layout-features="*" --flavor=woff2 \
  --unicodes="U+0000-00FF,U+0100-017F,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2190-2199,U+2212,U+2215,U+FEFF,U+FFFD" \
  --output-file=Fredoka-Latin.woff2
```

## Sonstiges

| Datei | Inhalt | Lizenz |
|---|---|---|
| `public/favicon.svg` | Biene als Vektorgrafik | eigene Arbeit |
