/**
 * Responsive-source helpers for news artwork.
 *
 * Two url families reach the client and each advertises its sizes differently:
 *
 * 1. **Our `news-images` cache**, `…/<hash>/w<N>.<ext>`. The edge function
 *    (`fetch-verse-news`) decodes every source once and stores a ladder of
 *    genuinely different pixel widths — `w400`, `w800` and `w<top>`, where
 *    `<top>` is the source width capped at 1600. The *whole ladder is derivable
 *    from the top url*, which is the one the feed hands us:
 *
 *        rungs(top) = RUNG_WIDTHS.filter(w => w < top).concat(top)
 *
 *    Every entry is guaranteed to exist, and the advertised `<n>w` descriptor is
 *    the real decoded width — so the browser's pick is honest. `w0` is the
 *    reserved "single object, width unknown" case (a source we could not decode,
 *    mirrored verbatim); it gets no srcset at all.
 *
 * 2. **Everything else** — RSI's media CDN and the legacy `post`/`cover` pair
 *    still sitting in the bucket until the compaction backfill has run. Those
 *    keep the historic 500w/1140w pair.
 *
 * Why this file exists at all: the old srcset advertised `post 500w, cover 1140w`
 * for cached urls, but the edge function had stored the SAME full-resolution
 * bytes under both names — so a 320 px tile happily "picked the small one" and
 * downloaded ~880 KB. Truthful descriptors over real variants are the fix.
 *
 * `RUNG_WIDTHS` / `MAX_VARIANT_WIDTH` mirror
 * `supabase/functions/fetch-verse-news/image-variants.ts` — the producer. They
 * are duplicated rather than imported because that module lives in the Deno
 * function tree, outside the app's compilation unit; `news-image-variants.spec.ts`
 * pins the contract from this side.
 */

/** Fixed intermediate rungs, ascending. Must match the edge function's ladder. */
export const RUNG_WIDTHS = [400, 800] as const;

/** Hard ceiling for the largest stored variant. Must match the edge function. */
export const MAX_VARIANT_WIDTH = 1600;

/** `…/<hash>/w<N>.<ext>` — our compacted variant scheme. */
const WIDTH_VARIANT_RE = /^(https?:\/\/.+\/)w(\d+)(\.[a-zA-Z0-9]+)$/;

/** Legacy 500w / 1140w descriptors for urls with no real variant ladder. */
const LEGACY_POST_WIDTH = 500;
const LEGACY_COVER_WIDTH = 1140;

/**
 * Swap the variant segment of an image url to a tile-sized one.
 *
 * Two url shapes are rewritable, both ending in `<dir>/<variant>.<ext>`:
 *  - RSI media CDN `https://media.robertsspaceindustries.com/<id>/<variant>.<ext>`
 *    — variants `post` (≤500w) / `cover` (≤1140w) preserve aspect ratio.
 *  - Our own pre-compaction `news-images` cache `…/<hash>/{post,cover}.<ext>`.
 * The original extension MUST be kept (a PNG source 404s as `.jpg`).
 *
 * Any other url — notably the signed `https://robertsspaceindustries.com/i/<sha1>/…`
 * proxy (already tile-sized, returns 400 if rewritten) — is returned unchanged.
 */
export function rsiVariant(url: string, target: 'post' | 'cover'): string {
  const media = /^(https:\/\/media\.robertsspaceindustries\.com\/[^/]+\/)[^/.]+(\.[a-zA-Z0-9]+)$/.exec(url);
  if (media) return `${media[1]}${target}${media[2]}`;
  const cached = /^(https?:\/\/.+\/)(?:post|cover)(\.[a-zA-Z0-9]+)$/.exec(url);
  if (cached) return `${cached[1]}${target}${cached[2]}`;
  return url;
}

/** The stored ladder implied by a top width, ascending. */
export function variantRungs(topWidth: number): number[] {
  if (topWidth <= 0) return [];
  return [...RUNG_WIDTHS.filter((w) => w < topWidth), topWidth];
}

interface ParsedVariant { base: string; top: number; ext: string; }

/** Split `…/<hash>/w<N>.<ext>`, or null when the url is not one of ours. */
export function parseVariantUrl(url: string): ParsedVariant | null {
  const m = WIDTH_VARIANT_RE.exec(url);
  if (!m) return null;
  const top = Number(m[2]);
  return Number.isFinite(top) ? { base: m[1], top, ext: m[3] } : null;
}

/**
 * Full-size width of the picture behind `url`, or `0` when it is not knowable.
 *
 * Consumers that judge an image by its pixel size need this. What a tile decodes
 * is whichever rung the browser picked for the slot, so a measurement read off
 * the element is scaled down by a factor the element itself cannot report — the
 * only honest reference is the width at which that url's picture exists in full.
 *
 * Our cache encodes it: `…/<hash>/w<N>.<ext>` stores its top rung at `N`. Every
 * other url returns `0` rather than a guess. `LEGACY_COVER_WIDTH` would be the
 * tempting stand-in — the srcset does advertise `cover` at 1140w — but that
 * descriptor is a convention we assert, not a size we measured: a 200×60 site
 * logo is served as its own `post`/`cover` and "correcting" it to 1140 wide
 * would promote furniture into artwork. Unknown stays unknown, and the caller
 * keeps the raw measurement.
 */
export function sourceWidth(url: string): number {
  return parseVariantUrl(url)?.top ?? 0;
}

/**
 * `srcset` for a news image. Empty string when there is nothing to choose from
 * (a single opaque `w0` object) — the caller then relies on `src` alone.
 */
export function newsSrcset(url: string): string {
  const v = parseVariantUrl(url);
  if (v) {
    return variantRungs(v.top).map((w) => `${v.base}w${w}${v.ext} ${w}w`).join(', ');
  }
  return `${rsiVariant(url, 'post')} ${LEGACY_POST_WIDTH}w, ${rsiVariant(url, 'cover')} ${LEGACY_COVER_WIDTH}w`;
}

/**
 * `src` fallback for browsers that ignore `srcset`. Never the largest variant on
 * a regular tile, and never the multi-MB original on any of them.
 */
export function newsDefaultSrc(url: string, featured: boolean): string {
  const v = parseVariantUrl(url);
  if (v) {
    const rungs = variantRungs(v.top);
    if (!rungs.length) return url; // w0 — the single object IS the url
    const width = featured ? rungs[rungs.length - 1] : rungs[0];
    return `${v.base}w${width}${v.ext}`;
  }
  return rsiVariant(url, featured ? 'cover' : 'post');
}
