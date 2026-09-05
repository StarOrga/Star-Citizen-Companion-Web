# Decision — Patch board rethink

**Date:** 2026-09-05 (submitted 2026-09-04 late evening)
**Decided on:** `docs/concepts/2026-09-04-patch-board-neu.html`, iteration 4
**Action submitted:** `implement`
**Verbatim design comment (Ⓚ):** „sehr viel besser! wobei der Balken zu heftig
ist, vllt. zwei Balken, einer mit gedämpften Farben im Hintergrund etwas
vertikal größer (für die erwartete Situation … aber nur bzgl. Punkte in der
Zukunft …) und der andere darüber mit aktiven Farben (reale Situation)“

## Chosen approach

**Ⓚ — Zeitstrahl-Stapel · TOC-Dossier · ein Zyklus.** Converged over four
rounds (Ⓐ/Ⓑ/Ⓒ → Ⓔ/Ⓕ → Ⓗ/Ⓘ → Ⓚ):

1. **Board** = one search field + a strictly monotonic time stack with a left
   spine: NEXT (4.11, exciting: cyan glow, roadmap teaser strip, "PTU
   erwartet / überfällig") → LIVE (dominant hero row, green status word) →
   last superseded line → "Ältere Patches" fold. No chips beside the search
   (explicit: "macht keinen Sinn"). Status is a coloured WORD, never a dot.
2. **Dossier** = route-backed overlay `/news/patches/:line` (phone: full-screen
   sheet), key-art header with status word + state sentence, **settings-page
   TOC** (sticky rail with 2 px marker + scroll-spy; phone: sticky pill row),
   four sections named by question: *Wie bereite ich mich vor?* (from the
   note's "Important Build Info" / Known Issues; Wipe = amber + surfaces in
   the board sentence) · *Was steckt drin?* (roadmap cards: image + short
   text + long text on click, matching note bullets woven onto each card,
   leftover bullets in one line below) · *Haben sie … gefixt?* (in-patch
   search, hits in context, coverage line, "restliche Wellen durchsuchen",
   wave chip grid) · *Wann kommt der nächste?* (ONE cycle timeline:
   previous Live → first test build → Live → hotfix ticks → today → estimated
   next Live; the three KPIs as spans on that axis).
3. **Board search → patch**: board-scope search annotates patch cards with hit
   counts; opening carries `?q=` into the dossier's search section.
4. **Timeline refinement (this submission):** two bars — a muted, vertically
   larger background bar for the *expected* situation (future points only)
   and a thinner active-colour bar on top for the *real* situation.

## 95 % rule — removal approvals

No approval checkbox was ticked in any round. Verbal instructions override:
version/channel chips go ("macht keinen Sinn"). Everything else survives in
the dossier. **Carousel auto-rotation** is the one mechanic the chosen design
cannot host; the three KPI charts stay reachable (static, collapsed under the
cycle axis, window toggle kept) — the rotation itself is dropped and flagged
in the final report for a veto.

## Not implemented / rejected on the way

Ⓐ–Ⓒ (round 1, "not integrated enough"), Ⓔ Now Bar + jump bar, Ⓕ bottom
question rail on phone (replaced by the settings TOC pill row for app
consistency), Ⓘ lanes (absorbed as the ordering principle, not a layout).
