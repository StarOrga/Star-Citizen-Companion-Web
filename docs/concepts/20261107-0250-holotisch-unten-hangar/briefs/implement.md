# Implement brief — Holotisch unten + Hangar (round 1, action implement)

Source of truth: `docs/concepts/20261107-0250-holotisch-unten-hangar-decisions.json`
(round 1 payload) and the mock fragment `docs/concepts/20261107-0250-holotisch-unten-hangar/rounds/01.html`
(design **d2 "Seitenspalte" = Favourit**, screens d2-s1 "Unterer Teil", d2-s2 "Ganz unten",
d2-s3 "Erster Schirm", d2-s4 "Schema"). Original batch notes: `.claude/batch-2026-11-07T01-44-17-145Z.md`.

Every user word below is quoted verbatim. Where a later/more specific remark contradicts an
earlier one, the later one wins and this is said explicitly.

## Original notes (batch, verbatim)

1. Starscape text: „Hochauflösende Artworks aus RSI-Comm-Links, gesammelt beim News-Crawl. … => Das sollte da so nicht stehen, überhaupt sollte das wort crawl nirgends stattfinden für den nutzer! Gerne einen Text dazu, wie der auch die Info, dass das Verlinketes hochauflösendes artwork ist mit quelle cig - gern starscape dazu darauf verweisen"
2. „außerdem lass uns devops concept machen von der schiffsdetailseite, des unteren teils des holotisches. Ich würde sagen die komponenten details meit dem wechsel und gruppierungen sollten erst kommen und dann vertikal ganz unten die "Perspektiven". Diese sollten so sein, dass sie sozusagen mit dem floatingpanel sticky unten andocken und horizontal unterteilt die gleichen bereiche haben etc. Den deckplan ganz unten sollten wir arausnehemen und bei schema mit reinnehmen! als auswahl in einfach mosud wenn es mehree decks gibt. wo packen wir die3 bschreibung hin? Wo zu kaufen intressant, aber ggf. auch irgendwo embeeded, irgendwie in bezug su wunschliste?"
3. „AUCH IM HOLOTISCH SCHema ansicht sollten die callouts sein und nicht unter dem schema bild eine scrollable liste aller teile! Dafür haben wir ja rechts die liste !"
4. „ich kann nicht alle abfangjäger anklikcen !? Außerdme sollte das default ausgewählt sein und mach einrodnung zum ersten punkt default angeklickt, danach bauteile, außer wenn der user bauteile fokussiert!"
5. „diese hangar buttons veraltet in beta kmodus überall rausnehmen! Außerdem schiffsansichten im hangar exakt wie in codex machen, nur halt mit dem panel oben bzgl. wunschliste und co. halt anders gesetzt 😉 ggf. andere hangarfunktionen auch noch. Aber ändere die beta klassische schiffseite so wenig möglich, holotisch ok! Somit will ich sonstige altlasten abschaffen bzgl. alter hangarseiten.!"

## Round 1 — design feedback (verbatim)

- Favourit: **d2 Seitenspalte**.
- Design d2 comment: „Die idee wäre, bauteile im detail nehmen horizontal genauso viel platz iein wie unten offensive bis signatur& kühlung, dabei 4 spalten auch wie unten und die sachen zugeordnet sozusagen visuell uach wenn sie nicht direkt visuell gekoppelt sind aber sortiert halt. 
Perspektiven widerum passt mit beschreeibung und wo zu kaufen usw."
- Annotation d2-s1 a1 (Q: „Die Spalte läuft beim Scrollen mit. Bleibt sie so nützlich, oder stört sie neben langen Bauteillisten?“): „Warum die nicht links machen und die breite haben vom einsatz?“
- Annotation d2-s1 a2 (Q: „Der Wunschlisten-Knopf steht hier zusätzlich zu den Symbolen oben im Panel. Beide behalten oder nur diesen?“): „Sehr gut“
- Annotation d2-s1 a3 (Q: „Die Bauteile bekommen weniger Breite. Sind zwei Spalten Gruppen genug für dich?“): „ok“ — **superseded** by the d2 comment above (4 columns aligned to the strip).
- Screen d2-s4 (Schema): „sehr gut!
Wobei bei Schema einfach würde ich direkt alle callouts gleichzteeitig anzeigen und nicht abwählbar. Bei den anderen sichten nur wenn man draufdrückt.“
- Pin d2-s1 on `div.bz-tv` (bottom strip values): „Ganz unten die leiste wäre gut wenn die klar gleicheverteilt horizontal wären. Das heißt links der einsatz horizontal kleiner und der rest rechts danbebn gleichverteilt“
- Pin d2-s1 on strip `button "–"`: „Das minimieren icon benötigen wir denke ich nciht, es reichthier unten das kleine größer machen icon“
- Pin d2-s2 on `aside.bz-side` (Beschreibung / Wo zu kaufen + buttons Edition / Lackierung / Bei RSI / Vergleich): „keine einzelbuttons hier, bitte integrieren in die kästen oben (z. B. bei rsi) oder einen extra kasten“
- Pin d2-s2 on Bauteile chip „Komponenten“: „brauchen keine filterauswwahl hier“
- General comment: „devops learn warum die custom notizen hier speech bubbles irgendwie kaputt dargestellt“ (+ screenshot) → plugin issue, not app code.

## Round 1 — decisions (value · user note verbatim)

| id | Frage | Wahl | Notiz |
|---|---|---|---|
| r1-dock-open | Wann sollen die Perspektiven auf der Leiste andocken? | **both** — am Seitenende von selbst und per Pfeil überall (Pfeil öffnet sie als Aufsatz über dem Inhalt) | — |
| r1-dock-energy | Wo bleibt die Energie, wenn der Pfeil die Perspektiven öffnet? | **row** — Energie als eigene Zeile über den vier Bereichen | „ALso energie hat einfluss auf die ganzen werte! Deswegen muss man die auch direkt sehen können! Ich muss mir das aber mal ansehen mit einem gesamt seiten beispiel wo ich selbst drin scrollen kann“ |
| r1-dock-phone | Vier Bereiche auf dem Handy | **swipe** — quer wischen, immer ein Bereich groß | — |
| r1-callout | Welche Teile bekommen im Schema einen Callout? | **selected** | „aber nur bei einfach alle punkte+ callouts bzgl. filter ausgewählten, bei den perspektiven ansichten nur die punkte bzgl. filter ausgewählten und der nutzer kann dann anklicken / suchen. bei 3d modus bekommen alle punkte ohne callouts bzgl filter ausgewüählten wie bei den perspektiven“ |
| r1-decks | Deck-Wahl im Schema | **chips** — in Einfach: Außen, Deck 1, Deck 2 … (ein Deck ersetzt die Silhouette; nur ein Deck → Außen/Innen; ohne Raumdaten keine Chips; im Deck keine Bauteil-Callouts/Marker) | — |
| r1-small | Gruppe unter 8 Schiffen | **pick** — wählbar lassen, mit Hinweis „nur N Schiffe“ | — |
| r1-default | Was gilt beim Öffnen eines Schiffs? | **keep** (Abweichung von Empfehlung „always“) | „aber nur für dieses schiff gemerkt für 12h. Weil wenn man zwischen Schiffen hin und her wechselt, will man das vllt. imer wieder vergleichen! Aber auf der anderen siete will man am nächsten tag sozusagen frisch wieder nur die negste sehen“ — **flagged hesitation → implement with special care** |
| r1-flag | Schalter für das Entfernen des Hangar-Knopfs | **shell** | — |
| r1-classic | Knopf auch auf der klassischen Seite weg? | **remove** — nur dieses Element (Vorbelegung, nicht angefasst) | — |
| r1-recents | Ersatz für den Schnellzugriff | **none** (Vorbelegung, nicht angefasst) | — |
| r1-hangar-panel | Eigenes Schiff: Panel oben | **variant, save, wish, rename, pin** (alle fünf; Abweichung: Empfehlung waren nur die ersten drei) | „aber erstmal nur für holotisch betas viariante“ |
| r1-text | Neuer Untertitel | **short**: „Hochauflösende Artworks von Cloud Imperium Games, direkt zum Original verlinkt. Mit der Starscape-App holst du sie als Hintergrund auf deinen Desktop.“ (Link auf die App → Download). Leerzustand: „Noch keine Wallpaper vorhanden. Neue Artworks erscheinen hier von selbst.“ | „ui und wir sollten im tray menü von starscape auch anziegen fan made... mit verlinkung auf der website zu dem voll fan made logo + text oder einfach auf die starscape website! Weil jede applikation ja fanmade info irgendwie benötigt! Ggf. auch bei Starscape öffnen lassen einfach eher Starscape Fan-made oder so schreiben! Weil da habne wir es ja schon\n\nim starscape tray menü: Pausieren sollte zu Fortsetzen wechseln je nachdem was gerade der status ist. Meine Stenrenbilder sollte in Bildauswahl reinwandern. Mit windows starten und anonyme diagnose sollten in konto menü rein wandern ;)“ — **flagged hesitation**; attachment: tray menu screenshot (Aktuell · v0.11.0 · Alpha / Update-Kanal / Konto ▸ / Nächstes Wallpaper / Pausiert / Bildauswahl ▸ / Darstellung ▸ / Meine Sternbilder ▸ / ✓ Mit Windows starten / ✓ Anonyme Diagnose senden / Starscape Website öffnen / Beenden) |
| r1-a11y | Liste unter dem Schema nur optisch weg, Marker fokussierbar | **include** | — |
| r1-redirect | Weiterleitung /hq/hangar/:id bleibt, interne Links direkt auf persönliche Ansicht, hqShip() fällt weg | **include** | — |

## Checklist (one line per accepted item — owner bundle in brackets)

### B1 · Starscape-Text (web) [frontend]
- [ ] C1 „Crawl“ appears nowhere user-facing (de + en, every key, incl. gallery empty state).
- [ ] C2 Gallery subtitle = r1-text „short“ wording (de) + matching en; „Starscape-App“ links to the app download.
- [ ] C3 Gallery empty state = „Noch keine Wallpaper vorhanden. Neue Artworks erscheinen hier von selbst.“ (+ en).

### B2 · Holotisch unten (codex holo layout, beta holotable only) [frontend]
- [ ] C4 Order in the lower part: Bauteile im Detail first, Perspektiven at the very bottom.
- [ ] C5 Bauteile im Detail spans the same horizontal width as the strip's four areas (Offensive … Signatur & Kühlung), laid out as **4 columns** aligned with those areas, groups sorted to the matching area.
- [ ] C6 Left side column with the **width of the Einsatz column**: Beschreibung + Wo zu kaufen (incl. „Auf die Wunschliste“ button, annotation a2 „Sehr gut“) — on the left, not the right.
- [ ] C7 No separate loose buttons (Edition, Lackierung, Bei RSI, Vergleich) under the side column: integrated into the boxes (e.g. „Bei RSI“ in the Beschreibung box) or one extra box.
- [ ] C8 No filter chips (Waffen/Raketen/Komponenten/Sonstiges/…) in Bauteile im Detail.
- [ ] C9 Perspektiven: same four areas, horizontally divided, docking onto the sticky bottom strip; at page end they stand by themselves, the strip's arrow opens them anywhere as an overlay (r1-dock-open both).
- [ ] C10 Energy as its own row above the four areas when the arrow opens the dock (r1-dock-energy row) — energy visible directly.
- [ ] C11 Strip: Einsatz column narrower on the left, the four areas evenly distributed to its right.
- [ ] C12 Strip: no minimise „–“ button; only the small expand arrow.
- [ ] C13 Phone: the four areas swipe horizontally, one area large (r1-dock-phone swipe); nothing under the feedback FAB.
- [ ] C14 Deck plan removed from the bottom of the page and moved into Schema as chips in „Einfach“ (Außen, Deck 1, Deck 2 …; one deck → Außen/Innen; no room data → no chips; inside a deck no part markers/callouts).
- [ ] C15 Schema: the scrollable parts list under the drawing is gone (visually) — the list on the right stays.
- [ ] C16 Schema „Einfach“: all points + callouts for the filter-selected parts, shown simultaneously, not deselectable.
- [ ] C17 Schema perspective views (Draufsicht / Seitensicht / Frontsicht): only points for the filter-selected parts; the callout appears when the user clicks (or searches) a point.
- [ ] C18 3D mode: points for the filter-selected parts without callouts, like the perspective views (callout on click).
- [ ] C19 Markers are keyboard-focusable / reachable for screen readers (r1-a11y) since the list goes.
- [ ] C20 Panel tabs: Einordnung is the first tab and the default; Bauteile second; focusing a part switches to Bauteile.
- [ ] C21 „Alle Abfangjäger“ (any group < RANK_MIN_GROUP 8) is clickable and really applies, with a hint „nur N Schiffe“ (r1-small pick).
- [ ] C22 Default on opening a ship = narrowest group; a clicked group is remembered **per ship for 12 h** (then fresh again to the narrowest); no longer an account-wide setting that overrides every ship (r1-default + note).

### B3 · Hangar im Beta-Modus [frontend]
- [ ] C23 Hangar button removed when the **shell** beta flag is on — holotable, codex landing (r1-flag shell).
- [ ] C24 Classic ship page (beta): only the hangar-button row disappears, nothing else changes (r1-classic remove).
- [ ] C25 No replacement for the recents quick access (r1-recents none).
- [ ] C26 Own ship view = exactly the Codex ship view; its top panel carries: Variante wechseln/anlegen, Loadout speichern, Wunschliste/Nachschub/Bestand, Umbenennen + Notiz, Anpinnen + Entfernen — **only in the holotable beta variant for now**. Entfernen is destructive → ScConfirmService `tone: 'danger'`.
- [ ] C27 `/hq/hangar/:id` redirect stays; internal links go directly to the personal view; `hqShip()` removed; hangar list, import and shared services stay (r1-redirect).
- [ ] C28 Other legacy of the old hangar detail pages removed (dead components/routes/i18n keys), without touching the hangar list.

### B4 · Starscape tray menu (wallpaper-app, Rust) [core]
- [ ] C29 Tray shows a fan-made notice, linking to the website's fan-made info / Starscape website; „Starscape Website öffnen“ reads like „Starscape (Fan-made)“.
- [ ] C30 „Pausieren“ toggles to „Fortsetzen“ depending on the current state.
- [ ] C31 „Meine Sternbilder“ moves into the „Bildauswahl“ submenu.
- [ ] C32 „Mit Windows starten“ and „Anonyme Diagnose senden“ move into the „Konto“ submenu.

### Out of app scope
- [ ] C33 devops plugin issue: custom notes (speech bubbles) render broken on the concept page (general comment + screenshot) → filed against JerryT2T/dotclaude by the session.

## Rules for builders
- Project rules in `CLAUDE.md` (i18n for every string, real anchors for navigation, `scAction`, no native dialogs, translated errors, OnPush/signals, one page frame, phone FAB clearance).
- Every changed behaviour gets a Karma spec; run `npm run typecheck`, `npm run lint`, `npm run build` (templates are only checked by the build) and the affected specs.
- Return an acceptance table: Cn → done / partial / not done → evidence (file:line, spec, screenshot). No evidence = not done.
