import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';

/** The rank page: home of the ladder, the series, "Meine Sternbilder" and the 4K wallpaper. */
export const RANK_PAGE_URL = '/verse/explorer/rank';

/** The old "Meine Sternbilder" state of the star map (`?view=constellations`) now lives on the rank page. */
export const constellationsViewToRank: CanActivateFn = (route) =>
  route.queryParamMap.get('view') === 'constellations' ? inject(Router).parseUrl(RANK_PAGE_URL) : true;

/** Mounted by the Verse routes at `/verse/explorer`. */
export const STARMAP_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    data: { layout: 'cinematic' },
    canActivate: [constellationsViewToRank],
    loadComponent: () => import('./explorer-page.component').then((m) => m.ExplorerPageComponent),
  },
  {
    path: 'rank',
    data: { layout: 'cinematic' },
    loadComponent: () => import('./rank-page.component').then((m) => m.RankPageComponent),
  },
];
