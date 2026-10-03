"""Materialien des Bienenstocks nach glTF-PBR (Materialien).

| Material | Fläche | Texturen |
|---|---|---|
| ``Hive_Straw`` | Strohwülste, Randwulst, Knauf (außen) | Farbe, ORM, Normal |
| ``Hive_HallStraw`` | Strohkuppel der Halle (innen) | Farbe, ORM, Normal (halbe Größe) |
| ``Hive_Wax`` | Waben, Zellen, Bodenplatte, Tropfen, Töpfe, Laternenkappen; Kammerwände und Rückschale der Halle | Farbe, ORM, Normal |
| ``Hive_Wood`` | Fluglochrahmen, Röhre, Anflugbrett, Pfosten, Mast, Türrahmen | Farbe, ORM, Normal |
| ``Hive_Honey`` | Honig und Laternen außen — leuchtet (``emissiveTexture`` × ``emissiveFactor``) | Farbe, ORM, Leuchten |
| ``Hive_HallHoney`` | Honig, Becken, Laternen und glühende Kammerrückwände der Halle — leuchtet stärker | wie ``Hive_Honey`` |
| ``Hive_HallWax`` | Wachs der Halle (Zellwände, Boden, Galerien, Säulen) mit einem Hauch Eigenleuchten | Wachstexturen, Leuchten |
| ``Hive_Cloth`` | Wimpel, Banner, Schnüre und Blüten; doppelseitig, im Gegenlicht durchscheinend | Farbe, ORM |

Alle Texturen kacheln; Farbtöne und gebackene Verdeckung trägt ``COLOR_0`` je Eckpunkt. Die
Leuchtstärke des Honigs kann das Spiel über ``emissiveFactor`` bzw. die Leuchtstärke-Erweiterung
anpassen (Tag schwächer, Nacht stärker). In der Halle ist der Honig die Lichtquelle; Hallenwachs und
Hallenstroh tragen nur einen Hauch Eigenleuchten in ihrer eigenen Farbe, den das Spiel über
``emissiveFactor`` verstärken kann.
"""

from __future__ import annotations

from dataclasses import dataclass

from modelkit.gltf_writer import MaterialSpec, TextureIndex

HONEY_GLOW = (1.0, 0.86, 0.6)  # emissiveFactor (linear) des Honigs außen
HALL_HONEY_GLOW = (1.0, 0.74, 0.38)  # emissiveFactor des Honigs in der Halle: satt golden, auch bei hoher Leuchtstärke
HONEY_STRENGTH = 1.2  # Leuchtstärke außen (KHR_materials_emissive_strength)
HALL_HONEY_STRENGTH = 2.4  # Leuchtstärke in der Halle: der Honig ist dort die Lichtquelle
HALL_WAX_GLOW = (0.035, 0.022, 0.008)  # Hauch von Eigenleuchten des Hallenwachses (× Wachsfarbe)
HALL_STRAW_GLOW = (0.025, 0.016, 0.006)  # Hauch von Eigenleuchten der Strohkuppel (× Strohfarbe)
CLOTH_TRANSMISSION = 0.2  # Stoff und Blüten leuchten im Gegenlicht (KHR_materials_diffuse_transmission)


@dataclass(frozen=True, slots=True)
class SurfaceTextures:
    """Texturindizes eines Materials im glTF-Dokument (Materialtexturen)."""

    color: TextureIndex
    orm: TextureIndex
    normal: TextureIndex | None = None
    emissive: TextureIndex | None = None


def _opaque(
    name: str,
    textures: SurfaceTextures,
    *,
    double_sided: bool = False,
    glow: tuple[float, float, float] | None = None,
    transmission: float = 0.0,
) -> MaterialSpec:
    # ORM trägt Verdeckung, Rauheit und Metallizität; die Faktoren bleiben deshalb bei 1
    return MaterialSpec(
        name,
        metallic=1.0,
        roughness=1.0,
        double_sided=double_sided,
        base_color_texture=textures.color,
        metallic_roughness_texture=textures.orm,
        occlusion_texture=textures.orm,
        normal_texture=textures.normal,
        normal_scale=1.0,
        emissive=glow or (0.0, 0.0, 0.0),
        emissive_texture=textures.color if glow is not None else None,
        diffuse_transmission=transmission,
    )


def _honey(name: str, textures: SurfaceTextures, glow: tuple[float, float, float], strength: float) -> MaterialSpec:
    return MaterialSpec(
        name,
        metallic=1.0,
        roughness=1.0,
        base_color_texture=textures.color,
        metallic_roughness_texture=textures.orm,
        occlusion_texture=textures.orm,
        emissive=glow,
        emissive_texture=textures.emissive,
        emissive_strength=strength,
    )


def hive_materials(
    straw: SurfaceTextures,
    wax: SurfaceTextures,
    wood: SurfaceTextures,
    honey: SurfaceTextures,
    cloth: SurfaceTextures,
    hall_straw: SurfaceTextures | None,
) -> list[MaterialSpec]:
    """Materialien einer Detailstufe; ohne Hallenstroh entfallen die Hallenmaterialien (LOD1)."""
    materials = [
        _opaque("Hive_Straw", straw),
        _opaque("Hive_Wax", wax),
        _opaque("Hive_Wood", wood),
        _honey("Hive_Honey", honey, HONEY_GLOW, HONEY_STRENGTH),
        _opaque("Hive_Cloth", cloth, double_sided=True, transmission=CLOTH_TRANSMISSION),
    ]
    if hall_straw is not None:
        materials += [
            _opaque("Hive_HallStraw", hall_straw, glow=HALL_STRAW_GLOW),
            _opaque("Hive_HallWax", wax, glow=HALL_WAX_GLOW),
            _honey("Hive_HallHoney", honey, HALL_HONEY_GLOW, HALL_HONEY_STRENGTH),
        ]
    return materials
