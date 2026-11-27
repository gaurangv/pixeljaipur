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
| 2026-11-26 | Look: stay a live 3D game-like diorama (not AI-painted tiles like Pixel Trichy); pixel scale changed to 0.33 m; slice sits on a diorama base |
| 2026-11-27 | Detail zoom: zoom levels change mpp (1.0..0.11 m) at constant on-screen texel size, replacing integer upscaling (user found zoomed-in view too pixelated); cursor-anchored wheel zoom; +/- keys |
| 2026-11-27 | Phase 3: whole walled city as a "walled" slice: boundary traced through the gates (OSM wall only partly mapped; east side approximate), +60 m buffer; data fetched in ~800 m Overpass tiles; ~45k Overture buildings in bbox |
| 2026-11-27 | City raw downloads (OSM tiles, Overture 25 MB) are git-ignored and reproducible; built chunks under data/build/walled/ are committed (the app needs them) |
| 2026-11-27 | Streaming: 256 m chunks around the view, buildings assigned whole by centroid; city-wide instance pools keep draw calls constant; traffic/crowd simulate only around the view |
