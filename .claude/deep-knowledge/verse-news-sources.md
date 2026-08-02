# Verse News — Source APIs and Fallbacks

The Verse News feed proxies multiple sources through the `fetch-verse-news` edge function. Order of preference, with rationale:

## Primary: Star-Citizen-Wiki API

- Endpoint: `https://api.star-citizen.wiki/api/v2/comm-links`
- Format: JSON, no key required, rate-limited but generous.
- Source code: <https://github.com/StarCitizenWiki/API> — scrapes RSI Comm-Link automatically.
- Pros: structured data (title, slug, summary, image, channel, published_at), translated.
- Cons: third-party — outage means we serve stale or empty. Mitigated by SW data-cache (15 min freshness).

Fields used: `id`, `title`, `rsi_url` (the canonical RSI permalink — **not** `url`), `created_at`, `series`, `translations` (newline-joined body text, used to derive the summary).

**Only real article permalinks survive.** The wiki API occasionally lists storefront ad promos as comm-links (channel `Undefined`, e.g. "Fly with D-Box" → `/promotions/<code>`, which 404s); entries with no `rsi_url` would otherwise fall back to the bare `/comm-link` index. Both produce a card whose "open on RSI" link dead-ends on a 404 or a redirecting error page, so `fetchCommLinks` filters to `/comm-link/<category>/<id>-<slug>` permalinks via `isCommLinkArticleUrl` (`comm-link-url.ts`). Ship-promo *transmissions* (a real `/comm-link/` article that RSI client-side redirects to a ship landing page, e.g. "Grey's Market Basher") return HTTP 200 and are intentionally **kept** — they cannot be told apart from a normal article server-side.

**Thumbnails require `?include=images`.** Without that query param the API returns only an `images_count` integer and omits the `images` array — that is why early versions showed no thumbnails. With it, the first image's `rsi_url` is the RSI-CDN thumbnail. There is no top-level `image_url` field, and there is no `summary` field.

**The `images` include is really a MEDIA include.** A comm-link that embeds a clip lists `source.mp4` / `source.webm` right next to `source.jpg` under the same media id. Those must be filtered out (`media-urls.ts` `isImageUrl`, deny-list by extension) before the urls reach the image cache: `imageIdentity()` collapses every asset of one media id onto a single cache key, and with a video as the download sample the cache re-downloaded hundreds of MB per request forever without recording a failure (2026-07-29, PR #309 — took the endpoint to 15–22 s and blanked the Starscape weekly summary). Deny-list, not allow-list, because the signed `/i/<sha1>/…` proxy urls carry no extension and are real images.

**One artwork can arrive under several media ids.** RSI publishes a photo series as independent assets, so a media id dedupe cannot see that they are the same picture. The Foundation Festival 2026 comm-link (`21211`) shipped 8 images, 4 of them the same hangar with the same camera and lighting — two of those the SAME armour set, front view and back view. In the Starscape grid that reads as one photo repeated, every tile linking to the same comm-link. `perceptual-hash.ts` (256-bit dHash of the decoded cover, stored in `verse_wallpapers.phash`) rejects a candidate within 48 bits of a wallpaper already in the gallery. Measured on the live table: the whole studio cluster spans 23–29 bits, the nearest UNRELATED pair is 90 — the threshold sits in an empty band ~60 bits wide. Colour is deliberately not part of the signal; there is no threshold that separates the two same-suit shots (29) from the different-suit ones (23), and the suits are too small a share of the frame for a colour term to split them either. One artwork per scene is the right outcome for a wallpaper gallery. Backfill for rows captured before the filter: `npm run wallpapers:dedupe` (dry run by default).

**Some entries return `images: []` even with `include=images`.** The "Roadmap Roundup" Transmission series is the recurring offender — the wiki scraper never captures its hero image (`images_count: 0` for every entry). For any comm-link that comes back without images, `fetch-verse-news` falls back to scraping the `og:image` (then `twitter:image`) meta tag from the RSI permalink (`backfillMissingImages` / `fetchOgImage`). That og:image is a `media.robertsspaceindustries.com/<id>/heap_thumb.png` url, so the existing variant-swap + cache pipeline turns it into the durable `post`/`cover` copies unchanged. Only RSI-hosted og urls are accepted (the page is untrusted); fallback is bounded to `MAX_OG_FALLBACK` entries per request.

## Primary for patch notes: Spectrum forum 190048

- Endpoint: `POST https://robertsspaceindustries.com/api/spectrum/forum/channel/threads`
  with `{ channel_id: 190048, page, sort: 'newest' }` and header `X-Tavern-Id: 1`.
- `X-Tavern-Id` is the **community** id (1 = Star Citizen), not the channel — the
  same value for the Announcements forum (`channel_id` 1) and this one.
- Channel 190048 is the SC "Patch Notes" forum and is where RSI publishes
  **everything**: the LIVE release notes, every PTU/Evocati wave, the point
  releases (4.8.1, 4.8.2) and the rolling "Hotfix Central" threads.

None of that reaches the Comm-Link wiki API. Before feedback 44e90e30 the `patch`
channel was fed only by comm-links whose *series* string happened to contain
"patch"/"release"/"hotfix" — in practice near-zero, so 4.9 and its hotfixes never
appeared at all while RSI's own site had them.

`fetchPatchNotes` reads two pages (~100 threads ≈ the last half-dozen patch
lines, back roughly nine months) and dedupes by thread id: **pinned threads are
repeated at the top of every page**, so without that the current release notes
would appear once per page fetched.

These threads carry no `media_preview` and we do not ask for one
(`mapSpectrumThread` `withImage: false`) — so patch notes cost nothing in the
image cache, the wallpaper crawl, or storage. The client renders the channel
placeholder.

`time_modified` looks like an "edited at" but tracks the **last reply** (it moves
in lockstep with `replies_count`), so it is deliberately not surfaced: an
"updated 2 days ago" badge would mean "someone commented", not "there are new
notes". A LIVE hotfix thread announces its own updates in its title instead
("Hotfix Central (Updated 7.30.2026)").

### Grouping is client-side and data-derived

`src/app/news/patch-notes.ts` parses the version out of each title and groups by
**main patch line** (first two segments), newest line first, entries newest first
inside a line — the shape feedback 44e90e30 asked for. Nothing is keyed off a
list of known versions, so 4.10 and 5.0 group themselves.

Two traps the parser exists to avoid:

1. **Numeric ordering.** `4.10` sorts ABOVE `4.9`. Segments are compared as
   numbers; a string compare puts 4.10 below 4.9.
2. **Dates and build numbers in titles.** `(Updated 7.30.2026)` would otherwise
   open a patch line "7.30", and `12358556` is a build number, not a version. The
   version is read from the `Alpha <x.y[.z]>` anchor first, and the generic
   fallback rejects any token adjacent to more digits or dots.

Patch notes are excluded from the time buckets (`Heute / Diese Woche / Älter`) in
every channel view — they own their own section, and the `patch` filter chip
narrows the page down to it.

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

## Video retention (feedback e7082310)

Videos are the one channel with a hard age limit: **rolling 31 days** (today +
this week + this month), defined once in `video-retention.ts` and mirrored by
`VIDEO_RETENTION_DAYS` / `pruneExpiredVideos` in `src/app/news/news.service.ts`.
Reason is storage, not editorial: every kept video keeps a thumbnail in the
`news-images` bucket, which is the project's scarcest online resource.

Three places enforce it:

1. `fetchYouTube` drops aged-out entries **before** `captureWallpapers` /
   `cacheImages` run, so an expired clip never reaches storage at all.
2. `enforceVideoRetention` (end of the request, best-effort) stamps
   `verse_image_cache.video_published_at` for the thumbnails of the videos it
   just served, then deletes the stamped rows whose date left the window —
   together with their storage objects, enumerated via `storage.list(<hash>)`
   rather than assumed file names. Objects are removed first; the row is the
   only handle on them, so it is deleted only after the bytes are gone.
3. The client re-applies the cut on every payload — the service worker can
   serve a far older cached feed offline, whose thumbnails no longer exist.

`video_published_at IS NULL` means "not a video image": comm-link/patch artwork
and rows cached before this shipped. `< cutoff` never matches NULL, so article
art is structurally out of the sweep's reach. The legacy untagged video rows
are a bounded one-time residue (~30 KB YouTube thumbnails each); rows still in
the feed get tagged on the next run.

Not done on purpose: skipping the `news-images` cache for `i.ytimg.com` urls
entirely. YouTube's CDN has no referer/expiry problem, so caching those thumbs
buys nothing — but that is a change to the shared cache path, tracked separately.

## Caching strategy

- Edge function: `Cache-Control: public, max-age=300, s-maxage=900` — Supabase CDN caches for 15 min.
- Angular service worker: data-group `verse-news` with `maxAge: 15m`, strategy `freshness` (try network, fall back to cache).
- Result: a fresh page hit shows news within 15 min of the source publishing, even when offline.
