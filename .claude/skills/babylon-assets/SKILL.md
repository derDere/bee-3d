---
name: babylon-assets
description: Assets für Babylon.js-Browserspiele beschaffen, prüfen und einbinden — freie Quellen mit geprüfter Lizenz (Poly Haven, ambientCG, Kenney, Quaternius, Freesound), Poly-Haven-API, Lizenznachweis in docs/assets.md, Ordnerstruktur unter public/, glTF-Pipeline mit gltf-transform (meshopt, KTX2, LODs), selbst gehostete Decoder, HDRI zu .env, prozedurale Alternativen (Node Materials, Partikel-Graphen, ZzFX) und kostenpflichtige Generatoren nur nach Freigabe. Laden, wenn Modelle, Texturen, HDRIs, Sounds oder Musik gesucht, geladen, optimiert oder lizenzrechtlich geprüft werden.
---

# Assets beschaffen und einbinden

## Grundsätze

- **Lizenz vor Einbau.** CC0 bevorzugt. CC-BY nur mit Nennung in den Credits. Lizenzen mit
  NC-Klausel (nicht kommerziell) und unklare Lizenzen werden nicht verwendet.
- **Nachweis:** Jedes fremde Asset bekommt vor dem Einbau einen Eintrag in `docs/assets.md`.
- **Kostenpflichtige Dienste** (KI-Generatoren, Audio-Generatoren, Kaufassets) nur nach
  ausdrücklicher Freigabe durch den User — Kosten und kommerzielle Nutzungsrechte hängen am
  jeweiligen Tarif.
- **Downloads während der Entwicklung**, ausgeliefert wird aus `public/`. Das Spiel ruft zur
  Laufzeit keine Asset-APIs Dritter auf.

## Freie Quellen

| Quelle | Inhalt | Lizenz | Zugriff |
|---|---|---|---|
| Poly Haven | HDRIs, PBR-Texturen, Modelle (glTF) | CC0 | `https://api.polyhaven.com`, eigener User-Agent Pflicht |
| ambientCG | PBR-Materialien, HDRIs | CC0 | ambientcg.com, API: docs.ambientcg.com |
| Kenney | Modelle, UI, Sprites, Audio | CC0 | kenney.nl |
| Quaternius | stilisierte Low-Poly-Modelle (u. a. Stylized Nature MegaKit), glTF | CC0 | quaternius.com, itch.io |
| Freesound | Geräusche | je Sound (CC0, CC-BY, CC-BY-NC) — nach CC0/CC-BY filtern | freesound.org |
| Poly Pizza, Sketchfab | Modelle | je Modell verschieden — einzeln prüfen | Website; Sketchfab-Download-API braucht Token |

Poly Havens API-Bedingungen: frei nutzbar, auch kommerziell. Eine Quellennennung verlangt nur
die Live-Nutzung der API im Produkt; heruntergeladene und selbst gehostete CC0-Assets sind davon
ausgenommen. Jede Anfrage braucht einen eindeutigen User-Agent mit dem Softwarenamen.

## Poly-Haven-API

| Endpunkt | Ergebnis |
|---|---|
| `GET /assets?t=hdris\|textures\|models&c=<kategorie>` | Objekt: Asset-ID → Metadaten (Name, Kategorien, Tags, max. Auflösung, Thumbnail) |
| `GET /search?q=<text>&t=<typ>` | Treffer `{ slug, score }` |
| `GET /info/<id>` | Metadaten eines Assets |
| `GET /files/<id>` | Dateibaum: HDRI `hdri.<1k\|2k\|4k…>.<hdr\|exr>`; Texturen und Modelle `gltf.<auflösung>` mit `include` (abhängige Dateien); je Datei `url`, `md5`, `size` |

```
curl -sA "bee-3d" "https://api.polyhaven.com/assets?t=hdris&c=outdoor" -o .temp/polyhaven-hdris.json
curl -sA "bee-3d" "https://api.polyhaven.com/files/<id>" -o .temp/polyhaven-files.json
curl -sLA "bee-3d" "<url aus files.json>" -o .temp/downloads/<id>_2k.hdr
```

Rohdownloads landen in `.temp/` und gelangen erst nach Aufbereitung nach `public/`.

## Ordnerstruktur

```
public/assets/
  models/      <name>.glb (aufbereitet)
  textures/    <set>/ (KTX2 oder WebP)
  env/         <name>.env (vorgefilterte IBL-Umgebungen)
  audio/       music/ sfx/
  ui/          HUD-Grafiken, Schriften
public/babylon/  selbst gehostete Decoder (Draco, meshopt, KTX2)
docs/assets.md   Herkunft und Lizenz
```

URLs im Code über `import.meta.env.BASE_URL` bilden
(`` `${import.meta.env.BASE_URL}assets/models/bee.glb` ``). Rohdateien (Original-HDRIs,
`.blend`) gehören nicht nach `public/`; Ablage und ggf. Git LFS legt die Spec fest.

## Lizenznachweis `docs/assets.md`

```markdown
# Asset-Nachweis

| Datei | Quelle | Urheber | Lizenz | Abgerufen | Bearbeitung |
|---|---|---|---|---|---|
| public/assets/env/meadow.env | https://polyhaven.com/a/<id> | <Name> | CC0 | 2026-10-01 | HDR 2k → .env (IBL-Tool) |
```

## glTF-Pipeline (gltf-transform)

`@gltf-transform/cli` als devDependency (neueste Version), Aufruf über `npx gltf-transform`.

```
npx gltf-transform inspect .temp/downloads/model.glb
npx gltf-transform optimize .temp/downloads/model.glb public/assets/models/model.glb --compress meshopt --texture-compress ktx2 --texture-size 2048 --flatten false --join false --palette false --simplify false --instance false
npx gltf-transform validate public/assets/models/model.glb
```

- `optimize` aktiviert standardmäßig auch `instance`, `palette`, `flatten`, `join`, `weld` und
  `simplify`. `flatten` und `join` zerstören benannte oder animierte Hierarchien (z. B.
  Flügelknoten) — für Spielfiguren abschalten. Die Schreibweise `--flag false` mit
  `npx gltf-transform optimize --help` bestätigen.
- `--texture-compress ktx2` wählt UASTC für Normal-, Occlusion- und Metallic-Roughness-Maps und
  ETC1S für Farbtexturen. `etc1s`/`uastc` brauchen das Programm `ktx` aus KTX-Software (≥ 4.4)
  im PATH; ohne KTX-Software `--texture-compress webp` (wird auf der GPU unkomprimiert, mehr
  VRAM).
- LOD-Stufen: `npx gltf-transform simplify in.glb out_lod1.glb --ratio 0.5 --error 0.01`
  (Optionen mit `--help` prüfen), im Spiel per `addLODLevel` (Skill `babylon-performance`).
- Weitere Befehle: `dedup`, `prune`, `resize` (nur PNG/JPEG), `weld`, `center`, `merge`,
  `draco`, `meshopt`, `quantize`.

## Decoder selbst hosten

Babylon lädt Draco-, meshopt- und KTX2-Decoder standardmäßig vom CDN
(`cdn.babylonjs.com/v<version>/…`, versionsgenau). Für Produktions-Builds selbst hosten
(Verfügbarkeit, keine Anfragen an Dritte): Dateien nach `public/babylon/` kopieren —
Draco und meshopt aus `node_modules/@babylonjs/core/assets/{Draco,meshopt}/`, die
KTX2-Transcoder aus `@babylonjs/ktx2decoder` (Ordner `wasm/`), `babylon.ktx2Decoder.js` aus
`babylonjs-ktx2decoder`. Die npm-Dateien sind identisch mit den CDN-Dateien. Dateinamen nach
der Installation im Paket nachsehen; das Kopieren übernimmt ein kleines Skript als Teil des
Builds.

```ts
import { DracoDecoder } from "@babylonjs/core/Meshes/Compression/dracoDecoder";
import { MeshoptCompression } from "@babylonjs/core/Meshes/Compression/meshoptCompression";
import { KhronosTextureContainer2 } from "@babylonjs/core/Misc/khronosTextureContainer2";

/** Stellt die Decoder auf selbst gehostete Dateien um; vor dem ersten Laden aufrufen. */
export function configureDecoders(base = `${import.meta.env.BASE_URL}babylon`): void {
  Object.assign(DracoDecoder.DefaultConfiguration, {
    wasmUrl: `${base}/draco_wasm_wrapper_gltf.js`,
    wasmBinaryUrl: `${base}/draco_decoder_gltf.wasm`,
    fallbackUrl: `${base}/draco_decoder_gltf.js`,
  });
  MeshoptCompression.Configuration = { decoder: { url: `${base}/meshopt_decoder.js` } };
  const transcoders = `${base}/ktx2Transcoders/1`;
  Object.assign(KhronosTextureContainer2.URLConfig, {
    jsDecoderModule: `${base}/babylon.ktx2Decoder.js`,
    wasmUASTCToASTC: `${transcoders}/uastc_astc.wasm`,
    wasmUASTCToBC7: `${transcoders}/uastc_bc7.wasm`,
    wasmUASTCToRGBA_UNORM: `${transcoders}/uastc_rgba8_unorm_v2.wasm`,
    wasmUASTCToRGBA_SRGB: `${transcoders}/uastc_rgba8_srgb_v2.wasm`,
    wasmUASTCToR8_UNORM: `${transcoders}/uastc_r8_unorm.wasm`,
    wasmUASTCToRG8_UNORM: `${transcoders}/uastc_rg8_unorm.wasm`,
    jsMSCTranscoder: `${transcoders}/msc_basis_transcoder.js`,
    wasmMSCTranscoder: `${transcoders}/msc_basis_transcoder.wasm`,
    wasmZSTDDecoder: `${base}/zstddec.wasm`,
  });
}
```

Ohne die Engine-Option `enableAllFeatures` meldet `WebGPUEngine` keine Texturkompression —
KTX2 landet dann unkomprimiert im Speicher (Skill `babylon-game-dev`).

## HDRI zu `.env`

1. HDRI (2k für IBL, 4k+ nur für sichtbaren Himmel) herunterladen.
2. In `.env` umwandeln: Babylon-IBL-Tool `https://www.babylonjs.com/tools/ibl/`, im Sandbox-
   Inspector „Generate .env texture" oder per Code (`CreateEnvTextureAsync` aus
   `@babylonjs/core/Misc/environmentTextureTools`, Dev-Werkzeug).
3. Laden: `CubeTexture.CreateFromPrefilteredData(url, scene)`; Ausrichtung zur Sonne über
   `rotationY` (Skill `babylon-graphics`).

## Modelle prüfen

- `gltf-transform inspect`: Dreiecke, Texturgrößen, Materialien, Animationen, Erweiterungen.
- Maßstab 1 Einheit = 1 Meter, Y oben; Pivot sinnvoll (Füße/Wurzel).
- Benannte Knoten für alles, was der Code ansteuert (Flügel, Sockel, Andockpunkte).
- Materialien PBR (Metallic-Roughness); keine eingebetteten Riesentexturen.
- Optik im Spiel prüfen (Skill `babylon-visual-qa`). Für viele Assets lohnt ein Asset-Prüfstand
  (Dev-Ansicht mit neutralem Licht und vier Kameras) — Umfang mit dem User abstimmen.

## Prozedurale Alternativen

- **Node Materials** über das MCP `babylon-nme`: Graph bauen, validieren, als JSON exportieren
  und mit dem Spiel ausliefern (`NodeMaterial.Parse` bzw. `ParseFromFileAsync`).
  `save_snippet` veröffentlicht auf dem öffentlichen Snippet-Server — nur nach Freigabe.
- **Partikel-Graphen** über das MCP `babylon-npe` (erzeugt CPU-Partikelsysteme), ebenfalls als
  JSON ausliefern.
- **Soundeffekte als Code:** ZzFX (MIT) oder jsfxr — Parameter-Arrays im Code, keine
  Lizenzfragen.
- **Prozedurale Texturen:** `@babylonjs/procedural-textures`, Rauschtexturen.

## Kostenpflichtige und externe Generatoren (nur nach Freigabe)

| Werkzeug | Zweck | Lizenz der Ergebnisse |
|---|---|---|
| Meshy (offizielles MCP `@meshy-ai/meshy-mcp-server`) | Text/Bild → 3D, Remesh, Rig, Animation | Gratis-Tarif: CC BY 4.0; bezahlt: Nutzer besitzt das Ergebnis |
| Tripo (`tripo-cli`) | Text → GLB | Gratis: nicht kommerziell; bezahlt: kommerziell |
| ElevenLabs (offizielles MCP) | Soundeffekte, Musik | kommerzielle Lizenz ab bezahltem Tarif |
| Blender-MCP (Community) | Modellieren, Rigging, Export, Poly-Haven-Import | Werkzeug; führt beliebigen Python-Code in Blender aus, Telemetrie abschalten (`DISABLE_TELEMETRY=true`) |
| Hunyuan3D | — | Lizenz schließt EU, UK und Südkorea aus → nicht nutzbar |
