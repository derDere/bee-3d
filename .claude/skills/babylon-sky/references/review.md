# Reviewing the sky

Agent `babylon-sky-reviewer` runs this protocol; the AI agent in the main context can run single
steps of it for a quick check. Browser handling, the screenshot protocol and the general look-dev
checklist come from skill `babylon-visual-qa`. All thresholds are starting heuristics
**[recommendation]**; once the developer approves a look, the approved frames set the targets.

## Protocol

1. **Setup** as in skill `babylon-visual-qa`: own page, wait for `__game.ready`, console check,
   WebGPU and `gpuInfo().isSoftware === false`.
2. **Capabilities:** `__game.sky` must exist; read `listWeathers()`, `listViewpoints()` and
   `listEffects()`. Missing Debug API parts are reported as a finding, and the review continues
   with what exists.
3. **Phase sweep (stills):** `pause()`, weather `fair` (or the caller's choice), then for each
   phase set the hours (phase hours in `day-night.md`), `waitFrames(30)` for temporal effects to
   converge, `skyState()`, `frameCheck()`, screenshot. Viewpoint `aboveCloudSea` for every phase;
   `islandBand` and `towardSun` for sunrise, noon, sunset and night.
4. **Handoff probe (numbers only):** solar time 18:30 → 21:00 and 03:00 → 05:30 in steps of five
   solar minutes; per step `setTimeOfDay`, `waitFrames(5)`, `frameCheck()` and `skyState()`.
5. **Weather sweep:** at noon and at golden-evening, each preset with `setWeather(name, 0)`,
   `waitFrames(60)`, one screenshot. One transition with `setWeather(name, 10)`: `frameCheck()`
   every second, no screenshot.
6. **Fly-through:** viewpoint in front of a cloud, `resume()`, `simulateInput({ forward: 1 }, n)`
   in short segments; read `skyState().cameraCloudDensity` and `frameCheck()` per segment;
   screenshots before, inside and after the cloud, plus one taken while moving (smearing and
   ghosting only show in motion).
7. **Isolation on request:** `setEffect(name, false)` / `true` with a screenshot each for
   before/after comparisons.
8. **Fallback:** one viewpoint at noon and at golden-evening with `?engine=webgl2`.
9. **Performance snapshot:** `stats()` per weather preset. Detailed measurement belongs to agent
   `babylon-perf-profiler` and never runs in parallel with a review.

Screenshot budget: 24 per run unless the caller sets another.

## Checklist

1. **Color script** (`art-direction.md`): the phase reads as intended; warm key and cool fill at
   low sun; saturation follows the sun's altitude; night is deep blue, never black.
2. **Sky and horizon:** no horizon break; the deck and abyss fog cover every downward view; no
   planet ground anywhere; haze grows with distance; far islands lighter and bluer than near ones.
3. **Cloud shapes:** big–medium–small; flat bases per layer; cauliflower tops; wisps at bases
   and edges; no visible tiling; clusters with gaps instead of an even grid.
4. **Cloud light:** silver lining toward the sun; darker powder rims with the sun behind the
   viewer; shadow sides hued, never neutral gray; bases lifted by the deck's bounce; tops below
   clipping; golden tops at sunset; cirrus afterglow after sunset.
5. **Cloud technique:** no banding or stepping, no noise in stills, no halos around island
   silhouettes, no seams between near and far pass or between deck volume and far field, no
   cloud inside island geometry, no ghosting in the moving screenshot.
6. **Islands and clouds:** cloud shadows on islands match the clouds above; island shadows lie on
   the deck; collars, caps and banners sit plausibly and follow the wind; mist pools in hollows at
   dawn and is gone by noon.
7. **Celestial:** sun and moon redden near the horizon; stars vanish by day and fade toward the
   horizon; clouds occlude sun, moon and stars; the moon's lit side faces the sun's direction.
8. **Shafts:** only where low light, occluder and medium meet; through gaps, never through solid
   clouds; no banding; fading when the light leaves the screen; strength per phase.
9. **Fog and mist:** morning mist density and burn-off follow the script; visibility inside a
   cloud stays at 20 m or more.
10. **Weather:** each preset has its own mood; transitions without pops; rain streaks follow the
    relative velocity while flying; no rain under islands; lightning respects the flash limit;
    rainbow at ~42° with red outside.
11. **Transitions:** no pops in the handoff windows; exposure changes stay smooth.
12. **Cost:** frame time within the sky budget of `performance.md` for the active tier.

## Numeric thresholds

| Check | Threshold |
|---|---|
| Night `frameCheck()` | mean luminance 0.10–0.20, black ratio < 0.15 |
| Noon `frameCheck()` | mean luminance 0.45–0.65, white ratio < 0.05 (< 0.3 toward the sun) |
| Handoff probe | mean-luminance change < 0.05 between neighboring samples |
| Weather transition | mean-luminance change < 0.05 per second |
| Inside a cloud | standard deviation of luminance ≥ 0.02 (no blank white frame) |
| `cameraCloudDensity` | rises when entering and falls when leaving; 0 in clear air |

## Report

1. **Environment:** URL, engine, tier, canvas size, FPS snapshot, Debug API capabilities.
2. **Console:** errors and warnings, shortened, with source.
3. **Findings by severity** — *critical* (broken, wrong), *clear* (looks cheap or inconsistent),
   *polish*. Per finding: phase, weather, viewpoint and image region; observation; likely cause
   with code location; a concrete change naming the parameter and the reference file section
   (e.g. "`shaftStrength` for sunrise 0.6 → 1.0, `day-night.md` keyframes").
4. **What already convinces** — so it survives the next iteration.
5. **For the developer to view:** motion, flight feel, transitions, temporal artifacts and sound —
   everything stills cannot show.
