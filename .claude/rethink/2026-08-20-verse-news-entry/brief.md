# Rethink Brief — "Verse News" page

Code-free by design. This is the ONLY context the fresh-phase ideation agents
receive. Written 2026-08-20.

## 1. What the surface is

A single page inside a companion web app for the space game *Star Citizen*.
It is the app's landing page — the first thing a signed-in player sees.

It aggregates four live sources into one place:

- **Comm-Link** — the studio's official articles (feature pieces, "This Week in
  Star Citizen", monthly reports, roadmap round-ups). ~30 items live.
- **Spectrum** — posts from the studio's own community platform (announcements,
  event threads, launcher notes). ~12 items live. These arrive without any
  image of their own.
- **YouTube** — the studio's video output. Typically 0–3 recent clips.
- **Patch notes** — every release note the studio publishes. ~100 items live,
  i.e. **70 % of everything on the page**.

The page is visual: most articles carry a wide key-art image, and the app's
overall look is a dark, high-contrast sci-fi HUD aesthetic.

## 2. What today's page contains (content inventory, in current top-to-bottom order)

1. Page title and a one-line subtitle, plus a small live "last updated N minutes
   ago" indicator with a status dot.
2. Occasionally: a dismissible notice that new ships appeared in the game's ship
   database.
3. Occasionally: a floating pill "N new posts" when the background poll finds
   something.
4. A row of filter buttons — one per source plus "All" plus "Favourites", each
   carrying an item count.
5. A horizontally scrolling rail of **recent videos**, capped to a retention
   window, with per-video "already watched" tracking (a video drops out once it
   has been watched or dwelled on).
6. A full-width **patch-notes block** which is effectively a small app of its own:
   - a rotating analytics panel, one slide at a time, auto-advancing every
     7 seconds, with labelled dots and a play/pause control and a
     "last 6 months / all time" toggle. Slides: days from first test build to
     public release; days between two main releases; days between two minor
     patches; and a forecast slide estimating the dates of the next test build,
     next main release and next minor patch;
   - a row "newest per channel" — at most one card each for Live, Hotfix, PTU
     (public test), Evocati (closed test);
   - two independent multi-select filter rows — by version line, and by test
     channel — each with counts;
   - a **history**: patch notes grouped under their version line (Alpha 4.10,
     4.9, 4.8 …), newest line auto-expanded, each row a link out to the
     studio's site.
7. **Article buckets** by recency: "Today", "This week", "Older" — a card grid.
   The first card of "Today" is a double-size hero tile; every other card is a
   uniform tile with image, headline, timestamp, and three small actions
   (favourite, share, open at source).
8. Clicking any card opens an in-app detail overlay with the large image,
   summary and the same actions.

## 3. Measured state (real production data, 2026-08-20)

- Total page height: **7,327 px ≈ 7.7 screens** on a 1568×948 desktop viewport.
- The first screen contains: title, subtitle, filter buttons, and a video rail
  holding **exactly one video** inside a 297 px band.
- The patch block occupies **2,019 px (27 % of the page)** and sits **entirely
  above the first news article**.
- Inside it, the auto-expanded newest version line alone is **1,215 px of 20
  near-identical rows** — the studio publishes one note per internal build wave,
  so twenty consecutive rows read "[All Waves] … PTU Patch Notes 12479687",
  "… 12473311", "… 12464883" and differ only by an internal build number.
- The first actual news card appears at ~2,700 px — screen 3 of 8.
- The "Today" bucket **did not exist at all** on the measured day. Because the
  page's only hero tile is defined as "first item of Today", on most days the
  page has **no hero at all** — it opens with tools and a near-empty rail.
- "Older" holds 38 cards / 4,152 px and was expanded by default.

## 4. The goal (validated with the product owner)

The page must answer two questions at a glance, cleanly separated:

- **A — what is going on right now?** New posts and new videos.
- **B — where does the build stand?** Above all: *when is the next main patch,
  and how long does it usually take?*

…and then let the reader go deeper **on demand**.

## 5. Success criteria

1. **Hard density budget: at most 3 "eye-catchers" and at most 7 secondary
   elements on the page.** The owner named this explicitly and unprompted; more
   than that reads as "too full" regardless of how well it is styled. Treat it
   as a rule, not a guideline.
2. **A cinematic entry.** Large-format imagery, little text, atmosphere. Star
   Citizen feeling before information density. The top of the page must look
   deliberate and composed — never like a toolbar with a list under it.
3. **Clean separation of A and B.** Both must be present, each with one obvious
   home; they must not interleave into one vertical pile.
4. Depth is reachable but never the default: the twenty-build-wave noise must not
   be able to occupy screens of vertical space on arrival.
5. The page must look composed **on a quiet day too** — a day with zero new
   articles and zero new videos must still produce a deliberate-looking screen,
   not an empty frame.

## 6. Biggest frustration

The page has no entrance. It opens with controls and a half-empty band, and the
one composed element it owns (the large hero tile) is bound to a bucket that is
empty on most days, so it almost never appears. Everything below is four
equal-weight full-width bands stacked in an order nobody would choose: analytics
about patch cadence outrank today's actual news. Nothing tells the eye where to
start, and the vertical sequence reads as accumulated rather than designed.

## 7. Non-negotiables

- Both capabilities survive in some form: **posts and videos**, and **patch
  status in the sense of "when does the next main patch land"**.
- Everything else — including the rotating analytics panel, the video rail as a
  distinct object, the filter buttons and the favourites collection — may be
  replaced, relocated or dropped, as long as the underlying job still gets done
  somewhere sensible.
- The reading language is German and English (both must fit; German strings run
  roughly 20 % longer).
- The four source feeds and their update cadence are fixed — they are what they
  are and cannot be curated or rewritten upstream.

## 8. Demolition corridor (agreed with the owner)

**Wide, but scoped to this one page.** The page and everything that exists only
for it may be rebuilt from scratch, including its structure and its parts. A
dedicated sub-page for the patch depth (reachable from this page, and if needed
announced in the app's main navigation) is explicitly allowed.

Out of corridor: the rest of the app's pages, the app's global chrome beyond a
navigation entry, the data sources, and the visual language of the app as a
whole (this page must still look like it belongs to the same product).

## 9. Out of scope

Content curation quality, translation work, data-pipeline changes, offline
behaviour, and anything on other pages of the app.
