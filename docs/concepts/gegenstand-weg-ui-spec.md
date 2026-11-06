# Item path: living UI spec

The next concept for wishlist, Nachschub, Inventar or the action tiers reads this first and continues it. Source: concept `20261106-1150-gegenstand-weg` (rounds, `-decisions.json`, `briefs/implement.md` with every remark verbatim).

## Accepted

- Three parallel stops per item, never exclusive: Wunschliste, Nachschub, Inventar. Ships: Wunschliste, Nachschub, Hangar. Announced ships: only the wishlist, with the hint "noch nicht im Spiel".
- One read model and one service for every surface (`hq/data/item-path.service.ts`). One wishlist, also for announced ships; `hangar_concept_ships` is gone. Live ship wishes stay in `hangar_ships.status`, the wish tab shows both.
- The design "Bahn": `sc-item-path` in three levels. Tertiary = rail with count bullets, secondary = rail plus a pill naming the next step for this context, primary = full form.
- Click: an empty node adds, a filled node opens a popover with state, −/+, a real anchor to the list and "Entfernen". The empty Inventar node asks for the place at the icon. No column heads, tooltips only.
- Wish to Nachschub moves, undo via toast. Besorgt asks for the place and writes to Inventar; the line stays as done, because Planen reads done as "liegt bereit". "Nur abhaken" is the way out without stock. "Nachholen" on an Inventar row adds to Nachschub and leaves stock alone.
- Default place: the live location when known, else "Bei mir" (replaces "Ortsfrei").
- Blueprints have all three stops. Collected = Inventar at place "Blueprints". Nachschub carries the material with exact SCU amounts, one line per blueprint, linked by `for_class_name`; removing the blueprint takes its material along. The mission comes from `missionSource` in the build; "Zum Einsatz" creates the step.
- Tiers per surface: search panel and search rows tertiary; search opened from "Gegenstand suchen" secondary; Codex pages secondary; item reached from Planen or a set primary; holo drawer, slot and swap candidate tertiary; HQ Start and Jetzt display only; Inventar head one primary; Inventar row, need line, Hangar row, friend page tertiary; popup and wish lines secondary; news and patches none.
- `scAction` is the one action control: primary at most once per page, secondary pill, tertiary icon only with tooltip and aria-label. Not actions: chips, steppers, tabs, navigation, segment switches.
- Header: one bookmark icon with a count, panel with last 3 opened and wished of the page's type, in News last read and bookmarked, Nachschub tab inside. Hidden while empty.
- Words: "Inventar" for step 3 and the HQ page; `#bestand` stays an alias; "Hangar" for ships; "Kopie anlegen" for shared sets and variants; "Sets" instead of "Spind", because that tab holds FPS sets. No word "Merken" on game content; News shows the bookmark icon alone.
- Symbols: the star is gone from compare, announced favourites, flagship, set favourite and news. Compare is a balance scale, ⇄ stays for switching ship. Flagship: first in the list plus the text mark, no icon, set and unset in "Verwalten". One icon family in `shared/item-path/path-icons.ts`.
- "Link teilen" is the share FAB, only behind beta `shell`. The old hangar detail page redirects; its functions live in the "Verwalten" panel and the personal Codex view on `?v=`.
- Search: `gemerkt`, `wunschliste`, `fehlt mir`, `lager` and `inventar` list their own set alone and filter with a term; wished items rank first.

## Rejected

- Separate wishlist page and a second "merken" store; the star with several meanings.
- A column head over the rail: tooltips only.
- A route in the primary form ("mit Route? das macht keinen Sinn").
- "Lager" and "Bestand" as the name: "Lager" fails for what you only carry, "Bestand" reads as logistics.
- A flagship icon. Several header buttons in the Inventar head.

## Open

- Star toast keeps its ★: it is the Explorer achievement, not a favourite. Map legend keeps ★ as the mission shape.
- Rest of the app moves to `scAction`: StarOrga/Star-Citizen-Companion-Web#970.
- Consent for opened-page recents: StarOrga/Star-Citizen-Companion-Web#971.
- Same material from two blueprints shows as two lines with a shared total. Einsatz steps from an SCU need show the portion count, `hq_einsatz_steps.qty` is an integer.
- Blueprints whose pool no contract references stay without a mission (`STierReward`, `MissionModifier_TemporaryBlueprint` not followed). Search rows carry no mission target.
