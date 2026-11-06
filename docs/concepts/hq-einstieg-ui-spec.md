# HQ entry: living UI spec

The next concept for the HQ entry reads this first and continues it. Source: concept `20261106-0842-hq-einstieg-landing` (rounds, `-decisions.json`, `briefs/implement.md`). It supersedes D1, D8 and D9 of the `2026-10-30-hq-beta-einstieg` ledger and the friends line of its social part.

## Accepted

- Page order: Start, Bestand, Jetzt, Planen, Statistik, the same on the rail, the phone bar and the cue.
- Start: the standard hero; below it Bestand left, Jetzt open in the centre, Planen right, Statistik as a quiet centred text link. Places never change by state or player type.
- Side tiles in the "Lichtkante" style: no box, a light edge on top, text leaning to the centre. Real page icons.
- A whole tile leads to its page; an inner target with its own destination (Route öffnen, RSI-Hangar holen, the centre button) sits above that link.
- Jetzt offline: last signal plus the app button. Jetzt live: green label, system, place, ship, soft blurred rings breathing in 7 s, only while connected. The button shows the next step of the first planned Einsatz; none planned, no button.
- App button: no account game signal and no local memory says "SCC-App downloaden" and downloads directly; otherwise "SCC-App starten" with the download as fallback. A running game also sets the local memory.
- A patch hit replaces eyebrow and title in the hero like on Codex. Only the most important hit, no rotation (default; the question stayed unanswered).
- Hotkeys 1 to 4 are never visible at rest: "Hotkey: N" in a tooltip with the info delay on tiles, the Statistik link and the rail.
- Extra entries instead of reordering: PWA shortcuts to Bestand and Jetzt, plus the hotkeys.
- The page cue looks like the Verse cue, without a ground, and stands back while the current page runs on below the viewport.
- Wording: "Noch nichts geplant", "Jetzt planen", "Route" instead of "Weg".

## Rejected

- Four equal tiles, one tile as a hero, a separate tiles strip for Statistik.
- Custom order, one-time "where do you start?" questions, opening on the last visited page, "Weiter bei …".
- The first-visit block with steps, "Los geht's" and "Überspringen"; the friends line; the patch line under the title; the chips row.
- Boxed or tilted side panels and HUD brackets (seen in round 4, Lichtkante won).

## Open

- The live system line needs a planet from the app to read "Stanton › microTech".
- "37 von 212 Blueprints" needs a total.
- The patch hit shows a technical class name until a display name is available.
- Should the hero rotate between two patch hits?
