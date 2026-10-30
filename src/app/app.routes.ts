import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';
import { approvedGuard } from './auth/approved.guard';
import { authGuard } from './auth/auth.guard';
import { publicOnlyGuard } from './auth/public-only.guard';
import { roleGuard } from './auth/role.guard';
import { OVERLAY_ROUTE_DATA } from './core/overlay-route-scroll';
import { shellBetaOn } from './core/layout/shell-beta.guard';

// Guard policy (access-control design, 2026-08-05, supersedes #131): the app
// is now a login wall by default — fail closed. `canActivateChild` on the
// shell parent below applies authGuard + approvedGuard to EVERY child route,
// so a new route added under the shell is gated automatically without
// remembering to list guards on it. The only reachable pages while signed
// out are `/login` and the small public surface (`/about`, `/legal/privacy`,
// `/legal/imprint`) rendered through PublicLayoutComponent, which is NOT a
// child of the gated shell parent. Existing `roleGuard(...)` constraints on
// individual routes stay as ADDITIONAL constraints on top of the blanket gate.
const PRIVATE = [authGuard, approvedGuard] as const;

/**
 * The set page's equip flow (`equipInto` + `equipSlot`) still needs the
 * on-foot list with its equip controls, so a plain browse is a preset of the Codex browse page (concept 2026-10-29, b3).
 */
export function fpsEquipMode(): boolean {
  const nav = inject(Router).currentNavigation();
  return !!nav?.extractedUrl.queryParamMap.get('equipInto');
}

/**
 * The '' → verse and '**' → verse string redirects are RELATIVE on purpose:
 * Angular keeps the incoming query + fragment for a relative `redirectTo`.
 * Never prefix the target with `/` — an absolute string redirect drops the
 * query. Pinned in app.routes.spec.ts (AUD-144). Old aliases (news, hangar,
 * codex/set, tools/extension, ...) are NOT bridged any more (alpha cleanup,
 * concept 2026-10-30): they fall through to '**'.
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'verse',
  },
  {
    path: 'login',
    data: { layout: 'cinematic' },
    canActivate: [publicOnlyGuard],
    loadComponent: () => import('./auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'handoff',
    data: { layout: 'plain' },
    loadComponent: () => import('./core/handoff/handoff.component').then((m) => m.HandoffComponent),
  },
  {
    // Public surface — bare chrome (PublicLayoutComponent), reachable
    // signed-out. Legal requirement (imprint/privacy) plus /about (login-card
    // trust link, anti-AV-phishing heuristic). Deliberately NOT nested under
    // the gated shell parent below.
    path: '',
    loadComponent: () =>
      import('./shell/public-layout.component').then((m) => m.PublicLayoutComponent),
    children: [
      {
        path: 'about',
        data: { layout: 'content' },
        loadComponent: () => import('./legal/about.component').then((m) => m.AboutComponent),
      },
      {
        path: 'legal/privacy',
        data: { layout: 'plain' },
        loadComponent: () => import('./legal/privacy.component').then((m) => m.PrivacyComponent),
      },
      {
        path: 'legal/imprint',
        data: { layout: 'plain' },
        loadComponent: () => import('./legal/imprint.component').then((m) => m.ImprintComponent),
      },
      {
        // Where an invite / password-reset mail lands (feedback d93ddb05).
        // Ungated on purpose: the session such a link hands over may not be
        // approved yet, and the page must also render with NO session at all
        // (used-up or expired link) to offer a fresh mail.
        path: 'set-password',
        data: { layout: 'cinematic' },
        loadComponent: () =>
          import('./auth/set-password.component').then((m) => m.SetPasswordComponent),
      },
      {
        // A shared loadout behind its link token (feedback cf0ddf7d phase 2).
        // Public BY DESIGN — "anyone holding the link can view it, including
        // unregistered users" — so it lives on this ungated layout. The token
        // in the URL is the entire authorization; `get_shared_loadout()` is
        // the only thing `anon` can reach in the hangar schema, it projects
        // four fields, and it returns nothing for a revoked link.
        path: 'shared/loadout/:token',
        data: { layout: 'content' },
        loadComponent: () =>
          import('./social/shared-loadout.component').then((m) => m.SharedLoadoutComponent),
      },
      {
        // A hangar loadout shared via the Holotable "Teilen" popover (concept
        // hg6-*, wave 1.5 user decision 3: peek without login, adopt with
        // login). Same public-by-design reasoning as `shared/loadout/:token`
        // above — the token in the URL is the entire authorization,
        // `peek_shared_loadout()` is the only thing `anon` can reach here.
        // Deliberately NOT under `hangar/...` despite the path segment: those
        // routes sit behind the gated shell's `canActivateChild`, which would
        // bounce a signed-out recipient before this page ever renders.
        path: 'hangar/shared/:token',
        data: { layout: 'content' },
        loadComponent: () =>
          import('./hangar/hangar-shared-loadout.component').then((m) => m.HangarSharedLoadoutComponent),
      },
      {
        // A shared Kartograph badge (Verse star map, friend badge). Public BY
        // DESIGN: rank, patch and star count travel in the query string — no
        // user id, no account lookup — and the constellation shape comes from
        // the public verse_constellations table.
        path: 'badge/kartograph',
        data: { layout: 'cinematic' },
        loadComponent: () =>
          import('./verse/starmap/kartograph-badge.component').then((m) => m.KartographBadgeComponent),
      },
      {
        // Where `approvedGuard` sends a session whose approval it could not
        // read (see that guard + AccessUnavailableComponent). It MUST stay
        // on this ungated layout: gated, it would be bounced by the very
        // guard that routed here, and `/login` is no good either —
        // `publicOnlyGuard` sends an authenticated visitor straight back
        // into the gated routes, i.e. a redirect loop.
        path: 'unavailable',
        data: { layout: 'cinematic' },
        loadComponent: () =>
          import('./auth/access-unavailable.component').then((m) => m.AccessUnavailableComponent),
      },
    ],
  },
  {
    // The shared shell — gated by default (see PRIVATE / canActivateChild
    // note above). Every child below requires auth + approval unless it
    // moved to the public layout instead.
    path: '',
    loadComponent: () => import('./shell/shell.component').then((m) => m.ShellComponent),
    canActivateChild: [...PRIVATE],
    children: [
      {
        // The Verse hub (concept 2026-10-08-verse-hub): Verse News, the patch
        // centre and the Starscape gallery merged into ONE tab. The whole tab
        // sits behind the Verse β switch (BetaService) — switched off, every
        // area renders the legacy component it replaced; one backend.
        path: 'verse',
        loadChildren: () => import('./verse/verse.routes').then((m) => m.VERSE_ROUTES),
      },
      // The two bridges installed apps still open (concept 2026-10-30): the
      // browser extension hands imports to /hangar/import and the Starscape
      // tray opens /starscape. Both sources already call the new paths; drop
      // these once those releases are out. Relative, so the query survives.
      { path: 'hangar/import', pathMatch: 'full', redirectTo: 'hq/hangar/import' },
      { path: 'starscape', pathMatch: 'full', redirectTo: 'verse/gallery' },
      {
        // Codex front door = "the composed depth-field landing": Archive
        // Terminal poly-search + ICH/MEINE-FLOTTE hero panels + WELT lanes.
        path: 'codex',
        data: { layout: 'cinematic' },
        pathMatch: 'full',
        loadComponent: () =>
          import('./codex/codex-landing.component').then((m) => m.CodexLandingComponent),
      },
      {
        // Index mode — the power-user escape hatch. The original filter-list
        // (kind tabs + all facets + result grid + load-more + compare tray),
        // reachable one click from the Bridge. Static segment placed BEFORE
        // codex/:kind/:className so it is never consumed by the :kind wildcard.
        path: 'codex/index',
        data: { layout: 'tool' },
        loadComponent: () =>
          import('./codex/codex-browse.component').then((m) => m.CodexBrowseComponent),
      },
      {
        path: 'codex/blueprint/:className',
        data: { layout: 'content' },
        loadComponent: () =>
          import('./codex/blueprint-detail.component').then((m) => m.BlueprintDetailComponent),
      },
      {
        // FPS / on-foot equipment Codex section (#251) — curated weapons +
        // armor, each linking to the EXISTING codex/:kind/:className detail.
        // Static segment placed BEFORE codex/:kind/:className so it is never
        // consumed by the :kind wildcard.
        path: 'codex/fps',
        canMatch: [fpsEquipMode],
        data: { layout: 'tool' },
        loadComponent: () =>
          import('./codex/fps-list.component').then((m) => m.FpsListComponent),
      },
      {
        // Keybindings reference — the complete default action profile for the
        // current build. Static segment placed BEFORE codex/:kind so it is not
        // consumed by the :kind wildcard.
        path: 'codex/keybinds',
        data: { layout: 'tool' },
        loadComponent: () =>
          import('./codex/keybinds.component').then((m) => m.KeybindsComponent),
      },
      {
        // Shell beta: the list is the parent and `:id` a routed overlay child
        // (overlay from a card click, page on a direct load). Beta off falls
        // through to the two flat routes below.
        path: 'codex/upcoming',
        canMatch: [shellBetaOn],
        data: { layout: 'tool', category: 'upcoming' },
        loadComponent: () =>
          import('./codex/upcoming-route.component').then((m) => m.UpcomingRouteComponent),
        children: [
          {
            path: ':id',
            data: { layout: 'overlay', [OVERLAY_ROUTE_DATA]: true },
            loadComponent: () =>
              import('./codex/upcoming-detail.component').then((m) => m.UpcomingDetailComponent),
          },
        ],
      },
      {
        // Upcoming Ships — the diff between the public RSI ship-matrix and our
        // datamined game data (edge fn rsi-upcoming-ships). No longer a page of
        // its own: it is a CATEGORY of the Codex index, so this path just opens
        // the index with that category preselected. Kept as a route (not a
        // redirect) so the Verse-News CTA and existing bookmarks keep a stable
        // url. Static segment placed BEFORE codex/:kind/:className so it is not
        // consumed by the :kind wildcard.
        path: 'codex/upcoming',
        data: { layout: 'tool', category: 'upcoming' },
        loadComponent: () =>
          import('./codex/codex-browse.component').then((m) => m.CodexBrowseComponent),
      },
      {
        // One announced ship — the Codex's own page for a hull that has no
        // game data yet (#130). Every "Auf dem Reissbrett" tile lands HERE
        // first; the RSI pledge page is a secondary link on it, not the
        // destination. `:id` is the RSI ship-matrix id from the feed. Sits
        // after the static `codex/upcoming` (a leaf route only matches when it
        // consumes the whole url, so the two never shadow each other) and
        // before `codex/:kind/:className`.
        path: 'codex/upcoming/:id',
        data: { layout: 'overlay' },
        loadComponent: () =>
          import('./codex/upcoming-detail.component').then((m) => m.UpcomingDetailComponent),
      },
      {
        path: 'codex/:kind/:className',
        data: { layout: 'content' },
        loadComponent: () =>
          import('./codex/codex-detail.component').then((m) => m.CodexDetailComponent),
      },
      {
        // HQ — the personal area (concept 2026-10-08): Übersicht, Hangar
        // (ships + variants), Spind (FPS role sets), Einsätze (ops, shell).
        // The HqShell renders the category tabs + the Nachschub button around
        // the outlet. Gated by the shell's canActivateChild like every child;
        // all data stays RLS self-only.
        path: 'hq',
        loadComponent: () => import('./hq/hq-shell.component').then((m) => m.HqShellComponent),
        children: [
          {
            path: '',
            data: { layout: 'cinematic' },
            pathMatch: 'full',
            loadComponent: () =>
              import('./hq/hq-overview.component').then((m) => m.HqOverviewComponent),
          },
          {
            path: 'hangar',
            data: { layout: 'tool', section: 'hangar' },
            loadComponent: () =>
              import('./hangar/hangar-dashboard.component').then((m) => m.HangarDashboardComponent),
          },
          {
            // Review/confirm screen for the browser-extension hangar handover
            // (browser-extension/). Static segment BEFORE hangar/:id so
            // "import" is never read as a ship id; the payload arrives via
            // postMessage from the extension's content script.
            path: 'hangar/import',
            data: { layout: 'tool' },
            loadComponent: () =>
              import('./hangar/hangar-import-page.component').then((m) => m.HangarImportPageComponent),
          },
          {
            path: 'hangar/:id',
            data: { layout: 'content' },
            loadComponent: () =>
              import('./hangar/hangar-ship-detail.component').then((m) => m.HangarShipDetailComponent),
          },
          {
            path: 'locker',
            data: { layout: 'tool', section: 'locker' },
            loadComponent: () =>
              import('./hangar/hangar-dashboard.component').then((m) => m.HangarDashboardComponent),
          },
          {
            // The on-foot set editor (T1). The component still lives under
            // codex/set/ — it renders codex data — but the set is personal.
            path: 'locker/:id',
            data: { layout: 'content' },
            loadComponent: () =>
              import('./codex/set/codex-set.component').then((m) => m.CodexSetComponent),
          },
          {
            path: 'ops',
            data: { layout: 'tool' },
            loadComponent: () => import('./hq/hq-ops.component').then((m) => m.HqOpsComponent),
          },
        ],
      },
      {
        // Apps hub (concept 2026-10-30): one overview of the three companion
        // apps; each lives under /apps/<name>.
        path: 'apps',
        pathMatch: 'full',
        data: { layout: 'content' },
        loadComponent: () => import('./desktop/apps-hub.component').then((m) => m.AppsHubComponent),
      },
      {
        // Data Upload page (collaborator-gated); bundle history is merged in.
        path: 'apps/uploader',
        data: { layout: 'tool' },
        canActivate: [roleGuard('admin', 'collaborator')],
        loadComponent: () =>
          import('./desktop/desktop-download.component').then((m) => m.DesktopDownloadComponent),
      },
      {
        // Starscape download surface for ANY invited user (viewer+): the
        // channel picker self-hides for viewers -> stable-only.
        path: 'apps/starscape',
        data: { layout: 'content' },
        loadComponent: () =>
          import('./desktop/download.component').then((m) => m.DownloadComponent),
      },
      {
        // OAuth-callback endpoint for the Electron loopback flow. Role-gated
        // INSIDE the component (so unauthenticated users land on /login with a
        // redirect back here, instead of bouncing silently to /news) — the
        // blanket gate above already covers the auth+approval part.
        path: 'apps/uploader/auth',
        data: { layout: 'cinematic' },
        loadComponent: () =>
          import('./desktop/desktop-auth.component').then((m) => m.DesktopAuthComponent),
      },
      {
        // Legacy alias of apps/uploader/auth: installed uploader binaries call
        // /uploader/auth until the next uploader release (only /desktop/auth
        // was dropped).
        path: 'uploader/auth',
        data: { layout: 'cinematic' },
        loadComponent: () =>
          import('./desktop/desktop-auth.component').then((m) => m.DesktopAuthComponent),
      },
      {
        path: 'admin',
        data: { layout: 'tool' },
        canActivate: [roleGuard('admin')],
        loadComponent: () => import('./admin/admin.component').then((m) => m.AdminComponent),
      },
      {
        // The admin hub (beta shell): the merged "Admin" main-nav entry lands
        // here — a cinematic main page with tiles to the admin pages.
        path: 'admin/hub',
        data: { layout: 'cinematic' },
        canActivate: [roleGuard('admin')],
        loadComponent: () => import('./admin/admin-hub.component').then((m) => m.AdminHubComponent),
      },
      {
        // The page is presented as "Integrations" since admin feedback 85477aaa
        // (API tokens are just one integration on it). The path stays as-is so
        // existing links/bookmarks keep resolving; /admin/integrations is the
        // name-matching alias.
        path: 'admin/api-tokens',
        data: { layout: 'tool' },
        canActivate: [roleGuard('admin')],
        loadComponent: () =>
          import('./admin/api-tokens/api-tokens.component').then((m) => m.ApiTokensComponent),
      },
      {
        path: 'admin/telemetry',
        data: { layout: 'content' },
        canActivate: [roleGuard('admin')],
        loadComponent: () =>
          import('./admin/telemetry-stats.component').then((m) => m.TelemetryStatsComponent),
      },
      {
        path: 'admin/translations',
        data: { layout: 'content' },
        canActivate: [roleGuard('admin')],
        loadComponent: () =>
          import('./admin/translations/translations.component').then((m) => m.AdminTranslationsComponent),
      },
      {
        path: 'admin/feedback',
        data: { layout: 'tool' },
        canActivate: [roleGuard('admin')],
        loadComponent: () =>
          import('./admin/feedback/admin-feedback.component').then((m) => m.AdminFeedbackComponent),
      },
      {
        path: 'concept/:id',
        data: { layout: 'tool' },
        canActivate: [roleGuard('admin')],
        loadComponent: () =>
          import('./admin/concepts/concept-page.component').then((m) => m.ConceptPageComponent),
      },
      {
        path: 'settings',
        data: { layout: 'content' },
        loadComponent: () =>
          import('./settings/settings.component').then((m) => m.SettingsComponent),
      },
      {
        // Friends: the social graph (requests, friends, blocked). Sits next to
        // /settings because that is where the account-scoped surfaces live and
        // where both entry points (account menu, settings card) point.
        path: 'friends',
        data: { layout: 'content' },
        loadComponent: () =>
          import('./social/friends.component').then((m) => m.FriendsComponent),
      },
      {
        // Install + privacy page for the hangar-import browser extension.
        path: 'apps/extension',
        data: { layout: 'content' },
        loadComponent: () =>
          import('./tools/extension-install.component').then((m) => m.ExtensionInstallComponent),
      },
      {
        // "What's New" — release notes from CHANGELOG.md.
        path: 'release-notes',
        data: { layout: 'content' },
        loadComponent: () =>
          import('./release-notes/release-notes.component').then((m) => m.ReleaseNotesComponent),
      },
    ],
  },
  {
    // Read-auth handoff for the SCC Electron app — open to ANY approved,
    // signed-in user. Placed as a top-level sibling to /login, OUTSIDE the
    // gated shell routes (the loopback callback path is /scc/callback, POST).
    // Access-control redesign (2026-08-05): approvedGuard added alongside
    // authGuard — a self-registered-but-unapproved account must not reach a
    // desktop-app auth handoff any more than it can reach the rest of the app.
    path: 'apps/starscape/connect',
    data: { layout: 'cinematic' },
    canActivate: [...PRIVATE],
    loadComponent: () =>
      import('./desktop/desktop-read-auth.component').then((m) => m.DesktopReadAuthComponent),
  },
  {
    // Legacy alias of apps/starscape/connect: installed Starscape binaries
    // call /desktop/connect until the next Starscape release.
    path: 'desktop/connect',
    data: { layout: 'cinematic' },
    canActivate: [...PRIVATE],
    loadComponent: () =>
      import('./desktop/desktop-read-auth.component').then((m) => m.DesktopReadAuthComponent),
  },
  { path: '**', redirectTo: 'verse' },
];
