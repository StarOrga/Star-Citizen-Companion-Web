// Which comm-links get their hero resolved from the page's own og:image, and
// what that does to the media list. Pure — no fetch, no Deno APIs — so the
// policy can be pinned by tests while index.ts owns the I/O around it.
//
// Why this exists at all: the wiki API's `images` array is the article's media
// in DOCUMENT order, not an editorial pick, so `images[0]` is the hero only by
// coincidence. See `.claude/deep-knowledge/verse-news-sources.md` for the case
// that broke (a lower third and two divider rules ahead of the banner).

/** The slice of a feed item this module needs. */
export interface HeroCandidate {
  url: string;
  publishedAt: string;
  images?: string[];
}

/**
 * Which entries are worth an og:image fetch.
 *
 * Two sets, unioned and de-duplicated:
 *  - the newest `lookahead` on-site entries, whose hero must be RIGHT because
 *    they are the ones a reader sees, and
 *  - up to `fallbackCap` entries with no image at all, anywhere in the feed —
 *    the historic last-resort backfill, which is the only thing standing
 *    between a Roadmap Roundup and a blank tile.
 *
 * Off-site urls are excluded: we only scrape RSI, and only RSI-hosted image
 * urls are accepted back out of the page.
 */
export function heroOgTargets<T extends HeroCandidate>(
  items: readonly T[],
  base: string,
  lookahead: number,
  fallbackCap: number,
): T[] {
  const onSite = items.filter((it) => it.url.startsWith(base));
  const newest = [...onSite]
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, lookahead);
  const imageless = onSite.filter((it) => !it.images?.length).slice(0, fallbackCap);
  return [...new Set([...newest, ...imageless])];
}

/**
 * Put the editorial hero in front of the media list, keeping the rest.
 *
 * Promotion, not replacement: everything behind it still feeds the slideshow,
 * the wallpaper capture and the image cache. A hero already in the list is
 * moved rather than duplicated — otherwise the same picture would occupy two
 * slideshow slots on every article whose first image WAS the right one.
 */
export function promoteHero(images: string[] | undefined, hero: string, cap: number): string[] {
  const rest = (images ?? []).filter((u) => u !== hero);
  return [hero, ...rest].slice(0, cap);
}
