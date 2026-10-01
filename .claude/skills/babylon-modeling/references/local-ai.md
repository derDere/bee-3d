# Lokale KI-Modelle

Stand der Recherche: Oktober 2026, Zielhardware Intel Core Ultra 9 285H mit Arc Pro 140T
(iGPU, Shared Memory), NPU, 64 GB RAM, kein CUDA. Externe Dienste und gehostete Modelle sind
ausgeschlossen; lokale Modelle laufen nur nach Freigabe durch den User (Downloads im
GB-Bereich, Last auf iGPU und CPU).

## Rolle in der Pipeline

Code-Modellierung bleibt der Hauptweg. Lokale Modelle liefern höchstens:

- **Referenzbilder** (Text → Bild) für Proportionen, Farbwelt und Stil, die beim Modellieren
  neben dem Kontaktbogen liegen,
- **Blockouts** (Bild → 3D) als grobe Formvorlage für Steine, Baumstümpfe, Pilze und andere
  organische Einzelobjekte.

Für stilisierte, symmetrische Figuren, dünne Strukturen (Flügel, Beine), saubere Topologie und
parametrische Varianten taugen die lokal lauffähigen Image-to-3D-Modelle nicht:
Marching-Cubes-Netze mit Zehntausenden Dreiecken, halluzinierte Rückseiten, grobes Triplane.

## Geräte

OpenVINO 2026.4 erkennt alle drei Geräte (getestet):

```
uv run --python 3.12 --with openvino python -c "import openvino as ov; c=ov.Core(); [print(d, c.get_property(d, 'FULL_DEVICE_NAME')) for d in c.available_devices]"
CPU Intel(R) Core(TM) Ultra 9 285H
GPU Intel(R) Arc(TM) Pro 140T GPU (32GB) (iGPU)
NPU Intel(R) AI Boost
```

**Last begrenzen:** Gerät `GPU` (entlastet die CPU), INT4/INT8-Gewichte, CPU-Threads begrenzen
(onnxruntime `intra_op_num_threads` ≈ 6 von 16), kleine Auflösungen (512 px, Marching-Cubes-Gitter
128). Modelle und Download-Cache liegen im Projektordner unter `.temp/` (`.temp/ai-models/`,
`HF_HOME=.temp/hf`).

## Text → Bild (Referenzbilder)

OpenVINO GenAI `Text2ImagePipeline`; Export mit `optimum-cli export openvino … --weight-format int4`.

| Modell | Lizenz | Größe | Einschätzung |
|---|---|---|---|
| FLUX.2 klein 4B | Apache-2.0 | ~4,6 GB INT4 | erste Wahl: 4 Schritte, OpenVINO-Notebook `flux.2-klein` vorhanden |
| Z-Image-Turbo 6B | Apache-2.0 | ~5,7 GB INT4 | Alternative, Notebook `z-image-turbo` |
| FLUX.1-schnell | Apache-2.0 (gated) | 9,2 GB INT4 | größer ohne Vorteil |
| SDXL-Turbo | nicht kommerziell | — | ausgeschlossen |
| SD 3.5 | Stability Community License (Umsatzgrenze, gated) | — | nur nach Rücksprache |
| Qwen-Image-2.1 | Forschungslizenz | — | ausgeschlossen |

Geschwindigkeit auf der Arc 140T: keine veröffentlichten Messwerte; vor dem Einsatz einmal
messen.

```
uv run --python 3.12 --with "optimum-intel[openvino]" optimum-cli export openvino -m black-forest-labs/FLUX.2-klein-4B --weight-format int4 .temp/ai-models/flux2-klein-int4-ov
```

Danach `openvino_genai.Text2ImagePipeline(".temp/ai-models/flux2-klein-int4-ov", "GPU")`. Beide
Befehle sind ungetestet — vorher gegen das Notebook prüfen.

## Bild → 3D (Blockouts)

Die OpenVINO-Notebooks enthalten kein Image-to-3D-Modell; lauffähig sind ONNX- und
PyTorch-Wege.

| Modell | Lizenz | Weg ohne CUDA | Download | Output |
|---|---|---|---|---|
| TripoSR (ONNX-Export `fernandotonon/QtMeshEditor-triposr-onnx`) | MIT | onnxruntime (CPU oder OpenVINO-Provider) | Encoder INT8 436 MB | Triplane → Marching Cubes (scikit-image), Vertexfarben |
| TripoSR (PyTorch) | MIT | CPU; `torchmcubes` braucht unter Windows einen Compiler | 1,68 GB | wie oben |
| Stable Fast 3D | Stability Community License, gated | CPU-Backend; braucht Visual Studio 2022 für Zusatzmodule | ~4 GB | UV-Mesh mit PBR-Parametern |

Ablauf für einen Blockout (ungetestet): Referenzbild → Freistellen mit `rembg` (MIT, ONNX auf
CPU) → TripoSR-ONNX → Netz mit `scikit-image`/`trimesh` → Koordinaten drehen (−90° um X, +90°
um Y) → vereinfachen → als Referenz neben dem Generator-Modell ins Model Lab laden.

## Nicht nutzbar

| Modell | Grund |
|---|---|
| Hunyuan3D (alle Versionen) | Lizenz schließt EU, UK und Südkorea aus |
| TRELLIS / TRELLIS.2 | CUDA bzw. Apple MPS; ~18 GB und Minuten pro Objekt |
| TripoSG, SPAR3D, Step1X-3D u. ä. | CUDA-Erweiterungen |
| Inoffizielle Konvertierungen ohne Lizenzangabe | Rechte am Modell unklar |
