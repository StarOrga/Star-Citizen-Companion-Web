# HQ (Beta) — Implementation Plan

Status: **approved for implementation, paused 2026-10-31 (usage reset)** — implementation starts in the next session.
Concept: `docs/concepts/2026-10-30-hq-beta-einstieg.html` (5 rounds) · decisions: `docs/concepts/2026-10-30-hq-beta-einstieg-decisions.json` (iterations 1–5) · briefs: `docs/concepts/2026-10-30-hq-beta-einstieg/briefs/02–05.md` (verbatim feedback) · final mock: round 5, design `hq5`, screens `h1-s1…h1-s9` (`rounds/05.html`).

Scope: **beta site only** (shell beta, `BetaService` area `shell`). The Codex itself is not redesigned; HQ consumes Codex data (items, sets, shops, blueprints, missions, builds). Two repos:

- **Web** — `StarOrga/Star-Citizen-Companion-Web` (this repo): Angular 22 PWA, Supabase, Vercel.
- **SCC-App** — `StarOrga/Star-Citizen-Companion-App` (`P:/Projects/Star-Citizen-Companion-App`, v0.93.0): Electron desktop app with `modules/gamelog` (Game.log reader), the OCR loop, the Codex mirror and `spots-sync-service.js` (the existing desktop ↔ Supabase sync pattern).

First release = **all eight packages** (web-frame, web-supply, web-ops, scc-sync, web-map, web-stats, scc-inv, web-patch). The SCC-App ships in the same go.

---

## 0. How to start tomorrow (kickoff checklist)

1. Read this file completely, then `rounds/05.html` screens `h1-s1…h1-s9` in the concept page (open the built HTML directly; the bridge is paused — do NOT resume the concept unless the user asks).
2. Branch off `main` per package (`feat/hq-frame`, `feat/hq-supply`, …) or one integration branch `feat/hq-beta` with sub-branches (hierarchical merge via ship). Recommended: **one integration branch `feat/hq-beta`**, sub-branches per package, because the release ships all eight together.
3. Worktree hygiene (memory): `npm ci` in the worktree if the primary `node_modules/typescript` is a stub; never junction a subagent's worktree; `cd` into the worktree before Edit/Write.
4. Migrations get unique timestamps ≥ `20261101000000`; push them from the primary checkout (`npm run db:push`), never from a worktree that is not linked.
5. Budget: the work is full-ceremony (3+ domains, migrations, two repos). Run it through `auto-agents` (waves below), domain agents on `sonnet`, design-heavy Planen map on `opus` only if the budget class is `free`.
6. Resolve the one open wording item first (§2.3 "Was ⇄ Wie" switch labels) — propose in the first preview, do not block on it.

---

## 1. Decision ledger (final, all rounds)

Every line is binding unless marked *(proposal)*. Round numbers in brackets.

### 1.1 Structure and frame
| # | Decision |
|---|---|
| D1 | HQ is **five Verse-like scroll pages** on ONE route: **Start · Planen · Jetzt · Bestand · Statistik** [3,4]. Anchors `/hq#planen`, `/hq#jetzt`, `/hq#bestand`, `/hq#statistik` (Start = `/hq`) [5 r5-routes=anchor]. Spind (`/hq/locker`, `/hq/locker/:id`) and Hangar (`/hq/hangar`, `/hq/hangar/:id`, `/hq/hangar/import`) stay sub-routes [5]. `/hq/ops` becomes a redirect to `/hq#planen` (Einsätze live in Planen + Jetzt). |
| D2 | **Real header stays exactly as it is** (main nav Verse · Codex · HQ …). The HQ section tabs (Übersicht/Spind/Hangar/Einsätze) leave the header [4,5]. Verified "ganz genau!" in round 5. |
| D3 | Start = cinematic main page (no subheader, search in the hero). Follow pages (Planen…Statistik) = **real header condensed + real subheader (60px, `--sc-sub-h`)**, content exactly at subheader width (`--sc-chrome-w` / `--sc-dock-w` column) — like Verse briefing vs Verse follow pages [4,5]. |
| D4 | **Left-edge quick-scroll rail** lists the five HQ pages (r5-rail=pages): slim, vertical, at the page edge outside the content column, labels on hover/focus, current page marked [5]. Desktop OK as mocked. **Phone: no squeezed rail** — use a recognizable thumb-reach form: a bottom bar (SCC best practice, `.sc-dock-phone`, respects `--sc-float-bottom` / feedback-launcher lane), or omit on phones (scrolling is easy). *Decision for implementation:* bottom segmented bar with 5 icons + short labels, auto-hides on scroll-down, shows on scroll-up (h1-s2 note). |
| D5 | **Page cue = exactly the Verse page-transition triangle/chevron** (copy from `src/app/verse/pages/briefing/*`). No page numbers [4,5]. The Planen cue icon on Start must not be clipped; Start must fit one viewport (h1-s1 pin "das Planen-Icon darf nicht abgeschnitten sein"). |
| D6 | Footer only after the last page (Statistik), room at the bottom [4]. |
| D7 | **Backdrop:** the zoomed-in hub planet of today's HQ stage (`hq-overview.component.ts`, `hq-spot-stage.component.ts`) on Start and first visit — NOT the planet at the bottom [4]. |

### 1.2 Start + first visit
| # | Decision |
|---|---|
| D8 | Start hero = the **Codex hero block**: kicker, title "Hauptquartier", **two patch lines** (category / effect, e.g. "4.3.1 · S3-Repeater −8 %" / "betrifft Bounty v3 ›"), centred search (same as Verse/Codex), **≤ 4 "Jetzt wichtig" chips** [2,3,4]. Patch lines only for the newest patch and only if it touches the user's stuff (D30). |
| D9 | First visit (no RSI import, no SCC-App, no Einsatz yet): Verse entrance, search **under the hero** also here [4], promise text "Dein Hangar, deine Sets, deine nächsten Einsätze. An einem Ort." as the **quiet heading of the launch-step block** [4], block placed lower [4], three launch steps (1 RSI-Hangar holen → 2 SCC-App verbinden → 3 Ersten Einsatz planen), done-step animation kept [4 "sehr gut"], **"Los geht's" primary, "Überspringen" under it** [4], subtle "≈ 4 Minuten" hint, **no progress bar** [4]. Tour ends with the RSI import [1]. Round 5 verdict on h1-s1: "perfekt!". |
| D10 | Cinematic, motivating, but `prefers-reduced-motion` respected (all keyframes behind the media query) [2,3]. |

### 1.3 Search
| # | Decision |
|---|---|
| D11 | **One component** `fusion-search` in two visualisations: standalone in the Start hero, docked in the subheader on follow pages [5 r5-search-one=ok]. |
| D12 | Per page configured by **exclusion** (what to hide/deprioritise), not inclusion [5]. On Bestand the docked search shows the scope chip "Bestand" and highlights what the page is about [5]. |
| D13 | Search always carries **HQ verbs**, auto-detected by type: "→ Hangar", "→ Set …", "→ Nachschub ×N", "→ Einsatz" [1,2]. Results grouped: Dein HQ / Codex / Missionen / Aufgaben, keyboard hints [3]. |
| D14 | **Missions** (contracts from uploader data) are searchable and can be taken into an Einsatz ("→ Einsatz") [2]. Requires the uploader to upload mission data (check `p4k`/ingest kinds; uploader kinds were widened in `20261029190000_uploader_kinds_widen.sql`). |
| D15 | Codex → HQ only via the search quick action and the Codex holotable; type auto-detected [1]. |

### 1.4 Model and wording
| # | Decision |
|---|---|
| D16 | **Set** = what you take along: a ship loadout (Hangar, `hangar_ship_configs`) or an FPS set (Spind, `hangar_role_loadouts`). FPS appears **only as sets**, never as single parts [2,4]. |
| D17 | **Einsatz** = what you do. One step = "Einsatz", ≥ 2 steps = **"Einsatz ×N"** (tooltip "N Schritte") [4, 5 r5-multi]. A transport leg that is not part of a game mission counts as its own step [4]. **Never** "Auftrag", "Operation". "Mission" = in-game mission only. |
| D18 | **Step kinds (verbs)** [5 r5-steps, deviates from rec]: **Kaufen · Mission · Abbauen · Raffinieren · Craften · Transportieren · Abholen**. Used in Planen chips, legend, unified step component, log, search. |
| D19 | **Activity types** (Einsatz-Arten) [3,4]: Kopfgeld, Bunker, Medizin, Rennen, Bergbau, Fracht, Bergung, Erkunden, Piraterie. |
| D20 | "**liegt bereit**" replaces "gedeckt" everywhere (never "gedeckt") [2,3]. |
| D21 | Chains are auto-built from Codex data (blueprint recipe, shop locations) plus robust community data, editable [3,4]. Recommendations: **Bestand + favourites first**, then Codex rule [3]. |
| D22 | Favourites ★: max **3 ships + 3 FPS sets** [1]. Icon-only share/duplicate; variant change count only as a margin note [1]. Codex detail pages open in "Meine" mode (`?mine`, `HQ_MINE_PARAM`); a variant page comes later [1]. |

### 1.5 Planen
| # | Decision |
|---|---|
| D23 | **No explicit mode toggle** for Top 3 / Nach Lust / Gezielt [5 pin]. Behaviour is implicit: **Top 3 preselected is the default**; clicking a mood preset = "Nach Lust"; any manual change = "Gezielt". The UI may *name* the current state as a quiet label ("Top 3", "Nach Lust: Kampf + Schnell", "Eigene Auswahl"), but it is not a control. |
| D24 | **Default on open** [5 r5-default=last + note]: the **last selection**, no matter how often the user jumps around. **Top 3 only** if nothing was changed during this tab session (no reload = same session; a reload / new tab starts fresh with Top 3). → `sessionStorage` key `sc.hq.plan.selection` + a `changed` flag; absent → Top 3. Importance for Top 3 = set favourite, Einsatz soon, blueprint gap. |
| D25 | **Mood presets = three binary toggle pairs** [5 pin on h1-s4]: **Friedlich ↔ Kampf · Schnell (< 30 min) ↔ Zeitintensiv · Solo ↔ Gruppe**. Each pair is one 3-way toggle (off · left · right). r5-moods selected all six values; the pin turns them into pairs. Presets combine (AND across pairs). |
| D26 | **Ort axis**: nested multi-check dropdown System › Planet › Ort with mini search [4,5]. Depth is right [5 "reicht als Tiefe"]. **Visuals must be modern** ("sieht noch nach 2010 aus") → use the app tri-state checkbox (D28), indent guides as hairlines, hover row highlight with `--sc-accent` glow, count badges per node, selected path highlighted, sticky mini search at the top, keyboard (↑↓ ←→ Space). |
| D27 | **Step-kind axis**: chips with the D18 verbs. Filters exist **only in the overview**, not in the route mode [4]. Unselected needs disappear from the map too [4]. |
| D28 | **Sets as tri-state rings** (r5-tristate=yes, **app-wide component** in `src/app/shared/tristate/`): empty = not chosen, arc = partly (1/2, 1/4), full ring + sheen = all. The fraction derives **from what the user marked as wanted in Nachschub** for that set (e.g. 1/4 Pembroke because the user marked 1 of its 4 parts — or 3 left), **not** automatically from the catalog [5 pin]. Reachability hint under each ring: "vollständig erreichbar" / "teilweise" / nothing. Clicking a set selects all its needs. |
| D29 | **Map encoding** [4]: shape = action (step kind), size = amount, colour = need, fill = status (open/partly/done); dashed line = travel, thick line = transport. **Only the start system is open**; other systems are accordion strips with a step count [4]. Legend always visible. |
| D30 | **Overview ⇄ route switch** — the old "Schritt-Modus" name is too dull [5]. It is a switch between planning **"Was"** and **"Wie"**. *(proposal, confirm in the first preview)*: segmented switch **"Was brauche ich" ⇄ "Wie komme ich hin"** (short labels "Was" / "Wie", the active one carries a glow), and the selection controls currently titled "Wie (Auswahl)" are renamed **"Auswahl"** so "Wie" means only the route. Route view: no filters, the optimal route, the unified step list, primary **"Als Einsatz speichern"** → the new Einsatz shows as "Einsatz ×5". |
| D31 | Nachschub rows: "für Set …" + a step-kind chip [4]. Supplies live **on the server** [1]. |

### 1.6 Jetzt
| # | Decision |
|---|---|
| D32 | Order of attention [4]: 1st **location anchor** (big, distinct: location with system › planet breadcrumb and current ship — must not look like a toast), 2nd **main path** (next step card large, following steps as a dimmer vertical trail), 3rd compact missions, 4th log. "Hier gibt es 2 Dinge für dich" and the next step are merged into ONE path [4]. |
| D33 | **Active missions → an icon at the top right** of the Jetzt page (badge with count, opens a small popover list) instead of a section [5 pin]. The round-5 pin "was soll deine Einsätze rechts oben machen!?" shows that the "Deine Einsätze" strip at the top right was not understood → remove it there; saved Einsätze appear in Planen (route view) and as Start chips; the top-right slot belongs to the missions icon only, with a tooltip "Aktive Missionen im Spiel". |
| D34 | **Notification → log**: the newest auto-applied event appears as a toast and **animates into the log** (FLIP from the toast position into the first log row) — closer to the log than in round 5 [5 pin]. Reduced motion: a plain fade. Auto-applied events show "Rückgängig" in the toast and in the log row [2]. |
| D35 | Log on the page: **3 entries** + "Alle anzeigen" → dialog (`[scDialog]`) grouped by day with lazy **"Mehr laden"** [4]. |
| D36 | **One unified step component** (`sc-step`, `src/app/shared/step/`) in two variants **zu tun / erledigt**, used in Planen route list, Jetzt path, log, Nachschub — "Kauf" (done) and "Kaufen" (to do) share the style [4]. |
| D37 | Without the SCC-App: HQ is **not** fully usable → clear connect CTA on Jetzt ("Spiel nicht erkannt — SCC-App verbinden") and in the first-visit steps [4]. |

### 1.7 Bestand + Statistik
| # | Decision |
|---|---|
| D38 | Bestand sections [4]: **Schiffe** (★3 + count) · **Sets** (Schiff-Loadouts · FPS-Sets) · **Erspieltes** (Blueprints 37/212; no "Ruf" slot yet) · **Lager per Ort** (Rohstoffe in SCU like Gold, Kupfer, Hadanite + Gegenstände), each with snapshot age as margin note. |
| D39 | Snapshot age: "zuletzt geöffnet vor 2 Tagen" as margin note; from 7 days in `--sc-warning` (never danger) [3]. A new snapshot replaces the old one automatically, undo in the log [3]. |
| D40 | Statistik: 6 tiles with mini previews (sparkline/mini bar): aUEC aus Käufen/Verkäufen, Missionen pro Woche, Tode/Claims, Crimestat, Raffinerie-Ausbeute, Blueprints pro Woche; click → detail [3,4 "passt erstmal"]. |

### 1.8 Live data + inventory
| # | Decision |
|---|---|
| D41 | Live data: **all event types incl. crimestat and deaths**, **opt-in** sync into own Supabase tables (RLS self-only) [2]. Purchases auto-check Nachschub [2]; detected events apply automatically with undo [2]. |
| D42 | Inventory: **Log says where, OCR reads what** [3,4]. OCR is the **very last resort** and runs **only after an interaction** (I = inventory, F = ASOP/kiosk) **while that screen is open** [4]. Manual fallback: quick capture via search ("liegt in …") [3]. |
| D43 | Source order: **Log → Suche → Community → OCR** [4]. Community data = **median of ≥ 5 reports, outliers removed** [4]. |
| D44 | Fleet patch built for real: build diff between the two newest `codex_builds`, shown only for the newest patch and only if it touches the user's ships/sets [1]. |

---

## 2. Wording and i18n

All strings via ngx-translate in `public/i18n/{de,en}.json`. New namespace `hq.*` (existing: `hq.title`, `hq.ops.*`). EN in parentheses.

### 2.1 Keys (new)
- `hq.pages.start|planen|jetzt|bestand|statistik` — Start (Start), Planen (Plan), Jetzt (Now), Bestand (Holdings), Statistik (Stats).
- `hq.rail.label` "HQ-Seiten" (HQ pages); `hq.rail.goto` "Zu {{page}}" (Go to {{page}}).
- `hq.start.kicker` "Dein HQ" (Your HQ), `hq.start.title` "Hauptquartier" (Headquarters), `hq.start.important` "Jetzt wichtig" (Important now).
- `hq.first.promise` "Dein Hangar, deine Sets, deine nächsten Einsätze. An einem Ort." (Your hangar, your sets, your next ops. In one place.); `hq.first.step1|2|3` "RSI-Hangar holen" / "SCC-App verbinden" / "Ersten Einsatz planen"; `hq.first.go` "Los geht's"; `hq.first.skip` "Überspringen"; `hq.first.duration` "≈ 4 Minuten".
- `hq.step.kind.buy|mission|mine|refine|craft|transport|pickup` — Kaufen, Mission, Abbauen, Raffinieren, Craften, Transportieren, Abholen (Buy, Mission, Mine, Refine, Craft, Haul, Pick up).
- `hq.step.state.todo|done` — zu tun / erledigt.
- `hq.einsatz.single` "Einsatz"; `hq.einsatz.multi` "Einsatz ×{{n}}"; `hq.einsatz.stepsTooltip` "{{n}} Schritte".
- `hq.activity.*` — kopfgeld, bunker, medizin, rennen, bergbau, fracht, bergung, erkunden, piraterie.
- `hq.plan.switch.what` "Was brauche ich" / `hq.plan.switch.how` "Wie komme ich hin" *(proposal)*; `hq.plan.selection` "Auswahl"; `hq.plan.state.top3` "Top 3"; `hq.plan.state.mood` "Nach Lust: {{moods}}"; `hq.plan.state.custom` "Eigene Auswahl"; `hq.plan.saveEinsatz` "Als Einsatz speichern".
- `hq.mood.peaceful|combat|quick|long|solo|group` — Friedlich, Kampf, Schnell (< 30 min), Zeitintensiv, Solo, Gruppe.
- `hq.place.search` "Ort suchen"; `hq.place.any` "Alle Orte".
- `hq.set.reach.full` "vollständig erreichbar"; `hq.set.reach.partial` "teilweise".
- `hq.supply.ready` "liegt bereit"; `hq.supply.forSet` "für Set {{name}}".
- `hq.now.youAreIn` "Du bist in"; `hq.now.next` "Nächster Schritt"; `hq.now.missions` "Aktive Missionen im Spiel"; `hq.now.noApp` "Spiel nicht erkannt — SCC-App verbinden"; `hq.log.title` "Logbuch"; `hq.log.all` "Alle anzeigen"; `hq.log.more` "Mehr laden"; `hq.log.undo` "Rückgängig".
- `hq.stock.ships|sets|earned|storage`; `hq.stock.age` "zuletzt geöffnet {{ago}}".
- `hq.stats.*` per tile.
- Errors: `errors.hq.*` via `toErrorKey('hq', op, err)` for load/save/sync/undo.

### 2.2 Banned words (add to a spec that greps `public/i18n/de.json` under `hq.*`)
"gedeckt", "Auftrag", "Operation", "Schritt-Modus".

### 2.3 Open wording item
D30 switch labels — propose "Was brauche ich ⇄ Wie komme ich hin" in the first preview; alternatives if rejected: "Bedarf ⇄ Route", "Was ⇄ Wie".

---

## 3. Data model (Web, Supabase)

Alpha policy: legacy tables may be dropped (document in comments). All tables RLS **self-only** (`user_id = auth.uid()`), `created_at`/`updated_at` with the project's `set_updated_at` trigger, sync columns modelled on `user_spots` (`20261008124350_user_spots.sql`: client id + `updated_at` LWW + tombstone `deleted` + server `synced_at`). Mind the 500 MB DB budget (`.claude/deep-knowledge/storage.md`): cap rows per user and prune.

### 3.1 Migration `20261101000000_hq_supplies.sql` (web-supply)
```
hq_supplies (
  user_id uuid references auth.users on delete cascade,
  id text,                       -- client-generated (keeps offline adds idempotent)
  name text check (char_length(name) <= 80),
  qty int check (qty between 1 and 999),
  done boolean default false,
  entity_kind text null,         -- codex kind when added from search/set (item, commodity, blueprint …)
  class_name text null,          -- codex class name
  set_kind text null check (set_kind in ('ship','fps')),
  set_id uuid null,              -- hangar_ship_configs.id or hangar_role_loadouts.id (no FK: two targets)
  step_kind text null check (step_kind in ('buy','mission','mine','refine','craft','transport','pickup')),
  wanted boolean default true,   -- the user marked it as wanted → drives the tri-state ring (D28)
  source text default 'manual' check (source in ('manual','set','search','live')),
  updated_at timestamptz, deleted boolean default false, synced_at timestamptz default now(),
  primary key (user_id, id)
)
```
Cap 300 rows/user (trigger). Index `(user_id, set_id)`. Migration of the localStorage list: `HqSuppliesService` uploads `sc.hq.supplies` once after sign-in, then removes the key.

### 3.2 Migration `20261101010000_hq_einsaetze.sql` (web-ops)
```
hq_einsaetze (user_id, id uuid pk default gen_random_uuid(), title text, activity text check (activity in (...D19)),
  status text check (status in ('planned','active','done','archived')), planned_at timestamptz null,
  start_location text null, created_at, updated_at, deleted, synced_at)
hq_einsatz_steps (einsatz_id uuid references hq_einsaetze on delete cascade, user_id, ord int,
  kind text check (kind in D18 codes), label text, location text null, system text null,
  class_name text null, qty int null, supply_id text null, mission_ref text null,
  state text check (state in ('todo','done')) default 'todo', done_at timestamptz null, done_by text null check (done_by in ('user','live')),
  primary key (einsatz_id, ord))
```
`Einsatz ×N` = `count(steps)`; badge computed client-side. Drop nothing (`/hq/ops` had no table).

### 3.3 Migration `20261101020000_hq_live.sql` (scc-sync)
```
hq_live_events (user_id, id text,            -- desktop event id (sha of line offset + type + at) → idempotent upsert
  type text,                                 -- GAMELOG_EVENT_TYPES value
  data jsonb check (pg_column_size(data) < 2048),
  at timestamptz, applied jsonb null,        -- what the web/app auto-applied (supply id ticked, step done) for undo
  undone boolean default false, synced_at, primary key (user_id, id))
hq_live_state (user_id pk, state jsonb, updated_at)   -- last snapshot (location, currentShip, contracts, crimestat …)
```
Retention: 90 days via `pg_cron` (`cron.schedule` directly, NEVER `create extension pg_cron` again — memory 2BP01). Cap 20 000 events/user. Realtime: enable `supabase_realtime` publication for `hq_live_state` and `hq_live_events` (RLS applies), so Jetzt updates live.

### 3.4 Migration `20261101030000_hq_inventory.sql` (scc-inv)
```
hq_inventory_snapshots (user_id, location text, system text null, source text check (source in ('log','search','community','ocr','manual')),
  taken_at timestamptz, item_count int, primary key (user_id, location))   -- one per location; new replaces old (D39)
hq_inventory_items (user_id, location text, class_name text null, name text, qty numeric, unit text check (unit in ('pcs','scu')),
  primary key (user_id, location, name), foreign key (user_id, location) references hq_inventory_snapshots on delete cascade)
hq_ship_storage (user_id, ship_ref text, location text, source text, taken_at)   -- from ASOP OCR
```
Undo of a replaced snapshot: keep the previous snapshot as JSON in the replacing `hq_live_events.applied` row (so undo restores it), no history table.

### 3.5 Migration `20261101040000_hq_community.sql` (web-map, D43)
```
hq_community_reports (id bigserial, user_id, kind text check (kind in ('price','stock','location')),
  class_name text, location text, value numeric, reported_at timestamptz default now())
```
RLS: insert self, select none. RPC `hq_community_median(kind, class_name)` SECURITY DEFINER: per location, only when `count ≥ 5`, outliers removed by IQR (1.5×), returns `median, n, newest`. Rate-limit inserts (trigger: ≤ 200/user/day). Reports come from live `shop.purchase` events (price/qty/shop) — opt-in "Community-Daten teilen", default **off**.

### 3.6 Favourites (D22)
Check existing `hangar_ships`/`hangar_ship_configs`/`hangar_role_loadouts` for a favourite flag; if missing, add `favorite boolean default false` + a trigger enforcing ≤ 3 per kind per user (migration `20261101050000_hq_favorites.sql`).

### 3.7 Fleet patch (web-patch, D44)
No new table: an RPC `hq_fleet_patch()` SECURITY DEFINER compares stats of the user's ships/set items between the current and previous `codex_builds` (`where is_current` — verify schema via SQL first, memory "Codex-Schema-Claims per SQL prüfen"), returns max 2 lines (category, effect, affected set). Watch the RPC timeout (authenticated 8 s; use `jsonb_to_record` once per row + MATERIALIZED, memory "Codex-RPC über payload"). Cache the result per build in a small table `hq_patch_cache(build_id, user_id, lines jsonb)` if it costs > 300 ms.

---

## 4. Web — architecture

### 4.1 Routes (`src/app/app.routes.ts` L262–313, `src/app/hq/hq-routes.ts`)
- `/hq` ('' child) → new `HqPagesComponent` (replaces `HqOverviewComponent` as the beta landing), `data: { layout: 'cinematic' }`.
- Anchors: `hqPage = (p: HqPageId) => ({ commands: ['/hq'], fragment: p === 'start' ? undefined : p })` in `hq-routes.ts`; export `HQ_PAGES = ['start','planen','jetzt','bestand','statistik'] as const`.
- `ops` child → `redirectTo: '/hq#planen'` (Angular redirect with fragment via a `redirectTo` function returning a `UrlTree`).
- Router: `withInMemoryScrolling({ anchorScrolling: 'enabled' })` — check `app.config.ts`; if it is off globally, scroll in `HqPagesComponent` on `fragment` changes instead (do not change global scroll behaviour).
- `isMainHeaderPage` (`fusion-bar.model.ts`): `/hq` stays a main page; the subheader appears when the active HQ page ≠ start (driven by the visible section, not by the URL path) → add `ShellChromeService.setHqPage(id)` and let the fusion bar treat `hq` + page ≠ start like a Verse follow page (condensed header + docked search in the subheader).
- Old beta flag off: today's HQ stays untouched (`HqShellComponent` with tabs). Gate the new landing behind `BetaService.state().shell`.

### 4.2 Component tree (new files in `src/app/hq/`)
```
hq-pages.component.ts           five <section id="…"> stages, IntersectionObserver → active page, fragment sync (replaceUrl, no history spam)
hq-rail.component.ts            left-edge rail (desktop ≥ 1024px), roving focus, aria-current
hq-page-bar.component.ts        phone bottom bar (.sc-dock-phone), hide on scroll-down
hq-cue.component.ts             Verse cue triangle, real <a [routerLink] fragment>
start/hq-start.component.ts     hero (kicker, title, patch lines, hero search, chips), first-visit variant
start/hq-first-visit.component.ts  launch steps + Los geht's/Überspringen + ≈ 4 Minuten
plan/hq-plan.component.ts       Was ⇄ Wie switch, selection state, map, list
plan/hq-plan-selection.ts       pure: selection model, Top-3 ranking, mood → filter mapping, session persistence
plan/hq-mood-toggles.component.ts  3 pair toggles
plan/hq-place-tree.component.ts    System › Planet › Ort multi-check dropdown with mini search
plan/hq-set-rings.component.ts     sets as tri-state rings + reachability
plan/hq-plan-map.component.ts      SVG schematic map (systems accordion, shapes, lines, legend)
plan/hq-route.ts                   pure: route builder (start system first, nearest-neighbour + transport legs)
now/hq-now.component.ts          location anchor, main path, missions icon, log preview
now/hq-missions-popover.component.ts
now/hq-log-dialog.component.ts   [scDialog], grouped by day, lazy "Mehr laden" (page size 30)
now/hq-live.service.ts           Realtime subscription on hq_live_state/events, auto-apply + undo
stock/hq-stock.component.ts      Schiffe, Sets, Erspieltes, Lager
stats/hq-stats.component.ts      6 tiles + detail dialogs
data/hq-einsatz.service.ts       CRUD hq_einsaetze/steps
data/hq-inventory.service.ts     snapshots, manual capture, age
data/hq-community.service.ts     median RPC
data/hq-patch.service.ts         fleet patch RPC
```
Shared (app-wide):
```
src/app/shared/tristate/sc-tristate.component.ts   ring + checkbox variants: value 0..1, states empty/partial/full; aria-checked="mixed"
src/app/shared/step/sc-step.component.ts           unified step: kind icon (shape = D29 shape), label, qty, location, state todo|done, optional undo
```
`HqOverviewComponent` / `HqSpotStageComponent`: reuse the zoomed planet stage as the Start/first-visit backdrop (`<sc-hq-spot-stage>`), keep the files.

### 4.3 Frame rules (CLAUDE.md)
- Pages never set `max-width`/centring margins/side padding on their root; follow-page content uses the subheader column (`--sc-chrome-w`).
- Navigations are anchors (rail, bottom bar, cue, chips, tiles, set rings that *navigate*; rings that *select* are buttons).
- No native dialogs/selects/titles: `sc-select`, `[scTooltip]`, `ScConfirmService`, `[scDialog]`.
- Red only for elevated access — HQ uses `--sc-accent`; aged data `--sc-warning`; a worse comparison `--sc-warning`.
- Phones: floating toast + bottom bar respect `--sc-float-bottom` / `--sc-fab-clear-*`; dialogs size with `dvh`.
- Errors via `toErrorKey`; logs via `core/log.ts`; load failure renders an error state with retry.

### 4.4 Search (fusion-search, D11–D14)
- `search-context.ts` L70: today `hq` → `ctx('hq', ['ship'], true)`. Extend `SearchContextKey` with `hqPlan | hqNow | hqStock | hqStats` and add an **exclusion** field to `SearchContext`: `exclude: readonly PolyHitKind[]` + `deprioritize: readonly PolyHitKind[]` (the context still never hard-filters "every group stays reachable" — exclusion = collapsed group "weitere Treffer"). Example: Bestand excludes `mission`, deprioritises `shop`; Planen deprioritises nothing; Statistik excludes `codexDetail` places.
- Context derived from the active HQ page (`ShellChromeService.hqPage()`), not only the URL.
- Chip label per page (`fusionBar.context.hqStock` = "Bestand" …).
- HQ verbs: new action column in result rows (`→ Hangar`, `→ Set …`, `→ Nachschub ×N`, `→ Einsatz`), via a pure `hqVerbFor(hit)` mapper next to `search-context.ts`.
- Missions group: needs mission data in the Codex index — check the kinds the uploader ingests; if missions are missing, add an uploader ingest kind (SCC-App/uploader task, see §6.3) and a `mission` PolyHitKind.

### 4.5 Selection model (pure, `hq-plan-selection.ts`, fully unit-tested)
```
interface PlanSelection { steps: Set<StepKind>; places: Set<PlaceId>; sets: Map<SetId, number /*0..1*/>; moods: MoodPairs; supplyIds: Set<string>; origin: 'top3'|'mood'|'custom' }
initialSelection(session: Storage, supplies, sets): PlanSelection   // D24
top3(supplies, sets, einsaetze): string[]                            // favourite set > einsatz soon (< 48 h) > blueprint gap; stable tiebreak by name
applyMood(sel, pair, side): PlanSelection                            // origin = 'mood'
toggle(sel, …): PlanSelection                                        // origin = 'custom', session flag changed = true
setFraction(setId, supplies): number                                 // wanted parts of the set / all parts of the set (D28)
visibleNeeds(sel, supplies): Supply[]                                // drives list AND map (D27)
```
Mood → filter mapping (data-driven table, `hq-moods.ts`): Friedlich = {buy, mine, refine, craft, transport, pickup}, Kampf = {mission with activity kopfgeld|bunker|piraterie}, Schnell = estimated step time < 30 min, Zeitintensiv ≥ 30 min, Solo = crew ≤ 1, Gruppe = crew ≥ 2 (ship crew from Codex). Time estimates: QT distance (Codex locations) + fixed per-kind costs; documented in the file.

### 4.6 Map (`hq-plan-map.component.ts`)
- SVG, schematic not physical: systems as accordion strips (start system open), planets as circles on a ring, locations as nodes.
- Encoding D29: shapes per step kind (buy ◆, mission ★, mine ▲, refine ⬢, craft ■, transport ⬤ with thick line, pickup ▼); size scale qty (3 sizes); colour = need (set colour from a 6-colour categorical palette — load the `dataviz` skill before choosing colours); fill = status (outline open, half partly, full done).
- Route view: numbered path, dashed travel lines, thick transport lines, current step pulsing (reduced motion: static).
- Accessible: every node a focusable `<a>`/`<button>` with aria-label; a list twin under the map on phones.

### 4.7 Jetzt live
- `HqLiveService`: Supabase Realtime channel on `hq_live_state` + `hq_live_events` (filter `user_id=eq.<uid>`); fallback polling 30 s when Realtime fails.
- Auto-apply: `shop.purchase` (kind buy) → tick matching supply (class name or normalised name match, qty decrement), mark matching Einsatz step done (`done_by='live'`); `refinery.complete` → step refine done; `contract.completed` → mission step done; `hangar.ready`/`qt.arrived` → update location anchor. Every apply writes `applied` on the event row → undo reverts exactly that.
- Toast (`sc-undo-toast` exists in `src/app/shared/undo-toast`) → FLIP into the first log row (D34).
- No app: `DesktopConnectionService` says not connected / older than 30 days → connect CTA (D37) linking `/apps` (anchor).

---

## 5. Packages (build order, each with acceptance criteria)

Order: **web-frame → web-supply → web-ops → scc-sync → web-map → web-stats → scc-inv → web-patch**. Ship all together (one release).

### P1 web-frame
Scope: §4.1–4.3, `HqPagesComponent`, rail, phone bottom bar, cue, Start + first visit, subheader behaviour, search exclusion config skeleton, `sc-step`, `sc-tristate` (shared, with stories in specs).
Acceptance:
- `/hq` shows Start fitting one viewport at 1280×720 and 1920×1080 incl. the uncut Planen cue (h1-s1 pin); first visit when no hangar ship, no desktop connection and no Einsatz.
- Scrolling to Planen condenses the header and shows the real subheader with docked search; content edges align with the subheader (pixel check in a Karma spec comparing `getBoundingClientRect` of `.sub` and the page column).
- Rail: 5 anchors, `aria-current` follows scroll, hidden < 1024px; phone bottom bar at 375px, no overlap with the feedback launcher (mobile gate).
- Fragment deep links `/hq#jetzt` land on Jetzt; back/forward work; no history entry per scroll.
- Beta off → old HQ unchanged (spec).

### P2 web-supply
Scope: §3.1 migration, `HqSuppliesService` → Supabase (offline queue + LWW like spots), one-time localStorage import, `wanted` flag UI, "für Set …" + step-kind chip, "liegt bereit".
Acceptance: two browsers converge; offline add survives reload; RLS test (other user sees nothing); `sc.hq.supplies` removed after import; ring fraction updates when marking parts wanted.

### P3 web-ops
Scope: §3.2 migration, `HqEinsatzService`, Planen selection model §4.5, mood toggles, place tree, set rings, Was ⇄ Wie switch, route builder, "Als Einsatz speichern", unified step list, Start chips for upcoming Einsätze, `/hq/ops` redirect.
Acceptance: D23–D31 each covered by a spec (selection default per session, mood pairs, unselected hidden, filters absent in route view, Einsatz ×N badge + tooltip, banned words spec).

### P4 scc-sync (SCC-App + Web)
SCC-App (`modules/desktop/src/hq-live-sync-service.js`, modelled on `spots-sync-service.js`):
- Opt-in setting `hq.liveSync.enabled` (default false) in the desktop settings UI (Angular `modules/desktop/ui-angular`), copy explains what is sent (event types, no chat, no player names except own character; party member names hashed or dropped — decide: **dropped**).
- Subscribes to `gamelog.event` + `gamelog.state.changed` from the daemon; maps to `hq_live_events` rows (id = sha1 of `type|at|stable data`), batches every 5 s / 50 events, upserts with `on_conflict=user_id,id`; `hq_live_state` upsert throttled to 1/10 s.
- Uses the SCC session (`scc-session.json`, DPAPI, main process only — SEC-13), backoff as spots sync, tokens never logged, `log-redaction.js` on payloads.
- `gamelog` must run: when sync is enabled, `isGamelogWanted` returns true (extend `modules/shared/callout-catalog.js`).
- Tests: node --test for mapping, id stability, batching, backoff, disabled = no request.
Web: §4.7 live service, Jetzt page (location anchor, main path, missions icon popover, log 3 + dialog), auto-apply + undo.
Acceptance: an `shop.purchase` replayed through a fake daemon reaches the web within 10 s and ticks the supply; undo restores it; sync off → zero requests.

### P5 web-map
Scope: §4.6 map, §3.5 community reports + median RPC + opt-in, source order D43 for "where to get it" (Log known shops → Codex shop data via search → community median → OCR), legend.
Acceptance: encoding legend matches D29; accordion systems; median only with ≥ 5 reports (SQL test in a rolled-back transaction as the real role); phone list twin.

### P6 web-stats
Scope: Bestand (§1.7 D38–D39) and Statistik (6 tiles from `hq_live_events` aggregates via one RPC `hq_stats(range)`), docked search scope "Bestand", footer.
Acceptance: tiles render with empty data (zero states, not error); RPC < 1 s for 20 000 events; age margin note turns warning at 7 days.

### P7 scc-inv (SCC-App + Web)
SCC-App:
- Log: `RequestLocationInventory` and `<UI - LoadoutEditor> AsyncGetPersonalLocationInventoryId` → new gamelog event `inventory.opened { location }` (add to `GAMELOG_EVENT_TYPES` + docs/features/gamelog.md table).
- OCR (`docs/features/ocr-analysis-loop.md`): new profiles `inventory-local`, `asop-terminal`, `shop-kiosk`; **armed only** after `inventory.opened` (I key / log line) or an F interaction at an ASOP/kiosk, **disarmed** when the screen closes (no matching text for 2 cycles) or after 60 s; foreground + fullscreen only (existing rule). Never runs otherwise (D42).
- Parsed rows → `hq_inventory_snapshots/items` and `hq_ship_storage` via the same sync service; new snapshot replaces old, previous one stored in the event's `applied` for undo.
- Opt-in `hq.inventory.ocr.enabled` (default false), separate from live sync.
Web: Lager section, manual capture via search ("liegt in …" quick action writes source `manual`), snapshot age.
Acceptance: fixture screenshots → expected rows (pytest/node test on the OCR parser); no OCR cycle without an arm event (test).

### P8 web-patch
Scope: §3.7 fleet patch RPC + Start hero patch lines (D8, D44); hidden when nothing relevant.
Acceptance: fixture builds → correct effect lines; no line when the user owns nothing affected; RPC within timeout.

---

## 6. SCC-App specifics

### 6.1 Files
- `modules/desktop/src/hq-live-sync-service.js` (new), wired in `modules/desktop/src/main.js` next to `spots-sync-service.js`.
- `modules/shared/callout-catalog.js` — `isGamelogWanted` honours `hq.liveSync.enabled`; new event `inventory.opened`.
- `modules/gamelog/engine.js` / parsers — the `inventory.opened` parser.
- OCR profiles in the OCR loop module (see `docs/features/ocr-analysis-loop.md` for the profile format) + arm/disarm gate.
- Settings UI in `modules/desktop/ui-angular` (two toggles, explanatory copy, link to the web HQ).
- Docs: `docs/features/gamelog.md` (event table, privacy section: "Local only" changes to "local unless HQ live sync is enabled"), new `docs/features/hq-live-sync.md`, `docs/features/ocr-analysis-loop.md` (arm gate).

### 6.2 Contract with the web
A shared contract doc `docs/contracts/hq-live.md` in BOTH repos (copy, version header): table columns, event-id rule, allowed types, payload size limit, opt-in semantics, retention. Changes need both repos.

### 6.3 Missions in search (D14)
If mission/contract definitions are not in the Codex yet: uploader ingest kind `mission` (uploader repo/module), web `PolyHitKind 'mission'`. Treat as part of P3 if data exists, else as a follow-up issue (do not block the release on it — the "→ Einsatz" verb still works for Codex items).

### 6.4 Release
SCC-App version bump (minor) and release through its own flow in the same go; web release notes mention "SCC-App ≥ 0.94.0 nötig für Live-Daten". Web works without the new app (CTA).

---

## 7. Tests and gates

- Web: `npm run typecheck`, `npm run lint`, `npm test` (Karma — viewport 749px: media-query specs must set their own widths, memory), `npm run build` (the only template gate), `npm run test:gate`, mobile gate against your own `dist` with `--base-url` (memory), check-native-ui / check-raw-errors prebuild guards.
- Test runners always in their own Bash call (memory).
- SQL: RLS tests as the real role in a rolled-back transaction; RPC timing.
- SCC-App: node --test for sync + parsers; pytest with `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1` where Python is involved.
- Visual: Playwright (signed-in test account, `.claude/deep-knowledge/test-account.md`) layout matrix 375 / 768 / 1280 / 1920 for all five pages; View Transitions need Playwright (hidden pane aborts them).
- Fixtures use `@example.com` / `.test` emails (email guard).

---

## 8. Execution plan (agents, waves)

Full ceremony via `auto-agents`:
- **Wave 1 (parallel):** core — migrations §3.1–3.5 + RPCs + RLS tests; frontend — P1 web-frame (shared `sc-step`, `sc-tristate`, pages shell, rail, bottom bar, Start). SCC-App core — P4 sync service skeleton + contract doc.
- **Wave 2:** frontend — P2 + P3 (depends on migrations); SCC-App — gamelog opt-in + settings UI.
- **Wave 3:** frontend — P4 Jetzt + live service; P5 map; core — community RPC.
- **Wave 4:** frontend — P6 Bestand/Statistik; SCC-App — P7 OCR arm gate + profiles; core — P8 patch RPC.
- **Wave 5:** qa — full gates both repos, Playwright matrix, mobile gate; redteam on migrations + live sync (auth, PII, rate limits).
- Ship: web via `/ship` (one release, minor bump), SCC-App via its release flow; owner sets the `alpha/vX.Y.Z` tag locally if the cloud proxy refuses.

Two writers never touch the same files: `src/app/shell/fusion-bar/*` belongs to wave-1 frontend only.

---

## 9. Pre-mortem (risks)

| Risk | Mitigation |
|---|---|
| Realtime + RLS leaks other users' events | channel filter + RLS; spec with two users; redteam |
| PII in live events (party names, chat) | drop party member names on the desktop side; payload size cap; `log-redaction.js` |
| DB budget (500 MB) | caps per user, 90-day retention cron, jsonb size check |
| Fleet patch RPC timeouts | MATERIALIZED CTE, cache table, measure as `authenticated` |
| OCR CPU / false reads | arm gate, 60 s max, opt-in, last resort only |
| Fragment scrolling fights View Transitions / shell scroll | IntersectionObserver with `replaceUrl`, no `scrollIntoView` during a transition |
| Header condense regression on Verse/Codex | fusion-bar specs (`fusion-bar.route-morph.spec.ts`, `shell-header-condense.spec.ts`) must stay green; new hq specs beside them |
| Vercel Hobby deploy limit with many sub-branch pushes | push integration branch sparingly; `skipChecks` only with flagged lag (memory) |
| Migration ledger collision | unique timestamps, push from primary (memory) |

---

## 10. Follow-ups (issues, not in this release)

- Explore bringing more into HQ (reputation, org, trading, wishlists …) — via a devops concept later (issue created 2026-10-31).
- SCC-App ↔ Web live-data sync (P4) and SCC-App inventory capture (P7) also tracked as issues in both repos.
- Variant page for personal ship variants (D22 "later").
- Missions ingest kind if not available (§6.3).
