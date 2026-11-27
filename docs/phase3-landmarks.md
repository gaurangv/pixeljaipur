# Phase 3, step 2: hand-built landmarks (handoff)

Status 2026-11-27: step 1 (whole walled city, streamed in 256 m chunks) is merged to master and live. This file holds the agreed design for step 2 so a fresh session can start from it. Read `CLAUDE.md`, `docs/PLAN.md` (Phase 3) and `docs/DECISIONS.md` first.

## Decisions already made with the user

- **Landmarks this round:** Jantar Mantar, City Palace, City walls & gates, Temples & Isarlat (Govind Dev Ji temple + Tripolia Gate + Isarlat/Swargasuli tower). Bazaar streets (PLAN item 6) are not in this round.
- **Built by parallel agents**, one git worktree and branch per landmark stream, like Phase 2 (see the Worktrees section of `CLAUDE.md` for the rules: own files only, never push, hand back with checks).
- **Seam on master first**, then the four agents. Merge order: **walls → palace → jantar → temples**.
- **Ask the user before deploying** the merged result.
- Use plan mode before starting (project rule: plan mode before each phase/step).

## The seam (do this on master before spawning agents)

1. `src/landmarks/registry.ts`: one entry per landmark: `id`, placement (anchor, facing, footprint in local metres), and a `build(placement): Object3D`. `main.ts` builds every registry landmark whose chunk is loaded (or all of them, they are few), instead of the hard-coded `buildHawaMahal` calls (`src/main.ts`, city and slice paths). Hawa Mahal becomes the first registry entry.
2. `data/landmarks.curated.json`: per landmark, the plot to **reserve** (polygon or OSM way id), anchor and facing. `scripts/build_slice.py` already reserves a plot for Hawa Mahal (`hawa_mahal()` returns `reserved`; Overture, frontage lots and lanes avoid it). Generalise that: every reserved plot removes OSM/Overture/generated buildings inside it, and `landmarks.json` lists all placements. Today the City Palace and Jantar Mantar areas are filled with generic blocks (see screenshot `tests/shots/mpp0.5-rot0-x=-300_y=360.png`).
3. Palette: one section per stream in `src/render/palette.ts` ("Walls (p3-walls)", "Palace (p3-palace)", "Jantar (p3-jantar)", "Temples (p3-temples)").
4. Regenerate `data/build/walled/` (about 1.5 min; `npm run data:city` only re-fetches if caches are missing) and check shots.

## Streams

| Stream | Branch | Owns | Notes |
| --- | --- | --- | --- |
| Walls & gates | `p3-walls` | `src/landmarks/walls.ts`, `gates.ts` | Crenellated wall along the OSM `city_wall`/`citywalls` ways (in `data/raw/walled.osm.json`); gates Chandpol, Sanganeri, Ajmeri, New Gate (+ others in `data/boundary/walled.geojson` anchors). Walls are long: instanced segments, shared geometry. |
| City Palace | `p3-palace` | `src/landmarks/cityPalace.ts` | Chandra Mahal (7 storeys), Mubarak Mahal, courtyard gates; around local (-300, 360). |
| Jantar Mantar | `p3-jantar` | `src/landmarks/jantarMantar.ts` | Samrat Yantra and other instruments; shadows from the live sun make it a working sundial (PLAN idea menu). Just south of City Palace. |
| Temples & Isarlat | `p3-temples` | `src/landmarks/govindDevJi.ts`, `tripolia.ts`, `isarlat.ts` | Isarlat is the small practice model. |

## Constraints every stream keeps

- Colours only from the palette; 2:1 dimetric; pixel look must hold at every detail level (`src/render/zoomLevels.ts`).
- **Never create geometry per call in a builder** (city `InstancePools`; see CLAUDE.md "City streaming"). Repeated parts (merlons, chhatris, arches) are instanced.
- Draw calls: total stays at most 150 in `npm run shots` (city views run ~45–95 now). Give each stream a budget (suggest +10 each).
- Shot mode deterministic. Check with `npx tsc --noEmit`, `npm test`, `npm run shots` (plus close-ups at the landmark: `-- --mpp 0.25 --q "x=..&y=.."`), `npm run build && npm run size`, `npm run travel -- --gpu`.
- Reference photos: Wikimedia Commons (licence line in `public/assets/LICENSES.md` if any image is committed).

## Useful facts

- Local metres: origin Badi Chaupar (26.9225798 N, 75.8267125 E), +x east, +y north, UTM 43N. Chandpol about (-1709, 433), Sanganeri Gate (-190, -739), City Palace about (-300, 360).
- Places/info cards already exist for City Palace, Jantar Mantar, Govind Dev Ji, Tarkeshwar Nath, Kalki Mandir (`data/build/walled/places.json`); landmark ids should match the place ids so labels and cards line up.
- Publishing: GitHub account **gaurangv** only, commits with the no-reply email (see the memory note); pushing master deploys.
