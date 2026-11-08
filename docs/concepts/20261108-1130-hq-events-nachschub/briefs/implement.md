# Implement brief: Events als Nachschub (round 1, submitted 2026-11-08)

Decisions: [`../../20261108-1130-hq-events-nachschub-decisions.json`](../../20261108-1130-hq-events-nachschub-decisions.json) · Binding mock: `rounds/01.html` (screens `ev-start` … `ev-sheet`, view `ev-modell`) · Research + owner decisions: [`../hq-events-research.md`](../hq-events-research.md) · Base: merged Nachschub-HQ (#1005), its spec `docs/concepts/nachschub-hq-ui-spec.md` and wave 5 in `docs/concepts/20261107-1410-nachschub-hq/briefs/implement.md`.

Rules that stay binding (CLAUDE.md + Nachschub-HQ spec): words — never „Route“, „Quellen“, „Bedarf“, „Paket“, „Besitz“ in UI text; one `scAction` primary per page; no native dialogs; errors via `toErrorKey`; all strings in `public/i18n/{de,en}.json`; admin-only surfaces in `--sc-accent-hot`; no API key in the client (LLM via Edge Function secret); every HQ page fits the viewport (1920×1080, 1440×900) without page scroll.

## Owner words, verbatim

### Before the page (chat, 2026-11-08)
- „den Ort wählst du beim Einsatz" — „Genau wobei ich das ja nich tmachen musst, du erkennst einfach wo ich gerade bin und je nachdem bietest du mir utner jetzt dann an, oh im event gebiet, möchtest du zu dem nachschub / einsätzen wechseln. Ich muss das ja nicht festlegen."
- „Ansosten alles richtig was du sagst, aber bau den mechanismus flexibel, denn nur weil das bei den zwei events exakt gerade so ist, heißt das nicht, dass es immer so ist."
- Original request: events as Nachschub next to craft/buy/collect; several at once; Discovery in several places with a global (personal, cross-location) counter; Arena Commander venue; HQ Start marker under Planen with the patch estimate as deadline; manual tick incl. „Bonus als Pledge-Items bekommen“; AI must read and analyse events well (what to do, bonus, where they apply, prerequisites, places); robust, proven on the last 3 big events plus the 2 running ones.

### Round 1 annotations
- ev-a1 (Start marker): „sehr gut !“
- ev-a2 (events strip on Planen): „Jain, die sollten erscheinen sobald ich auf nachschuhb + drücke, dann sollten sier auch neben der wunschliste zur auswahl stehen, aber nur welche ide ich nicht gefmacht haben, abgeschlossene events sollten dann eher unter statstik auftauchen! Aber auf jeden fall hier nicht, das nervt nur  ggf. ein + nachschub irgendwie highlighten lassen, ala  event verfügbar. Btw, mach immer nur den nächsten nachschub slot ein plus die reihe sollte immer links nanfangen mit dem ältesten nachschub geplant und wenn eins erledigt wird dann zwischendurch einfach rausfliegen und die anderen aufrücken. Und das eine + sl.ot dann gern inkl. teaser event verfügabr“
- ev-a3 (event without reward, IAE): „Ja ist auch ok! Aber dann eher belohnung sightseeing, gern das als nachschubtyp einf+hren“
- ev-a4 (wishlist dedupe): „Ja genau, aber nur wenn es die belohnugn aus diesem event ist, weil ich ja sonst ggf. die maxlift bekommen will, aber hier bekomme ich ja eine pledge oder extra versioN!“
- ev-a5 (where a value comes from): no answer.
- ev-a6 (progress self-entered): „warum psäter gern mit bauen für scc app! die erkennung gern die gamelogs von gestern analysen“
- ev-a7 (area instead of map): „ja genau, wobei arena commander gern einfach als extra element ggü. dem gebiet / sternenkarte, weil man ja auch mehrere events gleichzeitig auswählen kann innerhlab eines nachschubs auch wen nnicht empfolen“
- ev-a8 (Jetzt offer): „sehr gut“
- ev-a9 (claim channel): „Ne, passt, und gern auch scc app befähigen das azusätlzich automatisch hier zu ändern“
- ev-a10 (review page): „die prüfseite gern nur für admins im admin menü, dort mit historie“

### Round 1 pin
- ev-flow, on „✓ Alpha 4.10.2“: „patch ist eh obligatorisch, hier unnötig, genauso auch spielpaket. Vorausssetzung eher eine abschätuzung was man düafr braucht, z. B. fps fight set oder kampfschiff etc.. oder salvage schiff, dabei "oder" und/oder "und" anziegen“

### Round 1 decisions
- q-store = sheet (recommended): one data sheet per event, JSON with schema version, every value may be unknown.
- q-review = review (recommended): field < 0.8 stays unknown, admin reviews on the data sheet.
- q-end = yes (recommended): official end › estimated next patch › „Ende unbekannt“.
- q-entry = line only (deviates: strip NOT chosen). Note: „und wie gesagt statt der leiste einfach wenn man auf + nachschub klickt im dialog bzw. auch in der kleinen kachel schon einen teaser4“
- q-slot = slot (recommended): normal slot with event marking, archives at event end.
- q-detect = yes (recommended): offer bar on top of Jetzt.
- q-claim = channel + event + store (recommended; „missed“ not chosen). Note: „Ja man soll ein evneta uach abbrehcehnn können, bzw. den nachschub ist es ja wie andere auch, nur mit dem unterschiedm, dass das dann hier nicht auf die wunschliste zurückgeht sondern einfach fortschritt gespeichert wird, ggf. durch scc app immer aktuell gehaltne und dann kann man es jederzeit fortsetzen“

## Checklist (one line per accepted item; owner in brackets)

### Data and extraction [core]
- [ ] C1 `sc_events` gets a data sheet (`sheet jsonb` + `sheet_schema` int): venue(s) (open list incl. Verse, Arena Commander, Star Marine, Website, Twitch, unknown), area (none / system / place / any-of set), tasks, progress model (none / once / tiers / daily / group / community, tracks with thresholds), rewards (each: name, class_name if in Codex, channel pledge/ingame/both/unknown, timing immediate/after-end/date, tier/track), prerequisites, start, end; every field `{value, confidence, source}`; nothing enum-locked to today's two events (owner: flexible). (q-store, chat)
- [ ] C2 Server-side extraction (extend `sc-events-sync` or a new `sc-event-sheet` function): Comm-Link Wiki API (as `fetch-verse-news`), plus Spectrum / wiki text where reachable; LLM via Edge-Function secret; schema-validated output; runs for a new comm-link that matches an event family and daily while an event runs. (chat, q-store)
- [ ] C3 Field < 0.8 → stays unknown in the public sheet and lands in an admin review queue; every extraction run and every admin edit writes a history row (`sc_event_sheet_history`). (q-review, ev-a10)
- [ ] C4 Prerequisites are an estimate of needed gear with explicit AND / OR groups (e.g. „FPS-Kampfset ODER Kampfschiff“, „Bergungsschiff“); never the patch or the game package. (pin ev-flow)
- [ ] C5 End chain: official end › estimated next patch (`computeNextPatch` / official LIVE date #317) labelled „spätestens mit … (geschätzt)“ › „Ende unbekannt“; a later extension moves the deadline. (q-end)
- [ ] C6 Fixtures + tests: Discovery Month 2956, Day of the Vara 2956, IAE 2956, Foundation Festival 2026, Invictus 2956, Luminalia 2955 as recorded inputs + expected sheets through the validator/normaliser (`npm run test:functions`); find out what „Orison Relief“ was and add it if it is one of the last 3 big events. (chat: „anhand der letzten 3 großen Events … plus die beiden, die aktuell laufen“)
- [ ] C7 Per-user event state (`user_event_state`): status open / done / dismissed / aborted, progress per track (value, source manual | live, updated_at); RLS own rows. Done events feed Statistik. (q-claim, ev-a2)
- [ ] C8 Nachschub types: `event` (rewards) and `sightseeing` (event without reward, e.g. Free Fly) next to the normal Nachschub; `EinsatzRole` gets `event`; an event step carries an event reference and its area instead of a fixed `location`. (q-entry line, ev-a3, chat)
- [ ] C9 Aborting / emptying an event Nachschub keeps the progress, lines do NOT go back to the wishlist, it can be resumed any time. (q-claim note)
- [ ] C10 Claim: channel pledge / ingame / both, preselected from the sheet; „store“ puts the reward into Bestand with origin pledge (ships → Hangar, everything else → Inventar — inventory needs an origin field, same migration); a whole event can be ticked „erledigt“. (q-claim, ev-a9)
- [ ] C11 Wishlist dedupe only when the wished item IS this event's reward (exact reward class_name / variant), never the base item (a MaxLift on the wishlist is not the event's „Keelback“). (ev-a4)
- [ ] C12 Event Nachschub archives itself at event end; reward lines with timing „after end“ stay as „wartet auf Verteilung“ until ticked. (q-slot, q-end)
- [ ] C13 Contract `docs/contracts/scc-app-event-progress.md` for the SCC-App: progress per track, location / system, Arena Commander mode, reward received; written into the user's event state / live feed so the web updates automatically. (ev-a6, ev-a9, q-detect)

### HQ UI [frontend]
- [ ] F1 Slot row: exactly one „+“ (the next free slot); the row starts left with the oldest planned Nachschub; a finished one drops out and the others move up. (ev-a2)
- [ ] F2 The „+“ slot carries a teaser „Event verfügbar“ while an open event exists that is neither done nor dismissed (also in the small tile). (ev-a2, q-entry note)
- [ ] F3 No events strip on Planen. (ev-a2 „Aber auf jeden fall hier nicht, das nervt nur“, q-entry strip not chosen)
- [ ] F4 „Neuer Nachschub“ dialog shows open, not-done events next to the wishlist for selection; done events are not offered. (ev-a2)
- [ ] F5 Flow step 3: „Event“ as a fourth way per line when the wish is a reward of a running event. (q-entry line)
- [ ] F6 Event Einsatz shows its area (system / allowed places) and Arena Commander as an extra element beside the area / star map; several events in one Nachschub are possible but not recommended (quiet hint). (ev-a7)
- [ ] F7 Progress per track with tiers, editable by hand, updated live from the SCC-App when connected. (ev-a6)
- [ ] F8 HQ Start: marker in the Planen tile + dot on the Planen tab, counts events neither done nor dismissed, names the nearest end per C5. (ev-a1)
- [ ] F9 Jetzt: offer bar when the SCC-App reports a place inside the area of an open event Nachschub (or Arena Commander mode); „Nicht jetzt“ until the next place change; no app → no offer. (q-detect, ev-a8)
- [ ] F10 Claim dialog: channel choice, whole event „erledigt“, into Bestand; an SCC-App signal can set it automatically. (q-claim, ev-a9)
- [ ] F11 Admin review page in the admin menu (red, admin-only) listing events, fields with confidence, approve / set by hand, with history. (ev-a10)
- [ ] F12 Sightseeing Nachschub for an event without reward. (ev-a3)
- [ ] F13 Prerequisites rendered as AND / OR gear groups, no patch / game-package chips. (pin)
- [ ] F14 Statistik lists completed events. (ev-a2)
- [ ] F15 i18n DE/EN for every new string; words rule; specs; `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:functions`.

### SCC-App [separate session, repo Star-Citizen-Companion-App]
- [ ] A1 Read event progress from the game logs; first analyse yesterday's logs for the patterns. (ev-a6 „die erkennung gern die gamelogs von gestern analysen“)
- [ ] A2 Report location / system and Arena Commander mode. (q-detect)
- [ ] A3 Report a received reward so the web ticks it. (ev-a9)
- [ ] A4 Implement against `docs/contracts/scc-app-event-progress.md` (C13).

## Acceptance
Each agent returns one row per owned line: item → done / partial / not done → evidence (file:line, test, screenshot). A line without evidence is „not done“. An independent `devops:qax` checks the checklist and every quoted pin against the diff before the final report.
