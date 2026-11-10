# Implement brief — Holotisch Feinschliff (concept 20261109-1745)

Scope: ship detail page, **Holotisch beta view only** (`shellBeta` / holo view). Classic view and item pages unchanged. Branch `claude/batch-fb8929` (this worktree). **Do not ship, do not merge, do not push to main.** Commit on the branch.

The user's final order (round 4, general note, verbatim):
> „Jetzt mach nochmal ein detailgetreues, info getreues komplett website exakt wie es später aussehen würde, dafür implementier es, ship es aber noch nicht, lade dir von vc web die daten zu einem schiff, z. B. Gladius und dann mach ein devops concept exakt hochauflösend und exakt korrekte information detailgetreu daraus was ich reviewen kann“

Target design = **round 4, design d1 „Feste Karte“** (`rounds/04.html`, screens `r4-d1-s1 … s7`) — read that fragment, it is the visual spec. Earlier rounds only where an item below points there. Every visible string via ngx-translate keys in `public/i18n/{de,en}.json`; project rules in the root `CLAUDE.md` (scAction, real anchors, sc-select, no native dialogs, colour rules, page frame) apply.

## Checklist (each item → done / partial / not done → evidence)

### Head and view hierarchy
- C1 No eyebrow „Tauschbare Bauteile · N“ / „Ziehen zum Drehen“ / „Alle Hardpoints“ (`codex-holo-stage.component.ts` `table-eyebrow`, `eyebrowKey`).
- C2 No `<kbd class="hk">V</kbd>` after 3D/Schema.
- C3 Head: ship name left; under it model variants „Standard · Valiant · Pirate · Dunlevy“ as real `<a [routerLink]>` links, only when variants exist (variants = sibling ship records of the same hull family that are separate models, e.g. AEGS_Gladius_Valiant/_PIR/_Dunlevy; editions stay folded, see C20).
- C4 Einsatz (mission picker, today in the strip's first segment) moves to the **top centre** of the head.
- C5 One merged hangar button top right: hangar icon + „2× im Hangar · <Ausstattung> ▾“ (count + currently shown loadout). Its single menu lists „Werk“ and every own exemplar (name, AI summary line, ◆ count of differing parts), plus actions: copy this exemplar, „new exemplar from Werk“ (only shown when the current selection is NOT Werk), add to hangar / to wishlist (clearly separated: Hangar vs. Wunschliste), rename/note/pin/remove for the selected exemplar. No patch label in this menu („Werksausstattung · 4.10.2“ removed — always the current patch).
- C6 Bottom row (one full-width row, d1): **Akte** first, then views (Außen: 3D, Einfach, Oben, Seite, Front | Innen: decks/rooms), then component filters (Waffen, Raketen, Komponenten, Sonstiges, Alle Teile). The hierarchy must read clearly: „Akte > Ansichten > Komponenten-Filter“ — views are a toggle (one active), filters are multi-select chips; make the two kinds visually distinct and grouped (e.g. labelled groups with a divider, filters styled as chips, views as thumbnails).
- C7 Seitensicht/Frontsicht disabled with reason tooltip when the data is missing (existing behaviour).
- C8 The strip expand arrow „▴“ is replaced by a thin bar/handle **below** the capsule that does not take width from the four topic segments.

### Callouts, pins, table
- C9 One callout component for 3D AND every schema view: header = component TYPE (e.g. „GATLING“, „Kühler“), name below, three values per type, swap icon button (`scAction` tertiary with aria-label + tooltip).
- C10 Einfach: non-selected parts as small tags „Typ + Größe“, the selected part as the full callout. Missile racks stay gold. No numbers anywhere on pins/labels.
- C11 Number hotkeys 1–N removed (and their hint).
- C12 Draufsicht/Seite/Front show the same parts as Einfach; chip „Alle Teile“ reveals raw ports.
- C13 3D: fixed camera distance that fits the ship from every direction (bounding sphere) — no zoom while rotating (`asset-package-scene.ts` ~553–576 re-solves the distance per direction). Ctrl+wheel still zooms by hand.

### Right card (d1 „Feste Karte“)
- C14 The three topics Einordnung · Bauteile · Änderungen as a fixed card on the right (same height as the Akte card), Einordnung default and always visible.
- C15 Einordnung: **nothing that existed may be lost** — keep the bars (Balken) etc.; add a toggle hexagon ⇄ bars; keep the comparison-group picker („Vergleich mit …“ — it was missing in the mock); show „Rang N von M <Gruppe>“ (the user loves the rank: „Rang finde ich ja viel besser als die Gesamtprozentzahl“).
- C16 Bauteile list: no „· N verbaut“ after categories; inspector without „3 / 18“.
- C17 Änderungen: sub-switch „Deine Anpassungen“ | „Patch-Vergleich“; default Anpassungen when an exemplar is shown, Patch-Vergleich when Werk is shown. „↺ Zurück auf Werk“ in Anpassungen (user: „sehr gut“).
- C18 Patch-Vergleich: one line „4.10.1 [Live] ▾ → 4.10.2 [Live] ● aktuell ▾“ (channel as a small tag, not `-LIVE`); right side is always the newer patch; each picker disables entries that would break from < to, with a reason tooltip. The top patch picker in the head goes away (patch choice only here).
- C19 One visual marker „◆ weicht vom Werk ab“ (filled diamond, app accent — never red/copper) identical on hull tag/pin, Bauteile list, inspector and the lower „Bauteile im Detail“ list; a small legend.

### Akte, liveries, ownership
- C20 Akte = description as a view (no „Akte“/„Beschreibung“ heading inside), first in the bottom row; text card top-left with fixed size (sized for ~900–1.100 chars, scrolls inside); facts; „Bei RSI ansehen ↗“; „Pledge-Link hinzufügen“ removed. Toggle „Nur Bild / Text zeigen“ stays at the same position in both states. Background: the official CIG/RSI image the app already has (heroArt / store render) — the user notes CIG images are plain images: show the image as is (cover), no fake full-colour background; hologram look when none exists.
- C21 Liveries inside the Akte as small image tiles (not chip-like, must not look like the component filters); a click swaps the Akte image. Editions with the same loadout fold into these tiles; editions with another loadout stay own models. The separate „Varianten & Vergleich“ box is removed from the Holotisch side column.
- C22 Ownership in one place (C5); remove the strip segment „1× im Hangar · Gezeigt: Serie“, the wish/supply icon badges under „Wo zu kaufen“, and the separate „Dein Exemplar“ card from the Holotisch view (actions live in C5's menu).
- C23 Werk sandbox: on the Werk loadout the user can swap components WITHOUT saving; saving as a new exemplar (hangar) or to the wishlist is offered but never forced.
- C24 Exemplar name is set by the player; at creation an AI name suggestion is offered when the exemplar differs from Werk (none otherwise). Reuse the `nachschub-names` edge-function pattern (Anthropic key as Supabase secret, never in the client).
- C25 AI summary per exemplar (character limit, e.g. ≤ 90 chars) shown in the menu; regenerated only when the user switches exemplar or leaves the page AND components actually changed since the last summary (store a hash of the loadout with the summary). If the backend part cannot be finished safely in this run, ship the UI with the stored/empty state and mark C24/C25 partial — no fake text.

### Data (Starlancer findings, from round 1)
- C26 Raw room names (e.g. „Room_RN-009“) are hidden; rooms assigned to decks by the uploader (uploader change may be out of scope here → mark partial with the finding: MISC_Starlancer_Max has Starlancer_Deck_1/_2 with 0 rooms and 24 rooms in the fallback deck; current build 4.10.2 dated 2026-11-01, silhouettes 2026-11-05 — the user's upload of 2026-11-08 did not land).

## Verification
- `npm run typecheck`, `npm run lint`, `npm test -- --include=app/codex/**/*.spec.ts`, `npm run build` (templates are only checked by the build).
- Real app on the Gladius (`/codex/ship/aegs_gladius` or the actual route) with the test account (`.claude/deep-knowledge/test-account.md`), screenshots at 1920×1080 of every state listed in round 4 d1 s1–s7, saved under `docs/concepts/20261109-1745-holotisch-feinschliff/shots/`. Those screenshots become the review round (round 5) of the concept.
- Each builder returns an acceptance table C# → done/partial/not done → evidence; an independent checker compares checklist vs diff vs screenshots before the review round.

## Verbatim feedback of every round

Decisions file: [../../20261109-1745-holotisch-feinschliff-decisions.json](../../20261109-1745-holotisch-feinschliff-decisions.json). Original batch notes: .claude/batch-2026-11-09T16-32-31-691Z.md (#1–#21, see briefs/02.md for #8, #12, #21 verbatim).

### Round 1 (favourite: —)
- Decision r1-co-title „Was oben im Callout steht“ → type
- Decision r1-co-rest „Callouts in Einfach“ → tags
- Decision r1-hotkeys „Ziffern-Tasten“ → drop
- Decision r1-3d-dist „Drehen ohne Zoom“ → sphere
- Decision r1-top-all „Draufsicht „Alle Hardpoints““ → swap
- Decision r1-rooms „Räume und Decks“ → uploader
- Decision r1-editions „Was aus Editionen wird“ → fold
- Decision r1-models „Modellvarianten“ → own
- Decision r1-exemplar „Werk oder dein Exemplar“ → switch
- Pin d2-s1 on button "Schema": „diese subauswahl finde ich noch nichtg super... Generlel mach nweitere variatnten“

### Round 2 (favourite: d2)
- Annotation r2-d2-s1-a1 („Jede Ansicht als Vorschaubild mit Namen darunter, in drei Gruppen. Sind acht Bilder unten am Tisch zu viel, oder genau richtig?“): „Das finde ich eine super idee! Aber bitte links akte angefangen und dabei in der akte zusätzlich als background das offizielle sc  bild wenn fverüfgbar !“
- Annotation r2-d2-s7-a1 („Besitz als Abzeichen in der Tischecke, der Schalter Werk/Mein Exemplar gleich daneben. Gehört der Schalter dorthin?“): „aber ich kann auc h merhrere mein exemplar haben mit verschiedenen konfigurationen“
- Pin r2-d2-s1 on span.gl "Außen": „Lass uns den bereich + rechts den dreier bereich von der einordnung bis änderungen andockbar machen an die hover eliste unten, so integriert es sich schon!“
- Pin r2-d2-s8 on span.bz-sel "von 4.10.1-LIVE ▾": „ja aber bitte nicht so -live sondern ein ordnetnliches label und bitte beides in einer zeile und Aktuellena uch irgendwie markieren“
- Pin r2-d2-s8 on div.bz-sh "Patch-Vergleich": „wir sollten hier eine utnerkategorie machen  meine änderungen (besser ausgedrückt) vs patch verglech wobei standardmäßig meine änderungen ausgewählt ist außer, wenn ich mir die standard werk version anschaue, dann patch vergleich !“
- Pin r2-d2-s8 on a.bz-chip "Gladius Pirate": „Dieser Varianten, können wir die nicht eher links unter der Gladius schreiben wenn sie existieren!? und dort eher zur auswahl ala variante Standard vs die anderen!“
- Pin r2-d2-s8 on div.bz-filt "WaffenRaketenKomponentenSonstigesAlle Te": „Das eher links unten hin über das neue filmstreifen pnael“
- Pin r2-d2-s5 on div.bz-akte "Akte · Aegis GladiusBei der Gladius hand": „sher gut, hier gern im bakcground das rsi bild und irgendwie das hier einklappbar / auzsblendbar wenn mna nur das bild anshen will... pj“
- Pin r2-d2-s5 on h4 "Akte · Aegis Gladius": „akte brauchen wir hier nicht nochmal erwähnen“
- Pin r2-d2-s6 on div.bz-surface "LackierungStandardWerk · gezeigtFrostbit": „Können wir die lakierungen nicht uach in die akte bringen ?!“

### Round 3 (favourite: —)
- Annotation r3-d1-s1-a3 („Die Modelle stehen nur dann unter dem Namen, wenn es welche gibt. Passt „Standard“ als Name für die Grundversion?“): „das finde ich gut“
- Annotation r3-d1-s4-a1 („Der Text liegt als Karte links oben auf dem RSI-Bild. Gibt es für ein Schiff kein offizielles Bild, bleibt der Hologramm-Look wie bisher. Passt die Karte so?“): „ja das ist super“
- Annotation r3-d1-s4-a2 („Die Lackierungen sitzen in der Akte über dem Filmstreifen; ein Klick tauscht das Bild. Fehlt für eine Lackierung ein RSI-Bild, zeigt die Akte das Hologramm in ihren Farben. In Ordnung?“): „eigentlich schon und andereseits nicht, wie mit den koponennten typen filtern najaa....“
- Annotation r3-d1-s6-a2 („Ein Teil, das vom Werk abweicht, trägt einen Punkt am Etikett und einen hellen Pin am Rumpf. Deutlich genug?“): „´Das ist eine gute idee, dafür brauchen wir aber generell einen visuelelen code, auch rechts in bauteile oder unten in den einzlekomponenten das sollte immer gleich aussehen wenn es abweicht !“
- Annotation r3-d1-s6-a3 („Abzeichen und Ausstattung stehen jetzt oben rechts beim Namen, weil unten rechts die Tabs andocken. Passt der Platz?“): „Finde ich super“
- Annotation r3-d1-s7-a1 („„Deine Anpassungen“ ist vorgewählt, solange ein Exemplar gezeigt wird, und listet, was du gegenüber dem Werk getauscht hast. Trifft der Name, oder lieber „Dein Umbau“?“): „passt“
- Annotation r3-d1-s8-a1 („Von und bis in einer Zeile, der Kanal als kleines Etikett, der Live-Patch mit Punkt und „aktuell“. Liest sich das auf einen Blick?“): „shehr gut! wobei zweiteres immer das neuere sein muss, entsprechend die auswhal ddynmaisch steurn was man dor tauswählne kann“
- Pin r3-d1-s2 on span "Einfach": „Ich finde gut, dass es integriert, aber irgendwie links breiter als rechts hmmm“
- Pin r3-d1-s1 on button.bz-tab "Bauteile": „sehr schön integriert, aber irgendwie auch doof, das s man die einordnung nicht direkt sieht usw... hmmmmm“
- Pin r3-d1-s4 on div.b3-stage "◧ Nur BildBei der Gladius handelt es sic": „hier natürlich dann das cig farbige bild was wir ja auch schon von den schiffen haben“
- Pin r3-d1-s4 on button.b3-hide "◧ Nur Bild": „der umschalter sollte an der gleichen stelle eingeklappt und ausgeklappt sein!“
- Pin r3-d1-s4 on div.bz-row2 "Bei RSI ansehen ↗": „Das panel sollte immer gleich groß sein, dazu schauen was maximal textlä#ngen sind“
- Pin r3-d1-s6 on span.bz-val "◆ Leichter Jäger": „Was wäre wenn wir den einsatz auf mitte oben verschieben, dann haben wir unten im panel für jedes subthema mehr platz und es sieht ordentlicher aus!“
- Pin r3-d1-s6 on button.bz-tab "Einordnung": „Oder die drei tehemen eher ähnlich wi edas textfeld in der aktehmmmm. Dann hätte man ein festes element was man immer anschaut...“
- Pin r3-d1-s6 on button.bz-chip.off "Alle Teile": „vllt. die filter auch irgendwi ein die ziele für die ansichten, dabei die gesammte ziele ausgenutzt! horizontal“
- Pin r3-d1-s6 on b "2× im Hangar": „Das 2x im hangar und das rechts danebnen sollten wir button technisch mergen, gern das hangar symbol weiterhin davo r“

### Round 4 (favourite: d1)
- General: „Jetzt mach nochmal ein detailgetreues, info getreueus komplett website exakt wie es später aussehen würde, dafür implementier es, ship es aber noch nicht, lade dir von vc web die daten zu einem schiff, z. B. Gladius und dann mach ein devops cocnept exakt hochauflösend und exakt korrekte information detailgetreu daraus was ich reveiwewn kann“
- Pin r4-d1-s7 on button.bz-pill "↺ Zurück auf Werk": „sehr gut auch mit dem zurück auf werk!“
- Pin r4-d1-s5 on button.add "＋ Noch eine Gladius in den Hangar": „gern dieses exemplar kopieren auch und das neue exemplar aus werk nur anzeigen wenn ich gerade nicht die aus werk angeklickt habe!“
- Pin r4-d1-s5 on button.add "＋ Noch eine Gladius in den Hangar": „Hangar vs wunschliste hier drin!?“
- Pin r4-d1-s5 on small "Werksausstattung · 4.10.2": „patch macht gar keinen sinn, ist immer der akutelle hier“
- Pin r4-d1-s5 on small "1 Teil weicht vom Werk ab": „Gern eine KI zussammenfassung mit zeichenlimit welches die version repräsentiert, aktualisiert nur bei wechsel oder schließen der seite und wenn komponenten überhaupt sich änderten, weil wir ja nicht bei jeder komponenten änderung das neugenerieren wollen!“
- Pin r4-d1-s5 on b "Gladius · PvP": „Name wird und muss vom SPieler festgelegt werden gern mit KI empfefhlung bei erstellung basierend auf den änderugnefalls es wwelche schon gabe, fallls nicht dann ohne empfehlung. 
Achtung, man kann in der werks seite komponenten ändern ohne das man es abspeichert als neue austattung! für fwunschliste oder hangar - das wird zwar angeboten, muss man aber nicht, weil man ja ggf. nur etwas rumklicken will ohne verbindliche wunschlisten oder hangar übernahem !“
- Pin r4-d1-s5 on button "▴": „diesen pfeil finde ich auch ddoof, der sollte anders eingebaut werden ggf als balken darunter ohne die breite die den 4 themen zur verfügugn ssthet zu ebeinflussen“
- Pin r4-d1-s5 on div.b3-wing.b4-row "AkteAußen3DEinfachObenSeiteFrontInnenCoc": „akte, außen, innnen, kompnenten, irgendwie ist nicht klar, was sist ein sozusagen toggle menüansicht, was sind sozusagen filter (die kompontenent) wie hängt as hierarhcisch  zusammen Akte > Ansichten > Komponenten filter“
- Pin r4-d1-s4 on div.b4-main "▤ Text zeigenLackierungStandardFrostbite": „Finde spannend ddas der ganze hitnergrund eine farbe hat, aber forsche nochmal nach cigs bilder sind wirklich einfach bilder!“
- Pin r4-d1-s4 on div.b4-einb "Rang 9 von 26 Leichten Jägern · im Mitte": „achtung hier nix weglassen was es schon gab! wie die balken z. B. Das gern aber auch als umscvhaltbarern  toggle vom hexagon wo man zwischen hexagon und balken umschalten knann.
Außerdem fehlt mir die vergleichsauswahl..“
- Pin r4-d1-s4 on div.b4-einb "Rang 9 von 26 Leichten Jägern · im Mitte": „Rang finde ich ja viel besser als die gesamtprozentzahl mega“
