# Hypothesis dossier — Patch board (`/news/patches`)

Step 2 of `/tune-rethink`, 2026-09-04. Everything here is a HYPOTHESIS until
the question round confirms it.

## Scope boundary

In scope: the patch depth page `/news/patches` — its structure, bands,
controls, visual composition, and the way its parts relate. Functionality may
be changed or added only where it serves that composition.
Out of scope: the Verse News landing page (`/news`, rethought 2026-08-20), the
data pipeline (feed, `rsi-roadmap` edge function), the app chrome, other pages.

## What the page was meant to do (repo evidence)

Born 2026-08-20 (PR #413) as the off-page home for the "patch apparatus" that
used to cost 2,019 px above the first news article. Three feedback rounds
shaped its contents, each adding a band:

| Round | Added |
|---|---|
| 44e90e30 (#334) | version + channel chip filters, "newest per channel" row, rotating cadence KPIs |
| follow-up (#362, #380) | 6-month/all-time window, forecast slide, fillable dots |
| 961ab0a5 (#422) | roadmap band (current + next patch contents), expandable notes with bullet points, global search |

Stated reading order in code: search → roadmap → cadence → newest per channel →
filters → history. Every band answers a different question; no band was ever
designed against the others.

## Measured state (production, signed-in, 1912×948 desktop, 2026-09-04)

Page height 2,550 px ≈ 2.7 screens (with 4.10 open, one note collapsed).

| Band | Height | Share |
|---|---|---|
| Page head (back, H1, sub) | 103 | 4 % |
| Section head + search | 73 | 3 % |
| **Roadmap band** (2 columns × 1,093 px, 17 + 22 cards) | **1,186** | **47 %** |
| Cadence carousel | 212 | 8 % |
| Newest per channel (4 cards) | 98 | 4 % |
| Version chips + channel chips | 76 | 3 % |
| History (4.10 open: 2 notes + folded 23 waves; 5 closed lines) | 470 | 18 % |

One expanded note (4.10 LIVE Release Notes) adds 733 px: 4 sections, 23 lines.

## Observations (the gap)

1. **Eight bands, five header idioms.** H1 → `bucket-head` (title + count + hint)
   → `rm-head` → `cad-head` → `patch-sub-head` ×2 → `line-head`. Each band brings
   its own header, hint text, count pill, and a private control cluster
   (roadmap: expand-all + source link; cadence: dots + play + window; history:
   expand-all; filters: two chip rows). Five control clusters at five heights.
2. **The roadmap dominates a page called "Patch-Historie".** 47 % of the height
   is planned content from RSI's roadmap, above the notes. A reader who came for
   patch notes scrolls past 39 roadmap cards first.
3. **One object, four costumes.** "Alpha 4.10" appears as: roadmap panel
   (current patch), cadence bar (rightmost column), three "newest per channel"
   cards, history line. Nothing shows they are the same thing — only a small
   "Patch-Notes zu 4.10 zeigen" button inside the roadmap panel links two of them.
4. **Stale equals fresh.** The Evocati card in "newest per channel" is 10 weeks
   old (4.9) and sits at the same weight as the 1-week-old Live 4.10 card.
5. **The carousel hides the most-wanted number.** "Next Live patch in ~N days"
   is slide 4 of 4, visible 7 s in every 28.
6. **Filters filter half the page.** Chips narrow "newest per channel" and the
   history but not the roadmap or cadence; the search narrows everything. Two
   filter idioms, different reach, adjacent.
7. **The good part is buried.** The expandable note (headings, bullets, hit
   marks, "N Punkte") is the page's best feature and the user's stated delight —
   and it is the lowest band, behind two chip rows.

## Hypothesis: the missing spine is the VERSION

Every band is a facet of one entity, the patch line ("Alpha 4.10"):
what is planned in it (roadmap), what shipped in it (notes), where it stands
(Evocati / PTU / Live / Hotfix), how long it took (cadence), and what comes
after it (forecast, next). Today the page is organised by DATA SOURCE; a page
organised by VERSION would make the elements cohere by construction.

## What was tried

Only additive rounds. Nothing was ever removed or re-grouped; the 2026-08-20
rethink moved the apparatus off the landing page as one block and left its
internal order intact.

## Live look

Desktop, signed-in production: done (screenshots + DOM measurements above).
Phone viewport: not measured live in this run.
