/*
 * Sammlung read model (pure). "Sammlung" = Blaupausen (collected), Ruf (no data source yet), news the user
 * collected (formerly "Lesezeichen") and up-voted gallery wallpapers. Finished missions go to Statistik, not here.
 */

export type SammlungKind = 'blueprint' | 'rep' | 'news' | 'gallery';

export interface SammlungEntry {
  readonly kind: SammlungKind;
  readonly id: string;
  readonly name: string | null;
}

/** Stock place that holds collected blueprints (same value as `PLACE_BLUEPRINTS` in item-path.service). */
export const BLUEPRINT_PLACE = 'Blueprints';

/** localStorage key of the old news bookmarks (the web's former "Merken"); copied into the account once. */
export const NEWS_FAVORITES_STORAGE_KEY = 'verse-companion.news.favorites';

/** Max news ids copied per call (the table caps a user at 500). */
export const NEWS_COPY_MAX = 500;

/**
 * Local news bookmarks (`localStorage` JSON array of ids) that still have to be copied into the account.
 * Unreadable JSON and non-string entries are ignored; ids the account already has are skipped; the result is
 * de-duplicated, trimmed to the id limit and capped.
 */
export function bookmarksToCopy(rawJson: string | null, already: ReadonlySet<string>): string[] {
  if (!rawJson) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of parsed) {
    if (typeof v !== 'string') continue;
    const id = v.trim();
    if (!id || id.length > 300 || seen.has(id) || already.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= NEWS_COPY_MAX) break;
  }
  return out;
}

/** Is a news item collected, given the account set (the only source of truth after the copy)? */
export function isCollected(kind: SammlungKind, id: string, sets: { news: ReadonlySet<string>; gallery: ReadonlySet<string> }): boolean {
  if (kind === 'news') return sets.news.has(id);
  if (kind === 'gallery') return sets.gallery.has(id);
  return false;
}
