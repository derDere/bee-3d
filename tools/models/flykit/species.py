"""Die drei Fliegenarten des Spiels: Maße, Formfaktoren, Farben, Behaarung und Budgets (Arten).

Alle Arten teilen die Anatomie der Referenzfliege (``flykit.anatomy``); eine Art verändert sie über
Formfaktoren, Farbpalette, Borstendichte und Dreiecksbudgets. Farben stehen als sRGB-Hex und
werden für Faktoren und Bemalung linear umgerechnet.

| Art | Datei | Länge | Vorbild | Look |
|---|---|---|---|---|
| Schmeißfliege | ``fly.glb`` | 0,45 m | Goldfliege (*Lucilia*) | metallisch grün-blau schillernd |
| Brummer | ``fly-brummer.glb`` | 0,9 m | Blaue Schmeißfliege (*Calliphora vomitoria*) | gedrungen, haarig, metallisch blau-schwarz |
| Fliegenkönigin | ``fly-queen.glb`` | 2,8 m | übersteigerte Schmeißfliege | violett-schwarz, giftgrüne Akzente, aufgeblähter Hinterleib, Borstenkrone |
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from modelkit.shading import srgb_to_linear

type FloatArray = npt.NDArray[np.float64]


def linear(hex_color: str) -> FloatArray:
    """Linearer RGB-Wert einer sRGB-Hexfarbe."""
    value = hex_color.lstrip("#")
    return srgb_to_linear([int(value[i : i + 2], 16) / 255.0 for i in (0, 2, 4)])


@dataclass(frozen=True, slots=True)
class Proportions:
    """Formfaktoren einer Art relativ zur Referenzfliege (Proportionen).

    Dreiergruppen gelten für Breite, Höhe und Länge. ``bloat`` dehnt den Hinterleib zwischen den
    Rückenplatten zu sichtbaren Zwischenhäuten (0 = Platten liegen dicht, 1 = Königin).
    """

    head: float = 1.0
    eye: float = 1.0
    thorax: tuple[float, float, float] = (1.0, 1.0, 1.0)
    abdomen: tuple[float, float, float] = (1.0, 1.0, 1.0)
    leg_length: float = 1.0
    leg_thickness: float = 1.0
    wing: float = 1.0
    proboscis: float = 1.0
    bloat: float = 0.0


@dataclass(frozen=True, slots=True)
class Palette:
    """Farbpalette einer Art als sRGB-Hex (Farbpalette)."""

    carapace: str  # metallischer Panzer von Brust und Hinterleib
    carapace_deep: str  # Panzer in Mulden und an den Flanken (Farbverschiebung)
    carapace_rim: str  # Hinterränder der Rückenplatten
    carapace_shift: str  # zweiter Farbton des Schillerns (Hinterleib, Flanken)
    occiput: str  # Hinterkopf
    frons: str  # samtschwarzer Stirnstreifen zwischen den Augen
    face: str  # Gesicht unter den Augen
    gena: str  # Wangen
    leg: str
    leg_joint: str
    claw: str
    pulvillus: str  # Haftlappen am Fuß
    proboscis: str
    labellum: str  # Tupfpolster am Rüsselende
    drool: str  # Speicheltropfen
    eye: str
    eye_deep: str  # Facettenränder und Augenrand
    eye_glow: str  # Leuchtfarbe der Facetten (Emissive-Textur)
    wing_membrane: str
    wing_vein: str
    wing_base: str
    hair_root: str
    hair_tip: str
    membrane: str  # Zwischenhäute des Hinterleibs (sichtbar bei ``bloat`` > 0)
    accent: str  # Akzentfarbe (Stigmen, Kronenspitzen)


@dataclass(frozen=True, slots=True)
class Hair:
    """Behaarung einer Art (Borsten).

    ``macro`` skaliert die Länge der Großborsten, ``thickness`` alle Borstenradien. Grundhaare
    füllen das Dreiecksbudget, das nach allen übrigen Teilen bleibt; ``head_share`` ist ihr Anteil
    am Kopf. ``crown`` zählt die Stacheln der Borstenkrone auf dem Scheitel.
    """

    macro: float = 1.0
    thickness: float = 1.0
    ground_length: float = 1.0
    head_share: float = 0.28
    crown: int = 0
    accent_tips: float = 0.0  # Anteil der Großborsten mit Akzentspitze


@dataclass(frozen=True, slots=True)
class Pattern:
    """Zeichnung des Panzers (Muster).

    ``thorax_stripes`` sind dunkle Längsstreifen auf bestäubtem Brustrücken, ``tessellation`` die
    schachbrettartige Bestäubung des Hinterleibs (beides wie bei *Calliphora*).
    """

    thorax_stripes: float = 0.0
    tessellation: float = 0.0
    pollinose: str = "#9aa2b4"


@dataclass(frozen=True, slots=True)
class Budget:
    """Dreiecksbudgets, Netzauflösungen und Texturgrößen einer Art (Budget).

    ``total`` ist die Obergrenze aller Dreiecke; die Grundhaare füllen den Rest bis auf
    ``reserve``.
    """

    total: int
    body: int
    head: int
    eye_rings: int
    eye_segments: int
    eye_facets: int
    leg_sides: int
    leg_spines: int
    proboscis_sides: int
    wing_steps: tuple[int, int]  # Spannweite, Flügeltiefe
    body_texture: int
    eye_texture: int
    wing_texture: int
    ao_rays: int = 64
    reserve: int = 150


@dataclass(frozen=True, slots=True)
class Iridescence:
    """Schillerschicht des Panzers (``KHR_materials_iridescence``): Stärke, Brechzahl, Dicke in nm."""

    factor: float
    ior: float
    thickness: float


@dataclass(frozen=True, slots=True)
class Species:
    """Fliegenart des Spiels (Art): Datei, Länge, Form, Farbe, Haar, Budget und Seed."""

    key: str
    model: str  # Präfix der Materialien und Texturen
    file_name: str
    length: float  # m, Kopf bis Hinterleibsende
    proportions: Proportions
    palette: Palette
    hair: Hair
    budget: Budget
    body_iridescence: Iridescence
    wing_iridescence: Iridescence
    pattern: Pattern = Pattern()
    sheen: str | None = None  # Samtschimmer des Brustpelzes (sRGB), None = ohne
    seed: int = 11


FLY = Species(
    key="fly",
    model="Fly",
    file_name="fly.glb",
    length=0.45,
    proportions=Proportions(),
    palette=Palette(
        carapace="#2f9a55",
        carapace_deep="#145a4a",
        carapace_rim="#0d2a24",
        carapace_shift="#2a78a8",
        occiput="#1f6a48",
        frons="#140c0a",
        face="#a8a498",
        gena="#4a4a44",
        leg="#0f0c0b",
        leg_joint="#3c2616",
        claw="#060505",
        pulvillus="#c8b384",
        proboscis="#2a1c12",
        labellum="#8a6a40",
        drool="#c6d070",
        eye="#9a1a0e",
        eye_deep="#360705",
        eye_glow="#ff2a12",
        wing_membrane="#cdd6de",
        wing_vein="#2a1c10",
        wing_base="#6a5232",
        hair_root="#050404",
        hair_tip="#2c2219",
        membrane="#6a7a3a",
        accent="#c08a2a",
    ),
    hair=Hair(),
    budget=Budget(
        total=10_000,
        body=2000,
        head=780,
        eye_rings=10,
        eye_segments=26,
        eye_facets=1300,
        leg_sides=6,
        leg_spines=5,
        proboscis_sides=6,
        wing_steps=(18, 7),
        body_texture=1024,
        eye_texture=512,
        wing_texture=512,
    ),
    body_iridescence=Iridescence(0.65, 1.45, 520.0),
    wing_iridescence=Iridescence(0.85, 1.33, 560.0),
    seed=11,
)

BRUMMER = Species(
    key="brummer",
    model="FlyBrummer",
    file_name="fly-brummer.glb",
    length=0.9,
    proportions=Proportions(
        head=1.06,
        eye=0.97,
        thorax=(1.12, 1.08, 1.0),
        abdomen=(1.2, 1.14, 0.92),
        leg_length=0.94,
        leg_thickness=1.18,
        wing=0.94,
    ),
    palette=Palette(
        carapace="#1e3478",
        carapace_deep="#080e2a",
        carapace_rim="#06070f",
        carapace_shift="#30246a",
        occiput="#1c2a5a",
        frons="#0c0808",
        face="#2a2220",
        gena="#3a1c12",
        leg="#0b0a0c",
        leg_joint="#2a1a14",
        claw="#040304",
        pulvillus="#b8a07a",
        proboscis="#1f1610",
        labellum="#6a5232",
        drool="#c0c878",
        eye="#861a10",
        eye_deep="#2c0604",
        eye_glow="#ff2410",
        wing_membrane="#bcc2cc",
        wing_vein="#1c140c",
        wing_base="#3c2c1e",
        hair_root="#040305",
        hair_tip="#3a2418",
        membrane="#3a3a5a",
        accent="#8a3a1a",
    ),
    hair=Hair(macro=1.15, thickness=1.1, ground_length=1.35, head_share=0.3),
    budget=Budget(
        total=10_000,
        body=1800,
        head=700,
        eye_rings=10,
        eye_segments=26,
        eye_facets=1300,
        leg_sides=6,
        leg_spines=5,
        proboscis_sides=6,
        wing_steps=(16, 6),
        body_texture=1024,
        eye_texture=512,
        wing_texture=512,
    ),
    body_iridescence=Iridescence(0.45, 1.4, 430.0),
    wing_iridescence=Iridescence(0.75, 1.33, 520.0),
    pattern=Pattern(thorax_stripes=0.5, tessellation=0.45),
    sheen="#5a6aa0",
    seed=23,
)

QUEEN = Species(
    key="queen",
    model="FlyQueen",
    file_name="fly-queen.glb",
    length=2.8,
    proportions=Proportions(
        head=1.12,
        eye=1.08,
        thorax=(1.16, 1.12, 1.04),
        abdomen=(1.5, 1.42, 1.36),
        leg_length=1.08,
        leg_thickness=1.3,
        wing=1.02,
        proboscis=1.15,
        bloat=1.0,
    ),
    palette=Palette(
        carapace="#4a2470",
        carapace_deep="#160a26",
        carapace_rim="#050308",
        carapace_shift="#2a5a3a",
        occiput="#2a1240",
        frons="#08050a",
        face="#1c1024",
        gena="#2a1232",
        leg="#0a070c",
        leg_joint="#3a1a3a",
        claw="#020102",
        pulvillus="#5a7a2a",
        proboscis="#1a0e1a",
        labellum="#4a5a1c",
        drool="#8cff3a",
        eye="#b0140a",
        eye_deep="#320404",
        eye_glow="#ff1a0a",
        wing_membrane="#5a5266",
        wing_vein="#120a14",
        wing_base="#1c1022",
        hair_root="#040205",
        hair_tip="#2a1a30",
        membrane="#4f8a14",
        accent="#8cff2a",
    ),
    hair=Hair(macro=1.3, thickness=1.35, ground_length=1.2, crown=11, accent_tips=0.35),
    budget=Budget(
        total=20_000,
        body=6000,
        head=2000,
        eye_rings=16,
        eye_segments=40,
        eye_facets=2600,
        leg_sides=8,
        leg_spines=9,
        proboscis_sides=10,
        wing_steps=(24, 9),
        body_texture=2048,
        eye_texture=1024,
        wing_texture=512,
    ),
    body_iridescence=Iridescence(0.75, 1.5, 560.0),
    wing_iridescence=Iridescence(0.7, 1.33, 600.0),
    pattern=Pattern(thorax_stripes=0.35),
    sheen="#3a5a2a",
    seed=37,
)

SPECIES: tuple[Species, ...] = (FLY, BRUMMER, QUEEN)
