# Reconciled approaches — Verse News rethink

Step 5 of `/tune-rethink`. Three code-blind lens agents returned one approach
each; this file re-reads them against the actual codebase.

Corridor recap: the Verse News page and everything that exists only for it may
be rebuilt, a `/news/patches`-style sub-page plus a nav entry is allowed,
everything else is out.

---

## What the code already gives us (shared migration surface)

All three approaches lean on the same three capabilities. None of them is new:

| Needed by the approaches | Already exists | Where |
|---|---|---|
| "next main patch in N days" | `computePatchForecast()` → rows `ptu`, `live`, `subPatch`, `ptuSubPatch`, each with date, median basis, sample count, overdue flag | `src/app/news/patch-stats.ts:378` |
| "which build is live right now" | `groupPatchNotes()` → `PatchLineGroup.isCurrentLive` | `src/app/news/patch-notes.ts:150` |
| release-train nodes (Evocati / PTU / Live / Hotfix) | `latestPerFacet()` → newest entry per facet | `src/app/news/patch-notes.ts:264` |
| responsive hero artwork | real variant ladder `w400 / w800 / w<top≤1600>`, verified 200 on the live bucket | `src/app/news/news-image-variants.ts` |
| card / thumb rendering incl. channel placeholder | `sc-news-thumb` | `src/app/news/news-thumb.component.ts` |
| favourites, watched-videos, channel filter, persistence | `NewsService` signals + localStorage, consent-gated | `src/app/news/news.service.ts` |
| new route + nav entry | flat route table, flat nav list | `src/app/app.routes.ts:61`, `src/app/shell/shell.component.ts:78` |

**So the patch sub-page is cheap in every variant:** it is a move of
`sc-patch-notes-section` + `sc-patch-cadence` behind a new route, not a rewrite.
The expensive part in all three is the *new entry*, not the depth page.

Two reality checks that change the ranking:

1. **`_lastSeenAt` is not persisted.** `news.service.ts:136` seeds it with
   `Date.now()` at construction, so it survives exactly one page life. The
   "since your last visit" mechanic (approach C) therefore needs a new persisted
   value — cheap in itself, but it lands in the **consent-gated** preference
   bucket (`persistFilter` skips when `consent.preferencesAllowed()` is false).
   A user who declines preference storage gets no diff, so C needs a defined
   degraded mode (falls back to plain recency).
2. **The build-wave roll-up does not exist.** `groupPatchNotes` groups by version
   *line*; it has no notion of "20 consecutive `[All Waves] … <buildnr>` notes
   are one event". All three approaches assume that roll-up. It is a new pure
   function next to `patchFacetOf` — small, testable, and needed regardless of
   which entry wins. **Do this one first, it is the single biggest pixel win
   (1,215 px → ~1 row) and is independent of the layout decision.**

---

## Approach A — "Stage, Verdict, Stream"  (lens: product-value)

Three objects, full stop: an always-filled cinematic **Stage** picked by score
from the whole editorial pool (image-less items are hero-ineligible, which
cleanly excludes Spectrum), a compact **Verdict** card docked at the stage's
lower edge that answers B in one sentence, and one flat reverse-chronological
**Stream**. Patch notes leave the page entirely.

- **Reaches:** density 3/6-of-7 · cinematic · A/B separated · depth off-page ·
  quiet day solved by the score-based pick.
- **Migration:** deletes the most code of the three (buckets, filter bar, rail,
  cadence panel move out). Reuses `sc-news-thumb`, favourites, the detail
  overlay. Estimated ~2,400 px page height vs 7,327 today.
- **Risk:** the flat stream loses the recency grouping ("Heute/Diese Woche")
  entirely — relative timestamps must carry it alone. Killing the channel filter
  is defensible at ~45 items but removes a control users may already use
  (channel filter state is persisted today, i.e. someone is using it).
- **Blast radius vs corridor:** `in-corridor`.

## Approach B — "Viewport, Instruments, One Stream"  (lens: ux-design)

A/B are separated on the **horizontal** axis instead of vertically: full-bleed
stage on the left, a translucent **instrument column** docked into the right
third carrying the answer to B — a 96–112 px countdown numeral, a 64 px
**release train** (Evocati · PTU · Live · Next) and three micro-stats. Below:
one single-column "river" of uniform rows, sticky lens control that only
materialises after the hero scrolls away. On a quiet day the build steps onto
the stage and the instruments dim.

- **Reaches:** density exactly 3/7 (enumerated) · the most cinematic of the
  three · A/B orthogonal, structurally non-interleavable · ~3.7 screens.
- **Migration:** the release train is a new component but is a *pure re-render*
  of `latestPerFacet()` + one forecast row — no new data. The river replaces the
  card grid (`.cards` grid → row list): visually a rewrite, logically the same
  item model. Highest CSS cost of the three; the instrument column needs a real
  responsive plan (it collapses to a horizontal card under the hero).
- **Risk:** the 32–36 % instrument column is the widest new surface to get right
  in two languages; German labels at 11–12 px caps are the pinch point. The
  "quiet day = build on stage" flip needs artwork for the build itself — we have
  no key art for a version, so it would fall back to the newest patch-note
  item's image or a generated HUD plate. **This is the one open asset question.**
- **Blast radius vs corridor:** `in-corridor`.

## Approach C — "Since You Were Here"  (lens: enduser-feel)

The page reports the **diff since your last visit** rather than the catalogue:
one Frame (fallback chain: newest item since last visit → newest video → build
standing), a one-line **standing strip** under it, then one stream split by a
**read-line** with a "You're up to date" divider and a "mark all seen" escape.
Runs of near-identical items collapse into roll-up chips.

- **Reaches:** density 3/7 that is *stable under backlog size* — the strongest
  answer to "catch-up day" of the three · quiet day becomes the best screen, not
  the emptiest · kills the frustration at the root (hero bound to a fallback
  chain, never a bucket).
- **Migration:** needs persisted last-visit + seen-set (see reality check 1) and
  therefore a **consent-degraded mode**. Reuses `pendingCount`/`acknowledgeNewPosts`
  as the seed of the mechanic — the plumbing is half there.
- **Risk:** the only approach whose core value **depends on state that a user can
  decline**. Also the only one where a wrong last-visit timestamp actively lies
  to the user ("0 new" after a 30 s bounce) — the agent named the same-day floor
  as the mitigation; that is real work, not a detail.
- **Blast radius vs corridor:** `in-corridor` (the persisted timestamp is app-side
  personal state in the same category as favourites/watched, not a data-source
  change).

---

## Convergence — what all three agree on, independent of the decision

These are effectively decided already; they should ship whichever variant wins:

1. **The hero must not be bucket-bound.** All three replace "first item of Today"
   with a fallback chain / score that always resolves.
2. **Patch depth leaves the landing page** (sub-page + nav entry).
3. **The build-wave noise collapses to one row** — and even on the depth page it
   is collapsed by default.
4. **The video rail as a distinct 297 px band dies**; videos become stream items
   and hero candidates.
5. **B is reduced to one number + one supporting line** above the fold; the
   rotating carousel is depth-page material.
6. **The Today/This week/Older buckets die**; recency is carried by timestamps
   (A, B) or by the read-line (C).

## Divergence — the actual decision

| | A — Stage/Verdict/Stream | B — Viewport/Instruments | C — Since You Were Here |
|---|---|---|---|
| A/B separation | vertical, B docked to hero | **horizontal** | temporal (they take turns) |
| Signature | radical subtraction | the instrument column | the read-line |
| Cinematic score | high | **highest** | high |
| Quiet day | stage still filled by score | build takes the stage | build takes the stage + honest "nothing new" |
| Catch-up day | plain list | plain river | **finite, closable** |
| New state needed | none | none | persisted last-visit + seen-set |
| CSS/effort | low | **high** | medium |
| Open question | is a flat stream enough? | artwork for the build itself | consent-declined degraded mode |
