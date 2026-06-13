import { Routes } from '@angular/router';
import { approvedGuard } from './auth/approved.guard';
import { authGuard } from './auth/auth.guard';
import { publicOnlyGuard } from './auth/public-only.guard';
import { roleGuard } from './auth/role.guard';

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
    path: '',
    loadComponent: () => import('./shell/shell.component').then((m) => m.ShellComponent),
    canActivate: [authGuard, approvedGuard],
    children: [
      {
        path: 'news',
        loadComponent: () => import('./news/news-list.component').then((m) => m.NewsListComponent),
      },
      {
        // Codex — viewer-accessible catalog. authGuard ONLY (no roleGuard):
        // every authenticated user, incl. role `viewer`, may browse it.
        path: 'codex',
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
        path: 'codex/:kind/:className',
        loadComponent: () =>
          import('./codex/codex-detail.component').then((m) => m.CodexDetailComponent),
      },
      {
        // Personal web hangar — like /codex viewer-accessible (authGuard via
        // parent); all data is RLS self-only.
        path: 'hangar',
        loadComponent: () =>
          import('./hangar/hangar-dashboard.component').then((m) => m.HangarDashboardComponent),
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
      {
        path: 'p4k',
        canActivate: [roleGuard('admin', 'collaborator')],
        loadComponent: () => import('./p4k/p4k-history.component').then((m) => m.P4kHistoryComponent),
      },
      {
        path: 'desktop',
        canActivate: [roleGuard('admin', 'collaborator')],
        loadComponent: () =>
          import('./desktop/desktop-download.component').then((m) => m.DesktopDownloadComponent),
      },
      {
        // OAuth-callback endpoint for the Electron loopback flow.
        // Auth-guarded but role-gated INSIDE the component (so unauthenticated
        // users land on /login with a redirect back here, instead of bouncing
        // silently to /news).
        path: 'desktop/auth',
        canActivate: [authGuard],
        loadComponent: () =>
          import('./desktop/desktop-auth.component').then((m) => m.DesktopAuthComponent),
      },
      {
        path: 'admin',
        canActivate: [roleGuard('admin')],
        loadComponent: () => import('./admin/admin.component').then((m) => m.AdminComponent),
      },
      {
        path: 'admin/api-tokens',
        canActivate: [roleGuard('admin')],
        loadComponent: () =>
          import('./admin/api-tokens/api-tokens.component').then((m) => m.ApiTokensComponent),
      },
      {
        path: 'profile',
        loadComponent: () => import('./profile/profile.component').then((m) => m.ProfileComponent),
      },
    ],
  },
  { path: '**', redirectTo: 'news' },
];
