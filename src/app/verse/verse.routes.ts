import { Routes } from '@angular/router';
import { VerseBetaArea } from './data/verse.models';

/** The β area a Verse route belongs to — read by the layout's β dock. */
export interface VerseRouteData {
  verseArea: VerseBetaArea;
}

/**
 * Children of `/verse` (concept 2026-10-08-verse-hub). Every path an
 * in-app digest item can carry (`/verse/patches/<line>`, `/verse/patches`,
 * `/verse/gallery?image=<id>`) resolves here.
 */
export const VERSE_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    data: { verseArea: 'briefing' } satisfies VerseRouteData,
    loadComponent: () => import('./pages/verse-briefing.component').then((m) => m.VerseBriefingComponent),
  },
  {
    path: 'news',
    data: { verseArea: 'news' } satisfies VerseRouteData,
    loadComponent: () => import('./pages/verse-news.component').then((m) => m.VerseNewsComponent),
  },
  {
    // The board renders the dossier through its own outlet — one patch opens
    // as an overlay over the time stack, browser back closes it.
    path: 'patches',
    data: { verseArea: 'patches' } satisfies VerseRouteData,
    loadComponent: () => import('./pages/verse-patches.component').then((m) => m.VersePatchesComponent),
    children: [
      {
        path: ':line',
        loadComponent: () =>
          import('../news/patch-dossier.component').then((m) => m.PatchDossierComponent),
      },
    ],
  },
  {
    path: 'gallery',
    pathMatch: 'full',
    data: { verseArea: 'gallery' } satisfies VerseRouteData,
    loadComponent: () => import('./pages/verse-gallery.component').then((m) => m.VerseGalleryComponent),
  },
  {
    path: 'gallery/constellations',
    data: { verseArea: 'gallery' } satisfies VerseRouteData,
    loadComponent: () =>
      import('./starmap/my-constellations.component').then((m) => m.MyConstellationsComponent),
  },
  {
    path: 'explorer',
    data: { verseArea: 'starmap' } satisfies VerseRouteData,
    loadChildren: () => import('./starmap/starmap.routes').then((m) => m.STARMAP_ROUTES),
  },
];
