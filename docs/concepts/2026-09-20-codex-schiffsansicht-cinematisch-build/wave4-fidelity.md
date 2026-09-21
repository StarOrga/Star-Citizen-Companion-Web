# Wave 4 — concept fidelity pass (2026-09-21)

The Holotable route was never opened in a browser during waves 2–3 (auth-gated,
no test credentials — see `wave3-qa.md` gate 6). The first live look showed a
functional wiring of the concept, not its design: the classic KPI band and
mission bar stacked above a 300|1fr|300 grid, the classic rank card squeezed
into the left rail (double profile selector, wrapped verdict), ports in the
right rail with duplicate group heads, four bare perspective tiles with raw
floats and two of them empty, the classic energy dock stacked on the strip,
plain unlabelled pins, a checkbox row for sound/mobile tabs. This wave rebuilds
the stage to the frozen concept (rounds 4–10) without changing any data path.

## What changed (web only)

| Concept element | Now | Where |
|---|---|---|
| Top bar = search · hangar tab · patch (hv6-s1) | search form → `/codex?q=` (landing seeds its Archive Terminal), golden hangar tab hanging above the table panel, patch trigger reads `4.10.0-LIVE ▾` | `codex-holo-stage.component.ts` topbar, `codex-holo-hangar.component.ts`, `codex-holo-patch.component.ts`, `codex-landing.component.ts` |
| Three panels, one frame, symmetric, collapsible (st4-sym) | `.holo-panel` chrome (head + body), rails collapse to 44 px edges with a vertical label; tablet starts collapsed (mo5-rails) | stage styles |
| Einsatz bar = table header with a KPI per Einsatz (ez5-bar) | `.rolebar` radiogroup: every mission with its lead KPI off the full sheet, active one `· P<overall>`, disabled ones dimmed | stage `missionSegments` |
| Einordnung: statics, profile note, radar, verdict, cohort link, bars (hv6-s1) | Crew/Masse/Laderaum tiles off `heroChips`, `sc-codex-rank-card [holo]` variant (no second selector — the profile follows the Einsatz via `MISSION_RANK_PROFILE`; the cohort word cycles the scope), watermark, top-3 | `codex-rank-card.component.ts` `:host(.holo)` |
| Table: rings, numbered pins with labels, legend, hover short values, 3D/Schema/Teilen text toggles | pins derive from the configurable blocks' slots in list order (never from the extract's raw item ports), missiles pin gold, digit hotkeys 1–9/0, Esc; no-geometry state shows numbers only | stage `pins`, `onKeydown` |
| Inspector panel (right) + "Zuletzt geändert" | occupant head, first four stats, the mount's carried items (gun in the gimbal, missiles in the rack) with their own ⇄/ⓘ, patch Δ line, draft state; journal + save bar + factory reset | stage right panel |
| Below: calm ports \| perspectives (hv5-s3, hv6-s4) | `sc-codex-hardpoint-layout [calm]` (no boxes, group lines, per-group "Detail ▾" folds the row stats), four stacked tiles: big value, reading sentence (percentile band + strongest/weakest axis), ring gauge, three sub-values, "Alle Werte" expands the classic panel; patch-Δ ghosts ride beside the numbers | `codex-hardpoint-layout.component.ts` `:host(.calm)`, stage `perspectiveTiles` |
| Strip (round 10 "Weg B") | coloured rails per perspective, `P<n>` chips, mono values with units, lead-first cells, ring joint, signature facts + class pips; expanded = modes column \| pip stacks \| cooling ring + summary + reset; phone = one value per perspective, never restored open | `codex-holo-strip.component.ts` |
| Energy dock | classic view only — the strip owns energy in the Holotable | `codex-detail.component.ts` |
| Arrival (hv3-s1) + count-up (cine-countup) | hero art dissolves into the table (1.6 s, scan line); tile headline numbers count from the previously viewed ship's cohort value (or 0) to the live value, 700 ms; reduced motion / repeat visit = cut | stage `arrived`, `startCountUp` |
| Perspective values | `allKpiCells` = every sheet key through the SAME `buildKpiStrip` path (`buildKpiStripForKeys`), so Bewegung/Signatur never render empty | `codex-kpi-sets.ts`, `codex-loadout-stats.ts`, `codex-detail.component.ts` |

Perspective colours are categorical, not status: offensive = accent, defence =
`--cat-game`, movement = `--status-success`, signature = `--accent-gold`.
`--sc-danger` stays reserved (weakest radar axis stroke, worse-than-stock
deltas), `--sc-accent-hot` is not used anywhere in the Holotable.

## Data finding (not fixed here)

`codex_silhouettes` was empty on 2026-09-21: the uploader run at 16:14 UTC
(0.34.1) landed only the bundle (`ingest-bundle` 200) — no `ingest-catalog`
call followed, because `data-uploader/src/renderer/main.ts` runs
`buildSilhouettes()` (every ship/weapon/component/armor mesh through
cgf-converter, no stall watchdog in `silhouette-bridge.ts`) BEFORE
`promoteToCodex()`. A first-run silhouette build therefore holds the whole
catalog refresh hostage for hours. Suggested follow-up: promote the catalog
first, build silhouettes after the skins, then run a silhouettes-only
`uploadCatalog` pass (`hooks.buildId` + `donePhases` = everything except
`codex_silhouettes` — the bridge already supports phase skipping).

## Not built

- Turntable/parallax on the silhouette (cine-parallax) — only the arrival
  transformation and the tile pulse on port selection exist.
- The strip's numbers do not count up (only the four tile headlines do).
