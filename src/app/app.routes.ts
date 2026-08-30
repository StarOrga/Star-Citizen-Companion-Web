import { Routes } from '@angular/router';
import { approvedGuard } from './auth/approved.guard';
import { authGuard } from './auth/auth.guard';
import { publicOnlyGuard } from './auth/public-only.guard';
import { roleGuard } from './auth/role.guard';

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

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'news',
  },
  {
    path: 'login',
    canActivate: [publicOnlyGuard],
    loadComponent: () => import('./auth/login.component').then((m) => m.LoginComponent),
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
        loadComponent: () => import('./legal/about.component').then((m) => m.AboutComponent),
      },
      {
        path: 'legal/privacy',
        loadComponent: () => import('./legal/privacy.component').then((m) => m.PrivacyComponent),
      },
      {
        path: 'legal/imprint',
        loadComponent: () => import('./legal/imprint.component').then((m) => m.ImprintComponent),
      },
      {
        // Where `approvedGuard` sends a session whose approval it could not
        // read (see that guard + AccessUnavailableComponent). It MUST stay
        // on this ungated layout: gated, it would be bounced by the very
        // guard that routed here, and `/login` is no good either —
        // `publicOnlyGuard` sends an authenticated visitor straight back
        // into the gated routes, i.e. a redirect loop.
        path: 'unavailable',
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
        path: 'news',
        loadComponent: () => import('./news/news-list.component').then((m) => m.NewsListComponent),
      },
      {
        // The patch depth lives on its own page since the 2026-08-20 rethink:
        // on the landing page it cost 2,019 px above the first news article.
        path: 'news/patches',
        loadComponent: () =>
          import('./news/patch-board.component').then((m) => m.PatchBoardComponent),
      },
      {
        path: 'starscape',
        loadComponent: () =>
          import('./starscape/starscape.component').then((m) => m.StarscapeComponent),
      },
      {
        // Codex front door = "the composed depth-field landing": Archive
        // Terminal poly-search + ICH/MEINE-FLOTTE hero panels + WELT lanes.
        path: 'codex',
        pathMatch: 'full',
        loadComponent: () =>
          import('./codex/codex-landing.component').then((m) => m.CodexLandingComponent),
      },
      {
        // The previous front door ("The Bridge") — kept reachable for
        // comparison/rollback while the new landing is verified (not deleted).
        // Static segment placed BEFORE codex/:kind/:className so it is never
        // consumed by the :kind wildcard.
        path: 'codex/bridge',
        pathMatch: 'full',
        loadComponent: () =>
          import('./codex/codex-bridge.component').then((m) => m.CodexBridgeComponent),
      },
      {
        // Index mode — the power-user escape hatch. The original filter-list
        // (kind tabs + all facets + result grid + load-more + compare tray),
        // reachable one click from the Bridge. Static segment placed BEFORE
        // codex/:kind/:className so it is never consumed by the :kind wildcard.
        path: 'codex/index',
        loadComponent: () =>
          import('./codex/codex-list.component').then((m) => m.CodexListComponent),
      },
      {
        // Blueprint routes — must come BEFORE codex/:kind/:className so the
        // static "blueprint" segment is not consumed by the :kind wildcard.
        path: 'codex/blueprint',
        loadComponent: () =>
          import('./codex/blueprint-list.component').then((m) => m.BlueprintListComponent),
      },
      {
        path: 'codex/blueprint/:className',
        loadComponent: () =>
          import('./codex/blueprint-detail.component').then((m) => m.BlueprintDetailComponent),
      },
      {
        // FPS / on-foot equipment Codex section (#251) — curated weapons +
        // armor, each linking to the EXISTING codex/:kind/:className detail.
        // Static segment placed BEFORE codex/:kind/:className so it is never
        // consumed by the :kind wildcard.
        path: 'codex/fps',
        loadComponent: () =>
          import('./codex/fps-list.component').then((m) => m.FpsListComponent),
      },
      {
        // Keybindings reference — the complete default action profile for the
        // current build. Static segment placed BEFORE codex/:kind so it is not
        // consumed by the :kind wildcard.
        path: 'codex/keybinds',
        loadComponent: () =>
          import('./codex/keybinds.component').then((m) => m.KeybindsComponent),
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
        data: { category: 'upcoming' },
        loadComponent: () =>
          import('./codex/codex-list.component').then((m) => m.CodexListComponent),
      },
      {
        path: 'codex/:kind/:className',
        loadComponent: () =>
          import('./codex/codex-detail.component').then((m) => m.CodexDetailComponent),
      },
      {
        // Personal web hangar. Access-control redesign (2026-08-05): the
        // former signed-out teaser (`publicOrApprovedGuard`) is gone — the
        // blanket `canActivateChild` gate above already bounces anonymous
        // visitors to /login before this route is reached, so hangar is now a
        // plain private route like the rest. All data stays RLS self-only.
        path: 'hangar',
        loadComponent: () =>
          import('./hangar/hangar-dashboard.component').then((m) => m.HangarDashboardComponent),
      },
      {
        // Review/confirm screen for the browser-extension hangar handover
        // (browser-extension/). Static segment placed BEFORE hangar/ship/:id
        // for clarity; the payload arrives via postMessage from the
        // extension's content script, never over the network.
        path: 'hangar/import',
        loadComponent: () =>
          import('./hangar/hangar-import-page.component').then((m) => m.HangarImportPageComponent),
      },
      {
        path: 'hangar/ship/:id',
        loadComponent: () =>
          import('./hangar/hangar-ship-detail.component').then((m) => m.HangarShipDetailComponent),
      },
      {
        path: 'hangar/loadout/:id',
        loadComponent: () =>
          import('./hangar/role-loadout-editor.component').then((m) => m.RoleLoadoutEditorComponent),
      },
      // Bundle History merged into the Data Upload page (/uploader). Keep the
      // old /p4k URL working for bookmarks/muscle-memory via a redirect.
      { path: 'p4k', pathMatch: 'full', redirectTo: 'uploader' },
      {
        path: 'uploader',
        canActivate: [roleGuard('admin', 'collaborator')],
        loadComponent: () =>
          import('./desktop/desktop-download.component').then((m) => m.DesktopDownloadComponent),
      },
      {
        // Minimal download surface for ANY invited user (viewer+). No bundle
        // history; the channel picker self-hides for viewers → stable-only.
        path: 'download',
        loadComponent: () =>
          import('./desktop/download.component').then((m) => m.DownloadComponent),
      },
      {
        // OAuth-callback endpoint for the Electron loopback flow. Role-gated
        // INSIDE the component (so unauthenticated users land on /login with a
        // redirect back here, instead of bouncing silently to /news) — the
        // blanket gate above already covers the auth+approval part.
        path: 'uploader/auth',
        loadComponent: () =>
          import('./desktop/desktop-auth.component').then((m) => m.DesktopAuthComponent),
      },
      {
        // Legacy OAuth-callback alias. Uploader binaries built BEFORE the
        // /desktop→/uploader rename (#73) — e.g. the shipped v0.4.x–v0.6.x —
        // open `/desktop/auth?cb=…&state=…`. The `pathMatch: 'full'` /desktop
        // redirect below does NOT cover this sub-path, so without this entry
        // the URL falls through to the '**' wildcard and silently lands on
        // /news — observed as "connecting the uploader only opens the start
        // page, not signed in". Render the SAME component so those binaries
        // keep working without a reinstall.
        //
        // NOTE: binaries ≤ v0.4.5 also predate the form-POST / Private-Network
        // handoff fix (their loopback only `JSON.parse`s a fetch() body), so
        // they still fail at the token handoff even WITH this route — those
        // genuinely need a reinstall of the current build.
        path: 'desktop/auth',
        loadComponent: () =>
          import('./desktop/desktop-auth.component').then((m) => m.DesktopAuthComponent),
      },
      // Legacy redirect: the page lived at /desktop before the rename to
      // /uploader. Keep bookmarks/muscle-memory working.
      { path: 'desktop', pathMatch: 'full', redirectTo: 'uploader' },
      {
        path: 'admin',
        canActivate: [roleGuard('admin')],
        loadComponent: () => import('./admin/admin.component').then((m) => m.AdminComponent),
      },
      {
        // The page is presented as "Integrations" since admin feedback 85477aaa
        // (API tokens are just one integration on it). The path stays as-is so
        // existing links/bookmarks keep resolving; /admin/integrations is the
        // name-matching alias.
        path: 'admin/api-tokens',
        canActivate: [roleGuard('admin')],
        loadComponent: () =>
          import('./admin/api-tokens/api-tokens.component').then((m) => m.ApiTokensComponent),
      },
      { path: 'admin/integrations', pathMatch: 'full', redirectTo: 'admin/api-tokens' },
      {
        path: 'admin/telemetry',
        canActivate: [roleGuard('admin')],
        loadComponent: () =>
          import('./admin/telemetry-stats.component').then((m) => m.TelemetryStatsComponent),
      },
      {
        path: 'admin/feedback',
        canActivate: [roleGuard('admin')],
        loadComponent: () =>
          import('./admin/feedback/admin-feedback.component').then((m) => m.AdminFeedbackComponent),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./settings/settings.component').then((m) => m.SettingsComponent),
      },
      {
        // Install + privacy page for the hangar-import browser extension.
        // Gated by the blanket rule now (access-control redesign): the
        // install instructions reference an authenticated feature, so this no
        // longer needs to be readable signed-out.
        path: 'tools/extension',
        loadComponent: () =>
          import('./tools/extension-install.component').then((m) => m.ExtensionInstallComponent),
      },
      {
        // "What's New" — release notes from CHANGELOG.md.
        path: 'release-notes',
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
    path: 'desktop/connect',
    canActivate: [...PRIVATE],
    loadComponent: () =>
      import('./desktop/desktop-read-auth.component').then((m) => m.DesktopReadAuthComponent),
  },
  { path: '**', redirectTo: 'news' },
];
