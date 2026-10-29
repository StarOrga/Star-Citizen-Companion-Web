# Contract note — Wave 1 (layout contract, tokens, width tracks)

Branch `claude/star-citizen-header-footer-analysis-d7b33d-foundation`. Everything is behind the
beta area `shell`; with it off nothing changes (the shell binds no `data-layout`, keeps `.content`).

## Beta flag
- `BetaArea = 'verse' | 'codex' | 'shell'` (`core/analytics.service.ts`), `BETA_AREAS` includes `shell`
  (`core/beta.service.ts`), default **off**, persisted in `sc.beta`, PostHog key `beta-shell`.
  `betaAreaOf(url)` still only returns `verse`/`codex` (URL-bound); `shell` is app-wide.
- Read it: `inject(BetaService).isEnabled('shell')` (Signal<boolean>). i18n `beta.area.shell`.
- Until Wave 2's chip exists, the shell mounts a second `<sc-beta-dock area="shell" [lane]>`
  (collaborators and admins only). Wave 2: replace both docks with the top-right chip and drop
  `lane` from `BetaDockComponent` if unused.

## Layout contract (`src/app/core/layout/`)
- `page-layout.ts`: `PageLayout = 'cinematic'|'content'|'tool'|'overlay'|'plain'`, `PAGE_LAYOUTS`,
  `LAYOUT_DATA = 'layout'`, `DEFAULT_PAGE_LAYOUT = 'content'`, `PageTrack`, `LAYOUT_TRACK`
  (cinematic→full, content→narrow, tool→wide, overlay→narrow, plain→narrow), `layoutOfData`,
  `layoutOfSnapshot(root)`.
- `LayoutService` (root): `layout(): PageLayout` (deepest route data on the active chain, updated on
  `NavigationEnd`, fallback `content`), `track(): PageTrack`.
  A routed overlay child (`OVERLAY_ROUTE_DATA`) is skipped, so `/verse/patches/:line` opened over the
  board keeps the board's `cinematic`. When Wave 3 makes the direct call a page, drop the flag/skip there.
- Every page route in `app.routes.ts`, `verse.routes.ts`, `starmap.routes.ts` carries
  `data.layout` (pinned by `route-layout.spec.ts`). Redirects and the `**` entry carry none.
  Mapping = decisions.json iteration 2 `seitentypen2` cells (cine_hub/cine_sub→cinematic, content,
  tool, overlay, plain). Judgement calls:
  - settings, friends, login: cinematic (user moved them to cine_hub/cine_sub).
  - set-password, unavailable, uploader/auth, desktop/auth, desktop/connect: the cell says `overlay`
    but the user note (and spec §12) says "cinematic but simple" and they are standalone pages →
    `cinematic`.
  - `codex/upcoming/:id`: `overlay` as in the cell (it is still a routed page today).
  - `/verse/gallery/constellations` stays a `cinematic` route until the star-map toggle (spec §12)
    removes it. `/admin/telemetry` is `content` (iteration 2), `hq/spind/:id`, `hq/hangar/:id` `content`.
- Read it in a component: `inject(LayoutService).layout()`. In CSS: `[data-layout='tool'] …` on the
  shell / public-layout host (set only with the `shell` beta on).

## Tokens (`src/styles.scss`, "SHELL TOKENS + PAGE FRAME TRACKS")
- `--sc-space-1..8` = 4, 8, 12, 16, 24, 32, 48, 64 px (8px grid + 4px half step; matches the fallbacks
  `hq-shell` already used, so nothing moved).
- `--sc-bar-h` 64px (phone 56), `--sc-footer-h` 56px (phone 48), `--sc-wide-gutter` clamp(16px,2.5vw,64px)
  (phone = `--sc-page-gutter`).
- `--sc-gap-head` (bar → first content line), one value per `[data-layout]`:
  cinematic 0, content/plain `--sc-space-6` (phone `-5`), tool/overlay `--sc-space-5` (phone `-4`).
  The frame applies it as top padding; pages never set their own.
- Motion: `--sc-bar-hide-ms: 250ms` (0ms under `prefers-reduced-motion`). Thresholds for Wave 2 JS
  (not tokens): hide after ~1 bar height scrolled down, reveal after 5-10 px up.
- `html:has([data-layout]) { scroll-padding-top: var(--sc-bar-h) }`; phone: `scroll-padding-bottom`
  instead (bar sits at the bottom there).

## Width tracks
- `.sc-frame` is a CSS grid with named lines `full-start | wide-start | narrow-start | measure-start |
  measure-end | narrow-end | wide-end | full-end`. narrow = `min(clamp(720px, 60%, 1040px), 100% - 2*gutter)`,
  measure = `min(var(--sc-measure), narrow)`; phone: narrow = whole width minus gutters.
- Direct children of `.sc-frame` default to the layout's track (`:where`, zero specificity);
  override with `.sc-track-full | -wide | -narrow | -measure` on the child. Pages that need a stage
  inside a content layout put the stage child on `.sc-track-full`.
- Shell `<main>` and public-layout `<main>` both switch from `.content` to `.sc-frame` with the beta on
  (one frame, the two copied `.content` blocks stay only for the beta-off path). No `100vw`.
- Under `cinematic` = `full` a routed page now gets no gutter from the frame: the page (or its own
  inner wrapper with `.sc-track-wide` semantic) must inset its content. Wave 4 adjusts the
  cinematic pages (settings, friends, login) as they are migrated.
- Extra columns (>=2200px preview, >=1600px rail) are NOT in this wave; the lines `wide`/`narrow`
  are what Wave 3 hangs them on.

## Hooks for Wave 2
- Shell template: `<header class="topbar">` is untouched; the bar/footer components should be mounted
  under `@if (shellOn())` in `shell.component.ts` next to the existing `<sc-footer>`; replace by
  swapping the `@else` branch. `shellOn` and `layout` (`LayoutService`) are fields on `ShellComponent`.
- With the shell β on the shell already disables the URL checks it replaces: `codexBar()` is false
  (search belongs to the capsule) and `verseOverlay()` is false (footer mode must follow
  `layout()`); `isVerseHome`/`isCodexSubpage` stay exported and used for the beta-off path.
  `betaArea` (verse/codex docks) is intentionally still URL-driven until the chip replaces it.
- No `ShellChromeService` was added: nothing needs cross-component bar state yet (YAGNI); Wave 2
  introduces it with the bar.
