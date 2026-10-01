# Day and night: time, sun, moon, stars, key light

## Time model [recommendation]

- **World time** is a number of seconds on a shared clock: the server clock in multiplayer, an
  accumulated local clock in single-player. The sky reads it every render frame, so the sun moves
  continuously, never in fixed-step jumps.
- **`SkyClock`** maps world time to solar hours through a pacing curve. Dawn and dusk are the
  most beautiful hours and get the most real time; noon and deep night are compressed.
- **Default cycle: 24 real minutes** (*Breath of the Wild* uses 24, *Minecraft* 20). Levels with
  a fixed time of day bypass the clock; the Debug API sets `timeScale` and hours directly.

### Pacing curve

Phases are bounded by sun elevation; the solar hours below follow from the default orbit
(latitude 45°, declination 15°).

| Phase | Sun elevation | Solar hours | Real minutes |
|---|---|---|---|
| night | < −12° | 20:20 → 03:40 | 5.0 |
| blue-dawn | −12° → −2° | 03:40 → 04:46 | 1.5 |
| sunrise | −2° → 8° | 04:46 → 05:45 | 2.0 |
| golden-morning | 8° → 20° | 05:45 → 06:54 | 2.0 |
| morning | 20° → 45° | 06:54 → 09:20 | 2.0 |
| noon | > 45° | 09:20 → 14:40 | 3.5 |
| afternoon | 45° → 20° | 14:40 → 17:06 | 2.0 |
| golden-evening | 20° → 8° | 17:06 → 18:15 | 2.0 |
| sunset | 8° → −2° | 18:15 → 19:14 | 2.0 |
| blue-dusk | −2° → −12° | 19:14 → 20:20 | 2.0 |

The developer's four phases: **morning** (blue-dawn … morning) 7.5 min, **noon** 3.5 min,
**evening** (afternoon … blue-dusk) 8.0 min, **night** 5.0 min.

```ts
/** One segment of the pacing curve (Abschnitt der Tageskurve). */
interface PacingSegment {
  readonly startHours: number; // solar hours at segment start
  readonly endHours: number; // may exceed 24 for the segment that wraps midnight
  readonly realSeconds: number;
}

/** Maps world time to solar hours with phase-dependent speed (Tagesuhr). */
export class SkyClock {
  private readonly cycleSeconds: number;

  public constructor(private readonly segments: readonly PacingSegment[]) {
    this.cycleSeconds = segments.reduce((sum, segment) => sum + segment.realSeconds, 0);
  }

  /** Returns solar hours 0..24 for a world time in seconds. */
  public solarHours(worldTimeSeconds: number): number {
    let remaining = ((worldTimeSeconds % this.cycleSeconds) + this.cycleSeconds) % this.cycleSeconds;
    for (const segment of this.segments) {
      if (remaining < segment.realSeconds) {
        const t = remaining / segment.realSeconds;
        return (segment.startHours + t * (segment.endHours - segment.startHours)) % 24;
      }
      remaining -= segment.realSeconds;
    }
    return this.segments[0]!.startHours;
  }
}
```

The segment list starts at 20:20 with `endHours` 27.67 (03:40 of the next day) and continues
through the table. Segment boundaries change the sun's speed but not its position.

## Sun and moon positions

Frame: +X east, +Y up, +Z north. Hour angle 0 at solar noon. The formula is the standard
equatorial-to-horizontal conversion; a numeric check confirmed noon elevation `90° − φ + δ`
and sunrise near the expected hour.

```ts
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

/** Writes the unit vector toward a celestial body (Richtung zum Himmelskörper). */
export function directionToBody(hours: number, latitudeDeg: number, declinationDeg: number, result: Vector3): Vector3 {
  const phi = (latitudeDeg * Math.PI) / 180;
  const delta = (declinationDeg * Math.PI) / 180;
  const hourAngle = ((hours - 12) / 24) * 2 * Math.PI;
  const along = Math.cos(delta) * Math.cos(hourAngle); // toward the meridian point of the celestial equator
  const west = Math.cos(delta) * Math.sin(hourAngle);
  const polar = Math.sin(delta);
  // pole = (0, sin φ, cos φ), meridian = (0, cos φ, −sin φ), west = (−1, 0, 0)
  return result.set(-west, polar * Math.sin(phi) + along * Math.cos(phi), polar * Math.cos(phi) - along * Math.sin(phi));
}
```

Default orbit [recommendation]: latitude 45°, declination 15° → noon 60°, midnight −30°,
sunrise 04:58, sunset 19:02. The tilt keeps a shadow side on every island at noon.

**Moon [recommendation]:** hour angle opposite the sun (`hours + 12`), declination −5° → about
40° high at midnight, rising near the start of night. The moon is then up every night and
appears low and orange at the key-light handoff (transmittance does the coloring). The phase is
cosmetic, cycling over 8 game days; moonlight brightness scales with it between 0.4 (new moon)
and 1.0 (full) so every night stays playable.

## Key light: one atmosphere light for sun and moon [source-derived]

What the addon does each frame (`atmosphere.ts`, `transmittanceLut.ts`, 9.29):

- It reads **only `lights[0]`**. The transmittance toward that light becomes `light.diffuse` and
  `light.specular`; a horizon weight fades this color to zero once the light is below the
  horizon.
- Sky radiance and `scene.ambientColor` scale with `light.intensity`.
- `atmosphere.exposure` scales the sky radiance per frame at no cost.

A second `DirectionalLight` for the moon therefore lights PBR materials without sky, color or
ambient. The `KeyLightRig` instead hands the one light from the sun to the moon at zero
intensity, so neither lighting nor sky can pop:

| Sun elevation | Light0 direction | Light0 intensity |
|---|---|---|
| > −6° | sun | π |
| −6° → −12° | sun | π · smoothstep fade to 0 (blue hour keeps its twilight glow) |
| −12° (swap) | jumps to the moon | 0 |
| −12° → −16° | moon | fades in to `π · moonIntensity · phaseBrightness` |
| < −16° | moon | `π · moonIntensity · phaseBrightness` |

The same table runs in reverse at dawn.

```ts
import type { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";

/** Applies the sun–moon handoff to the atmosphere light (Schlüssellicht übergeben). */
export function applyKeyLight(light: DirectionalLight, toSun: Vector3, toMoon: Vector3, sunElevationDeg: number, moonBrightness: number): "sun" | "moon" {
  if (sunElevationDeg > -12) {
    toSun.negateToRef(light.direction);
    light.intensity = Math.PI * smoothstep(-12, -6, sunElevationDeg);
    return "sun";
  }
  toMoon.negateToRef(light.direction);
  light.intensity = Math.PI * moonBrightness * (1 - smoothstep(-16, -12, sunElevationDeg));
  return "moon";
}

/** Cubic Hermite step between edge0 and edge1 (weiche Stufe). */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
```

Night tuning [recommendation]:

| Knob | Night value | Purpose |
|---|---|---|
| `moonBrightness` (× phase) | 0.03–0.06 | moonlight on materials; physically the moon is ~1/400 000 of the sun |
| image exposure | +2 EV | readable islands |
| `atmosphere.exposure` | 0.5–0.7 | sky darker than the moonlit islands would make it, so stars read |
| moon tint on materials | multiply `light.diffuse`/`specular` by ≈ (0.62, 0.74, 1.0) in `atmosphere.onAfterUpdateVariablesForCameraObservable` | cool moonlight on islands; the sky keeps its physical color (it copies the light color before this observer runs) |
| shadows | `light.shadowEnabled = intensity > 0.02 · max` | no shadow passes and no direction jump during the swap |

The frame check targets for night are in `art-direction.md`.

## Exposure and grading script

- `scene.imageProcessingConfiguration.exposure = 2 ** (phaseEv + weatherEv + adaptationEv)`,
  updated per frame (cheap). EV values come from the color script; EV is interpolated in EV
  space, never as linear exposure.
- **Grading** per phase through `ColorCurves` (`highlightsHue/Density`, `shadowsHue/Density`,
  `globalSaturation`), interpolated between keyframes [verified 9.29: properties exist]. One
  `ColorGradingTexture` LUT, if used, carries the global look and stays fixed.
- **White balance** (`whiteBalanceEnabled`, `temperature`, `tint`) neutralizes light color; it
  is not a grading tool (skill `babylon-graphics`).
- **Adaptation** (owned by `FlightAtmosphereFx`): −0.3 EV inside clouds, +0.4 EV overshoot on
  exit decaying with a 0.6 s time constant.

Atmosphere setters and their cost [source-derived, 9.29]:

| Setter | Cost | Use |
|---|---|---|
| `exposure`, `diffuseSkyIrradianceIntensity`, `additionalDiffuseSkyIrradianceIntensity` / `Color`, `aerialPerspectiveTransmittanceScale`, `aerialPerspectiveSaturation` | uniform update | animate freely |
| `aerialPerspectiveIntensity` | rebuilds compositors and PBR plugin defines when crossing exactly 1 | animate only within 1.05–3.0 |
| `aerialPerspectiveRadianceBias` | rebuild when crossing exactly 0 | keep non-zero if animated |
| `multiScatteringIntensity`, `minimumMultiScattering*`, `diffuseSkyIrradianceDesaturationFactor` | LUT re-render plus GPU→CPU readback | set once |
| `groundAlbedo`, `physicalProperties` | LUT re-render | set once |

## Celestial bodies

**Placement [source-derived]:** sun disc, moon and stars render in rendering group 0 with
`material.disableDepthWrite = true` and `mesh.infiniteDistance = true` [verified 9.29: both
exist]. Their pixels keep the far depth, so the atmosphere's sky compositor (depth test `EQUAL`
far plane, premultiplied "over" blending) multiplies them by the atmospheric transmittance and
adds the sky radiance on top. Stars vanish by day, fade toward the horizon, and the sun and
moon redden near the horizon — automatically. The compositor shader marks ground pixels opaque
"to prevent celestial objects showing through the planet".

| Body | Recipe [recommendation] |
|---|---|
| Sun disc | HDR emissive disc, apparent diameter 1.0–1.5° (real 0.53°), limb darkening `1 − 0.6 · (1 − μ)`; bright enough to bloom; source of the light shafts |
| Moon | albedo texture (NASA CGI Moon Kit, public domain), diameter 1.5–2.5° (real 0.52°), phase shading with a soft terminator facing the sun's projected direction, earthshine ≈ 0.02 on the dark side |
| Stars | procedural on the sky sphere: hashed cells per direction, magnitude distribution with many faint and few bright stars, color from temperature 3000–12 000 K, twinkle that grows toward the horizon; or the NASA *Deep Star Maps 2020* panorama (public domain) at 4k |
| Milky Way | low-resolution band texture or noise band on the star sphere |
| Star rotation | the star sphere rotates about the celestial pole (tilted by the latitude) once per game day |
| Shooting stars | short HDR streak sprites, one every few minutes at night, seeded |
| Lens flare | `LensFlareSystem` [verified 9.29], sun only, subtle, scaled by the cloud transmittance at the sun's screen position |

## Keyframe data model

Keys are anchored to sun elevation and direction of travel, not to clock hours, so the look
stays attached to the light when the orbit or the pacing changes.

```ts
import type { Color3 } from "@babylonjs/core/Maths/math.color";

/** Named phase of the day (Tagesphase). */
export type SkyPhase =
  | "night" | "blue-dawn" | "sunrise" | "golden-morning" | "morning"
  | "noon" | "afternoon" | "golden-evening" | "sunset" | "blue-dusk";

/** Art-directed values of one color-script key (Farbskript-Schlüssel). */
export interface SkyKeyframe {
  readonly phase: SkyPhase;
  readonly sunElevationDeg: number;
  readonly rising: boolean; // morning keys and evening keys form separate curves
  readonly exposureEv: number;
  readonly atmosphereExposure: number;
  readonly cloudAmbientTop: Color3; // linear RGB
  readonly cloudAmbientBottom: Color3; // bounce from the deck
  readonly hazeColorSunward: Color3;
  readonly hazeColorAway: Color3;
  readonly hazeDensity: number; // 1/m at the haze base height
  readonly mistAmount: number; // 0..1, scales island-anchored mist volumes
  readonly shaftStrength: number;
  readonly highlightsHue: number;
  readonly highlightsDensity: number;
  readonly shadowsHue: number;
  readonly shadowsDensity: number;
  readonly globalSaturation: number;
}
```

`SkyKeyframes.evaluate(sunElevationDeg, rising)` finds the two neighboring keys and blends
scalars with smoothstep and colors in linear RGB. Weather presets then modify the result
(`weather.md`); the combined `SkyState` is the only input of the render systems.

## Testing the cycle

- **Timelapse probe:** `setTimeScale(60)`, then `frameCheck()` every 0.5 s through both handoff
  windows (sun −4° … −18°). A jump of mean luminance above 0.05 between samples is a pop.
- **Phase stills:** one still per phase at the same viewpoint, compared against the color
  script. Agent `babylon-sky-reviewer` runs both.
