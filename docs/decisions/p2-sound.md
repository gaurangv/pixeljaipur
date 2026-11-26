# Sound (p2-sound) decisions

One line per decision, newest last. Folded into docs/DECISIONS.md when the branch is merged.

| Date | Decision |
| --- | --- |
| 2026-11-26 | Plain Web Audio, no library. One `AudioContext` is created lazily inside the first click on the sound button. Master gain 0.55 feeds a gentle compressor (-20 dB, 3:1, soft knee). Measured in headless Chrome: about -25 dBFS RMS at Badi Chaupar at 19:00, about -37 dBFS in the early morning. |
| 2026-11-26 | Sound is OFF by default. The choice is stored in `localStorage['pj-sound']` (`on`/`off`). A remembered "on" still waits for the first pointer or key gesture, because browsers block audio until then. |
| 2026-11-26 | Shot mode: the system returns from `init` immediately (no context, no storage, no UI). `animating()` is always false: audio runs on its own clock, and voices schedule notes about 0.3 s ahead of `ac.currentTime` from `update()`. |
| 2026-11-26 | Spatial model: the listener stands at `screenView().target` and "hovers" at half the visible half-width. Zoomed out, every zone is further away, so the mix is quieter and more blended. Zoomed in, near zones dominate. Rolloff is `1/(1+(d/r)^2)`, half level at the zone radius. Distance is to the nearest point of the zone polyline. |
| 2026-11-26 | Pan is the screen-x of the zone's nearest point relative to the screen centre, through `worldToScreen`, so it respects rotation. It is scaled by 0.85 and by ground/3D distance, so it blends to the centre when zoomed out. Gain and pan changes use `setTargetAtTime` (tau 0.12 s) and are only sent when they change. |
| 2026-11-26 | Time-of-day mix uses named piecewise-linear curves in `data/sound_zones.json` that wrap at midnight. The bazaar peaks at 19:00. Mornings have birds and bells; nights have crickets and a distant dog. |
| 2026-11-26 | The temple bells zone at (-28, -40) off Johari Bazaar is a PLACEHOLDER; move it when a real temple is modelled. `aarti` events play at the position the day-cycle stream sends. |
| 2026-11-26 | All voices are synth placeholders behind `Voice` (`output`, optional `tick`, `stop`). `bufferVoice(url)` plays looping recordings; setting `file` on a looping entry in `src/audio/manifest.ts` swaps it in. One-shot recordings will need a small `bufferOneShot` when they arrive. |
| 2026-11-26 | Listen mode sets `pj-listen` on `<body>`. `src/audio/audio.css` hides the `#pj-overlay` children except `.pj-sound`, plus `.pj-card` and `#credits`. Escape exits. Entering listen mode also turns sound on (the click is a gesture). |
| 2026-11-26 | Sound buttons sit at `left: 12px; bottom: 96px` inside `#pj-overlay`, leaving the strip below them for the day-cycle time panel. |
