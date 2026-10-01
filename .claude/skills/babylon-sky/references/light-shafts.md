# Light shafts: sun rays and moon rays

## Where shafts appear in this world

- Through gaps between clouds (crepuscular rays) — the main source in a sky world.
- Past island edges, hanging roots and tree crowns, into haze and mist.
- Inside mist pockets at sunrise — the signature image of the morning.
- At night: moon rays through broken clouds and mist, cool and faint.
- Opposite the sun at dusk: anticrepuscular rays converging on the antisolar point, dimmer
  because backscattering is weaker (atoptics.co.uk).

Shafts need three things at once: a low light, a partial occluder and a medium to scatter in.
The phase keyframes raise `shaftStrength` exactly when all three are likely.

## Technique choice

| Technique | Sees islands | Sees raymarched clouds | Cost | Use |
|---|---|---|---|---|
| `VolumetricLightScatteringPostProcess` | yes (meshes) | **no** | low–medium | only in tier `low`, where cloud meshes occlude it |
| Radial blur with occlusion mask (custom post-process) | yes, via depth | yes, via cloud transmittance | low–medium | default for `medium` and `high` |
| In-medium scattering in the cloud marcher | yes, via island shadow map | yes | inside the cloud budget | `high` and `ultra`, in mist and clouds |
| `FrameGraphVolumetricLightingTask` | yes, via shadow map | **no** | high (~50 fps in the test scene of skill `babylon-graphics`) | not with volumetric clouds |

VLS renders its own occlusion pass from meshes [verified 9.29: `mesh`, `excludedMeshes`,
`includedMeshes` are its inputs]; a raymarched cloud is not a mesh, so rays would shine
straight through it.

## Radial blur with a cloud mask [reference]

Screen-space light scattering after *GPU Gems 3*, chapter 13 (Mitchell), with an occlusion image
that knows the clouds:

1. **Occlusion image** (½ resolution):
   `occ = skyMask(depth) · T_view · smoothstep(maxAngle, 0, angleToLight)`. `skyMask` is 1 where
   the depth is the far plane, `T_view` is the cloud transmittance from the cloud pass, and the
   angular term limits the source to the sky around the light.
2. **Radial gather:** each pixel walks toward the light's screen position, accumulating `occ`
   with geometric decay.
3. **Color:** times light0's color and intensity (for the moon also the moon tint), the phase's
   `shaftStrength` and an on-screen fade.
4. **Blend:** added to the HDR image before bloom and tone mapping — a camera post-process ahead
   of the `DefaultRenderingPipeline`, `TEXTURETYPE_HALF_FLOAT` (skill `babylon-graphics`).

```glsl
uniform sampler2D occlusionSampler; // ½ res: sky mask × cloud transmittance × angular falloff
uniform vec2 lightUV; // screen position of the sun or the moon
uniform vec3 shaftColor; // light color × intensity × shaftStrength × on-screen fade
uniform float density; // 0.85–1.0, fraction of the way to the light
uniform float decay; // 0.94–0.97
uniform float weight; // 0.02–0.05
uniform float exposure;

// Gathers occlusion along the line toward the light (Lichtstrahlen sammeln).
vec3 lightShafts(vec2 uv, float jitter) {
  const int SAMPLES = 48;
  vec2 delta = (lightUV - uv) * density / float(SAMPLES);
  vec2 coord = uv + delta * jitter; // blue-noise start offset removes banding
  float illumination = 1.0;
  float sum = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    sum += textureLod(occlusionSampler, coord, 0.0).r * illumination * weight;
    illumination *= decay;
    coord += delta;
  }
  return shaftColor * sum * exposure;
}
```

- **Light behind the camera:** the projected position flips; the shaft pass checks the clip-space
  `w` of the light direction and fades to zero.
- **Light off screen:** fade out while `lightUV` leaves the range −0.2 … 1.2.
- **Inside the medium** screen-space shafts are wrong; their strength fades with
  `cameraCloudDensity`, and the marcher's own scattering takes over.

## Per-phase parameters [recommendation]

| Phase | Source | `shaftStrength` | `density` | `decay` | Note |
|---|---|---|---|---|---|
| sunrise, sunset | sun | 1.0 | 1.0 | 0.97 | long, warm |
| golden hours | sun | 0.6–0.8 | 0.95 | 0.96 | — |
| morning, afternoon | sun | 0.2–0.3 | 0.9 | 0.95 | subtle |
| noon | sun | 0.1 | 0.85 | 0.94 | the sun is rarely on screen |
| night | moon | 0.3 | 0.95 | 0.96 | moon tint, scaled by moon brightness |

Weather modifiers: rain shower × 1.5 (gaps between dark cells), misty morning × 1.3, overcast ×
0.3. Samples: 32 (`medium`), 64 (`high`).

## In-medium shafts

Inside mist volumes and clouds the marcher creates real volumetric shafts by itself: its light
samples include cloud self-shadowing, the cloud shadow map and — in `high` and `ultra` — the
island shadow map. Morning mist under an island edge then shows rays from the actual geometry.
The radial blur and the marcher's haze glow both brighten toward the sun; the AI agent tunes
them together so the sky around the sun does not double up.

## Pitfalls

| Pitfall | Fix |
|---|---|
| Rays through clouds | radial blur with `T_view` in the occlusion image, never VLS with raymarched clouds |
| Banding in the rays | blue-noise start offset, HDR target, dithering in image processing |
| Rays at noon look artificial | strength follows the phase keyframes |
| Rays pop when the sun leaves the screen | on-screen fade, behind-camera check |
| Full-resolution cost | occlusion and gather at ½ resolution, bilinear upsample (shafts are soft) |
