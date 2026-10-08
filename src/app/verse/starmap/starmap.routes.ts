import { Routes } from '@angular/router';

/** Mounted by the Verse routes at `/verse/explorer`. */
export const STARMAP_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./explorer-page.component').then((m) => m.ExplorerPageComponent),
  },
];
