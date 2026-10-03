"""Form der schwebenden Insel als Distanzfeld (Inselkörper).

Aufbau von oben nach unten: Grasplateau mit sanften Hügeln und verrundeter Kante (Lippe),
darunter ein zurückversetztes Erdband, dann eine steile Felswand mit Gesteinsschichten und
versetzten Felsblöcken, die in einen Kernkörper und mehrere hängende Felsspitzen ausläuft.
Teich und Bachbett sind weich abgezogen; der Bach schneidet am Rand eine Kerbe für den
Wasserfall. Optional trägt das Plateau einen Hügel oder eine obere Ebene (Terrasse), die über
eine Felsstufe ansteigt; Lippe, Erdband und obere Felswand folgen der Terrasse.

Koordinaten: Meter, +Y oben, Ursprung in der Mitte der Plateauoberfläche.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from modelkit.noise import Cellular, Fractal, hash01
from modelkit.sdf import Aabb, Sdf, smooth_min
from modelkit.shading import smoothstep
from scipy.interpolate import PchipInterpolator

from islandkit.spec import IslandDimensions, IslandSpec, ShapeStyle

type FloatArray = npt.NDArray[np.float64]

_FAR = 1e3  # Abstand für Punkte fern von Teich, Bach und Felsspitzen (m)
_WATER_CUTOFF = 0.5  # Detailgrenze der Plateauhöhe für die Wasserspiegel (m)
_OUTLINE_SAMPLES = 4096  # Stützstellen der Umrisstabelle über den Winkel


@dataclass(frozen=True, slots=True)
class PondPlan:
    """Lage und Größe des Teichs (Teich): Mitte (x, z), Halbachsen, Drehung, Tiefe."""

    center: FloatArray
    radii: FloatArray
    angle: float
    depth: float


@dataclass(frozen=True, slots=True)
class StreamPlan:
    """Verlauf des Bachs vom Teich bis über den Rand (Bach): Polylinie (K, 2), Halbbreite, Tiefe."""

    path: FloatArray
    half_width: float
    depth: float


@dataclass(frozen=True, slots=True)
class SpirePlan:
    """Hängende Felsspitze (Felsspitze): Ansatz, Spitze, Radien."""

    start: FloatArray
    end: FloatArray
    start_radius: float
    end_radius: float


@dataclass(frozen=True, slots=True)
class HillPlan:
    """Hügel auf dem Plateau (Hügel): Mitte (x, z), Höhe und Breite (Standardabweichung) in m."""

    center: FloatArray
    height: float
    sigma: float

    def height_at(self, x: FloatArray, z: FloatArray) -> FloatArray:
        distance_sq = (x - self.center[0]) ** 2 + (z - self.center[1]) ** 2
        return self.height * np.exp(-0.5 * distance_sq / (self.sigma * self.sigma))


@dataclass(frozen=True, slots=True)
class TerracePlan:
    """Obere Plateau-Ebene (Terrasse): Richtung zur Ebene, Lage der Stufe, Wellung, Hub, Stufenbreite.

    Die Stufe verläuft quer zu ``direction`` im Abstand ``offset`` von der Mitte und ist mit
    ``waves`` (Wellenlänge m, Amplitude m, Phase) gewellt. Jenseits der Stufe liegt das Plateau
    um ``height`` höher; der Übergang ist ``width`` breit.
    """

    direction: FloatArray
    offset: float
    waves: FloatArray
    height: float
    width: float

    def fraction(self, x: FloatArray, z: FloatArray) -> FloatArray:
        """0 auf der unteren, 1 auf der oberen Ebene, dazwischen die Felsstufe."""
        along = -x * self.direction[1] + z * self.direction[0]
        across = x * self.direction[0] + z * self.direction[1] - self.offset
        for wavelength, amplitude, phase in self.waves:
            across = across - amplitude * np.sin(2.0 * np.pi * along / wavelength + phase)
        return smoothstep(-0.5 * self.width, 0.5 * self.width, across)

    def lift(self, x: FloatArray, z: FloatArray) -> FloatArray:
        """Hub der Plateauoberfläche in m."""
        return self.height * self.fraction(x, z)


@dataclass(frozen=True, slots=True)
class WaterLevels:
    """Wasserspiegel (Wasserstände): Teich in m, Bach je Stützpunkt der Polylinie."""

    pond: float
    stream: FloatArray


@dataclass(frozen=True, slots=True)
class StreamOutlet:
    """Austritt des Bachs an der Kante (Bachmündung): Mitte auf dem Wasserspiegel, Fließrichtung (x, z)."""

    position: FloatArray
    direction: FloatArray
    half_width: float


@dataclass(frozen=True, slots=True)
class ProfileShape:
    """Form der Felsunterseite (Unterseitenprofil).

    Radiusfaktor des Kernkörpers über der relativen Tiefe t: (1 − t^``shoulder``)^``taper``;
    große ``shoulder`` halten die Felswand lange steil. ``core_depth`` ist die Tiefe des
    Kernkörpers relativ zur Gesamttiefe, darunter hängen nur noch Felsspitzen.
    """

    shoulder: float
    taper: float
    core_depth: float

    def factor(self, t: FloatArray) -> FloatArray:
        """Radiusfaktor 1 → 0 für t in [0, 1]."""
        return (1.0 - np.clip(t, 0.0, 1.0) ** self.shoulder) ** self.taper


@dataclass(frozen=True, slots=True)
class TerrainPlan:
    """Zufällig gewählte, seedbare Merkmale einer Insel (Inselplan)."""

    harmonics: FloatArray  # (K, 3): Ordnung, Amplitude, Phase des Umrisses
    hang_offset: FloatArray  # Versatz der Unterseite zur Spitze hin (x, z) in m
    profile: ProfileShape
    tilt: FloatArray  # Neigung der Gesteinsschichten (dy/dx, dy/dz)
    spires: tuple[SpirePlan, ...]
    pond: PondPlan | None
    stream: StreamPlan | None
    hill: HillPlan | None = None
    terrace: TerracePlan | None = None

    @staticmethod
    def create(spec: IslandSpec) -> TerrainPlan:
        """Würfelt den Plan aus dem Seed des Steckbriefs innerhalb der Spannweiten des Formstils."""
        rng = np.random.default_rng(spec.seed)
        dims, shape = spec.dimensions, spec.shape
        harmonics = np.array(
            [[k, rng.uniform(0.6, 1.0) * amplitude, rng.uniform(0.0, 2.0 * np.pi)]
             for k, amplitude in ((2, 0.07), (3, 0.05), (4, 0.025), (5, 0.018), (7, 0.01))]
        )  # fmt: skip
        hang = rng.normal(size=2)
        hang *= rng.uniform(*shape.hang) * dims.radius / max(np.linalg.norm(hang), 1e-9)
        profile = ProfileShape(
            shoulder=rng.uniform(*shape.shoulder), taper=rng.uniform(*shape.taper), core_depth=rng.uniform(*shape.core_depth)
        )
        tilt = rng.uniform(-0.06, 0.06, 2)
        spires = _plan_spires(rng, dims, profile, shape)
        pond = _plan_pond(rng, dims, shape) if spec.pond else None
        stream = _plan_stream(rng, dims, pond, harmonics) if spec.stream and pond is not None else None
        return TerrainPlan(
            harmonics=harmonics,
            hang_offset=hang,
            profile=profile,
            tilt=tilt,
            spires=spires,
            pond=pond,
            stream=stream,
            hill=_plan_hill(rng, dims, shape) if shape.hill_height > 0.0 else None,
            terrace=_plan_terrace(rng, dims, shape, pond) if shape.terrace_height > 0.0 else None,
        )


def _plan_spires(rng: np.random.Generator, dims: IslandDimensions, profile: ProfileShape, shape: ShapeStyle) -> tuple[SpirePlan, ...]:
    """Eine Hauptspitze nahe der Mitte bis zur vollen Tiefe, dazu Nebenspitzen im Kreis.

    Die Nebenspitzen setzen weit außen am Kernkörper an und hängen unter ihm frei — so endet
    die Unterseite in mehreren, verschieden langen Spitzen.
    """
    r, h, s = dims.radius, dims.depth, dims.soil_depth
    core = profile.core_depth * h
    spires = []
    count = int(rng.integers(3, 5) + 2.0 * dims.radius // 20) + shape.extra_spires
    for index in range(count + 1):
        main = index == 0
        start_t = rng.uniform(0.4, 0.6) if main else rng.uniform(0.3, 0.65)
        start_y = -s - start_t * (core - s)
        local = r * float(profile.factor(np.array([start_t]))[0])
        start_radius = local * (rng.uniform(0.45, 0.6) if main else rng.uniform(0.22, 0.38))
        angle = rng.uniform(0.0, 2.0 * np.pi) if main else 2.0 * np.pi * (index + rng.uniform(-0.3, 0.3)) / count
        radial = (rng.uniform(0.0, 0.15) * local) if main else rng.uniform(0.55, 0.85) * local
        end_y = -h if main else -rng.uniform(*shape.side_spire_depth) * h
        drift = rng.uniform(0.0, 0.08 if main else 0.22) * (start_y - end_y)
        direction = np.array([np.cos(angle), 0.0, np.sin(angle)])
        start = radial * direction + np.array([0.0, start_y, 0.0])
        end = start + drift * direction + np.array([0.0, end_y - start_y, 0.0])
        spires.append(SpirePlan(start, end, start_radius, rng.uniform(0.01, 0.025) * r))
    return tuple(spires)


def _plan_pond(rng: np.random.Generator, dims: IslandDimensions, shape: ShapeStyle) -> PondPlan:
    r = dims.radius
    angle = rng.uniform(0.0, 2.0 * np.pi)
    offset = rng.uniform(*shape.pond_offset) * r
    major = max(1.3, rng.uniform(*shape.pond_radius) * r)
    return PondPlan(
        center=np.array([offset * np.cos(angle), offset * np.sin(angle)]),
        radii=np.array([major, major * rng.uniform(0.65, 0.9)]),
        angle=rng.uniform(0.0, np.pi),
        depth=float(np.clip(0.3 * major, 0.4, 2.5)),
    )


def _plan_stream(
    rng: np.random.Generator, dims: IslandDimensions, pond: PondPlan, harmonics: FloatArray
) -> StreamPlan:
    r = dims.radius
    # Austritt seitlich versetzt zur Richtung des Teichs, damit der Bach eine sichtbare Strecke mäandert
    toward = np.arctan2(pond.center[1], pond.center[0]) if np.linalg.norm(pond.center) > 1e-6 else 0.0
    exit_angle = toward + rng.choice([-1.0, 1.0]) * rng.uniform(0.5, 1.3)
    exit_radius = r * _outline_factor(np.array([exit_angle]), harmonics)[0]
    target = np.array([np.cos(exit_angle), np.sin(exit_angle)]) * (exit_radius + 2.0 * dims.overhang + 1.0)
    t = np.linspace(0.0, 1.0, 48)
    line = pond.center[None, :] + t[:, None] * (target - pond.center)[None, :]
    direction = (target - pond.center) / np.linalg.norm(target - pond.center)
    side = np.array([-direction[1], direction[0]])
    waves = rng.uniform(0.8, 1.6)
    meander = (0.09 * r) * np.sin(np.pi * t) * np.sin(2.0 * np.pi * waves * t + rng.uniform(0.0, 2.0 * np.pi))
    # Am Rand gerade auslaufen, damit die Kerbe senkrecht zur Kante liegt
    meander *= 1.0 - smoothstep(0.75, 0.95, t)
    half_width = float(np.clip(0.044 * r, 0.35, 2.0))
    return StreamPlan(path=line + meander[:, None] * side[None, :], half_width=half_width, depth=0.45 * half_width)


def _plan_hill(rng: np.random.Generator, dims: IslandDimensions, shape: ShapeStyle) -> HillPlan:
    """Hügel nahe der Mitte, leicht versetzt, damit die Kuppe die Insel nicht symmetrisch teilt."""
    angle = rng.uniform(0.0, 2.0 * np.pi)
    offset = rng.uniform(0.08, 0.22) * dims.radius
    return HillPlan(
        center=offset * np.array([np.cos(angle), np.sin(angle)]),
        height=shape.hill_height * rng.uniform(0.9, 1.1),
        sigma=shape.hill_radius * dims.radius,
    )


def _plan_terrace(rng: np.random.Generator, dims: IslandDimensions, shape: ShapeStyle, pond: PondPlan | None) -> TerracePlan:
    """Obere Ebene auf der dem Teich abgewandten Seite; die Stufe quert die Insel gewellt."""
    if pond is not None and np.linalg.norm(pond.center) > 1e-6:
        base = np.arctan2(pond.center[1], pond.center[0]) + np.pi + rng.normal(0.0, 0.2)
    else:
        base = rng.uniform(0.0, 2.0 * np.pi)
    r = dims.radius
    waves = np.array(
        [[r * rng.uniform(0.9, 1.3), 0.08 * r * rng.uniform(0.7, 1.0), rng.uniform(0.0, 2.0 * np.pi)],
         [r * rng.uniform(0.35, 0.5), 0.03 * r * rng.uniform(0.7, 1.0), rng.uniform(0.0, 2.0 * np.pi)]]
    )  # fmt: skip
    return TerracePlan(
        direction=np.array([np.cos(base), np.sin(base)]),
        offset=0.08 * r,
        waves=waves,
        height=shape.terrace_height,
        width=shape.terrace_width,
    )


def _outline_factor(theta: FloatArray, harmonics: FloatArray) -> FloatArray:
    """Relativer Umrissradius aus den Harmonischen (ohne Rauschen)."""
    order, amplitude, phase = harmonics[:, 0], harmonics[:, 1], harmonics[:, 2]
    return 1.0 + (amplitude[None, :] * np.cos(order[None, :] * theta[:, None] + phase[None, :])).sum(axis=1)


@dataclass(frozen=True, slots=True)
class TerrainSample:
    """Merkmale der Insel an Punkten, Grundlage der Oberflächenfarben (Geländeprobe).

    ``below_top``: Tiefe unter der Plateauoberfläche (m); ``radial``: Abstand zur Achse relativ
    zum Umriss; ``layer``: Schichtkoordinate (ganzzahliger Teil = Schichtindex); ``crack``:
    1 in Rissen zwischen Felsblöcken; ``block``: Zufallswert des Felsblocks 0..1; ``crag``:
    Grate 0..1; ``pond``/``stream``: vorzeichenbehafteter Abstand zum Teich-/Bachbett
    (negativ im Bett); ``waterline``: Höhe über dem nächsten Wasserspiegel (m); ``terrace``:
    Anteil der oberen Ebene (0 unten, 1 oben).
    """

    below_top: FloatArray
    radial: FloatArray
    layer: FloatArray
    crack: FloatArray
    block: FloatArray
    crag: FloatArray
    pond: FloatArray
    stream: FloatArray
    waterline: FloatArray
    terrace: FloatArray


@dataclass(frozen=True, slots=True)
class _Noises:
    """Rauschfelder der Insel; Frequenzen relativ zur Größe."""

    outline: Fractal
    hills: Fractal
    turf: Fractal
    lobes: Fractal
    warp: Fractal
    strata: Fractal
    crags: Fractal
    grain: Fractal
    soil: Fractal
    shore: Fractal
    blocks: Cellular

    @staticmethod
    def create(seed: int, dims: IslandDimensions) -> _Noises:
        d = 2.0 * dims.radius
        return _Noises(
            outline=Fractal(seed + 1, 1.2, octaves=4),
            hills=Fractal(seed + 2, 2.5 / d, octaves=4),
            turf=Fractal(seed + 3, 1.1, octaves=4, gain=0.55),
            lobes=Fractal(seed + 4, 1.0, octaves=3),
            warp=Fractal(seed + 5, 3.0 / d, octaves=3),
            strata=Fractal(seed + 6, 1.4 / d, octaves=3),
            crags=Fractal(seed + 7, 9.0 / d, octaves=5, ridged=True),
            grain=Fractal(seed + 8, 40.0 / d, octaves=5, gain=0.55),
            soil=Fractal(seed + 9, 1.6 / dims.soil_depth, octaves=4),
            shore=Fractal(seed + 10, 1.5, octaves=3),
            blocks=Cellular(seed + 11, 1.0, jitter=0.9),
        )


class IslandTerrain(Sdf):
    """Distanzfeld des Inselkörpers (Inselkörper); negativ innen.

    ``min_wavelength`` (m) lässt feinere Rauschoktaven weg: für das Netz die doppelte
    Kantenlänge, für Normal-Maps 0 (alle Oktaven). Wasserspiegel und Plan sind unabhängig
    davon und gelten für jede Fassung.
    """

    def __init__(self, spec: IslandSpec, plan: TerrainPlan, min_wavelength: float = 0.0) -> None:
        self.spec = spec
        self.plan = plan
        self.dims = spec.dimensions
        self.min_wavelength = min_wavelength
        self._noise = _Noises.create(spec.seed, self.dims)
        self._outline_table = self._build_outline_table(min_wavelength)
        self._profile, self._profile_slope = self._build_profile()
        self.water = self._water_levels()

    def with_detail(self, min_wavelength: float) -> IslandTerrain:
        """Dieselbe Insel mit anderer Detailgrenze."""
        return IslandTerrain(self.spec, self.plan, min_wavelength)

    # --- Umriss und Plateau -------------------------------------------------------------

    def _build_outline_table(self, cutoff: float) -> FloatArray:
        """Umrissradius auf 4096 Winkeln vorberechnet (Harmonische plus Rauschen)."""
        theta = np.linspace(-np.pi, np.pi, _OUTLINE_SAMPLES)
        circle = np.stack([np.cos(theta), np.sin(theta), np.zeros_like(theta)], axis=1)
        wobble = 0.05 * self._noise.outline(circle * 1.6, cutoff)
        return self.dims.radius * _outline_factor(theta, self.plan.harmonics) * (1.0 + wobble)

    def outline_radius(self, theta: FloatArray, cutoff: float | None = None) -> FloatArray:
        """Umrissradius des Plateaus je Winkel (m); ``cutoff`` ersetzt die Detailgrenze."""
        table = self._outline_table if cutoff is None else self._build_outline_table(cutoff)
        return np.interp(theta, np.linspace(-np.pi, np.pi, _OUTLINE_SAMPLES), table)

    @property
    def max_outline_radius(self) -> float:
        """Größter Umrissradius (m)."""
        return float(self._outline_table.max())

    def top_height(self, xz: FloatArray, cutoff: float | None = None) -> FloatArray:
        """Höhe der Plateauoberfläche ohne Teich und Bach (m); ``cutoff`` ersetzt die Detailgrenze."""
        x, z = xz[:, 0], xz[:, 1]
        outline = self.outline_radius(np.arctan2(z, x), cutoff)
        return self._top_height(x, z, np.hypot(x, z) / outline, self.min_wavelength if cutoff is None else cutoff)

    def terrace_fraction(self, xz: FloatArray) -> FloatArray:
        """Anteil der oberen Terrassenebene je Grundrisspunkt (0 ohne Terrasse)."""
        terrace = self.plan.terrace
        return np.zeros(len(xz)) if terrace is None else terrace.fraction(xz[:, 0], xz[:, 1])

    def _lift(self, x: FloatArray, z: FloatArray) -> FloatArray:
        terrace = self.plan.terrace
        return np.zeros_like(x) if terrace is None else terrace.lift(x, z)

    def _top_height(self, x: FloatArray, z: FloatArray, radial: FloatArray, cutoff: float) -> FloatArray:
        plane = np.stack([x, np.zeros_like(x), z], axis=1)
        dome = self.dims.dome * (1.0 - np.clip(radial, 0.0, 1.2) ** 2)
        hills = self.dims.relief * self._noise.hills(plane, cutoff) * 2.2
        turf = 0.035 * self._noise.turf(plane, cutoff)
        hill = self.plan.hill.height_at(x, z) if self.plan.hill is not None else 0.0
        return dome + hills + turf + hill + self._lift(x, z)

    # --- Profil der Unterseite ------------------------------------------------------------

    def _build_profile(self) -> tuple[PchipInterpolator, PchipInterpolator]:
        """Radiusfaktor über der Höhe: Lippe → zurückversetztes Erdband → Felswand → Kernspitze."""
        dims, shape = self.dims, self.plan.profile
        s, core = dims.soil_depth, shape.core_depth * dims.depth
        undercut = dims.overhang / dims.radius
        rock_top = 1.0 - 0.7 * undercut
        t = np.linspace(0.06, 0.97, 16)
        rock_y = -s - t * (core - s)
        heights = np.concatenate([[-dims.depth - 1.0, -core], rock_y[::-1], [-s, -0.6 * s, -dims.lip_depth, 0.0, dims.depth]])
        factors = np.concatenate(
            [[0.0, 0.0], (rock_top * shape.factor(t))[::-1], [rock_top, 1.0 - undercut, 1.0, 1.0, 1.0]]
        )
        profile = PchipInterpolator(heights, factors)
        return profile, profile.derivative()

    def rock_fraction(self, y: FloatArray) -> FloatArray:
        """0 an der Unterkante des Erdbands bis 1 an der tiefsten Spitze."""
        s, h = self.dims.soil_depth, self.dims.depth
        return np.clip((-s - y) / (h - s), 0.0, 1.0)

    def _lifted_height(self, x: FloatArray, y: FloatArray, z: FloatArray) -> FloatArray:
        """Höhe im Bezugssystem der örtlichen Plateauebene: Lippe, Erdband und obere Felswand folgen der Terrasse."""
        if self.plan.terrace is None:
            return y
        s = self.dims.soil_depth
        core = self.plan.profile.core_depth * self.dims.depth
        follow = smoothstep(-s - 0.35 * (core - s), -s, y)
        return y - self._lift(x, z) * follow

    # --- Wasser -------------------------------------------------------------------------

    def _water_levels(self) -> WaterLevels | None:
        """Wasserspiegel aus der groben Plateauhöhe — gleich für jede Detailgrenze."""
        pond = self.plan.pond
        if pond is None:
            return None
        angles = np.linspace(0.0, 2.0 * np.pi, 96, endpoint=False)
        ring = pond.center[None, :] + 1.25 * _ellipse_points(pond, angles)
        pond_level = float(self.top_height(ring, _WATER_CUTOFF).min()) - 0.12
        stream = self.plan.stream
        if stream is None:
            return WaterLevels(pond_level, np.zeros(0))
        banks = self.top_height(stream.path, _WATER_CUTOFF) - 0.6 * stream.depth
        slope = pond_level - np.linspace(0.0, 0.25 + 0.01 * self.dims.radius, len(stream.path))
        return WaterLevels(pond_level, np.minimum.accumulate(np.minimum(slope, banks)))

    def stream_outlet(self) -> StreamOutlet | None:
        """Stelle, an der der Bach die Plateaukante verlässt (Ursprung des Wasserfalls)."""
        stream, levels = self.plan.stream, self.water
        if stream is None or levels is None:
            return None
        theta = np.arctan2(stream.path[:, 1], stream.path[:, 0])
        radial = np.linalg.norm(stream.path, axis=1) / self.outline_radius(theta, _WATER_CUTOFF)
        index = int(np.argmax(radial >= 1.0)) if np.any(radial >= 1.0) else len(radial) - 1
        direction = stream.path[index] - stream.path[max(index - 1, 0)]
        direction /= max(float(np.linalg.norm(direction)), 1e-9)
        position = np.array([stream.path[index, 0], levels.stream[index], stream.path[index, 1]])
        return StreamOutlet(position, direction, stream.half_width)

    def _pond_distance(self, points: FloatArray) -> FloatArray:
        pond, levels = self.plan.pond, self.water
        result = np.full(len(points), _FAR)
        if pond is None or levels is None:
            return result
        reach = 1.3 * float(pond.radii.max()) + 1.0
        near = (
            (np.abs(points[:, 0] - pond.center[0]) < reach)
            & (np.abs(points[:, 2] - pond.center[1]) < reach)
            & (np.abs(points[:, 1] - levels.pond) < 2.0 * pond.depth + 1.0)
        )
        result[near] = self._pond_distance_near(points[near], pond, levels)
        return result

    def _pond_distance_near(self, points: FloatArray, pond: PondPlan, levels: WaterLevels) -> FloatArray:
        """Ellipsoid-Mulde mit unregelmäßigem Ufer; schneidet den Wasserspiegel in den Teichradien."""
        cos_a, sin_a = np.cos(pond.angle), np.sin(pond.angle)
        dx, dz = points[:, 0] - pond.center[0], points[:, 2] - pond.center[1]
        u, v = dx * cos_a + dz * sin_a, -dx * sin_a + dz * cos_a
        angle = np.arctan2(v / pond.radii[1], u / pond.radii[0])
        circle = np.stack([np.cos(angle), np.sin(angle), np.full_like(angle, 3.1)], axis=1)
        irregular = 1.0 + 0.16 * self._noise.shore(circle * 1.3, self.min_wavelength)
        lift = 0.5 * pond.depth
        radii = np.stack(
            [pond.radii[0] * 1.06 * irregular, np.full_like(u, pond.depth + lift), pond.radii[1] * 1.06 * irregular],
            axis=1,
        )
        local = np.stack([u, points[:, 1] - (levels.pond + lift), v], axis=1)
        k0 = np.linalg.norm(local / radii, axis=1)
        k1 = np.linalg.norm(local / (radii * radii), axis=1)
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-12)

    def _stream_distance(self, points: FloatArray) -> tuple[FloatArray, FloatArray]:
        """Abstand zum Bachbett und Wasserspiegel am nächsten Punkt der Mittellinie."""
        stream, levels = self.plan.stream, self.water
        distance = np.full(len(points), _FAR)
        level = np.full(len(points), np.nan)
        if stream is None or levels is None or len(levels.stream) == 0:
            return distance, level
        margin = stream.half_width + stream.depth + 1.0
        lower, upper = stream.path.min(axis=0) - margin, stream.path.max(axis=0) + margin
        near = (
            (points[:, 0] > lower[0]) & (points[:, 0] < upper[0])
            & (points[:, 2] > lower[1]) & (points[:, 2] < upper[1])
            & (points[:, 1] > levels.stream.min() - 2.0 * stream.depth - 1.0)
            & (points[:, 1] < levels.stream.max() + 2.0 * stream.depth + 1.0)
        )  # fmt: skip
        distance[near], level[near] = self._stream_distance_near(points[near], stream, levels)
        return distance, level

    def _stream_distance_near(
        self, points: FloatArray, stream: StreamPlan, levels: WaterLevels
    ) -> tuple[FloatArray, FloatArray]:
        """Elliptischer Querschnitt um die Mittellinie, Wasserspiegel linear zwischen Stützpunkten."""
        xz = points[:, [0, 2]]
        start, segment = stream.path[:-1], np.diff(stream.path, axis=0)
        length_sq = (segment * segment).sum(axis=1)
        best = np.full(len(points), np.inf)
        level = np.zeros(len(points))
        for index in range(len(segment)):
            t = np.clip(((xz - start[index]) @ segment[index]) / length_sq[index], 0.0, 1.0)
            distance = np.linalg.norm(xz - start[index] - t[:, None] * segment[index], axis=1)
            closer = distance < best
            best = np.where(closer, distance, best)
            here = levels.stream[index] + t * (levels.stream[index + 1] - levels.stream[index])
            level = np.where(closer, here, level)
        lift = 0.4 * stream.depth
        vertical = (points[:, 1] - (level + lift)) / (stream.depth + lift)
        horizontal = best / stream.half_width
        scale = min(stream.half_width, stream.depth + lift)
        return (np.sqrt(horizontal * horizontal + vertical * vertical) - 1.0) * scale, level

    # --- Feld -----------------------------------------------------------------------------

    def distance(self, points: FloatArray) -> FloatArray:
        return self._evaluate(points)[0]

    def sample(self, points: FloatArray) -> TerrainSample:
        """Merkmale für Farben und Bepflanzung an Punkten."""
        return self._evaluate(points)[1]

    def evaluate(self, points: FloatArray) -> tuple[FloatArray, TerrainSample]:
        """Abstand und Merkmale in einem Durchgang."""
        return self._evaluate(points)

    def bounds(self) -> Aabb:
        dims = self.dims
        reach = dims.radius * (1.0 + self.plan.harmonics[:, 1].sum() + 0.08) + 1.0
        bottom = -dims.depth - 1.0
        for spire in self.plan.spires:
            bottom = min(bottom, float(_spire_box(spire, margin=1.0).lower[1]))
        extra = (self.plan.hill.height if self.plan.hill is not None else 0.0) + (
            self.plan.terrace.height if self.plan.terrace is not None else 0.0
        )
        top = dims.dome + 2.5 * dims.relief + 1.0 + extra
        return Aabb(np.array([-reach, bottom, -reach]), np.array([reach, top, reach]))

    def _evaluate(self, points: FloatArray) -> tuple[FloatArray, TerrainSample]:
        dims, noise, cutoff = self.dims, self._noise, self.min_wavelength
        diameter = 2.0 * dims.radius
        x, y, z = points[:, 0], points[:, 1], points[:, 2]
        s = dims.soil_depth
        lifted = self._lifted_height(x, y, z)

        # Kernkörper: Profil über der Höhe, zur Tiefe hin seitlich versetzt und gelappt
        depth_fraction = self.rock_fraction(lifted)
        hang = depth_fraction[:, None] ** 2 * self.plan.hang_offset[None, :]
        hx, hz = x - hang[:, 0], z - hang[:, 1]
        theta = np.arctan2(hz, hx)
        radial_distance = np.hypot(hx, hz)
        outline = self.outline_radius(theta)
        circle = np.stack([np.cos(theta), np.sin(theta), depth_fraction * 2.0], axis=1)
        lobes = 1.0 + 0.4 * depth_fraction * noise.lobes(circle, cutoff)
        clipped_y = np.clip(lifted, -dims.depth - 1.0, dims.depth)
        radius = outline * np.clip(self._profile(clipped_y), 0.0, None) * lobes
        side = (radial_distance - radius) / np.sqrt(1.0 + (outline * self._profile_slope(clipped_y)) ** 2)

        # Im Plateaubereich ist der Versatz null, dort gilt der Umriss unverändert
        top = self._top_height(x, z, radial_distance / outline, cutoff)
        body = -smooth_min(-side, -(y - top), dims.lip_rounding)
        body = np.maximum(body, -self.plan.profile.core_depth * dims.depth - y)

        # Hängende Felsspitzen, weich angesetzt; ausgewertet nur in ihrer Hüllbox
        for spire in self.plan.spires:
            blend = 0.35 * spire.start_radius
            near = _inside_box(points, _spire_box(spire, margin=blend))
            body[near] = smooth_min(body[near], _spire_distance(points[near], spire), blend)

        # Fels auf domänenverzerrten Koordinaten: Schichten, versetzte Blöcke mit Rissen, Grate, Korn
        rock_weight = smoothstep(-0.6 * s, -1.5 * s, lifted) * (1.0 - smoothstep(0.92, 1.0, depth_fraction))
        warped = points + 0.035 * diameter * _warp(noise.warp, points, cutoff)
        layer = (
            warped[:, 1]
            + self.plan.tilt[0] * warped[:, 0]
            + self.plan.tilt[1] * warped[:, 2]
            + 1.1 * dims.strata_spacing * noise.strata(warped, cutoff)
        ) / dims.strata_spacing
        layer_index = np.floor(layer)
        hardness = 0.15 + 0.85 * hash01(layer_index + self.spec.seed * 0.137) ** 2
        strata = 0.5 * dims.strata_spacing * hardness * np.sin(np.pi * (layer - layer_index)) ** 0.6
        block_scale = 1.0 / (0.1 * diameter)
        cells = noise.blocks.evaluate(warped * np.array([block_scale, 0.45 * block_scale, block_scale]))
        block = cells.blended_value(0.06)
        crack = 1.0 - smoothstep(0.0, 0.1, cells.edge)
        crag = noise.crags(warped, cutoff)
        grain = noise.grain(warped, cutoff)
        rock = (
            strata
            + 0.035 * diameter * (block - 0.5)
            - 0.009 * diameter * crack
            + 0.01 * diameter * (crag - 0.45)
            + 0.004 * diameter * grain
        )

        # Felsstufe der Terrasse: Gestein tritt in der Mitte der Stufe hervor, nur nahe der Oberfläche
        terrace = self.terrace_fraction(points[:, [0, 2]])
        scarp = 4.0 * terrace * (1.0 - terrace) * (1.0 - rock_weight)

        # Erdband: klumpige Oberfläche zwischen Grasnarbe und Fels
        soil_weight = smoothstep(-0.2 * s, -0.5 * s, lifted) * (1.0 - rock_weight)
        soil = 0.12 * s * noise.soil(points, cutoff)
        body = body - (rock_weight + 0.45 * scarp) * rock - soil_weight * soil

        pond = self._pond_distance(points)
        stream, stream_level = self._stream_distance(points)
        body = -smooth_min(-body, np.minimum(pond, stream), 0.35)

        pond_level = self.water.pond if self.water is not None else -_FAR
        waterline = np.where(np.isfinite(stream_level) & (stream < pond), y - stream_level, y - pond_level)
        sample = TerrainSample(
            below_top=top - y,
            radial=radial_distance / np.maximum(outline, 1e-9),
            layer=layer,
            crack=crack,
            block=block,
            crag=crag,
            pond=pond,
            stream=stream,
            waterline=waterline,
            terrace=terrace,
        )
        return body, sample


def _ellipse_points(pond: PondPlan, angles: FloatArray) -> FloatArray:
    cos_a, sin_a = np.cos(pond.angle), np.sin(pond.angle)
    u, v = pond.radii[0] * np.cos(angles), pond.radii[1] * np.sin(angles)
    return np.stack([u * cos_a - v * sin_a, u * sin_a + v * cos_a], axis=1)


def _spire_box(spire: SpirePlan, margin: float) -> Aabb:
    ends = np.stack([spire.start, spire.end])
    reach = spire.start_radius + margin
    return Aabb(ends.min(axis=0) - reach, ends.max(axis=0) + reach)


def _inside_box(points: FloatArray, box: Aabb) -> npt.NDArray[np.bool_]:
    return np.all((points >= box.lower) & (points <= box.upper), axis=1)


def _spire_distance(points: FloatArray, spire: SpirePlan) -> FloatArray:
    """Bauchig zulaufender Kegel zwischen Ansatz und Spitze (Näherung eines Distanzfeldes)."""
    a, ba = spire.start, spire.end - spire.start
    t = np.clip(((points - a) @ ba) / float(ba @ ba), 0.0, 1.0)
    radius = spire.end_radius + (spire.start_radius - spire.end_radius) * (1.0 - t**1.5) ** 0.85
    return np.linalg.norm(points - a - t[:, None] * ba, axis=1) - radius


def _warp(field: Fractal, points: FloatArray, cutoff: float) -> FloatArray:
    offsets = (np.zeros(3), np.array([31.7, -12.3, 7.1]), np.array([-5.9, 44.2, -23.8]))
    return np.stack([field(points + offset, cutoff) for offset in offsets], axis=1)
