---
title: Verse News
excerpt: Comm-Link, Spectrum, YouTube and patch notes in one auto-refreshing feed, with live RSI service status.
---

**Verse News** is the app's landing page: one feed that merges every public RSI
channel worth watching, refreshed automatically every 5 minutes. It is
readable without an account.

## The page

Three objects, in this order.

**The stage.** One item, full-bleed, at the top — the most eventful thing the
feed currently carries, scored across the whole pool rather than picked out of a
"today" bucket, so it is never empty on a quiet day. Its headline is a real link
to the source; a plain left click opens the in-app detail view instead, which
you leave again with **Zurück**.

**The build verdict.** One sentence docked into the stage: which Alpha line is
live, and how many days until the next main patch is due (or how far it is
overdue), plus the median interval that estimate rests on. **Patch-Zentrale**
opens the full patch board at `/news/patches` — everything below under
*Patch notes* lives there, not on the landing page.

**The stream.** Everything else, flat and newest first, each tile carrying its
own relative timestamp. Its header is one segmented toggle: **Beiträge** (all of
it) and **Gemerkt** (your saved posts), each with its count. Both counts read
from the same list, so the saved half can never promise an item the list cannot
show.

## Channels

| Channel | Source |
|---|---|
| **Comm-Link** | RSI's official Comm-Link posts |
| **Spectrum** | RSI's Spectrum announcement forums |
| **YouTube** | The official Star Citizen channel |
| **Patch notes** | Patch note releases, on their own page (see below) |

Every tile is badged with its channel; videos additionally carry a play marker
and a **Video** tag.

## Videos

Videos sit in the stream with everything else rather than in a separate rail —
badged, but not fenced off.

Videos are kept for **31 days** — today, this week and this month. Older clips
leave the feed and their cached thumbnails are deleted, because SC Companion
only has so much online storage and a video that old is no longer news. The
articles themselves are unaffected: only videos age out, and every video is
still one click away on YouTube.

## Patch notes

Everything in this section lives on the **patch board** at `/news/patches`,
reachable from the build verdict on the landing page. It is the one place where
release cadence is the subject rather than a footnote.

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

The same two controls appear on the stage, on every stream tile and in the
detail view — same icon, same wording; only the label is dropped on a tile,
where there is no room for it.

- **Merken / Gemerkt** collects a post into the saved half of the stream
  toggle. It is per-account and syncs across devices.
- **Teilen** shares a direct link to the post, or copies it where the browser
  has no share sheet.
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
