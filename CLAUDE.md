# PixelJaipur

A hand-built, living isometric pixel diorama of Jaipur's walled Pink City in three.js. It starts with the Hawa Mahal / Badi Chaupar slice and grows phase by phase. Full plan: `docs/PLAN.md` (read the "Review amendments" at the end; they override earlier text). Decisions: `docs/DECISIONS.md`. Add a line there whenever we change course.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on http://localhost:5173 |
| `npm test` | Vitest (pure logic in `tests/*.test.ts`) |
| `npm run shots` | Headless screenshots to `tests/shots/` for every scale and rotation, plus a phone shot. Logs draw calls; fails over 150. Close-up: `-- --mpp 0.5 --rot 2 --q "zoom=6&x=25&y=147"` |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run size` | Gzipped bundle budget check (2 MB), after build |
| `npm run data` | Full data pipeline (below) |
| `uv run scripts/fetch_osm.py [--slice slice1] [--refresh]` | OSM to `data/raw` (cached) to `data/build/<slice>.osm.geojson` |
| `uv run scripts/fetch_overture.py [--refresh]` | Overture buildings to `data/raw/<slice>.overture.geojson` (cached) |
| `uv run scripts/fetch_places.py [--refresh]` | Resolve Wikipedia titles / Wikidata ids for `data/places.curated.json`, geosearch other articles in the slice (cached in `data/raw/<slice>.places.json`) |
| `uv run scripts/build_slice.py` | Merge OSM + Overture + generated frontage, mark street fronts, place landmarks, write `data/build/<slice>.geojson` and `<slice>.landmarks.json` |

(uv installs the script deps on first run; `.venv/` is an optional fallback.)

## Conventions

- **Colours:** every scene colour comes from `src/render/palette.ts`. No inline hex in scene code.
- **Units:** world units are metres. Local origin is Badi Chaupar. Data is +x east, +y north. three.js is +x east, +y up, **−z north**.
- **Projection:** 2:1 dimetric (30° elevation, azimuth 45° + 90°·rot), orthographic. Do not change it to true isometric.
- **Pixels:** render into a low-res target where one texel = `mpp` metres (default 0.33), then nearest-neighbour upscale by an integer `zoom`. Zoom never changes `mpp`.
- **No shimmer:** the camera target is texel-snapped (`snapToTexel`). The remainder goes to the upscale shader as a sub-pixel offset.
- **Determinism:** URL params `mpp`, `zoom`, `rot`, `x`, `y`, `seed`, `outline`, `shot=1` (later `t`). The `#z/x/y/rot` hash is the shareable view. Anything random takes a seed. Nothing in render depends on wall-clock time when `shot=1`.
- **Draw calls:** merge static geometry per kind/chunk. Use `InstancedMesh` for repeated modules (jharokhas, props).
- **Data:** never hand-edit `data/raw/`. Regenerate `data/build/` with the script. Both are committed.
- **Licences:** every asset gets a line in `public/assets/LICENSES.md`. The OSM and Overture attribution stays visible on the page.
- **Info cards:** places live in `data/places.curated.json` (zone spec, Hindi name, fallback blurb). `build_slice.py` turns them into `data/build/<slice>.places.json` (zone polygons, anchor, height). Card text is fetched live from Wikipedia only when a card opens, never in `shot=1`. Remote text is set with `textContent` only. `?card=<id>` / `#z/x/y/rot/<id>` open a card.
- **Building sources:** OSM first, then Overture where OSM is empty, then generated lots where both are empty. Every building has `source` and `front` (street-facing edge indices of its CCW ring).
- **Workflow:** one phase per branch, small commit per task, plan mode before each phase. After any visual change, run `npm run shots` and look at the PNGs before calling it done.

## Layout

`src/render` camera, pixel pass, palette · `src/world` ground, roads, buildings, generators · `src/landmarks` hand-built landmarks · `src/actors` agents · `src/sky` sun/day/weather · `src/audio` · `src/ui` · `scripts/` data + screenshot tools · `data/boundary` slice polygons (WGS84).
