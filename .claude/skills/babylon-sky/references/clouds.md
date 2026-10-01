# Clouds: one medium, one marcher

Cumulus towers, the cloud deck, orographic clouds around islands and morning mist are the same
medium — water droplets — with different density. One raymarcher integrates all of them, so
lighting, occlusion and color stay consistent. Babylon has no built-in volumetric clouds
[verified 9.29]; the community SkyMaterial cloud plugin (`#MAONNT#13`) is CC-BY-NC-SA and slow
and is not used.

## Scale for bee-3d [recommendation]

| Element | Size and placement |
|---|---|
| Island band | islands 10–100 m across, vertical spread defined by the spec |
| Cumulus among islands | 40–250 m wide, 60–250 m tall; bases on one or two shared levels |
| Backdrop towers (> 3 km away) | 500–1500 m wide, up to 1 km tall — scale contrast |
| Cloud-deck top | 80 m below the lowest island; undulation 6–20 m over 150–600 m |
| Cloud-deck depth | 150–400 m visible, then abyss fog |
| High layer | 2D shell 1.5–4 km above the island band |
| Mist volumes | 5–40 m |
| Visibility inside a cloud core | 25–80 m (σt 0.05–0.15 m⁻¹, Koschmieder `V ≈ 3.9 / σt`) |

Atmosphere `originHeight` 1.5–3 km lets the island band float at altitude: deeper zenith blue
and the horizon below eye level.

## Density model

```
density(p) = erode(max(layers(p), deck(p), volumes(p)), detail) · carve(p)
```

### Weather map

2D RGBA8, world XZ, 512², tileable, one tile per 2–4 km, scrolled by the wind:

| Channel | Meaning |
|---|---|
| R | coverage 0..1 |
| G | cloud type: 0 stratus, 0.5 stratocumulus, 1 cumulus |
| B | precipitation 0..1 (rain cells: denser, taller, darker) |
| A | detail type: 0 wispy, 1 billowy |

`WeatherDirector` writes it from seeded noise and the active presets. Beyond ~3 km the map
biases toward cumulus at about 50 % coverage so the horizon always holds interesting clouds
(Horizon Zero Dawn does this from 15 km in its kilometer-scale world) [reference].

### Layer density (classic formulation) [reference]

Horizon Zero Dawn / *GPU Pro 7* structure, widely reimplemented:

```glsl
// Remaps value from [oldMin, oldMax] to [newMin, newMax] (Umrechnung).
float remap(float value, float oldMin, float oldMax, float newMin, float newMax) {
  return newMin + (value - oldMin) / (oldMax - oldMin) * (newMax - newMin);
}

// Density profile over the layer height h (0..1) for a cloud type (Höhenprofil).
float heightProfile(float h, float type) {
  float stratus = smoothstep(0.0, 0.10, h) * (1.0 - smoothstep(0.20, 0.30, h));
  float stratocumulus = smoothstep(0.0, 0.15, h) * (1.0 - smoothstep(0.40, 0.65, h));
  float cumulus = smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.55, 0.95, h)); // steep base = flat bottom
  return type < 0.5 ? mix(stratus, stratocumulus, type * 2.0) : mix(stratocumulus, cumulus, type * 2.0 - 1.0);
}

// Base shape of a layer cloud before detail erosion (Grundform).
float layerBaseDensity(vec4 shapeNoise, vec4 weather, float h) {
  float worleyFbm = shapeNoise.g * 0.625 + shapeNoise.b * 0.25 + shapeNoise.a * 0.125;
  float base = remap(shapeNoise.r, worleyFbm - 1.0, 1.0, 0.0, 1.0); // Perlin–Worley sharpened by Worley fBm
  base *= heightProfile(h, weather.g);
  float coverage = weather.r;
  return clamp(remap(base, 1.0 - coverage, 1.0, 0.0, 1.0), 0.0, 1.0) * coverage;
}

// Erodes the base shape with detail noise; wispy at the base, billowy above (Erosion).
float erodeDensity(float base, vec3 detailNoise, float h) {
  float detailFbm = detailNoise.r * 0.625 + detailNoise.g * 0.25 + detailNoise.b * 0.125;
  float modifier = mix(detailFbm, 1.0 - detailFbm, clamp(h * 10.0, 0.0, 1.0));
  return clamp(remap(base, modifier * 0.2, 1.0, 0.0, 1.0), 0.0, 1.0);
}
```

The base shape uses only the low-frequency texture — that makes it the "cheap sample" of the
march. The detail texture is fetched only where the base is non-zero.

### Fly-through detail (Nubis³) [reference]

Close to the camera the classic detail runs out. Nubis³ adds detail without another texture
fetch and lowers density near the camera to hide undersampling:

```glsl
// Extra detail near the camera from twice-folded noise (Nahdetail).
float nearDetail(vec4 detailNoise, float detailType) {
  float wisps = 1.0 - pow(abs(abs(detailNoise.g * 2.0 - 1.0) * 2.0 - 1.0), 4.0);
  float billows = pow(abs(abs(detailNoise.a * 2.0 - 1.0) * 2.0 - 1.0), 2.0);
  return mix(wisps, billows, detailType);
}
// Blend: noise = mix(nearDetail, regularComposite, remap(distance, near0, near1, 0.9, 1.0)) — Nubis³ uses 50–150 m;
// bee scale: 10–40 m.
```

Nubis³ then sharpens the result with `pow(density, mix(0.3, 0.6, pow(densityScale, 4.0)))` and
lowers the density close to the camera to reduce undersampling noise. Nubis composites blend low- and high-frequency wisps over the dimensional profile
(`mix(noise.r, noise.g, profile)`) and billows over `pow(profile, 0.25)`; the detail type from
the weather map picks between them. Wisps belong where density decreases, billows where it
increases.

### Cloud deck

```glsl
// Density of the cloud deck with an undulating flat top (Wolkenmeer).
float deckProfile(vec3 p, float deckTop, float undulation, float softness, float deckNoise2D) {
  float top = deckTop + undulation * (deckNoise2D - 0.5);
  return clamp((top - p.y) / softness, 0.0, 1.0); // 0 above the top, 1 at depth `softness`
}
```

The profile replaces `heightProfile × coverage`; stratocumulus-type erosion gives the top its
billows. Below the visible depth the abyss fog takes over (`fog-mist.md`).

### Authored volumes around islands

Collars, caps, banners and mist pockets (`art-direction.md`) are signed-distance primitives
anchored to islands. The CPU culls them to at most 32 near the camera and uploads center,
orientation, radii, density, softness and detail type per primitive.

| Form | Primitive |
|---|---|
| Collar | torus around the island axis just below the grass lip, broken by a coverage threshold |
| Cap | flattened ellipsoid above the island |
| Banner | tapered capsule from a spire tip, oriented downwind, 30–120 m long |
| Mist pocket | flat ellipsoid in a hollow or over a pond, large softness |

`profile = clamp(-sdf / softness, 0.0, 1.0)` turns a primitive into a dimensional profile; the
same erosion follows. Outside every primitive, the SDF is also the safe step length (sphere
tracing).

### Carving by islands

The medium never passes through island geometry: `carve = smoothstep(0.0, margin, islandSdf(p))`
with a 1–3 m margin.

- **Version 1:** analytic island proxies from island metadata — an ellipsoid for the plateau
  and a cone for the underside; the CPU uploads the eight nearest islands.
- **Version 2:** coarse SDF volumes (32³–64³, R16F) baked per island by the island generator
  (skill `babylon-islands`, which builds islands from distance fields) and sampled in island
  local space.

## Noise and data textures

| Texture | Size | Format | Content | Memory |
|---|---|---|---|---|
| Shape | 128³ | RGBA8 | Perlin–Worley + 3 Worley octaves (HZD) | 8 MiB |
| Detail | 32³ | RGBA8 | Worley octaves, or Nubis wispy/billowy low/high | 128 KiB |
| Curl | 128² | RG8 | distortion of detail coordinates | 32 KiB |
| Blue noise | 128² | R8 | ray-start jitter (Christoph Peters, CC0) | 16 KiB |
| Weather map | 512² | RGBA8 | see above | 1 MiB |

- Frostbite packs shape and detail into single-channel volumes after combining the octaves
  offline — the same look at a quarter of the bandwidth [reference]. Use R8 128³ (2 MiB) for
  `medium` and below.
- A seeded Python tool `tools/sky/` (numpy; tileable Perlin and Worley after
  `sebh/TileableVolumeNoise`, MIT) writes raw `.bin` files to `public/assets/textures/sky/`.
  The game loads them with `fetch` into `RawTexture3D(data, w, h, d, format, scene,
  generateMipMaps, invertY, samplingMode, textureType)` [verified 9.29], wrap mode repeat on
  U, V and R, mipmaps on.
- The CPU keeps the arrays for the camera-density evaluator (`flight-feel.md`).
- Tiling: shape texture once per ~300 m, detail once per ~30 m; curl distortion 4 m.

## Lighting

Per sample: `S = σs · ρ · (lightColor · T_light · P_ms · powder + ambient)`.

| Term | Formula | Start value |
|---|---|---|
| Phase | dual-lobe Henyey–Greenstein `mix(HG(μ, gF), HG(μ, gB), wB)`, μ = dot(view, toLight) | gF 0.75, gB −0.25, wB 0.3 |
| Light transmittance | `exp(-σt · τ_light)`; τ from 6 cone samples, the last one far away (HZD), or from the light volume | — |
| Multiple scattering | Wrenninge octaves `Σ aⁿ · exp(-bⁿ σt τ) · P(μ, g·cⁿ)`, a ≤ b keeps energy | N 3, a = b = c = 0.5 |
| Powder (dark front-lit edges) | `mix(1, 1 - exp(-2 ρ k), 0.5 - 0.5 μ)` — strongest with the light behind the viewer | k 0.5–1 |
| Ambient | `mix(ambientBottom, ambientTop, h) · pow(1 - profile, 0.5)` — light from around penetrates the surface only (Nubis) | from the keyframes |
| Rain cells | albedo 0.98 → 0.88 and density × 1.5 with precipitation | — |
| Lightning | point-light term with distance falloff inside the cell (`weather.md`) | — |

```glsl
const float PI = 3.14159265;

// Henyey–Greenstein phase function, normalized over the sphere (Phasenfunktion).
float henyeyGreenstein(float mu, float g) {
  float denom = 1.0 + g * g - 2.0 * g * mu;
  return (1.0 - g * g) / (4.0 * PI * denom * sqrt(denom));
}

// Sun or moon radiance arriving at a sample, including multiple-scattering octaves (Einstrahlung).
vec3 lightRadiance(vec3 lightColor, float sigmaT, float tauLight, float mu, float gF, float gB, float wB) {
  float sum = 0.0;
  float a = 1.0;
  float b = 1.0;
  float c = 1.0;
  for (int octave = 0; octave < 3; octave++) {
    float phase = mix(henyeyGreenstein(mu, gF * c), henyeyGreenstein(mu, gB * c), wB);
    sum += a * exp(-b * sigmaT * tauLight) * phase;
    a *= 0.5;
    b *= 0.5;
    c *= 0.5;
  }
  return lightColor * sum;
}
```

**Integration** — energy-conserving per step (Frostbite 2016). A numeric check on a homogeneous
slab of optical depth 4.8: the formula is exact at any step count, while the naive sum
`L += T · S · dt` overshoots by 16 % at 16 steps and by a factor of 4.8 at one step.

```glsl
// Integrates one march step of length dt (Schrittintegration).
// S = in-scattered radiance per meter (σs · ρ · incoming light); sigmaT = σt · ρ.
void integrateStep(inout vec3 radiance, inout float transmittance, vec3 S, float sigmaT, float dt) {
  float stepTransmittance = exp(-sigmaT * dt);
  radiance += transmittance * (S - S * stepTransmittance) / max(sigmaT, 1e-6);
  transmittance *= stepTransmittance;
}
```

**Inputs per frame:** `toLight` and `lightColor` from light0 (`light.diffuse · intensity`);
`ambientTop` / `ambientBottom` from `atmosphere.getDiffuseSkyIrradianceToRef(...)` for the up
and down directions [verified 9.29: public], tinted by the keyframes. The atmosphere uniform
buffer can bind straight into a custom effect with `atmosphere.bindUniformBufferToEffect(effect)`
[verified 9.29: public].

**Aerial perspective on clouds** [source-derived]: the march also returns the
transmittance-weighted mean depth `Σ Tᵢ tᵢ / Σ Tᵢ` over samples with density (Frostbite). The
compositor samples `atmosphere.aerialPerspectiveLutRenderTarget` once at that depth — a 2D-array
texture in screen UV with 32 layers of 4 km and square-root layer spacing, as in
`sampleAerialPerspectiveLut` of the addon include `atmosphereFunctions` — and applies it to the
cloud radiance weighted by the cloud opacity `1 − T`.

## Raymarch

1. **Bounds:** slab intersection per layer (deck, cumulus), sphere tracing toward volumes, and
   the scene depth as the end (camera-space Z from the depth renderer, converted to ray length
   `t = z / dot(rayDir, cameraForward)`; the depth renderer stores 0 for sky pixels, which means
   "no geometry" and lets the ray run to the march range).
2. **Step length:** `step = max(sdfStep, minStep + growth · t)`; inside layers `sdfStep = 0`.
3. **Cheap and full samples:** march with the base shape only and doubled steps; on the first
   non-zero sample step back once and switch to full samples; after six empty full samples
   switch back (HZD).
4. **Early exit** when `T < 0.01` (`high`) or `0.03` (`medium`).
5. **Jitter:** start offset `fract(blueNoise(pixel) + frameIndex · 0.618034) · step`, animated
   in the near pass, static in the far pass so distant clouds do not shimmer (Nubis³).
6. **Noise LOD:** `lod = log2(1 + t · lodScale)` — about 15 % faster in Nubis³.
7. **WGSL:** sample with `textureSampleLevel` inside the loop; `textureSample` requires uniform
   control flow and fails to compile there. GLSL: `textureLod`.
8. **Step heatmap:** a debug output of steps per pixel; the AI agent tunes `growth` until the
   worst viewpoints stay below the step budget.

## Resolution, history, upsampling

- **Two passes split at `nearSplit`** (60 m): near at ¼ resolution without history, far at ½
  (`high`) or ¼ (`medium`) resolution with history. Nubis³ splits at 200 m for kilometer clouds
  (480×270 near, 960×540 far: 4 ms → 2.1 ms on PS5) [reference].
- **Outputs per pass:** RGBA16F (RGB in-scattered radiance, A transmittance) and R16F mean depth.
- **Combine:** `L = L_near + T_near · L_far`, `T = T_near · T_far`.
- **Temporal reuse (far pass):** reproject the previous result with the mean depth and the
  previous view-projection matrix; clamp to the 3×3 neighborhood of the current low-res frame;
  keep 85–92 % history when valid, none when the sample left the screen, the scene depth
  changed or the camera cut. Blending in optical-depth space (`-log T`) reduces ghosting at
  sparse edges (weBIGeo) [reference].
- **Cheaper alternative for `medium`:** HZD updates one pixel per 4×4 block per frame and
  reprojects the rest (≈ 10× faster) — only for distant, slow-moving content [reference].
- **Depth-aware upsampling:** each full-resolution pixel takes the low-res sample whose depth is
  closest to its own depth among the four nearest. Bilinear upsampling leaves halos around
  island silhouettes.

## Compositor (in-pass) [source-derived]

```ts
// Registered after `new Atmosphere(...)`; observers run in registration order.
scene.onAfterRenderingGroupObservable.add((info) => {
  if (info.renderingManager !== scene.renderingManager || info.renderingGroupId !== atmosphere.skyRenderingGroup) {
    return;
  }
  cloudRenderer.drawComposite(); // fullscreen triangle: rgb = L, a = 1 − T, blend ALPHA_PREMULTIPLIED_PORTERDUFF, no depth test
});
```

- The blend `result = L + dst · T` is the same one the atmosphere uses for its sky compositor.
- The raymarch passes themselves run earlier, in the per-camera notification of
  `scene.onAfterRenderTargetsRenderObservable`, once the depth renderer has drawn this frame's
  depth. `Scene._renderForCamera` binds the camera framebuffer before that notification, and
  without post-processes nothing rebinds it afterwards. The passes follow the pattern of the
  atmosphere's own LUT passes: `effectRenderer.saveStates()`, `engine.bindFramebuffer(target)`,
  draw, `effectRenderer.restoreStates()`, `engine.restoreDefaultFramebuffer()`; with post-processes
  `postProcessManager._prepareFrame()` binds the scene target right after the notification
  [source-derived].
- Rainbow, fogbow and glory are additive terms in the same draw (`fog-mist.md`, `weather.md`).
- Rendering group 1 (water, rain, sprites) draws afterwards and sits in front of the clouds.

## Cloud shadows

- **`CloudShadowMap`:** orthographic toward the key light, centered on the camera and snapped to
  whole texels, 1.5 km wide; each texel marches 8–16 base-shape samples and stores the
  transmittance (R16F). Updated every 1–4 frames (tier table).
- **Consumers:** island materials (a PBR material plugin multiplies the light0 contribution —
  the AI agent verifies the injection point with agent `babylon-api-verifier`), haze
  in-scattering, light shafts, rain and mist sprites.
- **Beer shadow maps** (three-clouds) store front depth, mean extinction and maximum optical
  depth for better results at grazing angles — `ultra` [reference].
- **Island shadows on the deck:** `high` and `ultra` sample one orthographic island depth map in
  the light march near islands; `medium` projects each island's ellipse along the light onto
  the deck top.

## Light volume (`ultra`, WebGPU)

Nubis³ decouples the light march: a 3D texture around the camera (e.g. 128 × 32 × 128 cells of
8–16 m) stores the optical depth toward the light. A compute shader (`ComputeShader` with
`setStorageTexture` on a `RawTexture3D` created with `TEXTURE_CREATIONFLAG_STORAGE`
[verified 9.29]) refreshes it over 4–8 frames. The view march then samples one texel instead of
six light samples — about 40 % faster in Nubis³, with long inter-cloud shadows as a bonus
[reference]. WebGL2 keeps the cone samples.

## Far field of the deck

Beyond the marched range (≈ 3 km) the deck becomes a surface: the ray hits the deck-top plane (or
a planet-radius sphere for horizon curvature), a 2D noise height field supplies the normal, and
the same light terms shade it with a fixed optical depth, plus the atmosphere's aerial
perspective. A 300–500 m blend joins volume and surface.

## High layer

2D cirrus and altocumulus textures on a spherical shell, scrolled slowly by the wind, lit by the
transmittance toward the light at the shell altitude — so they glow pink after the lower clouds
have lost the sun. Drawn inside the cloud pass behind the far march.

## Fallbacks (`low`)

- **Mesh clouds** (Sea of Thieves): low-poly cloud meshes per cluster with per-vertex wrap
  lighting, rendered to a quarter-resolution buffer, Gaussian-blurred, depth stored in alpha,
  composited with a distortion texture for fluffy edges; distant clouds get an alpha threshold
  for crisp outlines [reference].
- **Six-way lit sprites:** billboards lit from six baked directions (Unity's CC0 texture library
  or own bakes); costs about as much as a lit sprite [reference].
- **2D dome** for everything beyond the island band.
- Same palette, layer heights and wind as the raymarched tiers.

## Starting parameters [recommendation]

| Parameter | `high` | `medium` |
|---|---|---|
| Primary steps (max, near + far) | 96 | 64 |
| Light samples | 6 (cone, last far) | 3 |
| `minStep` / `growth` | 0.5 m / 0.008 | 0.75 m / 0.012 |
| `nearSplit` | 60 m | 60 m |
| Near / far resolution | ¼ / ½ | ¼ / ¼ |
| History weight (far) | 0.9 | 0.92 |
| Early exit `T` | 0.01 | 0.03 |
| σt cloud core / albedo | 0.08 m⁻¹ / 0.98 | same |
| Phase gF / gB / wB | 0.75 / −0.25 / 0.3 | same |
| Multiple-scattering octaves | 3 | 2 |
| Shape / detail tile | 300 m / 30 m | same, detail optional |

## Tests

- **Density parity:** the CPU evaluator and the shader agree at 100 random points within 0.02.
- **Step heatmap** below budget at `aboveCloudSea`, `insideCloud` and `belowCloudBase`.
- **Fly-through capture** at 20 m/s: no ghost trails behind cloud edges.
