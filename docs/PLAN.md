# PixelJaipur — Phased Build Plan

Nov 18, 2026 · @Gaurang

## Vision and scope

PixelJaipur is a hand-built, living isometric pixel diorama of Jaipur's walled Pink City. It starts with one block around Hawa Mahal and grows outward phase by phase until it is good enough to submit to isometriccities.com.

**What makes it different.** Most maps in the directory are AI-drawn tiles of a whole city. PixelJaipur goes the other way: a small area with deep detail that you can watch, hear and play with. Real sunrise and sunset, bazaar sounds, autos and camels, kites in January, and history you can scrub through.

**Learning goals**

- 3D in the browser: three.js, orthographic cameras, shaders, a pixel-art post-process
- Turning real map data into a scene: OpenStreetMap footprints and roads
- Procedural generation: shop-houses, arcades and jharokha windows from rules
- Game-style systems: agents on paths, a day cycle, spatial audio
- Working well with Claude Code: CLAUDE.md, plan mode, small phased commits

**Out of scope for now:** greater Jaipur outside the walls (except the forts in Phase 4), user accounts, and a backend. Everything runs as a static site.

## Tech stack and repo setup

The recommendation is a three.js "pixel diorama". You build real 3D geometry, render it through an orthographic isometric camera into a small render target, and scale it up with nearest-neighbour filtering. That gives you a pixel-art look while lighting, shadows and the day cycle come for free.

| Layer | Choice | Why |
| --- | --- | --- |
| Build | Vite + TypeScript | Fast reload, typed code Claude Code can refactor safely |
| Rendering | three.js, OrthographicCamera, low-res WebGLRenderTarget | Real lighting and shadows with a pixel look |
| Map data | OpenStreetMap via Overpass API, exported to GeoJSON | Free, editable, good building and road coverage |
| Data scripts | Python with uv (shapely, pyproj) | Clean projection from lat/long to local metres |
| Sun and time | suncalc (JS) | Real Jaipur sun position, no API key |
| Audio | Web Audio API, or Howler.js for the first pass | Positional ambient sound zones |
| Live weather | Open-Meteo (free, no key) | Haze, rain and wind in the scene |
| Tests | Vitest for logic, Playwright for screenshot checks | Lets Claude Code verify visuals on its own |
| Hosting | Cloudflare Pages | Free static hosting, custom domain |

**Repo layout**

```
pixeljaipur/
  CLAUDE.md            goals, palette, commands, conventions
  docs/PLAN.md         this plan, exported as Markdown
  docs/DECISIONS.md    one line per decision
  data/raw/            Overpass extracts (not hand-edited)
  data/build/          projected GeoJSON the app loads
  scripts/             fetch_osm.py, project.py, heights.py
  src/
    main.ts
    render/            camera, pixel pass, palette shader
    world/             ground, roads, buildings, generators
    landmarks/         hawaMahal.ts, jantarMantar.ts …
    actors/            autos, camels, people, birds, kites
    sky/               sun, day cycle, weather
    audio/             sound zones, mixer
    ui/                controls, URL state, postcard export
  public/assets/       textures, audio (with LICENSES.md)
  tests/
```

**Conventions for Claude Code (put these in CLAUDE.md)**

- One phase per branch and a small commit per task. Use plan mode before each phase.
- All colours come from `src/render/palette.ts`. No inline hex values.
- World units are metres, and 1 pixel at default zoom is about 0.5 m.
- Every new asset gets a line in `public/assets/LICENSES.md`.
- After visual changes, run the Playwright screenshot script and look at the PNG before calling the task done.

## Phase 0 — Foundations (about 1 weekend)

Goal: a scaffolded repo, a locked palette and a data extract for the first block, so Phase 1 is pure building.

**Background to keep handy (from memory, so verify before publishing)**

- Founded in 1727 by Sawai Jai Singh II and planned by Vidyadhar Bhattacharya on a grid of rectangular blocks.
- Painted pink (terracotta) in 1876 to welcome the Prince of Wales.
- Hawa Mahal was built in 1799. Its five-storey screen has 953 small jharokha windows.
- Jantar Mantar's Samrat Yantra is one of the world's largest sundials. The walled city is a UNESCO World Heritage Site.

**Tasks**

- [ ] Create the repo, Vite + TS + three.js scaffold, CLAUDE.md and docs/PLAN.md
- [ ] Define the Phase 1 boundary as a GeoJSON polygon: Badi Chaupar square, the Hawa Mahal frontage and about 200 m of Johari Bazaar
- [ ] Write `scripts/fetch_osm.py` to pull buildings, roads and landuse for that polygon, project it to metres and save `data/build/slice1.geojson`
- [ ] Lock the palette in `palette.ts`: terracotta pink, sandstone, lime-white borders, faded turquoise doors, marigold, bazaar awning colours, plus night and dusk tints
- [ ] Build a mood board of 20–30 reference photos in `docs/refs/` (your own or licensed Wikimedia Commons images only)
- [x] Pick the pixel scale and test three: 0.33, 0.5 and 1 m per pixel (chose 0.5)
- [ ] Make an audio shortlist from freesound.org (CC0 or CC-BY): bazaar crowd, auto horns, pigeons, temple bells, chai seller

**Done when:** `npm run dev` shows an empty iso scene with the palette applied, and the OSM slice draws as flat coloured footprints.

## Phase 1 — The Hawa Mahal slice (2–3 weekends)

Goal: one beautiful, static, explorable block. It should be good enough that a screenshot alone makes people ask what it is.

**Tasks**

- [ ] Iso camera: orthographic, 4 snap rotations (Q/E), pan by drag, zoom in integer pixel steps so pixels never shimmer
- [ ] Pixel pass: render at 1/3 to 1/4 resolution, nearest-neighbour upscale, optional palette-snap shader and 1 px outlines
- [ ] Ground: roads, footpaths and the Badi Chaupar square from the GeoJSON, with sandstone paving and kerbs
- [ ] Shop-house generator: takes a footprint and outputs a ground-floor arcade of arches, upper floors, chhajja ledges, jharokhas and rooftop chhatris. Randomise with a seed so the same street looks the same every load.
- [ ] Hawa Mahal model, hand-built from modules: a repeating jharokha unit stacked into the five-tier pyramid facade. This is the hero asset, so spend the time here.
- [ ] Bazaar dressing: awnings, sign boards, fabric bundles, fruit carts, electric wires, a cow or two (static for now)
- [ ] URL state like isometricmumbai.com: `/#z/x/y/rot`, so any view is shareable
- [ ] Loading: one compressed JSON for the slice plus a texture atlas. Target under 2 MB and first paint under 2 s.

**Done when:** 60 fps on a laptop, smooth on a phone, and a shareable link opens on Hawa Mahal.

## Phase 2 — Make it alive (2–3 weekends)

Goal: leave it open in a tab and it feels like standing in the bazaar.

**Time and light**

- [ ] Day cycle driven by suncalc for Jaipur in IST, using real time by default plus a time scrubber
- [ ] Lighting presets blended by sun altitude: harsh noon, golden hour (the pink glows), blue dusk, night
- [ ] At dusk, street lamps, shop bulbs and window glows switch on one by one rather than all at once
- [ ] Live weather from Open-Meteo: dust haze, monsoon rain with puddle reflections, wind that moves awnings

**Movement**

- [ ] Lane graph built from OSM roads, with agents following splines and simple give-way rules at Badi Chaupar
- [ ] Vehicles and animals: autos, e-rickshaws, cycle rickshaws, scooters, a bus, a camel cart, wandering cows
- [ ] Crowds of tiny 4–6 px pedestrians, denser in the evening
- [ ] Pigeons that burst off the Hawa Mahal ledges when you click near them

**Sound**

- [ ] Sound zones placed in the world (bazaar crowd, traffic, pigeons, temple), with volume and stereo pan set by camera position and zoom
- [ ] Time-aware mix: quiet early morning, peak bazaar at 7 pm, crickets at night
- [ ] One-off sounds tied to events: a horn when an auto brakes, a bell when the temple aarti starts
- [ ] Mute toggle and a "listen" mode that hides the UI

**Done when:** a 60-second screen recording at dusk feels real without any narration.

## Phase 3 — Expand across the walled city (4–6 weekends)

Goal: the whole walled city, with the hand-built quality kept where people look and procedural generation everywhere else.

**Landmarks, in order**

1. Jantar Mantar. The instruments cast real shadows from the live sun, so the Samrat Yantra works as a sundial.
2. City Palace: Chandra Mahal, Mubarak Mahal and the courtyard gates.
3. Govind Dev Ji temple and garden, plus Tripolia Gate.
4. Isarlat (Swargasuli) tower. This is a good small model to practise on.
5. City walls and gates: Chandpol, Sanganeri, Ajmeri, New Gate.
6. Bazaar streets: Johari, Bapu, Kishanpole, Tripolia, Chandpol.

**Systems**

- [ ] Chunked world: split the city into roughly 250 m chunks and stream them in as the camera moves
- [ ] Instancing and level of detail: far chunks become simple boxes with baked colour
- [ ] Generator v2: block-type rules (havelis with courtyards, temple-front shops, rooftop water tanks and satellite dishes)
- [ ] Heights: OSM levels where they exist, otherwise rule-based (2–4 storeys in bazaars)
- [ ] Search box and a mini-map of the nine-block grid

**Optional experiment:** try the AI-tile route for the city outside the walls as a soft, low-detail backdrop, reusing the open-source isometric-mumbai pipeline and its LoRA. You learn the other main method without giving up the diorama.

**Done when:** you can travel from Chandpol to Sanganeri Gate without a loading pause, and every landmark on the list is hand-built.

## Phase 4 — Hills, stories and launch (3–4 weekends)

Goal: frame the city with its forts, add guided stories, and ship.

**Beyond the walls**

- [ ] Nahargarh Fort on the Aravalli ridge as a backdrop above the city, with its walls snaking along the hills
- [ ] Jal Mahal floating in Man Sagar Lake, with reflections that change through the day
- [ ] Amber Fort and Maota Lake as a separate "island" scene reached by a jeep ride along the road

**Stories**

- [ ] Tours: scripted camera paths with short narration cards, such as "The Pink City in 5 stops" and "A day at Badi Chaupar"
- [ ] History slider covering 1727 founding, 1799 Hawa Mahal and 1876 pink paint. Buildings fade in or recolour as you scrub.
- [ ] Postcards: export the current view as a PNG with a stamp, the date and a caption

**Launch**

- [ ] Pick a domain (for example pixeljaipur.com) and set up Cloudflare Pages with preview deploys per branch
- [ ] Open Graph image, About page with credits and sources, and LICENSES.md for every asset
- [ ] Pass on mobile and accessibility: touch controls, reduced-motion mode, sound off by default
- [ ] Submit to isometriccities.com (link, city, creator name). Also offer a Hawa Mahal floating island for their "Landmarks in pixels" set.
- [ ] Share a 30-second dusk video and the tour on social media

## Where to be creative — idea menu

Pick one or two per phase as stretch goals. Each one teaches something new.

| Idea | What it is | What you learn | Best phase |
| --- | --- | --- | --- |
| Paint the city pink | Scrub to 1876 and watch the pink wash spread street by street from the palace outward | Shader animation, flood-fill over a graph | 4 |
| Working sundial | Jantar Mantar's shadows show real Jaipur solar time; hover to compare it with IST | Sun maths, shadow maps | 3 |
| Kite festival mode | On 14 January (Makar Sankranti) the rooftops fill with people and hundreds of kites fight in the sky | Particle systems, simple physics | 2 |
| Hawa Mahal breeze | Visualise wind flowing through the 953 windows as drifting pixel streaks | Flow fields | 2 |
| Festival calendar | Diwali lights on Johari Bazaar, Holi colour clouds, the Gangaur and Teej processions, each triggered by date | Event scheduling, crowd paths | 4 |
| Miniature-painting filter | A toggle that renders the scene like a Rajasthani miniature: flat colour, gold borders, no perspective | Post-processing shaders | 3 |
| Sound map | Click any shop to hear it: a tailor's machine, a chai seller, a bangle stall | Raycasting, audio design | 2 |
| Kathputli show | A tiny puppet show plays in the square at 6 pm with folk music | Sprite animation, timing | 2 |
| Blue Pottery details | Hand-drawn pixel textures of Jaipur blue pottery on fountains and shop fronts | Pixel-art craft in Aseprite | 1 |
| Rooftop life | Laundry lines, water tanks, monkeys leaping between roofs, kids flying kites | Procedural decoration | 3 |
| Night sky | Stars and the Moon at their real positions above Jantar Mantar | Astronomy libraries | 3 |
| Voice tour | AI-narrated audio tours in English and Hindi | Text-to-speech, timing with camera paths | 4 |
| Hidden chai cups | Collectible easter eggs tucked around the city, with a counter | Light game design | 4 |

## Claude Code prompts, ready to paste

Export this doc as Markdown into `docs/PLAN.md` first, so every prompt can point at it. Start each phase in plan mode and approve the plan before any code is written.

**Phase 0 — kickoff**

```
Read docs/PLAN.md. We are starting Phase 0 of PixelJaipur.
Scaffold a Vite + TypeScript + three.js app, write CLAUDE.md using the
conventions in the plan, and create src/render/palette.ts with a
Jaipur palette (terracotta pink, sandstone, lime-white, turquoise,
marigold, plus dusk and night tints). Then write scripts/fetch_osm.py
(uv, shapely, pyproj) that pulls buildings and roads from Overpass for
data/boundary/slice1.geojson and writes projected metres to
data/build/slice1.geojson. Render the footprints flat in an iso view.
Plan first, then build in small commits.
```

**Phase 1 — pixel diorama**

```
Phase 1. Build the iso camera (orthographic, 4 snap rotations, integer
zoom steps) and a pixel pass (render to a low-res target, nearest-
neighbour upscale, optional 1px outline). Then write a seeded shop-house
generator that turns each footprint into an arcade, upper floors,
chhajjas, jharokhas and chhatris. Add a Playwright script that saves
screenshots to tests/shots/ and check them after each change.
```

```
Model Hawa Mahal in src/landmarks/hawaMahal.ts from one reusable
jharokha module stacked into the five-tier facade. Use
docs/refs/hawa-mahal-*.jpg for proportions. Show me screenshots from all
4 rotations before we refine.
```

**Phase 2 — alive**

```
Phase 2. Add a day cycle using suncalc for Jaipur (26.92N, 75.82E,
IST) with a time scrubber. Blend lighting presets by sun altitude and
switch lamps on gradually at dusk. Then build a lane graph from the OSM
roads and spawn autos, e-rickshaws, cows and pedestrians on splines.
Keep agent logic in pure functions with Vitest tests.
```

```
Add positional ambient audio with Web Audio: sound zones defined in
data/sound_zones.json, volume and pan from camera position and zoom,
and a time-of-day mix. Sound is off until the user clicks.
```

**Phase 3 and 4** follow the same pattern: name the phase, list the checkboxes from that section, ask for a plan, and require screenshots for anything visual.

**Tips**

- Use `/clear` between phases and let CLAUDE.md carry the context.
- Ask Claude Code to update `docs/DECISIONS.md` whenever you change course.
- For art-heavy work, ask for three variants side by side in one screenshot and pick one.

## Risks and open questions

| Risk | Fallback |
| --- | --- |
| Scope creep from the idea menu | Cap it at two stretch ideas per phase and park the rest in an issue list |
| OSM footprints in the old city are merged or messy | Use the street frontage and the generator instead of exact footprints, and fix key blocks by hand in JOSM |
| The art looks inconsistent between generated and hand-built parts | Palette-snap shader plus one fixed light direction; review screenshots side by side |
| Phone performance | Chunking, instancing, a lower pixel resolution on mobile, and a simplified night mode |
| Licensing of photos and sounds | CC0 or CC-BY only, logged in LICENSES.md; record your own audio on a trip if you can |
| Motivation dips in Phase 3 (the long grind) | Ship a public v0.1 at the end of Phase 2 so there is something live to share |

**Open questions**

- [ ] Domain name and project name: PixelJaipur, Isometric Jaipur or something in Hindi?
- [x] Pixel scale: 0.5 m per pixel (decided 2026-11-26)
- [ ] Should Amber Fort be a separate scene or connected on the same map?
- [ ] Is a Delhi or Varanasi follow-up worth designing the code for (city config files) from day one?

**Decision log**

| Date | Decision |
| --- | --- |
| 2026-11-18 | Jaipur chosen; start with the Hawa Mahal and Badi Chaupar slice |
| 2026-11-18 | Hand-built three.js pixel diorama, not AI-drawn tiles |

## Review amendments (2026-11-26)

These override anything above that conflicts.

1. **Pixel scale and zoom are separate.** One render-target pixel is a fixed world size (`mpp`, metres per pixel). Zoom changes only the integer upscale factor (2×, 3×, 4×…).
   *Superseded 2026-11-27 by "detail zoom":* zooming now moves through levels that change `mpp` (1.0 → 0.11 m) while each texel keeps a constant on-screen size, so zooming in adds detail instead of enlarging pixels. Fixed mode (`?mpp=&zoom=`) remains for screenshots.
2. **No pan shimmer.** The camera target snaps to the render-target texel grid. The sub-texel remainder is applied as a screen-space offset in the upscale pass.
3. **Projection is 2:1 dimetric.** Camera elevation is 30° and azimuth is 45° + 90°·rot, so ground diagonals step 2 px across per 1 px up. It is not true isometric (35.264°).
4. **OSM licence.** "© OpenStreetMap contributors" (ODbL) must be visible on the site and listed in `public/assets/LICENSES.md`.
5. **Palette vs day cycle.** Use per-time-of-day palettes blended in the shader (or ordered dithering) rather than snapping to one fixed palette. Update the sun direction in steps, not continuously, so low-res shadows don't swim.
6. **Determinism hooks from Phase 0.** URL params `mpp`, `zoom`, `rot`, `seed`, `t` and `shot=1` freeze the scene. Headless screenshots use SwiftShader/ANGLE.
7. **Default time.** Open at golden hour, with a "Live" toggle for real Jaipur time.
8. **Draw calls.** Use merged geometry per kind/chunk and `InstancedMesh` for repeated modules (jharokhas, props) from Phase 1 onward.
9. **Ship v0.1 at the end of Phase 1**, not Phase 2.
10. Commit `data/raw/` for reproducible offline builds. Check isometriccities.com's real submission rules before Phase 4. Jaipur foundation day (18 Nov) is a good launch hook.
