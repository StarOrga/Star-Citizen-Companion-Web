# Holotable (ship detail page): living UI spec

The Holotable is the default view of the ship page (`src/app/codex/holo/`). The
classic view has its own spec, `codex-schiffsseite-ui-spec.md`; the Holotable on
the Codex landing (`codex/landing/*`) is a different surface and not covered
here. Read this file before any concept for this page and continue it, do not
start over (project rule, `.claude/skills/concept/SKILL.md` rule 5).

Sources: `S` = concept 2026-09-20 "cinematisch" decisions (git dfdfb935, the page
was deleted in #636), `C` = `20261102-2215-holotisch-loadout-callouts`,
`H` = `2026-10-25-header-footer-subheader-analyse`, `T` =
`20261106-1207-holotisch-tiefenanalyse` (this analysis, its decisions file holds the
open questions below once answered).

## Standing constraints from the owner

- The site only renders what the uploader prepared: "nix zu erfinden". A missing value renders `—`, never 0 or an estimate. (S)
- "KEINE information oder funktion" may get lost between the two views; a switch between classic and Holotable stays. (S)
- The words are `Einsatz` (not Rolle, Profil, Linse). (S)

## Accepted

- Three panels in one frame, symmetric, collapsible rails. (S it4)
- 3D leads: a hull with a model opens in 3D. (2026-10-02)
- Arrival fully automatic, "no 5 seconds"; parallax, glow, count-up, scan line, sounds (off by default). (S)
- Patch selector with diff; schema and build details for admins and collaborators only. (S)
- Hangar tab docked above the table, no scrollbars in its overlay. (S)
- Perspectives as tiles with expand; sticky strip: Einsatz, three mini perspectives, ring joint, Signatur & Kühlung, open/close toggle; energy only when expanded. (S)
- Undo as a toast. (S)
- Phone: stacked by default, optional two tabs Tisch / Daten. (S)

## Built from T without a decision (2026-11-06)

Owner's explicit requests:

- No Einsatz bar over the 3D model; the strip's Einsatz field is the picker.
- Schema has sub-views: Einfach (top-down silhouette with leader lines, swappable parts only), Draufsicht, Seitensicht, Frontsicht (blueprint drawing, every hardpoint marked). The front view needs the uploader change plus a data upload; until then its button is disabled and says why.

Baseline fixes, reversible and not contested:

- Hover in 3D keeps the hull readable (softer, tweened focus); neighbours stay reachable (no tooltip bubble over them, label only blocks on its controls, stacked hotspots fan out).
- Leaving a hover waits 120 ms everywhere, so the highlight does not drop between rows.
- The part under inspection stays lit on the hull.
- 3D opens only when the model's bytes are cached; silhouette and pins stay until then. Never under a busy pointer or after working with a pin.
- Table height follows the window (400 to 820 px).
- A picked Schema sub-view is remembered across hulls; picking 3D returns to the default.
- The draft save bar floats above the strip, independent of rails and scrolling.
- Where to buy also lives in the details drawer; the search CTA "Bezugsquelle" opens it there.
- Pins and the inspector list name the gun, not its mount.

## Decided in T round 1 (2026-11-06), not built yet

Layout: the Pult is the favourite (model left, one panel right with tabs); Werkbank and Bühne are out. Scope until it is final: the first screen without scrolling, always fitting vertically, inside the subheader's width. The lower part follows afterwards.

- Hover does not dim; a click shows the hull see-through. A click opens the panel and holds; Ctrl and middle click open the Codex page.
- Dots: swappable parts by default; a toggle in the chip row shows all parts.
- Wheel scrolls the page, Ctrl zooms.
- No Einsatz bar anywhere; the strip picks. Start Einsatz follows the career (owner did not touch this, recommendation stands).
- Compare with the same role first. Percent reads "Besser als N %", once per value, not in the strip.
- Bergbau and Bergung say honestly that the data is missing. Short arrival on a hull change. Phone starts on Einfach, may open 3D fullscreen in landscape. Details drawer opens from the panel.
- Lists under the model go; the panel list takes over their grouped chip look.
- Callouts sit left or right of the model, never over it; only line and marker touch it. Same width and height: name, three top values, icon button to swap. The panel adds more values and a preview of the part's detail page with a real link.
- The strip is always on the first screen and sticks to the bottom edge when scrolling.
- The Einordnung with its hexagon lives in the panel and follows the Einsatz. The page shows the Einsatz subtly; Alles stays app blue, others get a quiet hue plus a symbol, never red or the warning colour.

## Decided in T round 2 (2026-11-06), not built yet

Glas is the favourite: no frame around the model, the panel is one sheet of glass, tabs are a sliding pill, the strip is one capsule. Gutters for callouts stay free; the model does not move while the mouse searches. Comparison group shows the group's own name ("Alle Leichten Jäger"), no term. Another Einsatz keeps other parts lit and quiets the rest. The panel head carries no Einsatz tag; the strip shows it.

Owner's direction: the hexagon's axes follow the ship's class, and stay when comparing with all ships. Rim = 100 % of the group, the median sits on the same scale (the live page already does this, `groupScale`).

## Rejected, do not re-propose without saying so

- Compare button on the ship page ("eher auf der Landing ... Richtung Simulation"). (S hv-s2)
- "Schiff wechseln" and a share button in the toolbar. (S hv3-s2)
- Global density setting; density lives inside the boxes. (S hv5-s3)
- An "Ursache" tile or a "Sichtbar als" label in the strip; an energy segment in the collapsed strip. (S it7, it10)
- Boxed ports ("zu unruhig, zu präsent"). (S hv4-s4)
- Scrollbars in the hangar overlay. (S hv6-s2)

## Open

See `20261106-1207-holotisch-tiefenanalyse-decisions.json` once the round is answered. Older open points:

- Rank cohort by size class: no size field exists, so the scope is disabled.
- Turret and gimbal arcs: extracted (`turretMovement`), no UI (#788).
- Hull HP in the Verteidigung panel: hard-wired gap (`codex-loadout-stats.ts:637`, `codex-detail-facts.ts:306`) while the strip reads `hull.hp`.
