# Art direction: the look of the sky world

Everything in this file is **[recommendation]** unless tagged otherwise. The developer approves
or changes the look in look-dev; the AI agent then treats the approved values as the target.

## Look target

**Stylized-physical.** Physically based light transport (atmosphere addon, volumetric clouds,
HDR chain) makes the sky believable; art-directed color, shapes and timing make it charming.
The mood is friendly, luminous and airy. It matches the bee (comic face, believable materials)
and the islands (clear base colors with normal maps, skill `babylon-islands`).

Reference mix: Ghibli skies for shapes and colors, *Sky: Children of the Light* for warm,
emotional light, *Zelda: Tears of the Kingdom* for readable sky islands, *Horizon Forbidden
West: Burning Shores* for clouds as a landscape to fly through, airplane-window photography for
scale.

## What creates the airplane-window feeling

- **A floor of clouds.** An endless, textured cloud deck below, curving into haze at the
  horizon. The deck is the "ground" of this world.
- **Readable scale.** Big billows carry smaller billows; haze separates the depth planes; the
  bee (0.58 m) and the islands (10–100 m) sit next to clouds that are ten times larger.
- **Slow parallax.** Distant cloud masses barely move while near wisps rush past.
- **Light from below.** The bright deck lights island undersides and the bee from below — a fill
  light that ground scenes never have. Setting the atmosphere's `groundAlbedo` once at startup
  to the deck's brightness (neutral ≈ 0.8) brightens the lower-hemisphere irradiance
  [source-derived: `groundAlbedo` feeds the multi-scattering LUT; changing it re-renders that
  LUT, so it is never animated].
- **Shadows on the deck.** Towers and islands cast long shadows across the deck in the morning
  and evening.
- **The glory.** A small rainbow ring around the bee's own shadow on the deck (see "Wow
  moments").

## Color script

The sky colors come from the physical atmosphere. The swatches below are targets: they drive the
grading, the cloud ambient tints, mist and haze colors, and the comparison during reviews. Phases
are defined by sun elevation (orbit and pacing: `day-night.md`). The four phases named by the
developer map as follows: **morning** = blue-dawn to morning, **noon** = noon, **evening** =
afternoon to blue-dusk, **night** = night.

| Phase | Sun elevation | Key light | Sky zenith → horizon | Shadow / fill | Cloud lit / shade | Haze and mist | Exposure (EV vs. noon) | Mood |
|---|---|---|---|---|---|---|---|---|
| night | < −12° | moon `#A9C1FF`, soft | `#0A1430` → `#1C2D57` | `#121A33` | `#93A8D6` / `#26304F` | thin, `#2A3A66` | +2.0 | calm, magical |
| blue-dawn | −12° … −2° | fading in | `#1F2E5C` → `#D49AA6` (rose in the east) | `#2A3560` | `#8C8FB8` / `#3A4170` | mist builds, `#6C7BA8` | +1.3 | hush |
| sunrise | −2° … 8° | `#FF9E5E` | `#5E86C9` → `#FFC796` | `#55689E` cool | `#FFD2A6` / `#9A8DB5` | densest; sunward `#FFD8B0`, away `#AAB8D8` | +0.7 | awakening |
| golden-morning | 8° … 20° | `#FFC48A` | `#6F9FE0` → `#FFE0B8` | `#5C76AE` | `#FFE8CC` / `#A3A8C8` | burning off | +0.3 | fresh |
| morning | 20° … 45° | `#FFF0DA` | `#5A98E6` → `#CDE6FB` | `#6383B5` | `#FCFAF5` / `#A9BAD6` | thin haze | 0 | lively |
| noon | > 45° | `#FFFBF2` | `#3F86DB` → `#BBDDFB` | `#5D7EB0` | `#FFFFFF` / `#9DB0CF` | clear | 0 | bright, playful |
| afternoon | 45° … 20° | `#FFF0D6` | `#4F8EDC` → `#C6E1F8` | `#5F7CAE` | `#FFF8EC` / `#A2B2CF` | towers grow | 0 | energetic |
| golden-evening | 20° … 8° | `#FFB56B` | `#5878C2` → `#FFC98F` | `#4E5C98` | `#FFC890` / `#8E80B0` | warm haze | +0.3 | nostalgic |
| sunset | 8° … −2° | `#FF7840` | `#33467F` → `#FF8A55` | `#3E4A80` | `#FF9A6A`, cirrus `#FF7AAE` / `#6A5A8C` | glowing | +0.7 | dramatic |
| blue-dusk | −2° … −12° | fading out | `#24356E` → `#8A6E9E` | `#262E57` | `#6F6C9A` / `#2A3157` | first stars | +1.3 | quiet |

Rules behind the script:

- **Warm key, cool fill** whenever the sun is low: the shadow side takes the sky's blue, the lit
  side the sun's orange. Complementary contrast is the main source of "beautiful light".
- **Saturation follows the sun's altitude:** strongest at sunrise and sunset, lowest at noon and
  in overcast weather.
- **Noon stays bright but not flat:** the tilted orbit keeps the sun at 60° so islands keep a
  shadow side.
- **Interpolate colors in linear RGB or OKLab**, never in sRGB or HSV (hue jumps).

## Light ratios on islands and the bee

| Situation | Key : fill | Notes |
|---|---|---|
| noon, fair | 3 : 1 – 4 : 1 | crisp but friendly shadows; fill from sky above and deck below |
| golden hours | 3 : 1 | warm key, blue-violet fill |
| overcast, rain | 1.5 : 1 | soft, cool, lower saturation |
| night | 2 : 1 | cool moon key, rim light on the bee and island edges |
| inside a cloud | ≈ 1 : 1 | diffuse; silhouettes remain readable |

## Cloud design language

- **Shapes big–medium–small.** Primary masses carry secondary billows, which carry small
  billows. A cloud of one frequency reads as a cotton ball.
- **Flat bases at a shared height per layer.** Cumulus condense at one level; flat, aligned bases
  are the strongest realism cue. A low-frequency variation of ±5–10 % keeps them from looking
  machine-made.
- **Cauliflower tops, wispy bottoms and edges.** Billowy noise where density increases, curly
  wisps where it decreases (Nubis); inverted Worley at the base gives wisps (Horizon Zero Dawn).
- **Tops lean downwind** (wind shear); storm cells end in an anvil.
- **Values:** lit tops close to white but below clipping — only silver linings blow out. Shadow
  sides keep a hue (sky blue, lavender at golden hour), never neutral gray. Bases are darker but
  lifted by the deck's bounce. The Ghibli shading rule: the shadow sits at the flat base and
  lightens up the sides.
- **Edges:** backlit edges glow (silver lining, forward scattering); front-lit edges show the
  darker "powder" rim; distant clouds get crisper edges, near clouds softer and wispier (the
  Sea of Thieves trick of sharpening far clouds by an alpha threshold works for the `low` tier).
- **Spacing:** 30–60 % of the sky stays visible in fair weather. Clouds gather in clusters with
  gaps; sight lines to the next island stay open.
- **Three depth planes** with different scale and speed: cloud deck, cumulus among the islands,
  high cirrus. The high plane moves slowest.
- **Motion:** noise scrolls with the wind ("pseudo-motion"); coverage breathes over minutes;
  nothing pops.

## Clouds around islands

Isolated mountains on Earth wear clouds as a collar around their flanks, as a cap over the peak,
or as a banner in the lee of a sharp summit (WMO cloud atlas). Floating islands borrow this
vocabulary:

| Form | Where | Look | When |
|---|---|---|---|
| Collar | thin ring around the rock body below the grass lip, or around the spires | wispy torus, partly broken | mornings, humid weather |
| Cap | small lens above a tall island or tree | smooth, lenticular, quiet | stable air, rare |
| Banner | plume trailing downwind from the hanging spires | elongated, turbulent; windward side clear | windy weather |
| Mist pocket | pooled in hollows, over ponds | flat top, dense, low | dawn |
| Spray mist | at the foot of a waterfall | fine, bright in backlight, rainbow when the sun is behind the viewer | always |

- Clouds never cut through island geometry; the medium is carved by the island shapes
  (`clouds.md`).
- The island top — the gameplay surface — stays readable; collars sit below the lip.
- All island-anchored volumes follow the wind and thin out toward noon.

## Composition and navigation

- **One far landmark:** a giant cumulonimbus or cloud tower in a fixed direction per world seed
  works as a compass.
- **Corridors:** gaps and cloud streets (rows of cumulus aligned with the wind) lead toward the
  next island; tunnels and caves in large clouds are discoverable routes — the Burning Shores
  team built clouds as "an explorable landscape".
- **Framing:** a dark foreground cloud edge, a bright island in the middle ground, hazy islands
  behind it.
- **Reveals:** a vista waits behind clouds the player is likely to fly through.
- **Restraint:** the *Tears of the Kingdom* team found that too many sky islands made the sky
  "messy" and that small islands seen from afar looked like "specks of trash". Fewer, larger
  silhouettes with clear haze separation read better.

## Readability

- The bee and the near islands always differ in value from the background behind them. Inside
  clouds the bee keeps its saturation and gets a soft rim light.
- Far islands are lighter and bluer than near ones (aerial perspective); two islands at
  different distances never share the same value.
- At night the bee's `Night` material variant (glowing rings and antenna tips) is the warm accent
  against the cool scene.

## Night

- The moon is the key light: cool, soft shadows, rim light on silhouettes.
- The sky stays brighter than the islands, so islands read as silhouettes against it.
- Stars and the Milky Way carry the beauty; moonlit cloud tops are silver, their bases dark blue.
- Warm accents come only from light sources that exist in the game (the bee's night glow).
- Targets for `frameCheck()`: mean luminance 0.10–0.20, black ratio below 0.15. Never pure
  black, never a green tint.
- Moonlight is physically about 4100 K — warmer than sunlight — but the eye sees it blue
  (Purkinje effect), and film convention paints night blue. The game follows the convention.

## Weather moods

| Weather | Contrast | Saturation | Key light | Notes |
|---|---|---|---|---|
| misty morning | low | pastel | soft, warm, strong shafts | fogbow chance |
| fair cumulus | high | high | crisp | the postcard |
| overcast | low | reduced, cool | diffuse | clouds gray-blue with visible structure, never flat gray |
| rain shower | medium | reduced | shafts through gaps | dark cells, rain curtains visible from afar; afterwards wet sparkle and rainbow |
| storm | very high | low with bright accents | dim; lightning | dark bases, bright rims, lightning reveals the inner structure |

## Wow moments

| Moment | Conditions | Rendering | Rarity |
|---|---|---|---|
| Glory and the bee's shadow on the deck | sun behind the camera, 5°–45° high; bee within ~300 m above the deck top | analytic shadow and rings in the compositor (`fog-mist.md`) | whenever conditions meet |
| Rainbow | after rain; sun below 42°; rain curtain opposite the sun | compositor (`weather.md`) | after showers |
| Fogbow | sun behind the viewer, mist ahead | compositor, white ring | mornings |
| Belt of Venus and Earth's shadow | 10–15 min after sunset / before sunrise, opposite the sun | physical twilight of the atmosphere; a subtle pink grading band if it reads too weak | daily |
| Afterglow on cirrus | after sunset | high layer lit by the transmittance at its altitude | daily with cirrus |
| Shafts through cloud gaps | low sun, broken clouds, mist | light shafts + in-medium scattering | mornings, evenings |
| Bursting out of a cloud | flight event | exposure overshoot and bloom (`flight-feel.md`) | player-driven |
| Lightning inside a tower at night | storm | in-cloud light term + flash | storms |
| Moonrise | evening | orange moon at the horizon through transmittance | daily |
| Shooting star | night | rare streak sprite | every few minutes |

## Anti-patterns

| Anti-pattern | Why it fails | Instead |
|---|---|---|
| Gray mush clouds | no hue in shadows, no value structure | sky-tinted shadows, bright tops, darker flat bases |
| Uniform blobs on a grid | reads artificial | clusters, gaps, big–medium–small |
| Clipped white clouds | detail and color gone | exposure and tone mapping keep tops below clipping |
| Banding in sky and clouds | 8-bit gradients, coarse steps | HDR chain, dithering, blue-noise jitter |
| Flat noon light | sun overhead kills form | tilted orbit, noon at 60° |
| Pitch-black night | unplayable | +2 EV, sky brighter than islands |
| Constant visible fog walls | hides the airplane-window view | haze increases with distance only; mist local and temporary |
| Too many sky objects | clutter | fewer, larger silhouettes |
| Sudden lighting pops at dusk | breaks immersion | key-light handoff at zero intensity (`day-night.md`) |

## Reference board

| Work | What to take |
|---|---|
| Studio Ghibli backgrounds (Kazuo Oga, *Castle in the Sky*) | Cloud shapes; the four-color sky palette (light and dark blue, white and gray for lit and shaded cloud); soft edges |
| *Sky: Children of the Light* (GDC "Art of Sky") | Warm emotional light, cloud seas, golden hour as reward |
| *Zelda: Tears of the Kingdom* | Readable sky islands, diving, restraint |
| *Horizon Forbidden West: Burning Shores* | Clouds as landscape with tunnels and caves; light reveals and hides features over the day |
| Albert Bierstadt (luminism) | Light between clouds and land creates space |
| *Firewatch* (Jane Ng, GDC 2015) | Distance-based gradient fog per time of day for stylized depth |
| *Sea of Thieves* | Stylized mesh clouds; crisp distant edges |
| Airplane-window photography | Cloud deck, tower shadows, glory, haze bands |
