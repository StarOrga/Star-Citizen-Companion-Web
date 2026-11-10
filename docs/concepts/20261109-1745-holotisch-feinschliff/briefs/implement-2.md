# Implement brief 2 — after the round-5 review (concept 20261109-1745)

Branch `claude/batch-fb8929` (head after round 5: `e375bbb0`). Still **do not ship**: no merge to main, no PR, no db push, no function deploy. Scope: Holotisch beta view, plus the hangar save layer it uses.

## Decisions (round 5, all recommendations taken)
- r5-wish = loadout: the wishlist stores the loadout together with the wish.
- r5-nested = nested: extend the hangar config so nested ports (a gun in a gimbal) can be saved.
  User note, verbatim: „also wenn man nicht in codex, aber in seinem eigenen schiff arbeitet sollte jede änderung direkt gespeichert werden gern mit toast rechts unten (leicht verzögert, falls man mehrere dinge direkt in wenigen sekunden setzt)“
- r5-ai = with: deploy exemplar-ai with the ship of this branch. Nothing to build now.
- r5-bugs = fix: fix the swap pickers in this branch. Kühler/Schild/Quantenantrieb/Lebenserhaltung show „0 von N — Kein Teil passt“, and the Gatling picker's name column wraps letter by letter.
- r5-rooms = uploader: the room→deck assignment in the uploader is a separate task, not in this branch.

## Pins on the screenshots (verbatim)
- s7 Innen: „RÄUME SOLLTEN AUCH UNTEN IN INNEN SEIN; SO WIE ES AUCH AUssen gibt!“
- s11 Balken: „das ist hier noch nicht hübsch aufgabeut mit der vergleich mit und hexagon vs balken!“
- s15 Patch-Auswahl: „vergleich beenden benötigt es nicht, einfach ein reset icon rechts neben den beiden auswahlne und fertig ohne aufklappen zu müssen“

## Checklist
- D1 Wishlist with loadout: a wish can carry a loadout. „Auf die Wunschliste“ from a swapped Werk saves the swaps. The menu shows a wish with its ◆ count. Opening a wish shows its loadout.
- D2 Nested ports saveable: a gun inside a gimbal is stored in the config and applied back on load. The ◆ and Anpassungen show it after a reload.
- D3 Autosave on your own exemplar: when the shown loadout is an own exemplar (not Codex/Werk), every swap is saved automatically. Saves are debounced (~1.5–2 s, so several swaps within a few seconds become one save) and confirmed by ONE toast bottom right („Gespeichert · N Änderungen“ + Rückgängig), positioned with the floating-surface tokens, never over the bottom row. Werk stays a sandbox: nothing is saved unless the user chooses to.
- D4 Swap pickers: the category filters return parts for Kühler/Schild/Quantenantrieb/Lebenserhaltung (root cause first). The name column never wraps per letter.
- D5 Innen in the bottom row: like Außen, Innen shows one thumbnail per deck. When a deck has rooms, the rooms are reachable from there, e.g. the deck thumbnail plus room chips, or one thumbnail per room group, consistent with the Außen thumbnails. A ship without decks shows one „Innen“ thumbnail as today.
- D6 Einordnung layout: „Vergleich mit“ picker and the Hexagon/Balken switch arranged cleanly in one tidy header row. Aligned, same heights, no orphaned info icon. Both chart modes keep the same card height.
- D7 Patch-Vergleich: no „Vergleich beenden“ button. A reset icon button (scAction tertiary, aria-label + tooltip) sits right of the two pickers and resets to the default comparison. Nothing has to be expanded.
- D8 Remaining from round 5: the exemplar name dialog must not wait for the undeployed `exemplar-ai` (2 s client timeout). Shot 15: the tooltip over the tab and the open picker over the buttons. Shot 05: the callout flush to the frame edge. Shot 09: the livery tooltip over the „Lackierung“ label.

## Result after wave 9 (for round 6)
Branch head `dd3ba5db` after the fix "removing the open exemplar no longer leaks its swaps into Werk". QA wave 10: lint 0 errors; codex 2667, hangar 192, hq 712, shared 181 specs all green; build green. 15 screenshots in `shots-r6/`.
- D1 partial: the menu shows „Auf die Wunschliste · mit 2 getauschten Teilen“. Saving a wish with its loadout needs migration `20261110120000_hangar_config_wish_and_nested.sql` (not pushed). Until then a wish keeps only the hull and the menu says so.
- D2 done: the nested Gatling persists after autosave and reload (`hardpoint_gun_nose.hardpoint_class_2`, fits the existing jsonb).
- D3 done: one toast „Gespeichert · 1 Änderung“ after ~1.9 s. Werk stays a sandbox.
- D4 done (Kühler 24 of 24, Gatling column wraps by word). D5 done (Carrack Deck 01–04 + room chips, Gladius „Alle Räume“ + Cockpit). D6 done. D7 done.
- Fixed after QA: removing the open exemplar leaked its swaps into the Werk draft.
- Remaining (Restpunkte):
  - Carrack room highlight is weak (only one dot turns cyan, the plan has no room area there).
  - Hexagon legend footnote clipped at the card bottom (shot 01).
  - „QUERSCHNITT“ wraps on the Carrack Balken (shot 04).
  - The wish menu row wraps („Auf die / Wunschliste“).
  - One 400 on `ai_summary` per exemplar load until the migration is pushed.
  - Stage CSS +2.85 kB over its budget (warning).
