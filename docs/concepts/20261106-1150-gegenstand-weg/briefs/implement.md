# Implement brief: wish, Nachschub, Inventar

Decisions: ../../20261106-1150-gegenstand-weg-decisions.json. Later rounds override earlier ones. German quotes are the owner's words.

## Checklist

Binding spec: `rounds/02.html` (design `bahn`, `baustein`, `merkliste`) and `rounds/01.html` for what round 2 did not change. Mock data is invented. Where a mock simplifies a real page (the owner said so about the ship page), keep the real page and place only the new control; do not rebuild the page from the mock.

Scope per `r2-roll = two`: PR 1 = sections A to F. PR 2 = section G. Every line in A to F must land in PR 1.

### A. Data and path model (devops:core)
- [ ] A1 One read model per catalog item: wished yes/no, qty open in Nachschub, qty in Inventar plus places, ship in hangar. Steps run in parallel, never exclusive (`gw-modell = par`). Hidden behind one service used by every surface.
- [ ] A2 One wishlist, also for announced ships. `hangar_concept_ships` is replaced completely, its rows migrated, `upcoming-detail` and `hangar-dashboard` and social reads moved off it (`gw-up = one`, note "vollständig ablösen"). Migration comment documents the drop (alpha data policy). Check `20261105120000_social_area.sql` and RLS.
- [ ] A3 Bug: search stores to inventory with `class_name` (`search-row-actions.service.ts:92`), so it counts as owned in search and in sets.
- [ ] A4 Bug: wish state of announced ships lights up and the toggle reports the truth (`search-wishlist.service.ts:29,57`, `search-row-actions.service.ts:74`). Regression test.
- [ ] A5 Wish to Nachschub moves: the wish disappears, undo via toast restores it (`gw-wn = move`).
- [ ] A6 Nachschub to Inventar: "Besorgt" asks for the place, then writes to inventory and closes the line; "Nur abhaken" stays as the way out; with the app running the place comes automatically (`gw-nb = ask`).
- [ ] A7 Inventar row "Nachholen" adds the qty to Nachschub, stock untouched (`gw-back = again`).
- [ ] A8 Default place is the reader's current location when the live signal knows it, else "Bei mir" (annotation `r2-bah-place-q1` "mein standort"). "Bei mir" replaces today's "Ortsfrei" (`r2-bah-stock-q2`).
- [ ] A9 Blueprints have all three stops: wishlist; Nachschub = the mission to earn it plus its material, "Zum Einsatz" creates the step; Inventar = collected and always available (`gw-bp` note, `r2-bp = mission`, `r2-bah-bp-q1` "Das material natürlich auch"). Without mission data the line stays plain; report which data is missing.
- [ ] A10 "gemerkt" in the search really filters the wishlist, and search results rank wished items first (`r2-mer-v3-ships-q1` "zumindest priorisiert wenn ich suche"). Check tips "fehlt mir" and "lager" too; a tip that does nothing is fixed or removed.

### B. Action building block (devops:frontend)
- [ ] B1 `scAction` directive on native `<a>` and `<button>`, per `r2-bau-spec`: tiers primary, secondary, tertiary; tones default, hot, danger; all states. Touch 48 px.
- [ ] B2 Rule added to `CLAUDE.md` Key Rules: tiers, at most one primary per page, what is not an action (chips, steppers, tabs, nav, segment switches).

### C. Path control (devops:frontend)
- [ ] C1 `sc-item-path` per design `bahn`: tertiary rail with count bullets, secondary pill with next step that follows the context ("je nachdem wo man ist die action nochmal als button hervorgehoben"), primary full form. Text "Jetzt holen. Mit Menge und Quelle." no route.
- [ ] C2 Empty node adds (plus and tooltip on hover), filled node opens the popover with state, −/+, real anchor "Im … ansehen ›", "Entfernen" (`r2-click = fillpop`). No column header, tooltips only.
- [ ] C3 Empty Inventar node opens the place popover at the icon (`gw-skip = inline`). Nachschub qty shows ×n, further click opens the amount (`gw-qty = state`).
- [ ] C4 Ships: third stop "Hangar", all three stops (`gw-ship = three`); pledge skip via the third stop is enough (`r2-bah-ship-q1`).
- [ ] C5 Announced ship: only wishlist plus hint "noch nicht im Spiel" (`r2-bah-wish-q1`).

### D. Surfaces (devops:frontend), tier per mapping round 1
- [ ] D1 Search panel row tertiary; search opened from "Gegenstand suchen" secondary; search page rows and cards tertiary.
- [ ] D2 Codex item, ship, blueprint and announced ship pages secondary; item reached from Planen or a set primary; holo drawer, loadout slot, swap candidate tertiary. Announced ship "Für die Flotte merken" replaced.
- [ ] D3 Set editor: "Fehlendes in Nachschub" secondary, single part tertiary.
- [ ] D4 HQ: Start tiles display only; Inventar head one primary, no other header buttons (`r2-head = one`, "passt"); Inventar row tertiary; stale list display only; Planen head secondary; need line tertiary; popup line and wishlist line secondary; Hangar row tertiary; HQ ship secondary; Jetzt display only.
- [ ] D5 Friend page and mission tertiary; news and patches none.
- [ ] D6 Popup with tabs Wunschliste and Nachschub (`gw-wishpage = tab`). Delete the dead `HqSuppliesPanelComponent`.
- [ ] D7 Header: one bookmark icon with count, opens the panel per `r2-mer-v1-*`: last 3 opened and wished of the page's type, in News last 3 read and bookmarked, Nachschub tab inside (`r2-merk = panel`, `gw-global = bar`). Reuses `search-recent-rows`. Hidden while empty.
- [ ] D8 Item pages: "Link teilen" becomes the share FAB, only behind beta `shell` as today (`r2-bah-item-q1` "nur beta!"). Does not overlap the feedback launcher.
- [ ] D9 Old hangar mechanism gone: "Als Besitz markieren", "Auf Wunschliste", concept wishlist section. The hangar detail page is replaced ("die hangar detailseite sind alt"): first list everything only it can do (rename, notes, flagship, remove, links), move those to the HQ ship / personal Codex view, redirect the route. If something cannot move, keep the route and report a shortfall; never lose a function silently.

### E. Words and symbols (devops:frontend)
- [ ] E1 "Inventar" everywhere for step 3 and the HQ page, DE and EN; "Lager" only as a place word where it is one; "Spind", "Einlagern" gone; ships "Hangar" (`r2-name`). Route `#bestand` keeps working as an alias.
- [ ] E2 "Kopie anlegen" for shared sets and variants (`gw-friend = copy`).
- [ ] E3 Star removed completely ("Dann nehmen wir den Stern komplett raus"): compare, announced favourites, flagship, set favourite, news, star toast. Exception: the map legend uses ★ as a mission shape and stays; say so in the report.
- [ ] E4 Compare gets a new icon: a balance scale, proposed by me because the owner asked "was könnten wir für vergleichen nehmen?". ⇄ stays for "Schiff wechseln" (`r2-bau-ship-q1`, `r2-bau-list-q1`). Name it in the report so the owner can veto.
- [ ] E5 News: bookmark icon only, no word "Merken" (`r2-bau-news-q1`). Game content never says "Merken", it is the wishlist.
- [ ] E6 Flagship: first in the list plus text mark "Flaggschiff", no icon (`r2-flag = top`).
- [ ] E7 One icon family with one stroke style: wish bookmark, Nachschub tray with inbound arrow, Inventar box, Hangar hangar.

### F. Proof
- [ ] F1 Karma specs for the path model, node click logic, transitions, migrated wishlist, both bugs. `npm run build`, typecheck, lint, test:gate, mobile gate.
- [ ] F2 All new strings in `public/i18n/{de,en}.json`, no native title or select, errors via `toErrorKey`, real anchors.

### G. Second PR: rest of the app (`r2-roll = two`)
- [ ] G1 Move the remaining `.sc-btn`, `.btn`, `.act`, `.cta`, `tiny ghost` actions to `scAction` per `r2-bau-*`, starting with `r2-bau-plan` ("ok, starten wir mal damit"), `r2-bau-set` ("ja gut!"), `r2-bau-admin` ("ja ok erstmal", hot tone). Chips, steppers, tabs stay.
- [ ] G2 Prebuild guard against new local action button classes, only once the migration is complete.

## Round 1 verbatim

### Decisions
- d1-gw-modell (Schritte: parallel oder eins): par (rec par)
- d1-gw-wn (Von Wunschliste zu Nachschub): move (rec move)
- d1-gw-nb (Von Nachschub zu Bestand): ask (rec ask)
- d1-gw-skip (Direkt in den Bestand): inline (rec inline)
- d1-gw-back (Der Weg zurück): again (rec again)
- d1-gw-ship (Schiffe auf dem Weg): three (rec three)
- d1-gw-up (Angekündigte Schiffe): one (rec one)
  > Der andere mecahnismus und die hangar detailseite sind alt! Das brauchne wir so nicht mehr, btite volllästndig ablösen!
- d1-gw-bp (Blaupausen): none (rec mat)
  > aber blueprints kann man ja auch fix sammeln, die sind dann auch im bestand und immer verüfgbar, wunschliste kann man sie ja draufpacken und ddan konkret in den nachschub nehemn wenn man will und nachschub bedeutet letztlich, dass man um den blueprint zu erhalten ja bestimmte einsätze machen muss bzw. eine mission. Also kann urhig alle drei haben!
- d1-gw-qty (Nachschub-Klick und Menge): state (rec state)
- d1-gw-friend (Von Freunden übernehmen): copy (rec copy)
- d1-gw-name (Name des dritten Schritts): none (rec w1)
  > Genr hier immer auf ein wording gehen, Gegen lager spricht, dass man das nicht verbindet wenn man es nur hat und nicht irgendwo in den frachtaufzug oder so gelegt hat sondern einfach bei sich hat. bestand klingt irgendwie zu logistisch für spezialisten verständlich.. bessere idee?
- d1-gw-star (Der Stern): split (rec split)
  > Merken? Wozu noch merken, dann doch gleich imer ala wunschliste, auch bei zukünftigen schiffen!? Außer bei news, da kann es gern lesezeichen favorit bleiben.
  > Denk bzgl. flagschiff in hangar listen nochmal nach wie man das markieren kann. Will nicht zu viele icons. Vllt. lass uns doch egal wo man ist eine art merkliste einführen, sprich lesezeichen icon und je nach kontext kann man dort schnell hinspringen. So könnte man dort auch die letzten 3 elemented des typs sehen die man aufgemacht hat (schiffe oder news usw.) und auch die die man sich gemekrt hat dieses typs... Aber lass uns das nochmal mehr visuell und tatsächlich refinen, das find eich nohc uz unsausgegoren um direkt damit zu starnten  
  > Dann nehme nwir den stern komplett raus.
- d1-gw-wishpage (Wo die Wunschliste lebt): tab (rec tab)
- d1-gw-global (Zugang von überall): bar (rec bar)
- d1-gw-tiers (Reichweite der Aktions-Stufen): all (rec prim)
  > aber zeig mir nochmnal visuell welche wesentlichen daddurch anders würden und wwas dein finales baustein design ddafür ist ?=

### Annotations
- bah-a1 [bah-panel] Q: Drei verbundene Punkte statt drei loser Icons: Liest du daran sofort „das ist ein Weg“, oder wirkt es wie ein Ladebalken?
  > Mega Idee! voir allem dann auch noch mit dne bullets wie viele drin sind. Wobei ist dann klar, das ich dort sie dem hinzufüge vs denke ich vllt. das wenn ich auf bestand dann klicke ich meine im bestand ansehen kann? WIe gehen wir damit um?
- bah-a2 [bah-panel] Q: Spaltenkopf mit den drei Namen über den Punkten: Hilft er, oder reicht der Tooltip beim Hover?
  > Ja hilft, aber da er länger ist als die drei unda uch teilweise suchergebnisse anderes erfordern... irgendwie schwierig, bleiben wir vllt. doch eher bei tooltips .
- bah-a3 [bah-item] Q: Sekundäre Form: Weg plus nächster Schritt als Text. Fällt sie genug auf, ohne die Seite anzuschreien?
  > Ja!

### Pins
- bah-item on span.d1-gw-pill "Auf die Wunschliste"
  > Finde ich richtig gut!
- bah-item on button.d1-gw-pin "Link teilen"
  > Link teilen sollte immer rechts unten das teilen fab sein! wie bei schiffne auch!
- bah-ship on span.d1-gw-pill "In den Nachschub"
  > Genau je nachdem wo man ist die action nochmal als button hervorgehoben!
- bah-full on p "Jetzt holen. Mit Menge und Route."
  > mit route? das macht keinen sinn
- bah-stock on button.d1-gw-btn "Wo liegt?"
  > Die drei buttons hier oben, weiß ich noch nict..

Favourite: bahn

### Mapping gw_stufen
{"stufe":[["panel_row","stufe.tertiaer"],["panel_intent","stufe.sekundaer"],["index_row","stufe.tertiaer"],["index_card","stufe.tertiaer"],["item_detail","stufe.sekundaer"],["item_detail_goal","stufe.primaer"],["ship_detail","stufe.sekundaer"],["holo_drawer","stufe.tertiaer"],["hardpoint","stufe.tertiaer"],["swap_picker","stufe.tertiaer"],["upcoming","stufe.sekundaer"],["blueprint","stufe.sekundaer"],["set_missing","stufe.sekundaer"],["set_part","stufe.tertiaer"],["hq_start","stufe.anzeige"],["hq_stock_head","stufe.primaer"],["hq_stock_row","stufe.tertiaer"],["hq_stale","stufe.anzeige"],["hq_plan_head","stufe.sekundaer"],["hq_plan_need","stufe.tertiaer"],["hq_popup_line","stufe.sekundaer"],["hq_popup_wish","stufe.sekundaer"],["hq_hangar_row","stufe.tertiaer"],["hq_ship","stufe.sekundaer"],["hq_live","stufe.anzeige"],["shell_bar","stufe.tertiaer"],["friend_ship","stufe.tertiaer"],["mission","stufe.tertiaer"],["news_patch","stufe.nichts"]]}

## Round 2 verbatim

### Decisions
- r2-click (Klick auf einen Punkt): fillpop (rec fillpop)
- r2-name (Wort für den dritten Schritt): Inventar (rec w1)
- r2-merk (Welche Merkliste): panel (rec panel)
- r2-flag (Flaggschiff ohne Stern): top (rec top)
- r2-head (Inventar-Kopf): one (rec one)
- r2-bp (Blaupause im Nachschub): mission (rec mission)
- r2-roll (Umstellung der ganzen App): two (rec two)

### Annotations
- r2-bah-place-q1 [r2-bah-place] Q: Soll „Bei mir“ der Standardort sein, oder bleibt es der zuletzt benutzte Ort?
  > mein standort
- r2-bah-item-q1 [r2-bah-item] Q: Der runde Knopf steht heute nur mit der Shell-Beta auf Codex-Seiten. Soll er ab jetzt für alle sichtbar sein?
  > nur beta!
- r2-bah-ship-q1 [r2-bah-ship] Q: Schiffe kauft man oft per Pledge und überspringt den Nachschub. Reicht dafür der dritte Punkt?
  > Ja, das reicht
- r2-bah-bp-q1 [r2-bah-bp] Q: Nachschub heißt hier: erarbeiten. Liest du „Über Mission“ so, oder erwartest du hier Material?
  > Das material natürlich auch
- r2-bah-stock-q1 [r2-bah-stock] Q: „Durchsuchen“ steckt in den Zahlen, „Wo liegt …?“ in der Suche oben. Findest du beides dort?
  > passt
- r2-bah-stock-q2 [r2-bah-stock] Q: „Bei mir“ ersetzt das heutige „Ortsfrei“. Richtig so, oder ist das etwas anderes?
  > Ja gut
- r2-bah-wish-q1 [r2-bah-wish] Q: Das angekündigte Schiff hat keinen nächsten Schritt, bis es im Spiel ist. Reicht der Hinweis?
  > ja
- r2-mer-v2-ships-q1 [r2-mer-v2-ships] Q: Größtes Risiko: Die Leiste nimmt jeder Seite 48 px, auch dem vollen Holotisch. Ist das ständige Sehen das wert?
  > jain, wir haben ja andere sieten aufbau, zeig das ganze nochmal mit der korrekten seite inkl breite und elementen!
- r2-mer-v3-ships-q1 [r2-mer-v3-ships] Q: Größtes Risiko: Wer öffnet eine leere Suche, um Gemerktes zu finden? Würdest du hier nachsehen?
  > ja eigentlich schon zumindest priorisiert wenn ich suche
- r2-bau-ship-q1 [r2-bau-ship] Q: „Schiff wechseln“ trägt heute auch ⇄. Das kollidiert mit Vergleichen, also wird es der Link „Schiffe“. Einverstanden?
  > dann nehmen wir das eher für wechseln, was könntne wir für vergleichen nehmen?
- r2-bau-ship-q2 [r2-bau-ship] Q: „Werksausstattung“ ist hier nur ein Icon mit Tooltip. Eindeutig genug, oder braucht es Text?
  > Hä, heute ist das doch viel mehr so ein schiff seite in codex!
- r2-bau-list-q1 [r2-bau-list] Q: + und ✓ stecken jetzt im dritten Punkt der Bahn. Fehlt dir der direkte Hangar-Knopf?
  > Anderes vergleicehn icon
- r2-bau-plan-q1 [r2-bau-plan] Q: Der Umschalter bleibt, weil er keine Aktion ist. Nur der Nachschub wird Pille. Reicht dir das als Änderung?
  > ok, starten wir mal damit
- r2-bau-news-q1 [r2-bau-news] Q: In News bleibt es „Merken“, nur das Zeichen wird Lesezeichen. So wie du es meintest?
  > Merken, wir brauchen dazu glaube ich keinen begriff
- r2-bau-set-q1 [r2-bau-set] Q: „Speichern“ bleibt der einzige Primärknopf, alles andere tritt zurück. Stimmt die Gewichtung?
  > ja gut!
- r2-bau-admin-q1 [r2-bau-admin] Q: Rot heißt erhöhter Zugriff, und hier ist jeder Knopf Admin. Rot überall, oder nur am Primärknopf?
  > ja ok erstmal

### Pins

Favourite: none

