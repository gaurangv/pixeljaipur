# Day cycle (p2-daycycle) decisions

One line per decision, newest last. Folded into docs/DECISIONS.md when the branch is merged.

| Date | Decision |
| --- | --- |
| 2026-11-26 | Sun from suncalc v2 (degrees, azimuth clockwise from north) for `JAIPUR`. Direction changes only when game time enters a new 10-minute step (IST :00/:10/...), then `refreshShadows()` + `sunStep`. Colours and intensities blend every frame (they don't make shadows swim). |
| 2026-11-26 | One DirectionalLight plays three roles: the sun above the horizon (elevation clamped to at least 15 deg so low-sun shadows stay readable), a twilight "sky glow" from the sun's azimuth after sunset (the sun itself lights nothing), and a fixed moon (az 215, el 55) below -8 deg. Both are at zero strength at the switch, so the direction jump is invisible. |
| 2026-11-26 | Presets noon / golden / dusk / night blended piecewise-linearly by altitude (night <= -13, dusk -7, golden plateau -2.5..9, noon >= 32). Stylisation: near the horizon mornings read 1.5 deg higher and evenings 1.5 deg lower, so dawn is pinker and the blue hour comes sooner. |
| 2026-11-26 | Finding: at 07:00 IST in mid-January the sun is still ~4 deg below the horizon (sunrise ~07:20). The default/shot time 07:00 therefore shows the pink pre-dawn glow with the twilight key, and the "Golden hour" button picks the morning minute the sun reaches 7 deg (about 07:55 in January, 06:15 in June) instead of a fixed 07:00. |
| 2026-11-26 | City lights: each window / shop / street lamp gets a seeded threshold on (effective) sun altitude (lamps 1.5..-4.5, shops 0.5..-6.5, windows -1..-10), so they come on one by one at dusk and go off at dawn; 0.45 s fade each, immediate in shot mode. All glows are one unlit InstancedMesh, ground pools one additive InstancedMesh, posts one toon mesh (+4 draw calls incl. shadow pass). |
| 2026-11-26 | Backdrop gradient: PixelPass's material is private and src/render is not ours, so the day cycle wraps `renderer.render` once, finds the material with `uBgTop`/`uBgBottom` in the upscale scene, then restores it. Cleaner later: a `PixelPass.setBackdrop(top, bottom)` exposed on the context. |
| 2026-11-26 | Live weather (Open-Meteo haze) not done in this stream. |
