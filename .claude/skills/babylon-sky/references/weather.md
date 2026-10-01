# Weather: presets, director, rain, lightning, rainbow, wind

Rain is optional in the developer's requirements; presets, director and wind are needed for
living clouds and morning fog in any case.

## Presets [recommendation]

| Preset | Coverage | Type | Precipitation | Wind (m/s) | Mist × | Key light × | Exposure | Grading |
|---|---|---|---|---|---|---|---|---|
| `clear` | 0.10 | cirrus only, few cumulus | 0 | 2 | 0.5 | 1.0 | 0 | phase default |
| `fair` | 0.35 | cumulus | 0 | 4 | 1.0 | 1.0 | 0 | phase default |
| `misty-morning` | 0.30 | stratocumulus | 0 | 1 | 3.0 | 0.9 | +0.2 | softer contrast, pastel |
| `overcast` | 0.80 | stratocumulus | 0.1 | 5 | 1.2 | 0.4 | +0.4 | −25 % saturation, cooler |
| `shower` | 0.60 | cumulus congestus with rain cells | 0.7 in cells | 6 | 1.0 | 0.6 | +0.3 | −15 % saturation |
| `storm` | 0.85 | cumulonimbus | 1.0 in cells | 10 | 0.8 | 0.3 | +0.5 | high contrast, low saturation |

A preset also sets the high-layer coverage, rain particle density, audio profile and lightning
frequency. The effective `SkyState` is `keyframes(phase) ⊗ blend(presetA, presetB, weatherBlend)`.

## Director [recommendation]

- **Deterministic:** the schedule derives from `(worldSeed, dayIndex)`; every client computes the
  same weather for the same world time — no weather network messages beyond the shared clock.
- **Diurnal tendencies** (meteorology, `fog-mist.md`): misty dawns are likely after clear nights,
  cumulus builds through the day and peaks in the afternoon, showers happen in the afternoon,
  evenings clear up, nights are clear or thinly clouded.
- **Transitions:** 60–180 game seconds. Clouds grow by raising coverage through the threshold
  remap — they swell and dissolve, never fade in or out as a whole.
- **Regional variation:** the weather map moves with the wind, so rain cells drift across the
  island band; rain falls only below cells.
- Typical games carry 4–12 weather states and blend parameter sets over 30–120 s (cinevva
  overview) [reference].

## Coupling: every system responds

Weather sells when all systems change together: light dims, sky tints, grading shifts, ambient
audio swaps (cinevva overview) [reference].

| System | Responds with |
|---|---|
| Clouds | coverage, type, precipitation channel, density scale, wind offset speed |
| Key light | intensity factor (cloud shadow map darkens islands locally) |
| Exposure and grading | EV offset, saturation, color curves |
| Haze and mist | density factor, color shift toward gray-blue |
| Light shafts | strength factor; strongest in gaps of showers |
| Rain | particle density, layers, splashes, wetness target |
| Wind | direction and speed for clouds, rain slant, sprites, vegetation |
| Audio | wind bed, rain layers, thunder |
| Materials | wetness on islands (albedo darker, roughness lower) |

## Rain

### Where it falls

Below rain cells: from the cell's cloud base downward. Above the clouds there is no rain; inside
a raining cloud there is drizzle. Islands shelter whatever is under them — a gameplay-friendly
consequence of the occlusion map.

### Layers

| Layer | Range | Technique |
|---|---|---|
| Near drops | 0–25 m around the camera | `GPUParticleSystem`, `BILLBOARDMODE_STRETCHED` [verified 9.29], camera-attached emitter box |
| Mid streaks | 25–150 m | 2–3 camera-linked cylinders or screen layers with a pre-motion-blurred streak texture, depth-faded (*Remember Me*) [reference] |
| Rain shafts | 0.3–10 km | low-density vertical streak volumes below cell bases inside the cloud marcher — visible from afar like virga |

- **Counts:** near drops 2 000 (`low`), 4 000 (`medium`), 8 000 (`high`), 15 000 (`ultra`); drop
  width 2–3 cm, alpha 0.15–0.35.
- **Relative velocity:** a flying bee meets the rain. Streak direction and length follow
  `fallVelocity − cameraVelocity` and the shutter time (≈ 1/30 s) — fast forward flight turns
  rain into lines rushing at the camera.
- **Lighting:** drops take the ambient color, plus a strong forward-scattering glint toward the
  sun — backlit rain glows at golden hour.
- **Occlusion:** an orthographic depth map from above around the camera (64–128 m, 256²–512²)
  kills drops below island geometry (*Remember Me*); Babylon particles need a custom effect for
  this test.
- **Splashes** only on island tops near the camera, positions from the same depth map.
- **Wetness:** a PBR material plugin on island materials darkens albedo to 0.6–0.75, scales
  roughness by 0.5 and adds puddle sheen where the normal points up; wetness rises over 30–60 s
  of rain and dries over minutes.
- **Audio:** distant hiss, near drops on leaves, rain on water; a muffled bed inside clouds.

## Lightning

- **Bolt:** recursive midpoint displacement with branches (Reed & Wyvill 1994), seeded; an
  emissive ribbon mesh in HDR above the bloom threshold; 0.1–0.3 s with two or three restrikes.
- **Inside the cloud:** a secondary light term in the marcher — a point light at the bolt with
  distance falloff, scattered by the surrounding density. Most flashes are intra-cloud without a
  visible bolt; at night the whole tower lights up from inside.
- **Scene flash:** an exposure kick (+1.5 EV peak, 50–150 ms) and an ambient boost.
- **Thunder:** delayed by `distance / 343 m/s`; louder and sharper when close.
- **Accessibility:** at most one flash per second and an option "reduce flashes" (glow only, no
  exposure kick). WCAG 2.3.1 sets three flashes per second as the limit.

## Rainbow

- **Conditions:** after or at the edge of rain, sun below 42°, a rain curtain opposite the sun,
  sun not occluded.
- **Geometry:** primary bow at 40.6° (violet) to 42.4° (red) around the antisolar point;
  secondary bow at about 50–53° with reversed colors and a third of the brightness; the band
  between them (Alexander's band) slightly darker.
- **Render** in the cloud compositor: `alpha = degrees(acos(dot(viewDir, -toSun)))`; a spectral
  ramp across the band; intensity 0.15–0.3 × sun intensity × rain-curtain opacity along the view
  ray (rain-shaft density from the cloud pass) × sun visibility.
- **Lifetime:** fades in as rain passes, holds 1–2 minutes, fades with the curtain. A white
  moonbow is a rare night variant.

## Wind

- **One global wind** (direction, speed, gusts from seeded noise) feeds the weather-map offset,
  noise scrolling of each cloud layer, rain slant, mist sprites, banner orientation, vegetation
  wind (skill `babylon-graphics`, wind plugin) and the wind audio.
- **Layer speeds** differ for parallax: cloud deck 0.3×, island-band clouds 1×, high layer 0.2×
  of the wind speed — drift reads as depth.
- **Shear:** cumulus tops shift downwind relative to their bases.

## Debug controls

`__game.sky.listWeathers()`, `setWeather(name, blendSeconds)` and `skyState()` (SKILL.md, "Debug
API extension") let review agents set every preset and transition deterministically.
