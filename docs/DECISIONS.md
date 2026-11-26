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
