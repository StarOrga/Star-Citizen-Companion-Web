# HQ Bestand - independent implement QA (head 3902288f)

## Gates

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npx tsc --noEmit -p tsconfig.spec.json` | pass (after `npm ci`: the worktree's node_modules predated the Vitest move and lacked `vitest`; environment, not code) |
| `npx eslint src/app/hq src/app/shell/fusion-bar src/app/codex/set src/app/codex/stage` | **1 error**, 27 warnings. Error: `src/app/hq/stock/hq-stock-popup.component.ts:952` no-extra-boolean-cast (`!!p` in `valid()`, from 88a191ea on this branch). Warnings: a11y template rules in `hq-stock.component.ts` (153,173,181,203,212,224), `hq-place-select.component.ts` (31,39), `hq-reserve-dialog.component.ts` (71,93), `hq-einsatz-pick-dialog.component.ts:34` |
| `npm test -- --include=` hq, shell/fusion-bar, codex/set, codex/stage | pass: 94 files, 957 tests. Log warns `Duplicate key "toWishlist"` in `public/i18n/de.json` and `en.json` |
| `npm run build` | pass (only existing budget warnings) |
| Browser verification | **unavailable (signed out)**: the pane has no `sc.auth` for the fresh origin 127.0.0.1:4466 (ports 4311 and 4377 were held by other sessions' servers); `/hq?bestand=alles#inventar` redirects to `/login?redirect=...`. I did not copy a session token across origins or enter credentials. No console errors on the login page. No screenshots at 1280 px or 375 px exist; visible items are judged from code and specs only. Dev server on 4466 stopped (own PID only). |

## Checklist ("static" = code and specs only, not seen in a browser)

| Line | Verdict | Evidence (under src/app/hq unless noted) |
|---|---|---|
| F1 | met (static) | stock/hq-stock.component.ts:736-737 (alles deck tab), :827, :1105 (hqStockLink tab) |
| F2 | met (static) | :17,694-696 use PATH_ICONS; thematic look not seen |
| F3 | partial | no "Alle N" in template (:213); not seen |
| F4 | partial | deterministic kind lists ALLES_KINDS/INV_KINDS (:1023); dimming not seen |
| F5 | partial | empty-state computed :885; sentence + actions not seen |
| F6 | partial | :1011 measures --sc-fab-clear-block, no own max-width on host; clipping vs launcher at 1280/375 not verified |
| F7 | partial | single filter bar with inline sub-filter and place sc-select (:176-235); "never three rows" needs a screenshot |
| I1 | partial | :564-567 .bay min-width calc(3ch + 22px), ellipsis, tooltip :249; real 3 letters in the narrowest bay not seen |
| I2 | met (static) | bayLabel :1121; i18n inSpace "Weltall" (public/i18n/de.json:5865) |
| I3 | met (static) | stock/hq-crate.component.ts, hq-stock-deck.ts |
| I4 | partial | scTooltip on bands (:268) and bays; crate tooltip text ("reserviert", amount, quality) not seen |
| I5 | met (static) | --r hatch per crate, spec hq-stock-deck.spec.ts |
| I6 | partial | band bars + crates :268; not seen |
| I7 | met (static) | stock/hq-stock-table.component.ts (.sc-table-scroll), edit/delete |
| I8 | met (static) | hq-crate.component.ts:22, hq-stock-table.component.ts:12, spec hq-stock.component.spec.ts:157 (no checkbox), selbar :476 |
| I9 | met | data/hq-codex-kind.ts, migration 20261109000300_hq_codex_kinds.sql, manual sub-kind (88a191ea) |
| I10 | partial | stock/hq-place-select.component.ts (grouped, search); two lint warnings :31,:39 (clickable non-focusable) |
| I11 | partial | hq-stock-log.component.ts; "peppier" is visual, not seen |
| I12 | met (static) | one log, 3 lines + expand (hq-stock-log.component.ts:63-64,112) |
| I13 | met | data/hq-removals.ts:6 LAST_REMOVALS=10, lastRemovals :39; spec hq-bestand-data.spec.ts |
| I14 | met (static) | tiers :827, shell/fusion-bar/search-context.ts, SearchWishlistService |
| I15 | met (static) | alternativesFor :832 + hq-stock-deck.ts (swap-table, <=3 hits); spec hq-stock-gaps.spec.ts; dialog not seen |
| I16 | met | stock/hq-stock-popup.component.ts:755 |
| I17 | met (static) | hq-stock-wish.ts, log lines |
| I18 | met | data/scrap-info.ts (yes/no/unknown, default unknown) + spec |
| I19 | met (static) | hq-stock-places.ts sorted by amount; not seen |
| H1 | met (static) | role chips :213, hq-codex-kind.ts |
| H2 | met | :701 importLink '/hq/hangar/import' |
| H3 | partial | variantCount :422 and wishlist counter :221 present; decision not documented |
| S1 | met (static) | Sammlung kinds in ALLES_KINDS |
| S2 | partial | add-to-set.component.ts:191, hangar-picker.component.ts:255, hq-stock-shared.component.ts:100 use hqStockLink({tab:'inventar',cat:'sets'}); hqLocker still at hq-routes.ts:16, no redirect, no note to session backlog found |
| D1 | met | migration 20261109000100, docs/contracts/hq-inventory-quality.md, data/hq-quality.ts |
| D2 | partial | RPC hq_reservations_for_me (migration 000100:271), dialog with friend select (hq-reserve-dialog.component.ts:5,72-74), expiry in RLS + cron; edit-after-create and friend-side UI not verified; migrations never run against a DB here |
| D3 | met | data/hq-inventory.service.ts:429,452-494 logRemoval on take/reduce/delete |
| D4 | met (static) | data/hq-gather.ts, nachschub.service.ts:401,502, now/hq-now.component.ts:454-459 |
| D5 | met (static) | nachschub/nachschub-target-dialog.component.ts, nachschub-target-picker.ts + 190-line spec; dialog not seen |
| D6 | met (static) | nachschub.model.ts:25, plan/hq-nachschub-flow.component.ts:127-131,541-998, migration 000200; "Geld verdienen" popup not seen |
| D7 | met | migration 000500 dismantle_yield, dataforge_extract.py, data-uploader catalog-map.ts; UI "unbekannt" until data |
| D8 | met | hq-codex-kind.ts, migration 000300 |
| X1 | partial | scAction/scTooltip/sc-select used; duplicate i18n key and lint error below |
| X2 | met (static) | .selbar.sc-dock-phone :476,607, --sc-float-bottom, .sc-table-scroll, dvh; 375 px not checked |
| X3 | met | specs hq-bestand-data, hq-stock-deck, hq-reserve, hq-stock-gaps, scrap-info, nachschub-target-picker; build green; migration dry-run not rerun |
| X4 | met | docs/concepts/hq-bestand-ui-spec.md (114 lines), nachschub-hq-ui-spec.md:88-93 |

## Defects

1. medium - no visual verification: F3-F7, I1, I4, I6, I10, I11, I15, the 375 px matrix and degradation without the unapplied migrations (no error states) were not seen. Needs a signed-in pane or Playwright with the test account.
2. low-medium - lint error hq-stock-popup.component.ts:952 (`!!p`); `npm run lint` is a CI gate.
3. low - duplicate JSON key `toWishlist` in public/i18n/de.json and en.json (lines 5813 / 5877); same value, esbuild warns.
4. low - S2 follow-up open: /hq/locker has no redirect; backlog session not told.
5. low - H3 carry-over decision not recorded.
6. low - 27 a11y lint warnings in new templates (hq-place-select, hq-reserve-dialog, hq-stock).
