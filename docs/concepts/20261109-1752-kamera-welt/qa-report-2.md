# Kamera-Welt - targeted re-QA after wave 5

Tip 84ad52ff on claude/main-pages-transition-animations-6e2170. `npm run build` = pass (v0.247.0). Production build served on 127.0.0.1:4230 (SPA fallback, stopped afterwards), headless Edge (Playwright channel msedge, D3D11, ~160 Hz display), test-account session, beta {verse, codex, shell}. Harness and scripts in `tmp/kw-qa2/` (untracked). No submit, pick or delete (the swap picker was only opened and closed). Frame sheets are CDP screencast frames mapped to the click or navigation time.

| item | verdict | evidence |
|---|---|---|
| D1 hub rests at scrollY 0 (1280/1600/1920), names hidden | pass | d1.cjs: scrollY 0 at all three sizes, `.plab` opacity 0,0,0 |
| D1 projector cycle | pass (order unverified) | d1.cjs at 1600: charge, build, write, pull, hold 8.17 to 13.25 s (5.1 s), unwrite, unbuild, uncharge, rest 15.79 to 20.87 s (5.1 s), then charge again. Reverse projection present (unwrite/unbuild/uncharge, 1.5 s). Newest-first order and the visible content of each ignite were not checked |
| D2 phone first tap shows name, second opens | pass | d2.cjs (390x844 touch): tap 1 stays on /verse, patches label opacity 1 with class `tap`; tap 2 goes to /verse/patches |
| D3 no final-pose frame before the dolly | pass | d3-sheet.png: 100 to 500 ms stars/nebula only, limb appears small at 700 ms and grows (no wide final-pose arc) |
| D4 typing lands in the search | pass | d4.cjs: typing at 2 s gives value `abc`, activeElement INPUT, further `def` appends; d4b.cjs typing after the stand (7.5 s) gives `xyz` |
| D5 admin station is the real hub station, no card overlap | pass | d5-admin.png: station image at x 1054-1400, y 395-646; cards end at x 1003, bottom-right card starts y 707 |
| D6 no radial streaks in the push-in | pass | c4-news-sheet.png, 100 to 1500 ms: no streaks |
| D7 patches planet and sun gone mid-flight | pass | c4-news-sheet.png: both still there at 300 ms, gone at 500 ms, only the big planet remains |
| D8 News planet banded | pass | c4-news-sheet.png (banded Jupiter). Galerie planet not re-checked |
| D9 reduced motion: 420 ms crossfade | pass | d9b.cjs: `sc-scene-xf-in/out` on `::view-transition-new/old(root)`, duration 420 ms. No flat blue frame in d9-sheet.png (screencast too sparse to prove frame by frame). Observation: the Codex stage content is blank at ~1.2 s and back at ~1.9 s (d9-sheetb.png), probably the page's own skeleton/load, not the crossfade |
| D10 swap picker close is a real reverse | pass | p2c.cjs: dialog scales and slides from ~0.6 s, opacity falls 834 to 930 ms (no 40 ms cut). d10-sheet.png: rows unwrite 400-550 ms, plate collapses by 800 ms, scene back by 1.5 s. Scene undim is about 0.3 s behind the plate, not exactly in sync |
| P1 small popups close in reverse | unverified | wishlist, apps and profile popups not re-run (call budget) |
| D11 ship detail entrance: no bright slab or photo flash | pass | d11-sheet.png, lum.cjs: frame mean luminance 22-28 throughout, no bright slab or photo flash. A soft blue glow (about 3 percent of pixels above 90) at 400 ms and a dark 1.0-1.2 s frame with a thin grey band remain (known) |
| D12 app notice at ~4.3 s | pass | ent.cjs: notice appears 4.24 s after bstage creation, after the search starts |
| D12 cold HQ to Verse pan visible, longest frame | partial | d12-sheet.png: starfield pan visible 200 to 600 ms, no black screen. rAF max frame: desktop 138 ms and 60 ms (two cold runs; claimed 109), phone 375 ms (claimed 372). Claim reproduced on phone, desktop varies 60-138 ms between runs |
| E2 search starts ~3.5 s | partial | e2-sheet.png: no search at 3.7 s, faint capsule at 3.9 s, writing at 4.1 s = about 0.3 to 0.4 s later than 3.5 s. Title scan at 3.0 s, header fade 4.23 s, planets 4.45 to 5.0 s, stand 5.44 s |
| E4 menu-switch beats 0.75/1.05/1.3/1.55 s | partial | d12-sheet.png (HQ to Verse): title scan visible by 1.0 s (not at 0.8), search at 1.3 s, planets at 1.7 s. About 0.15 to 0.25 s later than the mock, intervals match |
| Q4 phone FAB column does not cover ship detail | pass (first viewport) | q4-phone-ship.png: column at x 322-374, y 600-760 sits right of the hull schema and datasheet; no horizontal overflow. Scrolled states not checked |
| Wave 2c scroll wins on /codex and /hq | pass | q3.cjs, 3 runs each, 3 s after one wheel step, frames over 33 ms: /codex 5, 3, 0 (max 69, 39, 33 ms); /hq 1, 1, 0 (max 45, 38, 32 ms). Earlier QA: /codex 3 (max 106), /hq 1 (39) |

## New regressions

None found. Console and network were not separately re-read in this pass.

## Not verified

P1 small-popup close, newest-first order of the projector, Galerie planet banding, scrolled phone states, 60/144 Hz real-GPU runs, 1280/1920 sizes for anything beyond D1.

## Overall verdict

Defect fixes D1 to D12 and Q4 hold up in this pass: no failing item. Remaining deviations are timing offsets of 0.15 to 0.4 s against the mock (E2 search, E4 beats), the HQ to Verse frame cost (desktop 60-138 ms, phone 375 ms, the longest frame is still well over 33 ms) and the unverified P1. Ready for acceptance apart from those timing and frame-budget points, which the user should decide on.
