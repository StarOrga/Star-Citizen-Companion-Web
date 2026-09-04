# Codex ship page — implementation-ready UI spec

Route: `/codex/ship/:className`. Source of truth for structure, logic and information:
Mollywator's concept mock (`docs/concepts/2026-08-24-codex-schiffsseite-redesign.html`,
PR #488) as consolidated in `MASTER.md` §0–§15. Source of truth for polish: this app's
`--sc-*` design system (`src/styles.scss`). Where the two disagree, §14 of this document
records the decision.

Everything below is binding for the frontend wave. Sizes are given on the **app's** scale,
not the mock's 13px root. Every user-facing string is an ngx-translate key — the key
inventory shipped with this spec lives in `public/i18n/{de,en}.json` under
`codex.rank.*`, `codex.energy.*`, `codex.picker.*`, `codex.module.*`,
`codex.weaponDetail.*` plus additions to `codex.detail.*` and `codex.kpi.*`.

## 0. Global rules

**Token map (mock → app).** Never introduce a mock literal.

| Mock | App token | Use |
|---|---|---|
| `--m-bg` `#050d14` | `--sc-bg-0` | page canvas |
| `--m-panel` `#0b1a26` | `--sc-bg-1` | cards, module bodies, picker window |
| `--m-panel-2` `#0e2130` | `--sc-bg-2` | slot rows, popovers, sticky `th` |
| `--m-line` | `--sc-border` | every hairline |
| `--m-cy` `#5fd8ec` | `--sc-accent` | headings, active pips, active buttons |
| `--m-cy-dim` `#3f93a8` | `color-mix(in srgb, var(--sc-accent) 62%, var(--sc-bg-0))` | secondary accent, elevated-surface borders, tooltip trigger underline |
| `--m-txt` | `--sc-fg-0` | body text |
| `--m-mut` | `--sc-fg-2` | muted labels, gap values |
| `--m-gold` `#e2b34b` | `--sc-warn` | minimum-power pips, gap tags, tuned edge, factory baseline, commit button |
| `--m-red` | `--sc-danger` | negative delta, group `aus` |
| `--m-green` | `--sc-success` | positive delta |
| `#dff2f8` "big number" | `--sc-fg-0` | KPI value, slot figure, dock fact value |
| `rgba(120,160,180,.16)` empty track | `color-mix(in srgb, var(--sc-fg-2) 22%, transparent)` | off pips, meter tracks |

`--sc-accent-hot` is forbidden on this page: nothing here is admin-gated. `--sc-danger` is
reserved for negative deltas, the cut-group state and errors — never for decoration.

**Radii.** `--radius-sm` 2px (pips, badges, size/grade chips, meters) ·
`--radius-md` 4px (cards, slots, buttons, popovers, tooltips) · `999px` (draft chip, filter
chips). The mock's 3px and 6px collapse into 4px — see §14.

**Type floor.** Every font-size ships as `font-size: max(<design px>, var(--sc-fs-floor))`.
The mock's micro scale maps up:

| Mock | Spec | Where |
|---|---|---|
| 8 / 8.5 / 9 px | **11px** (floors to 12px on coarse) | pip numerals, dock fact keys, group state |
| 9.5px | **11px** | KPI keys, micro-labels, legend, tooltip title |
| 10 / 10.5px | **12px** | buttons, chips, module header, slot meta lines |
| 11 / 11.5 / 12px | **12px** | tables, tooltips, fold peek |
| 13px | **13px** | body, slot name, dock fact value |
| 15 / 16 / 17px | **15 / 16 / 18px** | verdict, slot figure, KPI value |
| 30px | **28px** (clamp `clamp(22px, 4vw, 28px)`) | hero `h1` |

**Tap targets.** Every icon-only control gets
`min-inline-size: max(28px, var(--sc-tap-min)); min-block-size: max(28px, var(--sc-tap-min))`.
The mock's 22×17px tool buttons and its 22×9px pips are *visual* sizes — wrap the pip
stack's toggle in a real button with the tap floor, and let the pips stay decorative.

**Spacing ladder.** Normalise the mock's rem soup onto the app's `--sc-gap-*` /
`--sc-pad-*`: `.1–.25rem → 4px`, `.3–.4rem → 6px (--sc-gap-3 at desktop is 8px; use 6px
literal only inside a chip)`, `.45–.6rem → var(--sc-gap-3)`, `.7–.8rem → var(--sc-gap-2)`,
`.9–1.1rem → var(--sc-gap-1)`. Card padding = `var(--sc-pad-2)`, page shell =
`var(--sc-pad-1)`.

**Shadows.** Sticky KPI `0 6px 14px -8px rgb(0 0 0 / .8)` · dock
`0 14px 40px rgb(0 0 0 / .6)` · picker `0 24px 70px rgb(0 0 0 / .7)` · tooltip and column
popover `0 10px 28px rgb(0 0 0 / .6)`. These are new black drop shadows; `--sc-glow` stays
for focus rings only.

**Delta convention.** One helper, `deltaTone(metric, sign)`, returns `'up' | 'down' | 'none'`
where `up` = good. `LOWER_IS_BETTER = { ir, em, crossSection, coolingLoad, mass, spool,
regenDelay, downedDelay }`. `.d.up` is always `--sc-success`, `.d.down` always
`--sc-danger` — **never** two classes with opposite meanings per container. A dock signature
rising therefore renders `.d.down` (red) via the helper, not via a container override.
Unchanged → render nothing, never `±0`, except in the picker's `Δ` column where `±0`
(`codex.picker.noDelta`) marks the baseline row in `--sc-fg-1`.

**Gap rule.** A value the extract does not carry renders `codex.kpi.gap` (`—`) in
`--sc-fg-2` at one step down the type scale, plus a `.gaptag` where the region has room:
`1px dashed color-mix(in srgb, var(--sc-warn) 50%, transparent)`, colour `--sc-warn`,
11px uppercase, `--radius-sm`. Never `0`, never an estimate, never a second source.

**Breakpoints.** `1100px` (page skeleton stacks, KPI strip `repeat(3,1fr)`),
`820px` (dock body one column, divider hidden), `<640px` phone (dock → bottom sheet,
picker → full-screen, mission bar horizontally scrollable).

**Sticky stack.** z-order app header (`z-index` per app shell) > dock `14` > KPI strip `10`
> page. Only the KPI strip sticks at the top, exactly as `codex-kpi-band.component.ts:54`
already does:

```scss
position: sticky;
top: calc(var(--sc-imp-banner-h, 0px) + 64px);
z-index: 10;
```

Below 1100px it goes `position: static` (existing behaviour, keep it).

---

## 1. Skeleton

```
sc-codex-detail
└ .detail-page                       display:grid; gap: var(--sc-gap-1); max-inline-size: 1500px; margin-inline: auto
  ├ .crumbrow                        flex; gap: var(--sc-gap-2)  → back anchor, spacer, data pill (§2c)
  ├ .m-top                           grid-template-columns: 1fr 1fr; gap: var(--sc-gap-2)
  │   ├ <section class="hero">       §2
  │   └ <section class="rank">       §3
  ├ <sc-codex-kpi-band>              §4  (sticky)
  ├ <sc-codex-mission-bar>           §5
  └ .m-cols                          grid-template-columns: 1fr 1fr; gap: var(--sc-gap-2); align-items: start
      ├ <div class="col">  h2 .colhead "Loadout" + count + rule  → module stack §6
      └ <div class="col">  h2 .colhead "Analyse" + count + rule  → analysis cards §8
  (+ <sc-codex-energy-dock> sticky bottom, §9; overlays §10/§11 in a cdk portal)
```

`.colhead` — `display:flex; align-items:center; gap: var(--sc-gap-3)`, label 11px
`letter-spacing:.16em; text-transform:uppercase; color: var(--sc-accent)`, count in a
`--radius-sm` box `background: var(--sc-bg-2); color: var(--sc-fg-1); padding: 0 6px`,
then `.rule` = `flex:1; block-size:1px; background: var(--sc-border)`.
Keys `codex.detail.columnLoadout` / `codex.detail.columnAnalysis`.

**Collapse rule.** Fewer than four loadout modules → `.m-cols` becomes `1fr` and the
analysis stack follows the loadout stack (MASTER §1). ≤1100px both `.m-top` and `.m-cols`
become `1fr`.

**Skeleton / loading state.** Reuse the app's `--sc-skel-*` machinery: hero block
`min-block-size: 246px`, rank card same height, six KPI cells, two module cards
(`block-size: 150px`) and two analysis cards (`block-size: 190px`). Order the shimmer with
the existing `--sc-skel-step` stagger. No spinner, no layout shift — the skeleton has the
same grid as the loaded page.

**Error / empty.** Ship not in this build → the existing `codex.detail.notFound` card,
full width, no columns. A module section the ship does not have is **omitted**, never
rendered as an empty card (MASTER §6).

---

## 2. Hero (left half)

```
section.hero        position:relative; min-block-size:246px; border-radius: var(--radius-md);
                    border:1px solid var(--sc-border); overflow:hidden; background: var(--sc-bg-1)
├ sc-fallback-image / sc-ship-skin-viewer   (existing art, absolutely positioned, inert)
├ .mfr              abs top:12px inset-inline-start:14px · 11px · .22em · uppercase · --sc-fg-2
├ h1                abs top:26px inset-inline-start:14px · clamp(22px,4vw,28px) · weight 300 · --sc-fg-0
├ .chips            abs inset-inline-end:12px bottom:44px · flex wrap · gap:6px · justify-content:flex-end
└ .acts             abs inset-inline-end:12px bottom:10px · flex wrap · gap:6px · justify-content:flex-end
```

**Chips** (`.chip`) — `border:1px solid var(--sc-border); border-radius: var(--radius-md);
padding: 2px 8px; font-size: max(12px, var(--sc-fs-floor)); color: var(--sc-fg-1);
background: color-mix(in srgb, var(--sc-bg-0) 72%, transparent)`. Order:
career · role · `codex.detail.chipSize` · `codex.detail.chipCrew` · cargo · mass.
Cargo present → `.chip.gold` (`color: var(--sc-warn); border-color: color-mix(in srgb,
var(--sc-warn) 55%, transparent)`) reading `24 SCU`. Cargo absent → ghost chip
`codex.detail.chipNoCargo` in `--sc-fg-2` with a dashed border. A chip whose value is
missing is omitted entirely.

**Actions** (`.acts`) — `.btn` base: `1px solid var(--sc-border)`, `--radius-md`,
`padding: 4px 10px`, `min-block-size: max(28px, var(--sc-tap-min))`, 12px `.12em`
uppercase, `color: var(--sc-fg-2)`, background
`color-mix(in srgb, var(--sc-bg-0) 72%, transparent)`.
- hover → `color: var(--sc-fg-0); border-color: color-mix(in srgb, var(--sc-accent) 62%, var(--sc-bg-0))`
- `.on` → `color: var(--sc-accent); border-color: color-mix(in srgb, var(--sc-accent) 62%, var(--sc-bg-0)); background: color-mix(in srgb, var(--sc-accent) 18%, transparent)`
- `.gold` (commit) → `color: var(--sc-warn); border-color: color-mix(in srgb, var(--sc-warn) 55%, transparent)`
- `:disabled` → `opacity:.38; cursor:not-allowed` — and the reason lives in an
  `aria-describedby` tooltip, not only in `title`.
- `:focus-visible` → `outline: 2px solid var(--sc-accent); outline-offset: 2px`.

Buttons: `codex.detail.actionCompare` (☆ glyph is decorative, `aria-hidden`),
`codex.detail.actionFactoryLoadout`, `codex.detail.actionCopyLink`. **`Schiff wechseln`
navigates** → it is an `<a [routerLink]="['/codex']" [queryParams]="{kind:'ship'}">` styled
as `.btn.on`, never a button. Same for the breadcrumb back link.

### 2c. Data provenance pill

`.m-pill` in the crumb row, right aligned:
`codex.detail.dataPill` → `DATEN 4.9.0-LIVE.12232305 · schema 14`.
Default: `border:1px solid var(--sc-border); color: var(--sc-fg-2); border-radius: 999px;
padding: 2px 10px; font-size: max(11px, var(--sc-fs-floor))`.
`schema_version < expected` → `.pending`: colour `--sc-warn`, border
`color-mix(in srgb, var(--sc-warn) 50%, transparent)`, dashed, and the text gains
` · ` + `codex.detail.dataPillPending`. `aria-label` = `codex.detail.dataPillAria`.

---

## 3. Einordnung (right half)

```
section.rank        .sc-card; padding: var(--sc-pad-2)
├ .m-h2             "◈" (aria-hidden) + codex.rank.header + .r = codex.rank.nShipsOfSizeClass
└ .m-rank           grid-template-columns: 210px 1fr; gap: var(--sc-gap-2)
    ├ .m-radar      svg viewBox="0 0 210 200" height:190 + legend row
    └ .m-bars       grid-template-columns: 1fr 1fr; gap: 4px var(--sc-gap-2)
        ├ .m-verdict        grid-column: 1/-1
        ├ .rank-controls    grid-column: 1/-1; flex; gap:6px
        └ .m-bar × n        grid-template-columns: 74px 1fr 34px; align-items:center; gap:6px
```

**Radar.** Three concentric hexagons + three diagonals in
`color-mix(in srgb, var(--sc-accent) 18%, transparent)`. This ship's polygon:
`fill: color-mix(in srgb, var(--sc-accent) 20%, transparent); stroke: var(--sc-accent);
stroke-width: 1.4`. Median polygon: `fill:none; stroke: var(--sc-fg-2); stroke-width:1;
stroke-dasharray: 3 3`. Axis captions 11px, `--sc-fg-2`, `text-anchor:middle`, keys
`codex.rank.axis.*` (uppercase already baked into the string). An axis without a value is
drawn at the median and captioned `codex.rank.gapAxis`.
`<svg role="img" [attr.aria-label]="'codex.rank.radarAria' | translate:{name, n}">` and a
visually-hidden `<dl>` mirroring axis → percentile for screen readers.

**Legend.** 11px `--sc-fg-2`, `— {{name}}` (`codex.rank.legend.ship`) and `·· Median`
(`codex.rank.legend.median`); the glyphs are `aria-hidden` spans.

**Verdict.** `codex.rank.verdict` with `{{pct}}`, `{{band}}` (`codex.rank.band.low|mid|high`,
thresholds 25/75) and `{{n}}`. The percentage is `<b>` at 15px `--sc-fg-0`, the rest 12px
`--sc-fg-1`. Trailing `codex.rank.percentile` + `ⓘ` as a **focusable** `<button type="button"
class="tip">` with `aria-describedby` pointing at the tooltip carrying
`codex.rank.percentileTooltip`. Trigger styling: `border-bottom: 1px dotted
color-mix(in srgb, var(--sc-accent) 62%, var(--sc-bg-0)); cursor: help`.

**Controls.** Three profile buttons (`codex.rank.profile.combat|defense|transport`), glyph
`◈` when active / `◇` otherwise (`aria-hidden`), `.btn.on` for the active one, wrapped in a
`role="radiogroup"` with `aria-label="codex.rank.profileLabel"`. Transport disabled when the
ship has no cargo → `codex.rank.disabled.noCargo` via `aria-describedby`. Then a
`<select class="m-sel">` (`margin-inline-start:auto`) with a visually-hidden label
`codex.rank.scopeLabel` and options `codex.rank.scope.sizeClass|all|career`.
Under the controls, an 11px `--sc-fg-2` line: `codex.rank.lensNote`.

**Bars.** Two columns, sorted by percentile desc. Label 12px `--sc-fg-1` truncating with
`text-overflow: ellipsis`; track `block-size: 4px; border-radius: var(--radius-sm);
background: color-mix(in srgb, var(--sc-fg-2) 22%, transparent)`; fill `var(--sc-accent)`,
and `< 45 %` → `.lo` fill `var(--sc-danger)`. Value 12px tabular-nums `--sc-fg-1`.
Each bar is `<div role="img" [attr.aria-label]="axis + ': ' + pct + ' %'">`.

Profile axis sets per MASTER §3; the Verteidigung/Transport axes flag
`crossSection` and `mass` through `LOWER_IS_BETTER` before percentiles are taken.

---

## 4. KPI strip

Extend `sc-codex-kpi-band`; keep its sticky rule verbatim.

```
.m-kpis   grid-template-columns: repeat(6, 1fr); border:1px solid var(--sc-border);
          border-radius: var(--radius-md); overflow:hidden
.m-kpi    padding: 8px 12px; border-inline-end: 1px solid var(--sc-border) (none on :last-child)
├ .k      11px · .13em · uppercase · --sc-fg-2
├ .val    18px · tabular-nums · --sc-fg-0
├ .u      11px · uppercase · --sc-fg-2
└ .d      delta chip: 11px · --radius-sm · padding: 0 4px
```

`.d.up` → `color: var(--sc-success); background: color-mix(in srgb, var(--sc-success) 12%,
transparent)`. `.d.down` → same with `--sc-danger`. Tone decided by `deltaTone()` (§0).
Unchanged → no chip.

`.m-kpi.gap .val` → `color: var(--sc-fg-2); font-size: max(15px, var(--sc-fs-floor))`,
content `codex.kpi.gap`, `title`/`aria-description` `codex.kpi.gapHint`.

While stuck: `background: var(--sc-bg-0)` (opaque) plus the sticky shadow. Nothing else
changes.

`Burst-DPS` and `Dauer-DPS` keys carry a focusable `ⓘ` (`<button class="tip">`) with
`aria-describedby` → `codex.kpi.tooltipBurstDps` / `codex.kpi.tooltipSustainedDps`. No
second line under the value.

Cell sets per lens: MASTER §4, labels from `codex.kpi.short.*`.
≤1100px → `repeat(3, 1fr)` and every cell regains its inline-end border except columns 3
and 6.

**Live reaction to the dock.** Cutting the weapons group sets Dauer-DPS to `0` with a
`.d.down` chip; Alpha, Schild HP, Rumpf HP do not move. The strip subscribes to the same
signal as the dock; there is no second computation path.

---

## 5. Mission bar and draft bar

One component, two modes, `sc-card`-flat: `display:flex; align-items:center; gap:6px;
border:1px solid var(--sc-border); border-radius: var(--radius-md); padding: 6px 10px`.

**Lens mode.** `.lab` (`codex.mission.label`) 11px uppercase `--sc-fg-2`, then one `.btn`
per mission inside `role="radiogroup"`; glyph `◈`/`◇` `aria-hidden`. Disabled chips get
`aria-describedby` on a hidden span carrying
`codex.mission.disabled.noCargo|noMining|noSalvage` (existing keys) — the reason is always a
fact about the hull. Right group: `codex.detail.draftReset` and `.btn.gold`
`codex.detail.draftApply`.

**Draft mode** (≥1 slot changed) — replaces today's separate save bar:
`codex.detail.draftLabel` · gold chip `codex.detail.draftChanged` / `…ChangedPlural`
(`border-radius: 999px; color: var(--sc-warn); background: color-mix(in srgb,
var(--sc-warn) 8%, transparent)`) · 12px `--sc-fg-2` `codex.detail.draftNotice` · a
`<select>` labelled `codex.detail.draftPersistLabel` with
`codex.detail.draftPersistSession` / `…PersistHangar` · `codex.detail.draftDiscard` ·
`.btn.gold` `codex.detail.draftApplyAndSave`.

**Overflow.** The mock clips (`white-space:nowrap; overflow:hidden`). We do not: below
820px the chip row becomes `overflow-x: auto; scroll-snap-type: x proximity` with
`scrollbar-width: thin`, and the right-hand group wraps onto its own line. Never clip a
control the user must reach.

---

## 6. Loadout column — module block

```
details.mod                  background: var(--sc-bg-1); border:1px solid var(--sc-border);
                             border-radius: var(--radius-md)
└ summary                    list-style:none; cursor:pointer; min-block-size: max(36px, var(--sc-tap-min))
  ├ .m-h2                    flex; gap:8px; padding: 8px 12px; 12px/.14em/uppercase/600; --sc-accent
  │   ├ .grip "⠿"            --sc-fg-2; opacity:.5 — decorative only (§13)
  │   ├ .name
  │   ├ .ct                  census, --sc-fg-2, not uppercase
  │   └ .r                   margin-inline-start:auto; 12px; --sc-fg-2
  │       └ .caret::after    closed → codex.module.caretExpand in --sc-accent
  │                          open   → codex.module.caretCollapse in --sc-fg-2
  └ .peek-wrap > .fold-peek  flex wrap; gap: 6px 14px; padding: 6px 12px 8px; 12px; --sc-fg-2
```

`details.mod > summary .fold-peek { display:flex }` /
`details.mod[open] > summary .fold-peek { display:none }` — the preview **must** live inside
`<summary>` or a closed `<details>` hides it. `[open] .m-h2 { border-block-end: 1px solid
var(--sc-border) }`; closed has none. `summary:hover .caret::after { text-decoration:
underline }`. `summary:focus-visible` gets the standard outline.

**Fold peek content.** `<span class="pk"><i>2× S1</i> WEB aktiv · <i>4.320</i> HP</span>` —
numbers in `<i>` (`font-variant-numeric: tabular-nums; color: var(--sc-fg-0); font-style:
normal`), labels plain `--sc-fg-2`. Pattern: *n × size + name + role*, then the module
aggregate (`codex.module.badge.pool` + figure), then right-aligned `.lock`
`codex.module.peekChange` in `--sc-fg-2`. **No controls while folded** — no grip, no tools.

**Census.** `codex.module.census` (`3 Slots · 2 aktiv · 1 passiv`) or
`codex.module.censusSlots` when the module has no active/passive split.

**Row split control.** `codex.module.rowsSplit` / `codex.module.rowsGrouped` as a two-button
segmented control in `.r`, preserving today's PR #385 behaviour.

### Slot row

```
.m-slot   grid-template-columns: 1fr auto; gap:8px; border:1px solid var(--sc-border);
          border-radius: var(--radius-md); padding: 8px; background: var(--sc-bg-2)
├ .l1     chips: .sz (count+size) · .gr (grade) · .badge · .name (13px --sc-fg-0)
├ .l2     12px --sc-fg-2 — kind · manufacturer (CODE) · class · Grade · shape
├ .l3     12px --sc-fg-2 tabular-nums — full stat line
└ right   flex
    ├ .fig  .n 16px --sc-fg-0 tabular-nums · .u 11px uppercase --sc-fg-2 · .dl delta chip
    └ .tools  two <button> at max(28px, var(--sc-tap-min))
```

`.sz`, `.gr`, `.badge` → `--radius-sm`, 11px, `background: color-mix(in srgb,
var(--sc-bg-0) 60%, transparent)`, `--sc-fg-1`.
Tools: `ⓘ` → `codex.module.toolDetails` (weapon detail window §11), `⇄` →
`codex.module.toolSwap` (picker §10). Both are real `<button type="button">` with
`[attr.aria-label]` interpolating the component name — the mock's `<b>` elements are not
acceptable.

**States.**

| State | Rule |
|---|---|
| hover | `border-color: color-mix(in srgb, var(--sc-accent) 45%, var(--sc-bg-0))` |
| focus-within | `outline: 2px solid var(--sc-accent); outline-offset: 1px` |
| tuned | `border-inline-start: 2px solid var(--sc-warn)`; badge `codex.module.tuned`, hint `codex.module.tunedHint`. Reset removes the edge and the chip entirely. |
| changed | `.fig .dl` delta chip via `deltaTone()` |
| passive | `.m-slot.inactive.grey` → `filter: saturate(.25); background: color-mix(in srgb, var(--sc-bg-0) 88%, #000); border-color: color-mix(in srgb, var(--sc-border) 55%, transparent)`; badge `codex.module.badge.passive` in `.badge.dim` |
| passive hover/focus | `filter: none`, normal `--sc-bg-2` and `--sc-border` — "it stays operable, so the colour comes back". Passive slots are **always swappable**. |
| empty slot | name in `--sc-fg-2` italic, `codex.swap.installedNone`, tools still present |

Under a shield module: `.note` = `border-inline-start: 2px solid var(--sc-warn); background:
color-mix(in srgb, var(--sc-warn) 6%, transparent); padding: 8px 10px; font-size: 12px;
color: var(--sc-fg-1)`, text `codex.module.shieldNote`. The cyan variant `.note.info` uses
`--sc-accent` and `color-mix(… 5%, transparent)`.

---

## 7. Lens behaviour

`{ order: string[], collapsed: string[] }` per mission (`codex-mission.ts`). The lens
**reorders and may fold**; it never removes a module and never makes one unconfigurable.
Kampf folds nothing: order `Bewaffnung › Raketen › Schild-Generatoren › Antrieb & Systeme`.
Transport: `Schilde › Antrieb & Systeme › Raketen › Bewaffnung` with Raketen and Bewaffnung
folded. Folding is a `[open]` change on `details.mod` — no unmount, so scroll position and
draft state survive.

---

## 8. Analysis column

Three `details` cards with the same chrome as §6 but `codex.module.peekRead` as the lock
text. Headers `codex.analysis.offensive|defensive|ship` (existing keys) with `◈`
`aria-hidden`.

- **Offensive** — weapon table `Waffe | Größe | Alpha | Dauer | Burst` + a `Summe` row
  (`border-block-start: 1px solid var(--sc-border)`, `--sc-fg-0`), then Energie/Reichweite/
  Projektil rows, then the missile block.
- **Verteidigung** — Schild (`n Generatoren`: Pool, Regeneration, Voll in), Rumpf &
  Panzerung (Rumpf HP `Σ n Rumpfteile`, Panzerung HP, Reduktion phys./Energie, Deflection,
  Distortion), then the slab.
- **Schiff** — Flugleistung, Masse & Laderaum, Signatur IR/EM/Querschnitt with axes.

`.slab` — `background: var(--sc-bg-2); border-radius: var(--radius-md); padding: 10px;
display:grid; gap:2px`; `.k` 11px `.14em` uppercase `--sc-fg-2`, `.v` 21px tabular-nums
`--sc-fg-0`, `.s` 11px `--sc-fg-2` showing the summands (`Schild 6.480 + Rumpf 9.800`).

**A derived tile whose input is missing is omitted, not summed partially** — and the card
names the omission in a `.note.info` line rather than printing a wrong `Gesamt`.

---

## 9. Energy dock

```
.mini-dock          position: sticky; inset-block-end: 12px; z-index: 14;
                    inline-size: fit-content; max-inline-size: 100%;
                    background: linear-gradient(180deg, var(--sc-bg-2), var(--sc-bg-1));
                    border: 1px solid color-mix(in srgb, var(--sc-accent) 62%, var(--sc-bg-0));
                    border-radius: var(--radius-md); box-shadow: 0 14px 40px rgb(0 0 0 / .6)
├ .md-head          flex; gap:10px; padding: 8px 12px 6px
│   ├ h3            12px/.1em/uppercase/--sc-accent   → codex.energy.title
│   ├ .bud          13px tabular-nums --sc-fg-0 (its <small> 11px --sc-fg-2)
│   └ .act          .pos-pick (3 buttons) + .md-min
├ .md-body          grid-template-columns: auto 1px auto; gap: 12px; padding: 2px 12px 8px
│   ├ .md-pips      flex; gap: 10px          → eight .md-col
│   ├ .vr           background: color-mix(in srgb, var(--sc-accent) 16%, transparent)
│   └ .md-facts     grid-template-columns: repeat(3, auto); gap: 4px 14px
├ .md-strip         (minimised only) flex; gap: 14px; padding: 0 12px 8px; 12px
└ .md-foot          flex; gap: 6px; padding: 6px 12px 8px;
                    border-block-start: 1px solid color-mix(in srgb, var(--sc-accent) 12%, transparent)
```

**Position.** `[data-pos=left|center|right]` → margin logic only; default `center`,
persisted in localStorage keyed by user id. `.pos-pick` = inline-flex, 1px `--sc-border`,
`--radius-md`, buttons separated by an inline-start border, `.on` → `color: var(--sc-accent);
background: color-mix(in srgb, var(--sc-accent) 18%, transparent)`. `role="radiogroup"`
`aria-label="codex.energy.position.title"`, button names
`codex.energy.position.left|center|right`.

**Minimise.** `.md-min` toggles `[data-min]`; label `codex.energy.minimise` /
`codex.energy.expand`, `aria-expanded` mirrors the state, `aria-controls` points at
`.md-body`. Minimised hides `.md-body` **and** `.md-foot`, shows `.md-strip` with budget,
IR, EM, CS, Kühllast, readiness (`codex.energy.readiness.shortOk|shortNo`) — **read only,
no pips, no buttons.**

**Budget.** `codex.energy.budget` = *occupied* segments over total, not capacity. Gold
minimum pips count as occupied.

**Group column** (`.md-col`, eight in fixed order weapons → shields → thrusters → coolers →
radar → lifeSupport → quantum → tractor):

```
.md-col
├ .stack        flex-direction: column-reverse; gap: 2px
│   └ b         inline-size: 22px; block-size: 9px; border-radius: var(--radius-sm)
├ button.grp-btn   min size max(28px, var(--sc-tap-min)); svg .ico 16px
└ .grp-state    11px tabular-nums
```

| Pip | Fill |
|---|---|
| off | `color-mix(in srgb, var(--sc-fg-2) 22%, transparent)` |
| allocated `.on` | `var(--sc-accent)` |
| minimum `.min` | `var(--sc-warn)` |
| group cut (`.md-col.off b`) | `color-mix(in srgb, var(--sc-fg-2) 12%, transparent)` |

`b.top::after { content: attr(data-n) }` — 11px tabular-nums on
`color-mix(in srgb, var(--sc-bg-0) 85%, #000)`, `aria-hidden` (the count is already in the
button's accessible description).

| Group state | `.ico` | `.grp-state` |
|---|---|---|
| active | `--sc-accent` | `--sc-fg-2`, allocated count |
| cut (`aus`) | `color-mix(in srgb, var(--sc-fg-2) 55%, var(--sc-bg-0))` | `--sc-danger`, `codex.energy.state.off` |
| no channel in mode | dimmed | `codex.energy.state.noChannel` (`—`) + tooltip `codex.energy.gap.noChannelInMode` |
| idle | dimmed | `codex.energy.state.idle` (`0`) |

`.grp-btn:hover` → `border-color: color-mix(in srgb, var(--sc-accent) 62%, var(--sc-bg-0));
background: color-mix(in srgb, var(--sc-accent) 15%, transparent)`.
Accessible name: `codex.energy.toggleOff` / `codex.energy.toggleOn` interpolating
`codex.energy.group.*`; `aria-pressed` mirrors "cut"; `aria-describedby` points at the
group's tooltip **and** a hidden span carrying `codex.energy.allocated` /
`codex.energy.minimum`.

**Facts.** `.md-fact` — `.k` 11px `.12em` uppercase `--sc-fg-2` (keys
`codex.energy.fact.ir|em|crossSection`), `.v` 13px tabular-nums `--sc-fg-0`, `.d` delta chip
through `deltaTone()` (IR/EM/Kühllast are `LOWER_IS_BETTER`, so a rise is red **because the
helper says so**). CS never carries a delta — it is hull-derived.
Heat bar `.md-heat .t` — `inline-size: 120px; block-size: 4px; border-radius:
var(--radius-sm)`, fill `--sc-warn`, label `codex.energy.fact.coolingLoad`, value
`codex.energy.coolingPercent` + `codex.energy.coolingValue`. Over 100 % the fill switches to
`--sc-danger` and clamps at 100 % width.
`.md-ok` — `✓` `aria-hidden` + `codex.energy.readiness.ok|no`, 12px, `--sc-success` /
`--sc-warn`.

**Footer.** SCM|NAV segmented (`codex.energy.mode.scm|nav`, `role="radiogroup"`
`aria-label="codex.energy.mode.label"`), then `codex.energy.preset.stealth`,
`codex.energy.preset.auto` (`.on` by default), `codex.energy.preset.reset`.

**Tooltips.** Twelve, keys `codex.energy.tooltip.*`. Rendered as a `.tipbox`:
`position:absolute; inset-block-end: calc(100% + 8px); inline-size: 230px; padding: 8px 10px;
background: var(--sc-bg-2); border: 1px solid color-mix(in srgb, var(--sc-accent) 62%,
var(--sc-bg-0)); border-radius: var(--radius-md); box-shadow: 0 10px 28px rgb(0 0 0 / .6);
font-size: max(12px, var(--sc-fs-floor))`, title `<b>` 11px `.12em` uppercase
`--sc-accent`. Shown on `:hover` **and** `:focus-within`, with `transition: opacity .12s`
guarded by `prefers-reduced-motion`. Every trigger is a real focusable element and the box
is referenced by `aria-describedby`, never `pointer-events:none`-only.

**Gap states.** No reactor data → the pip area is replaced by
`codex.energy.gap.noReactorData` in a `.gaptag`-bordered block and the budget reads `—`.
Schema too old → `codex.energy.gap.reExtractPending` under the header, gold. No cooler data
→ `codex.energy.gap.noCoolingData` replaces the heat bar. Never a zero, never a guess.

**Draft semantics.** Cut groups live in a `ReadonlySet<PowerGroup>` mirrored to the URL
param + localStorage, **never** to `hangar_ship_configs.loadout`. The dock shows
`codex.energy.draftNote` under the footer whenever the set is non-empty.

**Responsive.** ≤820px `.md-body` becomes `1fr` and `.vr` is hidden. <640px the dock becomes
a bottom sheet pinned to the safe area, minimised by default, expanding to a full-width
panel with `.md-pips` in `grid-template-columns: repeat(4, 1fr)`.

---

## 10. Swap picker window

```
.pick-veil     position: fixed; inset: 0; z-index: 150;
               background: color-mix(in srgb, var(--sc-bg-0) 60%, transparent);
               backdrop-filter: blur(4px); display: grid; place-items: center;
               padding: 52px 72px            ← keeps the page and the KPI strip visible
.pick-win      inline-size: 100%; max-inline-size: 1060px; max-block-size: 100%;
               display:flex; flex-direction: column; background: var(--sc-bg-1);
               border: 1px solid color-mix(in srgb, var(--sc-accent) 62%, var(--sc-bg-0));
               border-radius: var(--radius-md); box-shadow: 0 24px 70px rgb(0 0 0 / .7);
               overflow: hidden
.pick-hint     abs top:16px; centred; 12px; --sc-fg-2; pointer-events:none
```

`role="dialog"` + `aria-modal="true"` + `aria-labelledby` on the header, focus trap and
Escape-to-close from today's `codex-swap-picker` (`:108`, `:313-320`). Clicking the veil
closes; the window stops propagation. Hint text `codex.picker.hint`. Focus returns to the
`⇄` button that opened it.

**Header.** `.pick-head` — `background: linear-gradient(180deg, var(--sc-bg-2),
var(--sc-bg-1))`. Title `codex.picker.title` (`{{port}}`, `{{size}}`), right
`codex.picker.installed` and a `✕` `<button>` named `codex.picker.close`.

**Scope bar.** search input (`codex.picker.searchPlaceholder`, visually-hidden label
`codex.picker.searchLabel`, matches name + manufacturer + damage type) ·
`codex.picker.compareWith` + segmented `codex.picker.scope.sameClass|sameFamily|sameSize` ·
`codex.picker.deltaAgainst` + segmented `codex.picker.baseline.equipped|factory`
(`Eingebaut` default) · `codex.picker.count` (`{{n}} von {{total}}`).
Both segmented controls are `role="radiogroup"` with the preceding label as `aria-label`.

**Table.** `table.wt` — `min-inline-size: 1080px; font-size: max(12px,
var(--sc-fs-floor))`. `.pick-scroll` `overflow: auto; border: 1px solid var(--sc-border);
border-radius: var(--radius-md)`, scrollbar 10px with thumb
`color-mix(in srgb, var(--sc-accent) 62%, var(--sc-bg-0))` → `--sc-accent` on hover.
`th { position: sticky; inset-block-start: 0; z-index: 2; background: var(--sc-bg-2) }`;
first column `position: sticky; inset-inline-start: 0; z-index: 3`, and `th:first-child`
`z-index: 4`.

Default 17 columns in order: `codex.picker.col.name`, `.deltaSustained`, `.dps`, `.alpha`,
`.pen`, `.fireRate`, `.range`, `.speed`, `.power`, `.em`, `.hp`, `.distortion`, `.mass`,
`.grade`, `.manufacturer`, `.ammo`, `.spread`. Units come from `codex.picker.unit.*`,
appended in the head as a `<small>` in `--sc-fg-2`.

**Row states.** Fitted row `tr.cur` → `background: color-mix(in srgb, var(--sc-warn) 8%,
transparent)`, first cell `color-mix(in srgb, var(--sc-warn) 14%, var(--sc-bg-0))`, Δ cell
`codex.picker.noDelta`. Under `Ab Werk` the highlight and the `±0` move to the factory row;
if the factory part is not in the filtered set, no row carries `±0` and the baseline is
named in the scope note. Row hover → `background: color-mix(in srgb, var(--sc-accent) 7%,
transparent)`. Rows are `<tr tabindex="0">` inside a `role="grid"`; Enter/Space picks,
accessible name `codex.picker.pickRow`.

**Percent bars** (Alpha, DPS) — a 3px track behind the number, fill `--sc-accent`, scaled
against the best value in the filtered set, plus a 1px `--sc-warn` mark at the overall
optimum with `title` `codex.picker.optimum`.

**Column menu** (`sc-col-menu`, build it reusable). `<details class="colmenu">` inside the
`th`; `summary` = label + `⋮` (`--sc-accent` when `[open]`, otherwise
`color-mix(… 62%…)`), popover `.pop` `inline-size: 190px; background: var(--sc-bg-2);
border: 1px solid var(--sc-border); border-radius: var(--radius-md); box-shadow: 0 10px 28px
rgb(0 0 0 / .6)`. Fixed order: `codex.picker.menu.sort` → `▲ codex.picker.menu.asc` /
`▼ codex.picker.menu.desc`; then numeric `codex.picker.menu.range` with two
`<input type="number">` labelled `codex.picker.menu.from` / `.to` (54px each), or a checkbox
list with per-option counts; footer `codex.picker.menu.filter` / `codex.picker.menu.clear`.
`summary` accessible name `codex.picker.menu.open`. Plain click on the head (outside the
`⋮`) sorts.

**Chips.** Active filters under the table: `.fc` pill, `border-radius: 999px; border: 1px
solid color-mix(in srgb, var(--sc-accent) 62%, var(--sc-bg-0)); background: color-mix(in
srgb, var(--sc-accent) 10%, transparent); color: var(--sc-accent)`, with a `<button>` `✕`
named `codex.picker.chipRemove`.

**Column chooser.** `codex.picker.columns` button above the table opens the same popover
shell listing all ~30 values; available ones are checkboxes (default = the 17 above),
unavailable ones sit in a disabled section headed `codex.picker.columnsUnavailable`.

**Scroll cues.** Under the table, `codex.picker.scrollCue.horizontal` (interpolating the
off-screen column labels) left and `codex.picker.scrollCue.vertical` right, 11px
`--sc-fg-2`, glyphs `aria-hidden`.

**Absent values.** *Not applicable* → `td.gapc` with `codex.picker.dashCell` in `--sc-fg-2`,
`title` `codex.picker.dashCellTitle`, plus the prose line `codex.picker.dashNote` beside the
chips. *No extractor source at all* → the column is **omitted** and named in
`codex.picker.footerMissing`. These two must never look the same.

**Phone.** <640px the veil padding drops to 0 and `.pick-win` goes full-screen
(`max-inline-size: none; border-radius: 0`), the scope bar wraps to two rows, and the
column set falls back to name + Δ + DPS + Alpha with the chooser one tap away.

---

## 11. Weapon detail window (`ⓘ`)

Reuse the existing `sc-codex-component-modal` shell (`role="dialog"`, focus trap, Escape).
Intro `.note.info` with `codex.weaponDetail.intro`. Body `.val-grid`
`grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--sc-gap-2)`.

```
.val-card    background: var(--sc-bg-2); border: 1px solid var(--sc-border);
             border-radius: var(--radius-md); padding: 10px; display:grid; gap: 2px
├ h4         11px/.12em/uppercase/--sc-accent
├ .row       grid-template-columns: 1fr auto  → .k 12px --sc-fg-2 · .v 13px tabular-nums --sc-fg-0
└ .src       11px --sc-fg-2, the P4K struct verbatim (codex.weaponDetail.src.*)
```

`.val-card.miss` → `border: 1px dashed color-mix(in srgb, var(--sc-warn) 40%, transparent);
background: color-mix(in srgb, var(--sc-warn) 4%, transparent)`; `h4` `--sc-warn`; `.src`
`--sc-warn` at `opacity: .8`. `.gapv` values are `--sc-fg-2`.

Cards in order: `damageChannels`, `fireBallistics`, `derived`, `powerSignature`,
`durability`, `physical`, `attachments`, `aiming`, `missing` — keys
`codex.weaponDetail.card.*`, rows `codex.weaponDetail.row.*`, struct names
`codex.weaponDetail.src.*` (kept as-is in both languages; only the trailing prose is
translated). Special values: `codex.weaponDetail.value.none` (`0 = keiner`),
`.empty`, `.dash`, `.magazineEnergy`.

---

## 12. Icon mapping

Existing `codex-category-icon.component.ts` paths (24×24 viewBox, stroke-based,
`stroke-width: 1.5`, `fill: none`, `stroke-linecap: round`) are reused where they exist. The
eight power groups and the four facts:

| Slot | Existing key | New path needed |
|---|---|---|
| Waffen | `weapon` | — |
| Schild-Generatoren | `shield` | — |
| Antriebe | `thruster` | — |
| Kühler | `cooler` | — |
| Radar | — | `radar` |
| Lebenserhaltung | — | `lifeSupport` |
| Quantumantrieb | `quantum` | — |
| Traktorstrahl | — | `tractor` |
| IR fact | — | `ir` |
| EM fact | — | `em` |
| CS fact | — | `crossSection` |
| Kühllast | — | `heat` |

New paths — add to `ICON_PATHS` in the same 24×24 stroke idiom (each a single `d`):

```ts
radar:        'M12 21 A9 9 0 1 1 21 12 M12 21 V12 L21 12 M12 16.5 A4.5 4.5 0 0 0 16.5 12 M12 12 L18.4 5.6',
lifeSupport:  'M9 4 H15 V8 C15 9.2 15.6 10 16.4 10.8 L17.6 12 C18.5 12.9 19 14 19 15.3 V19 A2 2 0 0 1 17 21 H7 A2 2 0 0 1 5 19 V15.3 C5 14 5.5 12.9 6.4 12 L7.6 10.8 C8.4 10 9 9.2 9 8 Z M9.5 15 H14.5 M12 12.5 V17.5',
tractor:      'M9 3 H15 L15 6 H9 Z M9.5 6 L4 20 M14.5 6 L20 20 M6.6 13 H17.4 M5.3 16.5 H18.7 M12 9 V20',
ir:           'M12 3 C12 3 8.5 7 8.5 10 A3.5 3.5 0 0 0 15.5 10 C15.5 7 12 3 12 3 Z M12 21 A6 6 0 0 1 6 15 M12 21 A6 6 0 0 0 18 15 M4 12 H2 M22 12 H20',
em:           'M12 5 V19 M8 8 A5 5 0 0 0 8 16 M16 8 A5 5 0 0 1 16 16 M5 5 A10 10 0 0 0 5 19 M19 5 A10 10 0 0 1 19 19',
crossSection: 'M3 12 A9 9 0 0 1 21 12 A9 9 0 0 1 3 12 M12 7.5 L16.5 12 L12 16.5 L7.5 12 Z M12 3 V5 M12 19 V21 M3 12 H5 M19 12 H21',
heat:         'M12 2.5 C12 2.5 16 6.5 16 10 A4 4 0 0 1 8 10 C8 8.4 9 7 9 7 C9 8.6 10 9.5 10.8 9.5 C11.8 9.5 12 8.2 12 2.5 Z M6 16 H18 M6 19 H18',
```

Colours: group icons inherit `currentColor` from `.md-col` state (accent / dimmed);
fact icons are `--sc-fg-2`. `crossSection` and `heat` never take the accent — they are
read-only facts. Every `<svg>` inside a labelled button is `aria-hidden="true"`.

---

## 13. Accessibility checklist

- Every icon-only control is a `<button type="button">` with a translated accessible name.
  The mock's `<b class="tools">`, `<span class="grp-btn">` and hover-only tooltips do not
  ship.
- Tooltips: focusable trigger, `aria-describedby` to the box, visible on `:focus-within`,
  dismissible with Escape. `.tipbox` is never `pointer-events:none`-only content.
- Folds are native `<details>/<summary>`; the caret text is inside the summary so the
  accessible name changes with the state. No `aria-expanded` on top of `<details>`.
- Picker and weapon window: `role="dialog"`, `aria-modal`, `aria-labelledby`, focus trap,
  Escape closes, focus returns to the opener.
- Radiogroups for all segmented controls (mission chips, rank profiles, dock position,
  SCM/NAV, scope, baseline).
- Disabled controls keep their reason in an `aria-describedby` span, not only in `title`.
- The radar and every bar expose a text equivalent; the hex polygon alone is not the
  information.
- The `⠿` grip is decorative until drag-to-reorder actually exists — it is `aria-hidden`
  and not focusable. Module order is owned by the lens (MASTER §5); do not ship a second,
  conflicting ordering affordance.
- Tab order: crumb → hero actions → rank controls → KPI tooltips → mission chips → draft
  controls → loadout modules (summary → tools per row) → analysis cards → dock.
  The dock is last in the DOM but visually pinned; that is correct — it acts on the page
  above it.
- `prefers-reduced-motion: reduce` removes the tooltip fade, the sticky shadow transition
  and any bar-width animation.

---

## 14. Deviations from the mock

Rule: **structure, logic and information follow the concept; polish follows the app.**

- **Canvas and panels.** The mock's `#050d14` / `#0b1a26` are considerably darker than
  `--sc-bg-0` / `--sc-bg-1`. We use the app tokens. The concept's darkness is illustration
  licence, not a request to re-tone the global palette.
- **Cyan.** `#5fd8ec` → `--sc-accent` (`#52c1e6`). The mock's dim cyan `#3f93a8` has no app
  equivalent and becomes a documented `color-mix` of the accent rather than a twelfth
  hard-coded colour.
- **Radii.** The mock uses 3px and 6px; the app scale is 2/4px. Everything at 3px and 6px
  collapses to `--radius-md` (4px), pips and micro-chips stay `--radius-sm` (2px).
  Pills stay 999px.
- **Shadows.** The app ships only cyan glows. The dock, picker and tooltips genuinely need
  elevation over content, so black drop shadows are added — but `--sc-glow` remains the
  only focus treatment.
- **Type floor.** The mock's 8–9.5px micro-labels are unreadable and below the app's
  `--sc-fs-floor`. They map to 11px and floor to 12px on coarse pointers. This makes the
  KPI strip and the dock ~8 % taller than the mock; the layout absorbs it.
- **Tap targets.** 22×17px tool buttons and 22×9px pips are visual sizes only; the hit area
  is `max(28px, var(--sc-tap-min))`.
- **Mission bar never clips.** The mock's `white-space:nowrap; overflow:hidden` silently
  hides chips. We scroll instead.
- **Sticky offset.** The mock's `top: 72px` came from a change strip the app does not have.
  We keep the existing `calc(var(--sc-imp-banner-h, 0px) + 64px)`.
- **Delta inversion.** The mock inverts `.d.up`/`.d.dn` inside the dock via a container
  rule. We invert at the *data* layer with `deltaTone()`; the CSS classes keep one meaning
  each everywhere.
- **Icon viewBox.** The brief asked for 16×16; the app's icon set is 24×24 with a single
  stroke path per glyph. The new glyphs follow the app so they can live in `ICON_PATHS`
  and be rendered at 16px via `width`/`height`.
- **`±0`.** The mock prints it in the picker Δ column; the KPI strip and slot figures never
  do — they simply drop the chip.
- **Grip.** Rendered (it is part of the module header's visual rhythm) but inert and
  `aria-hidden`, because drag-reordering conflicts with the mission lens owning order.
- **Anything the concept does not specify** (energy formulas, per-pip allocation,
  NAV effects on the other seven groups, the non-Kampf lens tables) is **not invented
  here**. Those are MASTER §8a / §15 decisions and C §6 open questions; the frontend
  renders a gap where the model has no answer.
