import { Injectable, computed, inject } from '@angular/core';
import { VerseApiService } from '../data/verse-api.service';
import { STARS_PER_PATCH, badgeQuery, defaultPatch, rankProgressOf } from './starmap.model';

/** Router target of a page: commands + query params for `routerLink`. */
export interface BadgeLink {
  readonly commands: readonly string[];
  readonly queryParams: Record<string, string> | null;
}

/**
 * Where the account menu's "Kartograph-Abzeichen" entry leads (shell beta,
 * "lost pages surfaced"). With the star-map state loaded and the Kartograph rank
 * unlocked it is the reader's own public badge page (rank, newest patch, stars -
 * the same query the star map's share button builds); otherwise the star map,
 * where the badge is earned and shared. It never loads anything itself.
 */
@Injectable({ providedIn: 'root' })
export class OwnBadgeService {
  private readonly api = inject(VerseApiService);

  readonly link = computed<BadgeLink>(() => {
    const st = this.api.explorer();
    const p = st ? defaultPatch(st) : null;
    const tier = st ? rankProgressOf(st).tier : 0;
    if (!st || !p || tier < 1) return { commands: ['/verse', 'explorer'], queryParams: null };
    const badge = { rank: tier, patch: p.patchLine, stars: Math.min(STARS_PER_PATCH, p.starCount), sun: p.sun };
    return { commands: ['/badge', 'kartograph'], queryParams: badgeQuery(badge) };
  });
}
