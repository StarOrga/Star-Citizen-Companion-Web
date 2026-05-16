import { Routes } from '@angular/router';
import { authGuard } from './auth/auth.guard';
import { publicOnlyGuard } from './auth/public-only.guard';

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
    canActivate: [authGuard],
    children: [
      {
        path: 'news',
        loadComponent: () => import('./news/news-list.component').then((m) => m.NewsListComponent),
      },
      {
        path: 'p4k',
        loadComponent: () => import('./p4k/p4k-upload.component').then((m) => m.P4kUploadComponent),
      },
      {
        path: 'profile',
        loadComponent: () => import('./profile/profile.component').then((m) => m.ProfileComponent),
      },
    ],
  },
  { path: '**', redirectTo: 'news' },
];
