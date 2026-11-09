# F7 — Compress the Bestand filter rows

Binding: `implement.md` F3, F4, F7, I9, I10, H1, S1; `verbatim.md`; mock `rounds/03.html` (a3-s2/s3/s4, `.d14-chips` kind, `.d14-sub` sub-kind, place). Chip look stays `d10-chip` (30 px, `--line` border, pill, `.zero` = opacity .45).

User words: "die drei filterzeilen noch so naja" (R3 a3-5) · "das muss deterministischer sein, ich will immer wieder alle optionen sehen" (R1) · "scu und zahlen … nicht hilfreich" (R2) · `q-places=grouped`.

## Decision

**One filter bar, one wrapping flow, a single bordered container. No second and third full-width row.**

Order, left to right (DOM order = visual order = Tab order):

1. **Kind chips** (radiogroup): `Alle` · the tab's kinds. Inventar: Rohstoffe, Waffen, Rüstung, Sonstiges, Sets. Always all, always in this order.
2. **Sub-kind group**, only after a kind is chosen, inserted **directly behind the active kind chip** (not on a new row): a thin cyan divider (`2px`, `rgba(82,193,230,.35)`, the old `.d14-sub` border) + the sub chips of that kind. The other kinds follow after the group, so the group reads as the unfolded child of its kind.
3. **Place `<sc-select>`** (Inventar only), `margin-inline-start:auto` = pinned to the row end. Trigger shows "Alle Orte" or "Area18 · Stanton".
4. **Toggles** `Reserviert`, `Zerlegbar` (existing `d10-tog`, not chips): after the select, same flow.

Rejected: (a) sub-kind as a select — hides the options the user wants to always see (R1 pin); (b) sub-kind chips on an own row — that is today's complaint; (c) place as chips — unbounded list, replaced by `q-places=grouped`.

Why inline works: Rüstung has 6 subs, Waffen about 7; at 1280 px the longest state (Rüstung active) is ~5 kind + 6 sub + select + 2 toggles and fits one row; where it does not (phone, narrow tablet, Waffen at 768) it wraps **within the same container**, still one visual block (see phone).

## Common rules (F3 / F4)

- `Alle` carries **no number**, ever (F3). Other chips carry a count only as a quiet `<b>` after the label in `--fg3`; an empty option shows `0`, is dimmed (`.zero`, opacity .45) and **stays focusable and clickable** (shows the empty-area state, F5). No option is ever removed because the player owns none (F4). The option list comes from the Codex/enum, never from the owned data.
- Tabs carry no counts (F1); the counts live only on the chips. In Hangar and Sammlung chip counts are optional; if shown they follow the same `<b>` + `.zero` rule.
- Chips are `<button role="radio">` inside `role="radiogroup"`, not `scAction`, not anchors (filter state, not navigation). Selected: `aria-checked="true"`, `--sc-accent` border + 12% fill (mock `.d10-chip.on`). Clicking the selected sub-kind again returns to the kind level; clicking the active kind again returns to `Alle`.
- State lives in the URL query (`?kind=ruestung&sub=helm&ort=area18-stanton`) so a filtered view is a shareable anchor and survives reload; switching kind clears `sub`; switching tab clears all.
- Active-filter reset: when any of kind/sub/place/toggle is set, a text-less tertiary `scAction` (icon X, `aria-label` + `[scTooltip]` "Filter zurücksetzen") appears at the row end after the toggles. No new row.

## Sizing (tokens, no new constants)

- Bar: `display:flex; flex-wrap:wrap; align-items:center; gap:var(--sc-space-2)` (6 px chips) with `column-gap:var(--sc-space-2)`, `row-gap:var(--sc-space-2)`; padding `var(--sc-space-2) var(--sc-space-3)`; border `1px solid var(--line)`, radius as `.d14-bay` (6 px). Width = the page frame (`--sc-page-max`), no own `max-width`.
- Kind chip height 30 px; sub chips 26 px / 11.5 px (as mock) so the child level reads smaller.
- Touch (`pointer: coarse`): every chip, the select trigger and toggles get `min-height:48px` (gate baseline, measures 43 at 44) — chips grow by padding, label size stays.
- Select trigger: `min-width:11rem`, max `18rem`; panel max-height `min(60dvh, 28rem)`.

## States (Inventar, desktop >= 1024 px)

```
S0 none chosen
[Alle] Rohstoffe 12 · Waffen 3 · Rüstung 7 · Sonstiges 0 · Sets 2      (Alle Orte v)  ( ) Reserviert  ( ) Zerlegbar
        ^ Sonstiges dimmed, still clickable

S1 kind chosen (Rüstung)
Alle  Rohstoffe 12 · Waffen 3 · [Rüstung 7] ┃ Helm 2 · Torso 3 · Arme 0 · Beine 1 · Unterkleidung 1 · Rucksack 0 · Sonstiges 0 ┃ Sets 2     (Alle Orte v)  ( ) Reserviert  ( ) Zerlegbar  [x]
                                              ^ sub group directly behind its kind; Arme/Rucksack dimmed

S2 kind + sub (Helm)
Alle  …  [Rüstung 7] ┃ [Helm 2] Torso 3 · Arme 0 …                                        (Alle Orte v)  …  [x]

S3 place set (Area18)
Alle  …  Rüstung 7 ┃ Helm …                                                              [(Area18 · Stanton) v]  …  [x]
   select trigger gets the accent border + place name; chips' counts now count inside Area18
```

Place select panel (`sc-select`, `q-places=grouped`, I10): search input sticky on top; groups = system, then planet/moon as sub-heading; entries = place + amount ("Area18 — 46 SCU", unit by what the kind shows); entries with 0 dimmed, still selectable; first entry "Alle Orte". The list is the full place catalogue (deterministic like F4), not only places the player holds.

Counts always reflect the **other** active filters (kind counts honour place + toggles; sub counts honour place + toggles + kind), so `0` means "nothing here under the current filter", never "does not exist".

## Phone (375 px)

- Same single container; chips wrap, no horizontal chip scroll (nothing is hidden, F4).
- Priority order stays, so wrapping gives: row 1 `Alle · Rohstoffe · Waffen`, row 2 `Rüstung ┃ Helm · Torso …` (the sub group wraps under its kind, keeping its left divider as `border-left` on its first line), then the remaining kinds, then the select at **full width** (`flex:1 1 100%`), then the two toggles side by side, `[x]` at the end of that line.
- With a kind chosen the unchosen kinds **collapse below the group** (they stay, order unchanged) so the sub chips sit within the first two lines, not pushed off screen.
- Bar is not sticky; only the page content scrolls. The select panel is a bottom sheet: `max-height:min(70dvh, 28rem)`, search on top, bottom padding `--sc-float-bottom` so it clears the feedback launcher.

Tablet (768): same as desktop, wraps after the sub group once the row is full; the select drops to its own line only if it would be narrower than its `min-width`.

## Keyboard

- Tab enters the bar once per group: kinds (roving tabindex, one stop) → sub chips (one stop, only if present) → place select → each toggle → reset. Arrow Left/Right moves inside a group and selects on focus move is **off** (select on Space/Enter); Home/End first/last.
- Moving focus never reorders; when the kind changes, the sub group inserts and focus stays on the kind chip. Escape inside the sub group returns focus to the kind chip.
- Place select: Enter/Space opens, typing goes to the search field, Arrow Up/Down move, Enter selects, Escape closes and returns focus to the trigger (standard `sc-select`).
- No hotkeys on the filter chips (orchestrator decision: digit keys collide with amount and search input; filters are not an essential action).
- Live region (`aria-live="polite"`, `.sc-sr-only`): "Rüstung, Helm: 2 Treffer"; empty: "0 Treffer".

## Hangar (H1, screen a3-s9) — same pattern

```
Alle  Pledge 4 · Ingame 6 · Leihschiff 0   ┃   Alle Rollen  Kampf 3 · Fracht 2 · Bergbau 1 · Bergung 0 · …            (Sortierung v)
```
- Two radiogroups in one flowing bar: origin (Pledge, Ingame, Leihschiff) then role (from the Codex roles, always the full list, F4/D8), separated by a vertical `--line` divider instead of a second row; each group has its own `Alle` (no number). Origin `Alle` sits first in the bar, role `Alle` is labelled "Alle Rollen". Sort is an `sc-select` at the row end (with the ⋮ menu outside the bar). Phone: origin group, then role group wrap as two blocks, no scroll.
- Keyboard and URL as above (`?herkunft=…&rolle=…`).

## Sammlung (S1, screen a3-s10)

```
Alle  Blaupausen 14 · Ruf 9 · News 0 · Galerie 3
```
- One group, no sub-kind, no place; fixed order Blaupausen, Ruf, News, Galerie, `Alle` first. Counts optional per F4, dimmed at 0. Same chip, same keyboard, same URL (`?art=blaupausen`).

## Acceptance for parity QA

1. At 1280 and 1920 px every Inventar state S0–S3 has exactly **one** bordered filter container; chips of kind and sub-kind share a baseline (one line when they fit).
2. No state renders three full-width stacked chip rows; at 375 px the bar is a single wrapped block.
3. Option set is identical for a player with an empty Bestand and one with full Bestand (only counts and dimming differ).
4. `Alle` shows no number in all three tabs; no "Alle 0".
5. Place select lists every place, grouped, searchable, with amounts and dimmed empties; no native `<select>`.
6. Keyboard: full operation without a mouse, focus never lost on kind change.
