# Task briefing — implement Ⓔ "Fußzeile je Zone" (Codex landing)

Source: concept page `docs/concepts/2026-09-02-codex-im-verse.html`, iteration 3,
owner action **Implement** (v3). Decision record: `decision.md` next to this
file. Codebase facts: `codebase-facts.md`. Brief (round 1): `brief.md`.

## Scope (exactly this, nothing more)

1. **Remove the IM VERSUM plane** from `src/app/codex/codex-landing.component.ts`:
   the `<section class="versum">` (eyebrow, keybinds link, `.domain-strip`
   chips, "Auf dem Reißbrett" `.upcoming-rail`), its styles (`.versum*`,
   `.domain-*`, `.upcoming-*`, `.rail-icon`), and the computeds that only fed
   it (`versumDomains`, `upcomingRailShips`, `upcomingThumbs`, `upcomingMfr`,
   `upcomingFallbackUrl`). Keep `rsi.ensureLoaded()` + `rsi.artFor` (fleet
   art still needs the feed). Keep `formatNum`.
2. **Quick-access line per zone** (prio 3): a `<nav class="zone-archive">` as
   the LAST child of `.zone.board` (after `<sc-codex-board-panel>`) and of
   `.zone.hangar` (after the fleet lane / compare hint). Markup: a leading
   label "Archiv" (`t-label` style: display font, ~0.6rem, 0.14em tracking,
   uppercase, `--sc-fg-2`), then real `<a [routerLink]>` anchors separated by
   a dim "·", each with a small "›" chevron in the zone `--tint` at ~70%
   opacity and an optional quiet tabular count (`--sc-fg-2`, mono). A
   hairline `border-top: 1px solid color-mix(in srgb, var(--sc-fg-2) 12%,
   transparent)` above, `padding-top: 10px`, `margin-top: auto` so it sits
   at the zone bottom. Wraps on phone. Tap targets ≥ 44px tall via padding
   (the mobile gate measures 44 as 43 — use `min-height: 48px` on the row or
   padding on the anchors). Hover: text → `--tint`.
   - AN BORD: Rüstung → `['/codex','fps']` `{cat:'armor'}` · Waffen →
     `['/codex','fps']` `{cat:'weapon'}` · Baupläne → `['/codex','index']`
     `{kind:'blueprint', group:'fps'}`.
   - IM HANGAR: Schiffe → `{kind:'ship'}` · Komponenten → `{kind:'component'}`
     · Waffen → `{kind:'weapon', weaponClass:'Ship'}` · Baupläne →
     `{kind:'blueprint', group:'vehicle'}`.
   - Counts: only where an existing query already yields them — ships /
     components from `build().entityCounts` (`seeded` preferred, as
     `versumDomains` did). Weapons/blueprints totals would be misleading once
     split (FPS vs ship), so show NO count there unless a split count is
     already available from an existing service call (check how
     `fps-list.component.ts` computes its category counts; if it is one
     head-count query per category, reuse that method for Rüstung/Waffen on
     the board side). Never add a new table/function. A link without a count
     shows none.
   - The zone must keep working when the hangar is empty (`emptyHangar()`):
     the line still renders under the empty-bay art.
3. **Keybindings → terminal row**: add `<a class="terminal-tool"
   routerLink="/codex/keybinds">` with the existing key glyph, aria-label +
   title from i18n, placed before `<sc-app-download-menu>` in
   `header.terminal`; 44×44 min target; colour `--sc-fg-2`, hover `--sc-accent`.
4. **Blueprint group sub-filter** in `src/app/codex/codex-list.component.ts`
   + `codex.service.ts`: query param `group=fps|vehicle` (read in the same
   place `kind`/`category` are read); `fps` → categories `FPSArmours`,
   `FPSWeapons`; `vehicle` → every category starting with `VehicleComponent`
   or `VehicleWeapons`. Add `blueprintCategoryIn?: string[]` to
   `CodexListFilters` and apply it with `.in('category', …)` in the list
   query (only for kind = blueprint). UI: a small segmented control above the
   blueprint facets — Alle · Zu Fuß · Fahrzeug — reflecting/setting the
   group (label keys `blueprint.group.all/fps/vehicle`,
   `codex.filters.blueprintGroup`). The single-category `<select>` keeps
   working and is intersected with the group.
   Also read `weaponClass` from the query params (preset, same pattern) so
   the hangar "Waffen" link lands on ship weapons.
5. **i18n** (`public/i18n/de.json`, `en.json`): remove
   `codex.landing.versum.*`; add `codex.landing.archive.label` ("Archiv" /
   "Archive"), `.armor` ("Rüstung"/"Armour"), `.weapons` ("Waffen"/"Weapons"),
   `.blueprints` ("Baupläne"/"Blueprints"), `.ships`, `.components`;
   `codex.landing.terminal.keybinds` ("Tastenbelegungen"/"Keybindings");
   `codex.filters.blueprintGroup`, `blueprint.group.*`. Every UI string via
   ngx-translate, no hardcoded text.
6. **Specs**: `src/app/codex/codex-landing.component.spec.ts` — replace the
   versum/domain-chip/upcoming-rail/keybinds-in-versum-head tests with:
   (a) both zones render a `.zone-archive` whose entries are real anchors
   with the hrefs above, (b) the keybinds anchor is inside `header.terminal`,
   (c) no `.versum`, `.domain-strip`, `.upcoming-rail` in the DOM.
   `codex-list.component.spec.ts` (if it exists) — `group=fps` filters to the
   FPS categories. Keep every other test green.

## Success criteria (from the owner)

- The page ends with the surface; no third plane, no leftover gap.
- Each zone ends with ONE quiet line, same place, same treatment; nothing
  else in AN BORD / IM HANGAR changes.
- One accent per zone (the zone `--tint`), no per-family colours, no glyphs.
- Counts are honest side info (only real numbers), tabular, dim.
- Phone: no horizontal page scroll; the line wraps; targets ≥ 48px.
- Blueprints from the board open the index pre-filtered to FPS categories,
  from the hangar to vehicle categories, and the user can widen to "Alle".

## No-gos

- No new tables, edge functions or data sources. No invented numbers.
- No imagery, no skeletons, no second news feed.
- Do not touch AN BORD's board panel internals or the hangar hero/fleet
  beyond appending the line.
- Do not re-add "Im Verse" anywhere; do not add a Reißbrett rail (owner
  removed the plane — the announced ships stay at `/codex/upcoming`).

## Verification (test mandate)

Pin the test profile per the project's `devops-test-plan` extension.
Minimum: `npm run typecheck`, `npm test` (Karma, ChromeHeadless), and
`npm run build` (templates only compile in the AOT build — typecheck does
not see template errors). Then a browser check of `/codex` requires login —
if no session is available, verify the rendered DOM via the unit specs plus
a production build; state that clearly in the report.

## Delivery

Work on the current branch `claude/devops-design-rethink-93d471` in this
worktree. Commit with a conventional message
(`feat(codex): archive quick access per zone, retire the Im Versum band`),
push, open the PR via `gh api POST .../pulls` (the `gh pr create` path is
hook-blocked). Do NOT merge — merging goes through `ship_release` later.
Report back: files changed, test results, PR number, anything left open.
