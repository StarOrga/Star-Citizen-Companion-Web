# Changelog

All notable changes to SC Companion are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
