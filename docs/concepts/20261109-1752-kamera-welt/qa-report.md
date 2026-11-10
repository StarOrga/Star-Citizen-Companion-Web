# Kamera-Welt - Wave 3 QA report (independent)

Tip 3f9024b6, branch claude/main-pages-transition-animations-6e2170. `npm run build` = pass (v0.247.0).
Environment: headless Edge (Playwright channel msedge, ANGLE D3D11 on an RTX 2080 SUPER, display idles ~6.3 ms = ~160 Hz), 1600x900 and 390x844 (mobile emulation, touch), beta {verse, codex, shell} on, test-account session via scripts/playwright/test-session.cjs, dist served on 127.0.0.1:4220 (stopped afterwards). Mock = rounds/05.html screens at 1600x900 (paused via getAnimations()). Animations were sampled with CDP screencast frames mapped to the page clock plus per-frame DOM samplers. No irreversible action (the swap picker was only opened and closed). Evidence under tmp/kw-qa/.
Console/network over 11 routes: clean (one "rAF timed out in updateSource" warning), no failed requests.

## Checklist

| Line | Verdict | Evidence | Note |
|---|---|---|---|
| C1 one scene, camera only | met | fl-1600.json, fl-v2hq-sheet.png | four flights: every world object moves, no background swap or fade |
| C2 scene without snapshot | met | same | camera moves live, objects keep one continuous position |
| C3 straight paths | met | straight.cjs on fl-1600.json: max perpendicular deviation 0.8-6.9 px over chords of 700-4200 px, backtrack 0.0 px, all 4 flights and the push-in (c4-news.json) | no direction change in any sampled flight |
| C4 main 1100 ms / subpage push-in | partial | moving span 950-980 ms (eased ends), 734 ms on a cold first hop; c4-news-sheet.png | push-in toward the clicked planet is straight (84 to 754 px, chord 153 px); back pulls out (c4-news.json back). See D6 (radial streaks) and D7 (second planet mid push) |
| C5 News/Patches/Galerie | partial | iso-d-*.png; probe at rest: only that planet = 1, planet/hqst/other planets/live planet = 0 | rest state met, emblem removed. Mid push-in the hub Patches planet and the sun are still visible (c4-news-sheet.png 600-700 ms) = D7. Big planet is a flat terracotta sphere, the mock has the banded Jupiter (pair-news.png) = D8 |
| C5 Admin | partial | iso-d-admin.png; probe: station 1, all else 0 | only the station, but a CSS ring + white slab + light bar at 6x (shell-scene .station::before/::after), not the mock station image (pair-sm.png); it sits behind the cards = D5 |
| C5 Sternkarte | met | probe: planet 0.3, starmap 1, pl.gallery 0, news/patches 0; .const to .map crossfade in CSS; iso-d-explorer.png | big planet barely visible at 0.3 as intended |
| C6 HQ | met | probe: planet 1 (live planet 1, one planet), hqst 1, veil 0.38; pair-hq.png; Verse view hqst between Galerie and notice (real-verse.png) | calm, little city light; HQ Hangar keeps the pose |
| C7 Codex unchanged | partial | pair-cdx.png | landing and index match the mock; not diffed against main pixels |
| C8 reduced motion | partial | r1.cjs: flights have 0 intermediate positions; r2b-sheet.png | no flight, no entrance (short build, stands, r2a-sheet.png). But the new page shows on a flat blue slab with no stars or planet for ~420 ms, then the scene pops in (D9); no visible crossfade |
| C9 behind shell beta | met | c9.cjs: beta off, no .scene and no .bstage on 4 routes | |
| E1 entrance only on bare / | partial | e1.cjs: direct /verse = short, bare / = full and stands at 5507 ms, reload = short, key or click skip stands after 333 ms (poll step 40 ms) | typed keys do NOT land in the search (e1b.cjs: typed abc, search value empty, active element BODY) = D4. Hand-over after the #1067 splash not separately probed |
| E2 beats | partial | ent4a-sheet.png, ent4b-sheet.png, a2.json; clock = .bstage creation | stars 0, dolly start ~0.8 s, title scan ~2.6-3.0 s, header fade 4.32 s (mock 4.3), planets 4.58-5.49 s, stands 5.5 s (5507 ms). Search starts growing ~4.0 s (mock 3.5 s). Toast shows ~3.4 s, before the search. Dolly start has a visible cut = D3 |
| E3 names only on hover | unmet | desktop: .plab opacity 1 at rest (e3.cjs, real-verse.png); phone: first tap opens at once (e3b.cjs) | desktop is a consequence of D1; phone = D2 |
| E4 menu switch | partial | e4-sheet.png | pan ok; title scan ~1.2 s, search ~1.6 s, planets ~2.2 s after the click (mock 0.75/1.05/1.55): intervals match (0.4/0.6 s), build ~0.45 s late. HQ to Verse is an almost black screen for ~0.9 s |
| E5 projector cycle | unmet desktop / met phone | desktop: e5b.cjs, e5e.cjs no projection in 30 s; phone: e5d.cjs; e5-d-*.png, pair-e5.png | D1: on desktop the page rests at scrollY 16, the relay is away forever. Forced to scrollY 0 the cycle works (charge, build, write, pull, hold, unwrite, unbuild, uncharge). Phone: stands 2.77 s, first ignite +5.0 s, hold 14.6 to 19.6 s (5.0), reverse projection 0.9+0.7+1.0 s, pause rest 22.2 to next charge 27.2 (5.0). Newest first is implemented (newestFirst); order varied between runs with data |
| S1 header morph | met | s1-cdx-hdr.png (codex stage to index), s1-cdxm-sheet.png | search into the bar, logo + two-line crumb, hit count fades in ~0.5 s, capsule light trace ~0.7 s, icons stay; reverse not frame-checked |
| S2 no slab/blank, icons stay | met | s1-cdx-sheet.png, s1-cdx-hdr.png | no blank frame, account icons in every frame, search does not shrink then widen |
| S3 phone thumb bar | met | s1-cdxm-sheet.png 100-300 ms | search drops into the bottom bar, logo and route stay on top |
| S4 order after header | met | s4.cjs: dock at ~0.5 s, first row 1.80 s, then rows at +70 ms (1.95, 2.02, 2.09, 2.16 s) | rows pop one by one |
| S5 tilt on compositor | met | s5.cjs: far layer -16.7 to -27 px, near layer -39 to -63 px over 900 px; animation-timeline scroll(root block) | stars slower than the page |
| S6 native scroll-snap | partial | page-glide.ts and briefing-dock.ts remain only as wireSnap helpers (no rAF glide); snap y mandatory | behaviour change: the stage rests at scrollY 16, not 0 (stage top 80 px, scroll-padding 64 px) = root of D1 |
| D1 detail | partial | d1-sheet.png vs pair-mdet.png | push-in and dim, side panel and stat bar dock, end state matches the mock (d1-after.png). Hologram only after ~4 s (cold 3D load); meanwhile a bright blue slab (300-700 ms), a ship photo flash (~1.1 s), a blank frame (1.4 s) = D11 |
| M1 HQ-style rail | partial | settings: edge icon rail (24 px, 4 icons, mi-after.png); patch file: icon rail inside the dossier dialog (m1-patchfile.png); phone settings: chip row (pair-ph1.png) | no edge or dock rail on phones |
| M2 title and cards on frame edge | met | mi-after.png: h1 x=187 and cards x=187 | header bar sits at x=155 |
| M3 minor entrance | met | mi-sheet.png | scene dims, rail icons in, title scan 600-800 ms, cards rise staggered, ~1.5 s |
| P1 small popups and toasts | met | p1-wish-z.png (impulse 90-220 ms, panel 300 ms, entries flicker 400 ms), p1-apps-z.png, p1-prof-z.png, toast in real-verse.png; no corner brackets | close: entries vanish at once, empty plate lingers ~330 ms, 0.45 s vs 0.55 s open (roughly 60 percent, no real reverse) |
| P2 large popup A Horizont | partial | open: p2-d-sheet.png (push + dim, horizon rises 150-450 ms, plate, head and filters, rows line by line 900-1200 ms, footnotes, 0 brackets) | close is a hard cut: plate opacity 0 within ~40 ms (p2c.cjs), no reverse, scene stays dimmed ~1 s (p2-d-close.png) = D10. Drifting stars not separately verified |
| Q1 backdrop-filter | met | grep: remaining uses are scrims, menus, dialogs | |
| Q2 one shared tick | met | 1 scroll listener left outside scroll-tick.ts (item-path.component.ts:633, desktop only) | |
| Q3 no frame over 33 ms | unmet | q3.cjs (headless, ~160 Hz; 60/144 Hz not measured): idle 0; scroll /codex 3 (max 106 ms); scroll /hq 1 (39); flight verse to codex 5 (70); codex to hq 3 (134); swap picker 7 (151) | agrees with perf-report.md, which says Q3 is not done |
| Q4 phones | partial | pair-ph1.png, ph2.cjs: launcher (318,772,56x56) not overlapped, no horizontal overflow, 9 routes | FAB column (beta, view switch, share) covers the ship hull schema and datasheet edge on the ship detail; first-tap name = D2 |
| Q5 spec, strings, rules | met | verse-aufbau-ui-spec.md carries the 5.5 s beats; check-native-ui and check-raw-errors pass | |

## Defects (severity order)

1. **D1 (high; E5, E3, S6): on desktop the Verse hub never reaches scrollY 0, so the projector never runs and the planet names stay visible.** Repro: serve the build, sign in, open /verse at 1280x800, 1600x900 or 1920x1080, wait 5 s. scrollY = 16 (html has scroll-snap-type y mandatory and scroll-padding-top 64px, stage top at 80 px). verse-briefing.component.ts:857 and the binding away = dock() not equal top then mark sc-briefing-transmit as away: phase stays rest for 30+ s (e5b.cjs) and the .plab names are shown (opacity 1). window.scrollTo(0,0) snaps back to 16. With scroll-snap-type none and scrollY 0 the cycle runs (e5e.cjs). Phones (scrollY 0) are fine. /codex rests at 16 too (perf-report logs show it).
2. **D2 (medium; E3 phone): first tap on a planet opens the page.** Repro: 390x844 touch emulation (pointer: coarse is true), /verse, tap a planet: URL becomes /verse/patches on tap 1, the name is never shown (e3b.cjs). Probable cause: the routerLink click handler runs before tap() can preventDefault().
3. **D3 (medium; E2): the planet shows in its final pose for ~0.6 s, then cuts to the dolly start.** Repro: fresh tab, open bare /; ent-dolly.png frames 200-700 ms show the wide limb arc, at 800 ms a small globe, at 1200 ms the live planet fades in and grows. The mock shows stars only before 0.8 s.
4. **D4 (medium; E1): typed keys during or after the skip do not reach the search.** Repro: bare /, type abc at 2 s; search value stays empty, document.activeElement is BODY.
5. **D5 (medium; C5 Admin): the Admin station is an abstract glowing ring + white slab + horizontal bar at 6x, overlapping the Integrationen card.** Repro: /admin/hub (iso-d-admin.png); mock d5-admin shows a real station image to the right of the cards.
6. **D6 (medium; C4): bright radial streaks fan out from the clicked planet across the whole screen during every subpage push-in.** Repro: /verse, click the News (or Galerie) planet; frames 600-1300 ms (c4-news-big.png, c4-gal-sheet.png). Not in the mock, gone at rest.
7. **D7 (medium; C5): other objects stay visible during the push-in.** Same repro: at ~600 ms the large Patches planet and the sun stand next to the big News planet. The r3 pin asked for no other planets on the same frame.
8. **D8 (low; C5): the big subpage planets are flat tinted spheres** (News terracotta, Galerie pale blue); the mock News planet is the banded Jupiter (pair-news.png, iso-d-gallery.png).
9. **D9 (medium; C8): reduced-motion page switch.** Repro: prefers-reduced-motion reduce, /verse, click CODEX: the new page stands on an empty flat blue backdrop for ~420 ms, then stars and planet pop in (r2b-sheet.png). No crossfade of the scene.
10. **D10 (medium; P2, P1): popups close without the reverse projection.** Repro: ship detail, press a swap button, Escape or the X: dialog opacity 0 within ~40 ms, DOM removed after ~1.27 s, scene push stays ~1 s (p2c.cjs, p2-d-close.png). The wishlist closes in ~0.45 s with the plate lingering empty.
11. **D11 (low; D1): the ship detail entrance shows a bright slab, a photo flash and a blank frame before the hologram** (d1-sheet.png 300-1400 ms).
12. **D12 (low; E2, E4): the app notice toast shows ~0.8 s before the search (E2), and the HQ to Verse pan is an almost black screen for ~0.9 s.**
13. **D13 (info; Q3, Q4): frames over 33 ms remain (table above), 60/144 Hz runs still open, the FAB column covers ship detail content on phones, settings on phones uses a chip row instead of the HQ-style rail.**

Not verified: drifting stars in the large popup, stat bar columns igniting left to right (not resolvable in screencast frames), real-GPU 60/144 Hz, reverse of the header morph, the #1067 splash hand-over.

## Overall verdict

Not ready to call done. The camera itself is solid: straight paths, one continuous scene, correct isolation values, compositor tilt, native snap, header morph, rows, minor pages, small popups, large popup open, shell-beta gating, clean console. Blocking: D1 (projector cycle and name rule broken on every desktop size), then D2 and D4 (phone first tap, typed keys), D6 and D7 (streaks and second planet during the push-in), D9 and D10 (reduced-motion backdrop, popup close without reverse), D5 (Admin station) and Q3 (frame budget, which the perf report already admits is not met).
