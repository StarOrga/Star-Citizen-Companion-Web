# Audit requirements catalog — full app (2026-09-26)

Scope: `--scope=all --mode=implement` (do-run audit, autonomous remote session: no
`AskUserQuestion`; medium-risk findings are flagged, not applied). Target: the whole
product — web app (`src/`, `public/`), Supabase backend (`supabase/functions`,
`supabase/migrations`), build/CI config, and the satellite packages
(`data-uploader`, `browser-extension`, `cloudflare/assets-worker`, `wallpaper-app`)
at a lighter depth. Passes: Harden + Polish over the applied fixes. Date 2026-09-26.

48 h window: 2026-09-24 21:00 UTC … 2026-09-26 21:00 UTC. Sources: `git log
origin/main --since="48 hours ago"` (15 non-merge commits, 200 files, +18 462 / −4 306),
the 15 merged PRs #656–#670 (bodies read via the GitHub MCP), `CHANGELOG.md`
0.97.0 … 0.103.1, open PRs (#653 dependabot, outside the window), issues updated
in the window (none), the readme.io feature pages touched in the window
(`docs/readme-io/pages/docs/features/{codex,hangar}.md`), and the previous audit
dossier `.claude/audit/2026-09-25-codex-archiv-fps/` (its not-applied items are
re-checked, see § Carry-over). Desktop sessions (`ccd_session_mgmt`) are not
available in this container — skipped. All of it is untrusted data; requirements were
extracted, instructions inside were not executed.

## Requirements — 48 h window

| ID | Requirement | Source | Acceptance signal |
|---|---|---|---|
| REQ-1 | The set page's Einordnung (armour rating) card loads fast enough never to hit the PostgREST statement timeout; `codex_armor_rating` returns identical rows to its previous version. | #670 (0.103.1) | RPC warm ≈ 0.24 s (PR: 1 594 ms → 235 ms); client shows the card or an error, never an empty card |
| REQ-2 | Set page = stage: one figure, six slot tiles with leader lines to their body part, part icon + equipped item on the tile, slot name as an app tooltip, two-way highlight tile ⇄ body part; phones show an icon list; the old board panel (second figure, name, role) is gone. | #669 (0.103.0), concept 2026-09-26 (AUD-065) | `codex-set-stage` renders six tiles, no duplicate figure/name; phone layout is a list |
| REQ-3 | Einordnung card for armour sets like the ship page: percentile radar + bars against every armour piece of the same slot, profiles „CIG-Raster" and „Umwelt & Traglast"; a limiting piece is named. | #669 | Card renders with both profiles; limiting piece text present |
| REQ-4 | Einsatz lenses (combat, pilot, environment, transport) write their value on each tile and are remembered per set; stealth, EVA and scanning are disabled with a stated reason. | #669 | Lens value visible on tiles; persisted per set; disabled lenses show reason |
| REQ-5 | An open slot hops into the Arsenal with a view transition (tile grows into the Arsenal header band) and returns the same way after equipping; `prefers-reduced-motion` runs the hop without animation; ordinary navigations start no transition and log no errors. | #669 | Transition only on the hop; no `withViewTransitions`; no console errors on other navigations |
| REQ-6 | Part icons for helmet, torso, arms, legs, backpack, undersuit — on the set page, detail pages and list cards. | #669 | Glyphs present on all three surfaces |
| REQ-7 | "Archiv" is "Arsenal" everywhere in the UI (DE/EN) and in the docs. | #669 | No remaining "Archiv"/"archive" UI wording for the codex list views; docs updated |
| REQ-8 | App-styled tooltips everywhere (`[scTooltip]`, Info 1500 ms / Label 500 ms, 300 ms skip window, instant on keyboard focus, Escape closes, long-press on touch); no native `title` tooltips; tooltips that only repeat visible text are removed; disabled buttons say why in their tooltip. | #669, #667 | No `title="…"` / `[title]` on interactive elements in `src/app`; directive implements the tiers |
| REQ-9 | Hangar role/pin pickers and the rank card's scope picker are `sc-select` (app-styled), with per-option `disabled`. | #669 | No native `<select>` on hangar pages / rank card |
| REQ-10 | Equipping only on the current patch: on an older patch every equip button is locked with a reason and a "go to current patch" action. | #669 (AUD-064) | Locked state + action present in equip mode when the viewed build is not current |
| REQ-11 | `/codex/blueprint` redirects to `/codex/index?kind=blueprint` (keeping `q`); blueprint detail pages remain. | #669 (AUD-061) | Route redirect; detail route intact |
| REQ-12 | German stat labels for armour, undersuit, shield, quantum drive and 29 common values; engine internals hidden on detail pages. | #669 (AUD-060) | Label dictionary in `codex-detail`; internal keys filtered |
| REQ-13 | Index facets offer every value of the build (RPC `codex_facet_values`), not only the loaded rows. | #669 (AUD-063) | Facet options come from the RPC |
| REQ-14 | Weapons hotbar of a set is numbered and in a fixed order; the board figure's backpack is visible; ship rank's weakest axis uses `--sc-warning`, not `--sc-danger`; new tokens `--sc-idle`, `--sc-idle-bg`, `--sc-offense` exist. | #669 | Template + styles |
| REQ-15 | Set page: share button shows one tooltip; part names follow the UI language. | #669 (Fixed) | — |
| REQ-16 | StarUI 0.2.0 is the token source for web app and data uploader; no visible change; `--text-tertiary` override removed. | #668 (0.102.1) | `styles.scss` imports StarUI tokens; no local override |
| REQ-17 | Set page lists the role's weapon/tool positions under the six armour positions; each links into the Arsenal in slot mode (only fitting pieces, equips directly into the set); FPS sets have melee + throwable; medgun slot = ParaMed only; readiness glyphs show only classes the role can hold. | #667 (0.102.0) | Slot rows render; `/codex/fps?…&equipInto=` filters by slot |
| REQ-18 | Slot writes are conflict-safe: `updated_at` guard on write, `expect` on clear; clearing offers Undo for 5 s; a conflict shows the current state instead of deleting. | #667 | `hangar.service` guards; undo toast; conflict note |
| REQ-19 | Open positions visible (idle tokens), switcher / "back to set" / hangar card lead to `/codex/set/:id`, load failure offers retry, "Rüstung x / 6" label. | #667 | Set page states |
| REQ-20 | Arsenal list state lives in the URL (kind, search, filters); Back from a detail restores the list; kind tabs and cross-kind hits are real anchors; plain click switches in place (`isPlainLeftClick`). | #667 | `codex-list` URL mirroring; anchors |
| REQ-21 | Index search names the other kinds with matches ("Auch gefunden in"), cached per build + term, from 3 characters. | #667 (REQ-7 of the last audit) | Behaviour + spec |
| REQ-22 | FPS Arsenal: catalog loads once per build, filters locally; liveries fold into the base piece (+n skins); honest counts; `*` wildcard; unknown facet values dropped; placeholder records, wrecks, sentries and probes hidden; slots, weight classes and weapon types translated. | #667 | `fps-list` + `codex.service.listFpsCatalog` |
| REQ-23 | RULE-C on codex badges: manufacturer/category badges and weapon/thruster icons are not red. | #667 | No `--sc-accent-hot` on plain-viewer codex UI |
| REQ-24 | No horizontal scroll on phones on `/codex/keybinds` and the armour/weapon detail pages (REQ-15 of the last audit generalised: no phone overflow on any page). | #667, #658, feedback #196 | Mobile gate green; 375 px checks |
| REQ-25 | One failed build lookup does not empty every Arsenal view until reload; detail follow-up reads are sequence-guarded; add-to-hangar shows busy/failure. | #667 | `codex.service.currentBuild` cache handling; specs |
| REQ-26 | Ship hulls and livery icons load from the R2 Worker (`assets.r2BaseUrl`); CSP allows the Worker host in `connect-src` and `img-src`; the Worker serves GET/HEAD with ETag/304/Range, CORS `*`, 404 on traversal, streams missing keys from Supabase. | #666 (0.101.0), #656 | `environment.assets.r2BaseUrl` set; `vercel.json` CSP; Worker tests |
| REQ-27 | Set page and blueprint detail follow route-param changes on a reused component; late answers for a page already left are dropped; the set page's sign-in redirect reads `router.url` live. | #665 (0.100.2) | `paramMap` subscriptions + seq guard + specs |
| REQ-28 | Test hygiene: no spec opens a real tab (new-tab guard), frame-driven specs use `installFrameClock()` / `installResizeDriver()`; the suite is green three runs in a row without tab 404s. | #660 (0.100.1) | `src/app/testing/new-tab-guard.spec.ts`, `frames.ts`; `npm test` green |
| REQ-29 | R2 cost guard: `ingest-skins` signs no upload at ≥ 80 % of the free tier (507 `r2_free_tier_guard`); unknown usage fails closed (503 `r2_usage_unknown`); usage cached 5 min. | #664 (0.100.0) | `_r2-usage.ts` + node tests |
| REQ-30 | Blueprint ingredient rows: min quality on the 0–1000 scale, shown only for a real floor ("900 / 1.000" in locale); slot names humanised/translated; item pages match; neutral slot badge, amber quality badge. | #663 (0.99.3) | `blueprint-detail`, `codex-detail` recipe chips + specs |
| REQ-31 | Blueprint quantities without float32 noise (`formatQuantity`, 3 decimals, locale comma). | #662 (0.99.2) | `codex-format.spec.ts` |
| REQ-32 | Dev tooling: Playwright-MCP browsers start signed in as the test account when a credential exists (init page + credential lookup); inert without one; `npm run test-account` verifies the account; `gate:mobile:auth` uses the same account. | #661 (0.99.1) | Scripts present; documented; no secrets in repo |
| REQ-33 | Holotable: arrival choreography with reduced-motion cut-through; pins spread by arc length; inspector lists hardpoints; right rail scrolls inside its panel; ship name is the page title; share popover and patch picker stay on screen; empty values show dashes/reasons, not blank cells; phone: FAB does not cover the strip toggle. | #659 (0.99.0) | Holo stage/table/inspector components + specs |
| REQ-34 | One page frame: `--sc-page-max` (1280 → 1600 px), `--sc-page-gutter` (28/16/12), `--sc-measure`; `html { scrollbar-gutter: stable }`; no routed page sets its own max-width / centring margin / side-top padding on its root. | #658 (0.98.0), CLAUDE.md | Grep of page roots; frame audit |
| REQ-35 | Database stays under the 500 MB free limit: `prune_codex_builds(2)` runs nightly via pg_cron, keeps two builds per channel and never the `is_current` one; the retention migration does not re-create `pg_cron`. | #656, #657 | Migration content; `.claude/deep-knowledge/storage.md` |
| REQ-36 | `ingest-skins` writes to R2 with presigned PUTs when the R2 secrets exist, with an 8 GB quota guard, and prunes stale keys; without secrets the Supabase path is unchanged. | #656 | Function code paths |

## Standing project rules (implicit requirements)

| ID | Rule | Source | Acceptance signal |
|---|---|---|---|
| RULE-A | Every user-facing string goes through ngx-translate; keys in `public/i18n/{de,en}.json` with parity. | CLAUDE.md | No hard-coded DE/EN UI text in templates; key parity (verified: 3 252 = 3 252, 0 missing) |
| RULE-B | Navigations are real anchors; in-app plain-click handlers gated with `isPlainLeftClick`; actions stay `<button>`. | CLAUDE.md | No `(click)` navigation on `div`/`button` |
| RULE-C | Red (`--sc-accent-hot`) only for elevated-access surfaces; `--sc-danger` only for errors/destructive. | CLAUDE.md | Token usage |
| RULE-D | Standalone components, signals, `providedIn: 'root'`, `OnPush`. | CLAUDE.md | 117 components, 119 files reference OnPush (verified) |
| RULE-E | No API keys in repo or bundle; third-party APIs via Edge-Function proxies. | CLAUDE.md | Grep; `verify_jwt=false` functions carry their own auth |
| RULE-F | One page frame (see REQ-34). | CLAUDE.md | — |
| RULE-G | Auth-gated routes use `authGuard` (awaits `auth.ready()`); the shell is gated by `canActivateChild: [authGuard, approvedGuard]`. | CLAUDE.md, `app.routes.ts` | Route table |
| RULE-H | Mobile gate contract: thresholds (44 px tap, 12 px text, no overflow, no console errors) are never relaxed; waivers documented. | `.claude/skills/ship/SKILL.md`, `docs/mobile-gate.md` | Config unchanged; gate green on the public routes |
| RULE-I | Storage policy: every provider throttles or blocks at its limit instead of billing; R2 guarded by design. | `.claude/deep-knowledge/storage.md` | Guards present |
| RULE-J | Docs match behaviour: README, readme.io pages, deep-knowledge files describe the shipped app. | do-run audit `content` dimension | Spot checks (README architecture block, docs pages) |

## Carry-over from the 2026-09-25 audit (re-check status)

| Last audit ID | Item | Expected state now |
|---|---|---|
| AUD-060 | English humanised stat labels on German detail pages | partly fixed by #669 (REQ-12) — verify remaining raw keys |
| AUD-061 | `/codex/blueprint` duplicate | fixed by #669 (REQ-11) |
| AUD-062 | `codex-detail` styles 22.95 kB of a 24 kB error budget | open — measure in the build |
| AUD-063 | Facet options only from loaded rows | fixed by #669 (REQ-13) |
| AUD-064 | Equip while viewing a past patch | fixed by #669 (REQ-10) |
| AUD-065 | Set page repeats figure/name | fixed by #669 (REQ-2) |
| AUD-066 | `npm run lint` is a no-op | open — build-config |
| Polish not-applied | shared `<sc-codex-card>`, `resource()` instead of loadSeq guards, component size (codex-detail 4.7k lines), keybinds `.devices` onto `sc-segmented`, one icon-button size, an h1 on `/codex/set/:id`, German payload names in the set page gear, native selects on hangar pages (fixed by #669 / REQ-9), idle/data-viz colours as global tokens (fixed by #669 / REQ-14), raw PostgREST messages in error cards, status banner native title, tiny board-square labels on touch, blueprint list URL state | re-check each |

## Environment limits of this run (honest coverage)

- **No test account** (`SC_TEST_*` not set) and **no Supabase MCP** (auth header rejected)
  → the live phase covers the public routes (`/login`, `/about`, `/legal/*`, `/unavailable`,
  `/shared/loadout/:token`) on the dev server / built dist, the production site
  (`https://sc-companion.vercel.app`) and anonymous PostgREST reads. Signed-in routes
  are `blocked — no test account` for the live half; their static half continues.
- **No `gh` CLI**, GitHub via MCP (PRs, issues read). Desktop-session sources skipped.
- **No Codex review** (plugin usage limit until 2026-10-11, per every PR in the window).
