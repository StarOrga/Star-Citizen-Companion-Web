# HQ entry: implement brief

Generated, not summarised. Decisions: [../../20261106-0842-hq-einstieg-landing-decisions.json](../../20261106-0842-hq-einstieg-landing-decisions.json). Binding mocks: `rounds/05.html` (design `kante`, screens s1-first, s1-known, s1-newbrowser, s1-busy, s1-live, s1-livefree), with `rounds/04.html` for the centre and light-edge CSS it derives from. Later rounds override earlier ones.

## Every remark, verbatim

The first submission's opening request: "Lass uns bitte nochmal hq concepten entry - was steht auf der landing page, welche reihenfolge haben die sieten darunter."

### Submission of round 1 (action iterate, favourite lage)

- general: "ich kann keine custom speech bubbles überall setzen!"
- decision `q-order` (Reihenfolge der HQ-Seiten): "" note: "Denk nochmal drüber nach, ich weiß eingie spieler würden gern erstmal immer bestand haben, dann planen. Andere jetzt vorne stehend, dann bestand... Ich bin unsicher ob wir nicht nochmal rethinken müssen .."
- decision `q-live` (Einstieg bei laufendem Spiel): "fixed"
- decision `q-steps` (Reihenfolge der Startschritte): "value"
- decision `q-go` (Ziel von Los geht's): {"answer":"yes","alt":""}
- annotation `h2-a1`: "Ne, das ist perfekt!"
- annotation `h2-a2`: "Nichts offen sollte besser formuliert werden!"
- annotation `h2-a5`: "Sollte eher festen Platz halten, aber das stellt mir die frage ob man wirklcih vier gleichwertigew Kacheln macht oder sie anders verschachelt, da gern nochmal varianten aufzeigen"

### Submission of round 2 (action iterate, favourite drei)

- general: "devops learn warum in der übersicht mir nix an inhalten in den kacheln  gut angezeigt wird!"
- decision `r2-model` (Umgang mit verschiedenen Spielern): "" note: "ne, da noch kreativer werden!  bzw. best practices dir ansehen!"
- decision `r2-default` (Standardfolge der HQ-Seiten): "stock"
- decision `r2-word` (Text statt Nichts offen): "Jetzt Planen! Lieber machen"
- pin `up-mw4pjbdo4cnf` on k4-first at button.d2-skip "Überspringen": "ich glaube übersprignen benötigen wir jetzt nicht mehr!"
- pin `up-mw4pjvwiko57` on k4-quiet at b "Alles beisammen": "da gefällt mir das lieber von erster besuch!"
- pin `up-mw4pk2fqf3p2` on k4-quiet at button.d2-strip "Statistik14 Missionenin dieser Woche": "Das könnte auch einfach unauffälliger darunter zentriert stehen, Statistik bruach tkeine so große aufmerksamkeit, reicht ala text link oder so."
- pin `up-mw4pkw73abfb` on k4-busy at b "Kein Live-Signal": "jetzt würde ich in der mitte anzeigene, vlltt. aber nicht als solche kaachel?! Bestand würde ich links machen, planen rechts!"
- pin `up-mw4ply3gfyrw` on k4-busy at a "1 Einsatz von Freunden geteilt ›": "die zeile hier unten bruacht es nicht denke ich"
- pin `up-mw4pmq5xfydu` on k4-quiet at button.d2-tile.d2-t-jetzt "JetztKein Live-SignalZuletzt: New Babbag": "Vllt. immer eine cta, aber hier dann SCC App starten als hinweis und nicht anklickbar, im tooltip gern die info auch, dass man apps öffnen kann um es sich erneut herunterzuladen von dem text cta"

### Submission of round 3 (action iterate, favourite offen)

- general: "Alles nicht schlecht, aber wir sind erst bei 60% visueller darstellung, inhalte darstellung schon 90% :)"
- decision `r3-entry` (Zusätzliche Einstiege ins HQ): ["shortcuts","keys"]
- decision `r3-layout` (Anordnung der Seiten unter Start): "match"
- annotation `r3-j1-a1`: "Könnte man mit scc app starten nicht aus dem browser raus einen befehl weitergeben das in windows zu tun? so wie wenn man sich in scc app einloggt und die website rückmeldung gibt an scc app"
- annotation `r3-j1-a2`: "genau"
- annotation `r3-j1-a3`: "die patchzeile sollte dort stehen wo hauptquartier steht! Denn das im hero ist die zeile für die news!!!!"
- annotation `r3-j2-a1`: "das ist doof, aber es darf gern langsam pulsieren / etwas effekte zeigen!"
- pin `up-mw4qouu8z2oi` on j3-first at em "RSI-Hangar holen ›": "ich finde den 3D Erffekt super außer dass die schrift irgendwie blurry wird : /"
- pin `up-mw4qphvz49ye` on j1-first at small "Live-Stand aus dem Spiel.": "Das finde ich schön dezent, gern noch etwas polishen aber gut. Nur stylistisch passen jetzt die beiden kästen links und rechts nicht daran, die dürfen gern bulliger seiun, aber nicht so bullig"
- pin `up-mw4qqefy7hh7` on j2-first at div.d3-now.d3-scope "JetztSpiel nicht erkanntLive-Stand aus d": "wenn das ganze verbunden ist,"
- pin `up-mw4qr8c8ls2f` on j1-live at div.d3-now.d3-open "JetztNew BabbageLive · Cutlass BlackS3-R": "ist mir irgendwie nicht sooo  hübsch dargestelltlt"
- pin `up-mw4qxrr9s3cy` on j1-busy at b "23 Schiffe": "Warum eigentlich keine ikonographfie z. B. für bestand, planen jetzt und statsitik!? natürlcih thematisch"

### Submission of round 4 (action iterate, favourite kante)

- annotation `r4-s1-a1`: "Perfekt! / Genauso!"
- annotation `r4-s1-a2`: "Sollte eher im tooltip der seitenmenüs sein, als auch hier von den drei kacheln aber mit long dealy"
- annotation `r4-s1-a4`: "Finde ich super! Allerdings  / Ich gehe davon aus S3 Repeater kaufen ist der aktuelel / erste geplante Einsatz, wenn keiner vorhanden, daann dort einfach kein cta button!  /  / Mir ist es irgendwie zu unruhig wohin ich fokussieren soll, vllt. die ringe dahinter irgendwie weichzeichnen und noch etwas dezenter?"
- pin `up-mw4rh3t9l1m1` on s1-first at kbd "1": "hotkeys, nur wenn man lange hovered als tooltip! Und aauch Hotkey: davor!"
- pin `up-mw4rkyles9b3` on s1-live at em "Weg öffnen ›": "Route statt weg ist besser ;)"
- pin `up-mw4rl7gb903k` on s1-live at span.d4-side-k "Planen3": "wenn ich auf die karte klicke, gehe ich davon aus, dass dann der punkt planen aufgeht neutral ggü. route öffnen genau diese route schon öffnet"
- pin `up-mw4rna2l37l0` on s1-first at button.d4-go "SCC-App startenÖffnet die SCC-App auf de": "wenn gerade nicht verbunden => noch nie verbunden oder schon mal verbunden aber noch nicht in diesem browser kontext lokal clientseitig gespeichert, dann sollte scc app downloaden dort stehen und bei klick direkt downloaden!"

### Submission of round 5 (action implement, favourite none)

- general: "Btw, in verse sitzt das nächste seite super aus, aber in hq anders und hat dann auch noch ein anderne background, bitte das von verse style mäßig nehmen auch in hq!"
- annotation `r5-a1`: "ja"
- annotation `r5-a2`: "Ok, das können wir auch so machen!"
- annotation `r5-a4`: "Sehr gut, ein wenig deutlicher dürfen sie schon klein wenig"
- annotation `r5-a6`: "ja genau"

## Checklist

- [ ] **A1** Scroll order and rail, bottom bar, cue: Start, Bestand, Jetzt, Planen, Statistik (r3-layout match). Deep links /hq#jetzt keep working. HQ_PAGES in src/app/hq/hq-routes.ts.
- [ ] **A2** Start shows the hero exactly like the other main pages (eyebrow, title, stage search), unchanged geometry.
- [ ] **A3** Below the search: Bestand left, Jetzt open in the centre, Planen right; columns 1fr 1.1fr 1fr, gap 20px; Statistik as a quiet centred text link with icon beneath (.d5-row, .d5-after).
- [ ] **A4** Side tiles in the Lichtkante style: no box, light edge on top with fading gradient, Bestand text right-aligned and Planen left-aligned, leaning to the centre (.d5-edge). Min height 148px.
- [ ] **A5** Real page icons from HQ_PAGE_ICONS on tiles, centre and Statistik link.
- [ ] **A6** Whole tile is a real anchor to its page with the plain click going through HqPageNavService; an inner own target (Route oeffnen, RSI-Hangar holen, centre button) sits above it and does its own thing. No nested anchors. Modified clicks fall through.
- [ ] **A7** Jetzt offline: label Jetzt, Spiel nicht erkannt or Kein Live-Signal with Zuletzt: place and time, plus the app button.
- [ ] **A8** Jetzt live: label Live in green, system line, location large, ship below; rings behind, blurred and slow (7s breathe). User after round 5: "ein wenig deutlicher duerfen sie schon klein wenig", so slightly stronger than the mock. Reduced motion: static. Rings only while connected.
- [ ] **A9** Jetzt live with a planned Einsatz: button shows that first planned Einsatz next step (mock: S3-Repeater kaufen). Without a planned Einsatz: no button at all (s1-livefree).
- [ ] **A10** App button: no game signal on the account and no local launch memory -> SCC-App downloaden, click downloads directly. Account has a game signal OR local launch memory -> SCC-App starten with the existing fallback to download (r5-a2 accepted). The tooltip keeps the Apps hint. The button is hidden on devices that cannot install desktop apps.
- [ ] **A11** sc.sccApp.launchedBefore is also set when a live signal is seen in this browser, otherwise the local memory would never be set while the button only downloads.
- [ ] **A12** Planen tile: empty = Noch nichts geplant, Aus Nachschub wird ein Weg., Jetzt planen ›. With plans = count, plan name, and Route oeffnen › that opens exactly this route, while the tile goes neutrally to Planen.
- [ ] **A13** Bestand tile: empty = Noch keine Schiffe + RSI-Hangar holen ›; else ship count, sets and blueprints, Bestand ansehen ›; a stale stock line in warning colour.
- [ ] **A14** First-visit block with its steps, Los geht's, Ueberspringen and duration is gone; first visit is expressed by the tiles, next step highlighted on Bestand. Friends line under Start is gone. Patch line under the title is gone. Chips row is gone.
- [ ] **A15** A patch hit replaces kicker and title in the hero, like Codex: eyebrow plan + Neu in version, title the effect as a real link. Without a hit: Dein HQ / Hauptquartier. r5-a3 stayed unanswered: default is the most important hit only, no rotation.
- [ ] **A16** Hotkeys 1 to 4 jump to Bestand, Jetzt, Planen, Statistik, ignored while typing in a field or with modifiers. Never visible at rest: tooltip with the info delay (SC_TOOLTIP_INFO_DELAY, 1500 ms) "Hotkey: N" on the three tiles and Statistik link, and on the rail stops, whose label stays. i18n keyed. Not on touch.
- [ ] **A17** Page cue styled like the Verse cue: no background, no blur, no box; user: "in verse sitzt das naechste seite super aus, aber in hq anders und hat dann auch noch ein anderne background, bitte das von verse style maessig nehmen auch in hq!" Attachments show MEHR IM VERSE without ground vs PLANEN with ground. Must stay legible over the follow pages; check all pages.
- [ ] **A18** Same look of the Start background as the live scene: no new background is painted on Start, the shell scene stays.
- [ ] **A19** PWA manifest shortcuts for Bestand and Jetzt (r3-entry shortcuts).
- [ ] **A20** Phone: Jetzt on top full width, Bestand and Planen side by side beneath with equal height, bottom bar in the new order, no overflow, touch targets 48px, text left-aligned.
- [ ] **A21** All strings in public/i18n/de.json and en.json; old keys removed; tooltips via scTooltip; no native UI; errors via describeError; load failure shows an error state, not an empty one.
- [ ] **A22** Specs updated and added for the order, tile states, app button logic, hotkeys, live button rule. npm run typecheck, lint, test, build green.

## Acceptance table

Each agent returns: item -> done / partial / not done -> evidence (file:line, spec, screenshot). A line without evidence counts as not done. Never invent data for a state the app cannot yet know: report it as a shortfall.
