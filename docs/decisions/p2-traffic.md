# Traffic & people (p2-traffic) decisions

One line per decision, newest last. Folded into docs/DECISIONS.md when the branch is merged.

| Date | Decision |
| --- | --- |
| 2026-11-26 | Lane graph is built in `build_slice.py` from the OSM centrelines, with `oneway` read from the cached raw OSM (`data/raw/<slice>.osm.json`), not from `fetch_osm.py` (not ours). The main bazaars are mapped as one-way dual carriageways, so their direction comes straight from OSM; two-way streets get one lane each side, offset to the LEFT (India drives on the left). |
| 2026-11-26 | One-ways 10 m or wider get a left and a right lane at ±0.22 w; lanes never change mid-edge. At junctions lanes are trimmed back and joined by cubic Bezier connectors; 2-lane to 2-lane joins keep their lane index, so connectors never cross each other. |
| 2026-11-26 | Badi Chaupar = the one-way edges on the circle (OSM already draws it clockwise). Connectors from a non-ring lane onto the ring are give-way; ring traffic within 14 m of the entry, or on the ring connector at that node, has priority. |
| 2026-11-26 | Edges whose lanes (with a 0.6 m vehicle half-width) would enter a building footprint are dropped (13 of 95), so vehicles never drive through buildings; road fragments < 40 m total are dropped too. Lane ends at the slice edge are clipped inside the diorama and act as sinks/sources. |
| 2026-11-26 | Car-following is IDM with a hard clamp (never closer than 0.4 m bumper to bumper, looking ahead along the planned route). Merges are protected by a per-target-lane claim held while on a connector. Crossing conflicts inside plain junctions are not resolved (rare, low-speed). A vehicle stuck > 20 s at a junction "turns into a gali" (respawns) to break gridlock. |
| 2026-11-26 | Fleet capped at 80 (1 bus, 1 camel cart, 5 cows, 26 autos, 14 e-rickshaws, 8 cycle rickshaws, 25 scooters), 250 pedestrians, 36 pigeons. Density by IST hour; traffic and people favour the main bazaars (placement, entries and turns weighted 1 / 0.2 / 0.08 by lane class; bazaar shop fronts draw 10x the shoppers per metre). |
| 2026-11-26 | Pedestrian walks are precomputed in Python: 0.9 m out from every street-facing building edge, along OSM footways, and in front of the Hawa Mahal plinth; anything within 0.45 m of a footprint is cut away. |
| 2026-11-26 | Rendering: 3 InstancedMeshes of the shared unit box (vehicles+cows, people, pigeons) with per-instance palette colours set once and matrices written straight into the instance buffer. No shadow casting (the shadow map is static). +3 draw calls. |
| 2026-11-26 | Shot mode: 900 fixed steps of 1/30 s from the seed at the frozen clock time; pigeons stay perched; `animating()` is false. Real mode moves agents with real dt (not game time), density follows `clock.now().hoursIST`. |
| 2026-11-26 | Traffic doubled to 160 vehicles / 400 pedestrians; headlights (unlit lamps + additive road glow) on below 4 deg sun altitude |
