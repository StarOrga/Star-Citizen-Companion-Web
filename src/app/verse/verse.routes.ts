import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { BetaService } from '../core/beta.service';
import { OVERLAY_ROUTE_DATA } from '../core/overlay-route-scroll';

/**
 * Shell beta (implement.md §12): "Meine Sternbilder" is a state of the star-map
 * panel, not a page - the old URL lands there with the toggle on. Beta off keeps
 * today's page.
 */
export const constellationsToStarmap: CanActivateFn = () =>
  inject(BetaService).isEnabled('shell')()
    ? inject(Router).createUrlTree(['/verse/explorer'], { queryParams: { view: 'constellations' } })
    : true;

/**
 * Children of `/verse` (concept 2026-10-08-verse-hub). Every path an
 * in-app digest item can carry (`/verse/patches/<line>`, `/verse/patches`,
 * `/verse/gallery?image=<id>`) resolves here.
 */
export const VERSE_ROUTES: Routes = [
  {
    path: '',
    data: { layout: 'cinematic' },
    pathMatch: 'full',
    loadComponent: () => import('./pages/verse-briefing.component').then((m) => m.VerseBriefingComponent),
  },
  {
    path: 'news',
    data: { layout: 'cinematic' },
    loadComponent: () => import('./pages/verse-news.component').then((m) => m.VerseNewsComponent),
    children: [
      {
        // Overlay over the stream when opened from it, full page on a direct
        // load - one route, one component (implement.md §9).
        path: ':id',
        data: { layout: 'content', [OVERLAY_ROUTE_DATA]: true },
        loadComponent: () => import('./pages/verse-news-item.component').then((m) => m.VerseNewsItemComponent),
      },
    ],
  },
  {
    // The board renders the dossier through its own outlet — one patch opens
    // as an overlay over the time stack, browser back closes it.
    path: 'patches',
    data: { layout: 'cinematic' },
    loadComponent: () => import('./pages/verse-patches.component').then((m) => m.VersePatchesComponent),
    children: [
      {
        // A routed overlay: opening/closing keeps the board's scroll (#245).
        path: ':line',
        data: { layout: 'content', [OVERLAY_ROUTE_DATA]: true },
        loadComponent: () =>
          import('../news/patch-dossier.component').then((m) => m.PatchDossierComponent),
      },
    ],
  },
  {
    path: 'gallery/constellations',
    data: { layout: 'cinematic' },
    canActivate: [constellationsToStarmap],
    loadComponent: () =>
      import('./starmap/my-constellations.component').then((m) => m.MyConstellationsComponent),
  },
  {
    path: 'gallery',
    data: { layout: 'cinematic' },
    loadComponent: () => import('./pages/verse-gallery.component').then((m) => m.VerseGalleryComponent),
    children: [
      {
        path: ':imageId',
        data: { layout: 'content', [OVERLAY_ROUTE_DATA]: true },
        loadComponent: () => import('./pages/verse-gallery-item.component').then((m) => m.VerseGalleryItemComponent),
      },
    ],
  },
  {
    path: 'explorer',
    data: { layout: 'cinematic' },
    loadChildren: () => import('./starmap/starmap.routes').then((m) => m.STARMAP_ROUTES),
  },
];
