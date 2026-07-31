---
title: Verse News
excerpt: Comm-Link, Spectrum, YouTube and patch notes in one auto-refreshing feed, with live RSI service status.
---

**Verse News** is the app's landing page: one feed that merges every public RSI
channel worth watching, refreshed automatically every 5 minutes. It is
readable without an account.

## Channels

| Channel | Source |
|---|---|
| **Comm-Link** | RSI's official Comm-Link posts |
| **Spectrum** | RSI's Spectrum announcement forums |
| **YouTube** | The official Star Citizen channel |
| **Patch notes** | Patch note releases, tied to the version that shipped them |
| **Favorites** | Your own starred posts (account required) |

Use the channel filter to narrow the feed, or **Show all** to clear it. Posts
are bucketed into **Today**, **This week** and **Older**.

The **Older** bucket follows the filter: in the unfiltered **All** view it is
open, because that is the full stream you came to browse. Pick a channel (or the
saved-only view) and it folds away, so a filtered page shows the fresh matches
first; clearing the filter opens it again. You can always override it with the
button in the bucket header — that choice sticks until you change the filter.

## Videos

The newest clips from the official YouTube channel get their own rail above the
stream, so they are not buried between articles. Videos you have already opened
(or hovered long enough to count as seen) drop out of the rail on the next load.

Videos are kept for **31 days** — today, this week and this month. Older clips
leave the feed and their cached thumbnails are deleted, because SC Companion
only has so much online storage and a video that old is no longer news. The
articles themselves are unaffected: only videos age out, and every video is
still one click away on YouTube.

## Live service status

The **Star Citizen Live** widget mirrors RSI's own status page: *Playable*,
*Degraded*, *Partial outage*, *Offline* or *Maintenance*, with a per-service
breakdown and a link out to the official status page.

## Saving and sharing

- **★ Save** collects a post into your *Favorites* channel. It is per-account
  and syncs across devices.
- **Share** copies a direct link to the post.
- Every item links to the original on RSI — SC Companion aggregates and links,
  it does not rehost articles.

## Upcoming ships notice

The feed surfaces a notice when RSI's ship matrix gains entries that the
datamined game data does not have yet: *"N new ships on the ship matrix"*, plus
a note when one of your own favourites changes status. It links straight to
[Upcoming Ships](doc:codex) in the Codex.

## Freshness

Each item carries a relative timestamp (*just now*, *3h ago*, *yesterday*, …)
and the feed shows when it was last updated. The underlying aggregation is
cached; if you consume the same data through the
[Public API](doc:endpoints), `meta.cached_at` and the `X-Cache` response header
tell you exactly how fresh a payload is.
