# Decision — IM VERSE rethink

Date: 2026-09-03 · Concept page `docs/concepts/2026-09-02-codex-im-verse.html`
(3 iterations) · Owner action: **Implement** (iteration 3, v3)

## Chosen: Ⓔ "Fußzeile je Zone" — and the third plane is removed

Owner feedback trail:

- Iteration 1 (question round): all 8 hypotheses confirmed; corridor "the
  whole plane"; frustration "does not belong to the ladder"; Items → archive
  entry, manufacturers → facet, ammunition secondary, keybinds → terminal
  row, rail stays with internal head link, delta quiet.
- Iteration 2 (three code-blind directions): Ⓒ "Gespiegelte Sprossen" liked
  best — *and* a direction change: "integrate 'am Mann' and 'am Schiff' into
  the upper panels as a discreet prio-3 quick access; blueprints in both (on
  foot / on ship) with sub-filtering in the subview; then we remove Im Verse
  completely."
- Iteration 3 (placement of the quick access): **Ⓔ Fußzeile je Zone —
  "Das finde ich am besten."** → Implement.

## What gets built

1. **AN BORD** zone gets a last line (prio 3, label type, dim, hairline
   above): `Archiv › Rüstung · Waffen · Baupläne` →
   `/codex/fps?cat=armor`, `/codex/fps?cat=weapon`,
   `/codex/index?kind=blueprint&group=fps`.
2. **IM HANGAR** zone gets the same line: `Archiv › Schiffe · Komponenten ·
   Waffen · Baupläne` → `/codex/index?kind=ship`, `?kind=component`,
   `?kind=weapon` (ship weapons: non-FPS classes), `?kind=blueprint&group=vehicle`.
3. **The `versum` section is removed** from the landing: eyebrow, keybinds
   link, domain chips, "Auf dem Reißbrett" rail and their styles/computeds.
4. **Keybindings** move into the terminal row (icon link next to the
   download menu).
5. **Blueprint sub-filter:** the index accepts `group=fps|vehicle` and shows
   a small segmented control (Alle · Zu Fuß · Fahrzeug) for blueprints;
   `fps` = FPSArmours + FPSWeapons, `vehicle` = VehicleComponentS* +
   VehicleWeaponsS*. Weapon class preset via query param for ship weapons.
6. **Counts** on the quick-access links: quiet, tabular, only where an
   existing query already provides them (entity counts / FPS counts); no new
   data sources. A link without a known count shows none.
7. i18n DE/EN for every new label; `codex.landing.versum.*` keys retired.
8. Specs updated (landing: versum assertions → archive-line assertions +
   keybinds in terminal; list: group param).

## Decided by default (owner left the Ⓗ questions unanswered; Ⓔ shows the
page ending with the surface)

- Reißbrett rail: **off the landing**; the announced ships stay reachable via
  `/codex/upcoming` (index category strip). → revisit item in the final
  report.
- Patch-delta line: **dropped** (not part of Ⓔ). → revisit item.
- Unfiltered archive entry: the terminal search covers it. → revisit item.
- The "Im Verse" rename is moot (the plane is gone).

## Corridor

Round 1 fixed "the panel above stays untouched". The owner widened it in
round 2 in their own words and confirmed by choosing Ⓔ (which states
"Korridor: erweitert (dein Votum)") and clicking Implement. Scope of the
widening: exactly one prio-3 line per zone plus the keybinds icon in the
terminal row — no other change to AN BORD / IM HANGAR.
