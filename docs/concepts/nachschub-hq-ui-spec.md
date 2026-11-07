# Nachschub, Wunschliste, Bestand: living UI spec

The next concept or implementation for wishlist, Nachschub, Inventar, Hangar, Sammlung or the header quick-access panel reads this first and continues it. Source: concept `20261107-1410-nachschub-hq` (rounds, `-decisions.json`, `briefs/`). It supersedes the "three parallel stops" and "header bookmark panel" parts of `gegenstand-weg-ui-spec.md` and adds to `hq-einstieg-ui-spec.md`.

## Accepted

### Model
- One path: **Wunschliste → Nachschub → Bestand** (Inventar · Hangar · Sammlung). Shortcuts allowed: an item can go straight to Bestand; news and gallery go straight to Sammlung.
- **Wunschliste** = a shopping cart with **quantity** for everything, incl. ships (2× Cutlass) and material (raw materials do get a wishlist). Default quantity 1; stepper in the cart and on the Codex detail page, search rows show only the count. Presented as a cart popup; "Ganze Wunschliste" opens it (real anchor with its own URL).
- **Nachschub** = a named **package** built in HQ → Planen from wishlist items. Taking a wishlist position moves the full quantity by default; splitting (5 of 20) is allowed, the rest stays on the wishlist. A package is planned as a whole and holds 1–x Einsätze (Missionen, Bergbau, Handel …).
- Up to **7 active package slots**; more are archived ("Neuer Nachschub" is blocked with a hint while all 7 slots are active).
- Package and Einsatz names: AI suggestion on creation (package = what you get, Einsatz = what you do, within character limits), always editable, rule-based fallback. Via an Edge-Function proxy, never a client key.
- A line closes only when the inventory rose against a snapshot taken when the package was planned (manually or by the SCC-App live signal) or by a manual tick — never by time.
- "Nachschub leeren" any time: open lines go back to the wishlist, counted up there.
- Owning fulfils the wish (items like ships), with undo. A ship in Nachschub closes when it lands in the Hangar.
- **Sammlung** = Blaupausen, Ruf, News (formerly "Lesezeichen"), up-voted gallery wallpapers. Nothing changes visually in the gallery: an up-vote simply counts as collected. Ruf has no data source yet (manual entry or SCC-App signal needed). Finished missions go to Statistik, not Sammlung.
- Words: Inventar · Hangar · Sammlung; "Bestand" only as the rare umbrella (HQ page name). "Lesezeichen" disappears as a status; "Merkliste" disappears.
- Edge rules: the catalogue never deletes player data ("nicht mehr im Spiel"); an announced ship's wish follows it live; a pledged announced ship may sit in the Hangar; manual stock counts as owned everywhere; quantity 0 means "not there" everywhere; ship origin Pledge / Ingame / Leihschiff as an attribute; a second copy of a ship is allowed; a "Ingame-Bestand zurücksetzen" button for wipes (danger confirm).
- No guests: the login wall already gates every shell route (`app.routes.ts`); every signed-out branch is dead code to remove.

### Areas
- **Codex and search:** two nodes only — Wunschliste (with quantity) and Besitz. No Nachschub node outside HQ. Blueprint page: "Material ×N auf die Wunschliste", grouped under the blueprint / crafted item.
- **HQ Planen:** the up-to-7 package cards on top, "Neuer Nachschub" takes from the wishlist, each package lists its Einsätze and route. Every line is selectable (also loose lines without a set). Much more present than today's popup.
- **HQ Jetzt:** runs the Einsatz bundle of exactly one package and always shows which package it serves.
- **HQ Bestand:** Inventar · Hangar · Sammlung; per row a quiet hint ("auf der Wunschliste N" / "im Nachschub ‚Paket‘") plus "Nachholen" (= auf die Wunschliste); additionally **"Kürzlich aufgebraucht"** — only what was used up in the last 48 h, to re-wish quickly.
- **Header quick access ("Schnellzugriff"):** icon only in the header, the word appears only in the opened panel. Count = wishlist positions. Sections: Zuletzt geöffnet 3 (expand to 7), Wunschliste 3 + "Ganze Wunschliste", and a context Bestand section (Hangar / Inventar / Sammlung) filtered by page type; everything filtered by page type. No Nachschub. Pages without a type (HQ start, Verse, Social) show no Bestand section. On news pages the context section is Sammlung (collected news).
- **Migration:** existing open Nachschub lines become one package "Bisheriger Nachschub"; news bookmarks in localStorage are copied into the account's Sammlung on the next visit.

## Rejected
- Nachschub as its own sixth HQ page or as a Bestand tab.
- Three status nodes everywhere in the Codex; a Nachschub pill on Codex detail pages.
- Disappearing done lines after N days; closing lines by time.
- A guest storage of any kind.
- Panel names "Merkliste", the bookmark icon for the panel; the clock / wish / grid icons proposed in round 1.

## Open (for the design concept)
- The header icon: a blend of bookmark, cart, recent, gift, "will ich / brauch ich" — the user asked for creative visual proposals.
- Visual design of Planen package slots, Jetzt with its package, Bestand tabs incl. Sammlung and "Kürzlich aufgebraucht", the cart popup, the two-node path control with quantity.
- Ruf data source.

## Round 3 additions (design, favourite „Holo-Tafel“)
- No word „Paket“: the thing is a „Nachschub“ (plural „Nachschübe“), held in Nachschub-Slots. No word „Besitz“: Inventar (items), Hangar (ships, vehicles), Sammlung (blueprints, news, gallery). Names are never marked as AI.
- Header icon without count. Wunschliste section = last 3 added (type-filtered, else overall); context section = last 3 added to Inventar/Hangar/Sammlung of the type, same row look, deep link „Gesamtes Inventar“.
- Cart: grouped, whole group selectable, larger silhouettes, red trash to remove, plus a „Passt dazu“ row with exactly 3 deterministic suggestions — mechanism and scoring in `nachschub-recommendations-research.md`.
- Planen: delete a Nachschub (hover) or empty it with the choice „zurück auf die Wunschliste“ (checkbox, default on) or drop entirely; free slots show „+“; Einsätze are the primary structure; material in Einsatz planning is not grouped by blueprint, only labelled. „Neuer Nachschub“ is a 3-step flow (Auswählen → Zusammenfassung → Einsätze, toggle/split per item, crafting as the last Einsatz).
- SCC-App live ticker bottom-left on every HQ page except Start (green connected / grey off, last relevant event), only once the app was ever connected.
- Bestand: „+“ tile first for manual entries; „Kürzlich aufgebraucht“ (48 h) may be summarised. Sammlung tab keeps Blaupausen and Ruf; news and gallery show the Sammlung pattern inside their own subpages instead.
- Codex detail page is redesigned like the ship holotable subpage (silhouette ↔ 3D toggle), keeping every info block, with a Codex and an HQ variant; other ship subpages stay untouched. Inventar node clickable to add, then shows its stepper; Inventar link jumps to the item in HQ.
- Every page must fit the viewport without scrolling (1920×1080 and 1440×900, stress data).
- Open: can the SCC-App deliver Ruf (reputation)? If yes, ship it there (user request, round 3).

## Implementation: wave 1 (data and logic, shipped on the concept branch)
- Schema (migrations `20261107190000` .. `20261107190200`): `search_wishlist.qty` + `for_class_name` (part of the key, material is grouped under its blueprint), `hangar_ships.qty` + `origin`, `hq_supply_packages` (Nachschub: `name` <= 28, `status` active/archived, `slot` 1..7 via a partial unique index, `snapshot` jsonb), `hq_supplies.package_id`, `hq_einsaetze.package_id` (Einsatz title <= 40 inside a Nachschub), `user_news_collected`. Existing open lines become one Nachschub "Bisheriger Nachschub".
- Rules live in `src/app/hq/nachschub/nachschub.model.ts` (pure: slots, take/split, line closing, auto-archive, clear/return, fulfil, blueprint material, edge rules); `NachschubService` persists them, `SammlungService` reads Sammlung and copies the old news bookmarks, `NachschubEdgeService` does the wipe / second copy / announced-ship follow.
- "Passt dazu": `recommend.ts` (pure, deterministic), 7 ready / 3 shown, dismissal helpers.
- Names: Edge Function `nachschub-names` (key as secret) with the rule-based fallback in `nachschub-fallback-names.ts`; the UI never marks a name as generated.

## Implementation: wave 2 (HQ pages)
- **Planen** (`src/app/hq/plan/`): the page opens on the seven Nachschub slots (`hq-nachschub-board`, crates drawn by `nachschub/nachschub-crate`, a free slot is a "+" and is the entry to a new Nachschub, trash on hover/focus/touch, Archiv at the end), then the selected Nachschub (`hq-nachschub-panel`): in-place rename, Bearbeiten, "In Jetzt ausführen", Leeren, Löschen (both with the "zurück auf die Wunschliste" checkbox, default on), the Einsätze first as cards with the goods as chips, and the route beside them. The older Auswahl / Was-Wie builder (moods, set rings, map, loose Einsätze, shared Einsätze) stays reachable behind the "Auswahl und Route" switch in the page head, inside a panel that scrolls itself.
- **Neuer Nachschub / Bearbeiten** (`hq-nachschub-flow`): Auswählen -> Zusammenfassung -> Einsätze. Step 3 shows the Einsatz count, per material a buy/mine toggle and a split stepper, crafting always last (`einsatz-proposal.ts`, pure). On confirm it calls `NachschubService.createFromWishlist` (or `addFromWishlist` when editing), then creates the Einsätze with `packageId` and the supply line each step serves. Einsatz names come from `NachschubNamingService.einsatzName` (<= 40).
- **Route graphic** (`plan/route/`): `layoutRoute` (pure) puts one ellipse per star system side by side (Stanton -> Pyro works), a node per place, jump legs between systems; `sc-hq-route-graphic` zooms (buttons, wheel, keys), pans (drag, arrows), fits, shows the seven action icons (`nachschub/step-icons.ts`) and a hidden legend whose filter is stored per Nachschub and Einsatz (`RouteFilterStore`, localStorage `sc.hq.routeFilter`). A place that also serves another Nachschub carries a small tray icon that switches to it.
- **Jetzt**: runs the Einsatz bundle of the Nachschub in focus (`NachschubFocusService`, localStorage `sc.hq.nachschub.focus`; Planen and Jetzt share it): route graphic, the next step with one primary "Schritt erledigt" (the SCC-App ticks the same steps; both land in the Einsatz state), Einsatz tabs, "Nachschub wechseln". Without a Nachschub bundle the current loose Einsatz still runs here.
- **Bestand** (`stock/`): tabs Inventar / Hangar / Sammlung, tiles with a "+" tile first, paged to what fits (never a page scroll on desktop), "Kürzlich aufgebraucht" (48 h, summarised, from replaced `inventory.snapshot` events), a quiet hint per tile and Nachholen (= wishlist), Ingame-Bestand zurücksetzen in the page menu. Deep link contract for the quick access and the search: `hqStockLink({ tab, cat, focus })` in `hq-routes.ts` -> `/hq?bestand=inventar&cat=weapons&focus=<className>#inventar`.
- **SCC-App ticker** (`now/hq-live-ticker`): bottom left on every HQ page except Start, green connected / grey off, the last event that is relevant for the page, only after the app was ever connected.
- `HqPagesComponent` reconciles Nachschub lines whenever Inventar or Hangar change (after both loaded), so a finished Nachschub archives itself. Pages size themselves to `--hq-page-h` (desktop) and scroll inside their panels.
- The old popup `sc-hq-supplies-popup` was replaced by the cart in wave 3; the HQ frame's "Nachschub" button is now a link to Planen with the number of active slots.

## Implementation: wave 3 (shell, search, Codex detail)
- **Schnellzugriff** (`shell/merkliste/`): crate icon "frame" without a count, the word only in the open panel. Zuletzt geöffnet = 3 image tiles, 7 after "Mehr anzeigen" (`RECENT_ROWS_MAX` 12 is the store cap). Wunschliste = the last 3 added (page type, else overall). The context section (Inventar / Hangar / Sammlung) is strictly type-filtered, shows the last 3 added and a "Gesamtes ..." link carrying the filter (`hqStockLink`); pages without a type show no Bestand section.
- **Warenkorb** (`shell/cart/`): own URL (`?cart=1`, `hqCartLink`), `[scDialog]`. Groups follow `cartGroups()` (weapons first, blueprints last), the group checkbox selects the group, silhouettes via `sc-sil-thumb` (contain), red trash with an undo toast (also for groups, no question), "Passt dazu" 3 of 7 (`WishCartService.suggestions`, catalogue adapter `hq/nachschub/rec-catalogue.ts`, FPS armor and weapons only), one primary "In einen Nachschub" -> `/hq#planen?pick=<key>~<qty>|...`.
- **Path control** (`shared/item-path/`): two nodes, Wunschliste -> Inventar / Hangar / Sammlung by kind. Empty wish = +1, filled wish opens the cart, the own node deep-links to HQ Bestand.
- **Codex detail** (`codex/detail/codex-item-stage.component.ts`, `codex-detail.component.ts`, global `ITEM PAGE` block in `styles.scss`): items, weapons, armor and components use the holotable layout (stage left with Silhouette | 3D-Modell switch, tabbed panel right: Werte / Herstellung / Kaufen & Info). Compare lives only in the full-site search overview. Opened from the HQ the page quietly names the Nachschub that holds the item. Blueprint page: "Material xN auf die Wunschliste".
- **Entry motion** (`shared/entry-motion/`): `[scEntry]` + global `CINEMATIC ENTRY` block; cinematic on the first open of a page, quick afterwards, none under `prefers-reduced-motion`.
- **Galerie / News**: both show `sc-sammlung-strip`; the gallery source filter is an `<sc-select>`; `NewsService.toggleFavorite` writes to `SammlungService`.
- Known gaps: the recommendation catalogue does not cover ships, blueprints, places or magazines; missiles keep the classic hero.
