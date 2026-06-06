# Changelog

All notable changes to SC Companion are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.15.2] - 2026-06-06

### Changed — Design system: StarUI v0.1.1 tokens (web + data-uploader)

- **Token migration.** The remaining hardcoded `#00d4ff` / `#ff5722` color
  literals in the web app and the Data Uploader were replaced with StarUI
  token channels (`--accent-primary-rgb`, `--accent-hot`, `--status-success-rgb`,
  …). Colors now resolve to the canonical StarUI palette (softer teal, official
  orange) instead of un-migrated pre-StarUI values. Bumped `@starorga/star-ui`
  to `v0.1.1`.

### Fixed — Data Uploader: extractor no longer aborts mid-run

- **MAX_PATH crash.** The exhaustive record dump wrote each JSON outside the
  per-record guard, so a DialogueContext record whose path exceeded Windows'
  260-char limit aborted the entire run (no manifest, nothing uploaded). The
  write is now guarded and over-long names are capped; systemic write failures
  are counted and surfaced.
- **Catalog noise.** A shared token-based filter (`_is_catalog_entity`) now
  excludes dev/test scaffolding and NPC/derelict/world variants from every
  typed catalog (ships, weapons, components, items, ammunition, blueprints) —
  e.g. ships 920→306, items 21033→19771. Raw records are still captured by the
  generic dump.
- **Stale output.** The per-run projection dirs are wiped at extraction start
  so counts/diffs reflect only the current patch (`--skip-generic` and asset
  caches are preserved).

## [0.15.1] - 2026-06-06

### Fixed — News: YouTube & Spectrum feeds restored

- **YouTube feed.** The hardcoded channel ID was stale and returned HTTP 404,
  so the YouTube filter always showed 0. Switched to the live "Star Citizen"
  channel (`UCTeLqJq1mXUX5WWoNXLmOIA`).
- **Spectrum feed.** The HTML scrape relied on a `__INITIAL_STATE__` blob RSI
  no longer inlines (page returned 200 with zero threads), so the Spectrum
  filter always showed 0. Replaced with the forum's internal JSON API
  (`/api/spectrum/forum/channel/threads`, no auth token) reading the SC
  Announcements channel; malformed entries are skipped rather than backfilled
  with synthetic ids/dates.
- **Note.** The channel filters themselves were never broken — they correctly
  reflected the empty upstream feeds.

## [0.15.0] - 2026-06-05

### Added — PWA: prompt to reload when a new version is ready

- **Service-worker update prompt.** A new `SwUpdateService` listens for ngsw
  `VERSION_READY` and polls every 30 min, so a freshly deployed build is
  detected even in long-open tabs. A localized banner ("Neue Version
  verfügbar" / "Neu laden" / "Später") appears above all routes; "Neu laden"
  calls `activateUpdate()` and hard-reloads into the new version.
- **Why.** Without an explicit `SwUpdate` flow, ngsw downloads a new deploy in
  the background but never activates it while a tab stays open — returning
  users kept seeing a stale shell (missing Codex nav link, deep-link bounces
  to `/news` from chunk-hash mismatches). The prompt closes that gap.
- **i18n.** `update.*` keys added in all 7 languages (de, en, es, fr, pt, ru, zh).

## [0.14.0] - 2026-06-04

### Added — Codex: crafting blueprints, extracted from Data.p4k

- **New codex entity type — crafting blueprints.** `CraftingBlueprintRecord`
  (1561 in the live DataCore) is projected by the desktop extractor
  (`sc_extract`) into typed `blueprints/<className>.json`: ingredients (with
  className joins, quantity, min-quality, role), outputs, category, craft &
  dismantle time (normalized from `TimeValue_Partitioned`), quality refs, and
  tags — name-agnostic candidate-field resolution with graceful nulls (raw
  DataForge field names are confirmed against the live build at extraction).
- **DB layer.** New `codex_blueprints` + `codex_blueprint_ingredients` tables
  (migration `00010`) with the standard codex RLS (authenticated read,
  service-role write). The ingredients child table is indexed both forward
  (blueprint → ingredients) and reverse (ingredient → blueprints).
- **Browse + detail UI.** `/codex/blueprint` list (category facet, fuzzy
  search, craft-time sort) and `/codex/blueprint/:className` detail
  (ingredients deep-link to their codex pages; static quality summary). de/en.
- **"Used in blueprints" reverse panel** on item / component / weapon detail
  pages — the "what can I craft with this?" lookup.
- **Full-catalog seeding.** The seeder + `ingest-catalog` now write blueprints,
  and the per-kind 400-row caps are lifted so the whole catalog goes online.

> Activation: the `codex_blueprints` tables ship **empty** — run the extractor
> against a live `Data.p4k`, then seed, to populate them.

## [0.13.0] - 2026-06-04

### Added — Ship skins: build & upload from the desktop uploader (was CLI-only)

- **3D ship-skin export is now a GUI flow** in the `data-uploader` (v0.5.0).
  A new "3D-Skins" view lets you pick ships, build a web-ready glb per livery
  from `Data.p4k`, and upload — no command line. Live progress streams from the
  Python pipeline; the official store-icon + Localization name ride along.
- **No secret in the binary.** New `ingest-skins` edge function authenticates
  exactly like `ingest-bundle` (user JWT + release-token + admin/collaborator)
  and hands the tool short-lived **signed upload URLs** — assets PUT straight
  into the public `ship-skins` bucket, never through the function — then
  commits the `ship_skins` rows server-side (paths re-derived from validated
  ids, so no path traversal). The service role lives only in the function.
- **Node-free optimizer.** The glTF optimizer (`@gltf-transform/cli`, bundled)
  now runs through Electron's own Node, so the packaged app needs no global
  `npx`/Node. `sharp`'s native binary is `asarUnpack`ed for runtime loading.
- **First Cutlass Black skins are live** (7 liveries) — uploaded via this
  pipeline and visible on the codex ship detail page for signed-in users.

## [0.12.0] - 2026-06-04

### Fixed — Verse News: thumbnails no longer vanish (server-side image cache)

- **News images are now cached server-side** instead of hot-linked from RSI's
  CDN. `fetch-verse-news` downloads each Comm-Link / YouTube thumbnail once
  (service-role, with an RSI `Referer`), stores aspect-preserving `post`/`cover`
  variants in the new public `news-images` bucket, and returns our own durable
  public URLs. Fixes cards that fell back to the empty gradient placeholder when
  RSI's signed `/i/<sha1>/…` proxy URLs expired or cross-origin hotlinking was
  referer/rate-limited.
- **Bounded & resilient.** A `verse_image_cache` index avoids re-downloading;
  work is capped at ≤16 new images per request and any miss/failure gracefully
  falls back to the raw RSI URL (cached next cycle). No-op when the bucket/index
  is absent, so deploy order is safe.
- **Responsive srcset preserved.** `rsiVariant()` now also rewrites the cached
  `…/<hash>/{post,cover}.<ext>` URLs, so the existing 500w/1140w `srcset` keeps
  working on the cached copies.
- **Schema.** New public `news-images` storage bucket + `verse_image_cache`
  table (service-role-write; RLS-on; idempotent migration).

## [0.11.0] - 2026-06-04

### Added — Ship liveries: 3D skin selector from Data.p4k

- **Per-ship 3D livery selector** on the codex ship detail page. Selecting a
  paint loads that skin's web-ready textured glTF (real hull mesh + real
  textures, ~3 MB, lazy-loaded `<model-viewer>` — stays out of the initial
  bundle). Skins without a 3D model fall back to the official CIG store-icon.
  Loading / error / empty states, a catalog-retry affordance, and full keyboard
  a11y (listbox/option, focus ring, reduced-motion).
- **Data pipeline (`data-uploader` Python `sc_extract`).** `hull3d` turns a
  ship's CryEngine `.cga` + paint `.mtl` + textures into web glbs via
  cgf-converter v2.0.0 + gltf-transform; `ship_discovery` / `ship_export`
  generalise it to any ship; `upload_skins` ingests to Supabase. 100% from the
  P4K, no external data sources. Input ids are validated against path-traversal
  / shell-injection before they reach storage paths or the converter.
- **Schema.** New public `ship-skins` storage bucket + `ship_skins` table
  (viewer-read, service-role-write; idempotent migration).

## [0.10.2] - 2026-06-01

### Changed — Verse News: faster thumbnails, no more black tiles

- **Tile-sized images.** News thumbnails previously loaded the multi-MB RSI
  `/source/` image into small cards. A new `rsiVariant()` helper rewrites
  `media.robertsspaceindustries.com` source URLs to the aspect-preserving
  `post` (≤500w) / `cover` (≤1140w) CDN variants, served via responsive
  `srcset` + per-tile `sizes` — the featured card stays crisp at `cover`,
  regular cards drop to `post`. Signed `/i/` proxy URLs and any non-matching
  URL pass through untouched, so the change is safe across both RSI media hosts.
- **Hero loads first.** The above-the-fold first image now loads `eager` with
  `fetchpriority="high"`; remaining slideshow layers stay lazy.
- **No black tile while loading.** An animated skeleton shimmer fills the card
  until the active image decodes (respects `prefers-reduced-motion`), replacing
  the bare black background.
- **Preconnect** to `media.robertsspaceindustries.com` and
  `robertsspaceindustries.com` so the image handshake starts earlier.

## [0.10.1] - 2026-05-31

### Changed — UI polish & hardening pass (accessibility, i18n, loading states)

- **Accessibility**: a global `:focus-visible` ring (accent outline) now covers
  every interactive element for keyboard users, and a global
  `prefers-reduced-motion` reset neutralises all looping animations (skeleton
  shimmers, pulses, the news slideshow). Codex hardpoint rows and the
  data-uploader profile pill are now keyboard-operable (Enter/Space).
- **Localization**: hardcoded German `confirm`/`prompt` dialogs (admin user
  delete, p4k bundle disable/re-enable/delete), invite/delete toasts and several
  untranslated `aria-label`s now go through ngx-translate (de + en keys added).
- **Loading states**: admin, API-tokens, P4K history and desktop-download render
  a localized loading hint instead of a blank area on first load; the sign-out
  button is guarded against double-click during the async sign-out.

### Fixed

- Replaced the non-existent `var(--sc-fg)` token (data-uploader update banner)
  with `var(--sc-fg-1)`; mapped a hand-written accent glow shadow in API-tokens
  to the `--sc-glow` token.

## [0.10.0] - 2026-05-31

### Added — Verse News: multi-image thumbnails with auto-fade slideshow

- **`fetch-verse-news`** now emits every comm-link image as `images[]`
  (deduped, capped at 10); `thumbnail` stays = `images[0]` for backward
  compatibility. (Edge function deployed.)
- **New `<sc-news-thumb>` component** picks the card image by measuring each
  image's aspect ratio client-side:
  - a landscape first image → static hero (unchanged common case);
  - a portrait/square first image with more images available → an
    auto-advancing crossfade slideshow through the landscape images,
    looping (≈5 s dwell, position dots);
  - broken images drop out of rotation automatically;
  - respects `prefers-reduced-motion`.
- **Fixes blank/garbled thumbnails** for articles whose lead asset is a tall
  poster (e.g. *DefenseCon 2956 | Farewell*, whose `images[0]` is a
  3840×7389 schedule poster) — the usable landscape art further down the
  list is now surfaced instead.

## [0.9.2] - 2026-05-31

### Changed — Compact footer

- Footer height reduced from ~180px to 136px: badge 64→44px, vertical padding
  24→12px, disclaimer line-height 1.5→1.4. User feedback: footer was too tall.

## [0.9.1] - 2026-05-31

### Fixed — Bundle ingest "forbidden" for collaborators

- **`ingest-bundle`** now calls the `ingest_bundle_atomic` RPC via `userClient`
  instead of `adminClient`. The RPC is `security definer` and re-checks
  `is_collaborator()` as defense-in-depth, which reads `auth.uid()`. Service-role
  calls carry no JWT context, so `auth.uid()` was `NULL`, the role coalesced to
  `viewer`, and the RPC raised `forbidden` for legitimate collaborators. RLS is
  already bypassed by `security definer`, so `userClient` is the correct caller
  for the INSERT side. (Recovered from an abandoned worktree during repo-health.)

## [0.9.0] - 2026-05-31

### Added — Codex: full catalog, slot compatibility, previews, dimensions & localization

- **Full catalog (no caps)**: every extracted entity is now seeded — 920 ships,
  1326 weapons, 2145 components, 21033 items, 16437 hardpoints (previously
  capped at 400 per kind). Build `live-preview`.
- **Slot compatibility**: hardpoint rows in the detail view are expandable and
  resolve which buyable weapons/components/items fit (accepted `types[]` + size
  range matched against each item's `attach_type` + size), via the new
  `codex_compatible_items(build_id, types[], min, max)` RPC. Weapons now carry
  `attach_type` (AttachDef.Type) so they can be matched.
- **Preview images**: per-chassis ship silhouettes + FPS-weapon icons are
  converted DDS→WebP during extraction (Pillow) and uploaded — deduped, used
  files only — to the public `codex-previews` storage bucket. Shown as
  thumbnails in the list and a large preview in the detail view.
- **Ship dimensions**: real L/W/H (metres) parsed from the `.cga` mesh bounding
  box (913/920 ships), shown as an overlay on the preview.
- **Full localization**: the complete `global.ini` (≈112k strings, en+de) is
  stored in `codex_locale_strings`; ship role, component kind and weapon class
  are localized, and unresolved `@`-keys now fall back to the class name instead
  of being shown raw.

### Added — Data Uploader: extract-folder cleanup

- Extracted files are deleted after a successful upload, and leftover folders
  from previous failed runs are detected and cleaned on app start (with a
  path-safety guard confined to `.sc-companion-extracts`).

### Migrations / infra

- `20260530_codex_slots_locale` — `codex_weapons.attach_type`,
  `codex_locale_strings` table, `codex_compatible_items` RPC.
- `ingest-catalog` edge function: `locale_strings` + `preview` ops.
- New public storage bucket `codex-previews`.

## [0.8.0] - 2026-05-30

### Added — Invite-only access + site-wide footer

The app is now invite-only: only accounts an admin invited (or the bootstrap
admin) can get past the login page.

- **`profiles.is_approved`** column. `handle_new_user` sets it `true` only when
  the account was created via admin invite (`auth.users.invited_at` is stamped
  by `inviteUserByEmail`) or is the bootstrap admin. Self-registrations
  (open sign-up / first-time Google) land `false`. Existing roster backfilled
  to `true` (alpha — trusted set, no lock-outs).
- **`approvedGuard`** on the shell route: an un-approved session is signed out
  and bounced to `/login?denied=invite` with an explanatory notice.
- **Login** drops the self-signup toggle (sign-in + Google only), shows an
  invite-only hint and the denied notice. `AuthService.signUp` removed.
- **`invite-user`** edge function re-asserts `is_approved: true` on the invited
  profile (redeployed).
- **Site-wide footer** (`FooterComponent`) on both the login page and the
  authenticated shell: "Made by the Community" fan badge + the trademark
  disclaimer required for a Star Citizen fan site. New keys in all 7 locales.

> Full server-side hardening still requires disabling "Allow new users to sign
> up" in Supabase Auth settings (not toggleable via MCP).

## [0.7.1] - 2026-05-30

### Changed — Desktop tool renamed to "Star Citizen Companion - Data Uploader"

The downloadable desktop tool was named `sc-companion`, colliding with the main
app's name. It is now branded **Star Citizen Companion - Data Uploader** to make
its role (local P4K extraction & upload) unambiguous and distinct from the web app.

- **Source dir** `desktop-tool/` → `data-uploader/`; workflow
  `desktop-tool-build.yml` → `data-uploader-build.yml`.
- **Artefacts** `sc-companion-setup/-portable-*` → `data-uploader-setup/-portable-*`;
  electron-builder `productName`, `appId` (`com.sc-companion.data-uploader`),
  shortcut, window title, OAuth window titles, `unpackDirName` updated.
- **Release tag prefix** for the binaries project: `desktop-v*` →
  `data-uploader-v*` (workflow trigger, filename parsing, ship/test-plan docs).
- **User-facing web labels** in all 7 locales (`Desktop Tool` → `Data Uploader`):
  nav entry, download page, auth page, bundle-history references.
- **Web project reference** updated to its new name: auto-domain
  `star-citizen-companion-website.vercel.app` → `star-citizen-companion-web.vercel.app`
  and GitHub repo `Star-Citizen-Companion-Website` → `Star-Citizen-Companion-Web`
  in CSP, docs and release links. The primary alias `sc-companion.vercel.app`
  and the main app's name ("Star Citizen Companion") are unchanged.

> Unchanged (compiled into shipped binaries / backend infra): the `/desktop/auth`
> OAuth route, the `desktop_releases` table, and the `desktop-latest` edge function.

## [0.7.0] - 2026-05-30

### Added — P4K bundle delete + per-channel summary card

- **Delete bundles**: admins can now permanently delete a bundle, not just
  deactivate it. New admin-only `delete_p4k_bundle(uuid)` RPC
  (migration `20260530_p4k_bundle_delete`); a "Delete" action sits next to
  Deactivate / Re-enable with a confirm dialog. Deactivation remains the normal
  "hide from listings" flow — delete is for mistaken / garbage uploads.
- **Per-channel summary card**: the top card is split into general info
  (total bundles, channel count) and one row per channel. Each row points at
  that channel's patch-latest bundle — quality score and entities reference the
  highest patch version (semantic compare, **not** upload date), with the patch
  version shown in every row. Rows are ordered `live` first, then by patch
  version descending.

## [0.6.0] - 2026-05-30

### Added — Codex: browse every ship, weapon & component (viewer-accessible)

A new **Codex** tab (reachable by every signed-in user from role `viewer` up,
like News) lists all Star Citizen ships, weapons, components, items, ammunition
and manufacturers — searchable (fuzzy, over localized names **and** classNames),
filterable by manufacturer/size/grade/kind, with a detail view (properties,
hardpoints/item-ports, stock loadout), a side-by-side **compare tray**, stable
deep-links (`/codex/:kind/:className`) and a data-provenance badge. Fully DE/EN
localized.

The data is extracted from the **real game files** — not a third-party API:

- **Real P4K extraction**: a self-contained pure-Python **DataForge v8** reader
  (`desktop-tool/python/sc_extract/`) — scdatatools 1.0.4 cannot parse the live
  `Data/Game2.dcb` (v8, record stride grew 32→36 B) and cannot even open the
  SC 4.x `Data.p4k` (ZIP64 extra-field `ln=18`). Both are now handled. The
  extractor does an exhaustive per-type record dump ("alle Werte von allen
  Spielelementen", ~115k records) plus typed projections. Verified against the
  live 147 GB `LIVE/Data.p4k`: 920 ships, 1326 weapons, 2145 components, 21033
  items, 1124 manufacturers, 235 ammunition.
- **Catalog data layer**: new `codex_*` tables (migrations `00008`/`00009`) with
  **viewer-read RLS** (any authenticated user reads; writes service-role only),
  `pg_trgm` fuzzy search over names + classNames, the `ingest-catalog` edge
  function, and seed tooling. A current LIVE build is seeded in the cloud
  project (all ships/manufacturers/ammo + a representative subset of
  weapons/components/items; full re-seed documented).

> Note: the cloud catalog is currently a representative subset for the capped
> kinds (weapons/components/items: 400 each). Run the documented full seed for
> 100 % coverage. The desktop extractor changes ship in a future `desktop-v*`
> binary — this release delivers the web Codex tab + data layer.

## [desktop-0.4.9] - 2026-05-29

### Fixed — Upload "ingest_failed", slow portable startup, unclean window close

> Note: the `desktop-v0.4.8` tag never produced a binary — its
> `electron-builder.yml` carried a duplicated `unpackDirName` key, so the
> Windows `electron-builder` packaging step failed with a YAML parse error
> (typecheck/tests were green; only packaging parses the YAML).
> `desktop-v0.4.9` is the first actual delivery of these fixes.

- **Upload `ingest_failed`** (server-side, already live): `ingest_bundle_atomic`
  rejected the edge function's service-role call via its `is_collaborator()`
  defense-in-depth guard — under the service-role key `auth.uid()` is NULL, so
  the role resolved to `viewer` and the guard always raised `forbidden`
  (confirmed via Postgres logs). The guard now lets the service-role caller
  through while still blocking direct authenticated RPC calls.
  (migration `00007_fix_ingest_rpc_service_role`)
- **Slow portable startup**: the `portable` build re-extracted the whole bundle
  (incl. the embedded ~100-200 MB Python) into a random `%TEMP%` dir on every
  launch. A fixed `portable.unpackDirName` makes it extract once and reuse.
- **Window not closing cleanly**: pressing X could leave the process in Task
  Manager. In-flight extraction children are now killed on quit (Windows
  tree-kill via `taskkill /T`) and the loopback OAuth server force-closes
  keep-alive sockets.

### Changed — Friendly upload errors + faster Python spawn

Upload errors now show localized (DE/EN) user-facing messages with the technical
detail, instead of a raw server code. The Python sidecar spawns with `-E -s -B`.

## [0.5.2] - 2026-05-29

### Fixed — Verse News: comm-link cards link to the real article and show thumbnails

Every Verse-News comm-link card linked to the `/comm-link` index page instead of
the article, and no card had a thumbnail. The `fetch-verse-news` edge function
read fields the star-citizen.wiki API does not return: the permalink is `rsi_url`
(not `url`), there is no `slug`, so each URL fell back to the index; thumbnails
only arrive with `?include=images` and live under `images[].rsi_url` (there is no
top-level `image_url`). Summaries are now derived from `translations` (no
`summary` field exists). Verified end-to-end against a local Supabase stack.

- [supabase/functions/fetch-verse-news/index.ts](supabase/functions/fetch-verse-news/index.ts):
  use `rsi_url`, add `?include=images` + `firstImageUrl()`, `summarizeTranslations()`.
- [.claude/deep-knowledge/verse-news-sources.md](.claude/deep-knowledge/verse-news-sources.md):
  corrected field names + the `include=images` requirement.
- [.claude/deep-knowledge/local-dev.md](.claude/deep-knowledge/local-dev.md):
  reproducible recipe for testing auth-gated pages on a local stack.

## [desktop-0.4.7] - 2026-05-29

### Added — Extraction log: copy button + per-line color coding

The Run view's extraction log was a plain monochrome text blob with no way to
grab it for a bug report. Each line is now rendered as its own element, colored
by level — green for the success/"done" summary, yellow for warnings, red for
errors — and a **Copy** button hands the full transcript to the clipboard,
flashing green on success / red on failure.

Clipboard access is routed through the main process (Electron's `clipboard`
module via a new `sc:clipboard:write` IPC handler), because the sandboxed
`file://` renderer can't reach `navigator.clipboard` reliably.

- [desktop-tool/src/renderer/main.ts](desktop-tool/src/renderer/main.ts):
  colored `<div>` log lines, plain-text mirror buffer, `copyLog()` with
  green/red button feedback.
- [desktop-tool/src/main/index.ts](desktop-tool/src/main/index.ts) +
  [src/preload/index.ts](desktop-tool/src/preload/index.ts): `sc:clipboard:write`
  bridge over `clipboard.writeText`.
- New i18n keys `run.logTitle / copyLog / copied / copyFailed` in all 7 locales.

## [0.5.1] - 2026-05-29

### Fixed — Desktop-Tool sign-in: token hand-off now survives Chrome Local Network Access

The CSP fix in 0.4.3 unblocked the `connect-src` preflight, but the JWT hand-off
still failed: Chrome's Private/Local Network Access blocks a **background
`fetch()`** from the public HTTPS origin to the `127.0.0.1` loopback — the
preflight reaches the loopback, but Chrome then suppresses the actual POST, even
with `Access-Control-Allow-Private-Network: true`. Confirmed with a mock
loopback: `OPTIONS /cb` arrived, the POST never followed.

The fix swaps the background fetch for a **top-level form-POST navigation**,
which is exempt from PNA/LNA (this is how Google's own loopback OAuth works).
The token rides in the request body, so it still never lands in the URL or
browser history. Paired with **desktop-0.4.6** below.

- [src/app/desktop/desktop-auth.component.ts](src/app/desktop/desktop-auth.component.ts):
  submit a hidden `<form method="POST">` to the loopback instead of `fetch()`;
  the loopback renders its success page straight into the navigated tab.
- **`vercel.json` `form-action`** now lists `http://127.0.0.1:*` (otherwise the
  CSP blocks the form submit, just as `connect-src` blocked the fetch).

Requires Desktop-Tool **v0.4.6+** (older loopbacks only parse a JSON fetch body).

## [desktop-0.4.6] - 2026-05-29

### Fixed — Loopback accepts the top-level form-POST hand-off

- [desktop-tool/src/lib/oauth.ts](desktop-tool/src/lib/oauth.ts): the `POST /cb`
  handler now parses `application/x-www-form-urlencoded` (the top-level
  navigation from the web app) in addition to JSON, validates `state`, and
  renders the "you can close this window" page directly from the POST response.
  The obsolete `GET /cb?ack=1` round-trip is gone.
- **Why:** the previous fetch()+ack design (≤ 0.4.5) is blocked by Chrome's
  Local Network Access on modern Chrome — see web 0.5.1 above. Any browser now
  works once both sides are updated.

## [0.5.0] - 2026-05-29

### Added — Public REST API + Admin Token Management

Erste öffentliche API unter `/v1/...` mit Bearer-Token-Auth, Postgres sliding-window
Rate-Limiting (60 req/min default), und Resource-Level Scopes
(`news:read`, `patch:read`, `ships:read`, `components:read`, `*:read`, `admin:tokens`).

**Admin-UI** unter `/admin/api-tokens` (lazy + `roleGuard('admin')`):
- Token-CRUD mit `scc_live_<32 char>` Prefix + SHA-256-Hash, plaintext-Token
  einmalig nach Erstellung sichtbar
- Tabelle mit Name / Prefix / Scopes / last_used / Created / Revoke
- ngx-translate i18n für DE + EN

**Edge Function** `supabase/functions/api/` mit internem Router:
- `_router.ts` zero-dep chainable mit `:param`-Matching
- `_auth.ts` Bearer + sha256-Hash-Lookup + scope-check + last_used_at-touch
- `_rate-limit.ts` Postgres sliding-window (`api_request_log` table)
- `_cors.ts` Origin-Allowlist für POST/DELETE

**Endpoints** (alle mit `X-RateLimit-*` + `X-Cache` + `X-Patch-Version` Headern):
- `GET /v1/news` aus `news_cache` (90d-Fenster, optionaler `?source=` Filter)
- `GET /v1/patch` aus `patch_versions` (live/ptu/eptu)
- `GET /v1/ships?patch=`, `GET /v1/components?patch=` — STUBS (Data-Ingestion follow-up)
- `POST/GET/DELETE /v1/tokens` (session-JWT + admin)
- `GET /openapi.json` (public, OpenAPI 3.1 Spec mit Bearer-Scheme + Scope-Defs)
- `GET /docs` (public, Scalar-UI + Embed-Snippet zur Integration in andere Tools)

**Migrations** (`20260529_public_api_tokens.sql`):
- `api_tokens` (mit RLS "admins manage own tokens")
- `api_request_log` (sliding-window storage)
- `patch_versions`, `news_cache`
- `public.is_admin(uuid)` Overload

**Known limits / Follow-ups** (siehe Concept-Page Open-Questions F1–F6):
- Ship + Component Daten-Ingestion noch nicht implementiert (Stubs)
- `news_cache` braucht `pg_cron` Refresh-Job
- `patch_versions` braucht Comm-Link Polling
- Migration nur als File — `npm run db:push` nach Review nötig

## [0.4.3] - 2026-05-29

### Fixed — Desktop-Tool sign-in: the *real* "Failed to fetch" cause was our own CSP

The 0.4.2 / desktop-0.4.5 work misdiagnosed the blocker as Chrome's
Private-Network-Access and an outdated tool binary. It was neither — verified
live: Supabase project healthy, redirect allowlist correct, the Google-OAuth
leg works, and a mock loopback **with** the PNA header was *still* blocked.

The actual blocker is the web app's own Content-Security-Policy. `connect-src`
never listed the `127.0.0.1` loopback, so the browser refused the JWT POST from
`/desktop/auth` before it left the page:

> Refused to connect to 'http://127.0.0.1:46800/cb' because it violates the
> document's Content Security Policy.

- **`vercel.json` `connect-src` now includes `http://127.0.0.1:*`** — matches
  `isLoopback`, which only accepts 127.0.0.1 in port range 46800–46899.
- **Error message corrected** in [src/app/desktop/desktop-auth.component.ts](src/app/desktop/desktop-auth.component.ts):
  the misleading "update to v0.4.5+ (Chrome PNA)" advice is replaced with an
  accurate "loopback unreachable — CSP or tool closed" hint. Any
  Desktop-Tool version works once the deployed CSP allows the loopback.

Takes effect after the Vercel deploy serves the new header.

## [0.4.2] - 2026-05-28

### Fixed — Desktop-Tool sign-in no longer dies at "Failed to fetch" / "not valid"

Coordinated fix paired with **desktop-0.4.5** below. The web-side changes:

- **Google-OAuth redirect URL is now query-string-free.** Supabase's URL
  allowlist matches the full redirect URL — entries without explicit `?**`
  wildcards rejected `/desktop/auth?cb=…&state=…` as "Invalid redirect URL"
  on the Google callback. [src/app/auth/login.component.ts](src/app/auth/login.component.ts)
  now stashes any query string in `sessionStorage` and passes a path-only
  `redirectTo`; [src/app/desktop/desktop-auth.component.ts](src/app/desktop/desktop-auth.component.ts)
  reads cb/state back from the stash on landing.
- **Diagnostic error message** now points users at the version requirement:
  a "Failed to fetch" renders "Bitte das Desktop-Tool auf v0.4.5+
  aktualisieren — ältere Versionen werden von Chrome's Private-Network-
  Access blockiert".
- **`supabase/config.toml` now lists `?**` wildcard variants** for
  `/desktop/auth` as belt-and-suspenders. Production dashboard
  (Auth → URL Configuration) needs the same allowlist entries added by hand.

## [desktop-0.4.5] - 2026-05-28

### Fixed — Loopback unreachable on Chrome (Private Network Access)

- **Loopback now ships `Access-Control-Allow-Private-Network: true`.**
  Chrome blocks cross-origin fetches from a public (HTTPS) origin to a
  private network (127.0.0.1) unless the preflight response carries that
  header. [desktop-tool/src/lib/oauth.ts](desktop-tool/src/lib/oauth.ts)
  now sends it. Without this header the upload flow died at "Loopback
  unreachable — ist das Desktop-Tool noch offen?" right after a successful
  sign-in.
- **End-user note:** older Desktop-Tool versions (≤ 0.4.4) still bake the
  pre-PNA loopback into the binary. Affected users must update to v0.4.5+
  via the in-app auto-updater (or re-download from the website) — the
  web-side `0.4.2` fix alone cannot rescue them.

## [desktop-0.4.4] - 2026-05-27

### Changed — desktop upload UX (one-click auth + upload)

- **Single "Upload starten" button** replaces the previous two-step
  flow (separate "Im Browser anmelden" → "Bundle hochladen"). Clicking
  starts the browser OAuth flow and, on success, uploads the bundle
  automatically — no second click needed.
- **Loopback server lifetime cut to seconds.** The previous flow left
  the loopback OAuth server idle between the two clicks, so users who
  paused (or hit the 5-min server timeout) saw "Loopback unreachable —
  Failed to fetch" when the web fetch eventually fired. With one
  combined action, the server is only up while the browser tab is
  actively transferring the token.
- **i18n** — new status keys (`upload.start`, `upload.signingIn`,
  `upload.signedIn`, `upload.signInFailed`, `upload.uploading`,
  `upload.uploadOk`, `upload.uploadFailed`) across all 7 locales (de,
  en, es, fr, pt, ru, zh); old `upload.auth` / `upload.send` removed.

## [0.4.1] - 2026-05-24

### Fixed — portable download button on /desktop

- **Root cause:** [desktop-download.component.ts](src/app/desktop/desktop-download.component.ts) typed
  `PlatformAsset.sha256` as a required string and rendered
  `entry.value.sha256.slice(0, 12)` inline. The commit that moved
  electron-updater verification to SHA-512 (`fix(release): real SHA-512`,
  [#10](https://github.com/Jerry0022/Star-Citizen-Companion-Website/pull/10))
  also switched the release-build workflow to write only `sha512` into
  `desktop_releases.platforms[*]`, leaving `sha256 = null` on every row
  registered from v0.4.0 onward. `null.slice()` then threw inside
  Angular's `@for` for each platform asset — visible symptom on
  `/desktop`: portable button missing / hash chip broken.
- **Fix:** treat both `sha512` and `sha256` as optional, add a
  null-safe `hashFingerprint()` helper preferring sha512, and render
  the hash chip conditionally.

## [desktop-0.4.3] - 2026-05-24

### Fixed — desktop auto-updater (401 unauthorized loop)

- **Root cause:** electron-updater 6.8.3 silently drops the `requestHeaders`
  field when passed inside `setFeedURL({...})` — it only honors them when
  loaded from `app-update.yml` via the internal `updateConfigPath` setter
  (AppUpdater.js L218-224). The Tool was therefore sending no
  `X-SC-Release-Token` header, so the `desktop-latest` Edge Function fell
  through to its JWT auth branch and returned HTTP 401 on every check.
- **Fix:** assign `autoUpdater.requestHeaders` directly before
  `setFeedURL()`. Inline comment now warns the next reader.
- **Impact:** v0.4.2-and-earlier users cannot auto-update *to* this fix
  (the bug is in the updater itself) — manual install of the v0.4.3
  installer is required. All later releases will auto-update normally.

## [0.4.0] - 2026-05-24

### Added — Verse-Live-Hub redesign

- **Compact status chip in news header** — replaces the misleading "Plattform-Status".
  Click expands a service drill-down (live components from the RSI Statuspage).
  Localised labels: "Spielbar / Eingeschränkt / Teilausfall / Offline / Wartung".
- **Time-bucketed news stream** — items grouped into Heute / Diese Woche / Älter
  inside a shared "stream" container that visually connects sticky channel-filter
  chips with the buckets. "Älter" collapsible.
- **Featured-card treatment** for the newest item in Today (2× height, 21:9 cover,
  Orbitron headline).
- **Silent auto-refresh + "X neue Posts ↑" pill** every 5 min, visibility-aware
  (pauses when tab hidden). Refresh button removed.
- **Channel filter chips** (Comm-Link / Spectrum / YouTube / Patch-Notes) —
  multi-select, localStorage-persisted, with per-channel counts.
- **Polish** — skeleton loading, hover-glow + scale, inline channel SVG icons,
  relative time ("vor 3 Std"), per-card source footer with host attribution.

### Changed — Edge function `fetch-verse-news`

- Real status via Statuspage HTML scrape (fixes hardcoded `'operational'` bug).
- YouTube videos via channel RSS feed (`RSI_YOUTUBE_CHANNEL_ID` env override).
- Spectrum threads via `__INITIAL_STATE__` scrape (best-effort, graceful empty).
- Patch-Notes classified as its own channel (series === "Patch Notes").
- All URLs normalised to canonical `robertsspaceindustries.com` host (E1/E2).

### Removed

- `news.refresh` and `news.platformStatus` i18n keys (replaced by silent
  refresh + named status chip).

### Subpackage sync

- `desktop-tool/package.json` 0.3.6 → 0.4.0 to keep root + subpackage aligned
  per the project rule. No desktop-side functional changes in this release.

## [0.3.3] - 2026-05-24

### Fixed

- **desktop-tool subpackage version bump**: `desktop-tool/package.json` was
  left at `0.1.3-dev` through the v0.3.0 ship because
  `mcp__plugin_devops_dotclaude-ship__ship_version_bump` only updates the
  root-level `package.json`. Result: the v0.3.0/v0.3.1/v0.3.2-tagged
  Windows binaries (those that built at all) would have reported
  `0.1.3-dev` internally via `__SC_TOOL_VERSION__`, even though the
  GitHub tag said otherwise. Bumped to 0.3.3 here so the next
  `desktop-v0.3.3` build produces a binary that matches its tag.
- **`.claude/skills/devops-ship/SKILL.md`**: added a fourth project rule
  ("monorepo subpackage version bumps") requiring the operator to bump
  ALL `package.json` files whose versions are baked into shipped
  artefacts, not just the source-file the plugin tool detected.

## [0.3.0] - 2026-05-24

### Added — Phase 2 Domain Logic

- **Python sidecar (`desktop-tool/python/sc_extract/`)** — scdatatools wrapper
  scaffold + Pure-Counter validator (5 entity thresholds: ships 180/150/100,
  weapons 250/200/150, components 600/500/350, items 1500/1200/800,
  strings 50000/40000/25000) + minimal per-entity heuristic. JSON-line
  streaming protocol so the Electron main process can show real-time
  progress. Real scdatatools API wiring is TODO-scaffolded; the stub
  fallback emits the same event sequence so the IPC contract is
  end-to-end testable without a real Data.p4k.
- **Embedded Python bootstrap** — `scripts/fetch-embedded-python.js`
  downloads python-build-standalone (cpython 3.13.0, x86_64-windows-msvc),
  pip-installs the sidecar requirements, copies `sc_extract/` next to the
  interpreter. electron-builder bundles the whole `resources/python/` tree
  into the packaged app.
- **`sc:extract` IPC** — `src/main/python-bridge.ts` spawns the embedded
  Python with the configured arg vector and line-parses JSON events into
  per-job webContents.send broadcasts. Preload exposes
  `window.sc.extract.{env, start, cancel, onEvent}`. Renderer Run view
  uses it directly (Phase-1 fake-tick loop retired).
- **electron-updater** — `src/main/updater.ts` configures the "generic"
  provider against `$API_BASE/functions/v1/desktop-latest`, auth via
  `X-SC-Release-Token` header. autoDownload + autoInstallOnAppQuit;
  renderer banner paints checking / available / progress / downloaded /
  error from the live event stream.
- **`ingest-bundle` Edge Function uploader integration** — `uploader.ts`
  now POSTs `buildNumber`, reads `manifest.json` from disk (so large
  manifests don't round-trip through IPC), surfaces the server-computed
  `diff_summary` (vs. the previous bundle of the same channel/patch
  family) in the renderer as a per-entity prev/new/delta table.
- **Bundle-history UI** (web) — `p4k-history.component` adds Build
  column, mini-diff (+N / −M) summary, expandable per-bundle drill-down
  showing the full diff table per entity. Admin disable/re-enable with
  reason prompt; history-toggle + disabled-toggle (admin-only).
- **Supabase migration 00005** — `build_number` + `disabled` +
  `disabled_reason` + `disabled_by` + `disabled_at` + `diff_summary`
  columns on `p4k_bundles`, `set_bundle_disabled` RPC,
  `diff_bundle(prev_id, new_id)` SQL function, rewrite of
  `list_p4k_bundles_for_collaborator` with default-latest + history-mode.
- **3 new Edge Functions** — `check-bundle` (existence + uploader email
  pre-upload check), `ingest-bundle` (JWT + release-token gate, atomic
  insert + diff), `desktop-latest` (electron-updater YAML metadata,
  release-token OR JWT auth).
- **CI synthetic P4K fixture** — `scripts/build-synthetic-fixture.py`
  generates a 4 KB MIT-clean fixture (5 fake ships + 10 fake items).
  New `python-sidecar-test` job on ubuntu-latest regenerates + pytests.
  `build-windows` depends on both `typecheck-and-test` and the new
  python job — a broken validator now blocks the binary publish.

### Fixed — Pre-ship security hardening (Codex review)

- **desktop-latest revoked-token bypass** (HIGH) — release-token lookup
  now also requires `is_current = true`, restoring rotation semantics.
- **GH-Action token leak in release notes** (HIGH) — full UUID is masked
  from logs via `::add-mask::` and uploaded as a separate `release-token`
  workflow artefact (retention 7d, collaborator-only via `gh run download`).
  Release notes show the 8-char fingerprint, not the secret.
- **history RPC admin-only flag bypass** (MED-HIGH, migration 00006) —
  `list_p4k_bundles_for_collaborator(include_disabled)` now AND-s with
  `public.is_admin()`. Non-admin collaborators see only non-disabled
  rows regardless of the flag they pass.
- **UNIQUE constraint too loose** (MED, migration 00006) — drops the
  per-uploader uniqueness, tightens to `(channel, patch, build)`.
  First upload wins; second attempt gets HTTP 409. Admin disable
  required to replace.
- **diff baseline race on concurrent uploads** (MED, migration 00006) —
  new SQL function `ingest_bundle_atomic()` does prev_id lookup +
  INSERT + diff under a single advisory lock keyed by
  `hash(channel || patch_version)`. ingest-bundle Edge Function calls
  the RPC instead of the previous three-step JS flow.
- **OAuth JWT in URL → browser-history leak** (MED) — loopback `/cb`
  refactored: GET is ack-only (no token), POST receives JSON
  `{state, token, email}` body. Web component fetches the POST
  cross-origin (loopback echoes `Access-Control-Allow-Origin =
  apiBase origin`), then navigates the browser to the clean ack URL
  only after the POST succeeds. JWT never lands in browser history.
- **diff_summary shape mismatch** (Codex residual) — desktop uploader
  + renderer aligned to the server's
  `{count_diffs, summary: {entities_added, entities_removed}}` shape.

### Fixed — concept HTML generation

- **Issues-erstellen button silently broken** — concept HTML for
  `2026-05-23-p4k-phase-2-domain-logic.html` was generated without the
  `submitCreateIssues` function and the click handler. Fixed by patching
  the rendered HTML with a self-contained handler that builds a
  copy-paste `/devops-new-issue` prompt inline (the concept-bridge
  server is no longer running after autonomous completion). Persisted
  as a project-level skill extension at
  `.claude/skills/devops-concept/SKILL.md` + reported upstream as
  [Jerry0022/dotclaude#165](https://github.com/Jerry0022/dotclaude/issues/165).

## [0.2.0] - 2026-05-23

### Added — Phase 1 Polish

- **Window-Icon**: ICO mit 7 Größen (16/24/32/48/64/128/256) aus `verse-compass.svg`
  via `@resvg/resvg-js` + `png-to-ico`. Generator: `desktop-tool/scripts/build-icon.js`,
  Pre-Hook via `npm run package:win`. Damit verschwindet das Default-Electron-Atom in
  Taskbar/Explorer.
- **NSIS + Portable getrennt**: per-target `artifactName` in `electron-builder.yml` →
  `sc-companion-setup-<v>-x64.exe` (Installer) und `sc-companion-portable-<v>-x64.exe`
  (Standalone) statt beide auf denselben Filename zu kollidieren.
- **Single-Instance-Lock**: zweiter Klick auf die `.exe` fokussiert das bestehende
  Fenster statt eine zweite App zu starten.
- **i18n bundled**: Locale-JSONs werden zur Build-Zeit ins Renderer-Bundle ge-`import`et
  statt zur Laufzeit per `fetch('./i18n/…')` geladen. Behebt Blank-UI-Bug in
  packaged Builds (CSP + `file://` blockierten die Fetches).
- **Echte SC-Schiffsnamen** im Extractor-Stub-Log: 32 Ships + 12 Items (AEGS_Avenger_Titan,
  DRAK_Cutlass_Black, MISC_Freelancer, …) statt nur Counter.
- **Locales FR/ES/PT/RU/ZH** ausgefüllt (vorher nur `_meta`-Stubs mit en-Fallback).
  Web + Desktop-Tool. Sprach-Switcher in Shell-Topbar jetzt 7-Sprachen-Dropdown
  statt DE/EN-Toggle.
- **OAuth-Callback** funktioniert: neue Angular-Route `/desktop/auth` empfängt
  `?cb=…&state=…`, gibt nach Auth den Supabase-Access-Token an den Loopback-Server
  der Electron-App. `login.component` ehrt jetzt `?redirect=…` (vorher
  hardcoded `/news` nach Login → Loopback ging in Timeout).
- **Admin-Last-Admin-Schutz**: UI + DB-Constraint verhindern Demote/Delete des
  letzten Admins. Gilt für `set_user_role` (Rolle ändern) und `delete-user`
  (Account löschen / Self-Leave).
- **User-Invite** via Supabase magic-link (Edge-Function `invite-user`, service_role
  → `auth.admin.inviteUserByEmail` + Profile-Role-Upsert).
- **User-Delete + Self-Leave** via Edge-Function `delete-user` (cascade auf
  profiles/uploads/bundles via FK).
- **Cloud-Migrationen applied**: `00003` (Rollen + Tabellen + RPCs + RLS) und
  `00004` (Bundle-History-RPC) sind auf Supabase-Projekt
  `hcnqhvzlavdycidqyaai` deployed. Jeremy ist seeded admin.
- **Drei Edge-Functions deployed**: `verify-release-token`, `invite-user`, `delete-user`.
- **Vier Dev-Releases** in GitHub veröffentlicht: `desktop-v0.1.0-dev` bis
  `desktop-v0.1.3-dev`. Aktiv: 0.1.3-dev.

### Added — P4K Companion Desktop Tool · Phase 1 (Foundation)

- **Monorepo** `desktop-tool/` — Electron 33 + Vite + TypeScript, builds Windows
  x64 NSIS + portable. Root `package.json` exposes `tool:dev` / `tool:build` /
  `tool:test` / `tool:typecheck` / `tool:package` aliases.
- **Discovery cascade** — Stage 1 RSI-Launcher config, Stage 2 filesystem scan
  of common install roots, Stage 3 user folder pick. Vitest specs cover the
  cascade with synthetic fixtures.
- **Performance profiles** — 4 (Minimal · Standard-default · Maximum · Smart/Auto-Phase-2)
  with per-GB ETA estimates.
- **Loopback-OAuth** + **release-token header** — concept § B2 security model:
  ephemeral 127.0.0.1:46800-46899 callback server, `X-SC-Release-Token` injected
  at build time via Vite `define`.
- **Renderer shell** — 4-view state machine (Discover → Configure → Run →
  Auth+Upload) with SC theme tokens, live phase/file progress UI, log stream
  pane, counters. Run-phase is currently a fake-tick demo; real extractor in
  Phase 2.
- **i18n** — DE + EN (full) plus FR / ES / PT / RU / ZH stubs (English
  fallback). Loader reads `/i18n/<lang>.json`, persists locale to localStorage.
- **CI** — `.github/workflows/desktop-tool-build.yml`: typecheck + test on PR,
  full Windows build + publish to GitHub Release on `desktop-v*` tag push.
  Generates a fresh release token per build.

### Added — Web side: Roles, Admin, Desktop-Download

- **Migration** `00003_roles_releases_bundles.sql` — adds `role` (admin /
  collaborator / viewer) to `profiles`, `is_admin()` + `is_collaborator()`
  helpers (security definer), admin RPCs `list_users_for_admin` and
  `set_user_role` (last-admin demote-guard). New tables `desktop_releases`
  (with `release_token`) and `p4k_bundles` (digested JSON, replacing raw
  uploads for the future flow). Existing `p4k_uploads` and `p4k-uploads`
  storage bucket policies tightened to collaborator+. `jeremy.treder@gmail.com`
  is seeded as the standard admin (idempotent — handles existing profile
  rows + augments `handle_new_user` for future signups).
- **`RoleService`** signals + **`roleGuard(...allowed)`** factory.
- **`AdminComponent`** — user-list with role pills, promote/demote actions,
  guarded behind `roleGuard('admin')`.
- **`DesktopDownloadComponent`** — fetches the current `desktop_releases` row,
  shows platform asset list with size + SHA-256, guarded behind
  `roleGuard('admin', 'collaborator')`.
- **Shell nav** — admin + desktop links rendered conditionally on role.
- **Profile** — adds role badge to the user info card.
- **i18n** — DE + EN keys added for admin / desktop / role labels.

### Added — Branding

- **Verse-Compass** logo set: `verse-compass.svg` (master 256), `…-favicon.svg`
  (32), `…-mono.svg` (currentColor toolbar), `…-wordmark.svg` (logo + SC
  COMPANION wordmark).
- `index.html` favicon links updated, `manifest.webmanifest` icons array
  refreshed.
- Shell brand swapped from the "SC" placeholder to the favicon SVG with
  drop-shadow glow.

### Added — Edge Functions

- **`verify-release-token`** — Supabase edge function that checks
  `X-SC-Release-Token` against `desktop_releases.release_token`. Returns
  403 with `unknown_token` or `revoked` on mismatch. To be called by the
  `ingest-bundle` function (Phase 2).

### Deferred to Phase 2 (open questions)

- Real P4K extractor (yauzl-stream vs. native sidecar — see `lib/extractor.ts`)
- Render-PNG generation architecture (server-side worker vs. local headless three.js)
- Schema-Score validator with real per-entity JSON schemas
- Server-side diff against last-known-good extract
- Auto-update flow (`electron-updater` + Force-Update header)
- Synthetic P4K fixture for end-to-end extractor tests
- Code-signing (self-signed vs. EV-cert decision)
- Telemetry opt-in, conflict handling on duplicate uploads, license choice

## [0.1.0] - 2026-05-17

### Added

- Initial Angular 21 PWA scaffold (standalone components, signals, OnPush, lazy routes).
- Supabase backend (`hcnqhvzlavdycidqyaai`, `eu-central-1`):
  - `profiles` table with auto-creation trigger on `auth.users` insert.
  - `p4k_uploads` table with channel/version enums and per-user RLS.
  - Storage bucket `p4k-uploads` with auth-scoped policies.
  - Edge functions: `fetch-verse-news` (Comm-Link + RSI status proxy), `process-p4k` (header heuristic + ZIP entry estimate).
- Auth flow: email/password + Google OAuth (PKCE), `authGuard` + `publicOnlyGuard`.
- Verse News feature: live Comm-Link feed via Star-Citizen-Wiki API proxy + RSI status RSS.
- P4K Analyzer feature: drag-drop upload, regex-based channel detection (live/ptu/eptu/tech-preview), upload history.
- i18n via ngx-translate v17 (en + de).
- Service Worker + manifest.
- Strict CSP, security headers, SPA rewrites in `vercel.json`.
- Claude-Code-fit: `CLAUDE.md` (root + `.claude/`), `deep-knowledge/` for Supabase, Verse-News, P4K-Format, `.mcp.json` with Supabase MCP.

### Notes

- Alpha phase: schema rewrites may drop legacy tables except `auth.users` and `profiles`.
- Vercel auto-deploys `main` once the project is connected.
- P4K parsing currently heuristic (first 64 KB scan). Phase 2 will add central-directory parsing and Manifest.xml extraction.

[0.1.0]: https://github.com/Jerry0022/Star-Citizen-Companion-Website/releases/tag/v0.1.0
