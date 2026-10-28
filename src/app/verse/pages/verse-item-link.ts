import type { Params } from '@angular/router';

/** An item's link, split for `[routerLink]` (in-app) or `[href]` (external). */
export interface VerseItemLink {
  internal: boolean;
  path: string;
  query: Params | null;
}

export function verseItemLink(url: string | null): VerseItemLink | null {
  if (!url) return null;
  if (url.startsWith('/') && !url.startsWith('//')) {
    const u = new URL(url, 'https://x.invalid');
    const query: Params = {};
    u.searchParams.forEach((v, k) => (query[k] = v));
    return { internal: true, path: u.pathname, query: Object.keys(query).length ? query : null };
  }
  return /^https:\/\//.test(url) ? { internal: false, path: url, query: null } : null;
}
