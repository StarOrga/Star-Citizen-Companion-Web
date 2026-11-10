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

## Wave 2c root cause

Method: CDP traces (`Tracing.start`, categories `devtools.timeline`, `disabled-by-default-devtools.timeline(.frame|.paint|.invalidationTracking|.stack)`,
`blink`, `cc`, `gpu`, `viz`, `v8.cpu_profiler`) of 2a, 3a, 3b and 5 on the same machine and setup as above
(headed Edge, RTX 2080 SUPER, the display now idles at 6.2–7 ms ≈ 150–160 Hz), split per frame into script /
style / layout / paint / raster and per style recalc into the invalidations that caused it
(`tmp/kw-perf/analyze.cjs`, `cause.cjs`, `cpu.cjs`, untracked). Numbers below are from `eeea37c4` unless noted.

**Scroll stage → index (3a /codex, 3b /hq) — three causes, all main-thread, none in the scene's GPU work.**

1. **The scroll never arrived — it bounced.** Recording `scrollY` per frame: eight wheel notches on `/codex`
   went `16 → 116 → 74 → 16 → 114 → 98 → 29 → 16 …` and ended on the stage; `/hq` the same. `y mandatory`
   snapping (S6, Wave 1) picks the snap position *closest* to where a scroll ends, so a notch or a short
   touchpad swipe (100–140 px of a 900 px step) was pulled back to the stage. `main`'s scripted glide went
   `0 → 900` in one move. Every bounce docked and undocked the header: the fusion bar's `data-mode` /
   `.condensing` / `.placed`, the hero, the header's `data-ease` flipped **16 times in 3.3 s**, each flip a full
   morph with change detection and DOM churn (header buttons, the search demo removed and re-added).
2. **Every DOM change restyled the whole document (`:has()` on `<html>`).** 17 of the 23 long style recalcs
   in 3a touched **2 290–2 330 elements, 25–90 ms each** (1 017 ms style in a 3.5 s window). Invalidation
   tracking: `Affected by :has()` on `HTML` / `BODY`, followed by an invalidation set with
   `allDescendantsMightBeInvalid` — every `insertBefore` / `removeChild` anywhere (Angular `@if`, leave
   animations) re-checked the root's `:has()` arguments and restyled all descendants, because one of the
   root rules ends in a universal compound (`html:has(sc-fusion-bar[data-mode='docked']) [data-stage-hero] > :not([data-stage-slot])`).
   Rules on the root: `html:has([data-layout])` ×5, `html:has(sc-fusion-bar…)` ×4, the boot sky's
   `html:has(.routed-content > router-outlet:last-child)` (a dead `html:has(.sc-boot)` beside it),
   `body:has(.sc-shell-scene > .scene)`, `body:has(.brief-world)`, the footer's
   `:host-context(html:has(sc-share-button .dock))`. Most of them exist on `main` too; the waves added the
   DOM churn of point 1 that triggers them in every scroll frame.
3. **Bar-height publishing restyled the document per morph frame.** The other 6 whole-document recalcs
   (165 ms) followed `Inline CSS style declaration was mutated | HTML` from the fusion bar's
   `publishHeight()`: the ResizeObserver on the bar and on `<body>` fired in every frame of the morph and of
   the route swap, and the bar's *scaled* rect height (`getBoundingClientRect`) gave a new
   `--sc-topbar-h` each time; a root custom property invalidates every element.

What it was **not**: the camera flight of the world layer. With the three causes removed, 3a's remaining
frames carry 2–12 ms of main-thread work and no raster spikes; compositor draws never stalled
(`compositorGaps33` 0–5 in every trace). `animation-timeline: scroll()` tilt, the `.neb` blur and the
world's raster did not show up as long frames.

**Swap picker (5).** One 245–300 ms frame is `Response.text` → `JSON.parse` of the slot's candidate list on
open (the background preload had not reached that slot yet); then **1.3 s of `findStat`**
(`hangar/loadout-stats.ts`) in 140–200 ms timer tasks: it rebuilt a lower-cased key map of every stats
struct on every call while the picker ranks the whole list. The remaining 55–100 ms "no script" frames are
paint / raster while the large-popup motion scales `.scene` and fades its `::after` under the opening sheet.
`main` has the same parse and the same `findStat` tasks (10 frames over budget there as well).

**Flight verse → codex (2a).** Dominated by loading work in the frame (lazy chunks, the Codex data
`Response.text`, a 200 ms frame when the Codex page first paints); unchanged by this wave and the same on
`main` (9 frames).

### Fixes (kw/jank)

| cause | fix | what the user sees differently |
|---|---|---|
| 1 snap bounce | `wireSnap` (`verse/pages/briefing/briefing-dock.ts`) adds a directional step: a wheel step that mandatory snapping would bounce finishes the snap step in its direction (native smooth `scrollTo`, the snap keeps it), the rest of that gesture (more notches, touchpad inertia, 220 ms gap) is swallowed; inside an area taller than 1.3 viewports the wheel stays native. Snap positions honour the root's `scroll-padding`. Covers Codex, HQ and the Verse hub (all three use `wireSnap`). | One notch / one swipe now lands on the lower part (and back), as S6 asked ("same behaviour" as the old glide). No bouncing header. |
| 2 root `:has()` | Root state as attributes, written only on change by the owner (`claimRootAttr`, `core/root-var.ts`): `html[data-sc-layout]` (shell, public layout), `html[data-sc-bar="stage"\|"bar"]` (fusion bar, coarse on purpose), `html[data-sc-share-dock]` (share button), `html[data-sc-brief-world]` (Verse hub), `html[data-sc-booting]` (app shell until the first route activates), `html[data-sc-scene]` (already set by the scene). The hero's dock fade keys on the hero itself (`[data-stage-hero][data-hero-docked\|data-hero-snap]`, `StageHeroDirective`), so a dock flip restyles the hero, not the document. The dead `.sc-boot` rules are gone. | Nothing. Same rules, same states. |
| 3 height publish | `publishHeight()` measures `offsetHeight` (layout height, not the scaled rect) and the ResizeObserver path publishes once the size has stood still for 140 ms; mode changes still publish at once. | A page's own sticky bar that hangs off `--sc-topbar-h` takes its final place up to 140 ms after a bar resize instead of following every morph frame. |
| 5 `findStat` | Lower-cased key maps cached per stats object (`WeakMap`); catalogue payloads are never mutated after load. | Nothing. |

### Re-measure (3 interleaved runs per build, medians)

`main` = `origin/main` (`b593c337` era build), `eeea37c4` = Waves 1 + 2a + 2b, `kw/jank` = this wave.
Each cell: **median frames > 33 ms** (the three runs) · median p95 · median max (ms).

| scenario | main | eeea37c4 | kw/jank |
|---|---|---|---|
| 1 entrance / | **7** (7/7/8) · 7.3 · 107.9 | **5** (5/5/3) · 7.5 · 74.5 | **3** (3/4/3) · 7.2 · 70.1 |
| 2a flight verse→codex | **9** (9/9/11) · 18.7 · 219 | **9** (2/10/9) · 13.5 · 213.1 | **9** (9/9/11) · 18.7 · 203 |
| 2b flight codex→hq | **2** (2/2/2) · 7.1 · 94.1 | **2** (2/2/2) · 7.1 · 94.7 | **2** (2/2/2) · 7.1 · 89.5 |
| 3a scroll stage→index /codex | **5** (4/17/5) · 18.4 · 103.2 | **23** (23/25/23) · 76.4 · 108.3 | **3** (5/3/3) · 7.5 · 82 |
| 3b scroll stage→index /hq | **1** (1/3/0) · 7.3 · 38.2 | **16** (16/16/16) · 53 · 60.5 | **0** (0/0/1) · 7.3 · 26.9 |
| 4 codex index list scroll | **0** (0/2/0) · 12.7 · 33 | **1** (0/1/1) · 12.8 · 38.8 | **1** (1/1/1) · 12.3 · 56.6 |
| 5 swap picker open/close | **10** (9/10/11) · 153 · 243.1 | **13** (13/8/14) · 146 · 235 | **15** (15/15/11) · 36.8 · 96.2 |

Notes: on `eeea37c4` 3a/3b never reached the index (the bounce), on `kw/jank` they do (`/codex` 16 → 836,
`/hq` 16 → 900), so those runs include the full header morph and the camera flight. Scenario 5 on
`kw/jank` has *more* frames just over 33 ms but no frame over ~100 ms (p95 37 ms instead of 146–153): the
seconds-long blocking `findStat` tasks are gone and the picker animates in more, shorter frames.

### Still over budget (Q3 not done)

- **5 swap picker**: the first open of a slot whose list is not yet preloaded parses ~1 MB of JSON on the
  main thread (100–300 ms); the push-in (`scale` on the whole `.scene` + its dimming `::after`) costs
  55–100 ms paint/raster frames while the sheet opens. Next: parse in a worker or prefetch the clicked
  slot on hover/focus; push in a pre-rasterised snapshot layer or only dim on the scene.
- **2a / 2b / 1**: loading work inside the flight (lazy chunk evaluation, the destination's data parse);
  the same on `main`. Next: prefetch the destination chunk + data on nav-link hover, defer data parse
  past the flight's end.
- **3a**: 3 frames per run remain (a 55–80 ms `setInterval` task and a no-script raster frame during the
  dock); 4: one 50 ms no-script frame per run (as on `eeea37c4`).
- 60 Hz / 144 Hz runs: still open (display setting, not changed by an agent).

## Wave 2d — the remaining frame budget (kw/budget)

Same machine and harness as Wave 2c (headed Edge, RTX 2080 SUPER, display idling at 6.2–6.6 ms ≈ 155 Hz),
plus `tmp/kw-perf/longtask.cjs` (CPU samples per long main-thread task, main-thread profile only),
`gpuwin.cjs` (GPU / raster threads in a time window), `paintinv.cjs` (invalidation tracking) and a
`--css=<file>` switch in `measure.cjs` that injects a stylesheet, used to try one suspect at a time.

### Causes found (CDP traces of `ac31bd31`)

| scenario | what the trace showed | fix |
|---|---|---|
| 5 picker | **Most of the "parse" frames were not the list.** In the harness the swap RPC is a POST and gets `[]`; the 40–98 ms tasks (`Response.text.then`, then `setTimeout`) are `CodexService.getRankCohort()` scoring the whole fleet for the rank card (`findStat` / `computeKpiSheet`), 25 ships per task. | Cohort scoring yields on a **6 ms time budget** instead of every 25 ships (`codex.service.ts`, `COHORT_SLICE_MS`). |
| 5 picker | The 55–100 ms "no script" frames were the **live WebGL planet**: it measures its anchor with `getBoundingClientRect`; under the push-in (`scale` 1 → 1.04 on `.scene`, which also holds the planet's canvas) the anchor seemed to move every frame, so the planet was followed and redrawn at the display's rate — and drawn 1.04² too big, because the compositor scaled the canvas again. Hiding the planet (`--css`) took the scenario from 14 to 2 frames; `will-change` on `.scene`, dropping the veil's backdrop blur or the nebula blur did not help. | The planet's geometry is measured in the **canvas's layout pixels** (divided by its rendered/layout width ratio, rounded to half pixels): under the push-in it stands still, the compositor scales canvas and world together (`briefing-planet.component.ts`). |
| 5 picker (live) | On production data the RPC list is up to ~1 MB of JSON, parsed by supabase-js on the main thread when the picker opens before the idle preload reached that slot. | The list is read and parsed in a **worker** (`codex-swap.worker.ts`), rows come back in slices of 12 (each a few ms of structured-clone decode); any worker failure but a missing RPC falls back to the page's client. Pressing or focusing a picker card starts its list at once (`warmSlot`, not on hover — a sweep over a loadout would fire a read per card). |
| 2a flight | One 210–260 ms frame: `onModelLoad → dressModel → HoloLook.edgesFor` — the crease edges of the Codex landing's hull, computed synchronously in the frame the model loaded, mid-flight. | Crease edges in a **worker** (`holo-edges.worker.ts`, plain-array port `holo-edges.ts`, same result as before — the existing `creaseEdges` spec against `THREE.EdgesGeometry` now runs through it); the fill material is on at once, the lines follow when they arrive (`HoloLook.dressAsync`). |
| 3a scroll | The `setInterval` task was **`SlowMotionService.tick`**: from the timer it read `playState` / `currentTime` of every driven CSS animation — each read flushes pending style, so mid-morph the first read forced a whole-document recalc (2 325 elements) and every later read after a write another one (23 ms script + 22 ms style). | The 15 Hz step now runs **in the next frame** (timer schedules a rAF, like the hold check already did) and reads every state before it writes (`slow-motion.service.ts`). |

What the user sees differently: the holo hull's crease lines appear a moment (one worker round trip,
~100–300 ms on a big hull) after its fill instead of together with it; the planet under an open large popup
is now scaled once (1.04, like the world) instead of 1.04². Nothing else.

### Re-measure (3 interleaved runs per build, medians)

`main` = `origin/main`, `ac31bd31` = all Kamera-Welt waves up to 2c, `kw/budget` = this wave.
Each cell: **median frames > 33 ms** (the three runs) · median p95 · median max (ms).

| scenario | main | ac31bd31 | kw/budget |
|---|---|---|---|
| 1 entrance / | **8** (8/7/9) · 7.2 · 109.5 | **3** (3/3/3) · 7.2 · 70.5 | **4** (3/5/4) · 7.2 · 71 |
| 2a flight verse→codex | **9** (8/10/9) · 18.5 · 235.3 | **9** (8/9/10) · 13.4 · 210.4 | **8** (9/6/8) · 18.6 · 63.7 |
| 2b flight codex→hq | **2** (2/2/2) · 7.1 · 91.2 | **2** (2/2/2) · 7.1 · 90.4 | **2** (2/2/2) · 7.1 · 89.6 |
| 3a scroll stage→index /codex | **4** (5/4/2) · 12.8 · 81.5 | **4** (2/4/4) · 7.2 · 62.4 | **4** (4/2/4) · 7.5 · 62.9 |
| 3b scroll stage→index /hq | **1** (1/0/1) · 7.2 · 38.7 | **0** (1/0/0) · 7.2 · 31.3 | **1** (1/1/2) · 7.1 · 37.1 |
| 4 codex index list scroll | **0** (0/1/0) · 12.8 · 31.8 | **1** (1/0/1) · 10.9 · 50.9 | **1** (1/1/1) · 8.4 · 49.6 |
| 5 swap picker open/close | **12** (14/12/12) · 162.6 · 228.4 | **15** (15/14/15) · 39.1 · 90.2 | **2** (3/2/2) · 7.5 · 81.8 |

### Still over budget (Q3 not done)

- **5 swap picker: 2 frames (54 / 78 ms, no script).** GPU raster at the start of the push-in
  (`RasterDecoderImpl::DoEndRasterCHROMIUM::Flush` ≈ 85 ms on `CrGpuMain` in the first 170 ms): the
  scale animation on `.scene` changes the raster scale of its big layers (`.world` 350vw × 262.5vw,
  `.sky` with its bleed), which are re-rastered once when the animation starts. Not tried yet: keep
  those layers' raster scale fixed (scale a sibling snapshot layer, or only dim the scene and push in
  the small objects).
- **2a flight: 8 frames (51–67 ms).** `Response.text.then` tasks in rAF callbacks = the Codex landing's
  own data (catalog / build reads) parsed by supabase-js on the main thread while the camera flies, plus a
  ~53 ms `setTimeout` task inside zone.js (`Y@polyfills`), not traced to its source in this wave. Route chunks are already preloaded at idle
  (`IdlePreloadingStrategy`), so the chunk itself is not the cost. **Not built:** warming the
  destination's data on nav-link hover/focus and holding the landing's heavy render until
  `SceneCameraService.flyTo` resolves.
- **2b flight: 2 frames** (85 ms `setTimeout`, 76 ms rAF) — the HQ page's first render; same on `main`.
- **1 entrance: 3–5 frames** (`import.then` 56 ms = the first lazy chunk evaluation, a `fetch` parse 52 ms,
  one 51 ms no-script frame) — first-visit costs; same order on every build.
- **3a: 4 frames, no script (62–87 ms)**: the setInterval task is gone, what remains is paint — the
  root layer (the whole 1595 × 4080 page) repaints in every frame of the dock (≈ 320 paints / 160 ms per
  run); invalidation tracking points at the holotable's leader lines (`.leaders path.real`, *SVG resource
  invalidated* 438× — `filter: drop-shadow` + `vector-effect: non-scaling-stroke` under a moving
  ancestor). Next: give `.leaders` its own layer or drop the per-path drop-shadow during the dock.
- **4: 1 frame (50 ms, no script)** per run, as on `ac31bd31`.
- 60 Hz / 144 Hz runs: still open (display setting, not changed by an agent).

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
