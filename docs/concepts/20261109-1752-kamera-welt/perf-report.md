# Kamera-Welt — performance report (Wave 2b, Q1–Q4)

Owner brief: „Kein Bild über 33 ms bei Fahrt und Scrollen“, measured on a real GPU at 60 Hz and
144 Hz, before and after (r2); visual jank while scrolling removed (initial request).

## Setup

| | |
|---|---|
| Machine | Windows 11 desktop, NVIDIA GeForce RTX 2080 SUPER |
| Renderer | `ANGLE (NVIDIA … Direct3D11 vs_5_0 ps_5_0, D3D11)` — real GPU, not SwiftShader |
| Browser | Microsoft Edge (Playwright `channel: 'msedge'`), **headed**, `--use-angle=d3d11 --ignore-gpu-blocklist`, occlusion detection and background throttling off (`--disable-features=CalculateNativeWinOcclusion`, `--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`) |
| Refresh rate | the display runs at **~179 Hz** (idle rAF interval 5.6 ms in every run). Neither 60 Hz nor 144 Hz could be set: that is an OS display setting this run must not change. The 33 ms budget is refresh-independent (it is a frame-*time* limit), and 179 Hz is the stricter case for "every running animation forces frames at the monitor rate". **A 60 Hz and a 144 Hz run are still open** (owner, Windows display settings → Advanced display → refresh rate, then `node tmp/kw-perf/measure.cjs <dist> <label>`). |
| Viewport | 1600 × 900, DPR 1, `de-DE`, beta `{verse, shell, codex}` on, service worker blocked |
| Data | fake signed-in session; profiles / user / news from `scripts/perf/fixtures.cjs`; every other Supabase GET (Codex catalog, builds) goes to the real project with the anon key — real Codex data, read-only |
| Load | no game running; the measurements ran one after another with nothing else heavy on the machine (unit tests and builds finished before each run). Single run per build — the spread between runs of the same build is several frames per scenario, see "Reading the numbers". |
| Method | `tmp/kw-perf/measure.cjs` (untracked): a rAF loop records every frame interval inside each scenario; a `PerformanceObserver('long-animation-frame')` records every frame > 50 ms with its top scripts. Warm-up visit of `/verse`, `/codex`, `/codex/index`, `/hq` first (cold shaders and first downloads otherwise dominate). |

Scenarios: (1) the entrance on bare `/` (6 s); (2a) `/verse` → `/codex` and (2b) `/codex` → `/hq` via the
real nav anchors (2.5 s each); (3) wheel from the stage into the index on `/codex` and `/hq` (8 notches);
(4) the Codex index list, 24 notches down and 12 up; (5) open and close the swap picker on a ship detail.

Builds compared: **main** = `origin/main` (no Kamera-Welt), **before** = `e1631d77` (Waves 1 + 2a merged,
the start of this wave), **after** = `kw/perf`.

| scenario | main p50 / p95 / max (ms) · >33 ms | before p50 / p95 / max (ms) · >33 ms | after p50 / p95 / max (ms) · >33 ms |
|---|---|---|---|
| 1 entrance / | 5.6 / 5.7 / 100 · **9** of 963 | 5.6 / 5.7 / 66.6 · **2** of 992 | 5.6 / 11.1 / 100 · **9** of 907 |
| 2a flight verse→codex | 5.6 / 22.1 / 222.2 · **10** of 287 | 5.6 / 16.7 / 261.1 · **9** of 298 | 5.6 / 33.3 / 94.5 · **12** of 258 |
| 2b flight codex→hq | 5.6 / 5.7 / 94.5 · **2** of 430 | 5.6 / 5.6 / 100.1 · **1** of 430 | 5.6 / 5.7 / 138.9 · **2** of 411 |
| 3a scroll stage→index /codex | 5.6 / 11.1 / 144.4 · **5** of 360 | 5.6 / 38.9 / 83.3 · **22** of 257 | 5.6 / 88.9 / 144.5 · **20** of 215 |
| 3b scroll stage→index /hq | 5.6 / 5.7 / 38.9 · **1** of 387 | 5.6 / 27.8 / 55.6 · **7** of 280 | 5.6 / 61.1 / 66.7 · **17** of 274 |
| 4 codex index list scroll | 5.6 / 11.1 / 22.3 · **0** of 576 | 5.6 / 11.1 / 55.6 · **1** of 512 | 5.6 / 11.1 / 83.4 · **2** of 503 |
| 5 swap picker open/close | 5.6 / 5.6 / 33.3 · **0** of 420 | 5.6 / 5.7 / 244.5 · **6** of 266 | 5.6 / 94.4 / 272.2 · **10** of 155 |

`after` = `kw/perf` at `e977b8aa` (scroll tick, glass policy, planet parking, condense cache, root-var guard).
An earlier `after` run (`badb4f78`…`6b31a0aa`, without the root-var guard) gave 6 / 10 / 2 / 23 / 16 / 2 / 9 frames
over 33 ms for the same seven rows. A consent banner stood at the bottom in all runs (the harness seeded the wrong
consent format); it is the same in every build.

## Verdict: the 33 ms budget is NOT met

**Q3 is not done.** On this machine no build — not even `main` — keeps every frame under 33 ms, and this wave
did not measurably reduce the frames over budget. Single runs differ by several frames, so differences of
1–3 frames between columns are noise; two things are not:

1. **Scrolling from the stage into the index is the regression of the Kamera-Welt waves**: 5 / 1 frames over
   budget on `main`, 22 / 7 at the start of this wave, 20 / 17 now (`/codex` / `/hq`). The long frames are
   almost all *rendering*, not script: the long-animation-frame entries carry 10–40 ms of script (rAF
   callbacks) inside 55–170 ms frames, the rest is style, layout and paint. The scroll starts a camera
   flight (`codex` → `codex-index`, `hq` → `hq-sub`: a 350vw × 262.5vw world layer rescaled, veil and object
   opacities transitioning) while the page glides one snap step and the header morphs into the bar.
   What this wave removed from those frames — one listener per component, layout reads between writes,
   `measureCondense` reading rects every frame, whole-document style invalidation by height publishers
   writing unchanged root custom properties, the blur over moving content — did not show up as fewer
   frames over budget. The remaining cost is the scene itself.
2. **The swap picker** (0 on `main`, 6 → 10 now): one 245–270 ms frame is the first parse of the catalog
   (`Response.text`) when the picker opens; the other long frames are style/paint while the large-popup
   motion pushes the whole scene in (`scale` on `.scene` plus its dimming `::after`) under the picker.

The entrance (2–9) and the flights (9–12 for verse → codex) are dominated by loading work in the frame:
lazy chunks (`import.then`), the destination's data (`Response.text.then` in rAF / timer callbacks). Those
are first-visit costs per route, not jank from the animation itself.

## Next steps (not done in this wave, in this order)

1. Profile `3a`/`3b` with a CDP trace (`Tracing.start` with `devtools.timeline,disabled-by-default-devtools.timeline.frame`)
   to split style vs. layout vs. paint vs. raster per frame — the long-animation-frame API does not.
2. Try the cheap scene suspects one at a time against `3a`: the world layer's size (raster at scale 1.2–3.6
   of a 5600 × 4200 px layer at 1600 px width), the `.neb` `filter: blur(6px)` inside the sky layer, the
   veil/opacity transitions running in the same frames as the snap glide.
3. Defer the catalog parse of the swap picker to idle time after the ship detail settles; let the large
   popup push-in skip the `scale` on phones and low-end GPUs.
4. Repeat every scenario 5× per build at 60 Hz and 144 Hz (display setting) and report medians.

## Phones (Q4)

`tmp/kw-perf/mobile.cjs` (untracked) walks 390 × 844 and 360 × 740 in Edge mobile emulation (touch, mobile UA)
and saves frames to `tmp/kw-perf/mobile/` (entrance at 200/900/1800/3000 ms, a mid-flight pair, the header →
bar morph mid and docked, codex stage / index / scrolled, ship detail and docked, the swap picker
mid-animation and open, HQ, settings, a small menu). An automatic audit flags fixed/sticky interactive
surfaces over the feedback launcher, surfaces sticking out sideways and a page wider than the screen: no
findings after the consent seed was fixed. By eye:

- fixed: the view switch FAB (`sc-view-toggle-fab`, z-index 155) floated over the open swap picker (a large
  popup, z-index 150) — it now hides while `html.sc-scene-pushin` is set.
- open: on the ship detail the right-hand FAB column (β, view switch, share, feedback) covers the right
  edge of the content (the rating segment's ⓘ button, values in the Codex datasheet rows). The FABs float
  by design; the pages do not reserve their lane on phones.
- open (data, not layout): the ship detail's "Einsatz" strip showed `500,74.488610 m/s` at 360 px — a
  number formatting slip, outside this wave.
- not covered: toasts (no trigger without signed-in actions on production data).
