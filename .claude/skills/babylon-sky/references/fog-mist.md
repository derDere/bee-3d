# Fog and mist

## Kinds of fog in a groundless world

| Kind | Where | Technique |
|---|---|---|
| Aerial haze | everywhere, grows with distance | atmosphere aerial perspective (PBR plugin; clouds via the AP LUT) |
| Height haze | thickest just above the deck, thinning upward | analytic exponential height fog, integrated in the cloud marcher |
| Cloud deck | below the islands | cloud medium (`clouds.md`) |
| Mist pockets, collars, spray mist | at islands | authored volumes in the cloud medium |
| Abyss fog | below the deck | analytic, opaque within 200–500 m below the deck top |
| Near-camera mist | around the camera in and near mist | soft sprites in rendering group 1 |
| In-cloud view | camera inside the medium | the marcher itself plus a screen treatment (`flight-feel.md`) |

`scene.fogMode` is never used: scene fog hits meshes but not the atmosphere sky and breaks the
horizon (skill `babylon-graphics`, pitfall 11).

## The morning script [recommendation]

Radiation fog forms in clear, calm nights under a temperature inversion, is densest around
sunrise and dissipates from the bottom up as the sun warms the air; stratiform clouds peak in the
morning, cumulus in the afternoon (NAV CANADA, Eastman & Warren 2014). The sky world translates
that into keyframe values (`day-night.md`):

| Phase | Deck top offset | `mistAmount` | Haze base density ρ₀ | `shaftStrength` | Picture |
|---|---|---|---|---|---|
| night | 0 m | 0.3, rising | 0.0004 m⁻¹ | 0.3 (moon) | mist gathers in hollows |
| blue-dawn | +20 m | 0.8 | 0.0015 m⁻¹ | — | flat, cool, silent |
| sunrise | +30 m | 1.0 | 0.0020 m⁻¹ | 1.0 | island undersides dip into the deck; shafts through mist; fogbow chance |
| golden-morning | +20 m | 0.7 | 0.0012 m⁻¹ | 0.8 | mist lifts off the deck as wisps |
| morning | 0 m | 0.2 | 0.0005 m⁻¹ | 0.3 | first cumulus |
| noon | −10 m | 0 | 0.00015 m⁻¹ | 0.1 | crisp air |
| afternoon | −10 m | 0 | 0.0002 m⁻¹ | 0.2 | towers grow |
| golden-evening | 0 m | 0.1 | 0.0006 m⁻¹ | 0.6 | warm glowing haze |
| sunset | 0 m | 0.2 | 0.0008 m⁻¹ | 0.8 | — |
| blue-dusk | +10 m | 0.4 | 0.0006 m⁻¹ | — | mist returns |

Visibility follows `V ≈ 3.9 / ρ`: 0.002 m⁻¹ ≈ 2 km, 0.00015 m⁻¹ ≈ 26 km. The misty-morning
weather preset multiplies density by about 3; wind above 6 m/s halves it (wind disperses
radiation fog).

## Analytic height haze

Density `ρ(h) = ρ₀ · e^(−k (h − h₀))`, base height `h₀` = deck top, falloff `k ≈ 0.008 m⁻¹`
(halves every ~85 m). The optical depth of a ray segment has a closed form; a numeric check
against brute-force integration showed relative errors below 1e−9 for upward, downward,
near-horizontal and below-base rays.

```glsl
// Optical depth of exponential height haze along a ray segment (Höhendunst).
float hazeOpticalDepth(float originY, float dirY, float segmentLength, float density, float falloff, float baseHeight) {
  float start = density * exp(-falloff * (originY - baseHeight));
  float x = falloff * dirY * segmentLength;
  float shape = abs(x) < 1e-4 ? 1.0 - 0.5 * x : (1.0 - exp(-x)) / x; // series limit for near-horizontal rays
  return start * segmentLength * shape;
}

// Color scattered into a haze segment, art-directed like Unreal's directional inscattering (Dunstfarbe).
vec3 hazeInscatter(float opticalDepth, float mu, vec3 colorAway, vec3 colorSunward, float exponent, float lightScale) {
  vec3 color = colorAway + (colorSunward - colorAway) * pow(clamp(mu, 0.0, 1.0), exponent);
  return (1.0 - exp(-opticalDepth)) * color * lightScale;
}
```

- `mu = dot(viewDir, toLight)`; exponent 6–12 (8 in the morning) puts a glow around the sun.
- **Inside the marcher** each step adds the segment's haze extinction and in-scattering to the
  cloud integration — haze and clouds then occlude each other correctly.
- **Beyond the march** the compositor adds the remaining segment up to the scene depth. Sky
  pixels get haze only up to a haze range of 6–15 km, so it does not double the atmosphere's
  own scattering.
- The sunward color is multiplied by the cloud-shadow transmittance at the camera — a coarse
  term; real shafts come from the marcher and the radial blur.

## Mist volumes at islands

- Authored primitives from `clouds.md`, density × `mistAmount`. Placement: hollows and ponds
  (pockets), under the grass lip (collars), waterfall feet (spray mist, at every hour),
  downwind of spires (banners).
- Mist is thinner than cloud: σt 0.005–0.02 m⁻¹, large softness, wispy detail type.
- Inside mist, the marcher's own light sampling (cloud shadow map, island shadow map) produces
  true shafts between island edges and through gaps — the signature sunrise image. The step
  heatmap shows whether those regions stay inside the step budget.

## Cloud deck and abyss

- The deck is part of the cloud medium (`clouds.md`).
- The atmosphere addon draws an opaque planet ground below the horizon [source-derived]. The
  abyss fog makes every ray that passes below the deck opaque within 200–500 m:
  `ρ_abyss(h) = ρ_a · e^(k_a · (deckTop − h))`, integrated analytically like the haze.
- Its color follows the time of day: blue-gray deck-underside light by day (`#5D6E8F`), deep
  navy at night. Gaps in the deck then show depth instead of land.

## Near-camera mist sprites

- A camera-attached particle volume (20–60 m box) whose emission follows the medium density at
  the camera (CPU evaluator, `flight-feel.md`) and `mistAmount`.
- Sprites 2–8 m, alpha 0.03–0.1, color from haze and ambient; six-way lit sprites read as
  volumetric under side light.
- Babylon particles have no soft-particle depth fade [verified 9.29]: a custom particle effect
  fades against the depth texture, or emission keeps sprites away from geometry.
- Stretched along relative velocity while flying (`ParticleSystem.BILLBOARDMODE_STRETCHED`
  [verified 9.29]).
- Rendering group 1, in front of the cloud compositor.

## Optical moments in fog [recommendation]

### Fogbow

- **Conditions:** sun behind the viewer, sun below 40°, mist or cloud ahead.
- **Look:** a broad, almost white ring of about 38–41° radius around the antisolar point, 4–8°
  wide, faint red outer and blue inner edge.
- **Render** in the compositor: `alpha = acos(dot(viewDir, -toSun))`; a band
  `smoothstep(r - w, r, alpha) · (1 - smoothstep(r, r + w, alpha))`, times cloud opacity
  `1 − T` in that pixel, times sun visibility.

### Glory and the bee's shadow (Brocken spectre)

- **Conditions:** sun behind the camera at 5–45°, the bee within ~300 m above the deck top, the
  antisolar point on the deck and in view.
- **Shadow:** the bee's shadow center on the deck top is
  `P = bee − toSun · (bee.y − deckTop) / toSun.y`. A blurred, perspective-stretched ellipse at
  `P` darkens the deck's in-scattered light; its penumbra grows with the bee's height.
- **Rings:** centered on the antisolar direction (the third-person camera is 1–8 m from the bee,
  so the bee's shadow sits next to it). Two to three rings at about 2.5°, 4.5° and 6.5°, red
  outside, blue inside, each fainter than the last, only on cloud pixels, at 0.1–0.3 of the
  cloud radiance.
- Real glories measure 5–20° depending on droplet size; a smaller glory hugs the bee's shadow
  and reads better.
