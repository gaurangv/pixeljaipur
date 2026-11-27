# PixelJaipur

A hand-built, living isometric pixel diorama of Jaipur's walled Pink City in three.js. It starts with the Hawa Mahal / Badi Chaupar slice and grows phase by phase. Full plan: `docs/PLAN.md` (read the "Review amendments" at the end; they override earlier text). Decisions: `docs/DECISIONS.md`. Add a line there whenever we change course.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on http://localhost:5173 |
| `npm test` | Vitest (pure logic in `tests/*.test.ts`) |
| `npm run shots` | Headless screenshots to `tests/shots/` for every scale and rotation, plus a phone shot. Logs draw calls; fails over 150. Close-up: `-- --mpp 0.5 --rot 2 --q "zoom=6&x=25&y=147"` |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run size` | Gzipped initial-download budget (2 MB), after build; streamed city chunks are reported separately |
| `npm run data` | Full data pipeline for the original slice (below) |
| `npm run data:city` | Whole walled city: tiled fetches (~15 min, resumable), then `build_slice.py --slice walled` writes `data/build/walled/` (index, 256 m chunks, lanes, places, minimap). Raw city downloads are git-ignored (25 MB+) |
| `npm run travel -- --gpu` | Phase 3 check: pans Chandpol -> Sanganeri Gate on the real GPU, reports the longest wait for chunks, chunk build ms and frame times (without `--gpu` it uses SwiftShader, ~2 s/frame, and fails the gap limit) |
| `uv run scripts/fetch_osm.py [--slice slice1] [--refresh]` | OSM to `data/raw` (cached) to `data/build/<slice>.osm.geojson` |
| `uv run scripts/fetch_overture.py [--refresh]` | Overture buildings to `data/raw/<slice>.overture.geojson` (cached) |
| `uv run scripts/fetch_places.py [--refresh]` | Resolve Wikipedia titles / Wikidata ids for `data/places.curated.json`, geosearch other articles in the slice (cached in `data/raw/<slice>.places.json`) |
| `uv run scripts/build_slice.py` | Merge OSM + Overture + generated frontage, mark street fronts, place landmarks, write `data/build/<slice>.geojson` and `<slice>.landmarks.json` |

(uv installs the script deps on first run; `.venv/` is an optional fallback.)

## Conventions

- **Colours:** every scene colour comes from `src/render/palette.ts`. No inline hex in scene code.
- **Units:** world units are metres. Local origin is Badi Chaupar. Data is +x east, +y north. three.js is +x east, +y up, **−z north**.
- **Projection:** 2:1 dimetric (30° elevation, azimuth 45° + 90°·rot), orthographic. Do not change it to true isometric.
- **Pixels / detail zoom:** render into a low-res target where one texel = `mpp` metres, upscaled by an integer factor that keeps each texel ~3 CSS px (1.5 on phones). Zooming steps through `LEVELS` in `src/render/zoomLevels.ts` (mpp 1.0 → 0.11, default level 3 = 0.33) so closer = more detail, never bigger pixels. Anything that depends on texel size (outline threshold, dither cell via `setDitherCell`) must follow the level. `?level=` picks a level; `?mpp=&zoom=` is the old fixed mode used by screenshots; the hash `z` is the level.
- **No shimmer:** the camera target is texel-snapped (`snapToTexel`). The remainder goes to the upscale shader as a sub-pixel offset.
- **Determinism:** URL params `mpp`, `zoom`, `rot`, `x`, `y`, `seed`, `outline`, `shot=1` (later `t`). The `#z/x/y/rot` hash is the shareable view. Anything random takes a seed. Nothing in render depends on wall-clock time when `shot=1`.
- **Draw calls:** merge static geometry per kind/chunk. Use `InstancedMesh` for repeated modules (jharokhas, props).
- **Data:** never hand-edit `data/raw/`. Regenerate `data/build/` with the script. Both are committed.
- **Licences:** every asset gets a line in `public/assets/LICENSES.md`. The OSM and Overture attribution stays visible on the page.
- **Info cards:** places live in `data/places.curated.json` (zone spec, Hindi name, fallback blurb). `build_slice.py` turns them into `data/build/<slice>.places.json` (zone polygons, anchor, height). Card text is fetched live from Wikipedia only when a card opens, never in `shot=1`. Remote text is set with `textContent` only. `?card=<id>` / `#z/x/y/rot/<id>` open a card.
- **City streaming (Phase 3):** the app runs the whole walled city from `data/build/walled/` (`?slice=slice1` = old single slice). `src/world/chunks.ts` loads the 256 m chunks around the view (1 build per frame, unloads far ones). Builders' instanced batches go into city-wide `InstancePools` via `withPoolSink`, so draw calls don't grow with chunks: **never create a new geometry per call in a builder** (share module-level geometries), or every chunk opens new pools. Systems react to chunks via `System.onChunk`. The sun is on a rig that follows the view in 64 m steps.
- **Building sources:** OSM first, then Overture where OSM is empty, then generated lots where both are empty. Every building has `source` and `front` (street-facing edge indices of its CCW ring).
- **Workflow:** one phase per branch, small commit per task, plan mode before each phase. After any visual change, run `npm run shots` and look at the PNGs before calling it done.

## Worktrees (Phase 2 runs in parallel)

Phase 2 is split into three streams, each on its own branch in its own git worktree. A coordinating session merges them in the order A, B, C.

| Stream | Branch | Owns (create/edit freely) | Draw-call budget |
| --- | --- | --- | --- |
| A. Day cycle | `p2-daycycle` | `src/sky/*`, `src/ui/timeControl.ts`, palette section "Sky (p2-daycycle)" | +30 |
| B. Traffic & people | `p2-traffic` | `src/actors/*`, lane-graph step in `scripts/build_slice.py`, `data/build/*` (only this stream regenerates data), palette section "Actors (p2-traffic)" | +40 |
| C. Sound | `p2-sound` | `src/audio/*`, `data/sound_zones.json`, palette section "Audio UI (p2-sound)" | 0 |

Rules for every stream:
- Run `npm ci` first in a fresh worktree. Use `PORT=517x npm run dev` so dev servers don't clash.
- **Shared files:** you may add your one import and one entry in your own blocks of `src/core/register.ts`, add colours inside your own palette section, and add new event types to `src/core/events.ts`. Don't touch any other shared file (`src/main.ts`, `src/world/*`, `src/render/*`, `src/ui/*` except your own new files, `CLAUDE.md`, `docs/DECISIONS.md`). If you need a change there, describe it in your hand-back instead.
- Plug in through `System` (`src/core/systems.ts`): build in `init(ctx)`, change things in `update(dt, now, ctx)`, and return `animating()` = true only while you need continuous frames.
- Use `ctx.clock` for time, `ctx.events` to talk to other streams, and `ctx.refreshShadows()` after moving the sun. Be deterministic when `ctx.shot` is true: seeded, no network, no audio.
- Write decisions in `docs/decisions/<branch>.md`. Commit per task. **Never push.**
- Before handing back: `npx tsc --noEmit`, `npm test`, `npm run shots` (stay within your draw-call budget; total must be at most 150), `npm run build && npm run size`. List the screenshots to review.

## Layout

`src/core` clock, events, systems registry · `src/render` camera, pixel pass, palette · `src/world` ground, roads, buildings, generators · `src/landmarks` hand-built landmarks · `src/actors` agents · `src/sky` sun/day/weather · `src/audio` · `src/ui` · `scripts/` data + screenshot tools · `data/boundary` slice polygons (WGS84).
