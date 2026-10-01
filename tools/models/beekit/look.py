"""Farben und Materialien der Biene nach bee.css samt Materialvarianten Day, Night, Ghost, Laser (Look).

Die Varianten bilden die Zustände des Vorbilds ab (``KHR_materials_variants``):

| Variante | Vorbild (CSS) | Modell |
|---|---|---|
| Day | Grundzustand | Standardmaterialien |
| Night | ``.night``: dunkle Ringe ``#daff53`` mit Schein ``#d0ff00``, Fühlerkugeln ``#fffb7d`` | Leuchtmaske Nacht: dunkle Platten und ihre Kanten limettengelb; Fühlerkugeln hellgelb |
| Ghost | ``.ghost``: alles ``#a1f9ff`` 31 % mit Rand und Schein ``#00bfff``, Augen ``#002b3a``, Lichtpunkt ``#7fdfff``, Mund ``#00445a`` | durchscheinende Hülle mit cyanfarbenen Kanten, hohle dunkle Augen mit Lichtpunkt |
| Laser | ``.firing-laser``: Ränder der dunklen Ringe rot leuchtend, Pupillen rot, Mund mit rotem Rand | Leuchtmaske Laser: Plattenkanten rot; Pupillen und Lippenwulst rot |

Formen wechseln über Formziele (``Shout`` und ``Ghost`` am Mund), Blick und Laserblick über die
Augenknoten ``Eye_L``/``Eye_R`` (die Pupille ist auf den Augapfel gemalt).
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from enum import StrEnum

from modelkit.gltf_writer import MaterialSpec, TextureIndex
from modelkit.shading import srgb_to_linear

VARIANTS = ("Day", "Night", "Ghost", "Laser")


class Swatch(StrEnum):
    """Farben als sRGB-Hex, überwiegend wörtlich aus bee.css (Farbfeld)."""

    FUR = "#c7a200"  # .bee .body/.head: background-color
    OUTLINE = "#5a470a"  # Rand der Körperkreise
    STRIPE = "#3a2e07"  # .bum:nth-child(odd)
    COLLAR = "#3d2302"  # .neck
    LEG = "#361f01"  # .leg
    CHITIN = "#0b0907"  # Stachel, Fühler, Augenrand (CSS #000, minimal aufgehellt für Glanzlichter)
    OCELLUS = "#1c140b"  # Punktaugen auf dem Scheitel
    EYE = "#f6f2e8"  # .eye (CSS #fff), warmes Weiß
    PUPIL = "#070504"  # .eye::before (CSS #000)
    IRIS = "#4a2c12"
    GLINT = "#fffdf6"
    MOUTH = "#140806"  # .mouth
    WING = "#c8c8ff"  # .wing (Alpha 0xb0)
    WING_TIP = "#d6e2ff"
    WING_VEIN = "#8484c4"
    WING_RIM = "#b6b6f0"
    NIGHT_STRIPE = "#daff53"
    NIGHT_RIM = "#d0ff00"
    NIGHT_TIP = "#fffb7d"
    GHOST_FILL = "#a1f9ff"
    GHOST_EDGE = "#00bfff"
    GHOST_EYE = "#002b3a"
    GHOST_GLINT = "#7fdfff"
    GHOST_MOUTH = "#00445a"
    LASER = "#ff0000"
    SHEEN = "#ffe9a0"
    STRIPE_SHEEN = "#8a6a2a"

    @property
    def linear(self) -> tuple[float, float, float]:
        """Linearer RGB-Wert für Materialfaktoren und Bemalung."""
        value = self.value.lstrip("#")
        srgb = [int(value[i : i + 2], 16) / 255.0 for i in (0, 2, 4)]
        r, g, b = (float(c) for c in srgb_to_linear(srgb))
        return (r, g, b)

    def rgba(self, alpha: float) -> tuple[float, float, float, float]:
        """Linearer Farbfaktor mit Deckkraft."""
        return (*self.linear, alpha)

    def scaled(self, factor: float) -> tuple[float, float, float]:
        """Linearer Farbwert mal ``factor`` (Leucht- und Sheen-Faktoren)."""
        r, g, b = self.linear
        return (r * factor, g * factor, b * factor)


@dataclass(frozen=True, slots=True)
class BeeTextures:
    """Texturindizes der Biene im glTF-Dokument (Texturen)."""

    body_color: TextureIndex
    body_orm: TextureIndex
    body_normal: TextureIndex
    body_sheen: TextureIndex
    night: TextureIndex
    laser: TextureIndex
    ghost: TextureIndex
    eye: TextureIndex
    eye_laser: TextureIndex
    eye_ghost: TextureIndex
    eye_ghost_glow: TextureIndex
    wing: TextureIndex


# Standardmaterial → Material je Variante; fehlende Einträge behalten das Standardmaterial
VARIANT_MATERIALS: dict[str, dict[str, str]] = {
    "Bee_Body": {"Night": "Bee_Body_Night", "Ghost": "Bee_Body_Ghost", "Laser": "Bee_Body_Laser"},
    "Bee_Eye": {"Ghost": "Bee_Eye_Ghost", "Laser": "Bee_Eye_Laser"},
    "Bee_Leg": {"Ghost": "Bee_Ghost_Limb"},
    "Bee_Chitin": {"Ghost": "Bee_Ghost_Limb"},
    "Bee_AntennaTip": {"Night": "Bee_AntennaTip_Night", "Ghost": "Bee_AntennaTip_Ghost"},
    "Bee_Mouth": {"Ghost": "Bee_Mouth_Ghost"},
    "Bee_MouthRim": {"Ghost": "Bee_Mouth_Ghost", "Laser": "Bee_MouthRim_Laser"},
    "Bee_Wing": {"Ghost": "Bee_Wing_Ghost"},
}


def variants_for(material: str) -> dict[str, str]:
    """Variantenzuordnung eines Standardmaterials."""
    return VARIANT_MATERIALS.get(material, {})


def bee_materials(textures: BeeTextures) -> list[MaterialSpec]:
    """Alle Materialien der Biene: Standard, Nacht, Geist, Laser."""
    # ORM trägt Verdeckung, Rauheit und Metallizität; die Faktoren bleiben deshalb bei 1
    body = MaterialSpec(
        "Bee_Body",
        metallic=1.0,
        roughness=1.0,
        base_color_texture=textures.body_color,
        metallic_roughness_texture=textures.body_orm,
        occlusion_texture=textures.body_orm,
        normal_texture=textures.body_normal,
        sheen_color=(1.0, 1.0, 1.0),
        sheen_texture=textures.body_sheen,
        sheen_roughness=0.45,
    )
    eye = MaterialSpec("Bee_Eye", roughness=0.25, base_color_texture=textures.eye)
    mouth_rim = MaterialSpec("Bee_MouthRim", base_color=Swatch.LASER.rgba(1.0), roughness=0.4)
    ghost_limb = MaterialSpec(
        "Bee_Ghost_Limb", base_color=Swatch.GHOST_EDGE.rgba(0.5), roughness=0.2, alpha_mode="BLEND", emissive=Swatch.GHOST_EDGE.scaled(0.6)
    )
    wing = MaterialSpec(
        "Bee_Wing",
        roughness=0.18,
        alpha_mode="BLEND",
        double_sided=True,
        base_color_texture=textures.wing,
        iridescence=0.45,
        iridescence_ior=1.33,
        iridescence_thickness=380.0,
        diffuse_transmission=0.6,
    )
    return [
        # Tag: Grundzustand des Vorbilds
        body,
        eye,
        MaterialSpec("Bee_Leg", base_color=Swatch.LEG.rgba(1.0), roughness=0.45, sheen_color=Swatch.STRIPE_SHEEN.scaled(0.35)),
        MaterialSpec("Bee_Chitin", base_color=Swatch.CHITIN.rgba(1.0), roughness=0.28),
        MaterialSpec("Bee_AntennaTip", base_color=Swatch.CHITIN.rgba(1.0), roughness=0.2),
        MaterialSpec("Bee_Mouth", base_color=Swatch.MOUTH.rgba(1.0), roughness=0.55),
        mouth_rim,
        wing,
        # Nacht: Glühwürmchen — limettengelbe Platten und Kanten, hellgelbe Fühlerkugeln
        replace(body, name="Bee_Body_Night", emissive=(1.0, 1.0, 1.0), emissive_texture=textures.night, emissive_strength=2.5),
        MaterialSpec(
            "Bee_AntennaTip_Night",
            base_color=Swatch.NIGHT_TIP.rgba(1.0),
            roughness=0.3,
            emissive=Swatch.NIGHT_TIP.linear,
            emissive_strength=3.0,
        ),
        # Laser: rot leuchtende Plattenkanten, rote Pupillen und Lippenwulst
        replace(body, name="Bee_Body_Laser", emissive=(1.0, 1.0, 1.0), emissive_texture=textures.laser, emissive_strength=1.6),
        replace(eye, name="Bee_Eye_Laser", emissive=(1.0, 1.0, 1.0), emissive_texture=textures.eye_laser, emissive_strength=1.4),
        replace(mouth_rim, name="Bee_MouthRim_Laser", emissive=Swatch.LASER.linear, emissive_strength=1.5),
        # Geist: eine durchscheinende Hülle mit cyanfarbenen Kanten, hohle Augen mit leuchtendem Lichtpunkt
        MaterialSpec(
            "Bee_Body_Ghost",
            base_color=Swatch.GHOST_FILL.rgba(0.3),
            roughness=0.15,
            alpha_mode="BLEND",
            normal_texture=textures.body_normal,
            emissive=(1.0, 1.0, 1.0),
            emissive_texture=textures.ghost,
            emissive_strength=1.5,
        ),
        replace(
            eye,
            name="Bee_Eye_Ghost",
            base_color_texture=textures.eye_ghost,
            alpha_mode="BLEND",
            roughness=0.1,
            emissive=(1.0, 1.0, 1.0),
            emissive_texture=textures.eye_ghost_glow,
            emissive_strength=2.0,
        ),
        ghost_limb,
        MaterialSpec(
            "Bee_AntennaTip_Ghost",
            base_color=Swatch.GHOST_EDGE.rgba(1.0),
            roughness=0.2,
            emissive=Swatch.GHOST_EDGE.linear,
            emissive_strength=3.0,
        ),
        MaterialSpec("Bee_Mouth_Ghost", base_color=Swatch.GHOST_MOUTH.rgba(0.71), roughness=0.4, alpha_mode="BLEND"),
        replace(
            wing,
            name="Bee_Wing_Ghost",
            base_color=Swatch.GHOST_EDGE.rgba(0.55),
            roughness=0.2,
            emissive=Swatch.GHOST_EDGE.scaled(0.3),
            iridescence=0.0,
        ),
    ]
