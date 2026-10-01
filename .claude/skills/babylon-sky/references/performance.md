# Performance: budgets, tiers, levers

Measurement protocol, quality manager and dynamic resolution: skill `babylon-performance`. This
file adds what is specific to the sky.

## Budget [recommendation]

Reference device: the development machine with integrated Intel Arc graphics, 1280×720, WebGPU,
60 fps (16.6 ms per frame).

| Pass | `high` (ms) | `medium` (ms) | `low` (ms) |
|---|---|---|---|
| Atmosphere (per-camera LUTs, compositor) | 0.3 | 0.3 | 0.3 |
| Clouds (near + far march, temporal, upsampling, compositor) | ≤ 3.0 | ≤ 2.0 | mesh clouds ≤ 0.8 |
| Cloud shadow map (amortized) | 0.2 | 0.1 | — |
| Haze and abyss (inside marcher and compositor) | 0.1 | 0.1 | 0.1 |
| Light shafts | 0.4 | 0.3 | VLS 0.3 |
| Rain (while raining) | 0.4 | 0.3 | 0.2 |
| Sun, moon, stars | 0.1 | 0.1 | 0.1 |
| **Sky total** | **≤ 4.5** | **≤ 3.2** | **≤ 1.8** |

The rest of the frame — islands, vegetation, shadows, post-processing, gameplay — keeps about
11 ms.

Published numbers for orientation [reference]:

| Source | Hardware, resolution | Cost |
|---|---|---|
| Horizon Zero Dawn (2015) | PS4, quarter-res buffer, 1/16 pixels per frame | ~2 ms |
| Frostbite (2016) | Xbox One, 720p, half-res, 16 samples, 2 scattering octaves | 0.91 ms worst case |
| Nubis³ (2023) | PS5, 960×540, fly-through voxel clouds | 2.2–4 ms; 2.1 ms with the near/far split |
| three-clouds (README, v0.0.1 measurements) | iPhone 13 `low` / iPad Pro M4 `high` (2420×1520) / M3 Max `high` 4K | 36–53 / 43–55 / 92–95 fps, temporal upscaling on |
| weBIGeo Clouds (2026) | WebGPU, half-res, TAAU | 2.25 ms peak cloud pass |

## Tier matrix

| Knob | `low` | `medium` | `high` | `ultra` |
|---|---|---|---|---|
| Cloud technique | mesh clouds + 2D layers | raymarch | raymarch | raymarch + light volume |
| Far pass resolution | — | ¼ + temporal (or 1/16 updates) | ½ + temporal | ½ + temporal |
| Near pass (< 60 m) | — | ¼, no history | ¼, no history | ½, no history |
| Max primary steps | — | 64 | 96 | 128 |
| Light samples | — | 3 | 6 | light volume |
| Detail noise / curl / near detail | — | detail only | all | all |
| Scattering octaves | — | 2 | 3 | 3 |
| Cloud shadow map | — | 256², every 4 frames | 512², every 2 frames | 1024², every frame (Beer shadow map) |
| Island shadows on the deck | — | projected ellipses | island depth map | island depth map |
| Mist volumes | — | yes | yes | yes |
| Near mist sprites | — | 100 | 300 | 600 |
| Light shafts | VLS on cloud meshes | radial blur 32, ½ res | radial blur 64, ½ res + in-medium shafts | as `high` |
| Rain near drops | 2 000 | 4 000 | 8 000 | 15 000 |
| Rain layers / shafts in marcher | 1 / no | 2 / no | 3 / yes | 3 / yes |
| Stars | texture | texture | procedural + twinkle | + Milky Way, shooting stars |
| Rainbow, fogbow, glory | yes (cheap) | yes | yes | yes |

WebGL2 starts at `medium` at most (skill `babylon-graphics`); software rendering starts at `low`.

## Cost drivers, ranked

1. **Marched pixels.** ½ → ¼ resolution is 4× fewer rays — the largest lever.
2. **Steps per ray.** Step growth, step cap, early exit, empty-space skipping (SDF steps, cheap
   base-shape samples).
3. **Fetches per step.** Detail noise only where the base shape is non-zero; single-channel
   noise volumes; noise MIP growing with distance.
4. **Light samples per step.** 6 → 3 → light volume; light samples switch to the cheap base
   shape once the view opacity passes 0.3 (≈ 2× faster in HZD) [reference].
5. **Temporal amortization** of the far pass.
6. **Glancing rays** along flat cloud bases are the worst case (Nubis³ measured 12 ms before
   optimization): layer heights and flight routes avoid long rays skimming under bases.
7. Shadow-map cadence, shaft samples, rain counts.

## Dynamic quality

When the measured GPU time stays above budget, `SkyQuality` steps down in this order, with
hysteresis and at most one change per second: far pass ½ → ¼ resolution; step cap −25 %; light
samples 6 → 3; shaft samples 64 → 32; rain −50 %; then the hardware scaling of skill
`babylon-performance`. Recovery runs in reverse order.

## WebGPU and WebGL2

| Topic | WebGPU | WebGL2 |
|---|---|---|
| Compute (light volume, density cache) | `ComputeShader` + storage textures [verified 9.29] | not available → cone light samples |
| Storage formats for compute-written volumes | `rgba16float`, `r32float`, `rgba8unorm`; `r8unorm` is no core storage format | — |
| 3D textures | yes | yes; R8, RGBA8, R16F filterable; linear filtering of R32F needs `OES_texture_float_linear` |
| Texture sampling inside loops | `textureSampleLevel` (uniform control flow rule for `textureSample`) | `textureLod` |
| Shader source | WGSL and GLSL pairs in `ShaderStore`; GLSL-only shaders make WebGPU download glslang/twgsl (skill `babylon-graphics`) | GLSL |
| GPU timing | `timestamp-query` with `enableAllFeatures` | timer-query imports (skill `babylon-game-dev`) |

## Memory

| Resource | Size |
|---|---|
| Shape noise 128³ RGBA8 / R8 | 8 MiB / 2 MiB |
| Detail noise 32³ RGBA8 | 128 KiB |
| Weather map 512² RGBA8 | 1 MiB |
| Far pass at ½ res (640×360), RGBA16F + R16F, history ping-pong | ≈ 5.5 MiB |
| Near pass at ¼ res | ≈ 0.7 MiB |
| Cloud shadow map 512² R16F | 0.5 MiB |
| Light volume 128×32×128 R16F | 1 MiB |

The sky stays below 20 MiB of GPU memory.

## Measuring the sky

- **Worst-case viewpoints:** `aboveCloudSea` looking at the horizon (long rays),
  `belowCloudBase` (glancing rays), `insideCloud` (dense near pass), `towardSun` at sunrise
  (shafts), the `storm` preset with rain.
- **Per-pass cost:** `EngineInstrumentation` reports whole-frame GPU time. Toggling one effect
  with `setEffect(name, false)` and diffing `measure(10)` isolates a pass.
- **Step heatmap:** steps per pixel as a debug view (`clouds.md`).
- The AI agent hands these viewpoints and the budget table to agent `babylon-perf-profiler`.
