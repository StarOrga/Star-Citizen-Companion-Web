# Changelog

All notable changes to SC Companion are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.60.0] - 2026-08-05

### Added

- **The patch-performance panel gained a six-month/all-time toggle and a release
  forecast.** The rotating cadence charts (PTU → Live, main-line cadence,
  sub-patch cadence) now default to the last six months and switch to all-time
  from a control that stays visible on every slide. The window is strict — it
  drives both the bars and the median with no minimum-sample fallback — so a rare
  measurement like the major-line cadence can thin out inside six months and
  return on all-time rather than quietly averaging in year-old releases.

  A fourth slide reads the median cadences forward: the next PTU, the next LIVE
  patch, the next sub-patch, and — only while a build is actually in the PTU — the
  next PTU sub-patch. Each is an estimate ("the last such event plus the median
  gap"), never a promise, and a date the median has already passed is shown as
  overdue rather than hidden. The next-LIVE estimate is anchored on the lowest
  test build above the shipped LIVE frontier, so a historical version whose LIVE
  note never parsed cannot date the forecast off a stale build. The forecast
  honours the same window toggle as the charts.

## [0.59.0] - 2026-08-05

### Added

- **The feedback sign-off view gained the same scope filter as the processing
  mode.** The Abnahme view now carries the Meine / Andere / Alle author-scope
  switch — the finished topics you raised are the ones you can judge "done"
  without guessing — and it opens on "Meine", mirroring the processing mode's
  default. It keeps its own remembered choice (`sc.adminFeedback.reviewScope`),
  deliberately apart from the processing mode's, so switching the scope in one
  view never moves it in the other. The view's tab badge now counts the active
  scope, and an empty scope points at the sign-offs waiting in another scope
  instead of showing the all-clear.

## [0.58.0] - 2026-08-03

### Added

- **Admins and collaborators can preview the app as a weaker role.** The account
  menu gained a "View as" group: an admin can look at the app as a collaborator,
  as a viewer, or as a signed-out visitor; a collaborator can do the same minus
  the collaborator entry. Viewers and anonymous visitors get no such control —
  there is nothing below them to preview.

  The whole thing is a downgrade-only presentation overlay, and the security
  rests on that being literally true rather than merely intended. One allow-list
  (`impersonationTargets`) answers "what may this role preview", and the storage
  validator is implemented in terms of that same list rather than a rank
  comparison, so `'admin'` is not a reachable target from any starting point. The
  ceiling — the real role — always comes from the live profile lookup and is
  never persisted, so hand-editing the stored value can only ever lower what you
  see. Nothing about this reaches the server: no new column, no RPC, no minted
  token. The Supabase JWT is untouched and row-level security keeps enforcing the
  real role, which is what makes the client-side overlay safe to have at all.

  Because every consumer reads `role()` / `isAdmin()` / `user()`, switching those
  projections to the effective view was enough to make roughly thirty call sites
  correct at once — there is no list of places someone could forget to update.

  The signed-out preview goes one step further and swaps in a genuinely
  session-less Supabase client, so the app really is anonymous and RLS returns
  exactly what a visitor would get. The viewer and collaborator previews cannot
  do that — the JWT is still yours, so data is unchanged and only the interface
  and routing follow the previewed role. The banner says so per mode rather than
  letting the preview be trusted for something it cannot show.

  A preview survives a reload but not a new tab, entering or leaving one reloads
  the page (so nothing fetched with the real privileges leaks into the previewed
  view), and the banner that says which role you are wearing is mounted globally
  — including on the login page, which is where the signed-out preview sends you.
  Sending feedback is refused while previewing: the panel is part of what the
  preview shows, but a submission would file real feedback under your own account.

### Fixed

- **Three headings on Verse News rendered below the readable minimum on tablets.**
  The sub-patch cadence work set raw `rem` sizes instead of the readable-font
  floor the rest of the app uses, so a Galaxy Tab S9 measured 10.5–11.7px.

## [0.57.0] - 2026-08-03

### Changed

- **"Maximum Throughput" in the data uploader was a no-op — it now actually
  parallelises the extraction.** Picking it changed nothing measurable: the
  profile resolved to the same CPU affinity as Standard and differed only in
  process priority class. Windows does not propagate a raised priority to child
  processes (measured on Win11: only `Idle` and `BelowNormal` are inherited,
  `AboveNormal` and `High` leave children at `Normal`), so the one knob meant to
  give the run more resources could not reach a single process doing work. The
  extraction was fully serial on top of that, so a saturated run showed 1/N of
  the machine in Task Manager and looked idle at ~0.6 % CPU.

  The levels now differ where it counts — worker processes. The exhaustive
  record dump (the full ~115k-record corpus) runs in a process pool: Minimal
  stays on the single serial path, Standard uses half the cores, Maximum uses
  every core but one. The remaining core is deliberate — saturating all of them
  starves the app's own UI, including the cancel button that stops a run that is
  too aggressive.

  Workers cannot be handed the parsed DataCore (it holds a `memoryview`, and the
  archive handle sits on ~157 GB), so the parent publishes the raw blob in a
  shared-memory segment and each worker re-parses it locally. Event output is
  funnelled through the parent as the single stdout writer: two processes on one
  pipe tear each other's JSON lines apart, and a torn completion line would have
  turned a successful multi-hour extraction into a reported failure. If the pool
  cannot run at all, the serial dump takes over rather than shipping an empty
  result as a success.

- **The performance profiles no longer advertise settings that were never
  applied.** `diskThrottleMbps` was read by nothing while the Minimal profile
  promised "throttled disk reads"; it is gone. The memory budget is documented
  and wired as what it can actually be — an advisory clamp on the worker count,
  not a ceiling, since Windows CPython cannot enforce one without Job Objects.
  The "Smart (Auto)" profile is no longer offered: its only real effect was
  `BelowNormal`, so choosing the smart-sounding option made the run slower than
  Standard with nothing in the UI admitting it.

### Fixed

- **On a machine with 64 or more logical processors, the uploader could never
  restore full CPU affinity after a throttled run.** The mask was emitted
  unsigned, and `[IntPtr]18446744073709551615` cannot be converted at all —
  PowerShell rejects it as out of range for an `Int64`. The error was swallowed
  by the affinity try/catch, so a 32C/64T machine stayed pinned to core 0 for
  the rest of the job while the UI reported the mode switch as applied. The mask
  is now emitted in two's-complement form, which is the same bits and parses.
  The previous unit test asserted the exact value PowerShell rejects.

- **Switching the performance mode mid-run only reached the coordinating
  process.** The sidecar is rarely the one burning CPU — the record dump runs in
  workers, and the ship-skin pipeline shells out to `cgf-converter` and
  `gltf-transform`. Throttling down to play a game left those at full speed. The
  switch now walks the whole process tree (bounded and cycle-guarded).

## [0.56.4] - 2026-07-31

### Fixed

- **`/codex/keybinds` showed 1000 of the build's 1103 keybindings, with nothing
  to indicate the other 103 were missing.** `listKeybinds()` issued a plain
  select, and PostgREST answers with at most 1000 rows — reporting the real
  total only in the `content-range` header. A capped response is indistinguishable
  from a complete one: no error, no warning, just a list that quietly ends early.
  Measured against build `b77f1586` (patch 4.9.0), a `count=exact` probe reports
  1103 rows where the page rendered 1000.

  The query is now paged in 1000-row batches until a page comes back short, the
  same way the blueprint-category facet scan in the same file already works.

  The page's document order is unchanged: rows still come back ordered by the
  extractor's global `sort` counter, which is what lets the view group
  consecutive rows into their actionmap sections. Because that column carries no
  unique constraint in the schema, `action_name` is now applied as a secondary
  sort — paging over a non-total order is what lets rows repeat or vanish across
  a page boundary. Verified against the live build: `sort` unique and monotonic,
  every actionmap group contiguous.

## [0.56.3] - 2026-07-31

### Fixed

- **Every keybinding on `/codex/keybinds` was labelled with a raw `@`-key,
  because the query that resolves those labels returned HTTP 400 on every single
  load.** The lookup filters with PostgREST's `key=in.(…)`, which rides in the
  URL — and the keybindings page asks for ~1250 keys at once, a 35 919-character
  request line. The Supabase edge rejects it with a bare `400 Bad Request` and no
  PostgREST error body, so nothing distinguished it from an empty result;
  measured against the live project, 819 keys (25 264 chars) still return 200 and
  820 (25 303) do not. It fired twice per load, once per language, and surfaced
  as three `network-error` warnings per device in the mobile gate.

  The key list is now split into batches of at most 7000 encoded characters —
  below the 8000-char mark postgrest-js itself flags as "may exceed server
  limits" — and the batches are issued concurrently, so on HTTP/2 the page still
  pays roughly one round-trip. A batch is additionally capped at 500 keys so a
  reply can never hit PostgREST's 1000-row cap and come back silently truncated.
  Six batches per language cover the keybindings page; every other caller
  (ship roles, hardpoint labels) still fits in a single request.

  A failing batch now leaves only its own keys unresolved instead of discarding
  the entire translation map — localization stays a nice-to-have that never
  blocks the view.

  `npm run gate:mobile`: `/codex/keybinds` drops from 3 network warnings per
  device to 0, 44 page audits, 0 blocking findings.

## [0.56.2] - 2026-07-30

### Fixed

- **The app was designed for a mouse at desk distance, and phones inherited it
  unchanged.** The mobile/tablet gate had been red since #307 with 704 blocking
  findings across all 4 devices × 11 public routes — not a login-page defect but
  a system-wide one: a 15 px root with a label scale bottoming out at 0.58 rem
  (8.7 px), and controls built to mouse precision (form fields 41 px, buttons
  38 px, footer and trust links 16 px, icon buttons down to 14 × 16 px).

  Both floors are now expressed once, as tokens, and applied only where they are
  actually required — `@media (pointer: coarse)`, which matches every touch
  device and never a mouse:

  - `--sc-fs-floor` — consumed as `font-size: max(<design size>, var(--sc-fs-floor))`
    by all 389 sub-12 px declarations. On touch the smallest rendered text on
    any route is exactly 12 px; on a fine pointer the token is `0px`, so the
    design size wins and the desktop composition is unchanged (verified: the
    footer badge label still computes to 8.7 px there).
  - `--sc-tap-min` — a 48 px minimum hit area on every interactive primitive.
    48 rather than the bare 44 px minimum because the app animates both the
    route change and each card reveal from `scale(0.994)`; while those overlap a
    control sized at exactly 44 px measures 43.5 px mid-flight, below its own
    minimum. Native checkboxes and radios cannot carry a hit area larger than
    their own box, so they are redrawn as a 22 px control centred in the target.

  No threshold was relaxed and no waiver was added — `scripts/mobile-gate.config.json`
  is untouched. `npm run gate:mobile`: 44 page audits, 0 blocking findings.

## [0.56.1] - 2026-07-29

### Changed

- **Ship hulls will be compressed with meshopt instead of Draco, so the 3D view
  stops depending on a Google CDN.** Both formats keep the mesh compressed on
  disk and both need a decoder in the browser — the difference is where that
  decoder comes from. model-viewer hardcodes Draco's to `www.gstatic.com` and
  resets any override while loading, so a Draco hull simply cannot be decoded
  without reaching Google; anyone behind a corporate proxy, AV filter or privacy
  blocker sees no 3D at all. Its meshopt decoder is bundled and only needs to be
  pointed at a same-origin copy, which is now shipped in `public/meshopt/`.

  Measured on the Cutlass hull through the real export pipeline: 1.97 MB → 3.09 MB
  (1.56×) for a model that renders dimensionally identically (18.88 × 9.82 ×
  23.78 m, delta under 1 mm). The per-model size budget is deliberately unchanged
  — textures are ~70 % of a glb, so the end-to-end effect is far smaller than
  1.56×, and the existing quality ladder already handles an over-budget model.

  The viewer reads **both** formats as of this release, which is what makes the
  switch safe: the Draco hulls currently in the bucket keep working, and
  `www.gstatic.com` stays in the CSP until they have all been re-exported.

### Added

- The 3D guard now also fails the build when the self-hosted meshopt decoder is
  missing — that would otherwise surface only at runtime, on one route, with a
  green build and green tests.

## [0.56.0] - 2026-07-29

### Added

- **Unsent feedback input is kept on your account — everywhere, including
  screenshots.** Somebody wrote a long topic about the Verse News overhaul, never
  pressed send, closed the tab, and it was gone. The only safety net had been a
  single `localStorage` key for the new-topic box: text only, no attachments, no
  reply boxes, and gated behind the opt-in *preferences* consent — so anyone who
  declined had no draft at all, and no draft ever survived switching device.

  Drafts now live in `public.feedback_drafts`, one row per (account, composer).
  Every composer in the feedback surface has its own scope, so the three boxes a
  single thread can show never overwrite each other. Attachments upload into the
  existing `feedback-images` bucket the moment they are attached, so the row
  holds a URL instead of megabytes of base64 — and sending a restored draft
  reuses that object instead of storing it twice.

  A draft is removed by exactly two events: a successful send, or the user
  pressing discard (two-step, so one stray click cannot destroy minutes of
  writing). Not by a reload, not by closing the panel, not by a failed write — a
  failed write keeps the value, says so in the composer, and retries. `pagehide`
  flushes with `fetch(keepalive)`, the one path that still completes while the
  tab is being torn down, which is exactly the case that lost the original
  report. Pre-existing `localStorage` drafts are imported once, then removed.

- **A review gate: shipping no longer ends a topic — signing it off does.**
  `shipped` / `issue_created` used to drop a topic straight into the archive, so
  nobody ever looked at the result on the live app. Those outcomes now stay on
  the active board in an *Abnahme* bucket with two ways out: sign it off (→
  Erledigt) or resume the conversation, which returns the topic to the routine's
  queue. Backed by `admin_feedback.reviewed_at`, deliberately not a new status
  value — the autonomous routine's contract is status-only and unchanged. Topics
  that ended before the gate existed are backfilled as reviewed.

### Changed

- **The lifecycle map now has the shape of the machine it describes.** Rückfragen
  and the terminal states were listed under the diagram as an "Abzweigungen &
  Endstationen" footer, which is not what they are. A Rückfrage is now drawn
  inside the stage it detours from and loops back into, and the path ends in a
  visible fork: either geshipped or handed to an issue — after the sign-off.

- **One word per bucket across the whole admin panel.** The charts drop from a
  bar-per-bucket to the four that carry information, in the order a topic walks
  them: ToDo · Offen (in Arbeit, Rückfragen, Abnahme) · Geshipped · Issue
  erstellt — all labelled from the same source the filter chips use, so they
  cannot drift apart. The archive tab is now "Erledigt", and the totals line —
  the quick analytical read — is shown in the docked FAB panel too instead of
  being dropped there.

### Known debt

- The mobile/tablet gate from #307 is red on `main` (704 findings, all on
  `/login` and the shared topbar: 41–38 px form controls, 16 px trust links,
  sub-12 px labels). Verified identical on `origin/main` and on this branch, so
  this release neither causes nor worsens it. Needs its own pass.
  *Resolved in 0.56.2 — the cause was app-wide, not login-specific.*

## [0.55.4] - 2026-07-29

### Fixed

- **A stale Starscape install was invisible and sticky — the tray never said
  which build was running, and a manually downloaded newer build never took
  over.** Ships wallpaper-app **0.4.2**. Three gaps, one story: (1) several
  tray states (sign-in required, checking, downloading, failed) showed no
  version at all, so a signed-out alpha install could not tell a fresh build
  from a months-old one — every label now names the running version. (2) A
  clamped update-feed response (signed out on a locked ring) still names the
  lower ring's version; when even that beats the running build the tray now
  flags "outdated" — proof that needs no sign-in, display-only, never
  installed from. (3) The autostart `Run` value kept the path it was first
  written with, so a manually downloaded newer exe — the documented way out
  of the 0.4.0 sign-in deadlock — lost the singleton race to the old build on
  every boot, forever. Startup now re-points an enabled `Run` entry at the exe
  that actually holds the mutex. 45 wallpaper-app tests green (3 new).

## [0.55.3] - 2026-07-29

### Fixed

- **Starscape's weekly Verse-News wallpaper was blank ("No Verse News this
  week") while the feed itself was perfectly healthy.** The Comm-Link Wiki
  API's `images` include also lists a post's embedded clips
  (`source.mp4`/`source.webm`), and the image cache collapsed every asset of a
  media id onto one cache key — so it picked the .mp4 as its download sample
  and re-fetched ~390 MB of undecodable video on every single request, without
  ever recording a failure. That pushed `fetch-verse-news` from ~2 s to
  15–22 s, past the budget `starscape-summary` allows it, and the summary's
  empty-card fallback rendered as a legitimate 200. Video urls are now filtered
  out of the image path (deny-list with tests), guarded again at the cache
  boundary, and the cache refuses video/audio content-types, >12 MB payloads
  and >16 MP sources up front; cache warm-up is capped at 6 s per request.
  Measured: 2.6 s per call, wallpaper renders real news again.
- **The summary then hit the edge worker's memory limit (HTTP 546) the moment
  it had real images to draw.** Five full-resolution sources inlined as base64
  and decoded in the resvg heap at once was over budget at any render width
  above ~1280 px. The renderer now requests the smallest stored variant each
  role actually paints (w400 for the ~120 px strip thumbnails, w800 for the
  full-bleed hero) and caps accepted bytes per role — an oversized source is
  skipped in favor of the next candidate instead of taking the render down.
  Verified at 1920×1080, 2560×1440 and 3840×2160 against production.
- **The `news-images` bucket sat at 856 MB of its 1 GB quota** because the
  #295 compaction backfill had shipped but never been executed. Ran it:
  244 sources rewritten to the variant ladder, 0 failures, bucket now
  ~58 MB. The feed serves ladder urls exclusively (no legacy `cover.*` left).

## [0.55.2] - 2026-07-28

### Fixed

- **The 3D ship view was dead in production — for every visitor, since the CSP
  landed.** Not just the new hardpoint markers: the always-on 3D view and the
  Showroom too. Everyone got "3D-Modell konnte nicht geladen werden". The
  Content-Security-Policy from #200 denied four things `<model-viewer>` needs to
  render a Draco-compressed hull: `blob:` in `img-src` (three.js decodes glb
  textures into blob URLs), in `connect-src` (it fetches them back) and in
  `worker-src` (the Draco decoder runs in a blob worker), plus
  `'wasm-unsafe-eval'` in `script-src` for the decoder's WebAssembly module —
  deliberately not `'unsafe-eval'`, which would also permit `eval()`. The
  decoder itself is fetched from Google's CDN, so `https://www.gstatic.com` is
  allowed in `connect-src` as well.

  Nothing caught this because nothing could: the build was green, the tests were
  green, and the app degraded politely instead of failing. Reproduced by serving
  the production build locally under the exact deployed policy, then confirmed
  fixed the same way — model loads, all 96 markers visible, clickable and
  placed.

### Added

- **A build-time guard so the 3D view cannot be switched off unnoticed again.**
  `npm run check:csp-3d` (wired into `prebuild`) fails the build if the policy
  in `vercel.json` loses any source the renderer depends on, and says which one
  and why.

## [0.55.1] - 2026-07-28

### Fixed

- **The hardpoint markers on the 3D ship were invisible and unclickable.**
  `data-visibility-attribute` belongs on each hotspot, not on `<model-viewer>`,
  so model-viewer never marked any marker as visible — and the stylesheet used
  that missing flag to fade markers to 25% *and* strip their pointer events.
  Every one of the 96 markers shipped in 0.55.0 was therefore dead on arrival.
  The attribute now sits where model-viewer reads it, and the occlusion rule
  only dims: a marker behind the hull recedes but stays clickable, so a wiring
  slip can never again turn the whole feature off. Found by driving the real
  rendered model in a browser — a DOM-only check cannot see this, because the
  markup was correct and only the rendered result was wrong.

## [0.55.0] - 2026-07-28

### Added

- **Hovering a component now shows where it sits on the 3D ship.** The loadout
  list, the orthographic hull map and the 3D model are three views of one
  selection: point at a component row and its marker lights up on the model,
  point at a marker and its row lights up. The marker positions are read out of
  the ship's own `.glb` — CryEngine's `hardpoint_*` / `helper_*` locator nodes
  survive the export pipeline and are named exactly like the codex port names,
  so nothing has to be re-extracted and no coordinate convention has to be
  guessed. 96 of the Cutlass Black's 100 ports resolve to a marker; the rest are
  abstract ports with no physical presence on the hull. Ships whose model
  carries no locators are unchanged.

## [0.54.0] - 2026-07-27

### Changed

- **Both desktop apps now present themselves through one download panel.**
  Starscape and the Data Uploader had grown separate download blocks — a tinted
  CTA card in the Starscape header vs. a full-width release table on the Data
  Upload page — so the two never read as parts of the same product family. Both
  (and the viewer-facing `/download` page) now render the same minimal
  `sc-app-download-panel`: icon, name, version and the download button(s) are all
  that stays visible, while size and hash move into each button's tooltip and the
  platform caveats, ring-lock warning and release notes move behind a single ⓘ
  toggle.
- **The Data Uploader gave up its top-level nav entry.** A permanent menu slot
  for a tool only collaborators and admins can open was too much room. Its
  everyday entrance is now a single collapsed line on the Codex Bridge — the
  Codex is what the uploader feeds — which expands into the shared download panel
  for exactly those roles, and renders nothing at all for everyone else. The
  bundle history opens from there as a popup instead of stretching the page, and
  `/uploader` remains reachable as the full-size surface behind it.

### Added

- **A Starscape download pitch that shows the product instead of describing it.**
  Three seconds after landing on Starscape, a small poster slides in whose mock
  desktop crossfades through real gallery wallpapers — which is precisely what
  the tray app does. It appears at most once per browser session and only on a
  desktop-sized viewport (a Windows tray app cannot be installed from a phone);
  the ✕ opts out permanently, while any other dismissal simply lets it return on
  the next visit. The Data Uploader deliberately gets no such pitch.

## [0.53.0] - 2026-07-27

### Added

- **Codex Showroom — 3D ship liveries are now a first-class destination.** A new
  public gallery at `/codex/showroom` surfaces the interactive 3D liveries
  datamined from the current game build: a spotlight for the newest covered ship
  plus a grid of every ship that has liveries, each linking into its existing
  ship detail (where the 3D viewer already lives). The Codex Bridge gains a
  self-hiding billboard and a nav link into the Showroom, and a "Holo-Ready"
  badge now marks ships that have interactive 3D liveries on their cards.
  Everything is derived at read time from a new `ship_skins_index` view — the
  livery and ship counts are dynamic and track whatever the data-uploader has
  ingested for the current build, so the Showroom stays version-accurate patch
  over patch with no manual seeding. Discovery-only surface: no multi-MB `.glb`
  and no 3D library load on the Showroom route itself. (P1 of the Showroom
  rethink; viewer elevation, photo/share mode, and uploader-side quality follow
  in later phases.)

_Note: the deep-knowledge `supabase.md` schema doc does not yet enumerate the
`ship_skins` / `ship-skins` / `ship_skins_index` layer (pre-existing gap);
tracked for a docs pass._

## [0.52.0] - 2026-07-27

### Added

- **Replying to an archived feedback topic reopens it.** Answering in the thread
  of an archived topic now brings it back onto the active board as ToDo, so the
  autonomous routine picks it up again — the natural "let's keep going here"
  gesture that already worked for shipped topics now works for the whole Archive.
  `issue_created`, `declined` and legacy `rejected` are flipped straight back to
  `open` by a database trigger the moment an admin replies (clearing the issue
  link and the decline reason); `shipped` keeps its existing post-ship
  continuation. A hint above the composer on archived topics says as much before
  you type.

## [0.51.0] - 2026-07-27

### Added

- **Every feedback topic now has a number you can refer to.** The admin board
  shows a quiet `#42` ahead of each topic title — in the Übersicht rows (compact
  panel and full page) and on the Abarbeiten card — so a topic can be named in a
  conversation instead of quoted or identified by its uuid. The number is a
  database column fed by a sequence, **not** a position in the list: it is
  assigned once at creation and never moves, however the board is filtered,
  searched, re-sorted or pruned. Existing topics were numbered by age, so `#1` is
  the oldest entry on the board. The board search takes it too — typing `42` or
  `#42` jumps to that topic, matched exactly (`#4` is not `#42`) and ranked above
  topics that merely mention the digits. Admin-only: the number is not shown to
  the author of a user-submitted topic. Feedback 21587480.

## [0.50.0] - 2026-07-27

### Added

- **Codex — hardpoint positions on the hull (#137 part 3).** A ship's loadout
  list can now be *located*: pointing at a hardpoint row highlights a marker in
  a top-down and a side schematic of the hull, and pointing at a marker
  highlights its row. Collapsed rows ("3× S3") light up all three of their
  mounts. The coordinates come from the ship's own `.cga` mesh in `Data.p4k` —
  the desktop uploader now reads the mesh's helper-node transforms and joins
  them to the item ports and default-loadout mounts by exact node name, so a
  marker is either the real mount point or absent. Additive migration
  (`codex_item_ports.helper_name/position/rotation`) plus a ship-level map in
  the payload; ingest accepts both the new and the old shape.
  _Ships already in the catalog show no positions until the admin re-runs the
  uploader — the previous category-grouped list is exactly what they keep.
  The deck / interior view (#137 part 4) is not part of this._

## [0.49.2] - 2026-07-27

### Changed

- **Feedback board — the docked panel now shows the threads, not the chrome.** In
  the small (docked) FAB panel the control rows and the new-topic composer used to
  stack ahead of the list and squeeze it down to barely one visible thread. The
  compact panel is reorganised so the thread list owns the space: the new-topic
  composer collapses to a slim **＋ Neues Thema** bar that opens the full composer
  on demand (and folds back once the topic is sent); search and the status/author
  chips fold behind a **⌕ / ⚲ Filter** cluster on a single filter row next to the
  Aktiv/Archiv tabs, with a marker when a hidden filter is active; and the
  motivating "shipped" totals line is dropped in compact (the numbers live in the
  Fortschritt tab). The processing mode ("Abarbeiten") gets a matching tighter
  vertical rhythm. The full-page board is unchanged. Feedback 3133f9.

## [0.49.1] - 2026-07-27

### Changed

- **Codex "Where to buy" — matches far more items now (#254).** Purchase lookup
  now matches against the item's English name (UEX is English-only, so German
  display names like "A03-Snipergewehr" previously never matched "A03 Sniper
  Rifle"), tolerates livery/paint variants via token-subset matching, and
  searches both the "Personal Weapons" and "Gadgets" UEX categories for FPS
  gear. Verified against the live API — e.g. A03 Sniper Rifle, P4-AR, S-38
  Pistol and multi-tools now resolve dozens of purchase locations that used to
  show "no data".

## [0.49.0] - 2026-07-26

### Added

- **"Enter sendet" is now a per-user setting** (Einstellungen → Eingabe). Which
  key sends a message is a matter of taste, so each user picks their own mapping
  instead of living with a fixed one. On (the default) keeps the chat convention:
  Enter sends, Shift+Enter breaks the line. Off mirrors it: Enter breaks the
  line and only **Ctrl/Cmd+Enter** (or the send button) sends. Ctrl/Cmd+Enter
  sends in both mappings, whichever key inserts the newline also continues a
  bullet/numbered list, and the hint under the field names the mapping that is
  actually active. The choice applies to every composer — new topic, thread
  reply, the answer box in the processing mode and the user feedback panel — and
  is remembered per browser (`sc.composer.sendOnEnter`, essential category like
  the language choice, so a deliberately chosen mapping is never silently lost).

## [0.48.2] - 2026-07-26

### Added

- **Codex — "Where to buy" panel (#254 / #255, part of #187).** Item and weapon
  detail pages now show where to purchase the item and at what price, sourced
  from the UEX Corp API via a new server-side proxy (`uex-proxy` edge function;
  the UEX token stays a server secret, never in the client). Buy options list
  price (aUEC), terminal, and physical location, sorted cheapest first, with a
  community-data caveat + attribution. Items whose UEX name differs from ours
  (skin/livery variants) fall back to a graceful "no purchase data" state.
  _Matching is by name within a UEX category; base-name/token-subset matching is
  a planned follow-up to also cover variants._

## [0.48.1] - 2026-07-26

### Fixed

- **Enter sends again in the feedback chat.** The formatting-toolbar release had
  moved sending to Ctrl/Cmd+Enter and given plain Enter to list continuation, so
  pressing Enter simply swallowed the message. Enter is the send key again in
  every composer (new topic, thread reply, processing answer); **Shift+Enter**
  inserts the newline and continues a bullet/numbered list; **Ctrl/Cmd+Enter**
  keeps sending as well. Empty drafts are still never sent, and Enter mid-IME
  composition commits the candidate instead of sending. Feedback aa8d5b18.

## [0.48.0] - 2026-07-26

### Added

- **Feedback for everyone — viewers and collaborators get their own feedback
  panel.** Non-admins deliberately never see the admin board, which also meant
  they had no way to send feedback at all. They now have their own FAB: write
  feedback (markdown + screenshots, same composer as the admin board) and follow
  what became of it under "Mein Feedback". Each submission lands as a normal
  topic on the admins' board, attributed to its author, so the existing workflow
  handles it unchanged. The author sees a deliberately coarse state — *In
  Bearbeitung*, *Rückfrage an dich*, *Umgesetzt*, *Nicht umgesetzt* — and never
  anything from the internal admin conversation, which stays admin-only in the
  database. An admin can reply to the author directly (optionally as a question,
  which parks the topic until they answer) and, instead of plainly deleting a
  topic, can decline it with a mandatory explanation the author gets to read.

## [0.47.7] - 2026-07-26

### Changed

- **Admin feedback — the processing mode only holds what waits on you.** The
  "Abarbeiten" queue used to list untouched ToDo topics after the Rückfragen,
  which read as a backlog to work off. But a ToDo is a topic *you* wrote that now
  waits on the routine — there is nothing to answer there. The queue is now the
  open Rückfragen alone, oldest first; a topic enters it the moment the routine
  asks something back and leaves it when you answer. ToDos stay fully visible in
  the Übersicht list and in the dashboard's ToDo counter. The view-switch badge
  and the scope counts follow the narrowed queue, so they promise what the mode
  shows. Feedback b0cc6efc.

## [0.47.6] - 2026-07-26

### Fixed

- **Crafting data was empty for every blueprint (part of #187).** A
  `CraftingBlueprintRecord` nests everything under a `blueprint` node, but the
  extractor only ever read the record's top level — so category, crafted item and
  ingredient list came back empty for **all 1595** blueprints in the live build.
  Reading the nested node resolves **1588 crafted items and 1594 ingredient
  lists** (916 of them FPS armour, 210 FPS weapons), including per-material
  quantities, recipe slot names and craft times.

### Added

- **Codex — "crafting materials" on item detail.** Items now show what it costs
  to manufacture them (materials, quantities, minimum quality, craft time). The
  existing panel only showed the inverse — what an item can be used to build.

### Notes

- **"Where can I buy it" is not datamineable.** Audited against the live archive:
  item records carry no price, and the shop-inventory files that do carry prices
  use a pre-4.0 id space where **none of the 6317 ids** resolve against current
  game data. The codex omits purchase locations rather than showing something
  wrong; see `docs/concepts/codex-extraction-output.md` §0b.
- The new crafting panel fills in once a catalog is re-extracted and ingested with
  the updated uploader.

## [0.47.5] - 2026-07-26

### Added

- **Codex — FPS armor stat block (#253, part of #187).** Personal-armor items
  (`Char_Armor_*` slots) now carry a stat block: the extractor routes them
  through the same generic component-stat dump ship components use, so
  `SCItemSuitArmorParams` / `SCItemClothingParams` values (resistances,
  temperature ratings, capacity) surface on the item detail. Renders when
  present, graceful empty otherwise. *Note:* the values light up in the live app
  only after a new uploader-binary release carrying this extractor and a fresh
  P4K re-extract + upload — the current build predates the change.

## [0.47.4] - 2026-07-26

### Added

- **Admin feedback — the Fortschritt view now maps the lifecycle and shows the
  routine's pace.** A live **Lebenszyklus** map draws the status machine from
  `docs/feedback-routine.md`: every stage a topic can be in (ToDo → In Arbeit →
  Geshipped, plus the Rückfrage branch and the terminal issue/legacy stages) and
  every branch it can take — the routine's question and the answer back, the
  reaper reopening a stale claim, the review hold, the post-ship continuation
  loop — each annotated with how many topics sit there right now. Next to it:
  a **Durchsatz** sparkline (ships per week over the last 12 weeks) and, per
  window, the **median time-to-ship** and the **Rückfrage rate**. Everything is
  always-on and read-only — the view deliberately has no filters or toggles.

## [0.47.3] - 2026-07-26

### Added

- **Admin feedback — post-ship continuations surface on the active board.** The
  20-min routine now posts a review reply after every ship and reopens a shipped
  topic when the admin replies to it (review & continue loop). The panel now
  recognises that reply immediately: a shipped topic whose newest thread message
  is the admin's — posted after the ship — reads as **ToDo** on the Active tab
  (with a small "Fortgesetzt/Continued" pill), instead of sitting unnoticed in
  the Archive until the routine picks it up. Purely derived from `shipped_at` +
  message timestamps; no schema change.

## [0.47.2] - 2026-07-26

### Added

- **Codex — dedicated FPS equipment section (#251, part of #187).** A new
  `codex/fps` section curates on-foot gear analogous to the ship/blueprint
  codex: FPS weapons (with sub-type, manufacturer, size and grade facets) and
  personal armor (filtered by equip slot — Helmet / Torso / Arms / Legs /
  Undersuit / Backpack). Each item links to the existing detail view, which
  already renders the weapon stat block and crafting usage. Armor has no rich
  stat block in the current extract yet (tracked as #253); those cards degrade
  gracefully to name / grade / size / slot / manufacturer.

### Fixed

- **Codex — untranslated item names no longer leak Star Citizen's raw
  placeholder.** Entities whose localized name ships as the game's
  "! … TRANSLATION NOT FOUND FOR LOCID … !" marker now fall back to the English
  name (or a humanized class name) across the whole codex, instead of printing
  the marker.

## [0.47.1] - 2026-07-26

### Changed

- **Codex ship detail — always-on 3D view at hero level (#252, part of #137).**
  The interactive 3D livery/skin viewer now renders directly beneath the hero
  instead of near the bottom of the page below the spec sheet, so the ship's 3D
  model stays on-screen (closer to the RSI site's layout). It keeps its
  deliberate lazy-load: expanded by default on desktop (the ~3 MB glb loads
  immediately), collapsed by default on mobile (opened on demand to spare
  cellular data). Ship comparison stays on the existing floating compare tray —
  no duplicate comparison surface was added.

## [0.47.0] - 2026-07-26

### Fixed

- **Data Uploader — no more hourly sign-out during multi-hour uploads.** A full
  extract can take up to ~8h to upload, but the catalog and skin upload stages
  captured one access token at stage start and reused it for the entire run.
  Past the ~1h Supabase JWT lifetime every remaining request returned 401, so a
  long upload "logged itself out every hour". The upload stages now resolve a
  **fresh token per request** (wired to the session refresh that rotates the
  token silently near expiry), so a run stays authorised from start to finish
  regardless of the token TTL.
- **Data Uploader — tray icon was invisible/transparent in the installed app.**
  The tray (and window) icon file was never bundled into the package, so
  `nativeImage` fell back to an empty image — a blank tray slot. On top of that
  the near-black brand icon vanished against the dark Windows taskbar. Ships a
  dedicated bright, transparent-background tray icon, bundled as an app resource
  and loaded from the packaged resources path.

### Added

- **Data Uploader — sign in on every launch.** Opening the app now requires a
  fresh login instead of silently reusing the stored session, giving each run a
  token that lasts the whole upload. The unattended auto-start path keeps using
  the saved session so scheduled auto-runs are unaffected.
- **Data Uploader — "back" now warns before discarding progress.** Pressing back
  during a running extraction or an in-flight/resumable upload opens an
  SCC-styled confirmation overlay; only on confirm is the extraction aborted or
  the upload paused (it stays resumable), so a stray click can't throw away
  hours of work.

## [0.46.6] - 2026-07-24

### Fixed

- **Codex ship detail — redundant, over-tall ship render under Standard Loadout
  (481fc015).** The read-only hardpoint layout drew the ship art a second time
  in a center column between the slot clusters. That figure was
  `align-self: stretch`, so on ships with many hardpoints its frame grew to the
  full height of the tallest cluster column — a very tall, mostly empty panel
  showing exactly the image the detail hero already shows top-left. No hardpoint
  markers were positioned on it (clusters dock in their own grid columns,
  grouped by functional category, because the extract carries no positional port
  data), so the render was purely decorative. Removed it and collapsed the
  layout to two cluster columns.

## [0.46.5] - 2026-07-24

### Fixed

- **Data Upload — correct release shown on first open (e892e715).** Opening the
  Data Upload page for the first time showed the picked channel (alpha for
  admins) but not its version, until you toggled channels and back. The parent
  started at `stable` and fired a load before the channel-picker re-defaulted to
  the role's top ring, so two channel loads raced and a late `stable` response
  clobbered the freshly-loaded `alpha` release. Added a latest-wins guard that
  drops a channel load whose response arrives after a newer channel was picked.

## [0.46.4] - 2026-07-24

### Fixed

- **Feedback panel — visible per-card boxing in the FAB panel (cfa46ac2).** In
  the embedded feedback panel each topic card shared the exact same
  `bg-2 → bg-1` gradient as the panel behind it, so the individual feedbacks
  blended together and the separation was hard to read. Embedded cards now sit
  on the more prominent `--sc-bg-3` surface with a clearer border + subtle
  shadow, so every feedback reads as its own boxed area again. Full-page board
  unchanged.

## [0.46.3] - 2026-07-24

### Fixed

- **PWA — silent update on a fresh open, reload prompt only while active
  (4f9fcff8).** A newer build that is already ready when the site opens is now
  activated and loaded silently, so a returning visitor simply gets the newest
  version with no reload button. A build that lands later — while you are already
  on the page — still raises the deliberate reload prompt so you don't lose your
  view. A once-per-session guard caps silent reloads at one, so a persistent
  "ready" state can never loop the page.

## [0.46.2] - 2026-07-24

### Changed

- **Feedback panel — filter bar decluttered (Phase 1 of 605d317d).** Status and
  author quick-filters now share one compact row; the horizontal jump-TOC strip
  and the per-chip counts are gone. A single motivating totals line replaces
  them — open Rückfragen + shipped so far for the current filtering, with "In
  Arbeit" deliberately omitted. Phases 2 (Abarbeitungsmodus view toggle) and 3
  (progress dashboard + confetti) follow.

## [0.46.1] - 2026-07-24

### Changed

- **Data Upload / download page: release notes are always inline.** The release
  notes no longer sit behind an aufklappbar `<details>` toggle — they render
  inline by default and quieter (subtle label + muted body, no boxed `<pre>`).
  Applied to both `/uploader` and the minimal `/download` surface. (2ebe600e)

## [0.46.0] - 2026-07-24

### Added

- **Verse News: recent-videos rail with hover-dwell "watched" tracking.** A
  dedicated "Recent Videos" row surfaces the ~5 newest YouTube clips at the top
  of Verse News. Resting the pointer on a clip for ~1.5 s — or opening it — marks
  it "watched"; watched clips drop out of the rail on the next load so it stays
  fresh with newer content, while the current view stays stable (a watched
  snapshot keeps cards from reshuffling under the cursor). Watched state persists
  per user in localStorage under the existing preference consent (#130). Videos
  are removed from the default "Alle" stream to avoid showing each clip twice;
  selecting the YouTube channel still lists them all. (news, #146)

## [0.45.0] - 2026-07-24

### Added

- **Starscape desktop builds are now tracked in `desktop_releases`.** The
  wallpaper-app (Starscape) registers alongside the data-uploader via a new
  `product` discriminator, and the Starscape gallery page shows the current build
  version + a hash-verified download resolved through the public
  `starscape_latest_release()` RPC — falling back to the never-stale
  `wallpaper-app-latest` alias so the button always works. The CI prints the
  register SQL on a tagged release for a reproducible flow. Ships wallpaper-app
  0.3.2 (the low-resolution-source skip, #199). (starscape)

## [0.44.3] - 2026-07-24

### Changed

- **Feedback panel: guided one-at-a-time answer flow.** In the embedded feedback
  panel the overview now opens only the first still-unanswered Rückfrage instead
  of expanding every open question at once. Answering a question folds it away
  (animated height/opacity collapse), lets it bubble to the top, and opens the
  next unanswered question, scrolling it into view — so working through the
  admin's open questions reads as a guided flow rather than a wall of open
  threads. The full-screen board is unchanged (every card stays open there).
  (admin-feedback)

## [0.44.2] - 2026-07-24

### Changed

- **Feedback panel: topics collapse to dated one-liners.** In the embedded
  feedback panel each topic now reads as a single clickable row — chevron ·
  generated title · author · status — instead of a two-line head plus preview.
  Active topics are grouped under non-interactive day headings (Today /
  Yesterday / date), and the per-row timestamp is dropped in the panel since the
  heading already carries the date; the full-screen board keeps its author and
  timestamp. The title is derived from the topic body so it is always available.
  (admin-feedback)

## [0.44.1] - 2026-07-24

### Removed

- **Data Upload / p4k history: redundant bundle summary strip.** The aggregate
  overview above the patch-version list (total bundles, channel count, and the
  latest-bundle-per-channel chips) duplicated information already shown per patch
  version below it, so it was removed — the screen now leads straight into the
  per-patch entries. The section header and the admin "show disabled" toggle are
  unchanged. (p4k)

## [0.44.0] - 2026-07-24

### Added

- **Codex: Upcoming Ships.** A new public view under the Codex lists ships
  announced on the public RSI ship-matrix that aren't in our datamined game data
  yet — the difference between what RSI lists and what the live build holds. A
  periodic edge function (`rsi-upcoming-ships`) scrapes the matrix and diffs it
  against the uploader-ingested ships (`codex_ships`), splitting the result into
  "In concept" and "Flight-ready on RSI" blocks; cards deep-link to RSI. (codex)

## [0.43.0] - 2026-07-23

### Added

- **Feedback board: status filter + quick-access TOC.** The admin feedback board
  gained a status quick-filter (Rückfragen / open / in progress, with live
  counts) alongside the existing author filter, and a horizontal quick-access
  table of contents that jumps straight to a topic — leading with and
  highlighting the Rückfragen still awaiting the admin's answer. In the embedded
  panel an "expand/collapse all" toggle closes every topic to just its heading so
  the board stays scannable. (admin-feedback)

### Fixed

- **Feedback chat: screenshot attachments work again.** Pasting, dropping, or
  picking an image failed with "Bild konnte nicht verarbeitet werden" because the
  hardened Content-Security-Policy (`img-src` without `blob:`) blocked the `blob:`
  object URL the composer used to decode images. The composer now decodes via
  `createImageBitmap`, which needs no URL and is CSP-independent. (admin-feedback)

## [0.42.0] - 2026-07-23

### Changed

- **Desktop-release promotion moved inline into the Data Upload page.** Admins
  now roll a version forward through the alpha → beta → stable rings from a
  compact, admin-only row right under the current release — where builds are
  already downloaded with a channel picker — instead of a separate
  `admin/desktop-releases` page. The old admin route and its nav link are
  removed; collaborators and viewers never see the control. The underlying
  `promote_desktop_channel` RPC (admin + monotonicity enforced server-side) is
  unchanged.

## [0.41.11] - 2026-07-23

### Fixed

- **Verse News: promo/ad "comm-links" no longer open a broken RSI page.** The
  star-citizen.wiki API occasionally surfaces storefront ad promos as comm-links
  (e.g. "Fly with D-Box" → `/promotions/<code>`, which 404s), and entries with no
  permalink fell back to the bare `/comm-link` index — both gave a card whose
  "open on RSI" link dead-ended on a 404 or a redirecting RSI error screen. The
  feed now keeps only real article permalinks (`/comm-link/<category>/<id>-<slug>`),
  so every news link opens an actual article. Ship-promo transmissions that RSI
  redirects client-side (e.g. "Grey's Market Basher") return 200 and are kept —
  they are indistinguishable from a normal article server-side. (news)

## [0.41.10] - 2026-07-23

### Fixed

- **Weekly Verse-News summary wallpaper no longer fails at 1440p/4K.** The
  transparent-thumbnail fix in 0.41.7 measured PNG alpha by fully decoding each
  image, which pushed the `starscape-summary` edge function over its memory
  limit (HTTP 546) for every request ≥1920×1080 — so the desktop app's boot
  summary always fell back to a gallery image. Image selection now reads only the
  file header (dimensions + alpha flag, no pixel decode) and the render width is
  capped at 1920 px (the wallpaper is scaled to the screen anyway). Verified live
  at 1080p, 1440p, 4K and ultrawide.
## [0.41.9] - 2026-07-23

### Security

- **P4K extractor hardened against zip-slip / path traversal.** The hull-geometry
  writer trusted archive-entry names and `.mtl` texture references verbatim, so a
  crafted or corrupt `Data.p4k` could write outside the work directory. Every
  write is now containment-checked against its base dir. The Windows dev-only
  `npx` fallback additionally refuses shell metacharacters, and the Python
  dependency set is fully version-pinned (AES/crypto libraries included).

### Fixed

- **Accessibility (WCAG 2.1 AA).** Muted/secondary text now meets the 4.5:1
  contrast minimum on every screen (was ~3.45:1). The admin user table's sortable
  columns are keyboard-operable and announce their sort state to assistive tech.
  Placeholder-only inputs across hangar, admin and loadout editors gained
  accessible names, and the Codex landing page always exposes a page heading.
- **Codex build date now follows the app language** (de/en) instead of the
  browser locale.

### Changed

- **Tightened web security headers.** The Content-Security-Policy no longer allows
  inline scripts and constrains images to the actual CDN/storage hosts; a
  Cross-Origin-Opener-Policy header was added. Installable PWA icons (192/512 PNG)
  are now shipped.
- **Desktop auto-updater** orders pre-release rings (alpha/beta) by real SemVer
  precedence and only hands genuine http(s) links to the OS browser.
- **`desktop-latest` edge function** sets an explicit (private) `Cache-Control`
  and an `Allow` header on 405 responses (RFC 9110/9111). *Requires an
  edge-function deploy to take effect.*

## [0.41.8] - 2026-07-22

### Fixed

- **Product analytics: pageviews now reach PostHog Web Analytics.**
  Route-change pageviews sent a relative `$current_url` (e.g. `/codex/ships`), so
  PostHog parsed an empty `$host` from it — and Web Analytics, which groups
  pageviews by host, silently dropped every one ("No pageview events detected").
  The `$current_url` is now absolute (origin + path, with the query string and
  fragment still stripped for privacy), restoring a real `$host`/`$pathname`. The
  page already open when statistics consent is granted is now captured too,
  instead of only future navigations — so the landing page, the most common
  pageview, is no longer lost. (analytics)

## [0.41.7] - 2026-07-22

### Fixed

- **Starscape desktop app now shows the real SCC brand icon.** The bundled tray
  icon was placeholder artwork (a purple "A" glyph); regenerated from the
  canonical SCC favicon.
- **Task Manager now lists the process as "Starscape" with its icon.** The
  binary carried no Windows resource, so it appeared as the raw
  `starscape-wallpaper.exe` with a generic icon. A version/icon resource is now
  embedded (`FileDescription = "Starscape"`), and CI hard-fails a release that
  doesn't embed it.
- **Tray menu entry renamed "Open Starscape" → "Open Starscape website"** to make
  clear it opens the web gallery.
- **Weekly Verse-News summary no longer renders an empty thumbnail.** When a news
  item's primary image was a mostly-transparent title-card overlay (e.g. "Alpha
  4.9 Frontier Tensions"), the summary wallpaper showed a blank box. It now picks
  an opaque, landscape image from the item's other images — mirroring the
  website's news thumbnails.

## [0.41.6] - 2026-07-21

### Fixed

- **"Playable" status no longer shown when the game is under maintenance.** The
  Verse News status chip took RSI's overall indicator at face value, which stays
  "operational" during a scheduled Persistent Universe maintenance — so it read
  "Playable" while the PU was actually down. The headline now reflects the
  Persistent Universe component's state, so a PU maintenance/outage shows as such
  at the top; the per-service drill-down is unchanged. (admin feedback)

## [0.41.5] - 2026-07-21

### Fixed

- **Desktop uploader: uploads no longer fail with "unknown release token".**
  The desktop-channels migration dropped `desktop_releases.is_current`, but four
  edge functions (`ingest-bundle`, `ingest-skins`, `ingest-catalog`,
  `verify-release-token`) still validated the release token against that column.
  PostgREST erroring on the missing column left every upload rejected —
  regardless of a valid, registered token — even while the app's connection pill
  showed "connected" (the pill only checks the session, not the release token).
  Release-token validity now keys on `token_revoked` (mirroring `desktop-latest`),
  and a schema/query error surfaces as an honest `server_misconfigured` (500)
  instead of a misleading token error. In-progress extractions resume without
  re-extracting.

## [0.41.4] - 2026-07-21

### Changed

- **Admin feedback board: topics you've answered are now marked "Answered".**
  When you reply to a routine's follow-up question, the topic shows a distinct
  "Answered" pill (instead of the generic "Needs input") so you can tell at a
  glance which questions are waiting on you versus already handed back to the
  routine. (admin feedback)

## [0.41.3] - 2026-07-21

### Changed

- **"What's New" page now shows only the last 3 months by default.** Older
  releases are collapsed behind a "Show N older releases" button (and can be
  folded away again), so the changelog opens focused on recent changes instead
  of the full history. (admin feedback)

## [0.41.2] - 2026-07-21

### Changed

- **Ship 3D livery viewer is now collapsible and remembers your choice.** The
  viewer can be folded away via its header; the open/closed state is saved and
  reused across ships and pages. First-time default adapts to the device —
  expanded on desktop, collapsed on mobile so the 3D stage doesn't dominate a
  phone screen. While collapsed the ~3 MB 3D model is not downloaded at all.
  (admin feedback, part of #137)

## [0.41.1] - 2026-07-21

### Changed

- **Codex ship detail: the "View on RSI" button now opens the name-sorted RSI
  ships listing** (`sortField=name`) instead of the unsorted store landing, so
  you can scan alphabetically to your ship. (admin feedback)

## [0.41.0] - 2026-07-19

### Added

- **Loading & transition animations across the app.** Switching views or waiting
  for content used to feel frozen — Verse News showed almost no motion before
  content appeared, and Starscape's grid was just thin empty stripes while
  images loaded. A shared "sensor sweep" motion system now makes every wait read
  as the ship scanning: a navigation scan bar spans the top on slow switches
  (and stays hidden on fast/cached ones, with a "weak signal" note if a load
  really drags), Verse News skeletons pulse with a visible cyan phosphor sweep
  and HUD corner brackets, and Starscape tiles reserve their space — no more
  collapsed stripes — and "power on" out of a blur as each image decodes. Routed
  views develop in on arrival, tab taps give instant feedback, and the whole
  system stays GPU-light on mobile and honours the OS "reduce motion" setting.

## [0.40.0] - 2026-07-19

### Fixed

- **Starscape wallpaper app: corrupt ("grainy") wallpapers.** A truncated image
  download (a mid-stream network hiccup) could still pass the size check and be
  set as the desktop background, producing heavy grain/scanline artifacts. The
  native app now rejects short reads (Content-Length mismatch) and incomplete
  JPEG/PNG data (magic bytes + EOI/IEND trailer), so a partial image can never
  become a wallpaper.
- **Starscape wallpaper app: silent startup failures.** The windowless tray app
  ran with `panic = "abort"` and no logging, so any startup problem vanished
  without a trace ("it just doesn't start"). It now writes a diagnostics log to
  `%APPDATA%\StarscapeWallpaper\starscape.log` (panic hook + startup milestones +
  GDI+/decode failures) and always shows a tray icon (system fallback when the
  bundled icon can't load), so it never runs invisibly.

### Changed

- **Never-stale desktop-app download.** The Starscape "Download for Windows"
  button now points at a stable `wallpaper-app-latest` alias release (a
  version-less asset the CI republishes on every `wallpaper-app-v*` tag) instead
  of a hardcoded version, so it always resolves to the newest build.

## [0.39.0] - 2026-07-18

### Added

- **Anonymous usage statistics (opt-in).** A new `statistics` consent category
  wires up PostHog (EU region) so we can see which areas of the app get used.
  It is off by default and collects nothing until you allow it in the consent
  banner or under Settings → Browser storage & privacy. No cookies, no user
  identification, no session recording; the analytics library is lazy-loaded
  only after consent, and revoking consent purges its local state. The project
  key is a public, write-only ingest key (same class as the Supabase
  publishable key), not a secret. (#139)

## [0.38.0] - 2026-07-17

### Added
- Public trust pages `/about`, `/legal/privacy`, `/legal/imprint` (DE/EN), linked from the footer and the login card — a credential form without reachable self-description/privacy/imprint pages is a classic phishing-heuristic trigger for AV URL-reputation scanners (Kaspersky "danger of data loss" block on the shared `*.vercel.app` origin).
- Real static `robots.txt`, `sitemap.xml` and `humans.txt` (previously the SPA rewrite answered them with HTML 200 — a soft-404/cloaking signal to scanners).
- JSON-LD `WebApplication`/`Organization` structured data and `application-name` meta in `index.html`; enriched web manifest (`id`, `lang`, `description`, `categories`).

### Changed
- CSP `frame-ancestors` hardened from `'self'` to `'none'` — now consistent with `X-Frame-Options: DENY`.
- Privacy policy and about page disclose PostHog product analytics (EU cloud, first-party proxy) introduced in 0.37.0.

### Fixed
- App crashed at boot (white screen) and every Karma spec errored since the PostHog integration: `import.meta.env` is undefined at runtime because no env-substituting builder is wired — accesses are now optional-chained; PostHog stays dormant until a token-injection mechanism exists.

## [0.37.0] - 2026-07-17

### Added

- **Starscape filters out broken and blank wallpapers automatically.** Corrupted
  or truncated comm-link images (glitch stripes, large blown-out fill blocks)
  and near-empty "pattern" backgrounds with no actual artwork no longer reach
  the gallery. The news crawl now decodes every wallpaper candidate's pixels and
  scores them on entropy, color dominance, uniform bands, bright-fill share and
  edge density before accepting the image — calibrated against the full live
  dataset with zero false positives (genuinely dark space scenes are kept). Six
  existing broken/blank entries were purged from the gallery.

## [0.36.0] - 2026-07-17

### Added

- **Ship detail shows each component's key stats right on its row.** In the
  hangar ship detail view, a component's headline figures now appear directly on
  its hardpoint (and standard-components) row — the quantum drive's **jump range**
  and **drive speed**, and a shield's **HP** and **regen** — instead of only in
  the aggregate "Loadout stats" card. So the jump range stands next to the
  Quantum drive itself. Values come from the existing extracted catalog data (no
  new data source); components without curated headline stats simply show none.

## [0.35.2] - 2026-07-14

### Fixed

- **Connecting the SC Database from the desktop app no longer shows a callback
  error.** The desktop sign-in page (`/desktop/connect`) validated the app's
  local callback against a fixed port range (46800–46899), but the app binds an
  OS-assigned port — so the page rejected every real callback and displayed an
  error instead of signing in. Callback validation now accepts any port on
  `http://127.0.0.1`, matching the desktop connect contract. The security
  boundary is unchanged: the callback must still be a local `127.0.0.1` HTTP
  address, the one-time `state` anti-forgery token must match, and the app only
  accepts the handoff from the official web origin. This retroactively fixes the
  Connect flow for already-installed app versions.

## [0.35.1] - 2026-07-14

### Changed

- **Data Uploader checks for updates automatically — no more manual button.** The
  header's "check for updates" button is gone; the uploader now checks silently at
  every natural moment (launch, and each step/navigation), throttled so rapid moves
  don't hammer the feed and skipped while a download is already in flight. Unlike the
  old button, these background checks never raise an error banner on a feed outage.
  The startup check and 6-hour periodic re-check are unchanged. (data-uploader v0.15.0)

## [0.35.0] - 2026-07-13

### Added

- **Starscape desktop wallpaper app.** A tiny (~0.3 MB) native Windows tray app,
  downloadable from the Starscape page, rotates your desktop background through the
  Starscape gallery in original resolution. It prefetches the next few images (no
  on-desktop loading), offers an optional crossfade, a one-click "Start with
  Windows" toggle, and runs from the system tray with minimal memory. Built in Rust
  (pure Win32, no runtime); published to the public binaries mirror on a
  `wallpaper-app-v*` tag. (feedback b5e070df)

### Changed

- **Tighter Starscape junk filter.** Captured wallpapers now must clear a minimum
  pixel size and a landscape aspect ratio (≥ 1280×720, aspect 1.2–2.6), read from
  the image header before capture, so stray icons, patterns and off-shape grabs no
  longer reach the gallery. Additive only — an unreadable size never rejects.
  (feedback b5e070df)

## [0.34.3] - 2026-07-13

### Added

- **Instant boot splash on first visit.** A cold visit used to show a blank page
  while the app bundle downloaded and started. The page now paints a branded SCC
  splash (compass ring, spinner, wordmark) immediately and swaps it for the app
  the moment it is ready — so the first impression is never an empty screen. The
  page background is set inline too, killing the pre-stylesheet white flash.
  Respects the reduced-motion preference.

### Changed

- **Footer disclaimer is now collapsible.** The footer's trademark/legal
  disclaimer shows only its first clause plus a "…" toggle; the full disclaimer
  and the Cloud Imperium trademark line expand on click. The footer stays compact
  without dropping the required attribution.

### Fixed

- **Browser tab icon shows the SCC logo.** The `favicon.ico` fallback was still
  Angular's stock default, which some browsers preferred over the SVG icon. It is
  now a proper multi-size (16/32/48) SCC-branded icon.

## [0.34.2] - 2026-07-13

### Fixed

- **Feedback screenshots attach again.** Adding an image to a feedback topic or
  reply failed with a database check-constraint error: the composer inlined each
  picture as a base64 `data:` URI into the message body, and a single compressed
  screenshot blew past the body's 20 000-character limit, so the insert was
  rejected and the image stayed stuck in the box. Attachments now upload to a new
  public `feedback-images` storage bucket and the message keeps only the small
  image URL.

## [0.34.1] - 2026-07-12

### Fixed

- **Starscape shows only real wallpapers again.** The image crawler treated
  every picture embedded in a Comm-Link — including tiny inline icons, section
  patterns and even trailer videos — as a wallpaper, so they cluttered the
  gallery next to the actual artwork. Capture now keeps only raster images of
  wallpaper size (≥ 100 KB, JPEG/PNG/WebP) and drops icons, patterns and videos
  at the source. Existing junk entries need a one-time cleanup of the
  `verse_wallpapers` table. (#133 follow-up)

## [0.34.0] - 2026-07-12

### Added

- **Keybindings reference in the Codex.** A new page lists every default key
  binding from the current game build — grouped by category, searchable, with a
  device switch for keyboard, mouse, gamepad and joystick. Reach it from the
  subtle "Keybinds" chip next to the Codex scanner. Bindings and their labels are
  datamined straight from the game's `Data.p4k` (its default action profile plus
  every language's translations) and uploaded by the Data Uploader like the rest
  of the catalog. Public — no login required.

## [0.33.1] - 2026-07-12

### Changed

- **Admin feedback board — newest first, filter by author, roomier popup.**
  Active topics now sort by recency (their own timestamps and the last reply),
  so a freshly-answered thread rises to the top. A quick-access chip row filters
  the board to a single creator (with per-author counts), and the docked (non-
  maximized) feedback popup is larger so more expanded threads stay visible.
  (feedback fc5373d5)

## [0.33.0] - 2026-07-11

### Added

- **Browse without an account.** Verse News, the Codex, release notes and the
  new info pages are public now — no login required. The hangar stays
  members-only and greets signed-out visitors with a benefits teaser (save
  your ships · fleet overview · test loadouts · compare) and a sign-in CTA.
  (#131)
- **Starscape — a wallpaper gallery from RSI imagery.** High-resolution
  Comm-Link artwork collected during the news crawl, browsable as a masonry
  wall with series filter and lightbox. Every image links straight to the
  original full-resolution file on the RSI CDN with attribution to its source
  Comm-Link — the app stores metadata only, never image bytes. (#133)
- **Import your hangar from an export file.** Drop a Hangar Transfer Format
  JSON (e.g. from the HangarXPLOR browser extension) into the new import panel:
  entries are matched against the codex (exact ship code first, name search as
  flagged best guess), previewed with their match state, and only confirmed
  rows are added — nicknames become custom names. No RSI credentials, ever.
  (#136)
- **Concept-ship wishlist.** Track unreleased ships that have no codex entry
  yet — name, manufacturer, pledge link — with a permanent "Concept —
  preliminary" badge. (#135)
- **Quantum & fuel facts on ship pages.** The codex ship detail now derives
  quantum range, quantum speed and hydrogen/quantum fuel capacities from the
  stock loadout, and the quantum drive slot shows its jump range as a chip.
  (#137)
- **Browser-storage consent.** A first-visit notice explains what the app
  stores (no cookies — login session and language are essential; news filters,
  saved articles and similar preferences are opt-in). A new Settings card
  makes the choice revisitable; declining purges stored preferences. (#130)
- **3D-printing guide.** `/tools/3d-print` documents the community workflow
  (own-files extraction → conversion → Blender print-prep) and the vetted
  external tools — the app hosts no game geometry by design (EULA). (#79)

### Changed

- **Codex content follows your language reactively.** Card titles, compare
  columns and manufacturer names switch between DE/EN immediately and only use
  German when a genuine translation exists (English fallback otherwise). (#50)
- **Language switcher offers DE/EN only** — the stub locales (FR/ES/PT/RU/ZH)
  that silently fell back to English are gone; legacy stored choices are
  normalized. (#23)

### Fixed

- **Status drill-down keeps components during incidents.** The RSI status page
  marks degraded/partial/major/maintenance components with short status values
  the scraper didn't know — affected services vanished from the panel exactly
  when they mattered. (#20)

## [0.32.0] - 2026-07-10

### Added

- **Per-topic chat threads on the admin feedback board.** Every feedback topic
  now carries a thread of follow-up replies (`admin_feedback_messages`): an admin
  can answer directly under a topic, and the automated routine posts system
  replies. A new `needs_input` status lets the routine park an item it can't
  auto-ship and ask a question instead of terminally rejecting it — the admin's
  answer resumes the work on the next run. `needs_input` topics auto-expand in
  the embedded panel so the question and reply box are immediately visible.
- **Maximize the feedback panel to near-fullscreen.** The floating feedback
  panel gained a maximize/restore button (Escape steps down: fullscreen → docked
  → minimized), so long threads are readable without leaving the current page.
- **"View on RSI" button on the ship detail page.** Opens the ship's official
  RSI store/pledge page in a new tab.

## [0.31.0] - 2026-07-09

### Added

- **Attach images to admin feedback.** The feedback composer accepts images via
  a toolbar picker, pasting (Ctrl+V), or drag & drop — multiple at once, shown
  as removable thumbnails before sending. Each image is downscaled (longest edge
  ≤ 1600px) and re-encoded to a size-bounded JPEG client-side, then inlined into
  the message as markdown so it renders inline in the board. The feedback
  markdown renderer gained image support, restricted to `https` and
  self-generated raster `data:` URIs (never SVG) and hardened against markup
  injection.

## [0.30.0] - 2026-07-08

### Added

- **Verse News shows a live "updated X min ago" indicator at the top.** The
  overall refresh time moved from a stale footer hint to the header, with a
  pulsing freshness dot and an exact minute count. A 30-second clock keeps it —
  and every card timestamp — updating between the 5-minute feed refreshes; the
  indicator turns amber once the feed is stale (> 7 min).

### Changed

- **Richer Verse News loading skeletons.** The initial-load placeholder now
  mirrors the real card layout (thumbnail + text lines across the Today and
  This-week buckets, with a staggered shimmer) instead of a few empty boxes, so
  first paint reads as content loading. Respects `prefers-reduced-motion`.

## [0.29.1] - 2026-07-08

### Fixed

- **Data-uploader auto-update no longer locks itself out.** The update feed
  (`desktop-latest`) validated the build's release token against `is_current`,
  but registering any newer release flips older rows off `is_current` — so every
  already-installed older build got `401 invalid_or_revoked_release_token` and
  could never update. Token validity is now an explicit `token_revoked` kill-switch
  (leaked tokens still revocable), decoupled from `is_current`; the feed continues
  to serve the current release. **Requires deploying the `desktop-latest` function
  and applying the `token_revoked` migration.**
- **Update failures now reach crash telemetry.** Uploader update errors (401s, feed
  outages) were only shown in the in-app banner and never reported, so they were
  invisible in the dashboard. They are now sent to `ingest-telemetry`
  (`errorType: 'update'`, deduped against poll spam).

### Added

- **Data-uploader re-checks for updates periodically** (every 6 h) so a long-open
  session notices releases published after launch, plus a discoverable
  "check for updates" button in the header.

## [0.29.0] - 2026-07-07

### Fixed

- **Bundle history now shows every upload, not just the active one.** A re-upload
  with a newer tool version supersedes the prior bundle for its
  (channel, patch, build); those superseded rows were marked `disabled` and hidden
  behind the admin-only "disabled" toggle, so past uploads looked lost. Supersession
  now has its own marker (`superseded_at`, distinct from a moderation disable): the
  history view surfaces superseded uploads for any collaborator (History toggle now
  defaults on), tagged with a neutral "Superseded" badge, while genuine moderation
  disables stay admin-gated. The single-active-per-key invariant is unchanged.
- **Clearer data-uploader error when the bundled Python is missing.** A packaged
  install whose embedded interpreter is absent (e.g. an interrupted or partial
  auto-update) previously died with a cryptic `spawn python ENOENT`. It now fails
  fast with an actionable message telling the user to reinstall; dev builds get a
  message pointing at `SC_EXTRACT_PYTHON` / a PATH Python.

## [0.28.0] - 2026-07-07

### Changed

- **3D ship skins ride along the normal upload (data uploader).** Skins are no
  longer a separate "3D-Skins" button / view with manual ship input — they are a
  sub-property of every ship, built and uploaded automatically as part of the
  normal extract → upload flow. The metadata extract writes a build manifest
  (`skins/_build_manifest.json`) of every ship with a buildable livery; the
  upload step then ensures `cgf-converter`, builds each ship's glbs from the
  manifest, and uploads them right after the bundle + Codex promote — one click,
  no separate step.
- **Two-level per-patch skin cache.** A build cache (a ship with an existing
  `skins.json` skips the ~2–3 min/livery rebuild) plus an upload cache (a
  `.uploaded` marker skips re-PUTing the multi-GB assets). The first upload of a
  patch version builds everything; every re-run finishes in seconds. Skin
  failures are non-fatal — the metadata bundle upload is never blocked.

### Added

- **`skins` entity counter** surfaces in the extract run + bundle summary.

## [0.27.0] - 2026-07-07

### Added

- **Ship liveries as a ship sub-property (data uploader, phase 1).** The extractor
  now emits each ship's paint skins inline with its metadata — every ship record
  carries a `skins` list (id, name, description, icon, source, `has_material`)
  instead of skins living in a disconnected, manually-driven pipeline. Ship
  manufacturer / folder / series are derived generically from the resolved hull
  `.cga` path (`ref_from_hull`), so skins are discovered for *all* ships
  automatically — no hard-coded ship registry. A pre-built index keeps the
  per-ship catalog lookup `O(paints)` instead of scanning the whole archive, and
  a new `skins` counter runs through to the bundle summary. Follow-up phases wire
  the integrated 3D-glb build, auto-upload, and remove the separate uploader
  "3D-Skins" view.

## [0.26.2] - 2026-07-07

### Added

- **What's New page.** A user-facing release-notes page at `/release-notes`,
  reachable from a "What's New" link + version in the site footer. It renders
  every release as a timeline with color-coded category tags (Added / Changed /
  Fixed / …). The content is generated at build time from `CHANGELOG.md` by a
  `prebuild` step (`scripts/gen-release-notes.js` → `public/release-notes.json`),
  so it refreshes automatically on every deploy — no separate content step. (admin feedback)

## [0.26.1] - 2026-07-07

### Changed

- **Telemetry time-range selector.** Replaced the off-style white `<select>`
  dropdown on `/admin/telemetry` with a segmented control (`7d / 30d / 90d`)
  that matches the adjacent product-filter control, for one consistent,
  in-theme header. (admin feedback)

## [0.26.0] - 2026-07-07

### Added

- **Admin feedback board.** A new admins-only channel at `/admin/feedback` where
  any admin can post free-text suggestions ("what could be better"), multiple
  messages in a row. Shared board — every admin sees every message — with a
  status per item (`open → in_progress → shipped → rejected`). Backed by the
  RLS-guarded `admin_feedback` table.
- **Composer conveniences.** The input persists its draft in `localStorage`
  (survives an accidental window close), auto-continues bullet/numbered lists on
  Enter (empty marker exits the list), sends on **Ctrl/Cmd+Enter** (plain Enter =
  newline), and offers a bold/bullet/numbered/code toolbar. Messages render via a
  dependency-free, HTML-escaping Markdown subset (links limited to http/mailto).
- **Nightly auto-ship routine (runbook).** `docs/feedback-routine.md` specifies
  the 19:00 cloud routine that consumes open feedback, implements each item on a
  branch, and ships on green build+tests via PR + auto-merge (never force-push),
  writing the status + `ship_ref` back to the board.

## [0.25.0] - 2026-07-06

### Added

- **Data Uploader crash telemetry + logging.** The uploader now initializes
  logging eagerly and installs main + renderer crash handlers, so a startup
  failure lands in `logs/main.log` instead of vanishing (the v0.8.2 symptom).
  Uncaught errors are reported (opt-out, via a status-bar toggle) to the shared
  `ingest-telemetry` function as `product = data-uploader`.
- **Admin telemetry product switcher.** The `/admin/telemetry` page gains an
  **SCC-App / Data Uploader / All** segmented control (default remembered in
  `localStorage`); the `telemetry_events` table + `get_telemetry_stats` gained a
  `product` dimension (legacy `NULL` counts as SCC-App).

## [0.24.0] - 2026-07-06

### Added

- **Codex freshness hint.** The Codex quality/provenance banner now warns
  *"requires a data upload — a newer game version is live than this catalog
  reflects"* when the current build is behind the newest uploaded LIVE patch
  (read from the viewer-safe `p4k_bundles_public_stats` view via a tolerant
  patch comparison). An **"Open Data Uploader"** link is shown **only** to
  collaborators/admins — the same gate as the nav tab.
- **Desktop upload now feeds the public Codex.** After a successful bundle
  upload the Data Uploader drives the `ingest-catalog` pipeline from the same
  extract, so a desktop upload refreshes `codex_builds`/`codex_ships` (which the
  public `/codex` reads) instead of only `p4k_bundles`. Runs before cleanup and
  is non-fatal — a catalog failure never blocks the confirmed bundle upload.

### Hardened

- Catalog promotion refuses to flip `is_current` onto an empty/partial extract
  (no ships **and** no manufacturers), so a broken upload can never blank the
  live Codex — the last good build stays live.

## [0.23.0] - 2026-07-06

### Added

- **Account settings page (`/settings`).** The standalone Profile menu item is
  gone — a profile avatar dropdown (top-right) now offers Settings and Sign out.
  Settings bundles read-only account info, a **unique username** (validated
  `a–z 0–9 _`, 3–20 chars, case-insensitive uniqueness), the **language
  switcher** (moved from the topbar; persists to the profile and applies on the
  next login), and a **delete-my-account** danger zone.
- **Admin user list: filtering & sorting.** Search across name/username/email,
  a role filter, an X-of-Y result count with clear-all, and click-to-sort
  columns (user, email, role, joined, last-seen; nulls sort last). The new
  `username` is shown as an `@handle` and is searchable/sortable.
- **Public API OpenAPI export (`docs/api/openapi.json`)** for upload to the
  readme.io documentation site, plus an "API documentation" link on the API
  Tokens admin page.

### Changed

- **Ctrl+K quick search — full keyboard operation.** The whole page now blurs
  behind the palette; the caret stays in the input while ↑/↓ move a highlighted
  result (scrolled into view) and Enter opens the active one. Listbox/option
  a11y added.
- **Comprehensive mobile-responsive pass** across shell, feature pages, admin,
  settings and uploader — no horizontal page scroll at phone widths, wide tables
  become scroll-containers, grids/inputs stack, long ids/emails/tokens wrap.

### Database

- Migration `20260706120000_profile_username_lang.sql`: adds `profiles.username`
  (citext, unique) and `profiles.preferred_lang` (CHECK de/en/fr/es/pt/ru/zh),
  RPCs `set_username()` / `set_preferred_lang()` (SECURITY DEFINER), and extends
  `list_users_for_admin()` with `username`. **Not yet applied to the cloud
  project** — `db:push` is blocked by a pre-existing migration-history desync;
  username/language/settings-save features error at runtime until it is applied.

## [0.22.1] - 2026-07-05

### Security

- **npm audit cleared for the web app (25 → 0).** Angular 21.2.13 → 21.2.17 via
  `ng update` (fixes the published Angular advisories: DoS via `formatDate`/`digitsInfo`,
  `HttpTransferCache` information leak & weak cache-key hashing, hydration DOM
  clobbering, template/attribute namespace sanitization bypass) plus patched
  transitive tooling (undici, vite, ws, piscina, esbuild; `@babel/core` override).
- **data-uploader dev tooling hardened (20 → 1).** vitest 2 → 4 (critical advisory),
  electron-vite 2 → 5, vite 5 → 7, electron-builder 25 → 26; esbuild override.
  Remaining: the Electron 33 → 43 major is deliberately deferred to a dedicated
  desktop release pass (runtime of the shipped binary, needs embedded-Python
  compat testing).
- **GitHub security features enabled** (repo settings, no code): Dependabot alerts +
  automated security updates, secret scanning + push protection, CodeQL default setup.

## [0.22.0] - 2026-07-05

### Added

- **Object view: decision stats grouped by purpose (P1 Slice 3).** Component and weapon
  detail pages no longer render a flat stat dump — rows are bucketed into Offense /
  Defense & Durability / Mobility / Power & Thermal / Capacity & Range / Handling /
  General (keyword + unit heuristics, DE/EN section labels).
- **Read-only hardpoint layout (loadout ladder Rung 1).** Ship detail renders the stock
  loadout as labelled slot clusters docked around the ship silhouette (no positional
  port data exists — an honest schematic). Every filled slot deep-links to the
  installed item; reduced-motion-safe scanline, mobile collapses to one column.
- **Full spec sheet (Manifest).** A collapsed, readable full-spec table (every
  meaningful payload value, sectioned by struct, with provenance line) next to the raw
  JSON toggle.
- **Compare surface deepened.** Rows grouped by the same purpose buckets (identity
  first), per-cell delta bars, a "differences only" toggle, like-for-like enforcement
  (mixed-kind pins are refused with an explanatory hint) and FIFO bumping when a 5th
  entry is pinned.
- **Swap-preview dock (loadout ladder Rung 2 — The Bay begins).** Every filled loadout
  slot gets a ⇄ affordance: lists what else fits (compatibility RPC on the installed
  item's attach type + size) and previews the stat delta a swap would cause — nothing
  is persisted.
- **Bay-scene ship hero.** The ship identity render sits in a dim hangar frame with rim
  glow and a gentle drift (≤3 px, `prefers-reduced-motion` safe).

### Changed

- **Flagship persistence promoted localStorage → DB.** New `profiles.flagship_ship_class`
  column (additive migration); the profile is now the source of truth (cross-device),
  localStorage remains the offline cache. A pre-column local pin is promoted to the DB
  exactly once per device. Cloud `db:push` required before the next deploy.

## [0.21.0] - 2026-07-05

### Changed

- **Codex reimagined as "The Bridge" (rethink).** The `/codex` front door is no longer a
  filter-list. It opens as a Bridge: an always-present scanner search, one focal hero
  (your pinned flagship → first hangar ship → featured ship), and horizontal lanes
  (Your Hangar · Fresh this patch · Popular to compare · Explore by role). The full
  facet grid survives verbatim as an opt-in Index mode at `/codex/index`. Compare tray,
  add-to-hangar, provenance banner and the auth gate are unchanged. 2D-only,
  reduced-motion-safe.

### Added

- **Pin-a-flagship.** Designate one hangar ship as your flagship (★) from the Bridge hero
  or the hangar cards; it drives the Bridge hero and eyebrow ("Dein Flaggschiff").
  Persisted per user in `localStorage` (promotion to a DB column tracked as a follow-up).

### Fixed

- **Index-mode kind tabs rendered raw i18n keys** (`codex.kinds.ship`) — added the missing
  DE/EN plural labels for ship/weapon/component/item/ammunition/manufacturer.

## [0.20.1] - 2026-06-22

### Fixed

- **Production build / Vercel deploy broke after #84.** The blueprint-catalog PR was
  branched from a pre-#58 base and re-added blueprint interfaces (`BlueprintPayload`,
  `BlueprintIngredientPayload`, `BlueprintOutputPayload`, `CodexBlueprint`,
  `CodexBlueprintIngredient`) that #58/#83 already shipped — with mismatched
  nullability. TypeScript interface declaration-merging then failed
  (`TS2717`/`TS2741`), breaking `ng build --configuration production`. Restored
  `codex.types.ts` to the #83 state; removed the duplicate declarations and the
  unused #84-only additions (`CodexBlueprintRow`, `CodexBlueprintIngredientRow`,
  `BlueprintQualityRefs`).

## [0.20.0] - 2026-06-21

### Added

- **Codex category fallback icons (UC-01).** Every catalog entity now has a guaranteed
  visual anchor — a stroke category glyph (ship / weapon / component-by-kind / item /
  ammo / manufacturer) coloured per category — wherever datamined artwork is missing
  (~94% of entities; components & ammunition have none). List cards and the detail hero
  fall back to the icon, with broken-image recovery for dead storage links.
- **Catalog content in the app language (UC-08).** Names, descriptions, manufacturer and
  role render in DE/EN following the app language with English as the guaranteed fallback,
  instead of always English. The compare tray follows the same rule.
- **Bidirectional hangar integration (UC-02, UC-07).** Ship list cards show an "in your
  hangar" badge or an inline add button (no navigation); add-to-hangar on the detail page
  now deep-links straight into the configurator, and owned ships get a "configure loadout"
  shortcut.
- **Viewer-visible data provenance banner (UC-12).** An expandable status banner surfaces
  the catalog build, patch, extraction date and per-kind coverage to any signed-in viewer.
- **Visual stat encoding (UC-10).** List cards show a size S1–S12 bar and colour-coded
  grade (A–D) for at-a-glance scanning.
- **Compare best/worst highlighting (UC-05).** The compare tray highlights the highest
  (best) and lowest (worst) value in every numerically comparable stat row.

### Changed

- The empty Blueprint catalog kind is shown disabled with a "coming soon" hint instead of
  leading into an empty list (UC-13).

## [0.19.1] - 2026-06-21

### Fixed

- **RSI service status always read "unbekannt".** The scrape targeted
  `data-component-status` / `component-inner-container` / `page-status` selectors
  that no longer exist. RSI's status site is a static S3/CloudFront export (its
  `/api/v2/*.json` endpoints 403), and its current markup is
  `<div class="component"> NAME </a> <span class="component-status" data-status="X">`
  with overall state on `<body class="status-homepage status-ok">`. `fetchStatus`
  now reads those selectors and the `data-status` enum, so the chip reports the
  real overall + per-component status (verified live: operational across Platform,
  Persistent Universe, Arena Commander).

## [0.19.0] - 2026-06-21

### Added

- **Real Spectrum thumbnails.** Spectrum cards previously had no image at all.
  `fetch-verse-news` now reads each thread's inline `media_preview.thumbnail.url`
  (RSI's own preview of the first post's media) — no per-thread content fetch, so
  zero extra requests. Small `tavern_upload_mini` previews are upgraded to the
  card-sized `tavern_upload_large` variant, and `/imager/` proxy urls are
  unwrapped to their inner media-CDN source so the post/cover variant pipeline can
  size them. Host-allowlisted to `robertsspaceindustries.com` (untrusted content).
  Threads without a preview fall through to the new channel default below.
- **Channel-branded default thumbnails.** Cards with no usable image (every
  image-less Spectrum thread, the occasional og-less Comm-Link) now render a
  branded SVG placeholder instead of a flat gradient.

### Fixed

- **Thumbnails vanished after switching tabs / on silent refresh.** The per-image
  decode/ratio state was keyed off the `images` array *identity*; every poll handed
  a new array with the same urls, wiping that state while the reused `<img>`
  elements never re-fired `load` — leaving tiles stuck under the shimmer. State is
  now keyed by url *content*, the skeleton sits behind the image (a painted image
  is never hidden), and a cache-hit recovery path covers images that complete
  before the `load` listener attaches.
- **og:image backfill made more robust** — decodes HTML entities, resolves
  protocol-relative/relative urls, and also accepts `og:image:secure_url`/`:url`,
  `twitter:image:src`, and `<link rel="image_src">`.
- **A single absurd Spectrum `time_created` could blank the whole feed** — a
  finite-but-out-of-range timestamp threw `RangeError` in `toISOString()`, caught
  at the function level and dropping *all* Spectrum items; such rows are now skipped
  individually.

### Changed

- **News thumbnails fade in with a blur-up reveal** instead of popping in
  (respects `prefers-reduced-motion`).

## [0.18.3] - 2026-06-18

### Fixed

- **Verse-News cards from some Comm-Links had no thumbnail.** The
  `star-citizen.wiki` API returns `images: []` / `images_count: 0` for certain
  Comm-Links — the "Roadmap Roundup" Transmission series being the recurring
  offender — even with `?include=images`. Because the thumbnail was sourced
  solely from that array, those cards rendered image-less. `fetch-verse-news`
  now falls back to scraping the `og:image` (then `twitter:image`) meta tag from
  the RSI permalink for any entry without images; the resulting media-CDN url
  flows through the existing variant-swap + cache pipeline unchanged. Hardened:
  only `robertsspaceindustries.com` hosts accepted (page is untrusted), 6 s
  timeout, bounded to 10 entries per request.

## [0.18.2] - 2026-06-18

### Fixed

- **Uploader login opened only the start page, never signed in.** Uploader
  binaries built before the `/desktop`→`/uploader` rename (0.18.0) — the shipped
  v0.4.x–v0.6.1 — open `/desktop/auth?cb=…&state=…`. The `pathMatch: 'full'`
  `/desktop` redirect does NOT cover that sub-path, so the URL fell through to
  the `**` wildcard and silently landed on `/news`. The 0.18.0 changelog assumed
  "the uploader binary is unreleased, so a clean rename was safe" — that was
  wrong (v0.4.3 ships and points exactly there). Restored a `/desktop/auth`
  alias that renders the same `DesktopAuthComponent`, so pre-rename binaries keep
  working without a reinstall. (Binaries ≤ v0.4.5 also predate the form-POST /
  Private-Network handoff fix and still need a reinstall of the current build.)

## [0.18.1] - 2026-06-14

### Fixed

- **Bundle supersede was still blocked by a surviving unique constraint.** The
  0.18.0 migration keyed supersede on `(channel, patch, build, uploaded_by)` and
  dropped the wrong (already-replaced) constraint, leaving 00006's non-partial
  `p4k_bundles_channel_patch_build_key` UNIQUE (channel, patch_version,
  build_number) in place. The supersede insert therefore collided (23505) — a
  higher-version re-upload still returned 409 instead of replacing. Re-keyed
  supersede, the partial-unique-on-active index, and per-build retention to
  `(channel, patch_version, build_number)` (the app's real identity — `check-bundle`
  and `list_p4k_bundles_for_collaborator` both key the same way) and dropped the
  blocking constraint. Verified end-to-end on the cloud DB. Migration
  `20260614010000_fix_bundle_supersede_keying`.

## [0.18.0] - 2026-06-14

### Added

- **Bundle supersede on higher uploader version.** A re-upload of the same
  channel/patch/build by the same operator is no longer a hard duplicate: a
  strictly-higher semver uploader `tool_version` now SUPERSEDES the active
  bundle (the old row is retired to history with reason `superseded by tool X`
  and stays visible under the history toggle for admin rollback). Equal/lower
  versions still return HTTP 409. Implemented in `ingest_bundle_atomic`; the old
  UNIQUE constraint is replaced by a partial-unique-on-active index so
  superseded history can coexist (migration
  `20260614000000_bundle_supersede_retention`).
- **Bundle retention caps.** The ingest RPC now keeps at most the newest 3
  tool-versions per build and at most 20 bundles globally, pruning
  disabled/superseded rows first, then the oldest. A gray retention hint under
  the P4K bundle-history table explains the policy.

### Changed

- **Web route `/desktop` → `/uploader`.** The Data Uploader page and the Electron
  OAuth loopback callback moved to `/uploader` + `/uploader/auth` (the uploader
  binary is unreleased, so a clean rename was safe). A legacy `/desktop` →
  `/uploader` redirect preserves bookmarks. The local Supabase redirect-url
  allowlist was updated; the **production** dashboard still needs `/uploader/auth`
  added manually (Auth → URL Configuration).

### Deploy

- Migration `20260614000000` and `ingest-bundle` edge function v7 are already
  applied/deployed to the cloud project (`hcnqhvzlavdycidqyaai`).
- Data-uploader **source** changed (OAuth callback URL, i18n) but **no binary was
  built** — the uploader stays unreleased until a `data-uploader-v*` tag ships.

## [0.17.1] - 2026-06-13

### Fixed

- **Data uploader: "Invalid JWT" upload failure.** The `ingest-bundle` edge
  function had no `[functions.ingest-bundle]` block in `config.toml`, so
  `verify_jwt` defaulted to `true` and the platform gateway rejected the desktop
  uploader's user-session token as `Invalid JWT` before the function ran — the
  Tool surfaced this as a misleading "Netzwerkfehler". The gateway verifies
  against the legacy JWT secret, but live session tokens are signed with the
  project's asymmetric signing keys (static anon-key calls like `fetch-verse-news`
  still pass). Added `verify_jwt = false` to match the sibling `desktop-latest` /
  `api` functions; the function already self-authenticates via `getUser` +
  admin/collaborator role gate + release-token, so no security is lost. Live
  function redeployed to v6.

## [0.17.0] - 2026-06-13

### Added — Web Hangar: the Codex becomes a personal hub

- **My Hangar (`/hangar`).** First user-owned data layer on top of the read-only
  codex catalog: add ships (owned/wishlist), pet names, notes, top-3 flagship
  pins with hero cards, and per-ship 3D skin viewer reuse. Three new RLS
  self-only tables (`hangar_ships`, `hangar_ship_configs`,
  `hangar_role_loadouts`, migration `20260613000000_hangar`).
- **Ship configurator.** Named, role-tagged loadout configs per hangar ship
  (one active each): hardpoints grouped by category, per-port component swap
  via the `codex_compatible_items` resolver, stock/override merge, and
  aggregate loadout stats (shield pool, quantum figures, weapons by size)
  computed from the extracted component data.
- **Role loadouts.** Ship-independent FPS / mining / salvage / medical /
  engineering equipment sets with suggested role slots and free custom slots.
- **Global quick search (Ctrl+K / `/`).** Fuzzy lookup across ships, weapons
  and components with inline stat chips; ships add straight to the hangar;
  codex ship pages gained an add-to-hangar action.
- **i18n.** Full `hangar.*` + `quickSearch.*` sections and completed
  `codex.kindSingular.*` in all 7 locales.

### Added — Data Uploader 0.7.0: dynamic language discovery

- **All P4K languages.** `Data/Localization/<x>/global.ini` folders are now
  discovered at runtime instead of a hardcoded en/de map — the live archive
  yields 11 languages (en, de, es, es-419, fr, it, ja, ko, pt-BR, zh-Hans,
  zh-Hant), each dumped as `localization/<code>.json` and ingested into
  `codex_locale_strings` by the existing seed path. English stays the
  canonical original; the `{de, en, key}` entity payload contract is
  unchanged. The bundle manifest now carries a `languages` list.

## [0.16.0] - 2026-06-06

### Added — Data Uploader: persistent login + auto-sync connection tile

- **One-time login.** The desktop tool now persists the Supabase session
  (access + refresh token) encrypted at rest via Electron `safeStorage` (DPAPI on
  Windows). It auto-connects on launch and silently refreshes the access token, so
  the operator signs in once instead of on every launch. When no OS keyring is
  available it falls back to in-memory (re-auth per launch) — tokens are never
  written in plaintext.
- **Connection tile.** A persistent tile shows the session state and syncs the
  server bundle catalog (RPC `list_p4k_bundles_for_collaborator`) per channel —
  the channels build up as they arrive, only the latest snapshot is cached, and
  progress is remembered across launches. Uploads and skin exports reuse the
  persisted session (no re-login).
- **Web handoff.** `/desktop/auth` additionally posts `refresh_token` +
  `expires_at` in the form-POST body (never in the URL); older tool builds simply
  ignore the extra fields.

> The Data Uploader **binary** is not re-released in this version — the tool
> version bump + `data-uploader-v*` build are a separate follow-up (deploy order:
> web first, then tool).

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
