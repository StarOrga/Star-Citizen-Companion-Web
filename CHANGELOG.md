# Changelog

All notable changes to SC Companion are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
