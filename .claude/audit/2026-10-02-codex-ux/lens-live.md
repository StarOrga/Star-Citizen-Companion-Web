# Codex UX audit — live lens (2026-10-02)

Method: own `ng serve` on 127.0.0.1:4311 (cloud Supabase, real data), Playwright 1.63 headless Chromium,
signed in through `scripts/playwright/test-session.cjs` (test account), locale de-DE, 1440x900 and 390x844 (isMobile).
Probe scripts lived in the session scratchpad. Screenshots: `.claude/audit/2026-10-02-codex-ux/shots/`.
Side effect: the test account now owns an empty FPS set **"Audit Test Claude"** (`4ef55042-be6a-458b-9b54-7586ff558ede`).
It was created for REQ-2, and the helmet and weapon were removed again afterwards. Delete it via Hangar → Rollen-Loadouts → LÖSCHEN.

## Findings (ordered by severity)

AUD-L01 [visual] severity critical
  Page/route: /codex (landing search results), desktop + mobile
  What: Every search hit card is covered by a giant white box with a black star (the compare "pin" button). The hit name, kind and manufacturer are pushed into a ~40px sliver, so the results can't be read.
  Evidence: shots/search-landing-Gladius.png, shots/search-landing-Gladius-mobile.png. Root cause: the template renders `<button class="pin"><svg class="icon">` but the component has no `.pin` rule. `.icon { width:100%; height:100% }` (codex-landing.component.ts:357) inflates the SVG inside an unstyled native button.
  Fix: Add a `.pin` style (28–32px square, transparent background, token border, `.pin .icon { width:16px; height:16px }`, `.pin.pinned` accent) to `src/app/codex/codex-landing.component.ts`, or reuse the pin style from codex-list.
  Effort S · Confidence 95

AUD-L02 [functional] severity high
  Page/route: /codex landing search ("Arsenal-Terminal")
  What: An exact name ranks below liveries, posters and skins. The base item is often missing from the first screen.
  Evidence: "Gladius" puts 6 liveries/items (Deck the Hull Livery, Disrupt Camo…, "Gladius Dunlevy" as GEGENSTAND) before the ship "Aegis Gladius". "glad" puts 6 Gladiator posters/liveries/ship armor first. "Cutlass Black" puts the Plushie and 4× "Ship Armor" before the ship. "P4-AR" shows only skins ("Blacklist", "Boneyard"×2 …), not the base "P4-AR Rifle". "Arrowhead" shows only skins, not "Arrowhead Sniper Rifle". (search.cjs output; the index and FPS pages rank correctly for the same terms.)
  Fix: In `codex-poly-search.ts` ranking, score exact name > prefix > word-prefix > substring. Weight kind (ship/weapon base > component > item/livery/poster). Collapse skins/liveries under their base, the way FPS shows "+7 Skins".
  Effort M · Confidence 90

AUD-L03 [functional] severity high
  Page/route: /codex landing results, Ctrl+K quick search, /codex/bridge lane
  What: The result lists show identical duplicate rows.
  Evidence: Landing "Cutlass Black" → "Cutlass Black Ship Armor" ×4. "glad" → "Gladiator Ship Armor" ×3. "Aegis" → "Aegis Eclipse | SCHIFF" ×2. Ctrl+K "Gladius" → "Aegis Gladius - Decoy Launcher" ×3 (also shows the code "AEG" instead of the manufacturer name). Bridge "Frisch in diesem Patch" shows "Aegis Eclipse" twice (shots/codex_bridge-desktop.png).
  Fix: Dedupe on (kind, display name, manufacturer). Where class names differ, collapse them into one row with "+n Varianten". Files: codex-poly-search.ts / quick-search component / codex-bridge.component.ts.
  Effort M · Confidence 85

AUD-L04 [functional] severity high
  Page/route: /codex landing, /codex/index?kind=ship
  What: A false positive: "P4-AR" returns "Drake Caterpillar 2949 Best In Show Edition" (ship) and "Stellate" (component).
  Evidence: Landing "P4-AR" lists Caterpillar Best In Show + Stellate after the skins. /codex/index?kind=ship&q=P4-AR → "1 ERGEBNIS: Drake Caterpillar Best In Show 2949 Edition".
  Fix: Check which field matches. The hyphen probably splits the term into tokens ("p4"/"ar") that are OR-matched against non-name fields. Require all tokens to match name/className, or match the un-split term first (codex-poly-search.ts / codex.service.ts search query).
  Effort S · Confidence 75

AUD-L05 [ux] severity high
  Page/route: all search surfaces
  What: German terms find nothing although the UI is German. The data names are English and there is no DE→EN synonym layer.
  Evidence: Landing and index: "Gewehr" and "Rüstung" → 0 hits ("Keine Treffer für „Gewehr“"). FPS "Gewehr" finds only German-named skins ("P4-AR-Gewehr (Knochen)"), never the base "P4-AR Rifle". Upcoming "Bergbau" → 0 while the role reads "MINING". Keybinds "Strg" → 0 (keys show "lctrl"). "Helm" works only by accident (substring of "Helmet").
  Fix: Add a small synonym map used by every search (Gewehr→rifle, Pistole→pistol, Rüstung→armor/armour, Helm→helmet, Rucksack→backpack, Bergbau→mining, Strg→ctrl, Umschalt→shift …). Also match the category/role labels the UI shows (e.g. "Primärwaffe").
  Effort M · Confidence 85

AUD-L06 [ux] severity high
  Page/route: landing, /codex/index, /codex/fps, /codex/upcoming
  What: There is no typo tolerance or "did you mean": a one-letter typo returns an empty state.
  Evidence: "Gladus" → landing "Keine Treffer", index "Noch nichts hier" (shots/search-index-zzzz.png shows the same state). FPS "Arowhead" → 0. Upcoming "Arastra" → "Keine Treffer".
  Fix: When there are 0 hits, run a name-only edit-distance fallback (≤2) and show "Meintest du: Gladius?" as a link in the empty state.
  Effort M · Confidence 90

AUD-L07 [ux] severity high
  Page/route: /codex/index (kind tabs)
  What: The kind stays on Schiffe while you type. When the term exists only in another kind, the list shows "Noch nichts hier — Keine Einträge passen zu Suche oder Filtern". Its only CTA, "Suche & Filter zurücksetzen", throws the query away. The "Auch gefunden in: Waffen, Gegenstände" line above is the only hint.
  Evidence: /codex/index?kind=ship&q=Arrowhead, q=Pembroke, q=Behring and q=Helm all show the empty state (shots/index-arrowhead-ships-empty.png).
  Fix: If the active kind has 0 hits and others have hits, switch to the best kind automatically (keep `q`). Otherwise the empty state lists "In Waffen gefunden (1) →" links before the reset button. File: `src/app/codex/codex-list.component.ts`.
  Effort S · Confidence 85

AUD-L08 [ux] severity high
  Page/route: /codex/fps (Waffen/Rüstung tabs)
  What: Search is scoped to the active tab and gives no cross-tab hint. Unlike the index, there is no "Auch gefunden in".
  Evidence: /codex/fps?cat=weapon&q=Pembroke, q=Helm and q=Rüstung → "Noch nichts hier". The items exist under Rüstung.
  Fix: Count the other tab for the same `q`. Show "In Rüstung gefunden (n) →" in the empty state and as a count on the tab. File: `src/app/codex/fps-list.component.ts`.
  Effort S · Confidence 90

AUD-L09 [ux] severity high — REQ-2
  Page/route: /codex → /hangar → /codex/set/:id → /codex/fps?equipInto=
  What: There is no discoverable path to "put this item into my FPS set" from the Codex.
  Evidence (fresh visit, test account with no sets):
    1. On the landing, the person half says "Unkommissioniert". The figure is not a link, and "SETS ▸" leads to /hangar, out of the Codex.
    2. The plain FPS list and the weapon detail page have no equip/"add to set" control (0 `.equip-btn` on /codex/fps?cat=weapon). Only ☆ (favourite) and "Vergleichen" exist.
    3. You can create a set only in Hangar → "Rollen-Loadouts" (name field + ERSTELLEN). After ERSTELLEN the page stays on /hangar; it does not open the new set (shots/fps-flow-04-hangar-set-created.png).
    4. Only the set page's slot tiles link into an equip-mode FPS list (`?equipInto=`).
  Fix: (a) On FPS cards and the weapon/armor detail page, add an "Zu Set hinzufügen ▾" action with a set + slot picker (create a new set inline). (b) Give the landing person half an empty-state CTA "Erstes Set anlegen". (c) After creating a set, navigate to /codex/set/:id.
  Effort L · Confidence 85

AUD-L10 [ux] severity high — REQ-2
  Page/route: /codex/set/:id
  What: The six armour tiles carry no visible slot name. "Helm:", "Torso:" and so on are screen-reader text only. The tiles show a tiny icon + "Frei · 677 im Arsenal / Im Arsenal ausrüsten →". On mobile the text is cut off: "Frei · 474 im Ars…", "Ace Interceptor …".
  Evidence: shots/fps-flow-05-set-page.png (desktop), shots/codex_set_4ef55042-be6a-458b-9b54-7586ff558ede-mobile.png.
  Fix: Show the slot name as the tile's first line ("HELM"), with the count/item name on the second line. On narrow widths, let the name wrap to 2 lines instead of truncating. File: `src/app/codex/set/codex-set-stage.component.ts`.
  Effort S · Confidence 85

AUD-L11 [ux] severity high — REQ-2
  Page/route: /codex/fps?…&equipInto=
  What: The equip control is cryptic and sits below the fold. It reads "IN SLOT:" + a small "HELM" / "PRIMÄRWAFFE" button (55x32 px). The first one sits at y=878 of a 900px viewport, under four filter rows and an info banner.
  Evidence: shots/fps-flow-06-equip-helmet-list.png. Helper output: `.equip-btn` "HELM 55x32 y=878".
  Fix: Make it a primary button "Als Helm ausrüsten" (≥44px) next to the card title. Consider collapsing filters in equip mode, since the slot filter is already set. File: fps-list.component.ts (`.equip-row` / `.equip-btn`).
  Effort S · Confidence 85

AUD-L12 [functional] severity high — REQ-2
  Page/route: /codex/fps?cat=armor&slot=Helmet&equipInto=<id>
  What: In equip mode, "Suche & Filter zurücksetzen" drops the slot scope. The URL becomes `?cat=armor&equipInto=<id>` and "Zeigt nur, was in „Helm“ passt" disappears. The band still says equip mode, and all armour across all slots is listed.
  Evidence: Step run s7: after reset `{url:"?cat=armor&equipInto=…", band:true, slotSel:false}`.
  Fix: The reset must keep `slot` / `equipSlot` / `equipInto` and clear only q/manufacturer/size/grade (fps-list.component.ts reset handler).
  Effort S · Confidence 90

AUD-L13 [visual] severity high
  Page/route: /codex/bridge, desktop + mobile
  What: The page scrolls horizontally: the "Frisch in diesem Patch" lane overflows the document.
  Evidence: documentElement.scrollWidth 4003 (desktop, client 1440) / 3912 (mobile, client 390). On mobile `window.scrollTo(200,0)` → scrollX 200. Overflowing nodes: `A.lane-card`, `DIV.lane-thumb`.
  Fix: Give the lane container `overflow-x: auto; overscroll-behavior-x: contain; max-width: 100%` (codex-bridge.component.ts).
  Effort S · Confidence 85

AUD-L14 [ux] severity high
  Page/route: /codex/fps (mobile 390)
  What: The filter panel (search + Waffentyp + Hersteller + Größe + checkbox) fills the whole first viewport. No result is visible without scrolling. Equip mode makes it worse, because the equip band is added on top.
  Evidence: shots/codex_fps-mobile.png.
  Fix: On narrow widths, keep the search visible and collapse the selects behind a "Filter (n)" toggle (fps-list.component.ts; codex-list has the same pattern).
  Effort M · Confidence 80

AUD-L15 [accessibility] severity medium
  Page/route: landing, index, fps, keybinds, upcoming search inputs
  What: The result lists can't be reached by keyboard from the field. ArrowDown keeps focus in the INPUT, with no aria-activedescendant. Enter does nothing on the landing (stays /codex). On /codex/bridge, Enter opens the top hit (/codex/ship/AEGS_Gladius), and the Ctrl+K palette supports arrows (aria-activedescendant=qs-opt-1). The behaviour is inconsistent.
  Evidence: search.cjs "KEYS" lines per surface.
  Fix: Give the landing terminal the combobox pattern (role=combobox, listbox, aria-activedescendant; Enter opens the first/active hit; Escape clears and then blurs). Reuse the quick-search implementation.
  Effort M · Confidence 85

AUD-L16 [visual] severity medium
  Page/route: landing, index, bridge search fields
  What: Each field shows two clear buttons: the native WebKit search-cancel "×" (blue) and the custom "×".
  Evidence: shots/search-landing-Gladius.png (x≈856 and x≈894), shots/search-index-zzzz.png, shots/search-bridge-Gladius.png.
  Fix: Add `input[type=search]::-webkit-search-cancel-button { -webkit-appearance: none; }` in src/styles.scss, so only the app-styled clear remains.
  Effort S · Confidence 90

AUD-L17 [functional] severity medium
  Page/route: /codex/keybinds
  What: The query is not kept in the URL, unlike every other Codex search. A reload, Back or shared link loses it.
  Evidence: After typing "Landung", "Quantum" and others, the url stays `/codex/keybinds` (search.cjs).
  Fix: Sync `q` (and the device tab) to query params with replaceUrl (`src/app/codex/keybinds.component.ts`).
  Effort S · Confidence 90

AUD-L18 [ux] severity medium
  Page/route: /codex/keybinds
  What: The list mixes raw data with translated text. Action names are half German, half English ("Toggle Refuel Operator Mode", "Weapon Presets - Set Quantum Jammers"). Raw action ids are shown ("v_toggle_guns_mode"). Keys appear as raw tokens ("u+lshift", "lalt+n", "comma", "mouse1"). The single key "F" matches 527 of 1103 actions (substring over all text).
  Evidence: walk.cjs text dump of /codex/keybinds; search.cjs "F" → "527 von 1103".
  Fix: Render keys through `keybind-format.ts` (Shift, Alt, Komma, Maus 1). Hide the raw id behind a toggle. A 1–2 character query should match the key exactly, not as a substring.
  Effort M · Confidence 80

AUD-L19 [ux] severity medium
  Page/route: landing vs /codex/index vs /codex/fps
  What: The same item has different names on different surfaces, so the same search finds different things.
  Evidence: The landing shows "Pembroke Backpack", but index item shows "Pembroke-Rucksack". The FPS base reads "P4-AR Rifle", but its skins read "P4-AR-Gewehr (Knochen)".
  Fix: Use one localized display-name source for every surface, and search both the localized and the original name.
  Effort M · Confidence 75

AUD-L20 [ux] severity medium — REQ-2
  Page/route: /codex/fps equip mode
  What: Confirmation behaves differently for armour and weapons. Equipping armour navigates straight back to the set. Equipping a weapon stays on the list with a toast ("✓ P4-AR Rifle ausgerüstet in Primärwaffe — Zurück zum Set"). Removing armour stays on the list. The query params also differ: armour uses `slot=`, weapons use `equipSlot=`.
  Evidence: Step run s5 (armour click → url /codex/set/<id>; weapon click → stays, confirm text) and s7.
  Fix: Use one behaviour for both (stay + toast with "Zurück zum Set") and one param name (codex-set-stage / codex-set-gear links + fps-list).
  Effort S · Confidence 85

AUD-L21 [ux] severity medium — REQ-2
  Page/route: /codex/set/:id
  What: An equipped armour tile has no remove or replace control. Weapons have "ÄNDERN" and "LEEREN". To remove a helmet you go to the list, find the same item and press "✕ Aus Helm entfernen".
  Evidence: Set page after equipping: the tile shows only "Ace Interceptor Helmet". The weapon slot shows "ÄNDERN … LEEREN" (step run s5 clickables).
  Fix: Add an "Leeren" icon button to filled armour tiles (codex-set-stage.component.ts).
  Effort S · Confidence 85

AUD-L22 [functional] severity medium
  Page/route: /codex/set/:id vs /codex/fps?slot=Helmet
  What: The slot counts don't match. The helmet tile says "Frei · 677 im Arsenal", but the slot-filtered list shows "644 ERGEBNISSE".
  Evidence: Step runs s3 and s4.
  Fix: Compute the tile count with the same filter as the list (probably variants/AI templates included in one and not the other).
  Effort S · Confidence 70

AUD-L23 [ux] severity medium
  Page/route: /codex/bridge
  What: "Frisch in diesem Patch" shows the alphabetical start of the ship list (Avenger Stalker, Titan, Warlock, Eclipse ×2…), not ships that are new in the patch. The "Vorgestelltes Schiff" is also just the first ship alphabetically.
  Evidence: shots/codex_bridge-desktop.png.
  Fix: Feed the lane from the build diff (codex-build-diff.ts), or rename it.
  Effort S · Confidence 70

AUD-L24 [ux] severity medium
  Page/route: /codex (landing, new user)
  What: The empty states are dead ends. The hangar half is a large empty dark panel ("Noch kein Schiff beansprucht.") with no CTA. The person half ("Unkommissioniert", "RÜSTUNG 0 / 6") is not clickable.
  Evidence: shots/codex-desktop.png.
  Fix: Add CTAs: "Schiff suchen" (focus the terminal) and "Erstes Set anlegen" (see L09) (codex-landing.component.ts stage halves).
  Effort S · Confidence 80

AUD-L25 [ux] severity medium
  Page/route: /codex/weapon/behr_rifle_ballistic_01
  What: The data contradicts itself and shows raw enums. The description says "Rate Of Fire: 550 rpm", but the parameter block says "FEUERRATE 810 rpm". "ANBAU-TYP WeaponPersonal" and "UNTERTYP Medium" are untranslated. "Vollständigen Bauplan öffnen" is 15px tall on mobile.
  Evidence: walk.cjs text dump (desktop + mobile).
  Fix: Map attach-type and subtype through i18n. Flag or explain the description-vs-datamined mismatch ("Beschreibung von CIG, Werte aus dem Build"). Pad the link to 44px (codex-weapon-detail.component.ts).
  Effort S · Confidence 80

AUD-L26 [ux] severity medium
  Page/route: /codex/ship/AEGS_Gladius
  What: The left "Einordnung / Kampf-Profil" card renders an empty dark chart box. In the 3D component list, every component reads "0 im Modell · Position im Modell unbekannt" (REQ-5 hotspots).
  Evidence: shots/codex_ship_AEGS_Gladius-desktop.png. Text dump: "GENERATOR 1 verbaut · 0 im Modell … Position im Modell unbekannt" for all groups.
  Fix: Check whether the chart needs WebGL/canvas that failed headless (log said "GPU stall due to ReadPixels"). If the data is missing, show the profile's empty state instead of a blank box.
  Effort M · Confidence 60

AUD-L27 [ux] severity low
  Page/route: /codex/bridge
  What: The bridge search covers ships only, and its empty state says "Keine Einträge passen zu Suche oder Filtern" on a page that has no filters. "Arrowhead" → that message, with no pointer to FPS. The placeholder is also cut off on desktop ("Codex scannen — Schiffsname oder").
  Evidence: search.cjs bridge block; shots/codex_bridge-desktop.png.
  Fix: Use a bridge-specific empty text with links to the index/FPS search for the same `q`, and a shorter placeholder.
  Effort S · Confidence 80

AUD-L28 [functional] severity low
  Page/route: landing, index
  What: Whitespace is not trimmed. `q=%20%20Gladius%20%20` lands in the URL, and the landing heading reads '" Gladius "'. "%" is treated as empty (the full list "41 von 319"), and "<b>x" matches "Sabre Raven EX".
  Evidence: search.cjs index/landing blocks.
  Fix: Trim before writing to the URL and the heading. Strip punctuation-only queries consistently.
  Effort S · Confidence 70

AUD-L29 [ux] severity low
  Page/route: /codex/blueprint/BP_CRAFT_AMRS_LaserCannon_S1
  What: The ingredient name is doubled ("Agricium Agricium"). The quantity "× 0,36" has no unit. "Herstellungszeit 9 m" is ambiguous (min vs m).
  Evidence: walk.cjs text dump (both widths).
  Fix: Show the name once (class name in a second, smaller line), add the unit (SCU/cSCU), and write "9 min" (blueprint-detail.component.ts).
  Effort S · Confidence 70

AUD-L30 [ux] severity low
  Page/route: /codex/upcoming, /codex/upcoming/260
  What: Raw English matrix values appear in the German UI: "TYP industrial" (lowercase), roles "MINING / REFINING", "HEAVY REPAIR", "PASSENGER".
  Evidence: walk.cjs text dumps.
  Fix: Map type/role through i18n with a capitalised fallback (upcoming-grid / upcoming-detail).
  Effort S · Confidence 75

AUD-L31 [accessibility] severity low
  Page/route: set page, FPS equip, hangar cards, detail back links (mobile)
  What: Many touch targets are under 44px. Set lens chips are 24px tall; "← Zurück zum Codex" is 126x18; the armour equip button is 55x32; hangar card actions (UMBENENNEN/TEILEN/LÖSCHEN) are 22px tall; "Vollständigen Bauplan öffnen" is 166x15.
  Evidence: steps.cjs CLICKABLES sizes, walk.cjs `small` lists.
  Fix: Raise the hit area to min-height 44px under `(pointer: coarse)` (the memory notes the gate measures 43px, so target 48px).
  Effort S · Confidence 80

AUD-L32 [ux] severity low
  Page/route: /codex/set/:id
  What: "← Zurück zum Codex" is hard-wired. Arriving from the Hangar, "back" goes to /codex instead of the Hangar.
  Evidence: Step run s3 (hangar → set page shows "Zurück zum Codex" → /codex).
  Fix: Use history back when the previous in-app route exists; otherwise /codex (codex-set.component.ts top-row).
  Effort S · Confidence 70

AUD-L33 [ux] severity low
  Page/route: /codex/index, /codex/fps
  What: Typed queries replace the history entry, so browser Back after searching leaves the page instead of restoring the previous query. This is defensible, but it means no query history.
  Evidence: flow1.cjs: Gladius → Cutlass, then Back → /codex (no ?q=Gladius step).
  Fix: Optional: push a history entry when the debounced query settles (≥800 ms idle), replace while typing.
  Effort S · Confidence 60

## Open questions (no hard evidence)

- /codex/upcoming at 390px rendered a fully blank page (not even the shell) at 6 s (shots/codex_upcoming-mobile.png). At 12 s it was complete (shots/codex_upcoming-mobile-12s.png). Desktop was fine at 6 s. Was this a slow first lazy-chunk compile in the dev server, or a real missing loading state? Re-check on a prod build.
- One `HTTP 401 POST /rest/v1/rpc/my_account_status` + console error appeared during the equip flow (step run s5). Possibly a token-refresh race in a fresh headless context; not reproduced.
- Ship detail 3D hotspots (REQ-5): "0 im Modell" may come from headless WebGL ("GPU stall due to ReadPixels") rather than data. Verify in a real browser.
- Whether the index's "Auch gefunden in: Waffen …" entries are clickable links. The probe could not identify them as anchors/buttons with an also/found container class. If they are plain text, L07 gets worse.
- Many `net::ERR_ABORTED` image requests to `storage/v1/object/public/codex-previews/desktop/VehicleIcon_*.webp`. These look like cancelled lazy loads during navigation, not 404s; no 4xx was seen for them.
