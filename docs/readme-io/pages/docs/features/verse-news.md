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
are bucketed into **Today**, **This week** and **Older**, with the older bucket
collapsed until you expand it.

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
