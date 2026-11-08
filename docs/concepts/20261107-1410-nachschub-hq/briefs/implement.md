# Implement brief — Nachschub ins HQ

Generated from the payloads of rounds 1–4 (rule 6). Decisions summary: [../../20261107-1410-nachschub-hq-decisions.json](../../20261107-1410-nachschub-hq-decisions.json). The contract is [../../nachschub-hq-ui-spec.md](../../nachschub-hq-ui-spec.md); the visual target is round 4 (design Holo-Tafel, rounds/04.html, screens r4-d1-*). Where a later round contradicts an earlier one, the later round wins.

## Round 1 — every remark verbatim

- **general**: Btw, wunschlisten sollten auch zähler háben können (weil man sich ja 20 rattler wünschen kann als raketen). Damit läuft sozusagen alles durch, außer Wunschliste => Nachschub => Inventar/Hanger/Sammlung Manchmal mit abkürzungen und manchmal geht wie bei news direkt njur in sammlungen!
- **d-model-note**: Ich finde die idee gut, alles geht auf eine wunschliste, dann kann ich im hq hingehen unter planen und wunschlsiten themen in den nachschub reinbringen. Ein Nachschub kann dann geplant werden in 1-x Einsätzen (teils missionen oder bergbau oder usw.) um den gesamten nachschub am ende zum bestand zu überführen (Inventar/Hangar). Dabei kann man nicht teilweise den nachschub planen - denn das würde man dann eher so machen, dass man halt nciht alles von der wunschliste in den nachschub überführt. Außerdem bzgl. Lesezeichen, ne, lass uns das doch auch ala Gesammelt machen, man kann sozusagen auch news, galiere bilder (geht ja schon heute) sammeln! Das heißt am ende ist sammeln gleich gestellt mit inventar / hangar / blaupauseun+ruf gesammlet.
- **d-done-note**: Nur wenn automatisch erkannt wurde, dass man es im inventar jetzt neu hat ggü. zustand vorher oder wenn es manuell abgehakt wurde! Weil manchmal spielt man ja auch länger nicht. Es sollte aber immer wieder die mgölichkeit kgeben den nachschub zu leeren, => wird wieder in wunschliste überführt bzw. dort hochgezählt
- **d-guest-note**: Alles nur mit anmeldung! und gäste können doch gar nix die sehen nur einen anmelde screen? Du meinst viewer, angemeldete, die dürfen alles machen! Nimm das konzept der gäste komplett heraus, unangemeldete user seehen nur die startseite mit login! einmal angemeldet und vom admin angenommen / eingeeladen, darf der user dann alles machen was nicht collaboratuer oder admin erfordert.
- **d-hqhome-note**: Aber dabei eher wunschliste zu nachschub übernehmen!  Daneben natürlich immer angezeigt in jetzt wofür man alle einsätze und co. macht nämlcih für den nachschub zu besorgen. Man soll aber auch mehrere nachschübe vorplanen können (bis zu 7), die jewiels 1-x Einsätze enthalten. Und in jetzt macht man nur ein Einsatzkonglomerat für 1 Nachschub. Den Nachschub auch gern dynamsisch benennen lassen mit der ki und den einsatz dazu uach, nachschub anhand dessen, was man bekommmt zusammengefasst in kurz (zeichenlimits respekteiren) und einsätze anhand was man m achen muss!
- **d-codex-note**: aber blaupasen materialien kann man ja nachdem eine blaupause zur wunschliste hinzufügen kann (die man ja z. B. durhc missiionen bkeommt), dann auch auch von der blaupause aus klicken x mal in die wunschliste das material überführen um dann die mateirailien zus sammeln (gern dann gruppiert, das man weiß, dass sie für diese blaupause craften sind bzw. gegenstand craften )
- **d-hqpopup-note**: Naja, wesentlich präsenter und ncih thinter popup versteckt, man soll den aktuelle Einsatzplanung sehen und dort Nachschub ergänzen um Dinge der WUnschliste und man sieht direkt dann die Einsätze... Nachholen heißt auf die wunschliste packen! Danach kann man hingehen und das zum nachschub hinzufügen für eine konkrete einsatzplanung unter planen im hq!
- **d-wishhome-note**: wunschliste ist wie eine shopping cart sozusagen ein popup oder so
- **d-term-note**: Stimmt, es sollte inventar / Hangar / Sammlung heißen, aber Bestand darf der oberbegriff selten genutzt sein!
- **d-panel-note**: Kontextabhängig eher Zuletzt geöffnet + Wunschliste +Hangar/Inventar/Sammlung  (letzteres kontextabhängig)
- **d-ptype-note**: sonst wird es zu viel!
- **d-pname-note**: Aber bitte drein als icon, nur aufgeklappt sieht man das wording!
- **d-picon-note**: gefällt mir alles noch nicht, eher einen verschnitt aus lesezeichen, warenkorb, zuletzt geöfnnet, geschenk, will ich icons brauch ich! gern nochmal kreativ werden und mir visuelel vorschläge machen!

### Decisions

- d-model → "ok"
- d-fulfil → {"answer":"yes","alt":""}
- d-ship → "close"
- d-raw → {"answer":"no","alt":""}
- d-done → "" (Keine passt — note is the answer)
- d-guest → "" (Keine passt — note is the answer)
- d-edge → ["keep","upcoming","pledge","manual","zero","origin","second","wipe"]
- d-hqhome → "plan"
- d-codex → "hq"
- d-hqpopup → "" (Keine passt — note is the answer)
- d-stock → "" (Keine passt — note is the answer)
- d-wishhome → "" (Keine passt — note is the answer)
- d-loose → {"answer":"yes","alt":""}
- d-term → "Bestand"
- d-panel → {"answer":"yes","alt":""}
- d-ptype → "filter"
- d-pcount → "wish"
- d-pnach → "out"
- d-pname → "Schnellzugriff"
- d-picon → "" (Keine passt — note is the answer)
- d-news → "panel"

## Round 2 — every remark verbatim

- **general**: als nächstes dann gern ein devops cocnetp mit design pure!
- **r2-d2-split-note**: ja, auch wenn default immer volles übernehmen ist
- **r2-d2-detect-note**: Genau, egal ob manuell oder mit live signal aus scc app erhöht
- **r2-d2-limit-note**: bzw. lieber "Slots" aktive (max. 7) und sonst archivierte
- **r2-d2-sammlung-note**: Hmmm, also für mich ist galerie bilder sammeln wie blueprints samlen / verdienen! Wir wollen nix visuell an galerie verändern, ich würde einfach sagen hochgevotete galeriebilder oder gemerkte news sind einfach auch gesammelt ;)    Erledigte missionen gern in statsitik aufnehmen!
- **r2-d2-cart-note**: gern in bestand auch andersartig, kürzlich aufgebruachtes anzeigen, weil man das ja ggf. nachholen will, aber nicht alles sondern nur was in den letzten 48h augebraucht wurde
- **r2-t-uebergang-note**: aw

### Decisions

- r2-d2-flow → "ok"
- r2-d2-split → "split"
- r2-d2-detect → "snapshot"
- r2-d2-limit → "block"
- r2-d2-names → "ai"
- r2-d2-sammlung → ["blueprint","rep","news","vote"]
- r2-d2-stock → "hint"
- r2-d2-codex → "ok"
- r2-d2-plan → "ok"
- r2-d2-now → "ok"
- r2-d2-stock-page → "ok"
- r2-d2-cart → "ok"
- r2-d2-panel → "ok"
- r2-d2-cleanup → "ok"
- r2-d2-migrate → "one"
- r2-d2-newsmove → "copy"
- r2-d2-wishqty → "detail"
- r2-d2-shipqty → "same"
- r2-d2-panel-ctx → "none"

## Round 3 — every remark verbatim

- **general**: stresstest nochmal, das keine der seiten scrollable sein muss! Weil ich will nicht das man sie scrollen muss. Außerdem zeige es mir mit dem echten subeheader, der echten sieeten breite usw....
- **anno-r3-d2-s1-a1**: zahl benötigen wir nicht, der nutzer hat ja selbst interagiert, der weiß das dort was drin ist!
- **anno-r3-d2-s1-a2**: bilder sind schon gut,kl ist super!
- **anno-r3-d2-s1-a3**: ja passt
- **anno-r3-d2-s2-a1**: Macht alles Sinn, aber gern gruppiert! Außerdem die silhouetten sollten mehr von den hintergurjnd der kachel einnehmen, weil sie sonst nicht rein passen / gestrechted sind... Außerdem statt x button ein rote mülltonjne. Der rest ist super!
- **anno-r3-d2-s2-a2**: Ja auch als ganz egruppe anklickbar sein!
- **anno-r3-d2-s2-a3**: passt
- **anno-r3-d2-s3-a1**: Ja das finde ich gut! bei hover over mit löschen button Und dann rückfrage ob default elemente wieder 9in die wunschliste (abklickbar!)
- **anno-r3-d2-s3-a2**: sehr gut
- **anno-r3-d2-s3-a3**: ja oder man will auch den nachschub leeren und das ganze einfach löschen ohne auf dide wunschliste!?
- **anno-r3-d2-s4-a1**: Ne, ki weglassen als info
- **anno-r3-d2-s4-a2**: ok!
- **anno-r3-d2-s4-a3**: So erstmal nicht, am ende steht auch noch ein einsatz sozusagen , das craften selber! Das muss ehr mit rafinesse se9in hier
- **anno-r3-d2-s5-a1**: Ne, aber gern kann auf der route ein kleinster dezenter hinweis sein, dass man xyz auch für einen anderen nachschub benötigt, vllt. ein icon was man dann anklicken kann
- **anno-r3-d2-s5-a2**: genau oder halt synchronisiert, deshlab gern wie  links auch unten links in dem kasten sccc appp live infos bzw. zuletzt inf+
- **anno-r3-d2-s5-a3**: Das reicht aber Paket ist ein neuer begriff, eben hatten wir noch Nachschub Pakete oder wie nochmal?
- **anno-r3-d2-s6-a3**: Ok!
- **anno-r3-d2-s7-a1**: Ok ja, ggf. chefdck ohb die scc app es liefern kann und ship dort die änderung
- **anno-r3-d2-s7-a2**: perfekt
- **anno-r3-d2-s7-a3**: perfekt
- **anno-r3-d2-s8-a1**: das macht sinn
- **anno-r3-d2-s8-a2**: gut
- **anno-r3-d2-s8-a3**: Ja genau!
- **anno-r3-d2-s9-a1**: ja sehr gut, direkt drn
- **anno-r3-d2-s9-a2**: genau, aber man sollte es hier auch hinzufgügen können durch einen klick uzjnd dd anach den stepper uach
- **anno-r3-d2-s9-a3**: nein, das ist ok so!
- **anno-r3-d2-s10-a3**: ja das ist ok, im nachschub auch, aber in der einsatzplanung dort spielt das dann keine rolle, weil ich ja alumnium von einem ort brauche, dort gern mentioned wofür, aber nicht danach soritert bzw. gruppiert
- **r3-icon-pick-note**: finde es aber irgendwie leicht zu granular für da oben, das sieht man kaum in der grö0ße !
- **d2-s9**: sehr gut, gern die detailssiete dafür umgestalten (von codex, abver auch mit variante hq), aber unbedingt alle infos,k die es jetzt dort gibt behalten und umschaltbar zwischen silhouette und 3d modekll,k eigentlich wie im holotisch für schiffe subseite.  Bitte schiffs subseiten außer holotoiscih nicht anfassen
- **r3-d2-s1-a1** (Q: Oben rechts nur Symbol und Zahl, kein Wort. Die Zahl zählt Positionen auf der Wunschliste (11), nicht Stück. Ist das ohne Wort eindeutig genug?): zahl benötigen wir nicht, der nutzer hat ja selbst interagiert, der weiß das dort was drin ist!
- **r3-d2-s1-a2** (Q: Zuletzt geöffnet als drei Bild-Kacheln, Wünsche als Zeilen mit Mengen-Chip, Inventar als Chips. Alles auf Waffen gefiltert. Sind Bilder hier hilfreich oder zu viel?): bilder sind schon gut,kl ist super!
- **r3-d2-s1-a3** (Q: „Ganze Wunschliste“ ist ein echter Link mit eigener URL und öffnet den Warenkorb. Passt die Stelle am Ende des Wunsch-Abschnitts?): ja passt
- **r3-d2-s2-a1** (Q: Jede Position hat eine Menge (Stepper − / +, Standard 1), auch Schiffe: 2× Cutlass Black. Fehlt dir in der Zeile etwas?): Macht alles Sinn, aber gern gruppiert! Außerdem die silhouetten sollten mehr von den hintergurjnd der kachel einnehmen, weil sie sonst nicht rein passen / gestrechted sind... Außerdem statt x button ein rote mülltonjne. Der rest ist super!
- **r3-d2-s2-a2** (Q: Material hängt gruppiert unter seiner Blaupause („für P4-AR craften“). Soll die ganze Gruppe mit einem Klick auswählbar sein?): Ja auch als ganz egruppe anklickbar sein!
- **r3-d2-s2-a3** (Q: Eine Hauptaktion: „In einen Nachschub“ nimmt die Auswahl mit nach Planen. Entfernen geht sofort, Rückgängig steht im Hinweis unten. Okay so?): passt
- **r3-d2-s3-a1** (Q: Pakete als 7 Slots auf einer Leiste, jeder mit Fortschrittsring; freie Slots als leere Ringe, Archiv (4) am Ende. Liest du den Ring schneller als „4/9“?): Ja das finde ich gut! bei hover over mit löschen button Und dann rückfrage ob default elemente wieder 9in die wunschliste (abklickbar!)
- **r3-d2-s3-a2** (Q: Eine Zeile schließt nur, wenn der Bestand gegenüber dem Stand bei der Planung gestiegen ist (SCC-App oder von Hand) oder per Haken, nie nach Zeit. Ist der Stand pro Zeile gut lesbar?): sehr gut
- **r3-d2-s3-a3** (Q: „Nachschub leeren“ legt alle offenen Zeilen zurück auf die Wunschliste (Mengen werden dort addiert), mit Rückgängig. Passt der Ort ganz unten im Paket?): ja oder man will auch den nachschub leeren und das ganze einfach löschen ohne auf dide wunschliste!?
- **r3-d2-s4-a1** (Q: Der Name kommt als KI-Vorschlag (was du bekommst, höchstens 28 Zeichen), jederzeit änderbar; ohne KI greift eine Regel. Soll der Vorschlag sichtbar als KI markiert sein?): Ne, ki weglassen als info
- **r3-d2-s4-a2** (Q: Standard: die volle Menge wandert ins Paket. Teilen geht (5 von 20), der Rest bleibt auf der Wunschliste. Ist das Teilen so auffindbar?): ok!
- **r3-d2-s4-a3** (Q: Einsätze bekommen eigene KI-Namen (was du tust, höchstens 40 Zeichen) und gehören zum Paket, geplant wird das Paket als Ganzes. Fehlt hier eine Angabe?): So erstmal nicht, am ende steht auch noch ein einsatz sozusagen , das craften selber! Das muss ehr mit rafinesse se9in hier
- **r3-d2-s5-a1** (Q: Paket-Leiste mit Ring 4/9 über der Karte: Jetzt bedient genau dieses Paket. Soll die Route auf der Karte auch die anderen Pakete blass zeigen?): Ne, aber gern kann auf der route ein kleinster dezenter hinweis sein, dass man xyz auch für einen anderen nachschub benötigt, vllt. ein icon was man dann anklicken kann
- **r3-d2-s5-a2** (Q: Ein Hauptknopf: der nächste Schritt. Zeilen schließen weiter nur über Bestand oder Haken. Soll der Knopf den Haken der Zeile gleich mit setzen?): genau oder halt synchronisiert, deshlab gern wie  links auch unten links in dem kasten sccc appp live infos bzw. zuletzt inf+
- **r3-d2-s5-a3** (Q: „Paket wechseln“ tauscht das ganze Einsatz-Bündel; der Stand des anderen Pakets bleibt erhalten. Reicht ein Knopf oder willst du die Pakete hier als Liste?): Das reicht aber Paket ist ein neuer begriff, eben hatten wir noch Nachschub Pakete oder wie nochmal?
- **r3-d2-s6-a3** (Q: „Ingame-Bestand zurücksetzen“ (für Wipes) liegt im Seitenmenü, als Gefahr markiert und nur mit Bestätigung. Ist das versteckt genug, aber findbar?): Ok!
- **r3-d2-s7-a1** (Q: Ruf hat noch keine Datenquelle: leerer Zustand statt erfundener Zahlen. Woher der Ruf kommt (von Hand oder SCC-App) ist noch offen. Reicht dieser Hinweis?): Ok ja, ggf. chefdck ohb die scc app es liefern kann und ship dort die änderung
- **r3-d2-s7-a2** (Q: Hochgevotete Wallpaper zählen als gesammelt, in der Galerie selbst ändert sich nichts. Sollen hier alle oder nur die letzten 4 stehen?): perfekt
- **r3-d2-s7-a3** (Q: News heißen hier „gesammelt“, das Wort „Lesezeichen“ ist weg; alte Lesezeichen wandern beim nächsten Besuch ins Konto. Passt die Reihenfolge der vier Abschnitte?): perfekt
- **r3-d2-s8-a1** (Q: Zwei Knoten mit Linie dazwischen (Wunschliste → Besitz) als Weg-Anzeige; nur die Zahl, kein Stepper. Liest sich die Linie als Weg oder als Deko?): das macht sinn
- **r3-d2-s8-a2** (Q: Rattler II steckt in einem Paket, die Zeile zeigt dafür nichts extra; Nachschub lebt im HQ. Vermisst du hier einen Hinweis?): gut
- **r3-d2-s8-a3** (Q: Offen: Soll ein Klick auf den leeren Wunsch-Knoten direkt 1 Stück auf die Wunschliste legen, oder erst die Detailseite öffnen?): Ja genau!
- **r3-d2-s9-a1** (Q: Auf der Detailseite sitzt der Stepper direkt am Wunsch-Knoten, Standard 1. Gehört die Zahl in den Knoten oder daneben?): ja sehr gut, direkt drn
- **r3-d2-s9-a2** (Q: Besitz zeigt Menge 0 als „nicht im Inventar“, 0 heißt überall „nicht da“. Eigener Bestand von Hand zählt genauso. Klar so?): genau, aber man sollte es hier auch hinzufgügen können durch einen klick uzjnd dd anach den stepper uach
- **r3-d2-s9-a3** (Q: Keine Nachschub-Pille auf Codex-Seiten: ob die Gallant schon in einem Paket steckt, zeigt nur das HQ. Fehlt dir das hier?): nein, das ist ok so!
- **r3-d2-s10-a3** (Q: Landet als Gruppe „für Gallant craften“, getrennt von „für P4-AR craften“, auch wenn beide Aluminium brauchen. Passt diese Trennung?): ja das ist ok, im nachschub auch, aber in der einsatzplanung dort spielt das dann keine rolle, weil ich ja alumnium von einem ort brauche, dort gern mentioned wofür, aber nicht danach soritert bzw. gruppiert
- **pin d2-s1 @ b "Gallant"**: hier gern die zuletzt 3 hinzugefügten auf der wunschliste, ggf. filtered bei dem typ wo man gerade ist, sonst einfach generell wenn es keine gibt. Natürlich falls verfügbar
- **pin d2-s1 @ span.d2-chip.d2-chip-own "S-38 Pistole · 2"**: das müsste auch strengtens gefiltert sein auf den gleichen typ, aber gern hier uach hangar schreiben wenn es schiffe sind, oder sammlung wenn blaupausen etc. Dabei gern hier die letzten drei zum inventar hinzugefügtren des typss, wenn nciht generell die letzten drei hinzugeffügten...  Schreibe sie aber exakt genauso auf visuelle wie die wunschliste, auch mit der INfo Gesamtes Inventar mit deeplink zum hq => bestand => inventar
- **pin d2-s3 @ a.mk-on "Planen"**: die nvaigation soll bleiben wie sie isrt
- **pin d2-s3 @ span.d2-slot-hole**: Da die freien nur neuer nachschub sein können, würde ich hier einfach ein plus rein setzen ;)
- **pin d2-s3 @ div.d2-board "4/9Rattler-Vorrat für Vanguard2 Einsätze"**: Die Darstellung gefällt mir gut, besonders auch das arhciv, aber es sieht aus als wären sie zusammenhängend, exploreire nochmal das sie nicht so aussehen, weil sind sise ja nicht und auch, dass sie mehr als der nachschub in einer box / gift aussehen
- **pin d2-s4 @ h3.d2-h3 "Einsätze"**: hier vllt. noch die anzahl als info
- **pin d2-s4 @ div.d2-dlg-head "Neuer Nachschub Slot 4 von 7"**: Muss hier nicht noch ein scritt vorher kommen, wo ich die wunshcliste sehe und anklicke was ich übernehme in den nachschub, respektive ggf. alles. und dann hier gern erstmal alles zum nachschub einfach aufgelistet zusammengefasst insgesamt und dann die EInsätze und was daraus wird (wunschliste)
- **pin d2-s4 @ small "Medpen, Gallant"**: Ggf. das auch togglebar oder splitbar, wenn man gallant doch abbauen will etc. Hier muss noch mehr rafinesse rein
- **pin d2-s5 @ svg.d2-route "Seraphim-Station E1 · Einkauf Area18 E2 "**: ist der bereich hier auch für 15 schrittige einsätze + weitere routen ausgelegt!?=
- **pin d2-s5 @ div.d2-live "SCC-App: Inventar +2 Rattler II-Rakete ·"**: Das sollte im kasten imme r links unten sein!
- **pin d2-s5 @ svg.d2-route "Seraphim-Station E1 · Einkauf Area18 E2 "**: gern die routengrafik immer so, dass sie mittig rein passt, zoombar und icons die klar darstellen was man wo macht! Travel ist klar die routen, aber was mancht man an den orten!
- **pin d2-s3 @ div.d2-pkg-head "Rattler-Vorrat für Vanguard 4/9"**: sehr schön und dezent das namens ändern!
- **pin d2-s3 @ section.d2-panel.d2-pkg "Rattler-Vorrat für Vanguard 4/9 Lad**: wiue bearbeite ich von hier nochmal den nachschub oder mach ich das oben? !
- **pin d2-s3 @ small "E1 · Einkauf Area18 · +2 seit Planung"**: Hier sollten doch die Einsätze im vordergrund stehen und nicht was man dort bekommt, also dreh das uM!
- **pin d2-s3 @ svg.d2-route "Seraphim-Station E1 · Einkauf Area18 E2 "**: ist die grafik flexibel auch sternensystme übergreifend zu agieren und so, mach mal komplexere einsätze, wesentlich komplexer aber sinnhaft. Legende gern versteckt aber gern mit 7 icons einsatz für bestimmte aktionen an den orten und man kann ggf. welche ein / ausblenden!
- **pin d2-s6 @ button "Eintrag von Hand anlegen"**: Eintrag von han dmuss leichter zugägnlich sein, gern einfach als + kachel vorne weg
- **pin d2-s6 @ main.mk-main.d2-page "BestandStartPlanenJetztBestandStatisti**: Gern wieder links unten scc app live ticker was als letztes hierzu wann aufgenommen wurde! Das könnten wir überall im hq als pattern etablieren, außer auf der startseite. Natürlich nur wenn diese auch verbunden wurde, egal ob sie gerade an (grün) oder aus ist (grau) immer das letzte relevante
- **pin d2-s6 @ span.d2-used "3× P4-AR-Magazinvor 31 h"**: auch sehr raffiniert ggf. sowas auch zusammenzufgassen
- **pin d2-s7 @ div.d2-colgrid.mk-cols "Blaupausen 3 GallantP4-ARPembroke-He**: finde ich super aber lass uns news und gallerie hier4 weg lassen, aber das prinzipielle visuelle pattern in galerie selber subseite bzw. in newss selber subseite drin haben!
- **pin d2-s8 @ span "Besitz"**: besitz ruachen wir dafür nicht, inventar passt immer wenn es nicht hangar (für schiffe und fahrzeuge ist). Außer für news und co. heißt es ja eher gesammelt/Sammlung
- **pin d2-s4 @ h2.d2-glow "Neuer Nachschub Slot 4 von 7"**: Das icon fand ich auch gar nciht schlecht für nachschub hier im hq ztu verwenden.
- **pin d2-s8 @ span "Inventar"**: wenn man auf inventar klickt, kommt man direkt zu dem ins inventar
- **pin d2-s2 @ div.d2-cgrid "GallantEnergiegewehr2 P4-AR-MagazinMunit"**: Gern auch noich eine vorhsclagszeiele hier was man noch kaufen könnte oder craften könnte mit 3 top vorschlägen. Z. B. wenn jemand eine pembroke helm gerade hinzugefügt hat als letztes, dann bieetet sich eine pembrook armor an. Oder wenn jemand eine waffe crafted, mag dazu ein magazin crafted werden oder gekauft werden, je nachdem was besser passt von rohstoiffen oder zwischenhalten. Da also eine sehr intelligente multidiemensionale empefhlungsmatrix machen, fast wie amazon, gern online studien und mechanismen dazu einbez8iehen. Aber vor allem asuch auf Gegenstand komplementär > Materialien gleiche > Ort > Handlung bezogen empefehlen! Dabei nur die drei danach bewertentejn trop effmpefhlungen anzeigen. Alles determinisitisch bestimmen, fügt man ein schiff hinzu, sind schiffswaffeninteressant usw.

### Decisions

- r3-icon-pick → "crate"

## Round 4 — every remark verbatim

- **anno-r4-d1-s1-a2**: nope, das ist dann implizit
- **anno-r4-d1-s1-a3**: mitkommen natürlich!
- **anno-r4-d1-s2-a1**: super!
- **anno-r4-d1-s2-a2**: nein, genauso
- **anno-r4-d1-s2-a3**: nur bis zum nächsten hinzufügen und für einn gexxten vorschlag soll ein neuer kommen :) halte mindestens immer 7 vor falls dem nutzer die 3 nicht gefallen !
- **anno-r4-d1-s3-a1**: ja von selbst!
- **anno-r4-d1-s3-a2**: sehr gut
- **anno-r4-d1-s3-a3**: pro route bzw. nachschub einsatz!
- **anno-r4-d1-s4a-a2**: ja ist klar!
- **anno-r4-d1-s4a-a3**: passt sich auch an
- **anno-r4-d1-s8-a1**: Sehr gut !
- **anno-r4-d1-s8-a3**: ne, der wetiere soll die wunschliste dann aufmachen
- **anno-r4-d1-s9-a1**: ja
- **anno-r4-d1-s9-a2**: das sieht schon richtig gut aus! Wobei sihlozhutette und 3d modell genausoi wie in holotisch beta in dem bild stehen sollte ! und vergleichen eher hier hier nicht, sondern nur wenn man in der übersicht ist der suche fullsite, also nicht schnellsuche
- **anno-r4-d1-s9h-a1**: sehr gu t
- **anno-r4-d1-s9h-a2**: ja
- **anno-r4-d1-s9h-a3**: sehr gut!
- **r4-slot-pick-note**: ja serhr gut, aber bitte polishen!
- **r4-d1-s9h**: bitte auch diese wie auch die anderen seiten cinematisch sehr gut animieren inkl. was ist sinnvollzuerst den fokus zu haben, was kommt später eingeblendet! Gern beim ersten aufmachen cinematisc h, danach auch animiert, aber innnerhalb schnellerer zeit
- **r4-d1-s1-a2** (Q: Gibt es zum Seitentyp keine Wünsche, stehen hier die letzten 3 insgesamt. Soll dann ein kleiner Hinweis „aus allen Typen“ dazu?): nope, das ist dann implizit
- **r4-d1-s1-a3** (Q: „Gesamtes Inventar“ springt zu HQ › Bestand › Inventar. Soll der Waffen-Filter dorthin mitkommen oder startet das Inventar ungefiltert?): mitkommen natürlich!
- **r4-d1-s2-a1** (Q: Gruppiert nach Art und nach Blaupause, ein Haken wählt die ganze Gruppe. Passt die Reihenfolge der Gruppen (Waffen zuerst, Blaupausen am Ende)?): super!
- **r4-d1-s2-a2** (Q: Entfernen geht sofort, Rückgängig kommt als Hinweis unten. Soll beim Entfernen einer ganzen Gruppe vorher nachgefragt werden?): nein, genauso
- **r4-d1-s2-a3** (Q: Genau 3 Vorschläge: Ergänzung vor gleichem Material vor gleichem Ort oder Shop vor gleicher Aktion. Soll ein weggeklickter Vorschlag für immer verschwinden oder nur bis zum nächsten Hinzufügen?): nur bis zum nächsten hinzufügen und für einn gexxten vorschlag soll ein neuer kommen :) halte mindestens immer 7 vor falls dem nutzer die 3 nicht gefallen !
- **r4-d1-s3-a1** (Q: Alle 7 Slots belegt, „Neuer Nachschub“ ist gesperrt und sagt warum. Soll ein fertiger Nachschub (Titan-Erz, 5/5) von selbst ins Archiv rutschen und den Slot freimachen?): ja von selbst!
- **r4-d1-s3-a2** (Q: „Bearbeiten“ öffnet die drei Schritte von „Neuer Nachschub“ mit diesem Inhalt. Darunter stehen jetzt die Einsätze vorn, die Ware als Chips dahinter. Liest sich das so richtig?): sehr gut
- **r4-d1-s3-a3** (Q: Die Legende ist sonst zu, hier offen: jede der 7 Aktionen lässt sich aus- und einblenden (Raffinieren ist aus). Soll die Auswahl pro Route gelten oder überall?): pro route bzw. nachschub einsatz!
- **r4-d1-s4a-a2** (Q: Teilen per Stepper: 2 von 4 Hydrierungspacks, der Balken zeigt den Anteil, der Rest bleibt auf der Wunschliste. Ist das so klar?): ja ist klar!
- **r4-d1-s4a-a3** (Q: Nimmst du aus einer Blaupausen-Gruppe nur einen Teil, passt sich dann die Stückzahl („2× Gallant“) an oder bleibt sie stehen?): passt sich auch an
- **r4-d1-s8-a1** (Q: ): Sehr gut !
- **r4-d1-s8-a3** (Q: Ein Klick legt 1 auf die Wunschliste, danach zeigt der Knoten „1“. Soll jeder weitere Klick +1 zählen oder dann die Detailseite mit Stepper öffnen?): ne, der wetiere soll die wunschliste dann aufmachen
- **r4-d1-s9-a1** (Q: Gibt es im Codex kein 3D-Modell, bleibt nur die Silhouette, der Schalter ist dann gesperrt und sagt warum. Okay so?): ja
- **r4-d1-s9-a2** (Q: Alle Blöcke von heute sind da: Werte (Fakten, Einschlagsschaden, Waffenparameter), Aufsätze an der Silhouette, Herstellung (Rezept, verwendet in Blaupausen), Kaufen & Info (Wo zu kaufen, Beschreibung, Datenblatt), dazu Lackierung, Vergleichen, Teilen, Codex/Persönlich und Build. Vermisst du einen?): das sieht schon richtig gut aus! Wobei sihlozhutette und 3d modell genausoi wie in holotisch beta in dem bild stehen sollte ! und vergleichen eher hier hier nicht, sondern nur wenn man in der übersicht ist der suche fullsite, also nicht schnellsuche
- **r4-d1-s9h-a1** (Q: ): sehr gu t
- **r4-d1-s9h-a2** (Q: Aus dem HQ geöffnet zeigt die Seite leise, in welchem Nachschub der Gegenstand steckt; im Codex bleibt das weg. Passt diese Trennung?): ja
- **r4-d1-s9h-a3** (Q: ): sehr gut!
- **pin r4-d1-s3 @ span "Neuer Nachschub"**: denb button bruachen wir nicht, das soll dann einfach ein slot nachschub sein, fall nicht belegt !
- **pin r4-d1-s7 @ svg.mk-sil.mk-sil-bp**: Hier auch ein plus füür per hand anlegen !
- **pin r4-d1-s7g @ span.mk-thumb.mk-t2**: sehr gut
- **pin r4-d1-s7g @ button "Community-Top"**: gern dieses dropdown auhc nochmal attraktiver machen, ist alles noch sehr bodl und in alten style gestyleed mit festtten brlauen käsatne
- **pin r4-d1-s7n @ b.mk-clamp "Pyro-Update: Ruin Station bekommt Raffin"**: sehr gut, wenn mehr, dann bitte mit umgehen!
- **pin r4-d1-s8 @ path**: nicht vergessen, in der schnellsuche korrekt mit den verschiednen gruppeirungen usw., aber in der full site suche aulso der auflistung befindet sich hier links noch ein inhaltsverzeichnis. Bitte bei beiden keine funktioniaätliten weg rationalisieren die nicht direkt mit wunschliste / inventar etc. zu tun haben - also das was wir hierändern
- **pin r4-d1-s9h @ span.mk-sharedock**: sehr gut auch den teilen buttoin hier zu haben

### Decisions

- r4-icon-pick → "frame"
- r4-slot-pick → "crate"

## Checklist (accepted items, by wave)

Budget mode: **sparsam** — one Sonnet agent at a time, wave after wave, each wave commits and pushes on `claude/nachschub-hq-concept-9ffa89`. Every agent returns an acceptance table: item → done / partial / not done → evidence (file:line, spec, screenshot).

### Wave 1 — data and logic (no visible redesign)
- [ ] W1.1 Migration: `search_wishlist.qty int not null default 1 check (qty between 1 and 999)`; ship wishes in `hangar_ships` get a quantity too (r2 `d2-shipqty` = same as everything).
- [ ] W1.2 Migration: `hq_supply_packages` (id, user_id, name ≤ 28, status active/archived, slot 1–7, created_at, updated_at, archived_at, snapshot jsonb of inventory qty per line at planning time); `hq_supplies.package_id`; `hq_einsaetze.package_id`. RLS owner-only. Max 7 active per user (DB check or trigger). Einsatz names ≤ 40.
- [ ] W1.3 Migration/data: existing open Nachschub lines → one package „Bisheriger Nachschub“ (r2 `d2-migrate` = one).
- [ ] W1.4 Sammlung read model: Blaupausen (collected), Ruf (empty, no source yet), news = collected news, gallery = up-voted wallpapers (`wallpaper_votes`). News bookmarks move from localStorage into an account table on next visit (r2 `d2-newsmove` = copy).
- [ ] W1.5 Services: wishlist with quantity (add 1 on first click; a further click on a filled wish node opens the cart, r4 s8-a3), take-from-wishlist into a package with split (default full quantity; the rest stays), „Nachschub leeren/löschen“ with return-to-wishlist checkbox (default on, counts up there), a finished package auto-archives and frees its slot (r4 s3-a1), line closes only on inventory rise vs snapshot (manual or SCC-App) or manual tick, owning fulfils the wish with undo, ship line closes on Hangar, blueprint material ×N to the wishlist grouped by blueprint (group quantity follows, r4 s4a-a3).
- [ ] W1.6 Remove the dead guest branches (login wall already in `app.routes.ts`): local supply list + import dialog, `signedOut` CTA row, sign-in ask, `needSignIn` guards, signed-out UI in stock/set/add-to-set/hangar.
- [ ] W1.7 Edge rules: catalogue never deletes player rows; announced ship wish follows it live; pledged announced ship allowed in Hangar; manual stock counts everywhere; qty 0 = not there everywhere; ship origin Pledge/Ingame/Leihschiff attribute; second copy allowed; „Ingame-Bestand zurücksetzen“ service (danger confirm in UI later).
- [ ] W1.8 Recommendation engine „Passt dazu“: pure function (anchor, catalogue, owned, wishlist) → ranked list, deterministic, per `docs/concepts/nachschub-recommendations-research.md`; complement > same material > same place/shop > same action; keep at least 7 ready, show 3; a dismissed suggestion is hidden only until the next add and is replaced (r4 s2-a3). Spec tests with fixtures.
- [ ] W1.9 AI naming edge function (package ≤ 28, Einsatz ≤ 40), rule-based fallback; never labelled as AI.
- [ ] W1.10 Unit specs for every transition; `npm run typecheck`, `npm test`, `npm run test:functions`.

### Wave 2 — HQ pages (visual target: rounds/04.html r4-d1-s3…s7)
- [ ] W2.1 Planen: 7 Nachschub slots as separate crates (style „Frachtkiste“, polished, r4 `r4-slot-pick` = crate + „bitte polishen“), free slots are „+“ and ARE the new-Nachschub entry (no separate button, r4 pin s3), archive, in-place rename, „Bearbeiten“, Einsätze first with goods as chips, route Stanton↔Pyro capable, zoom/pan/fit, 7 action icons with a hidden legend whose filter is per route/Nachschub (r4 s3-a3).
- [ ] W2.2 Neuer Nachschub / Bearbeiten: 3 steps Auswählen → Zusammenfassung → Einsätze (count shown, per-item buy/mine toggle and split, crafting last); tray-with-down-arrow icon for Nachschub in HQ.
- [ ] W2.3 Jetzt: one Nachschub's Einsatz bundle, progress, shared-stop icon, next step synced with SCC-App, SCC-App box bottom-left.
- [ ] W2.4 Bestand · Inventar: „+“ tile first, „Kürzlich aufgebraucht“ (48 h, summarised), row hint + Nachholen (= auf die Wunschliste), filter arrives from the Schnellzugriff deep link (r4 s1-a3).
- [ ] W2.5 Bestand · Sammlung: Blaupausen (+ tile for manual add, r4 pin s7) and Ruf (empty state).
- [ ] W2.6 SCC-App live ticker bottom-left on every HQ page except Start (green/grey, last relevant event, only once connected).
- [ ] W2.7 Wording: „Nachschub/Nachschübe“, never „Paket“; Inventar/Hangar/Sammlung, never „Besitz“; „Bestand“ only as umbrella.

### Wave 3 — Shell, cart, Codex, News, Galerie (r4-d1-s1, s2, s7g, s7n, s8, s9, s9h, s10)
- [ ] W3.1 Schnellzugriff: crate icon (r4 `r4-icon-pick` = frame variant) without count, word only in the opened panel; Zuletzt geöffnet 3→7 image tiles; Wunschliste = last 3 added (type-filtered, else overall, no hint); context section Inventar/Hangar/Sammlung = last 3 added of the type, same row look, „Gesamtes …“ deep link carrying the filter; no Nachschub; no Bestand section on pages without type.
- [ ] W3.2 Warenkorb dialog (`[scDialog]`, own URL): grouped (Waffen first, Blaupausen last), group checkbox, larger silhouettes (contain), red trash with undo (no confirm, also for groups), „Passt dazu“ row with 3 suggestions, one primary „In einen Nachschub“.
- [ ] W3.3 Codex search (quick search AND full-site search with its left table of contents): two nodes Wunschliste → Inventar/Hangar/Sammlung; Inventar node deep-links to the item in HQ; empty wish node +1. **Do not remove any feature not related to wishlist/inventory** (r4 pin s8).
- [ ] W3.4 Codex detail redesign like the holotable beta subpage: silhouette ↔ 3D toggle placed exactly like in the holotable beta image, disabled with reason when no 3D model; keep every info block; „Vergleichen“ only in the full-site search overview, not on the detail page (r4 s9-a2); share button stays; HQ variant shows quietly which Nachschub holds the item. Ship subpages other than the holotable stay untouched.
- [ ] W3.5 Cinematic entry animation on these pages: focus order (what first, what later), cinematic on first open, faster on later opens (r4 screen note s9h).
- [ ] W3.6 Galerie and News subpages show the Sammlung pattern; the gallery's „Community-Top“ dropdown restyled (no old fixed blue boxes, r4 pin s7g); news collected list handles overflow (r4 pin s7n).
- [ ] W3.7 i18n DE/EN for every new string; `npm run build`, `npm test`, mobile gate.

### Out of scope / follow-ups
- Ruf data source from the SCC-App (user: „ggf. checken ob die scc app es liefern kann und ship dort die änderung“) — separate task in the desktop app.

## Resume state (2026-11-08, paused for the weekly budget reset + plugin restart)
- Waves 1–3 committed and pushed on `claude/nachschub-hq-concept-9ffa89` (last `8e236ac7` + main merges). Full Karma suite green: `TOTAL: 6216 SUCCESS` (orchestrator run, 2026-11-08). typecheck, lint (0 errors), build green per agent reports.
- Open (wave 4, QA): signed-in visual check of every redesigned page against `rounds/04.html` at 1920×1080 and 1440×900 (no page scroll), mobile gate with `--auth`. Needs a session that loads the Playwright test account (`.claude/deep-knowledge/test-account.md`). The `--it-top: 300px` offset in `src/styles.scss` is an unmeasured guess — check first.
- Known gaps: missiles keep the old detail hero; „Passt dazu“ covers FPS armor/weapons only (ships, blueprints, places, magazines not yet); unused `itemPath.*` / `hq.supplies.*` i18n keys; no tooltip for truncated cart tile names; three wave-1 services without own specs.
- Not deployed: migrations `20261107190000_wishlist_qty.sql`, `20261107190100_hq_supply_packages.sql`, `20261107190200_user_news_collected.sql` and edge function `nachschub-names` — deploy with the ship (then `notify pgrst, 'reload schema'`).
- Then: the concept's final report (auto-concept implement → final-report round) and the ship.
- Follow-up outside scope: Ruf (reputation) data from the SCC-App.

## Wave 5 — Planen refinements (input from the session „HQ Planen: leer vs. gefüllt, eine Seite, Führung“, 2026-11-08; user decisions quoted there verbatim; context: `docs/concepts/20261107-1400-hq-planen-gefuehrt*` on branch `claude/hq-planning-devops-agents-4c0cb0`)
- [x] W5.1 Layout — SUPERSEDED by the user (2026-11-08), verbatim: „bzgl. planen layout, nimm lieber das von unserem konzept, weil das ist besser als die drittel regeln! und bildet es im prinzip nur anders schon ab.“ → keep the Planen layout from this concept (round 3/4 design, as built in waves 1–3: Nachschub slots on top, wishlist take-over sheet, selected package with lines + Einsätze). No ⅓/⅔ column split. The planning-session idea it replaces: „1/3 des bildschirms ist wunschliste, 2/3 Einsatzplanung und verbindend die beiden ist der nachschub“.
- [ ] W5.2 Words, verbatim: „bitte nicht das wort route benutzen oder quellen oder bedarf, wir haben schon genügend worte!“ → drop the classic mode („Auswahl und Route“) or at least the inner Was/Wie switch; Community-Opt-in, Blueprint-Fortschritt, Warenpreise and geteilte Einsätze move out of Planen (user ticked all four).
- [ ] W5.3 Bug: `src/app/hq/plan/hq-plan-needs.ts:73-74` hard-codes `activity: null`, `crew: 1` → mood „Gruppe“ filters every line, „Friedlich“ hides all missions. Decision: hide moods until codex data exists.
- [ ] W5.4 Per line selectable, verbatim: „kaufen vs craften vs sammeln je nach verfügbarkeit pro typ auswählbar … Einsätze planen (dabei änderbar ob man z. B. crafted oder kauft)“ → `einsatz-proposal.ts` offers craft for items with a blueprint, not only buy/mine for material; a non-material line without a known merchant must not become a placeless buy (line 82).
- [ ] W5.5 Lines without a merchant get a way out: open Codex, set the place yourself, or take it out of the Einsatz.
- [x] W5.6 Confirmed as built: „In Jetzt ausführen“ sets at most a focus; lists scroll inside, the page stays; legend hidden with filter is fine.
