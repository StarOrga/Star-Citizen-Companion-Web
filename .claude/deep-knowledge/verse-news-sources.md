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

**The `images` array is a MEDIA LIST in document order, not an editorial pick — and `images[0]` is the hero only by luck.** "Letter From The Chairman" (`21301`, 2026-08-27) shipped 8 images whose first three are a 3671×956 lower third (Chris Roberts in the left fifth, flat navy across the remaining 80%) and two 3840×114 `dividing-lines-*.webp` rules; the actual banner sat at index 3. Cover-cropped into a 16/9 tile the lower third paints its empty middle, so the card rendered as a blank panel while the RSI page showed a banner.

**The page's own `og:image` IS the editorial pick.** Every comm-link carries one — verified across `transmission`, `Comm-links` and Roadmap Roundup permalinks — always as `media.robertsspaceindustries.com/<id>/heap_thumb.jpg`, whose `cover` variant is a 2.33 ratio banner. So `resolveHeroImages` no longer scrapes it only as a last resort for entries with NO images: for the newest `HERO_OG_LOOKAHEAD` (12) entries it is fetched up front and **promoted to the front** of the media list (the rest still feeds the slideshow, the wallpaper capture and the image cache). Entries further down that have no image at all keep the historic fallback, bounded by `MAX_OG_FALLBACK`.

Cost is bounded three ways: the two capped target sets above, a shared `OG_PHASE_BUDGET_MS` wall clock (each fetch's own timeout is clamped to what is left of it), and a module-scope memo that survives between requests on a warm isolate — a comm-link's og:image never changes, so a hit is free and correct. Misses are memoized too, or a page with no usable tag is re-fetched forever; a fetch that ran out of budget is NOT memoized, because that is a timeout rather than a verdict about the page. Only ~8 KB into a ~34 KB page is needed, so `readHead` stops the body read at 64 KB and cancels the stream. Only RSI-hosted og urls are accepted (the page is untrusted).

The client hardens the same thing from the other side (`news-thumb.component.ts`): a candidate must be *artwork* (`h ≥ 140`, ratio ≤ 8 — rules and spacers are furniture, never a slide) and, to be the static title image, landscape within `1.2 … 3.0`. The upper bound is the half that was missing — "wide" used to be unconditionally good, which is how a 33:1 divider qualified. Candidates are measured strictly in order and ONE AT A TIME (the mounted one is the one being scanned), so nothing is downloaded speculatively.

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

## Patch CONTENT: `rsi-roadmap` edge function (feedback 961ab0a5)

Everything above gives the patch board patch note **titles**. The `rsi-roadmap`
function is where the board gets what a patch actually *contains* — the planned
scope from RSI's roadmap and the published bullet points from the note itself.
Two upstream sources, one function, one cache table (`public.rsi_patch_cache`),
because they are one feature. The client never talks to RSI.

### Roadmap "Release View"

- Endpoint: `GET https://robertsspaceindustries.com/api/roadmap/v1/boards/1`
- Public, unauthenticated, no cookie/token, no Cloudflare challenge.
  **Verified 2026-08-23: 200, 820,799 bytes.** Envelope is
  `{success, code, msg, data}`; `data.releases[]` holds 39 releases back to
  Alpha 3.1 with their cards, `data.categories[]` the discipline id→name map
  (AI, Characters, Core Tech, Gameplay, Locations, Missions and Events, Ships and
  Vehicles, Weapons and Items).
- The parser (`functions/rsi-roadmap/roadmap.ts`) keeps only the current and the
  next release plus a two-name footnote: **820,799 bytes in, 10,316 bytes out.**

Three traps it exists to avoid:

1. **`releases[].released` is a dead field.** The live 4.9 release reports
   `released: 0` alongside `status: "Released"`; only pre-4.x rows still set the
   integer. Read `status` (`Released` / `Committed` / `Tentative`) and nothing
   else — a `released`-based filter shows an empty "current patch".
2. **Board order is ascending, so the current patch is at the TAIL.** `order` is
   authoritative and the array is not guaranteed sorted. Which release is *live*
   is read primarily from the hand-maintained status line in
   `data.description` (`Live Version: 4.9.0 … ▪ PTU Version: Alpha 4.10 12442953`)
   and only then from "last release with status Released".
3. **`releases[].description` is not a date.** `"Q3 2026"` for what is coming,
   `"December 23rd, 2021"` for what shipped. Rendered verbatim, never parsed.

Thumbnails are absolute on modern cards and relative (`/media/…`) on 2018-era
ones, so they are resolved against the RSI base and then **host-allowlisted
against the app's CSP `img-src`** (`ALLOWED_IMAGE_HOSTS` in `roadmap.ts`) — a url
outside it would only be blocked later, in the browser.

The Progress Tracker GraphQL endpoint is deliberately unused: it masks every
error into an identical `CFUException` (including "no such field"), so an
operation there cannot be probed or version-checked from outside.

### Patch-note bodies (Spectrum thread content)

- Endpoint: `POST https://robertsspaceindustries.com/api/spectrum/forum/thread/nested`
  with `{ slug, channel_id: "190048", sort: "votes", page: 1 }` and header
  `X-Tavern-Id: 1` — the same community id as the list endpoint above.
  **Verified 2026-08-23: 200, ~126–170 KB per thread.**
- The `slug` is the last path segment of the permalink the feed already carries
  (`…/forum/190048/thread/<slug>`), so no extra lookup is needed.
- The body is Draft.js under `data.content_blocks[] → {type:'text',
  data:{blocks, entityMap}}`. `entityMap` arrives as an **array**, not the
  spec's object; both forms are read.

Block types are not consistent between notes, which is the whole difficulty:

| note | `header-one` | `blockquote` | `unordered-list-item` | `unstyled` |
|---|---|---|---|---|
| 4.9 LIVE Release Notes | 4 | 5 | 5 | 24 |
| 4.10 PTU RC1 Patch Notes | 2 | 0 | 28 | 6 |

`header-one` → heading, `blockquote` → sub-heading, `*-list-item` → bullet. An
`unstyled` line is prose *unless* it carries a whole-line BOLD range (4.10 PTU
writes every section label that way and has no heading block below the title) or
starts with a hand-typed bullet glyph. Neither rescue is universal — 4.9 LIVE's
"Important Build Info" has no style range and stays prose — so both sit on top of
the block type rather than replacing it. A miss costs a line its label, never the
line itself. Measured output: 170 KB thread → 4.6 KB outline, 28 bullets.

Images and embeds inside a note are **not** read. A patch note's meaning is in
its text, and pulling images in here would drag this function into the image
pipeline that has repeatedly taken `fetch-verse-news` down (546 OOM).

### Load shape

The roadmap is one document per visit. Outlines are per note and lazy: the board
seeds the newest note per channel and fetches the rest when a row is expanded.
`RoadmapService.SLUGS_PER_REQUEST` (5) is deliberately equal to the function's
`MAX_UPSTREAM_FETCHES` — a slug the function declines to fetch is
indistinguishable from a note with no contents, so the client never asks for more
than the server will fetch. The two constants must move together. At most two
outline requests are in flight at once, which is what keeps "expand every note"
from putting a hundred concurrent Spectrum fetches on RSI.

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
