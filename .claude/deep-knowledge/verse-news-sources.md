# Verse News — Source APIs and Fallbacks

The Verse News feed proxies multiple sources through the `fetch-verse-news` edge function. Order of preference, with rationale:

## Primary: Star-Citizen-Wiki API

- Endpoint: `https://api.star-citizen.wiki/api/v2/comm-links`
- Format: JSON, no key required, rate-limited but generous.
- Source code: <https://github.com/StarCitizenWiki/API> — scrapes RSI Comm-Link automatically.
- Pros: structured data (title, slug, summary, image, channel, published_at), translated.
- Cons: third-party — outage means we serve stale or empty. Mitigated by SW data-cache (15 min freshness).

Fields used: `id`, `title`, `rsi_url` (the canonical RSI permalink — **not** `url`), `created_at`, `series`, `translations` (newline-joined body text, used to derive the summary).

**Thumbnails require `?include=images`.** Without that query param the API returns only an `images_count` integer and omits the `images` array — that is why early versions showed no thumbnails. With it, the first image's `rsi_url` is the RSI-CDN thumbnail. There is no top-level `image_url` field, and there is no `summary` field.

## Secondary: RSI status RSS

- Endpoint: `https://status.robertsspaceindustries.com/index.xml`
- Format: RSS XML — parsed inline with a lightweight `matchAll` regex.
- Returns recent service updates (maintenance windows, incidents).
- Mapped into `VerseFeed.status.services` and an `overall` heuristic.

## Tertiary (fallback, not yet wired up)

- Official RSI Comm-Link RSS: `https://robertsspaceindustries.com/en/comm-link/rss` — historically flaky after RSI redesigns. Keep in mind as a fallback if Star-Citizen-Wiki API ever goes dark.
- `leonick.se/feeds/rsi/atom` — community-maintained Atom feed. Same idea as above.
- `scghosts.org` — news aggregator with its own feed.

## Schema mapping

```ts
interface VerseNewsItem {
  id: string;
  title: string;
  url: string;
  publishedAt: string;     // ISO
  channel: 'comm-link' | 'spectrum' | 'status' | 'patch';
  summary?: string;
  thumbnail?: string;
  category?: string;       // series name
}
```

If the Comm-Link API returns a relative `url`, the proxy prepends `https://robertsspaceindustries.com`.

## Caching strategy

- Edge function: `Cache-Control: public, max-age=300, s-maxage=900` — Supabase CDN caches for 15 min.
- Angular service worker: data-group `verse-news` with `maxAge: 15m`, strategy `freshness` (try network, fall back to cache).
- Result: a fresh page hit shows news within 15 min of the source publishing, even when offline.
