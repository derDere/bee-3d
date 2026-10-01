# Sources

What each source contributes to this skill. Retrieved October 2026.

## Volumetric clouds

| Source | Contribution |
|---|---|
| A. Schneider, [*The Real-time Volumetric Cloudscapes of Horizon: Zero Dawn*](https://advances.realtimerendering.com/s2015/The%20Real-time%20Volumetric%20Cloudscapes%20of%20Horizon%20-%20Zero%20Dawn%20-%20ARTR.pdf), SIGGRAPH 2015 Advances | Noise textures (128³ Perlin–Worley + Worley, 32³ Worley, 128² curl), weather map channels, height gradients per type, Beer–Powder, 6-sample light cone, cheap/full samples, 64–128 steps, 1/16-pixel reprojection, ~2 ms on PS4 |
| A. Schneider, [*Nubis: Authoring Real-Time Volumetric Cloudscapes with the Decima Engine*](https://advances.realtimerendering.com/s2017/Nubis%20-%20Authoring%20Realtime%20Volumetric%20Cloudscapes%20with%20the%20Decima%20Engine%20-%20Final%20.pdf), SIGGRAPH 2017 Advances | Authoring and animation of cloudscapes |
| A. Schneider, *Real-Time Volumetric Cloudscapes*, GPU Pro 7 (2016) | The density formulas reimplemented in `clouds.md` |
| A. Schneider, *Nubis, Evolved*, SIGGRAPH 2022 Advances | Envelope clouds for flight, cone and distance step mapping (4.2 → 1.3 ms) |
| A. Schneider, [*Nubis, Cubed*](https://d3d3g8mu99pzk9.cloudfront.net/AndrewSchneider/Nubis%20Cubed.pdf), SIGGRAPH 2023 Advances | Fly-through clouds: near detail by folded noise, SDF + adaptive steps, animated vs static jitter, near/far resolution split, light voxel grid, ambient and multi-scatter approximations, costs on PS5 |
| S. Hillaire, [*Physically Based Sky, Atmosphere and Cloud Rendering in Frostbite*](https://media.contentapi.ea.com/content/dam/eacom/frostbite/files/s2016_pbs_frostbite_sky_clouds.pdf), SIGGRAPH 2016 PBS course | Weather and cloud-type textures, single-channel noise, energy-conserving integration, dual-lobe phase, multi-scattering octaves, aerial perspective via mean cloud depth, cloud shadow maps, moon and star data, Xbox One costs |
| M. Wrenninge, C. Kulla, V. Lundqvist, *Oz: The Great and Volumetric*, SIGGRAPH 2013 Talks | Multiple-scattering octave approximation (via Frostbite) |
| N. Ang et al., [*The Technical Art of Sea of Thieves*](https://history.siggraph.org/wp-content/uploads/2022/09/2018-Talks-Ang_The-Technical-Art-of-Sea-of-Thieves.pdf), SIGGRAPH 2018 Talks | Mesh clouds without raymarching, quarter-res blur, crisp distant edges, wrap-around cloud field, pressure zones |
| H. and W. Bahnassi, *Volumetric Clouds and Mega-Particles*, ShaderX5 (2007) | Basis of the mesh-cloud approach |
| [takram three-clouds README](https://github.com/takram-design-engineering/three-geospatial/blob/main/packages/clouds/README.md) | Browser implementation: passes, layer parameters, phase and powder values, Beer shadow maps, temporal upscaling to 1/16 texels and its ghosting, device frame rates |
| [weBIGeo Clouds](https://www.webindex.page/project/webigeo-clouds) ([source](https://github.com/Qendolin/webigeo-clouds)), TU Wien 2026 | WebGPU clouds: half-res pass, IGN + R1 jitter, TAAU with mean depth and variance clipping in optical-depth space, three-term phase, 2.25 ms peak |
| [jeantimex/procedural-clouds](https://github.com/jeantimex/procedural-clouds) (MIT) | WebGPU compute-filled 3D density cache plus fragment raymarch |
| M. Heckel, [*Real-time dreamy Cloudscapes with Volumetric Raymarching*](https://blog.maximeheckel.com/posts/real-time-cloudscapes-with-volumetric-raymarching/) | WebGL tutorial: blue-noise jitter, cheap directional-derivative lighting |
| [Volumetric cloud resource list](https://gist.github.com/pixelsnafu/e3904c49cbd8ff52cb53d95ceda3980e) | Further papers, theses and open implementations |

## Atmosphere, fog, light shafts

| Source | Contribution |
|---|---|
| Babylon.js [atmosphere addon documentation](https://raw.githubusercontent.com/BabylonJS/Documentation/master/content/addons/atmosphere.md) and source (`packages/dev/addons/src/atmosphere/`) | Light0 handling, transmittance horizon fade, setter costs, compositor blending, AP LUT layout, night via minimum multiple scattering |
| S. Hillaire, *A Scalable and Production Ready Sky and Atmosphere Rendering Technique*, EGSR 2020 ([publications](https://sebh.github.io/publications/)) | LUT structure (transmittance, multiple scattering, sky view, aerial perspective) of physically based skies |
| B. Wronski, *Volumetric Fog*, SIGGRAPH 2014 Advances ([publications](https://bartwronski.com/publications/)) | Froxel fog and god rays from shadow maps |
| S. Hillaire, *Physically-based & Unified Volumetric Rendering in Frostbite*, [SIGGRAPH 2015 Advances](https://advances.realtimerendering.com/s2015/) | Unified participating media |
| K. Mitchell, [*Volumetric Light Scattering as a Post-Process*](https://developer.nvidia.com/gpugems/gpugems3/part-ii-light-and-shadows/chapter-13-volumetric-light-scattering-post-process), GPU Gems 3, ch. 13 | Radial-blur light shafts |
| [Unreal Engine: Exponential Height Fog](https://dev.epicgames.com/documentation/unreal-engine/exponential-height-fog-user-guide) | Analytic height fog and directional inscattering for art control |
| F. Bauer, *Creating the Atmospheric World of Red Dead Redemption 2*, [SIGGRAPH 2019 Advances](https://advances.realtimerendering.com/s2019/index.htm) | Integrated sky, clouds, fog and weather pipeline over 24 hours |
| Jane Ng, *The Art of Firewatch*, GDC 2015; [Firewatch multi-colored fog](https://halisavakis.com/my-take-on-shaders-firewatch-multi-colored-fog/) | Distance-based gradient fog per time of day |

## Weather, rain, lightning

| Source | Contribution |
|---|---|
| [fxguide: Game environments, part B — rain](https://www.fxguide.com/fxfeatured/game-environments-partb/) (*Remember Me*) | Camera-linked rain layers, streak textures, top-down occlusion map, splashes, lens drops |
| T. Reed, B. Wyvill, *Visual Simulation of Lightning*, SIGGRAPH 1994 | Bolt generation |
| [Volumetric clouds and weather effects in modern games](https://app.cinevva.com/blog/2026-05-04-volumetric-clouds-and-weather) (cinevva, 2026) | Overview: layering costs, wet materials, lightning timing, transition lengths, coupled systems |
| [WCAG 2.3.1 Three Flashes or Below Threshold](https://www.w3.org/WAI/WCAG21/Understanding/three-flashes-or-below-threshold.html) | Flash limit for lightning |

## Art direction and flight

| Source | Contribution |
|---|---|
| [Ask the Developer Vol. 9: Tears of the Kingdom](https://www.nintendo.com/us/whatsnew/ask-the-developer-vol-9-the-legend-of-zelda-tears-of-the-kingdom-part-3/); [Game Developer summary](https://www.gamedeveloper.com/production/zelda-devs-originally-made-sky-islands-look-like-specks-of-trash) | Sky islands as "specks of trash", too many islands make the sky messy, verticality, diving |
| [PlayStation Blog: next-level clouds in Burning Shores](https://blog.playstation.com/2023/03/29/pushing-the-envelope-achieving-next-level-clouds-in-horizon-forbidden-west-burning-shores/) | Clouds as explorable landscape, luminism, light revealing features over the day |
| [GDC Vault: Art of *Sky: Children of the Light*](https://gdcvault.com/play/1026903/Art-of-Sky-Children-of) | Emotional, warm light as studio philosophy |
| [Gurney Journey: Painting in the Ghibli Style](https://gurneyjourney.blogspot.com/2018/05/painting-in-ghibli-style.html) | Four-color sky palette, soft edges |
| [Chris Brejon, CG Cinematography ch. 4](https://chrisbrejon.com/cg-cinematography/chapter-4-light-categories/) | Sun at low angles, moonlight temperature, art-directed light |
| [Filmmakers Academy: cinematic moonlight](https://www.filmmakersacademy.com/blog-cinematic-moonlight-guide/) | Blue moonlight convention, day-for-night, backlight halos |
| [E. Couvignou: Adding the feeling of speed](https://elliotdev.gg/adding-the-feeling-of-speed/) | FOV, near particles, camera effects for speed |
| [Zelda Dungeon: time in Breath of the Wild](https://www.zeldadungeon.net/the-passage-of-time-in-breath-of-the-wild-is-one-minute-per-every-real-life/) | 24-minute day reference |

## Optics and meteorology

| Source | Contribution |
|---|---|
| atoptics.co.uk: [Brocken spectre](https://www.atoptics.co.uk/blog/brocken-spectre/), [antisolar point](https://www.atoptics.co.uk/blog/the-antisolar-point/), [anticrepuscular rays](https://atoptics.co.uk/blog/anticrepuscular-rays/), [Belt of Venus](https://atoptics.co.uk/blog/opod-belt-of-venus-2/) | Conditions and geometry of the wow moments |
| Wikipedia: [Glory](https://en.wikipedia.org/wiki/Glory_(optical_phenomenon)), [Fog bow](https://en.wikipedia.org/wiki/Fog_bow), [Belt of Venus](https://en.wikipedia.org/wiki/Belt_of_Venus), [Purkinje effect](https://en.wikipedia.org/wiki/Purkinje_effect) | Ring sizes, colors, droplet sizes, night color perception |
| WMO Cloud Atlas: [cumulus remarks](https://cloudatlas.wmo.int/en/explanatory-remarks-and-special-clouds-cumulus.html), [orographic influences](https://cloudatlas.wmo.int/en/orographic-influences-on-the-windward-side.html) | Diurnal cumulus cycle; collar and cap clouds |
| [AMS Glossary: banner cloud](https://glossary.ametsoc.org/wiki/banner-cloud/) | Banner clouds in the lee of peaks |
| R. Eastman, S. Warren, [*Diurnal Cycles of Cumulus, Cumulonimbus, Stratus, Stratocumulus, and Fog*](https://journals.ametsoc.org/view/journals/clim/27/6/jcli-d-13-00352.1.xml), J. Climate 2014 | Stratiform clouds peak in the morning, cumuliform in the afternoon |
| [NAV CANADA: radiation fog](https://avmet.navcanada.ca/en/radiation-fog.aspx) | Fog formation at night, bottom-up dissipation after sunrise |

## Assets and tools

| Source | License | Use |
|---|---|---|
| [NASA SVS Deep Star Maps 2020](https://svs.gsfc.nasa.gov/4851) | public domain (NASA SVS) | star panorama |
| [NASA CGI Moon Kit](https://svs.gsfc.nasa.gov/4720) | public domain (NASA SVS) | moon albedo and displacement |
| [Free blue noise textures](https://momentsingraphics.de/BlueNoise.html) (Christoph Peters) | CC0 | ray jitter, dithering |
| [sebh/TileableVolumeNoise](https://github.com/sebh/TileableVolumeNoise) | MIT | reference for tileable Perlin and Worley volumes |
| [Unity six-way lighting](https://unity.com/blog/engine-platform/realistic-smoke-with-6-way-lighting-in-vfx-graph) | CC0 texture library | lit cloud and mist sprites |

Asset licenses go into `docs/assets.md` when an asset enters the game (skill `babylon-assets`).
