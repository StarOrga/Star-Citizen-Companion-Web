# Parity checklist — Search: context & actions

Every line is one approved behaviour or decision. A later round overrides an earlier one.

- **Source** is the round fragment (`rounds/NN.html`) plus the decision, annotation or pin id.
- **Owner** is the domain that builds the line: FE = frontend (`src/app/shell/fusion-bar`, codex search), CORE = Supabase / services, BOTH = both.
- **Status** is filled in by QA: `met` / `partial` / `unmet`, each with evidence.

## A · Panel structure (design "Kacheln", r1 favourite → r2 v2 → r3)

| # | Behaviour | Source | Owner | Status |
|---|---|---|---|---|
| A1 | The panel stays a floating card of group tiles (shipped "ruhige Leiste" card). There are no tabs and no preview pane. Reiter and Vorschau were rejected in r1. | r1 favourite `kacheln`; r1 design notes `vorschau`, `reiter` | FE | |
| A2 | New first group **„Aus deinem Bestand“** whenever something owned matches: ships incl. custom name, items in the Lager/Spind, loadout/config names, FPS-set names. It shows **max 3 rows**, then „▾ N weitere hier zeigen“ (expands in place) and „Alle N im HQ öffnen →“. | r1 `q-own`=section, anno `sa-s2-a1`; r1 `q-sources` loadouts | BOTH | |
| A3 | Every group shows **3 rows** whenever it has 3, on every page. The context never changes the row count, only the order. | r1 `q-ctx`=order, pin `up-mvzkdq2gb28k` | FE | |
| A4 | Two ways out of every group: „▾ N weitere hier zeigen“ expands **inside the panel** (accordion; → and ← keys; the other groups collapse to a summary line on top; „▴ einklappen“), and „Alle N im Index öffnen →“ is a real anchor. | r1 `sa-s2-a2` „Finde ich sehr gut!“, r1 screen `sa-s3` | FE | |
| A5 | The group header says **why** a group stands first („steht oben, weil du im Bestand bist“). | r1 `q-ctx` rec text, r1 `sa-s2` mock `.mk-s-why` | FE | |
| A6 | Empty field: **„Zuletzt gesucht“ shows the 7 newest**, then **„Zuletzt geöffnet“ with 3 rows**. There are no „Bereiche“ chips and no „Hier im HQ“. | r1 pins `up-mvzke8qntvor`, `up-mvzkdq2gb28k`, `up-mvzkb9uqbfp5`, `up-mvzkcgh99vgy` | FE | |
| A7 | Empty field, last line: a **one-line hint that rotates** (every ~6 s) from the **70 hints** list. Clicking a hint puts its example into the field. Store them as i18n arrays in DE + EN. | r1 pin `up-mvzknolyitpd`; r2 `t-s1-a1`; r3 `q3-hints`=ok (list in r3 fragment `q3-hints` example) | FE | |
| A8 | Behind the panel, the page is **darkened strongly** (scrim ≈ .82) and nothing else is shown there. | r2 `t-s3-a2`; r3 intro | FE | |
| A9 | Esc **closes immediately**; the typed text stays for the next open. The ✕ in the field only clears the text. | r1 `q-esc`=close | FE | |
| A10 | Fast-exact hits **outside the active chip filter** still show, in their own dashed group „Fast genau, aber außerhalb von „X““, with a reason. | r1 pin `up-mvzl77sbpcg5`; r2 screens `t-s3`, `t-s5` | FE | |
| A11 | The footer key hints stay: ↑↓, → aufklappen, ↵ öffnen, Strg ↵ neuer Tab, ⌫ letzter Chip weg, Esc. | r2 `t-s3` | FE | |

## B · Rows: information left to right

| # | Behaviour | Source | Owner | Status |
|---|---|---|---|---|
| B1 | Leading icon: the uploader silhouette (line art) **inline, without a box or background**, wherever one exists (ships). Otherwise a **reworked icon per kind**, the same line style for all kinds. Every row always has an icon. | r1 `q-info` note; r2 `q2-rowicon`=sil; r3 `ub-s1-a1`, `ub-s1-a2` | FE | |
| B2 | Name line: **ship type first, then your own name** („Aegis Redeemer · „Bulwark““). | r2 `t-s1-a2` | FE | |
| B3 | Second line: manufacturer + kind, size/class, **concrete ownership** („3× im Lager · 2 auf „Nachtfalke““). There is no core stat value: `stat` was not in the final r1 `q-info` selection. | r1 `q-info`=[maker,size,own,patchnew] | FE | |
| B4 | **Neu icon**: a small glyph after the name, with the tooltip „Neu in Patch x.y.z“ on hover/focus only. | r1 `q-info` patchnew + note | FE | |
| B5 | **„passt auf X“ badge** when a chip names a ship or weapon and the row has ports: ✓ passt (accent), ⚠ passt nicht + reason (`--sc-warning`), ? unknown (muted). It is a badge, not a CTA. Load the compatible set **once per chip**, not per row (DB pool). | r1 `q-more` note; r2 screens `t-s3`/`t-s5`; pox report | BOTH | |
| B6 | **One main CTA** per content row. All CTAs look the same: quiet, outlined, filled only on the focused row, „sichtbar aber nicht zu bullig“. | r1 `sa-s2-a3`; r2 `t-s2-a2` „alle gleich aussehen“, pin `up-mvzpgsuediv8`, `q2-icons` note | FE | |
| B7 | CTA per context × kind = **the corrected matrix of r3** (`q3-matrix` example). `*` cells fall back as described in the brief. „Im Index“ disappears. | r3 `q3-matrix`=ok; r2 `q2-matrix` note | FE | |
| B8 | Three standard icons in the same line style, **32 px**, after a thin separator: **Wunschliste · Ins Lager · Nachschub**. | r2 `q2-icons` note, `t-s2-a1`; r3 `q3-third`=nachschub | BOTH | |
| B9 | „Ins Lager“ on ship rows means **„In den Hangar“**. Icons appear only on equipment, ships and blueprints; a blueprint gets the Wunschliste only. | r3 `q3-shipicon`=hangar | FE | |
| B10 | Rows for **news, patches, gallery and app pages: no CTA and no icons**. An icon that makes no sense is **hidden**, not greyed out. | r2 `q2-mark` note, `q2-off`=hide + note | FE | |
| B11 | **Wunschliste** = the hangar wishlist status for ships, plus a new lean list for every other kind. It must not share storage with `SupplyItem.wanted` (Nachschub). Signed out: the icon stays and asks for sign-in through `ScConfirmService`. | r2 `q2-mark`=yes; redteam finding 11 | BOTH | |
| B12 | „Vergleichen“ (the pin star) is **removed from the small search**. It stays only as the CTA on Codex list pages, for rows of that list's kind. | r1 `q-more` note; r3 matrix | FE | |

## C · Chips, context and smartness

| # | Behaviour | Source | Owner | Status |
|---|---|---|---|---|
| C1 | The context **filters visibly** through chips in the field and **sorts invisibly** (group order). There are never „Bereiche“ chips to click. | r1 `q-ctx` note; r1 pins | FE | |
| C2 | Chips come **only automatically**: from the route, from the page section/anchor the search was opened from (sections that show a kind of data: Bewaffnung, Komponenten, Bestand, Hangar, Sets), and from the typed text (e.g. „s4“ → Größe 4). | r1 pin `up-mvzkb9uqbfp5`; r2 `q2-anchor`=data | FE | |
| C3 | Chips are **always visible** (no `hideContext`) and all in **one colour**. ▾ and × show **only on hover/focus**. | r2 `t-s3-a1`; r2 `q2-anchor` finding | FE | |
| C4 | A switchable chip opens a **menu that grows out of the chip**, with **no brightness difference** between chip and menu. Each value shows its hit count; **values with 0 are greyed out but clickable**; with **more than 7 values** the menu gets a mini-search. | r1 `q-understand` note; r2 pin `up-mvzpnys6wosu`; r3 pins on `ub-s3` | FE | |
| C5 | ⌫ at the start of the field removes the last chip. | r2 `t-s3` keys | FE | |
| C6 | Abbreviations and nicknames from the r2 list (≈170, `q2-abbr`=ok incl. „mittel“) become aliases. The search reads **the current language + English**; when the language is English, only English. | r1 `q-understand` [dym, abbr, attr] + note; r2 `q2-abbr` | FE | |
| C7 | **„Meintest du …?“** is shown in the fusion bar on typos (the trigram suggestion already exists). | r1 `q-understand` dym | FE | |
| C8 | **Values in the text** („größe 3“, „klasse a“, „s3“) become chips; size and class become searchable. | r1 `q-understand` attr | BOTH | |
| C9 | Ranking signals: **recently opened by you** (local), **ownership** (light, on every page, only on equal name match), **what others open often** (server count). | r1 `q-signals` [recent, own] + note | BOTH | |
| C10 | Count searches with no hits **anonymously** (text + count, no user id). The admin gets a list „Häufig ohne Treffer“. The same count feeds C9 „oft geöffnet“. | r2 `q2-misses`=yes | BOTH | |
| C11 | Sources: **loadouts / sets / custom ship names** (client side, HQ data), **patches** (`patch-search.ts`), **gallery images** (`verse_wallpapers`, #832 part 1), **missions, blueprints and all game content**. Missions are not in the index yet, so they are a data follow-up issue. | r1 `q-sources`; r2 `q2-mark` note; handover-832 | BOTH | |
| C12 | **Own hangar** search: client side only, HQ context only, signed in only. It is never part of the shared index or a request payload (#832 part 2). | handover-832 | FE | |

## D · Cleanup

| # | Behaviour | Source | Owner | Status |
|---|---|---|---|---|
| D1 | „Im Hangar“ / „In deinem Hangar“ / „Loadout“ become **„Mein Loadout“**, linking to the ship in the HQ (`hqShip(id)`), not to the hangar list. | r3 matrix change 4 | FE | |
| D2 | The legacy quick-search / codex-search-bar pipelines must not diverge: the fusion bar is the reference. Legacy surfaces are out of scope unless they share code that changes. | analysis r1 | FE | |
