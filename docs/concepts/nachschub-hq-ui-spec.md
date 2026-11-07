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
