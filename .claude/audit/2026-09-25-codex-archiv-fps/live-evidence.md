# Live evidence — Claude_Browser pane, admin session, dev server 127.0.0.1:4200 (cloud Supabase)

Date 2026-09-25. Viewports: 1280×800, 1280×1300, 375×812 (emulated).

## /codex/index (1280)
- Back link "← Zurück zur Brücke" (accent, 11.7 px); title "Codex — Index-Modus".
- Ship tab, first page: 41 cards; `SalvageableDebris_AvengerTitan` renders as a second "Aegis Avenger Titan" card.
  DB (current build): 6 `SalvageableDebris*` rows + `Orbital_Sentry_PU_NineTails(_Size2)` + `probe_comms_1_Ninetails` in `codex_ships`, none flagged `is_variant`.
- `.badge.mfr` background `color(srgb 1 0.34 0.13 / 0.14)` = `--sc-accent-hot` (#ff5722). RULE-C.
- 41/41 cards contain `<button>` inside `<a class="card">`.

## /codex/fps (1280)
- While loading: result head reads "0 ERGEBNISSE" above the skeletons.
- Search placeholder: "Name oder Klasse suchen (z. B. Gladius, AEGS_*)…" — ship examples on the on-foot page.
- Weapons, first page: "413 Ergebnisse · 18 von 413 angezeigt" (60 raw rows fold into 18 cards).
- First card "volt smg energy 01 black01" — DB `name_localized` = "! GERMAN_(GERMANY) TRANSLATION NOT FOUND FOR LOCID: … !", `payload.name.en` = "@item_Name…" → sorts first because "!" < letters.
- C54 liveries (`"Justified"`, `"Luckbringer"`, `"Ochelo"`, `"Origin Racing"`, `"Scorched"`, `"Starchaser"`, `C54-MP (Luminalia)`) render as 7 separate cards: the base `gmni_smg_ballistic_01` is not on page 1 (`C54 "…"` sorts before `C54 SMG`).
- "A03 Akuma Sniper Rifle" (`…_store02`) not folded into "A03 Sniper Rifle (+7 Skins)".
- Manufacturer badge "PH  Unknown Manufacturer" (Boomtube); codes "VOLT", "LBCO" not spelled out.
- Armor tab: "2441 Ergebnisse · 60 von 2441"; first 12 cards unnamed (same "! … NOT FOUND" sentinel: 12 armor rows, 1 FPS weapon row in the current build).
  Badges "UNDEFINED" (undersuit sub_type), "Helmet | Helmet" duplicate, slot facet options "Arms/Helmet/Legs/Torso/Undersuit" and weight classes "Light/Medium/Heavy" in English on the German UI.

## /codex/fps?cat=armor&slot=Helmet&equipInto=<set> (1280) — equip mode, no write performed
- Bar "Ausrüsten für: FixIt · TECHNIK" + "Zurück zum Set" → href `/codex?zone=board&set=…` (landing, not the set page).
- First 6 helmet cards unnamed raw class names with the generic placeholder icon.

## /codex/set/:id (1280×1300)
- `/codex/set/none` → loading state is a bare "…", then note "Dieses Set wurde nicht gefunden — das erste Set aus deinem Hangar." (correct).
- Clicking the stage picker entry "FixIt" (valid id) → URL becomes `/codex/set/4970efb2-…`, the "nicht gefunden" note STAYS (component reused, `:id` read once from the snapshot).
- `--idle` on `.board-wrap`: undefined. Open slot label colour rgb(232,235,237) (white, not blue-grey); `.board-sq.empty` background transparent, border none (squares invisible); `.rdy-ic` border none, background transparent.
- Set switcher `.dial-node` href `/codex?zone=board&set=…` (landing).
- Figure rendered twice (stage hero + board panel), set name shown three times, role "Technik" three times; no row for weapon/tool slots (engineering role: multitool, repair-attachment, tractor).

## 375×812 (phone)
- /codex/index, /codex/fps, /codex/blueprint, /codex/set/:id: scrollWidth 375 — ok.
- /codex/keybinds: scrollWidth 417 — `.devices` segmented control 405 px wide in a 351 px row ("JOYSTICK" clipped).
- /codex/item/basl_combat_light_helmet_02_01_01: scrollWidth 573–575 — "Rüstungswerte" `.stat-grid` scrollWidth 544: long raw labels ("Radiation Resistance.Maximum Radiation Capacity") and values ("playerhits_armour_light") do not wrap.
- /codex/weapon/klwe_pistol_energy_01: scrollWidth 534 (same stat-grid pattern).
- /codex/component/SHLD_AEGS_S04_Reclaimer_SCItem, /codex/blueprint/BP_CRAFT_…, /codex/ammunition/12g_ballistic_1: 375 — ok.
- Armor stat labels are raw English dotted keys; engine internals shown ("Hit Effect Lib Name: playerhits_armour_light", "Other Params.animspeed").

## Console
- No console errors across the walk.
