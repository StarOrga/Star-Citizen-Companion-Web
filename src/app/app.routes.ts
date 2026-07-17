import { Routes } from '@angular/router';
import { approvedGuard } from './auth/approved.guard';
import { authGuard } from './auth/auth.guard';
import { publicOnlyGuard } from './auth/public-only.guard';
import { publicOrApprovedGuard } from './auth/public-or-approved.guard';
import { roleGuard } from './auth/role.guard';

// Guard policy (#131): the shell itself is PUBLIC — News, Codex, Release
// Notes and the 3D-print guide are browsable without login. Every private
// child names its guards EXPLICITLY (whitelist thinking: a new route is
// private unless deliberately left open). authGuard always precedes
// approvedGuard/roleGuard — both hang on RoleService.waitReady without a
// session, authGuard short-circuits to /login first.
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
    // The shared shell — PUBLIC since #131. Signed-out visitors get the
    // public nav + sign-in CTA; personal surfaces below carry their own guards.
    path: '',
    loadComponent: () => import('./shell/shell.component').then((m) => m.ShellComponent),
    children: [
      {
        // Public: Verse News feed (edge function aggregates public sources).
        path: 'news',
        loadComponent: () => import('./news/news-list.component').then((m) => m.NewsListComponent),
      },
      {
        // Public: Starscape wallpaper gallery (#133) — hotlinked RSI imagery
        // metadata, no hosted bytes. Aligned with the public-browsing model.
        path: 'starscape',
        loadComponent: () =>
          import('./starscape/starscape.component').then((m) => m.StarscapeComponent),
      },
      {
        // Codex landing = "The Bridge" (Slice 1). Scanner + focal hero + lanes.
        // Public read since #131 (RLS: codex_* tables allow anon SELECT).
        path: 'codex',
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
        // Keybindings reference — the complete default action profile for the
        // current build. Public; static segment placed BEFORE codex/:kind so it
        // is not consumed by the :kind wildcard.
        path: 'codex/keybinds',
        loadComponent: () =>
          import('./codex/keybinds.component').then((m) => m.KeybindsComponent),
      },
      {
        path: 'codex/:kind/:className',
        loadComponent: () =>
          import('./codex/codex-detail.component').then((m) => m.CodexDetailComponent),
      },
      {
        // Personal web hangar. The DASHBOARD route is reachable signed-out and
        // renders a benefits teaser + sign-in CTA for anonymous visitors
        // (#131); signed-in users pass the same invite check as the private
        // routes. All data is RLS self-only either way.
        path: 'hangar',
        canActivate: [publicOrApprovedGuard],
        loadComponent: () =>
          import('./hangar/hangar-dashboard.component').then((m) => m.HangarDashboardComponent),
      },
      {
        path: 'hangar/ship/:id',
        canActivate: [...PRIVATE],
        loadComponent: () =>
          import('./hangar/hangar-ship-detail.component').then((m) => m.HangarShipDetailComponent),
      },
      {
        path: 'hangar/loadout/:id',
        canActivate: [...PRIVATE],
        loadComponent: () =>
          import('./hangar/role-loadout-editor.component').then((m) => m.RoleLoadoutEditorComponent),
      },
      // Bundle History merged into the Data Upload page (/uploader). Keep the
      // old /p4k URL working for bookmarks/muscle-memory via a redirect.
      { path: 'p4k', pathMatch: 'full', redirectTo: 'uploader' },
      {
        path: 'uploader',
        canActivate: [...PRIVATE, roleGuard('admin', 'collaborator')],
        loadComponent: () =>
          import('./desktop/desktop-download.component').then((m) => m.DesktopDownloadComponent),
      },
      {
        // OAuth-callback endpoint for the Electron loopback flow.
        // Auth-guarded but role-gated INSIDE the component (so unauthenticated
        // users land on /login with a redirect back here, instead of bouncing
        // silently to /news).
        path: 'uploader/auth',
        canActivate: [authGuard],
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
        canActivate: [authGuard],
        loadComponent: () =>
          import('./desktop/desktop-auth.component').then((m) => m.DesktopAuthComponent),
      },
      // Legacy redirect: the page lived at /desktop before the rename to
      // /uploader. Keep bookmarks/muscle-memory working.
      { path: 'desktop', pathMatch: 'full', redirectTo: 'uploader' },
      {
        path: 'admin',
        canActivate: [...PRIVATE, roleGuard('admin')],
        loadComponent: () => import('./admin/admin.component').then((m) => m.AdminComponent),
      },
      {
        path: 'admin/api-tokens',
        canActivate: [...PRIVATE, roleGuard('admin')],
        loadComponent: () =>
          import('./admin/api-tokens/api-tokens.component').then((m) => m.ApiTokensComponent),
      },
      {
        path: 'admin/telemetry',
        canActivate: [...PRIVATE, roleGuard('admin')],
        loadComponent: () =>
          import('./admin/telemetry-stats.component').then((m) => m.TelemetryStatsComponent),
      },
      {
        path: 'admin/feedback',
        canActivate: [...PRIVATE, roleGuard('admin')],
        loadComponent: () =>
          import('./admin/feedback/admin-feedback.component').then((m) => m.AdminFeedbackComponent),
      },
      {
        path: 'settings',
        canActivate: [...PRIVATE],
        loadComponent: () =>
          import('./settings/settings.component').then((m) => m.SettingsComponent),
      },
      {
        // 3D-printing guidance (issue #79, Option 0) — a no-hosting info page:
        // links vetted external community tools, documents the print-prep
        // workflow. Serves ZERO CIG-derived geometry by design (EULA). Public.
        path: 'tools/3d-print',
        loadComponent: () =>
          import('./tools/print-guide.component').then((m) => m.PrintGuideComponent),
      },
      {
        // "What's New" — release notes from CHANGELOG.md. Static build asset,
        // public since #131 (fixes the signed-out dead click on the footer link).
        path: 'release-notes',
        loadComponent: () =>
          import('./release-notes/release-notes.component').then((m) => m.ReleaseNotesComponent),
      },
      {
        // Public trust/legal surface: a login-capable site without reachable
        // about/privacy/imprint pages matches phishing heuristics of AV
        // URL-reputation scanners. Deliberately unguarded and in sitemap.xml.
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
    ],
  },
  {
    // Read-auth handoff for the SCC Electron app — open to ANY signed-in user,
    // no approvedGuard (a self-registered viewer must not be signed out here).
    // authGuard alone: unauthenticated visitors land on /login with redirect
    // back here; the loopback callback path is /scc/callback (POST).
    // Placed as a top-level sibling to /login, OUTSIDE the guarded routes.
    path: 'desktop/connect',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./desktop/desktop-read-auth.component').then((m) => m.DesktopReadAuthComponent),
  },
  { path: '**', redirectTo: 'news' },
];
