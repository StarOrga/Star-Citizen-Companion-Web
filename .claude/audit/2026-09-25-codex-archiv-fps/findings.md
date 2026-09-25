# Findings — Codex archive views + FPS assignment (audit 2026-09-25)

Sources: live walk (L, see live-evidence.md), code lens (C01–C26), tests & function lens (T01–T05),
red team (R1–R10). Deduplicated; strongest evidence kept. Status: **fixed** (commit 90f7749),
**ask → approved + fixed** (all 16 approved in the batched question; commits 325dc20, 50476d8,
hardened in 03acdbe), **issue** (not applied — size or floor).

## Scorecard (after the run — the "before" state is in live-evidence.md)

| Dimension | Status |
|---|---|
| functional | fixed: set switch, set links, equip feedback, weapon/tool slots on the set page, two-tab overwrite (updated_at guard), only fillable slots offered |
| visual | fixed: open-state colour, RULE-C red badges, phone overflow (keybinds, detail tiles); open: set page repeats figure/name (AUD-065, concept) |
| animation | ok — transitions ≤ 160 ms on cards/tabs, 300 ms hover delay on the picker; reduced-motion honoured on the new card states |
| audio | n/a — no audio in the target (only the ship Holotable, out of scope) |
| accessibility | fixed: no buttons inside card links, aria-pressed groups instead of tab roles, readiness named via role=img + aria-label, modal focus trap; low-contrast blue-grey is the concept's choice |
| logging | ok apart from silent catches (C21) |
| performance | fixed: FPS armour list loads a slim JSON-path select (2 429 rows ≈ 1.3 MB once per build, then filters locally); URL mirroring no longer navigates |
| resilience | fixed: set-page load failure, detail retry, keybind error/empty, stale answers, failed build lookup no longer cached |
| security | clean (RLS self-only on role loadouts, no HTML injection, params validated or bound) |
| tests | 2951 green before the run; new specs for fps-list, board panel, set gear, role-slot writes, build retry, URL state |
| architecture | removed 251 lines of dead KPI code and the unused 269-line zone rail; open: /codex/blueprint duplicate (AUD-061) |
| build-config | open: codex-detail styles 22.95 kB (warn 18, error 24); lint is a no-op |
| content | fixed: FPS terms translated, placeholder names/manufacturer hidden, wrecks out of the ship list, back-link wording unified; open: English stat labels (AUD-060) |

REQ trace: met 10 · partial 5 (REQ-1, 4, 7, 9, 11) · broken → fixed 2 (REQ-9 switch, REQ-10 colour) · unverifiable 1 (REQ-14 tone).

## Fixed in this run (commit 90f7749)

| ID | Sev | Dim | What | Evidence | Fix |
|---|---|---|---|---|---|
| AUD-001 (C01, R2, T01) | high | functional | Set picker changes the URL, page keeps the old set; "not found" note sticks | `set/codex-set.component.ts:165` snapshot read; live: note stayed after picking a valid set | Follow `paramMap`, seq-guarded reload, refresh cache once for unknown ids |
| AUD-002 (C03) | high | visual | Set page: open slots white, squares invisible, readiness icons unframed | `--idle` undefined on `.board-wrap` (live computed styles) | `--idle/--idle-bg` on the panel's `:host` |
| AUD-003 (C02, C06, R3) | high | functional | Set switcher, "Zurück zum Set", hangar card, `/hangar/loadout/:id` all lead to the landing | `codex-board-panel:186`, `fps-list:92`, `hangar-dashboard:360`, `app.routes:32` | All → `/codex/set/:id` |
| AUD-004 (C07, R4, T02) | medium | resilience | Failed equip write / stale `?equipInto=` look like a dead click | `fps-list:660-675`, `hangar.service:750` | Inline alert + "set unavailable" notice |
| AUD-005 (L) | medium | visual | /codex/keybinds scrolls sideways on phones (417 px) | `.devices` 405 px in 351 px row | Tabs wrap 2×2 on ≤640 px, 48 px targets |
| AUD-006 (L) | high | visual | Armour/FPS weapon detail 573/534 px wide on phones (REQ-15 regression) | stat tiles with unbroken labels/values | `min-width:0` + `overflow-wrap:anywhere` |
| AUD-007 (C12) | medium | resilience | Set page: load failure shown as "no set"; empty state has no way forward; bare "…" | `codex-set:44-51` | Error + retry, link to /hangar, translated loading text |
| AUD-008 (C19 part) | low | resilience | Detail error card without retry; `/codex/foo/x` queries table "undefined"; stale answers win | `codex-detail:333, 2414-2470` | Retry, kind validation (i18n), seq guard |
| AUD-009 (C20) | low | resilience | Keybinds: error card + "no build published" together; overlapping reloads | `keybinds:125-142, 670` | Exclusive states, seq guard |
| AUD-010 (L) | low | content | "0 Ergebnisse" above the loading skeletons | live /codex/fps | Loading text until counted (index, FPS, blueprints) |
| AUD-011 (L) | low | content | FPS search placeholder uses ship examples | live | On-foot examples |
| AUD-012 (code lens Q5) | low | visual | Hero figure's no-WebGL fallback had no colours outside the panel | `codex-board-figure:206-214` | CSS fallbacks |

## Asked — all approved and fixed (325dc20: AUD-020…033 · 50476d8: AUD-040…053 · 03acdbe: red-team hardening of 020/040/041)

| ID | Sev | Dim | What | Evidence | Effort | Score |
|---|---|---|---|---|---|---|
| AUD-020 (R1) | high | functional | Two tabs equipping one set overwrite each other (read-merge-write on a cached copy) | `fps-list:666`, `hangar.service:726` | S–M | 77 |
| AUD-021 (T03, R5a, C13) | high | functional | Set page has no weapon/tool slots: can't see, assign or clear primary/secondary/sidearm, multitool, tractor… | `codex-board-panel` renders armour only | M | 34 |
| AUD-022 (R5c, C13) | medium | functional | FPS weapons offered into mining-attachment/medgun/medpen slots that the archive cannot fill; medical icon can never turn on | `fps-list:636-638`, `hangar.types:47-53` | M | 47 |
| AUD-023 (C17) | medium | content | No share icon on the set page (concept it. 3) | — | M | 47 |
| AUD-030 (L) | medium | content | Nameless records ("! … TRANSLATION NOT FOUND") sort first in every list; "PH Unknown Manufacturer" badge | DB: 12 armour + 1 FPS weapon rows; live first cards | S | 52 |
| AUD-031 (L) | medium | content | 6 salvage wrecks + orbital sentries + probe listed as ships (duplicate "Avenger Titan") | DB `codex_ships` | S | 52 |
| AUD-032 (L, R10b) | medium | functional/perf | FPS lists fold per 60-row page: liveries split (7 separate C54 cards), counts estimated, ~600 kB per armour page | live + DB sizes | M | 47 |
| AUD-033 (C10) | medium | content | Raw English tokens: slots, weight classes, weapon types, "UNDEFINED", duplicate "Helmet \| Helmet" | `fps-list:132,230-231,541` | S | 72 |
| AUD-040 (C16, R6) | medium | functional | Category/search/filters not in the URL — Back from a detail loses the archive state | `codex-list`, `fps-list:604-614` | M | 72 |
| AUD-041 (C04) | high | resilience | One failed build lookup → every archive view "empty" until reload | `codex.service:381-412` | M | 62 |
| AUD-042 (C05) | high | functional | Index search ignores other categories (REQ-7) | `codex-list:1173` | M | 62 |
| AUD-043 (C09) | medium | accessibility | Buttons inside card links (pin, +, equip) | `codex-list:334`, `fps-list:209` | M | 72 |
| AUD-050 (C08) | medium | visual | RULE-C: red on manufacturer/category badges and weapon/thruster icons; admin-only keybind toggle not marked | `codex-list:538`, `fps-list:405`, `blueprint-list:205`, `codex-category-icon:53,59`, `keybinds:176` | S | 57 |
| AUD-051 (C18) | low | content | Five back-link wordings, two colours; "Zurück zur Brücke" stale | 7 files | S | 57 |
| AUD-052 (C22–C24) | low | visual/a11y | Token drift, `aria-pressed`, tab roles, `?slot=Foo` → 0 rows, stale comments | see code lens | S | 57 |
| AUD-053 (C25) | low | architecture | ~200 lines dead KPI code, unused zone-rail component, unused i18n keys | `codex-landing-kpi:21-184,364-431` | S | 72 |

## Not applied — issue candidates

| ID | Sev | What | Why not now |
|---|---|---|---|
| AUD-060 (C11) | medium | Stat labels on German detail pages are English humanized keys; armour shows engine internals (hit-effect lib, animspeed) | L — needs a label dictionary |
| AUD-061 (C14) | medium | `/codex/blueprint` duplicates the index blueprint tab (English names, no group filter); three list views are near copies | L — consolidation, redirect |
| AUD-062 (C15) | medium | codex-detail styles 22.95 kB of a 24 kB error budget (22.5 kB at audit start) | M — split non-ship sections |
| AUD-063 (R7) | medium | Facet options only from loaded rows | M — server facets |
| AUD-064 (R8) | medium | Equip possible while viewing a past patch, no marker on set page | M |
| AUD-065 (L) | medium | Set page repeats figure (2×), name (3×), role (3×) — hero + old panel stacked | structural — concept iteration |
| AUD-066 (C26) | info | `npm run lint` is a no-op | floor (build config) |

## Harden pass (after the audit fixes)

Red team + bug/smell scan over the branch diff. Applied (commits 03acdbe, 9557cb7, 8c6a337):
stale "clear" no longer deletes another tab's newer piece (expect guard), no shared hangar
banner from slot writes, whole-row item writes removed, `*` wildcard in the FPS search, tab
counts keep the category size, unknown facets dropped after load, `?size=abc` guarded, one
`applyDefaultBrowseFilters`, counts need 3 chars after escaping, catalog cache evicts other
builds, detail follow-up reads seq-guarded, landing drops 1–8 unread queries per visit,
free-form legacy slots listed, medgun slot = ParaMed only. Decision asked: fps sets got melee +
throwable positions; the board shows only the readiness classes a role can hold.

## Polish pass

Applied (commits c7d9cd3, 2a9b752, 5169bfe): themed `sc-select` facets (10 native selects),
app tooltip directive `[scTooltip]` (Info 1500 ms / Label 500 ms, skip window, focus,
Escape, long-press) replacing native titles in the archive views, category bars and
cross-category hits as real links (no record count), slot mode lists only fitting pieces,
missing-set next steps, reset search & filters, set name as text + archive link,
"Rüstung x / 6", open-slot text contrast, undo after clear + conflict note, add-to-hangar
busy/failure, saving label on equip, token/state/colour-rule fixes, parallel catalog pages,
cached search and archive-depth counts.

Not applied (issue candidates, besides AUD-060…066): shared `<sc-codex-card>` for the two
card twins; `resource()` instead of six hand-rolled loadSeq guards; component size
(codex-detail 4.7k lines); keybinds `.devices` onto `sc-segmented`; one icon-button size
across views; an h1 on /codex/set/:id; German payload names in the set page's gear/board
(resolveEntities selects only name_localized); native selects left in hangar pages; idle and
data-viz colours as global tokens; raw PostgREST messages in error cards; the status banner's
native title; tiny board-square labels on touch (a floor would clip them); blueprint list
without URL state (consolidation candidate with AUD-061).
