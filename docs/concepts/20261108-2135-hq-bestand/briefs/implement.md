# Implement brief — HQ Bestand (round 3, action implement)

Binding sources, in this order (later rounds override earlier ones):

- Decisions log: [`../../20261108-2135-hq-bestand-decisions.json`](../../20261108-2135-hq-bestand-decisions.json)
- Every comment, annotation answer and pin, word for word: [`verbatim.md`](verbatim.md) (generated from `payload-r1.json`, `payload-r2.json`, `payload-r3.json`)
- Backlog handover (sets, import, dashboard-only features): [`04-backlog-handover.md`](04-backlog-handover.md)
- The approved design: `rounds/03.html` (design `frachtdeck3`, screens `a3-s1` … `a3-s10`, CSS prefix `d14-`; the shared Frachtdeck parts reuse `d10-` from `rounds/02.html`). Parity lines: [`../parity.md`](../parity.md)
- Living specs to respect and update: `docs/concepts/hq-einstieg-ui-spec.md`, `docs/concepts/nachschub-hq-ui-spec.md`. Add a new `docs/concepts/hq-bestand-ui-spec.md` with the Bestand rules below.

## Out of scope here (owned elsewhere)

- **App-Status bottom left** (round 1 `q-states=four`, `q-visible=yes`, "App" not "Companion", the per-page outlook): built by session `hq-app-status-unten-link`, PR StarOrga/Verse-Companion-Web#1038. Do **not** touch `src/app/hq/now/hq-live-ticker*`, `hq-app-status.util*`, `hq-app-connection.service*`, `hq-now.component*`, `hq-start-tiles.component*`, `hq-app-launch.component.ts`. Bestand only keeps the launcher lane free (`--sc-fab-clear-*`).
- **Loot overlay** of the desktop app: issue #1033. **"Nachschub" wording**: issue #1037 — keep today's word, invent no new one.
- **Cross-Nachschub stop merging in Jetzt**: rejected (R3 `q-route=none`).

## Checklist (one line per accepted item; agents report each line `done` / `partial` / `not done` + evidence)

### Frame, tabs, empty states (frontend)

- [ ] **F1** Tabs: `Alles` · `Inventar` · `Hangar` · `Sammlung`. `Alles` = one deck with every lane (Rohstoffe, Waffen, Rüstung, Sonstiges, Schiffe, Sammlung). Tabs carry **no SCU and no counts** (R2 pin "scu und zahlen dort in der leiste sind nicht hilfreich", R2 pin "Hier brauchen wir die auswahl alles noch!", R3 a3-1 accepted). Deep-link `hqStockLink({tab})` gains `alles`; the default tab stays `inventar` for existing links.
- [ ] **F2** Each tab is thematically distinct: Inventar = cargo deck with bays, Hangar = ship bays, Sammlung = archive. Icons are **exactly** the `PATH_ICONS` from `src/app/shared/item-path/path-icons.ts` used by the search (R1 anno-r-a1).
- [ ] **F3** Filter chip "Alle" has no number (R1 `q-alle=nozero`); no "Alle 0" anywhere.
- [ ] **F4** Filters are deterministic: every option always shown, empty ones dimmed with 0, never hidden because the player has none (R1 pin "das muss deterministischer sein…").
- [ ] **F5** Empty area: one sentence, one primary action, one second way; no 0, no pager (R1 `q-empty=sentence`; Hangar: "Schiff anlegen" + "RSI-Hangar holen").
- [ ] **F6** Nothing is clipped: the grid pages but measures its area without the bar, β button and feedback launcher (`--sc-fab-clear-*`); Ruf directly below the grid; page only as tall as needed (R1 `q-frame=paged`, original point a). The page uses the shell frame width (`--sc-page-max`), never its own max-width (R1 "die seitenbreite ist nicht die originale").
- [ ] **F7** Filter rows: R3 a3-5 accepts sub-filters as a second row but says "Ok, wobei ich die drei filterzeilen noch so naja finde!" → compress: kind + sub-filter + place must not read as three stacked bars (e.g. sub-filter chips unfold inline after the chosen kind, place as one `sc-select` at the row's end). Designer decides the exact form; parity QA checks there are never three full-width chip rows.

### Inventar — Frachtdeck (frontend)

- [ ] **I1** Loading bays per place: label = place + system, **at least 3 letters of the name** even in the narrowest bay (R3 anno-a3-2 "aber min. 3 buchstaben im namen!"); bay width follows what the current filter shows, not fixed SCU (R3 a3-2, R2 anno-a-1 "Relative größe auch gut… nicht nach scu only filtern oder stück zahl").
- [ ] **I2** Ship storage: a ship's cargo is shown at the **ship's location** (system + place) — "Cutlass · Area18 (Stanton)"; only when the ship is in space "Cutlass · Weltall" (R3 pin a3-s2 "aber die cutlass ist ja auch irgendwo!…"). Never a bare "Frachtraum".
- [ ] **I3** One container per resource and place, same box as on HQ Start (recognition), with the **average quality** mark "Ø Q 780" and the range beside it (R2 pin a-s3 "Die sollten genauso aussehen wie auf der startseite nur mit qualität label!…", R2 anno-a-2 "alle eisen aggregiert … an einem standort", R3 anno-a3-3 "ok!").
- [ ] **I4** Hover / focus on a container or bar shows the word "reserviert", the reserved amount and the exact quality per stack (R3 anno-a3-6 "das wort und wie viel reserviert, gern anzeigen bei hover over, auch die genaue qualität!"). Via `[scTooltip]`, keyboard-reachable.
- [ ] **I5** Only the reserved part of a bar is hatched, never the whole bar (R2 anno-a-5, R3 a3-6).
- [ ] **I6** Resource detail "Eisen nach Qualität" (screen a3-s5): bars per quality band, stacks below as the same containers, quality highlighted, reservations shown.
- [ ] **I7** Overview mode (deck) and detail mode (table, screen a3-s6) — table stays Excel-like manageable: edit amount, delete wrong/outdated entries (R1 design-register comment).
- [ ] **I8** Selection in overview, log and table by **highlighting, not checkboxes** (R3 pin a3-s6 "Dort auswählen bitte mit highlighting statt checkboxen…"); the selection bar offers Reservieren, Verkaufen, Abholen planen, Löschen everywhere a selection exists (R3 pin a3-s6 Verkaufen "Gern das auch einführen für die übersicht ansicht…", pin Reservieren "super und raffiniert").
- [ ] **I9** Sub-filters from the Codex type and slot: Rüstung › Helm, Torso, Arme, Beine, Unterkleidung, Rucksack; Waffen › Pistole … Nahkampf; empty sub-kinds dimmed with 0; manual entries pick their sub-kind on entry (R3 `q-subfilter=codex`, R2 anno-a-4).
- [ ] **I10** Place filter: one `sc-select` with **all** places grouped by system and planet, search field on top, occupied places show their amount, empty ones dimmed (R2 `q-places=grouped`). Filters apply to the bays and the log too (R2 anno-a-3 "bitte auch filter hierauf anwenden").
- [ ] **I11** Load log (Ladeprotokoll) at the top next to the bays, follows every filter (R2 anno-a-3 "ein Stück höher gezogen … dort wo jetzt Orte sind"); **less text, peppier** (R3 pin a3-s1 "Das panel noch etwas peppiger, noch etwas weniger textuell, weniger erklärungen!"): icon + delta + item + place per line, no explanatory sentences.
- [ ] **I12** Last changes and "zuletzt aufgebraucht" are **one connected log at the top**, not a block at the bottom (R3 pin a3-s1 "Das geht hier unten irgendwie unter und ich sehe auch nicht das protokoll zusammenhängend oben letzte änderungen"); three lines visible, extendable (R2 anno-c-3 "letzten drei … extendable").
- [ ] **I13** "Zuletzt aufgebraucht" = the **last ten removals**, independent of sessions, manual removals included (R3 `q-recent=changes`, R2 q-reorder note "anhand der letzten Aktivitäten … egal wann"). Reorder offers all of them with amount, not only the last one (R1 "Nachbestellen gern auch weiteres nicht nur das letzte").
- [ ] **I14** Search in the subheader is the page search: tiered — active area first, then the rest of the Bestand, then Codex with "Auf die Wunschliste" (R1 `q-search=tiered`, original point c). The chip follows the tab (`Alles` → whole Bestand). Remove the page's second local search field or make it the same query.
- [ ] **I15** Alternatives on an empty result **and on searches with ≤ 3 hits** (R3 pin a3-s7 "Gern auch bei suche mit <= 3 Treffern!"): liegt woanders (place, amount, free amount, one click plans the pick-up), wünschen + einplanen with the minimum value (e.g. Eisen Q ≥ 700), Ersatz from the same blueprint / swap table (`swap-table.ts`), selbst herstellen when a blueprint is owned (R2 `q-alt`).
- [ ] **I16** Manual entries default to the **last known location** (`hq_live_state.state.location`), editable (R1 design-register comment).
- [ ] **I17** "Put back on the wishlist" from used-up / log lines (R1 design-register comment; existing `hq-stock-wish.ts`).
- [ ] **I18** Scrap info: "zerlegbar" / "nicht zerlegbar" / "unbekannt" (grey) per item, never a guessed yes (R2 `q-scrap=extract`, R1 "verschrottbar vs nicht im Craft-Fabrikator").
- [ ] **I19** "Was habe ich in Area18": place filter view sorted by amount, searchable (screen a3-s3, R1 design-register comment).

### Hangar and Sammlung (frontend)

- [ ] **H1** Hangar filters: origin (Pledge, Ingame, Leihschiff) and role from the Codex (Kampf, Fracht, Bergbau, Bergung …) (R1 `q-filter` origin + role), deterministic per F4. Screen a3-s9.
- [ ] **H2** Hangar ⋮ menu: "Importieren…" as a real anchor to `/hq/hangar/import` (brief 04 item 2).
- [ ] **H3** Wishlist counter and variant list per ship: check against the old `HangarDashboardComponent`; carry over what Bestand lacks or state why not (brief 04 item 3).
- [ ] **S1** Sammlung filters: Blaupausen, Ruf, News, Galerie (R1 `q-filter` kind). Screen a3-s10.
- [ ] **S2** Sets live in Inventar as filter "Sets": a set is a tile leading to the set editor `/hq/locker/:id`, plus a "+ Set anlegen" entry; the "Set anlegen" links in `codex/set/add-to-set.component.ts`, `codex/stage/hangar-picker.component.ts`, `hq/stock/hq-stock-shared.component.ts` point to the new Bestand deep link instead of `hqLocker` (R1 `q-sets=inv`, brief 04 item 1). Tell session `backlog` once `/hq/locker` can redirect.

### Data and contracts (core)

- [ ] **D1** Quality column on inventory rows: one stack per (place, item, quality); null = "Qualität unbekannt"; the app writes it, manual entry optional (R2 `q-quality=app`). Desktop-app contract doc under `docs/contracts/` names the field.
- [ ] **D2** Reservations: friend (from `FriendsService`, carries the friend's id, filter "Reserviert" groups by friend), free text, the friend **sees it on their side** (new read path — RLS/RPC so the friend can read only reservations made for them), expiry date that frees the amount by itself (R2 `q-reserve` friend, text, notify, expire). Editable afterwards (R1 "reservieren … editierbar").
- [ ] **D3** Manual removals (`takeOut`, `deleteRow`, amount reductions) write an inventory event so I13 counts them (R3 `q-recent=changes`).
- [ ] **D4** Pick-up line ("gather"): one Nachschub line that collects one item from several places and creates its own route ordered by amount, reorderable; Jetzt ticks each stop (R2 `q-pickup=gather`).
- [ ] **D5** Pick-up and sell from Bestand can be added to an **existing** Nachschub, repeatedly, or to a new one (R3 q-route note "man kann ja mehrfach das zu einem bestehenden Nachschub hinzufügen und verwalten, nicht immer nur einem neuen!"). No cross-Nachschub stop merging.
- [ ] **D6** New Nachschub type "Verkauf" with an aUEC goal, offered in Planen's new-Nachschub popup as "Geld verdienen"; lines come from the Bestand, progress from sales the app reports (R2 `q-sell=type`).
- [ ] **D7** Scrap data from the game files: new Codex fields for dismantle yield filled by the extractor; until data exists the UI shows "unbekannt" (R2 `q-scrap=extract`). If the extractor part cannot be finished in this run, D7 is a shortfall with its reason — the UI part (I18) still ships with "unbekannt".
- [ ] **D8** Codex type/slot available to the Bestand for I9 and role for H1 (R3 `q-subfilter=codex`, R1 `q-filter=role`).

### Cross-cutting

- [ ] **X1** All strings via ngx-translate DE/EN; actions via `scAction`; hints via `[scTooltip]`; no native dialogs/select; errors via `toErrorKey`; navigations are anchors (project rules in `CLAUDE.md`).
- [ ] **X2** Phones: bottom selection bar uses `--sc-float-bottom` / `.sc-dock-phone`; wide table in `.sc-table-scroll`.
- [ ] **X3** Specs: Karma specs for the new utils (quality aggregation, sub-filter derivation, last-ten removals, alternatives ≤ 3 hits, place grouping); migration dry-run; `npm run build` green.
- [ ] **X4** Living spec `docs/concepts/hq-bestand-ui-spec.md` written; `nachschub-hq-ui-spec.md` updated for Verkauf type and gather line.
