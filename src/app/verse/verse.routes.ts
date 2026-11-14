import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { PRELOAD_ROUTE_DATA } from '../core/idle-preloading.strategy';
import { OVERLAY_ROUTE_DATA } from '../core/overlay-route-scroll';
import { verseFlightResolver } from './shared/verse-flight';

/** The hub ⇄ subpage flight (shared/verse-flight.ts) starts in this resolver on the five frame routes. */
const flight = { verseFlight: verseFlightResolver };

/**
 * "Meine Sternbilder" moved to the rank page (note #3, 2026-11-13): the old
 * URL lands there, whichever beta is on.
 */
export const constellationsToStarmap: CanActivateFn = () => inject(Router).parseUrl('/verse/explorer/rank');

/**
 * Children of `/verse` (concept 2026-10-08-verse-hub). Every path an
 * in-app digest item can carry (`/verse/patches/<line>`, `/verse/patches`,
 * `/verse/gallery?image=<id>`) resolves here.
 */
export const VERSE_ROUTES: Routes = [
  {
    path: '',
    data: { layout: 'cinematic', [PRELOAD_ROUTE_DATA]: true },
    resolve: flight,
    pathMatch: 'full',
    loadComponent: () => import('./pages/verse-briefing.component').then((m) => m.VerseBriefingComponent),
  },
  {
    path: 'news',
    data: { layout: 'cinematic' },
    resolve: flight,
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
    resolve: flight,
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
    children: [],
  },
  {
    path: 'gallery',
    data: { layout: 'cinematic' },
    resolve: flight,
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
    resolve: flight,
    loadChildren: () => import('./starmap/starmap.routes').then((m) => m.STARMAP_ROUTES),
  },
];
