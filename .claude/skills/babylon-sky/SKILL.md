---
name: babylon-sky
description: Use when planning, building, tuning or reviewing sky and weather in a Babylon.js game — day-night cycle with morning, noon, evening and night, sun, moon and stars, sun rays and moon rays, volumetric clouds and a cloud sea the player flies through, morning fog and mist around floating islands, rain, lightning and rainbows, weather transitions, the feel of flying through clouds, sky color scripts, and the browser performance budget for these effects.
---

# Sky world: day and night, clouds, fog, weather

The sky is the stage of a groundless world: the player glides between floating islands, above a
sea of clouds, through cumulus towers and morning mist. This skill defines how the AI agent
designs, builds and tunes that sky in Babylon.js so that it looks spectacular and stays inside
the browser's frame budget. It extends the light stack of skill `babylon-graphics` (atmosphere
addon, sun, cascaded shadows, HDR post-processing).

**REQUIRED BACKGROUND:** skill `babylon-graphics` (light stack and its pitfalls) and skill
`babylon-game-dev` (API verification order, Debug API). The AI agent checks every Babylon
signature against the installed typings before it lands in code.

## Evidence tags

| Tag | Meaning |
|---|---|
| **[verified 9.29]** | Checked against the Babylon.js 9.29 typings or addon source. |
| **[source-derived]** | Follows from reading Babylon source; the AI agent confirms it at runtime before relying on it. |
| **[reference]** | Published production technique; its numbers apply to the cited hardware. |
| **[recommendation]** | Design choice of this skill; the developer confirms or changes it in look-dev. |

## Target experience (bee-3d)

Requirements stated by the developer:

- Day-night cycle with morning, noon, evening and night.
- Sun rays and moon rays.
- Volumetric clouds, fog in the morning, rain as an option.
- Clouds and fog wrap around the islands; the player has to fly through clouds and fog.
- The game takes place almost entirely in the sky, without ground.
- Gliding between clouds and floating islands feels like looking out of an airplane window and
  thinking "wow".
- The whole sky and weather system looks extremely good, is generated in Babylon.js, runs in the
  browser and stays performant without overheating the PC.

## Experience pillars [recommendation]

1. **Scale and depth.** Three cloud depth planes (cloud sea below, cumulus among the islands,
   cirrus above), haze that turns distance blue, and objects of known size (islands, the bee)
   next to clouds many times larger.
2. **Light is the hero.** Low sun, silver linings, shafts through gaps, moonlit cloud tops. Dawn
   and dusk get the most screen time; noon is the plainest hour.
3. **Everything drifts.** Clouds evolve and travel with the wind, mist breathes, wisps rush past
   when flying.
4. **Readable at every hour.** The bee and the islands separate from the background by value;
   night is deep blue, never black.
5. **Rare wow moments.** Glory around the bee's shadow on the cloud sea, a rainbow after a shower,
   the Belt of Venus at dusk, bursting out of a cloud into sunlight — authored to happen, rare
   enough to stay special.

Details, color script and cloud design language: [references/art-direction.md](references/art-direction.md).

## Sky layers [recommendation]

| Layer | Content | Technique | Role |
|---|---|---|---|
| Celestial | sun disc, moon with phases, stars, Milky Way | sprites and sphere behind the atmosphere compositor | time cue, night beauty |
| High | cirrus, altocumulus | 2D layers inside the cloud pass | stays lit after sunset (afterglow) |
| Island band | islands, cumulus towers, orographic clouds (collar, cap, banner), mist pockets | raymarched medium | gameplay space, fly-through |
| Cloud sea | stratocumulus deck with a flat top | raymarched near, analytic surface far | floor and horizon of the world |
| Abyss | deep haze below the deck | analytic fog | hides the planet ground |

The atmosphere addon draws an opaque planet ground below the horizon [source-derived]; the cloud
sea and the abyss fog cover every downward view.

## Architecture

| Class (`src/rendering/sky/`) | Responsibility |
|---|---|
| `SkyClock` | World time from the shared clock, pacing curve, phase names |
| `CelestialRig` | Sun and moon directions, moon phase, star rotation |
| `SkyKeyframes` | Color script and per-phase parameters, interpolated per frame |
| `WeatherDirector` | Weather schedule, preset blending, wind |
| `SkyState` | Per-frame snapshot that every sky system reads |
| `KeyLightRig` | The single atmosphere light (sun–moon handoff), exposure, grading |
| `CelestialBodies` | Sun disc, moon, stars |
| `CloudMedium` | Density data: weather map, layers, authored volumes, island proxies |
| `CloudRenderer` | Raymarch passes, temporal resolve, upsampling, in-pass compositor |
| `CloudShadowMap` | Transmittance map toward the key light for islands, haze and shafts |
| `LightShafts` | Radial-blur shafts for sun and moon |
| `RainSystem`, `LightningSystem` | Precipitation and storms |
| `FlightAtmosphereFx` | In-cloud and speed effects around the camera |
| `SkyQuality` | Tier settings for all of the above |

Every class takes its dependencies through the constructor and owns `dispose()` (skill
`babylon-game-dev`). Time and weather derive only from `(worldSeed, worldTime)`, so every player
of a session sees the same sky.

### Frame order (classic render loop) [source-derived]

1. `scene.onBeforeRenderObservable`: `SkyClock` → `CelestialRig` → `WeatherDirector` →
   `SkyState` → `KeyLightRig` (light0 direction and intensity, exposure, grading).
2. Render targets: occluder depth (`scene.enableDepthRenderer` with camera-space Z), cloud shadow
   map every N frames.
3. `scene.onAfterRenderTargetsRenderObservable`: cloud raymarch passes into low-resolution
   targets (`EffectRenderer`), temporal resolve, depth-aware upsampling. The observable fires
   twice per frame — after the scene-level custom targets and again per camera after that
   camera's targets, including the depth renderer. The passes run only in the camera call
   (flag set in `onBeforeCameraRenderObservable`, cleared in `onAfterCameraRenderObservable`)
   and restore the framebuffer binding afterwards.
4. Rendering group 0: islands and bee.
5. `scene.onAfterRenderingGroupObservable` for group 0: the atmosphere draws its sky compositor;
   the cloud compositor, registered after the atmosphere, blends `scene × T + L` (clouds, haze,
   rainbow, glory).
6. Rendering group 1: water, rain, mist sprites, particles — in front of the clouds.
7. Camera post-processes: light shafts, then the `DefaultRenderingPipeline` (bloom, tone mapping,
   grading).

The Frame Graph variant splits rendering into two `FrameGraphObjectRendererTask`s — opaque with
`renderTransparentMeshes = false` and `renderParticles = false`, then transparent meshes and
particles only — with a `FrameGraphCustomPostProcessTask` as cloud compositor in between (task
and toggles [verified 9.29]; the wiring is untested). Skill `babylon-graphics` covers the Frame
Graph bridge for the atmosphere.

## Technique per tier

| Effect | `low` | `medium` | `high` | `ultra` |
|---|---|---|---|---|
| Clouds | mesh or sprite clouds + 2D layers | raymarch ¼ res + temporal reuse | far ½ res + temporal, near ¼ res without history | near ½ res + light volume (WebGPU compute) |
| Cloud sea far field | 2D shaded surface | analytic surface | analytic surface | analytic surface |
| Cloud shadows | none | 256², every 4 frames | 512², every 2 frames | 1024², every frame |
| Haze and mist | analytic haze | + mist volumes, 100 near sprites | 300 near sprites | 600 near sprites |
| Light shafts | VLS (cloud meshes occlude) | radial blur, 32 samples, ½ res | radial blur, 64 samples + in-medium shafts | as `high` |
| Rain | 2 000 drops, 1 layer | 4 000 drops, 2 layers | 8 000 drops, 3 layers, splashes, rain shafts | 15 000 drops, as `high` |
| Stars | texture | texture | procedural + twinkle | + Milky Way + shooting stars |

Numbers, budgets and the WebGL2 limit: [references/performance.md](references/performance.md).

## Starting values [recommendation]

| Parameter | Value |
|---|---|
| Day length | 24 real minutes with pacing (dawn and dusk longer) |
| Sun orbit | latitude 45°, declination 15° → noon 60°, sunrise 04:58, sunset 19:02 |
| Key-light handoff (sun elevation) | sun fades −6° … −12°, swap at −12°, moon fades in −12° … −16° |
| Cloud-sea top | 80 m below the lowest island, deck visible 150–400 m deep |
| Cumulus near islands | 40–250 m wide, flat bases at one height per layer |
| Extinction σt | cloud core 0.05–0.15 m⁻¹ (visibility 25–80 m), mist 0.005–0.02 m⁻¹ |
| Raymarch | ≤ 96 primary steps, 4–6 light samples, near/far split at 60 m |
| Weather transition | 60–180 game seconds |

## Implementation order

Each milestone ends with a state the developer can look at in the browser.

1. Clock, orbits, key-light handoff, exposure script, stars, moon — day and night without clouds.
2. Cloud medium: cloud sea and cumulus layer at half resolution without temporal reuse, in-pass
   compositor.
3. Aerial perspective on clouds, cloud shadows on islands, abyss fog.
4. Light shafts for sun and moon.
5. Morning mist and island-anchored volumes (collar, cap, banner).
6. Fly-through polish: near detail, resolution split, in-cloud effects, speed cues.
7. Weather director, rain, lightning, rainbow.
8. Temporal reprojection, quality tiers, fallbacks.

After each visible milestone the AI agent requests a review from agent `babylon-sky-reviewer`
and, from milestone 2 on, a measurement from agent `babylon-perf-profiler`. The developer judges
motion, transitions and flight feel in a live browser session.

## Debug API extension

The game exposes these controls in addition to the contract in skill `babylon-game-dev`
(`references/debug-api.md`), as `window.__game.sky`:

```ts
/** Sky and weather snapshot for review agents (Himmels- und Wetterzustand). */
export interface SkyDebugState {
  readonly hours: number; // solar time 0..24
  readonly phase: string; // e.g. "golden-evening"
  readonly sunElevationDeg: number;
  readonly moonElevationDeg: number;
  readonly keyLight: "sun" | "moon";
  readonly keyLightIntensity: number;
  readonly exposureEv: number;
  readonly weather: string; // preset name, or "from>to" during a transition
  readonly weatherBlend: number; // 0..1
  readonly coverage: number;
  readonly rainIntensity: number;
  readonly windDirection: readonly [number, number]; // XZ, normalized
  readonly windSpeed: number; // m/s
  readonly cameraCloudDensity: number; // medium density at the camera, 0 = clear air
}

/** Sky and weather controls (Himmel und Wetter steuern). */
export interface SkyDebugApi {
  listWeathers(): readonly string[];
  setWeather(name: string, blendSeconds?: number): void; // 0 = immediate
  setTimeScale(scale: number): void; // 0 freezes time, 1 = normal pacing
  skyState(): SkyDebugState;
}
```

- `setEffect` names: `clouds`, `cloudTemporal`, `cloudShadows`, `haze`, `mist`, `lightShafts`,
  `stars`, `rain`, `lightning`, `rainbow`, `glory`.
- Viewpoints for sky reviews, positioned by the game's spec: `aboveCloudSea` (horizon view),
  `islandBand`, `towardSun`, `awayFromSun`, `insideCloud`, `belowCloudBase`.

## Common mistakes

| Mistake | Consequence | Fix |
|---|---|---|
| Scene fog (`scene.fogMode`) as haze | horizon break against the atmosphere sky | haze inside the cloud medium plus atmosphere aerial perspective |
| Clouds as a camera post-process | clouds drawn over rain, water and particles (no depth writes) | in-pass compositor after rendering group 0 |
| `VolumetricLightScatteringPostProcess` with raymarched clouds | rays shine through clouds; VLS only sees meshes | radial blur with a cloud-transmittance mask ([light-shafts](references/light-shafts.md)) |
| Second `DirectionalLight` as moon | the atmosphere and its PBR plugin use light0 only | one key light with handoff ([day-night](references/day-night.md)) |
| Animating `aerialPerspectiveIntensity` across exactly 1 or `aerialPerspectiveRadianceBias` across 0 | compositor and PBR shader rebuilds → stutter [source-derived] | keep the value on one side, e.g. 1.05–3.0 |
| Animating `minimumMultiScattering*`, `multiScatteringIntensity` or `diffuseSkyIrradianceDesaturationFactor` | LUT re-render plus GPU→CPU readback per change [source-derived] | set once; animate `exposure` and `additionalDiffuseSkyIrradiance*` |
| History reuse on near clouds while flying | smearing and ghost trails | near pass without history; temporal reuse only beyond the split distance |
| `textureSample` inside a WGSL raymarch loop | compile error (non-uniform control flow) | `textureSampleLevel` (GLSL: `textureLod`) |
| Bilinear upsampling of low-res clouds | halos around island silhouettes | depth-aware upsampling with full-res depth |
| Evenly spaced uniform cloud blobs | "cotton balls on a grid" | big–medium–small shapes, flat bases, negative space |
| Night as dark as reality | black, unplayable screen | night exposure +2 EV, cool moon key, sky brighter than islands |

## Reference files

| File | Content |
|---|---|
| [art-direction.md](references/art-direction.md) | Look target, color script per phase, light ratios, cloud design language, clouds around islands, night, weather moods, wow moments, anti-patterns |
| [day-night.md](references/day-night.md) | Time and pacing, sun and moon orbits, key-light handoff with the atmosphere addon, exposure and grading script, stars, moon, keyframe data model |
| [clouds.md](references/clouds.md) | Cloud medium: scale, density model, noise, lighting, raymarching, reconstruction, compositing, shadows, far field, fallbacks |
| [fog-mist.md](references/fog-mist.md) | Morning fog, analytic haze, mist volumes, cloud sea and abyss, in-cloud view, fogbow and glory |
| [light-shafts.md](references/light-shafts.md) | Sun and moon rays: technique choice, radial blur with cloud mask, per-phase parameters |
| [weather.md](references/weather.md) | Presets, director, coupling, rain, lightning, rainbow, wind, multiplayer sync |
| [flight-feel.md](references/flight-feel.md) | Flying through clouds, speed and scale cues, audio, comfort |
| [performance.md](references/performance.md) | Budgets, tier matrix, cost levers, WebGPU and WebGL2 rules, measuring |
| [review.md](references/review.md) | Review protocol, sky checklist, numeric thresholds, report format (agent `babylon-sky-reviewer`) |
| [sources.md](references/sources.md) | Talks, papers, articles and assets behind this skill |
