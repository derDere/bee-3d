# Flight feel: flying through clouds and air

Everything here is **[recommendation]**; the developer judges the result in a live browser
session, because still images do not show motion.

## Why flight feels fast or slow

Speed is read from things moving close to the camera. Empty sky looks slow no matter how fast
the bee flies; space games have added "space dust" around the camera since the 1990s for this
reason. Large distant clouds carry scale, not speed. The sky world therefore needs near
references: wisps, mist sprites, motes, floating rocks, cloud edges, island flanks.

## Camera-density evaluator

`FlightAtmosphereFx` needs the medium density at the camera every frame. The game evaluates the
same density function on the CPU, from the same noise arrays it uploads to `RawTexture3D` and the
same parameters, at the camera and slightly ahead of the bee. This avoids GPU readback latency;
a few dozen trilinear lookups per frame cost nothing measurable. A parity test keeps CPU and
shader in line (`clouds.md`, "Tests"). The value, smoothed (rise 0.15 s, fall 0.3 s), is
`cameraCloudDensity` in the Debug API.

## Flying through a cloud

| Stage | Trigger | Picture | Sound | Camera |
|---|---|---|---|---|
| Approach | cloud surface within ~40 m | near-detail noise sharpens the surface; wisps streak past; shafts brightest at the edge | proximity whoosh | — |
| Edge | density rising | the marcher fogs the view; −0.3 EV, saturation −20 %, slightly cooler | high frequencies roll off | light turbulence shake (2–5 cm) |
| Inside | density high | visibility capped at ≥ 20 m; bright diffuse light, brighter toward the sun; island silhouettes stay faintly visible; the bee keeps a rim light | muffled bed, wing buzz in front | FOV −2° |
| Exit | density falling | light bursts back: +0.4 EV overshoot decaying over 0.6 s, bloom; wisps trail behind the bee; a vista opens | the filter opens, the wind swells | FOV returns with a small kick |

- **Comfort:** a full whiteout of more than about one second disorients. The medium's density
  near the camera is lowered (Nubis³ does this to fight undersampling; here it also keeps
  ≥ 20 m visibility), and the direction of the sun stays visible as a brighter side.
- **Reward:** routes put a reveal — an island, a tower, the sunrise — behind clouds the player
  is likely to cross.

## Speed cues

| Cue | Rule | Start value |
|---|---|---|
| Field of view | widens with speed, smoothed | 65° vertical, +8° at top speed, time constant 0.3 s |
| Near particles | camera-attached volume of motes and wisps, stretched along relative velocity | 200–600 sprites, 2–30 m from the camera |
| Motion blur | camera-based, only at high speed | `MotionBlurPostProcess`, `isObjectBased = false`, strength 0.3–0.5 (skill `babylon-graphics`) |
| Camera lag and roll | the camera trails and banks into turns | roll 5–12° |
| Wind audio | pitch and volume follow speed | — |
| Proximity | flight paths pass close to cloud edges and island flanks | strongest speed impression |

## Altitude and scale cues

- The cloud deck below, with the shadows of islands and towers on it, gives "height above
  ground".
- The bee's shadow and the glory on the deck show the bee's own height (`fog-mist.md`).
- Aerial perspective: far islands bluer and lighter, clouds 2–3 km away soft in haze.
- Objects of known size near the bee: flowers, floating rocks.
- Diving toward the deck, its texture grows and the haze thickens — altitude reads without a
  HUD.

## Audio

| Layer | Driver |
|---|---|
| Wind bed | speed, altitude |
| Proximity whoosh | distance to cloud surfaces and islands ahead of the bee |
| In-cloud muffle | low-pass filter by `cameraCloudDensity` |
| Rain, thunder | weather (`weather.md`) |
| Ambience per phase | dawn, day, dusk and night beds cross-fading with the keyframes |

Audio runs on AudioEngineV2 (skill `babylon-gameplay`); the AI agent verifies the filter API
against the installed typings.

## Options

Field-of-view kick, motion blur, camera shake and lightning flashes each get a switch in the
settings. Exposure changes stay below 1 EV per second except for the exit overshoot.
