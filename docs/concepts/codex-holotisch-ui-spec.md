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
