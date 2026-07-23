// --------------------- Comm-Link URL classifier ---------------------
// The star-citizen.wiki API occasionally surfaces non-article entries as
// "comm-links": storefront ad promos (channel "Undefined", e.g. "Fly with
// D-Box" → /promotions/<code>, which 404s) and, when an entry has no rsi_url,
// our own bare `/comm-link` index fallback. Both give the user a card whose
// "open on RSI" link lands on a dead page or a redirecting error screen
// instead of an article — the reported link bug.
//
// A genuine comm-link permalink is `/comm-link/<category>/<id>-<slug>`
// (optionally locale-prefixed, e.g. `/en/comm-link/transmission/21227-...`).
// This classifier keeps only those, so the feed drops promo/ad/index entries
// before they reach the client.
//
// Pure and dependency-free (no Deno/Node APIs beyond the WHATWG URL, available
// in both runtimes) so it runs on Supabase Edge and under a Node/Deno test.

export function isCommLinkArticleUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false; // malformed/relative url — not a usable article link
  }
  // Drop empty path segments so a leading or trailing slash doesn't shift the count.
  const segments = parsed.pathname.split('/').filter(Boolean);
  const idx = segments.indexOf('comm-link');
  // Require a category AND an article slug after "comm-link":
  //   …/comm-link/<category>/<id-slug>  → article (keep)
  //   …/comm-link  or  …/comm-link/<category>  → index/listing (drop)
  //   …/promotions/…  (no "comm-link" segment) → promo/ad (drop)
  return idx !== -1 && segments.length >= idx + 3;
}
