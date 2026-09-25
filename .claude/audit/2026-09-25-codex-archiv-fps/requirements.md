# Audit requirements catalog — Codex archive views + FPS assignment

Scope: `--scope=all --mode=implement`, target narrowed to the Codex **archive views**
and the **on-foot (FPS) component assignment** flow. The Codex landing page and the
ship detail page were the focus of the last weeks and are OUT of scope (except where
they link into the target).

Run: do-run audit, interactive, ship manual, passes Harden + Polish. Date 2026-09-25.

## Target surface

| Route | File(s) |
|---|---|
| `/codex/index` (+ `?kind=ship|component|weapon|item|ammo|manufacturer|blueprint…`, `?weaponClass=`) | `codex-list.component.ts`, `codex-weapon-taxonomy.ts`, `codex-variant-fold.ts`, `codex-skin-group.ts`, `codex-edition-group.ts`, `codex-compare-tray.component.ts`, `codex-category-icon.component.ts`, `codex-status-banner.component.ts` |
| `/codex/upcoming`, `/codex/upcoming/:id` | `codex-list.component.ts` (category), `upcoming-grid.component.ts`, `upcoming-detail.component.ts` |
| `/codex/fps` (+ `?cat=`, `?slot=`, `?equipInto=`) | `fps-list.component.ts` |
| `/codex/blueprint`, `/codex/blueprint/:className` | `blueprint-list.component.ts`, `blueprint-detail.component.ts` — **route-param reload of the detail page is being fixed in a parallel session (branch `fix/blueprint-detail-param-reload`); do not touch that part** |
| `/codex/keybinds` | `keybinds.component.ts`, `keybind-*.ts` |
| `/codex/:kind/:className` for every NON-ship kind (component, weapon incl. FPS, item/armor, ammo, manufacturer …) | `codex-detail.component.ts` (non-ship branches only), `codex-weapon-detail.component.ts`, `codex-component-modal.component.ts` |
| `/codex/set/:id` — on-foot set page ("Zu Fuß" equivalent of the ship detail page) | `set/codex-set.component.ts`, `codex-board-panel.component.ts`, `codex-board-figure.component.ts`, `codex-board-suit.ts`, `codex-landing-kpi.ts`, `stage/codex-stage.component.ts`, `stage/hangar-picker.component.ts` |
| FPS assignment (equip) flow | `fps-list.component.ts` equip mode, `src/app/hangar/hangar.service.ts` + `hangar.types.ts` (role loadouts, `ROLE_SLOT_SUGGESTIONS`) |
| Data | `codex.service.ts` (listByKind, listFpsWeapons, listFpsArmor, blueprints, resolveEntities, getEntityPayloads) |

## Requirements

| ID | Requirement | Source | Acceptance signal |
|---|---|---|---|
| REQ-1 | The archive views and the FPS assignment get the same level of care as the landing and the ship detail page (consistency of look, behaviour, honesty of data). | This chat, 2026-09-25: „bisher … Codex-Erstseite und Schiffsdetailseite … aber nicht mit den Archiv-Views, mit den FPS-Komponenten-Zuweisungen, usw." | Audit findings per view, fixes applied |
| REQ-2 | A codex for on-foot gear: FPS weapons, armour — "everything you need to know": values, where to buy, which materials craft it. | Feedback #30 (2026-07-21, shipped via #251/#265) | FPS list + detail show stats, shops, crafting where the data exists; gaps named honestly |
| REQ-3 | Weapons browsable by super-category (FPS gear vs. ship hardpoints) with sub-categories. | Feedback #174 (shipped #470) | `/codex/index?kind=weapon` groups FPS / ship; `/codex/fps` weapon types |
| REQ-4 | One entry per weapon; liveries behind a skin picker in the entry. | Feedback #136 / d5e39f86 (shipped #467) | FPS + index cards fold liveries; detail offers skin picker |
| REQ-5 | One card per item — near-identical file variants folded. | Feedback 8cd0aed7 (shipped #462) | Cards fold variants; "include variants" shows raw rows |
| REQ-6 | One card per ship hull; editions behind a variant picker. | Feedback #181 (shipped #472) | Index ship cards grouped |
| REQ-7 | Category browsing: each category separately; search primarily inside the category but still finds matches elsewhere. | Feedback #7 (2026-07-10) | Index search behaviour |
| REQ-8 | The archive IS the editor: a piece is put into a personal set from `/codex/fps?equipInto=<set>`; no equip controls during ordinary browsing. | Feedback 34505d70, decision 2A (#496) | Equip buttons only with `equipInto`; write persists; can clear a slot |
| REQ-9 | "Zu Fuß" has its own sub page where everything is seen and configured (analogous to the ship sub page); the landing only shows the person roughly + loadouts. | Concept 2026-09-20 round 1 (general) → T1/N5, `/codex/set/:id` | Set page shows six slots, class, readiness, set switch; switching sets works |
| REQ-10 | AN BORD vocabulary: clickable positions; legend removed, class via tooltip; readiness = small icons with tooltip, blue-grey when open, active when equipped; "Kampfbereit" chip removed; share as an icon; set switcher = top 3 (favourites, topped up with recently edited) + "more"; light material language; plinth for the focus mark; few fonts, colours with single meanings. | Concept 2026-09-01 An Bord neu, iterations 1–5 | Set page renders that vocabulary (blue-grey open state visible) |
| REQ-11 | Ship vs. FPS constructed similarly or complementary. | Concept 2026-09-20 round 13 | Set page / FPS list mirror the ship page / index patterns |
| REQ-12 | Set/hangar picker: no counts, no "Alle", hover delay ~300 ms before the top 3 pop out. | Concept 2026-09-20 round 16/17 | Stage picker behaviour on the set page |
| REQ-13 | Blueprints are not on the landing; they are handled in the archive detail view. | Concept 2026-09-20 round 6 | Blueprint list/detail reachable from the archive |
| REQ-14 | Archive links: one tone, "cool but not loud, second glance". | Concept 2026-09-20 rounds 10/12 | Archive link styling consistent |
| REQ-15 | No horizontal scroll on phones on ship or component pages. | Feedback #196 (shipped) | Mobile gate / 375 px check on target routes |
| REQ-16 | List heads identical across list views (title-to-subtitle spacing). | Feedback 98f50dfc (#338) | Index / FPS / blueprint / keybind heads measure the same |
| REQ-17 | Blueprint quantities without float noise; blueprint quality + slot badges correct. | #662 / #663 (2026-09-25, 48 h window) | Blueprint list/detail show clean quantities and badges |
| REQ-18 | One page frame: routed pages never set their own max-width / centring margin / side-top padding. | #658 (2026-09-25) + CLAUDE.md "One page frame" | Target page roots carry no width/padding of their own |

## Standing project rules (implicit requirements, CLAUDE.md)

| ID | Rule | Acceptance signal |
|---|---|---|
| RULE-A | Every user-facing string via ngx-translate; keys in `public/i18n/{de,en}.json`. | No hard-coded DE/EN text in target templates; key parity de/en |
| RULE-B | Navigations are real anchors (`<a [routerLink]>`); in-app plain-click handlers gated with `isPlainLeftClick`; actions stay `<button>`. | No `(click)` navigation on div/button in target |
| RULE-C | Red (`--sc-accent-hot`) only for elevated-access surfaces; normal user surfaces use `--sc-accent`; `--sc-danger` only for errors/destructive. | No `--sc-accent-hot` on plain-viewer UI in target |
| RULE-D | Standalone, signals, OnPush, `providedIn: 'root'` services. | Target components comply |
| RULE-E | No API keys in the client bundle. | — |

## 48 h window (2026-09-23 … 2026-09-25) — commits touching the target

- `96ba5c7` fix(codex): blueprint quality and slot badges (0.99.3) (#663) → REQ-17
- `44a29a9` fix(codex): blueprint quantities without float32 noise (0.99.2) (#662) → REQ-17
- `578cb5b` feat(ui): one page frame for every page, every screen (0.98.0) (#658) → REQ-18
- `10fa9f0` fix(test): specs open no real tabs; frames driven by hand (#660) — test hygiene
- In flight (other session): `fix/blueprint-detail-param-reload` — blueprint detail follows route params

Open feedback in the target: none (the only open topic, #225 energy distribution, belongs to the ship page).
