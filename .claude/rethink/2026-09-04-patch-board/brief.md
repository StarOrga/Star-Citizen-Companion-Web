# Rethink Brief — the Patch Board

Code-free by design. This is the ONLY context the fresh-phase ideation agents
receive. Written 2026-09-04, calibrated with the product owner.

## 1. What the surface is

One page inside a companion web app for the space game *Star Citizen*. The app
has a dark, high-contrast sci-fi HUD aesthetic. The page is reached from the
app's news landing page via a one-sentence "build status" card and a "back"
link; it is the app's single home for everything about the game's patches.

The studio ships the game in rings: a closed test ring (**Evocati**), a public
test ring (**PTU**), and the **Live** ring, plus **Hotfixes** to Live. A main
patch line is called e.g. "Alpha 4.10"; each line gets many release notes
(one per test build wave, plus the Live note and hotfix notes). Live version and
PTU version are usually different lines (Live 4.10 while 4.11 is being planned;
during a test cycle Live 4.9 while PTU 4.10).

## 2. What the page can do today (capabilities — ALL of these must survive)

The owner's rule: **95 % of existing functions stay; their presentation may
change completely; anything removed needs the owner's explicit approval.**
Capabilities, in user terms:

1. **Search everything** — one query box narrows the roadmap items, the
   channel cards and the note history alike, and highlights hits inside an
   opened note. Shows "N notes in M patch lines" and how many notes' contents
   are loaded (only opened notes have their bullet points loaded; titles are
   always searchable).
2. **What is in the patch — planned view.** For the *current* patch and the
   *next* patch: the studio's own roadmap items, grouped by discipline
   (Characters, Core Tech, Gameplay, Ships & Vehicles, Locations, …), each with a
   thumbnail, a name, a status chip (Released / Committed / Tentative), and a
   description that opens on click. A "show all descriptions" switch. A footnote
   listing the patches planned after "next". A link to the studio's roadmap.
   Today this is 17 + 22 items in two side-by-side columns and occupies 47 % of
   the page height.
3. **Patch performance** — three small bar charts (days from first test build
   to Live; days between two Live releases; days between two sub-patches), each
   showing the newest value against the median, "N days faster/slower than
   median", basis count, one bar per patch line. A window toggle "last 6 months
   / all time". Today the charts rotate as a carousel, one slide every 7 s,
   with labelled dots and a pause button.
4. **Forecast** — estimated dates for the next PTU, next Live patch, next Live
   sub-patch, next PTU sub-patch, each as "in ~N days/weeks" or "N days
   overdue", with the median and the basis version. Explicitly "an estimate,
   not an official date". Today this is the fourth carousel slide.
5. **Newest per channel** — at most one card each for Live, Hotfix, PTU,
   Evocati: version tag, title, relative age, link to the source. Today the
   Evocati card is 10 weeks old and sits at the same weight as the 1-week-old
   Live card.
6. **Filter the history** by patch line (multi-select chips with counts:
   4.10 · 25, 4.9 · 13, 4.8 · 17, …) and by channel (Live · 6, Hotfix · 8,
   PTU · 75, Evocati · 11). Filters also narrow the "newest per channel" row.
7. **History** — every release note the studio has published (~100), grouped
   under its patch line, newest line open by default, the current Live line
   marked "currently live". Consecutive test-build waves of the same
   announcement (e.g. 23 rows "[All Waves] … PTU Patch Notes <build>") fold
   into one row. "Expand all notes" switch.
8. **Read a note in place** — any note row expands to the note itself: the
   studio's headings, sub-headings and every bullet point, rendered in the app,
   with search hits marked, a "N points" count on the collapsed row, "N hits"
   when searching, a link to the full notes and a link to the source. Loaded on
   demand. This is the owner's favourite part of the page.
9. **Cross-link** — a button on the roadmap panel jumps to that version's
   history line and opens it.
10. Page head with a back link, title and subtitle; counts in pills on every
    band header.

## 3. Measured state (production, desktop 1912×948, 2026-09-04)

Page height 2,550 px ≈ 2.7 screens with the newest line open.

| Band (top to bottom) | Height | Share |
|---|---|---|
| Page head | 103 | 4 % |
| Section head + search | 73 | 3 % |
| Roadmap (two 1,093 px columns) | 1,186 | 47 % |
| Performance carousel | 212 | 8 % |
| Newest per channel | 98 | 4 % |
| Version chips + channel chips | 76 | 3 % |
| History | 470 | 18 % |

One opened note adds ~730 px (4 sections, 23 lines).

Eight bands, five distinct header styles, five separate control clusters at
five heights (search; roadmap: expand-all + source; carousel: dots + pause +
window; two chip rows; history: expand-all). Filters reach half the page (not
the roadmap, not the charts); search reaches all of it.

## 4. The diagnosis (confirmed by the owner)

The page is organised by **data source** — one band per feed — but every band
is a facet of ONE entity: a **patch line / version**. "Alpha 4.10" appears as a
roadmap panel, as the rightmost chart bar, as three of the four channel cards,
and as a history line, in four different visual idioms, with nothing showing
they are the same thing. The page grew in three additive rounds; nothing was
ever removed or regrouped. **The missing spine is the version.**

## 5. Success criteria (owner-chosen)

1. **One glance: where does the build stand.** Live / PTU / Evocati / next
   (with its estimated date) readable immediately, without waiting for a
   carousel slide.
2. **Far fewer bands and controls.** A handful of zones, one header idiom,
   ideally one control cluster. The page must read as one designed object, not
   eight stacked widgets.
3. Everything in section 2 still reachable (95 % rule), presented in whatever
   form serves 1 and 2.
4. **Mobile is a first-class citizen** — every idea must work at phone width
   without a separate path.
5. Reading language is German and English (German runs ~20 % longer).

## 6. Biggest frustration

"Great features, but no overview and the elements don't hang together."
The best feature — reading a note with its bullet points in place — is the
lowest band, behind two chip rows and 1,200 px of roadmap cards. The number
people most want (next Live patch in ~N days) is slide 4 of a 4-slide carousel.

## 7. Non-negotiables

- All capabilities in section 2 survive in some presentation.
- Functionality is changed or added ONLY where it serves the composition —
  not as feature work in its own right.
- Data stays what it is: the feed of release notes (title, url, date,
  version, ring), the roadmap payload (current, next, later; items with
  category/status/thumbnail/description), and on-demand note contents
  (headings, sub-headings, bullets, links). No data curation upstream.
- The page stays inside the app's existing visual language.

## 8. Demolition corridor (agreed)

**The whole page may be rebuilt from scratch** — structure, zones, parts,
interaction model. Sub-routes (e.g. a page per version) are allowed if they
serve the design. Out of corridor: the news landing page, the app chrome, the
data pipeline, other pages.

## 9. Out of scope

Translation work, feed/roadmap parsing quality, offline behaviour, other pages.
