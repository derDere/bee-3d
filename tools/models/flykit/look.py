"""Materialien der Fliegen: Chitin, Facettenaugen, Flügel und Borsten (Look).

Alle Arten haben dieselben vier Materialzonen; der Name setzt sich aus dem Modellpräfix der Art
und der Zone zusammen (``Fly_Body``, ``FlyBrummer_Eye``, ``FlyQueen_Wing`` …). Der Panzer schillert
über ``KHR_materials_iridescence`` auf metallischer Basis, die Flügel ebenso auf durchscheinender
Membran (``KHR_materials_diffuse_transmission``). Die Augen tragen eine Leuchtmaske mit
``emissiveFactor`` = 0: Das Spiel setzt nachts die Leuchtfarbe hoch, damit sie rot glühen.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from modelkit.gltf_writer import MaterialSpec, TextureIndex

from flykit.species import Species


class Zone(StrEnum):
    """Materialzonen einer Fliege (Zone)."""

    BODY = "Body"
    EYE = "Eye"
    WING = "Wing"
    HAIR = "Hair"


def material_name(species: Species, zone: Zone) -> str:
    """Materialname ``<Modell>_<Zone>``."""
    return f"{species.model}_{zone.value}"


@dataclass(frozen=True, slots=True)
class FlyTextures:
    """Texturindizes einer Fliege im glTF-Dokument (Texturen)."""

    body_color: TextureIndex
    body_orm: TextureIndex
    body_normal: TextureIndex
    body_sheen: TextureIndex | None
    eye_color: TextureIndex
    eye_orm: TextureIndex
    eye_normal: TextureIndex
    eye_emissive: TextureIndex
    wing: TextureIndex


def fly_materials(species: Species, textures: FlyTextures) -> list[MaterialSpec]:
    """Die vier Materialien einer Art."""
    body_film, wing_film = species.body_iridescence, species.wing_iridescence
    # ORM trägt Verdeckung, Rauheit und Metallizität; die Faktoren bleiben deshalb bei 1
    body = MaterialSpec(
        material_name(species, Zone.BODY),
        metallic=1.0,
        roughness=1.0,
        base_color_texture=textures.body_color,
        metallic_roughness_texture=textures.body_orm,
        occlusion_texture=textures.body_orm,
        normal_texture=textures.body_normal,
        iridescence=body_film.factor,
        iridescence_ior=body_film.ior,
        iridescence_thickness=body_film.thickness,
        sheen_color=(1.0, 1.0, 1.0) if textures.body_sheen is not None else None,
        sheen_texture=textures.body_sheen,
        sheen_roughness=0.55,
    )
    eye = MaterialSpec(
        material_name(species, Zone.EYE),
        metallic=1.0,
        roughness=1.0,
        base_color_texture=textures.eye_color,
        metallic_roughness_texture=textures.eye_orm,
        occlusion_texture=textures.eye_orm,
        normal_texture=textures.eye_normal,
        emissive=(0.0, 0.0, 0.0),
        emissive_texture=textures.eye_emissive,
    )
    wing = MaterialSpec(
        material_name(species, Zone.WING),
        roughness=0.16,
        alpha_mode="BLEND",
        double_sided=True,
        base_color_texture=textures.wing,
        iridescence=wing_film.factor,
        iridescence_ior=wing_film.ior,
        iridescence_thickness=wing_film.thickness,
        diffuse_transmission=0.45,
    )
    # Borsten: Farbe aus den Vertexfarben (Wurzel bis Spitze), glänzendes Chitin
    hair = MaterialSpec(material_name(species, Zone.HAIR), roughness=0.34, metallic=0.0)
    return [body, eye, wing, hair]
