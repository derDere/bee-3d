# Python-Modell-Pipeline

Generatoren in Python erzeugen Roh-glbs mit PBR-Materialien und PNG-Texturen,
`@gltf-transform/cli` validiert sie und erzeugt die Auslieferungsdateien. Python bringt die
reifen Mesh-Werkzeuge mit (isotropes Remeshing, Marching Cubes, Embree-AO, QEM-Decimation,
xatlas); gltf-transform ist das stärkste glTF-Werkzeug für Validierung und Kompression.

Der Python-Code ist ein versioniertes Werkzeug. Das Spiel lädt ausschließlich die fertigen glb
aus `public/assets/models/`; `npm run build` ruft kein Python auf.

## Einrichtung

1. Vorlage kopieren: `templates/tools-models/` → `tools/models/` (enthält `pyproject.toml`,
   das Paket `modelkit/`, den Beispielgenerator `bee.py` und `build_all.py`).
2. Abhängigkeiten auf den neuesten Stand bringen und installieren:
   `uv lock --upgrade --project tools/models`, dann `uv sync --project tools/models`. uv lädt
   Python 3.13 und rund 180 MB Pakete; danach startet ein Generator in wenigen Sekunden.
3. `.gitignore`: `.venv/`, `__pycache__/` (entsteht beim ersten Generatorlauf in
   `tools/models/` und `modelkit/`), `.ruff_cache/` und `.temp/`. `tools/models/uv.lock` wird
   eingecheckt (reproduzierbare Builds).
4. `@gltf-transform/cli` als devDependency des Spielprojekts (Skill `babylon-assets`), npm-Skript
   `models` (Skill `babylon-game-dev`, `references/setup.md`).

`pyproject.toml` ist ein uv-Projekt ohne Paketbau (`[tool.uv] package = false`).
Generatoren liegen flach neben `modelkit/` — Python nimmt den Skriptordner in den Suchpfad
auf, dadurch funktioniert `from modelkit.sdf import …` ohne Installation.

**Python 3.13:** `xatlas` liefert Wheels bis Python 3.13 (Kommentar in `pyproject.toml`).
Erscheint eine Version mit 3.14-Wheels, wird `requires-python` angehoben.

## Bibliotheken

Versionen live prüfen; Mindestversionen stehen in `pyproject.toml`.

| Paket | Aufgabe | Hinweis |
|---|---|---|
| `manifold3d` | Booleans (`batch_boolean`), Hüllen (`batch_hull`), `level_set`, `smooth_out`/`refine_*`, `calculate_normals`, `minkowski_sum`, `split_by_plane`, `ray_cast` | Apache-2.0, Kernbaustein |
| `scikit-image` | `measure.marching_cubes` | — |
| `scipy` | `ndimage` (Dilatation per Distanztransformation, bilineare AO-Interpolation) | — |
| `pymeshlab` | isotropes Remeshing, QEM-Decimation, Glätten, Subdivision | GPL-3.0; läuft nur im Werkzeug und wird nicht ausgeliefert |
| `xatlas` | UV-Abwicklung und Atlas-Packen | MIT |
| `trimesh` + `embreex` | Raycasts für gebackene AO (Embree), Laden von glb | trimeshs glTF-Export schreibt keine Animationen → `modelkit.gltf_writer` |
| `pygltflib` | glb schreiben: Knoten, Materialien, Texturen, Animation, Skin | gekapselt in `GltfBuilder` |
| `pillow` | PNG-Kodierung der Texturen | — |
| `numpy` | vektorisierte Felder, Texel, AO | — |
| `numba` | parallel kompilierte Rauschkernel (`modelkit.noise`), ~10 ns je Punkt und Oktave | BSD; Maschinencode-Cache in `__pycache__` |

Nicht verwenden: das PyPI-Paket `sdf` (Scientific Data Format, nicht fogleman/sdf), `libfive`
(unter Windows nicht per pip installierbar), `open3d` (groß, ohne Mehrwert).

## modelkit

| Modul | Inhalt |
|---|---|
| `sdf.py` | `Sdf` (Basis: `distance`, `bounds`, `gradient`, `gradient_normals`, `project_to_surface` mit Newton-Schritt d·∇d/\|∇d\|²), `Ellipsoid`, `TaperedCapsule`, `TubeChain`, `RoundedBox`, `smooth_min`, `SmoothUnion`, `SmoothSubtraction`, `Aabb` — Konvention negativ innen, Meter, Punkte `(N, 3)` |
| `noise.py` | `Fractal` (fBm/ridged, Oktaven gedreht, `min_wavelength` schneidet Oktaven ab), `Cellular` → `CellularSample` (F1, F2, Zellwerte, `edge`, `blended_value`), `DomainWarp`, `hash01` — numba-Kernel, seedbar |
| `sweep.py` | `sweep_tube` (Röhre mit Parallel-Transport-Rahmen, Spitze, kachelnde UVs, Tangenten), `sweep_ribbon` (gewölbtes Band), `transport_frames`, `SweptMesh` |
| `tiling.py` | `periodic_noise` (FFT-Spektralrauschen, nahtlos kachelnd, dehnbar), `height_to_normal`, `encode_normal`, `encode_linear` |
| `sdf_asset.py` | `bake_sdf_asset` (grobes Feld vernetzen, abwickeln, Detailnormalen aus dem feinen Feld, AO), `detail_normals` (Tetraeder-Gradient), `stopwatch` |
| `meshing.py` | `sample_grid` (blockweise, RAM-begrenzt), `mesh_from_sdf` (Marching Cubes), `edge_length_for_budget`, `remesh_isotropic`, `decimate_quadric`, `remesh_to_budget` |
| `geometry.py` | `TriangleMesh`, `ShadedMesh`, `to_manifold`/`from_manifold`, `union_all`, `hull_tube`, `ellipsoid_solid`, `shade_with_creases`, `area_weighted_normals` |
| `uv.py` | `UvOptions(resolution, padding=4, texels_per_unit=0.0)`, `UnwrappedMesh` (`take`, `tangents` nach glTF, `mirrored_x`), `unwrap(mesh, options)` — UVs in [0, 1], v nach unten wie in glTF |
| `shading.py` | `srgb_to_linear`, `linear_to_srgb`, `smoothstep`, `solid_color`, `banded_color`, `SurfaceZone(region, color, roughness, metallic)`, `SurfaceSample`, `evaluate_zones`, `bake_ambient_occlusion` |
| `baking.py` | `rasterize_uv(mesh, resolution) → TexelMap` (je Texel Dreieck, Baryzentrik, Weltposition, Normale; `coverage`, `interpolate`), `scatter_with_dilation`, `bake_occlusion` (AO auf gröberem Raster, bilinear hochgerechnet), `bake_base_color` (→ sRGB, optional Alpha), `bake_orm`, `bake_normal_map` (Tangentenraum nach glTF), `bake_channels` |
| `transforms.py` | `rotation_matrix`, `axis_angle_quaternions` (glTF-Reihenfolge xyzw) |
| `gltf_writer.py` | `MaterialSpec` (Faktoren, Textur-Slots baseColor/metallicRoughness/occlusion/normal, Alpha-Modus mit `alpha_cutoff`), `PrimitiveData` (`uvs`, `tangents`, `colors` optional), `RotationTrack`, `InstanceSet`, `GltfBuilder` (`add_texture` mit `wrap="clamp"`/`"repeat"`, `add_material`, `add_mesh`, `add_node` mit `scale` und `extras`, `add_instanced_node` → `EXT_mesh_gpu_instancing`, `import_glb_mesh` übernimmt ein Mesh samt Materialien und Texturen aus einem fertigen glb, `add_rotation_animation`, `write_glb`) |

Weitere Bausteine (SDF-Primitive, L-System) kommen als Klassen bzw. Funktionen in das passende
Modul, mit Type Hints und deutschen Docstrings. Inseln und ihre Teile: Skill `babylon-islands`.

## Aufbau eines Generators

`bee.py` ist das Referenzbeispiel. Jeder Generator stellt `build(raw_dir) -> list[Path]` für
`build_all.py` bereit und hat ein `main()` für Einzelläufe:

```python
"""Erzeugt <Modell> als texturierte .glb (<deutscher Begriff>). Brief: Zweck, Maße, Budget, …"""

DEFAULT_RAW_DIR = Path(__file__).resolve().parents[2] / ".temp" / "models"


@dataclass(frozen=True, slots=True)
class LodSettings:
    """Detailstufe (LOD): Dreiecksbudgets, Abtastdichten, Texturgrößen."""


class <Name>Model:
    """Alle Maße in Metern; Teilformen als Felder, Oberflächenzonen, Knoten (<Begriff>)."""

    def body_sdf(self) -> Sdf: ...
    def surface_zones(self) -> list[SurfaceZone]: ...
    def body_solid(self, lod: LodSettings) -> m3d.Manifold: ...


def generate(raw_dir: Path) -> <Name>Build: ...       # LOD0, LOD1 bauen und schreiben


def build(raw_dir: Path) -> list[Path]:               # Schnittstelle für build_all
    return generate(raw_dir).paths


def main() -> None: ...                               # argparse: --output-dir, ggf. --seed
```

Kernablauf je Detailstufe (aus `bee.py`):

```python
body = shade_with_creases(model.body_solid(lod), sharp_angle_degrees=60.0)  # SDF → Netz → Booleans → Normalen
body_uv = unwrap(body, UvOptions(lod.body_texture, padding=lod.padding))     # UV-Atlas
texels = rasterize_uv(body_uv, lod.body_texture)                              # Texel → Weltposition, Normale
surface = evaluate_zones(texels.positions, model.surface_zones(), softness=0.004)
occlusion = bake_occlusion(texels, occluder, lod.ao_rays, max_distance=0.05)
color_tex = builder.add_texture("Bee_Body_lod0_color", bake_base_color(texels, surface.color))
orm_tex = builder.add_texture("Bee_Body_lod0_orm", bake_orm(texels, occlusion, surface.roughness, surface.metallic))
builder.add_material(MaterialSpec("Bee_Body", metallic=1.0, roughness=1.0, base_color_texture=color_tex,
                                  metallic_roughness_texture=orm_tex, occlusion_texture=orm_tex))
builder.add_mesh("Bee_Body", [PrimitiveData(body_uv.vertices, body_uv.normals, body_uv.faces, "Bee_Body", uvs=body_uv.uvs)])
builder.add_node("Wing_L", parent="Bee", mesh=wing_l, translation=root_l)     # Pivot = Knotenposition
builder.add_rotation_animation("WingFlap", tracks)
builder.write_glb(raw_dir / "bee.glb")
```

- Metallic- und Roughness-Faktor 1,0, wenn die ORM-Textur die Werte trägt (glTF multipliziert
  Faktor und Texturwert).
- Muster, die an Eckpunkt-Attributen hängen (Flügeladern relativ zur Flügelform), über
  `UnwrappedMesh.take` und `TexelMap.interpolate` auf die Texel bringen.
- Gespiegelte Teile (rechter Flügel) teilen Textur und UVs: `UnwrappedMesh.mirrored_x()`.
- Zufall über `numpy.random.default_rng(seed)` mit `--seed` als Parameter.

## Build: `build_all.py`

`GENERATORS = (bee, …)` — Generatoren werden dort eingetragen; wer fertige Teile anderer
Generatoren einbaut, steht nach ihnen. Unterordner unter `.temp/models/` bleiben im Ziel
erhalten. Ablauf je Roh-glb:

1. `npx gltf-transform validate` — bricht bei Fehlern oder Warnungen ab.
2. `npx gltf-transform optimize <roh> public/assets/models/<name>.glb --texture-compress webp
   --compress meshopt --flatten false --join false --instance false --palette false --simplify false`.

`npx` wird über `shutil.which` gefunden, Arbeitsverzeichnis ist der Repo-Root. Aufruf:
`npm run models` bzw. `uv run --project tools/models tools/models/build_all.py`.

**Texturformat:** WebP (`EXT_texture_webp`) läuft ohne Zusatzinstallation, liegt auf der GPU
aber unkomprimiert. KTX2 (`--texture-compress ktx2`, GPU-komprimiert) braucht das Programm
`ktx` aus KTX-Software im PATH — Installation nur nach Freigabe durch den User. meshopt-Decoder
im Spiel selbst hosten (Skill `babylon-assets`, „Decoder selbst hosten").

## Befehle

```
npm run models                                                    # alle Modelle: Generator → validate → optimize
uv run --project tools/models tools/models/<name>.py              # ein Generator, Roh-glb nach .temp/models/
npx gltf-transform validate .temp/models/<name>.glb
npx gltf-transform inspect public/assets/models/<name>.glb        # Texturen, Formate, Größen, Erweiterungen
```

Optionen der CLI vor der Nutzung mit `npx gltf-transform <befehl> --help` bestätigen.

## Kennzahlen der Beispielbiene

| | LOD0 | LOD1 |
|---|---|---|
| Dreiecke | 7.708 (Rumpf mit Gliedmaßen 6.348, Augen 576, Flügel 2 × 392) | 2.428 |
| Texturen | Rumpf Farbe + ORM 1024², Augen 256², Flügel RGBA 512² | 512², 128², 256² |
| Datei roh → fertig | 766 → 254 KiB | 260 → 93 KiB |
| Draw Calls | 4 (Rumpf, Augen, 2 Flügel) | 4 |

Generatorlauf für beide Stufen 5,7 s (Texturen backen 3,5 s), Spitzen-RAM ~720 MiB;
`npm run models` gesamt ~19 s. Die Dreieckszahl des Rumpfs schwankt zwischen Läufen um wenige
Dutzend (parallele Berechnung in den Bibliotheken) — Tests prüfen Kennzahlen mit Toleranz.

## Fallstricke

1. **Farbräume:** Basisfarbtexturen sind sRGB-kodiert (`bake_base_color` rechnet um), ORM und
   Faktoren linear. Paletten in sRGB notieren und mit `srgb_to_linear` umrechnen.
2. **Texturwerte aus der Position:** Muster je Texel aus der Weltposition berechnen; dann sind
   Streifen unabhängig von der Netzdichte scharf und überstehen Decimation und LOD.
3. **Dilatation:** `scatter_with_dilation` setzt die Inselränder um 8 px fort; ohne sie zeigen
   Mipmaps dunkle Säume an UV-Nähten. Padding der Abwicklung (`UvOptions.padding`) und
   Dilatation zusammen wählen.
4. **AO-Reichweite** relativ zur Modellgröße wählen (Biene: 5 cm bei 0,47 m Länge); getrennte
   Teile (Augen) als Verdecker mitgeben.
5. **Normal-Maps:** Wer eine Tangentenraum-Normal-Map backt, schreibt `TANGENT` mit derselben
   Basis (`UnwrappedMesh.tangents`, `SweptMesh.tangents`); ohne das Attribut warnt der Validator
   (`MESH_PRIMITIVE_GENERATED_TANGENT_SPACE`), und `build_all.py` bricht ab. glTF-Konvention:
   +X = +u, +Y zeigt zum Bildrand v = 0, Bitangente = cross(N, T) · w.
6. **`manifold3d.level_set`:** positiv bedeutet innen (umgekehrt zur SDF-Konvention), erzeugt bei
   gleicher Kantenlänge etwa doppelt so viele Dreiecke wie Marching Cubes und ist mit
   NumPy-Callbacks sehr langsam (15 s; `mesh_from_sdf` braucht 0,1 s). `mesh_from_sdf` verwenden.
7. **Dünne Teile** (Radius unter ~3 Voxeln) zerfallen im Raster → als Hüllen-Röhren bauen.
8. **uint16-Indizes** reichen bis 65.534 (65.535 ist Primitive Restart); `GltfBuilder` wechselt
   selbst auf uint32.
9. **pymeshlab:** Werttyp für Längen ist `PureValue`; Parameternamen eines Filters liefert
   `pymeshlab.print_filter_parameter_list("<filter>")`.
10. **Validator und meshopt:** Der Khronos-Validator prüft `EXT_meshopt_compression` nicht —
    deshalb validiert `build_all.py` das Roh-glb.
11. **Feine Muster** (Facetten, Adern) an die Texturgröße koppeln: Strukturen unter ~2 Texeln
    flimmern bzw. zeigen Moiré; je LOD die Musterweite anpassen (`facet_degrees` in `bee.py`).
12. **`optimize` führt gleiche Materialien zusammen:** Materialien, die das Spiel getrennt
    ansteuert (Texturen verschieben, Farbe wechseln), brauchen unterschiedliche Werte.
13. **Profiler- und Probeausgaben** (`cProfile`, Testbilder) in den Scratchpad bzw. `.temp/`
    schreiben, nie in den Repo-Root.
