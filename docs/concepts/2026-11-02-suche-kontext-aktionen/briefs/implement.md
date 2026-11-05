# Implement brief — Search: context & actions

**Generated from the payloads, not summarised.**

- Decisions file: `docs/concepts/2026-11-02-suche-kontext-aktionen-decisions.json`
- Round fragments: `docs/concepts/2026-11-02-suche-kontext-aktionen/rounds/0{1,2,3}.html`. These are the **binding visual spec**; the latest round wins.
- Parity checklist: `parity.md`
- Handover from #832: `briefs/handover-832.md`

Project rules apply in full (CLAUDE.md): ngx-translate for every string (DE + EN), real anchors for navigation, `[scTooltip]` instead of `title`, `<sc-select>`, no `console.*`, errors through `toErrorKey`, red only for elevated access, `--sc-warning` for "passt nicht", tokens only.

## Owner's interpretation calls (made by the session, flag them in the final report)

1. **Round 3 silhouette.** Answers on design "Umriss am Panelrand" were „JA SCHON; ABER BITTE NICHT selbst das icon mit einem weiteren kasten...“ and „ne, wir machen die silhouette nur im icon inline, nicht hier nochmall extra!“.
   - Build the silhouette **only inline as the row's leading icon**, with no box or background around it.
   - Build **no** edge strip, **no** band in the row, **no** watermark, and no model label.
   - Behind the panel, the current page is only darkened (round 2 answer).
2. **Third icon** = Nachschub (q3-third, recommendation kept, untouched).
3. **Matrix** = the corrected matrix of round 3 (`q3-matrix` example block, verified "ok"). Cells marked `*` are **new features**. Each becomes its own follow-up issue via `auto-issue` with `Refs #832`/concept link. They are not built in this run: the owner approved "Zellen mit * kommen als eigene Folge-Aufgaben".
   - Until a `*` feature lands, the cell falls back to the neutral row's CTA, or to no CTA if the neutral one is also `*`.

## Checklist

See `parity.md` (A1–D2). Each agent returns an acceptance table: item → done / partial / not done → evidence (file:line, spec, screenshot).

## Verbatim feedback (all rounds)

### Round 1 (action: iterate, favourite: kacheln)

- decision `q-own` = "section" (untouched)
- decision `q-ctx` = "order"
  > [Frage 2]  und kontext filtert! Einmal sichtbar mit den labels (sollten nie bereiche sein! weil das ja unsinnig wäre wenn ich das schon mit der reihenfolge mache) und einmal unsichtbar die reihenfolge der bereiche!
- decision `q-understand` = ["dym","abbr","attr"]
  > Abkürzungen bitte in der community nochmal intensiv recherchcieren und weitere aufnehmen! Reddit und spectrum sind dein freund ;) 
  > AUßerdem immer die aktuelle sprache + englisch! Wenn englisch die sprache gerade ist, dann nur diese!
  > chips sollten auch die möglichkeit haben umschaltbar zu sein wenn man drüber hovered ein kleines aufklapp dreieck und man kann z. B. S1 in S3 ändern - nur wenn das sinn macht! und bei mehr als 7 Einträgern inkl. kleiner mini suche darin!
- decision `q-sources` = ["loadouts","patches"]
  > außerdem check bitte, dass man schiffen nebst dem schiffsnamen auch eigene namen geben kann im hangar und auch deren loadout varianten ;) gleiches wie die fps sets ;)
- decision `q-signals` = ["recent","own"]
  > was andere oft öffnen gern bei der sortierung
- decision `q-primary` = "ctx"
- decision `q-more` = ["compare","newtab","copy"]
  > [Frage 2] passt auf ist ander sinteressant, wenn ich gerade einen chp habe zum derzeitig ausgewählten schiff (aus der schiffsdetailssitete3) oder auch waffe etc. dann sollte mir angezeigt werden ob das element gesuchte auf darauf passt oder nicht! 
  > Genau auf die WUnschliste! Oder auch in das lager übernehmen! Beides valide optionen.
  > Link kopieren sollte ich eh auf jeder detailseite haben, gehen wir aber später an. 
  > In neuem tab öffnen geht, aber das müssen die user selbst wissen. Vergleichen nur auf der fullscreen suchergebnis seite (wenn man raumschiffe oder waffen anklickt in codex und dort dann alle findet), das brauchen wir aber nicht in der kleinen suche, außer wenn  man auf diesen listen seiten ist, darf das ruhig die cta sein!
- decision `q-info` = ["maker","size","own","patchnew"]
  > Immer Icon, für die wiederkennbarkeit und schnelle einordnung. Lass uns die icons nochmal refinen bitte! Außer wenn sie aus data  uploader mitkommen (können).
  > Neu Icon gern aber nur mit hover over das es neu im patch xyz ist.
- decision `q-esc` = "close"
- annotation `sa-s2-a1` (`sa-s2`): „Aus deinem Bestand“ als eigener, grün umrandeter Bereich ganz oben: so erkennbar, oder reicht ein Badge an der Zeile?
  > ne, das ist schon wichtig, maximal 3 angezeigt!
  > gleiches pattern wie danach +... weitere hier anzeiegne, falls verfügbar und ... Alle x im hq öffnen..
- annotation `sa-s2-a2` (`sa-s2`): Zwei Wege pro Bereich: „11 weitere hier zeigen“ (bleibt im Panel) und „Alle 14 im Index öffnen“ (verlässt es). Klar getrennt oder einer zu viel?
  > Finde ich sehr gut!
- annotation `sa-s2-a3` (`sa-s2`): Rechts sichtbar nur EINE Aktion (hier „Im Bestand zeigen“), Vergleichen / neuer Tab / Link kopieren erst auf der aktiven Zeile. Fehlt dir so etwas?
  > Ja, lass uns immer eine haupt cta machen! Das ist wichtig für die ux!
- pin `sa-s1` on div.mk-s-tags "SchiffeKomponentenSchiffswaffenFPS-Ausrü"
  > Bereiche brauchen wir hier gar nicht, die existieren gern als tag, aber nur automatisiert eingetragen 9in die suchleiste wie bestand oben weil ich die suche aus der seite bzw. anchor aufgemacht habe (stelle sicher dass alle anchor scrollables auch so ein label erzuegen wenn man von dort aus die suche aufmacht!)
- pin `sa-s1` on div.mk-s-tags "SpindHangarEinsätzeStatistik"
  > siehe unten bereiche, benötigen wir nicht, wir haben schon implizites in dne suchergebnissen oder ggf. oben getaggt ihn der suchleiste automatisch.
- pin `sa-s1` on b "Aegis Gladius"
  > immer wenn möglich 3 Stück einträge (bzw. wenn darunter dann weniger als 3)
- pin `sa-s1` on div.mk-s-group "Zuletzt gesuchtlaserquantumgladius"
  > max. 7 neuste!
- pin `sa-s1` on div.mk-s-group "Hier im HQSpindHangarEinsätzeStatistik"
  > stattdessen hier unten eher einen dezneten teaser weas man alles suchen kann!
- pin `sa-s3` on span.mk-s-ctx "Bestand ×"
  > es sooltte auch wenn man z. B. in der idris ist und das getaggt wird, dann aber stalker sucht - wenn es dann einen almost exact match gibt, dann sollte dieser trotzdem angezeigt werden auch wenn nicht indem bereich! gern irgendwie als solches markieren!
- pin `sa-s3` on span.mk-s-rt "☆↗⧉Öffnen"
  > lass uns die one action + die drei icons daneben bitte nochmal refinen was die machen, außerdem kann man ja auch immer auf den eintrag klicken selber um dort rein zu gelangen, daher wäre für mich die action etwas spezielleres kontextabhängig wo ich die suche aufrufe? und die drei icons, gern etwas größer sonst verklickt man sich, standardaktionen die ich immer wiederfinde und machen kann und bei allem gefunden gleich!
- general
  > Lass uns im nächsten schritt die cta refinen und die drei icons, lass die devops agents nochmal brainstormen was die drei icons sein können / müssen! 1 davon haben wir ja schon definiert!
  > 
  > Außerdem zeig mir eine geöffnete suche die alle möglichen maximal variante elemente hat und eine normale sozusagen!
- design `vorschau`
  > vorschau ist zuuu viel, macht es nicht mehr genügend leichtgewichtig, obwohl eine vorschau bildlich wenn man es focussed hat / hovered und noch nicht geklickt ganz cool wäre, sehr gedämpft aber im background, dann kann man es ggf. auch visuell identifizieren, z. B. verwechsel ich immer reclaimer mit redeemer mit re... und die sind ganz klar visuelle ifnach zu untersceiden!
- design `reiter`
  > ne, die suche mu7ss intelligenter sein! integrierter, dass wir das bereiche als reiter nicht brauchen!

### Round 2 (action: iterate)

- decision `q2-icons` = ""
  > [Befund · Frage 1]  Gern eher auf die Wunschliste, in das Lager und 
  > Außerdem schaue das die icons den gleichen style haben! und das der cta zwar sichtbar aber nicht zuu bullig daneben ist!
- decision `q2-mark` = {"answer":"yes","alt":""}
  > In der suche merken als standard icon immer! aber bitte daraus folgen entweder in den nachschub übernehmen oder zum ieinsatz hinzufügen. Btw, missiionen, blueprints und co. sollte amn auch alles suchen sollen was spielinhalte sind. Aber für news, patches und galerie bitte keine standard icons machen!
- decision `q2-matrix` = "ok"
  > [Befund · Frage 3] nochmal kritisch mit den agenten prüfen aber sonst machen wir das erstmal so!
- decision `q2-off` = "hide"
  > Lieber einfach keine standardaktionen bei denjenigen! und keine cta aktion
- decision `q2-rowicon` = "sil"
  > stimmt, das reicht! gute idee,
- decision `q2-abbr` = "ok" (untouched)
- decision `q2-misses` = {"answer":"yes","alt":""} (untouched)
- decision `q2-anchor` = "data" (untouched)
- annotation `t-s1-a1` (`t-s1`): Der Hinweis unten: als ein Satz mit drei Beispielen klickbar — oder lieber ein Beispiel, das alle paar Sekunden wechselt?
  > lieber ein beipsieel was immer wechselt, aber inhaltlich schon sehr gut, gern 70 beispiele oder hinweise zur suche generieren. außerdem immer einzeilig!
- annotation `t-s1-a2` (`t-s1`): Dein eigener Schiffsname steht vorn, der Typ dahinter („Nachtfalke“ · Aegis Gladius). So herum, oder Typ zuerst?
  > lieber zuerst das schiff, weil ich ja es mehrmals habnen kann aber dann mit verschiedneen namen.
- annotation `t-s2-a1` (`t-s2`): Hauptaktion links, Trennstrich, dann die drei Icons in 32 px: groß genug, und ist die Trennung zwischen „speziell“ und „immer gleich“ klar?
  > ja gut
- annotation `t-s2-a2` (`t-s2`): Eigenes hat eine gefüllte Hauptaktion, Fremdes eine umrandete. Hilft das beim Überfliegen, oder sollen alle gleich aussehen?
  > alle gleich aussehen...
- annotation `t-s3-a1` (`t-s3`): Drei Chips im Feld (Seite, Abschnitt, aus dem Text): der aus dem Text erkannte ist blau-violett. Reicht die Farbe zur Unterscheidung?
  > keine andere farbe, einfach nur bei hover over der drop down button einblenden und auch das x - das braucht man auch nicht die ganze zeit dort!
- annotation `t-s3-a2` (`t-s3`): Gedämpftes Bild der fokussierten Zeile hinter dem Panel (16 % Deckkraft): erkennbar genug, um Reclaimer und Redeemer zu trennen?
  > hmmm ne, maximal abdunkeln aber nicht dann irgendwa s anderes als die aktuelle seite dahinter! denk dir varianten aus wie wir das bild anders vorschauen können gedämpft / die silhouette!
- pin `t-s2` on span.mk-t-cta.ghost "Ins Lager"
  > die cta buttons sollten irgendwie stylistschi besser sein!
- pin `t-s4` on div "Größe 23"
  > sehr gut, wobei noch lieber gern aus dem chip direkt rauskommennd visuell!

### Round 3 (action: implement)

- decision `q3-third` = "nachschub" (untouched)
- decision `q3-hints` = "ok" (untouched)
- decision `q3-matrix` = "ok"
- decision `q3-shipicon` = "hangar"
- annotation `ub-s1-a1` (`ub-s1`): Der Streifen kostet ~180 px Panelbreite. Lohnt sich das für ein reines Erkennungsbild?
  > JA SCHON; ABER BITTE NICHT selbst das icon mit einem weiteren kasten...
- annotation `ub-s1-a2` (`ub-s1`): Unter dem Umriss nur das Modell in Kleinbuchstaben: hilfreich, oder doppelt zur Zeile?
  > ne, wir machen die silhouette nur im icon inline, nicht hier nochmall extra!
- pin `ub-s3` on span.mk-u-chip.hov "Größe 4 ▾×Größe 1 2Größe 2 3Größe 3 4Grö"
  > sehr gut aber bitte keinen helligkeitsunterschied zwischen chip und drop down, ansonsten gut!
- pin `ub-s3` on span "Größe 6 0"
  > zeige sizes mit 0 ausgegraut aber anklickbar an!

