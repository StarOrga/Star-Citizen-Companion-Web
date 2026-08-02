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
| **Patch notes** | Patch note releases, in their own section (see below) |
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

## Patch notes

RSI publishes a patch line as a stream: a few Evocati and PTU waves, the LIVE
release notes, the point releases (4.8.1, 4.8.2) and then weeks of hotfixes.
Listed flat by date that buries the one note you came for, so patch notes get
their own section instead of a slot in the stream.

**Grouped by main patch line.** Everything belonging to 4.9 sits under 4.9,
newest line on top and expanded, older lines one click away. The line you can
actually play right now is badged **Current** — that is the newest line that has
reached LIVE, not every line that ever did.

**Two filters**, both multi-select, both with *All* as the empty selection:

- **Version** — 4.10, 4.9, 4.8 …, because sometimes the question is
  "what changed in 4.9".
- **Channel** — Live, Hotfix, PTU, Evocati, because sometimes it is
  "what is on PTU right now".

Every note is filed under exactly one channel, so the counts on the chips add up
and nothing appears twice. A hotfix thread counts as **Hotfix**, even though its
title also says LIVE.

The patch lines are read from the note titles, not from a hardcoded list — the
day RSI posts the first 5.0 note it becomes the newest line on its own.

### At a glance

Above the history sits the newest note per channel, at most one each: the current
LIVE notes, the latest hotfix, the PTU wave in testing. It follows the filters,
so the header can never contradict the list under it.

### Patch performance

A small panel rotates through up to three views of how CIG is currently shipping,
each pairing the newest measurement with the **all-time average** (drawn as a
dashed rule across the bars):

| KPI | What it measures |
|---|---|
| **Patch notes published** | Notes per rolling 30 days, over the last year |
| **PTU → LIVE** | Days from a line's first test build to its release |
| **Release cadence** | Days between two consecutive LIVE releases |

Everything is derived from the patch notes already on the page — the titles give
the version and the ring, the publication dates give the timing.

A KPI that the data cannot yet prove is left out rather than shown as a zero, so
on a young feed you may see fewer than three.

The rotation is meant to be ignorable, not annoying: it holds while you hover or
tab into the panel, the dots jump straight to a view and stop the carousel, the
play button hands it back, and with **reduced motion** switched on in your OS it
never advances by itself at all — the dots still reach every view.

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
