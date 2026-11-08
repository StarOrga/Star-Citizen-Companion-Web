# Verbatim feedback (generated from the payloads, do not edit)

## Round 1 — action iterate
- general: > das mit der app links unten finde ich schon viel viel besser! daskannst du in einer subsession schon implementieren und shippen!
- anno-r-a1: > sehr gut, aber bitte die exakt gleichen symbole nehmen wie in der suche etc.
- q-visible-note: > ja auahc auf hq start, aber da in der mitte auch das alignenn, dass das damit zusammenpasst. /  / Außerdem in jedem links unten anchor spezifisch (z. B. Bestand) immer eine kleine raussicht die erklärt wozu man es braucht, was es macht, siehe auch den größeren text in Jetzt aktuell, dort hin migrieren
- design-register: > Also die sind mir alle noch nicht innovatgv genug, wenig thematisch, klar muss man direkt es excel listen mäßig wie hier vewalten können, aber zu unkreativ, außerdem ist die seitenbreite nicht die originale. / Zudem analysiere nochmal diie use cases wie 10 Agricium von verschieddenen standorten... => zum nachschub abholen machen. Nachbestellen gern auch weiteres nicht nur das letzte! Außerdem was habe ich alles in area18, ggf. auch angeordnet je nachdem wie viel im bestand ist aber bei so vielen orten auch suchbar!...  / wenn man etwas falsch eingetragen hat oder es veraltet ist soll man es rausschmeißen können.  / Bei ressourcen und co. sollte man auch qualitäten sheen können, aber zusammengefasst als z. B. Eisen, aber irgendwie sichtbar wie viel ich von welcher qualität ungefähr habe, gertn visuell diagramm mäßig dargestellt.  / Ggf. brauchen wir auch einen übersichtsmodus und einen detailmodus... / Außerdem aufzeigen was man verschrotten kann und wass nicht im craft fabrikator. / Natürlich auch die ienztlenen gegenstände auf die wunschliste erneut bringen! / Wenn man etwas filtered oder sucht sollten passende alterniven angeboten werden, z. b. kein eisen? Eisen auf die wunschliste nehmen ujnd direkt in den nachschub brijngen oder so!? Oder hier hast du auch noch eisen, obwohhl du woanders gefiltert hast.  / 10 Eisen von 15 scu sollten reeservierbar sein für einen sc freund angeboten nach dort wo man es hat, alles änderbar. Außerdem reservierungen irgendwo filterbar machen / anzteign können im bestand.  / Zudem direkt nicht in wunschliste oder nachschub sondern als verkaufseinsatz ine ihnenim nachschub der geld bringt (keine entitäten physissch, sprich neue nachschub klasse) aufnehmen. Gern bei planenn neuer nachschub popup generell mitaufnehemen, dass man geld amchen will und dnacach nnicht aus der wunschliste sonsern aus dem bestand auswählt .  / Einträge ovn hand sollten sich natürlich immer an der letzten bekannten ort defualt ausgewählt sein.  / Lege eiin issue an für vc app, dass man live im overla ysieht beim looten ob man das verschrotten kann was man einsammelt, gebrujachen kann etc.
- pin r-s1 on span.d0-chip "Sonstiges2": > ´das muss deterministischer sein, ich will immer wieder alle optionen sehen uzm filtern, das darf sich nicht ändern fü r nnur die die ich habe!
- pin r-s1 on path: > irgendwiei langweilig so...
- decisions: q-alle="nozero" · q-filter=["origin","role","kind","place"] · q-search="tiered" · q-sets="inv" · q-states="four" · q-visible={"answer":"yes","alt":""} · q-empty="sentence" · q-frame="paged"

## Round 2 — action iterate · favourite frachtdeck
- anno-a-1: > Filter super! Relative größe auch gut, abhängig dann von dem oben, aber bitte nicht nach scu only filtern oder stück zahl, lass die beiden angaben einfach weg!
- anno-a-2: > ok, also durschnittliche qualität? in dieser ansicht sollten alle eisen aggregiert sein... an einem standort zumindest
- anno-a-3: > Finde ich gut aber sollte dann noch ein stück höher geozgen werden, dort wo jetzt orte sind. Außerdem bitte auch filter hierauf anwenden etc. !
- anno-a-4: > Ja, aber was mit teilfiltern, rüstung=> Helme etc...
- anno-a-5: > sehr gute idee, aber bitte nur reserviertes schraffieren in einem balken, nicht den gesamten balken!
- anno-a-7: > ja sehr gut, aber nachscub anlegen klingt nicht intuitiv aber gut, können wir jetzt nicht lösen, ggf. als issue erstellen mit hinweis, dass das wording nachschub nochmal concpeted werden muss ob eins behalten oder warenkorb vs Besorgungen vs... aber was wenn man mehrere für eine route (mehrere einsätze mischt)..
- anno-c-3: > Eigentlich sehr interessant, aber sooo interessant, hmmm, letzten drei interessant zu sehen... was sich so im bestand ändert ggf. extendable
- q-reorder-note: > eher anhand der letzten aktiviätetn fest machen, egal wann sie waren...
- pin a-s1 on a.on "Inventar24 SCU · 7": > Hier brauchen wir die auswahl alles noch!
- pin a-s1 on a.on "Inventar24 SCU · 7": > scu und zahlen dort in der leiste sind nich t hilfreich
- pin a-s3 on span "6 SCU · Area18": > Die sollten genauso aussehen wie auf der startseite nur mit quaLITÄT label! hervorgehoben und reservierungen. /  / Wiedererkkennungswert, gleicher kasten, etwas mehr info
- decisions: q-quality="app" · q-scrap="extract" · q-places="grouped" · q-pickup="gather" · q-sell="type" · q-reserve=["friend","text","notify","expire"] · q-alt=["elsewhere","wish","swap","craft"] · q-reorder=""

## Round 3 — action implement
- anno-a3-2: > aber min. 3 buchstaben im namen!
- anno-a3-3: > ok!
- anno-a3-5: > Ok, wobei ich die drei filterzeilen noch so naja finde!
- anno-a3-6: > das wort und wie viel reserviert, gern anzeigen bei hover over, auch die genaue qualität!
- q-route-note: > aber man kann ja mehrfach das zu einem bestehenden nachschub hijnzu fügen und verwalten nich timmer nu reeinem neuen!
- pin a3-s1 on aside.d14-log "LadeprotokollAlles, was du hast: Inventa": > Das panel noch etwas peppiger, noch etwas weniger textuell, weniger erklärungen!
- pin a3-s1 on div.d14-used "Zuletzt aufgebraucht · letzte Spielsitzu": > Das geht hier unten irgendwi eunter und ich sehe auch nicht das protokoll zusammenhängend oben letzte änderungen....
- pin a3-s2 on small "Frachtraum": > aber die cutlass ist ja auch irgendwo! idann lieber den ort angeben und system und ort. nur wenn irgendwo im weltraum, dann gern cutllass weltall oder so..
- pin a3-s6 on span.d10-btn.sec "Reservieren": > Das finde ich super und raffiniert !
- pin a3-s6 on span.d10-btn.sec "Verkaufen": > Gern das auch einfühhren für die übersicht ansicht wenn man im log oder wo auch immer was auswählt. Dort auswählen bitte mit highlighting statt checkboxen oder sooo.
- pin a3-s7 on div.alt "Eisen Q ≥ 700 wünschen und einplanendire": > finde ich super! Gern auch bei suche mit <= 3 Treffern !
- decisions: q-recent="changes" · q-route="none" · q-subfilter="codex"
