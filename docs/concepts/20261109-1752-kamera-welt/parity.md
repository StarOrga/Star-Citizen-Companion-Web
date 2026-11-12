# Parity — Kamera-Welt

The checklist lives in `briefs/implement.md`. This file only maps each line to the mock that defines it.

| Line | Fragment | Mock id / keyframes | Timing and easing |
|---|---|---|---|
| C1–C4 | rounds/05.html | `#d5-tour`, `d5-tour-cam`, `poseAt()` (fixed-point log zoom) | 1.1 s main↔main, ease-in-out cubic |
| C5 News/Patches/Galerie | rounds/05.html | `#d5-news` `d5-news-cam`, `d5-news-o-*` | 1.1 s push, other objects fade during flight |
| C5 Sternkarte | rounds/05.html | `#d5-starmap` `d5-starmap-morph`, planet opacity 0.3 | 1.1 s |
| C5 Admin | rounds/05.html | `#d5-admin` (station only, 6×) | 1.1 s |
| C6 HQ / Lager | rounds/05.html | `#d5-hq`, `#d5-hq-lager`, `.d5-o-hqst`, `.d5-calm` veil 0.38 | 1.1 s |
| E2 entrance | rounds/05.html | `#d5-pb-main` steps, `d5-pb-main-cam`, `-fadein`, title scan `-r*-ln` | 0.8 / 2.7 / 2.2 / 3.5 / 4.3 / 5.0 → 5.5 s |
| E4 menu switch | rounds/05.html | `#d5-pb-nav` | 1.1 s pan, 0.75 / 1.05 / 1.3 / 1.55 s |
| E5 projector cycle | rounds/05.html | `#d5-pb-cycle` `-b*` beam, `-s*` slab, `-h*` halo, timeline `-cur` | +5 s, 0.6 s ignite, 5 s on, 5 s off; pause = reverse projection (r5 pin) |
| S1–S2 header morph | rounds/05.html | `#d5-pb-scroll` `-mo*a/b` (FLIP), `-ap`, `-cap`, `-st` | 0.1–0.85 s, cubic-bezier(.55,0,.2,1) |
| S4 rows | rounds/05.html | `#d5-pb-scroll` `left`/`rows` regions | 1.0 s / 1.45 s, 70 ms per row |
| D1 detail | rounds/05.html | `#d5-pb-detail` `holo`, `dock`, `cols`, `edge` | 0.35 / 0.5 / 0.75 / 1.2 s |
| M1–M3 minor | rounds/05.html | `#d5-pb-minor` `.d5-rail`, `-ri*`, shift −12.5 cqw | 0.2 / 0.45 / 0.7 s, ~1.5 s total |
| P1 small popup | rounds/05.html | `#d5-pb-pop-s` `ping`, `line`, `unfold`, `limb` | 0 / 0.12 / 0.3 / 0.55 s |
| P2 large popup A | rounds/05.html | `#d5-pb-pop-la` `stars`, `horizon`, `plate` (rise), `up`, `rows`, `fade` | 0 / 0.15 / 0.45 / 0.75 / 1.05 / 1.5 s, ~2.0 s |
