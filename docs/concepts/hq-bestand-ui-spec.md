# HQ Bestand — UI spec (Frachtdeck)

Living spec of the HQ page "Bestand" (`/hq#inventar`, component `src/app/hq/stock/hq-stock.component.ts`).
Source: concept `docs/concepts/20261108-2135-hq-bestand/` (design `frachtdeck3`, round 3; brief `briefs/implement.md`,
filter bar `briefs/f7-filter-rows.md`). Change this file together with the page.

## Frame

- Tabs **Alles · Inventar · Hangar · Sammlung**, as real anchors (`hqStockLink({ tab })` →
  `/hq?bestand=<tab>#inventar`). A link without `bestand` opens **Inventar**. Tabs carry the item-path icons
  (`PATH_ICONS`: inventar / hangar / sammlung — the same as the search) and **no counts, no SCU**.
- `Alles` is one deck with every lane: Rohstoffe, Waffen, Rüstung, Sonstiges, Sets, Schiffe, Sammlung.
- The page has no own width: the shell frame (`--sc-page-max`) sizes it. The host keeps
  `padding-bottom: var(--sc-fab-clear-block)` so nothing sits under the feedback launcher; the footer keeps the
  App-Status lane (`.ticker-room`) free.
- Nothing is clipped: the deck pages to what fits between the bar and the launcher lane (`measure()`: columns from the
  deck width, rows from the viewport below the deck minus `--sc-fab-clear-block`; below 1024 px a fixed 8 rows and the
  page scrolls). The pager only appears with more than one page.

## Filter bar (one container)

One bordered flex-wrap container, never stacked chip rows. Order = Tab order:

1. Kind chips (`role=radiogroup`, roving focus with arrows/Home/End, select on Space/Enter):
   `Alle` + Rohstoffe, Waffen, Rüstung, Sonstiges, Sets (Alles adds Schiffe, Sammlung after a divider).
2. Sub-kind chips **inline behind the active kind** (smaller, dashed): Rohstoffe › Erz, Raffiniert; Rüstung › Helm,
   Torso, Arme, Beine, Unterkleidung, Rucksack; Waffen › Pistole, Primärwaffe, Schwere Waffe, Nahkampf, Wurfwaffe,
   Gadget, Sonstige. Escape in the sub group returns focus to the kind chip.
3. Place select (`sc-hq-place-select`), pinned to the row end: search field on top, every catalogue place grouped by
   system and planet (`hq-stock-places.ts`), the container count under the other filters beside each, empty ones dimmed.
   Phone: full-width trigger, the panel is a bottom sheet clearing `--sc-float-bottom`.
4. Toggles Reserviert, Zerlegbar; then the reset (tertiary X) while any filter is set.

Rules: `Alle` never carries a number. Every option always renders (the list comes from the enum/Codex, never from the
data); an empty option shows `0`, is dimmed and stays clickable. Counts honour the **other** active filters.
State lives in the URL: `cat`, `sub`, `ort`, `res=1`, `zerlegbar=1` (Hangar: `herkunft`, `rolle`; Sammlung: `art`);
clicking the active kind/sub again clears it, a new kind clears `sub`, a new tab clears everything. No hotkeys on
filters. An `aria-live` region announces the hit count.

## Inventar deck

- **Bays** (`.bays`): one per place the filter shows; width = number of shown containers (flex-grow), never SCU or
  pieces; each bay keeps at least three letters of its name (`min-width: calc(3ch + padding)`), full name in the
  tooltip. A bay is a place filter toggle. A ship's hold is labelled with the ship's place:
  `Cutlass` / `Area18 (Stanton)` from `hq_ship_storage`; without a stored place `Weltall`. Never a bare "Frachtraum".
- **Containers** (`sc-hq-crate`): one per resource and place (`aggregateQuality(rows, 'place')`), the quality mark
  `Ø Q 780` with the range, colour band by average quality, unknown quality = grey `Q ?`. Only the reserved share is
  hatched. Hover **and** keyboard focus show a tooltip with "reserviert", the amount, who for, and the exact quality per
  stack. Pieces render as the smaller box with their Codex slot and the scrap mark.
- **Lanes** per kind in fixed order; size class (xl/l/m/s) relative to the lane's largest amount.
- **Sets** lane (kind `Sets`, or with `Alle` when the player has sets): tiles link to `/hq/locker/:id`, plus
  "+ Set anlegen" (prompt for the name, creates an FPS set, opens its editor). The deep link to this view is
  `hqStockLink({ tab: 'inventar', cat: 'sets' })`; the Friends "adopted" link in `hq-stock-shared.component.ts` uses it.
- **Quality view** ("Eisen nach Qualität"): appears when one material is selected (any places) or the search shows one
  material only — bars per 100-quality band (`qualityBands`), the reserved part of a bar hatched, the unknown stack as
  a grey bar, the containers of that item below.
- **Scrap**: `ScrapInfoService` → `zerlegbar` / `nicht zerlegbar` / `unbekannt` (grey). Until the extractor fills
  `codex_blueprints.dismantlable` everything is `unbekannt`; the Zerlegbar toggle then shows nothing — never a guess.

## Modes and selection

- Segment switch **Übersicht / Tabelle**. Tabelle (`sc-hq-stock-table`) in `.sc-table-scroll`: item + sub-kind,
  place, Ø quality, amount as an in-place number field (change/Enter writes `setAmount`), reserved, scrap, delete.
- Selection by highlighting (crate `aria-pressed`, row `aria-selected`), never checkboxes. With a selection a bar
  docks at the bottom (`--sc-float-bottom`, `.sc-dock-phone`, `--sc-fab-clear-inline`): **Reservieren** (purpose
  prompt, reserves the free amount), **Verkaufen**, **Abholen planen**, **Löschen** (danger confirm), clear.
- Verkaufen / Abholen planen / "wünschen und einplanen" hand over to `NachschubTargetPicker.open({ intent, lines })`
  (`sell` / `pickup` / `buy`). Lines come from `linesOf`: one line per item, one stop per selected place with its
  free amount, largest first, the place's system attached. The picker decides the target (existing or new Nachschub).

## Ladeprotokoll

Beside the bays (right column; narrow screens: above the deck). One connected list, newest first: removals
(`HqInventoryService.lastRemovals(live.events())` — the last ten, manual ones included, no time window) and
reservations. Per line only icon + delta + item + place + time; three lines visible, "Alle n Änderungen" expands. A
removal line puts the item back on the wishlist; "Nachbestellen (n)" puts all listed removals with their amounts on
it. The log follows place, kind/sub and search text. The head line names the current filter and the hit count.

## Search

The subheader search is the page search (`ShellChromeService.registerPageSearch`); the page has no own field. Its chip
follows the tab (`hqContext(..., stockTab)`: Bestand / Inventar / Hangar / Sammlung, key stays `hqStock`). Tiers:
the active tab's matches (the deck itself), then "Auch im Bestand" (the other areas, anchors with `focus`), then the
Codex ("auf die Wunschliste"). `q>700` / `Q ≥ 700` in the text sets a minimum quality.

Alternatives (`alternativesFor`) appear with a text and **at most three hits**: liegt woanders (same item outside the
place/sub filter, free amount, "Abholen planen"), wünschen und einplanen (with the minimum quality), Ersatz (same Codex
slot, meets the quality), selbst herstellen (owned blueprint by name).

## Hangar and Sammlung

- Hangar bar: origin (Pledge, Ingame, Leihschiff) and role (Codex `SHIP_ROLES` via `ensureKinds`) as two radiogroups
  in one bar, `Alle` / `Alle Rollen`, the wishlist counter as an anchor to the cart. Ship tiles show place, origin,
  role and the number of variants (carried over from the old hangar dashboard). ⋮ menu: "Importieren …" anchor to
  `/hq/hangar/import`, and the danger reset.
- Sammlung bar: Blaupausen, Ruf, News, Galerie. Ruf stays an honest empty panel; News/Galerie show their saved count
  and a link to their page.

## Empty states

One sentence, one primary action, one second way, no 0, no pager. Inventar: "Eintragen" + "Mit der App einlesen";
filtered empty: "Filter zurücksetzen"; Hangar: "Schiff anlegen" + "RSI-Hangar holen"; Sammlung: "Blaupause anlegen" +
"Im Codex stöbern".

## Degradation

Until the wave-1 migrations are pushed, `stacks`, reservations, removals and kinds come back empty: containers show
`Q ?`, the log shows snapshot drops only, sub-kinds fall back to the row heuristics (weapons/armor tokens, ore vs
refined), roles stay unset (role chips 0). No error state for missing columns.

## Manual entries

The capture form of the stock popup starts with the last known location (`HqInventoryService.lastKnownLocation()`),
editable, never overwriting typed text. The sub-kind of a manual entry follows from the Codex class it is picked from.
