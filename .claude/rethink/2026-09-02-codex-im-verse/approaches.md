# Reconciled approaches — IM VERSE plane

Raw RETHINK_APPROACH blocks from the three code-blind lens agents, then the
reconciliation against `codebase-facts.md`.

## Raw · product-value — "The panel grows a third edge"

- core: IM VERSE stops being a block under the panel and becomes the third
  zone INSIDE it — same surface, border, glow; third 2px left edge
  (amber → cyan → violet), third eyebrow in the same grammar. No seam to
  design because there is no seam any more.
- accent: one violet/indigo, used exactly three times (edge, eyebrow, glyphs).
- header row: eyebrow left; right, label type grey tabular:
  `Seit 4.3.1 · +6 Schiffe · +412 Objekte` (0-segments omitted).
- entry grid: four equal slots (Schiffe · Waffen · Komponenten · Blaupausen),
  each = a ~56px plinth field (hairline, faint fill) + one glyph at one stroke,
  violet at reduced opacity + name (value type) + count (label type, grey,
  tabular). Zero per-family colour. Real anchors with filter preset.
- base bar: full-width row under the grid, "the plinth of the plinths":
  `GANZES ARCHIV →` (unfiltered view) with the total in count style; right:
  secondary `Munition (238)`. Hover lifts the shared hairline so the four
  slots read as inside the archive door. NOT one whole-zone anchor (invalid
  HTML with links inside).
- rail: below the base bar, on the same unbroken violet edge; heading
  `AUF DEM REISSBRETT →` (internal link) in eyebrow grammar one step down;
  renders nothing when empty.
- phone: 2×2 grid, delta line under eyebrow, base bar full width, Munition
  second line, rail self-scrolling with snap + edge fade.
- not built: person/ship/plans grouping (data can't back a clean split —
  weapons and the 20k items overlap), manufacturers entry, hero total, own
  frame, per-family art, ladder ornament, whole-zone anchor, rail skeletons.
- blast_radius (agent): section-rewrite

## Raw · ux-design — "The panel opens at the bottom"

- core: the ladder as ONE vertical spine in the left gutter: three accent
  segments (amber → cyan → violet) joined by a dim hairline crossing the seam.
  Plane 3 = the same sheet as the panel, with its enclosure REMOVED: the
  panel's bottom border is deleted, its side hairlines run ~28px into the
  plane and fade out, the surface fill continues at ~60% and dissolves into
  the canvas over the last ~120px. No gap anywhere.
- the violet edge is the longest of the three: runs the full plane height,
  past entries, delta line and rail — length encodes scale, binds the rail.
- header row = the whole-archive entry: eyebrow IM VERSE (violet) left; right
  "Ganzes Archiv →" (small name role) + total (value role, tabular, dim). The
  anchor carries a stretched ::after covering the entries field only (z 0);
  tiles are independent z 1 targets. Empty-field click → unfiltered archive.
  Field hover lifts the fill 3% and brightens the arrow.
- group brackets (signature): 1px dimension lines with end ticks above the
  tile row, neutral labels sitting on the line: "AM SCHIFF" over
  Schiffe·Komponenten·Waffen, "PLÄNE" over Blaupausen (fallback: "WAFFEN &
  MUNITION" bracket if weapons include personal weapons). Grouping as a line,
  not a box. Facets never shown here.
- tiles: 48×48 plinth (hairline 8% white, fill 4%, 6px top-right chamfer) +
  20px glyph 1.5px stroke, single neutral foreground; name (name role) +
  count (value role, tabular, dim) below. Hover: violet hairline, +4% fill.
  The rail's 16:9 tiles carry the same chamfer + hairline — cut from the same
  stock.
- footnote row (hairline above): left "Munition · 238" text link; right the
  quiet delta "Seit 4.3.1 · +12 Schiffe · +840 Einträge" (absent when no
  previous build). Two weights only: four staged entries, one quiet line.
- rail: label-role title "AUF DEM REISSBRETT" (internal link) with a thin rule
  to the right margin (drafting language), snap-scroll rail with right-edge
  mask fade; empty → nothing, edge ends at the footnote row.
- accent: cool indigo-violet (~#8E82FF family) ≥4.5:1 on navy, in exactly four
  places: edge, eyebrow, archive arrow, hover/focus.
- phone: entries as four full-width rows (40px plinth, name, count in a fixed
  tabular column); brackets collapse to left labels with a rule; "Ganzes
  Archiv →" as a full-width row at the bottom of the field; footnote stacks;
  rail scrolls inside itself.
- not built: second frame, hero total, per-family colour/art, manufacturers
  entry, motion beyond loading, skeletons, new data, re-cut of panel zones.
- blast_radius (agent): new-approach

## Raw · enduser-feel — "Mirrored rungs, one archive surface"

- core: the two planes above answer "what is MINE"; the third answers "and
  what EXISTS" with the same two questions: a person band mirroring AN BORD,
  a ship band mirroring IM HANGAR, plus plans, plus what is not built yet.
  The way in is the plane's own name: the header row "IM VERSE › das ganze
  Archiv" is the door. Affordance grammar: `›` in-app, `↗` leaves the app,
  no mark = information.
- seam: the panel stays CLOSED. A violet 2px rail exits the panel's bottom
  border through a small notch, crosses the 20px gap as the only mark in it,
  and runs unbroken down the whole plane. Frameless stays, now for a reason.
- door band (~56px, one anchor): eyebrow IM VERSE left, `ARCHIV ÖFFNEN ›`
  right with hairline underline AT REST (no hover-only affordance — phones
  have no hover); subline "alles ungefiltert · Hersteller und Zweck filterst
  du drinnen" (forwarding address for the retired manufacturers entry).
- bands hung off the rail (gutter labels, not links, no chevron):
  `AM MANN` → Persönliche Ausrüstung 20.015 (keeps the 20k body reachable
  under its real name — DEVIATES from "Items = archive door only");
  `AM SCHIFF` → Schiffe · Komponenten · Waffen, hairline, Munition dim;
  `PLÄNE` → Blaupausen.
- row anatomy: 28px hairline icon field (the plinth), one glyph family, all
  violet; name; count right-aligned tabular dim at the SAME x across bands.
  Rows ≥48px.
- time seam: one dim line between entries and the rail band: "seit 4.3.1:
  +12 Schiffe · +840 Einträge" — a pivot: above = exists, below = not yet.
- `AUF DEM REISSBRETT ›` band: same gutter label off the same rail, label
  links inward, carries the announced count; external tiles carry `↗`; empty
  → whole band absent.
- phone: already full-width rows; labels above bands; rail scrolls inside.
- not built: whole-plane click surface (block-link hazards), hero total,
  clickable group labels, second door, per-family art, skeletons, search,
  manufacturers entry, touching the panel beyond the notch.
- blast_radius (agent): section-rewrite

---

# Reconciliation (Step 5, with codebase access)

## Settled core — all three agree (not a variant)

1. **One accent for the plane: violet/indigo**, the cold "far" step after
   amber (you) and cyan (your ship). Needs one new theme token
   (`--sc-accent-verse`); the concept pages already use `#b98bff`/`#8e82ff`.
   *(R3)*
2. **Seven taxonomic hues are deleted.** Glyphs get one treatment, one
   stroke, one colour (neutral or violet), each on an identical plinth field.
   `sc-codex-icon` needs a colour override/input. *(R6)*
3. **Four primary entries** Schiffe · Waffen · Komponenten · Blaupausen;
   Munition secondary as text; Hersteller gone (facet exists). *(R4, R5)*
4. **A real, dedicated archive anchor** (never a whole-zone `<a>` with links
   inside). Needs `/codex/index` to accept "no kind" (today it likely
   defaults to ship) — small list-component change. *(R5)*
5. **Quiet delta line** from `recentLiveBuilds(2)` counts; absent with <2
   builds. One extra query already used by the fleet diff. *(R8)*
6. **Rail stays inside the plane, title links to `/codex/upcoming`, empty →
   nothing.** *(R9)*
7. **Keybinds leave the plane** → terminal row. *(R10)*
8. Phone: rows or 2×2, rail scrolls inside itself. *(R12)*

## Where they genuinely differ — the three designs

| | Ⓐ Dritte Kante (product-value) | Ⓑ Die Fläche öffnet sich (ux-design) | Ⓒ Gespiegelte Sprossen (enduser-feel) |
|---|---|---|---|
| seam | plane becomes the **third zone inside the panel** — same box, third edge | panel's **bottom border removed**, side hairlines fade into the plane, fill dissolves; a **spine** links the three edges | panel stays closed; the violet rail **exits through a notch** and is the only mark in the gap |
| archive door | **base bar** under the grid ("GANZES ARCHIV →" + Munition right) | header link + the **entries field is a stretched link** (empty space = archive) | **door band** at the top, affordance at rest, subline names the facets |
| grouping | none — reading order only (data can't back a clean split) | **dimension brackets** "AM SCHIFF" / "PLÄNE" over the tile row | **bands** AM MANN / AM SCHIFF / PLÄNE with gutter labels |
| Items (20k) | inside the archive door | inside the archive door | **kept as "Persönliche Ausrüstung"** under AM MANN *(deviates from the owner's decision — flagged)* |
| tiles | 56px plinth, violet glyph, 4 columns | 48px plinth with chamfer, neutral glyph, 4 columns | 28px field in 48px rows, violet glyph, list |
| delta | header row right | footnote row right | pivot line before the rail |
| height vs today | ≈ same | ≈ +1 row | **taller** (three bands + door) |
| frameless? | dissolved (inherits the panel frame) | opened (half-frame) | kept |

## Codebase mapping

- **Ⓐ** — `.surface` gets a third row (`grid-column: 1 / -1; border-top`),
  `.zone.verse { --tint: var(--sc-accent-verse) }`, the `.versum` section
  moves inside; `overflow:hidden` on the surface is fine (rail scrolls in
  its own box). Effort **low–medium**. Risk: none structural; specs R13 must
  move. **In-corridor** ("whether the plane becomes part of the same surface"
  is explicitly in scope; the zone grid is not re-cut).
- **Ⓑ** — `.surface { border-bottom: none; border-radius: 4px 4px 0 0 }`,
  the hairline bleed + fading fill drawn on the versum section with two
  pseudo-elements; stretched link = the same `::after inset:0` trick the
  landing already uses for `.zone-entry`; brackets = pure CSS. **Spine
  caveat found in code:** on desktop the amber edge sits at the panel's left
  border but the cyan edge sits at the grid split (col 2) — a single
  left-gutter spine only "links" all three on the phone. Reconciled: the
  spine continues the *left* edge; the cyan edge stays where it is.
  Effort **medium**. Risk: the fading enclosure must survive dark/light
  tokens; hover-lift of a stretched field has no touch equivalent (Ⓑ's own
  fallback: full-width "Ganzes Archiv →" row on phone). **In-corridor**.
- **Ⓒ** — no change to `.surface`; the notch/rail is drawn by the versum
  section (negative top margin overlap). Bands = the existing chip array
  regrouped + labels (new i18n keys). "Persönliche Ausrüstung" =
  `kind=item` reframed. Effort **low–medium**. Risk: the page gets taller
  (owner allowed it); the AM MANN band re-adds the 20k entry the owner
  demoted — needs an explicit yes/no. **In-corridor**.

None of the three is over-corridor. No approach touches AN BORD / IM HANGAR
content or grid.

## Round 2 outcome (owner, 2026-09-03) — direction change

Owner picked Ⓒ's *semantics* and then went one step further: **remove the
third plane entirely**; fold the archive access into AN BORD and IM HANGAR as
a discreet prio-3 quick access; blueprints in both zones with a category-group
sub-filter in the subview. This widens the corridor (the two zones are now
touched) — flagged on the page (Ⓗ) for explicit confirmation.

Data check for the split (codebase):
- blueprint categories: FPSArmours, FPSWeapons → on foot; VehicleComponentS0–4,
  VehicleWeaponsS1–6 → ship; MissionItem. `codex-list` has the single-category
  facet; a *group* preset via query param is a small addition.
- weapons: FPS = `/codex/fps` (weapon_class FPS); ship = index with
  weaponClass facet (needs a query-param preset, like fps-list's deep link).
- armour: `/codex/fps?cat=armor` — the path the board slots already use.

Iteration 3 designs (placement of the quick access): Ⓔ footer line per zone
(with quiet counts) · Ⓕ header-right on the eyebrow line (no counts) ·
Ⓖ on the plinth row (board) + fleet lane head (hangar). Ⓗ = data facts +
open points (rail, unfiltered entry, delta line, counts, corridor confirm).

## Merges

- Ⓐ's base bar and Ⓒ's door band are the same requirement (a dedicated
  archive anchor) in two positions (bottom vs top). Shown as-is per design;
  worth an explicit question on the page.
- Ⓑ's brackets and Ⓒ's bands are the same axis ("what kind") at two
  strengths (annotation vs structure). Kept distinct.

