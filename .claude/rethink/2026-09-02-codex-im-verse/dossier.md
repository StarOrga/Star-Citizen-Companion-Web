# Hypothesis dossier — "Im Versum" → "Im Verse" band (Codex landing)

Date: 2026-09-02 · Status: **hypotheses, to be validated on the concept page (iteration 1)**

## Scope

- In scope: the third plane of the Codex landing — eyebrow line (+ keybindings
  link), the seven domain chips with counts, the "Auf dem Reißbrett" rail, and
  the seam between this plane and the AN BORD / IM HANGAR surface above it.
- Out of scope: AN BORD (just rebuilt, #442), IM HANGAR, the terminal row, the
  `/codex/index` subview the chips land on, data model / edge functions.
- Rename decided by owner: DE eyebrow "Im Versum" → "Im Verse" (EN already
  "In the Verse").

## Evidence — repo

- Landing = "scale ladder" (person → ship → verse). The first two planes share
  ONE floating bordered surface (`.surface`, 1px tinted border, elevated
  shadow); each zone has a `--tint` (amber = yours, cyan = ship) driving the
  eyebrow colour and a 2px left edge accent. Plane 3 is *frameless*, its eyebrow
  is grey `--sc-fg-2`, no edge accent, separated by the same neutral 20px gap
  that separates the terminal from the surface.
- The seven chips: transparent pills, 17px stroke glyph per category, each in
  its own taxonomic hue (cyan / gold / cyan / orange / grey / grey-blue / red
  from `CAT_COLORS`), 0.76rem label, 0.68rem grey mono count, 6px gap. Frame
  appears only on hover/focus.
- Board panel design rule since #442 (concept iteration 6): amber = yours only,
  blue-grey = open only, three type roles only, "anything not listed here must
  not appear in this zone". The band violates this with seven hues.
- Iteration history of this band (all appearance, no identity):
  - #382 / #400 composed landing, domain tiles with counts as headline.
  - 2026-08-23 concept: Ⓓ Icon-Kacheln / Anteilsband / Kompaktleiste,
    Ⓖ rows sorted by count vs. domain order. Owner: "lieber so, aber eher
    horizontal! und die Anzahl ist eine side Info … alle in dieselbe Subseite
    … keybinding icon rechts auf der Titelzeile, nicht unten drunter".
  - #421 implemented horizontal chips, dropped "Domänen" title, count demoted,
    keybinds moved up, all 7 → `/codex/index?kind=`.
  - #442 rebuilt AN BORD with a strict colour/type system — the band was not
    touched, which is when the mismatch became visible.
- Data reality: `CodexKind` = exactly the 7 domains (ship, weapon, component,
  item, ammunition, manufacturer, blueprint). No locations, missions, prices.
  `entityCounts` (+ `seeded`) per domain; build metadata (patch, extractedAt).
  Routes under /codex: index, bridge, blueprint, fps, keybinds, upcoming,
  :kind/:className. Verse-news is a separate top-level area (/news).
- Concept-ship rail: RSI upcoming feed, 16:9 art tiles, external links, badge
  with "new since last visit" count.

## Evidence — live

- Owner screenshot (2026-09-02): eyebrow "IM VERSUM" left, key icon far right,
  one row of seven small chips. Reads as a filter bar.
- **No live look possible:** `/codex` is auth-gated (redirects to `/login`);
  a dev server on :4217 only yields the login page. The owner screenshot is
  the live evidence; the concept page carries a code-faithful mock instead.

## PO review (devops:po, 2026-09-02) — condensed

- The plane lacks a *statement*, not content. Seven links show our tables,
  not the universe.
- Hero candidate, data-backed: build-over-build patch delta
  (`recentLiveBuilds(2)` already returns two builds with counts; a ship
  class-name diff yields "new in the archive" hulls with internal links).
- Entry model: ships · weapons · components · blueprints are player starting
  points; manufacturers (1,148 = datamining namespace) and ammunition (a
  weapon detail) are facets, not front-door domains; "Items" (20,015) is a
  catch-all → honest as an unfiltered archive entry.
- Reißbrett rail head should link to the existing `/codex/upcoming` view.
- Keybindings do not belong to this plane (reference tool) → AN BORD or the
  terminal tool row.
- Must not be added: locations, missions, prices, orgs, popularity — no such
  tables; no second news feed; no skeletons for rails that can stay empty.
- Nebenbefund: `/codex/blueprint` is orphaned (only the legacy bridge links it).

## Designer review (devops:designer, 2026-09-02) — condensed

- Fiddly: 7 identical small pills, each with a different hue AND a different
  17px glyph — smaller than any other glyph on the page. A sample sheet, not a
  wayfinding system.
- Unstaged: no primary/secondary hierarchy, no grouping; the demoted count
  makes everything equally unimportant.
- Colours: taxonomic system (7 hues for 7 entity types) collides with the
  hierarchical system above (1 hue per scope). The plane has no tint of its own.
- Detached: frameless after a closed floating box; grey eyebrow; no edge
  accent; the same 20px gap for "inside the ladder" and "between blocks".
- Keybinds link: a tool shortcut in the header of a content plane, no relation.
- Directions (cheap → expensive): one tint for the whole plane, monochrome
  glyphs; seam instead of gap; bigger staged chips in the board-panel
  vocabulary (26px framed glyph, label/value roles); the band as third zone of
  the surface; typographic count ticker; starfield plane (the break becomes the
  statement); rail in its own frame; one unified glyph set.
- Missing (data-backed): total archive size; per-domain patch delta
  (infrastructure exists for the fleet); domain-scoped search hook.

## Hypotheses to validate (owner confirms / rejects on the page)

H1 Goal: plane 3 = "step out into the verse": enter the archive by domain,
   see what is announced, and it must read as the third rung of the same ladder.
H2 Gap · fiddly: size/weight decisions (17px glyphs, 0.68rem count, 6px gap,
   frameless pills) make the row read as a filter bar.
H3 Gap · icons unstaged: seven glyphs, seven hues, no frame or plinth, no
   hierarchy — no staging.
H4 Gap · colours: taxonomic hue system vs. the ladder's one-tint-per-plane
   grammar; the plane has no tint.
H5 Gap · detached: no seam, grey eyebrow, no edge accent, neutral gap.
H6 Circling: four iterations reshuffled the same seven chips; none gave the
   plane an identity of its own.
H7 The keybindings link does not belong to this plane's content.

## Open (asked on the page)

- Success criteria, biggest frustration, no-gos, what may be added, corridor.
