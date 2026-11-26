# Decisions

| Date | Decision |
| --- | --- |
| 2026-11-18 | Jaipur chosen; start with the Hawa Mahal and Badi Chaupar slice |
| 2026-11-18 | Hand-built three.js pixel diorama, not AI-drawn tiles |
| 2026-11-26 | Repo root is the Isometriccity folder; plan lives in docs/PLAN.md |
| 2026-11-26 | 2:1 dimetric projection (30° elevation), not true isometric |
| 2026-11-26 | Pixel scale (mpp) fixed per build; zoom = integer upscale only |
| 2026-11-26 | Local metres = UTM 43N (EPSG:32643) with origin at Badi Chaupar (26.92258 N, 75.82671 E); +x east, +y north |
| 2026-11-26 | Roads are buffered into polygons in the data script, so the app only draws polygons |
| 2026-11-26 | Pixel scale locked at 0.5 m per render-target pixel (default `mpp`); 0.33 and 1 kept only as URL options |
| 2026-11-26 | Code licence MIT; v0.1 hosted free on GitHub Pages |
| 2026-11-26 | Buildings: OSM (117) first, then Overture where OSM is empty (703, mostly Google Open Buildings), then generated frontage lots along main bazaars (186). Overture had 974 in the bbox and no heights. |
| 2026-11-26 | Hawa Mahal has no footprint in OSM or Overture; it is placed from OSM node 542886858 on the west kerb of Amer Road, facing ESE (~-14°; the Jaipur grid is rotated ~15°). Reserved 50 x 24 m; tune with refs |
| 2026-11-26 | Info cards: text fetched live from Wikipedia on open (CC BY-SA, credited); Hindi names under titles; hand-written blurbs as fallback and for places without articles (bazaars, Jama Masjid) |
| 2026-11-26 | Local origin (OSM "Badi Chaupar" locality node) is ~30 m SW of the roundabout centre; place zones use real geometry, not the origin |
