# Implement brief — Kamera-Welt (camera world transitions)

Concept: `docs/concepts/20261109-1752-kamera-welt.html` · source `docs/concepts/20261109-1752-kamera-welt/`
Decisions log: `docs/concepts/20261109-1752-kamera-welt-decisions.json`
Submitted round: 5 (`action: implement`, 2026-11-09). Rounds 1–5 are baked in `rounds/01–05.html`.

**Binding spec:** the mock markup, CSS and keyframes in `rounds/04.html` (design `welt4`) and
`rounds/05.html` (design `welt5`), later rounds overriding earlier ones. Line-level parity list:
`parity.md` next to this file. Never paraphrase the mocks; read the keyframes.

Reality check (2026-11-09): main moved by 3 commits. Relevant: `1b104df4 feat(shell): Quantum-Sprung
boot splash and a real 404 page (#1067)` adds a first-paint splash in `index.html` and a
slow-navigation card. The cinematic entrance starts **after** the splash hands over; the two must
not overlap or double-animate. No forced round.

## The user's words, verbatim (by round)

### Round 1
- general: „das concept ist mir viel zu wenig detailgetreu, nmimm wirklich die aktuelle live variante en ddetail und btw hq soll voll auf dem planetetn statfinden und schaue dir nochmal viel gnauer aktuelle backgrounds an, animationen naja, aber wo man wann wie ist am ende“
- Favourite design: `schwenk` (camera pan).

### Round 2
- general: „Lass uns mit den korrekturen, dann zusätzlich in nähcster rudne auf jeder seite und subseite klären wie elemente eingeblendet werden in welcher reihenfolge mit welchen effekten - dabei mehrer playbooks erstellen wie animationen stattfinden sollten je nach sieten typ (hauptseiten vs scrolled seiten vs detailseiten vs unwesentliche seiten, z. B. was hinter profil liegt). Außerdme animationen für einblendungen von popup (den kleinen wei wunschliste, aber auch den großejn wie bauteil wechseln!) Lass uns außerdem refinen wenn jeman ddie seite ohne subseite /verse zum beispiel aufruft, dann soll es cinemastisch bombastisch, gern bis zu >6s dauern bis alle elemente erscheinen. Bei den subseiten (damit meine ich irgendien suffix,, wie verse, auch wenn es dort am ende immer hinelitet und das ggf. als leseziechen abgesppecihertt wird) nicht bei der hauptseite immer.“
- HQ annotation: „am besten eher links oder rechts z. B. hier“
- Admin annotation: „Achso verstehe, ne, dann eher statt raumstation eine station auf der  Erde am rand links oder so und weiterhin zu hq“
- Codex annotation: „das passt, so hat codex index einen gleichmäß0igen hintergrund und codex selber interessanten hintergrund mit den leichten galaaxien collorierungen“
- Verse: „das mit dem schlenker finde ich merkwürdig“
- News: „Bei diesen planeten sollte so gezoomed werden, dass der planet am nede exakt den planeten abbildet der im header von der seite ist! Oder der planet ragt links am seitenrand groß rein und wir nehmen den planeten in dieser detailaanischt von fvese news heraus“
- Sternkarte: „sternkarte muss zur sternenkarte transformieren, ansonsten super, gerade auch mit dem planeten links unten sehr gut, gern feinjustieren aber gut“
- Pin Admin: „admin ist ok mit der raumschiffbasis ok! Aber HQ ist wichtiger visuell“
- Pin HQ: „HQ Sollte noch viel weiter ranzoomen, damit nur angedeutet lichtetrr / eine stadt zu sehen ist im background, weil dort viele elemtne sind und wir wollen den hintergrund nicht mit soooo vielenm lichtern, auch nicht wenigen,m aber heer ruhig“
- Decisions (rounds 1–2, unchanged): background in flight = **„Szene aus dem Bild nehmen, Kamera fährt live“** (the scene gets its own view-transition name without animation, only the contents fly, the camera really moves); set pieces = **„An festen Orten in der einen Szene“**; subpages = **„Kleiner Push-in zum geklickten Element“** (back pulls out, the veil is carried, not set); first call = **„Kamera fährt aus der Ferne an, dann die Inhalte“**; flight duration **1100 ms**; scope = **„Weiter nur in der Shell-Beta“**; reduced motion = crossfade instead of a flight (420 ms), also for subpages and arrival; click in flight = retarget from the current pose, nothing waits for a flight to end; glass blur = **„Nur Kopfzeile, Menüs und Dialoge“** (cards and lists get a fixed dark tone); stage → lower part = **„Mit nativem Einrasten (CSS scroll-snap)“** instead of `page-glide.ts` / `briefing-dock.ts`; camera on scroll = **„Ja, leicht mitneigen“** (stars move a bit slower than the page, on the compositor); scroll listeners = **„Ja, so umbauen“** (17 components → one shared per-frame tick); budget = **„Kein Bild über 33 ms bei Fahrt und Scrollen“, measured on a real GPU at 60 Hz and 144 Hz, before and after in the report**.

### Round 3
- general: „irgendwas ist hier falsch, ich sehe zwei backgroudn riesen planeten!“
- When: **„Bei jedem Direktaufruf, einmal pro Tab“** + „genau, aber das ziel muss in dem tab versecompanion-alpha.vercel.app sein ohne /verse oder so, nur dann der cinmeatische große auftritt“
- Length: „das darf ruhig auch länger dauern, keine minuten, aber das was laut online recherhce deine agents denken was ein cinematischer fast schon ttrailer artigver effekt dauert !“ (superseded in r4/r5, see below)
- Skip: any input ends the entrance (ok). Small popup: grows from its trigger. Large popup: holo projection + „da kreativer werden !“. Popups close: **reverse in 60 % of the time**. Subpage planet: **B, big at the left edge, the emblem in the page header is dropped**. HQ side: **right** + „hq eher rechts, gleich wie im menüauswhal platziert ;) Dabei aber auf dem planeten backgorudn groß rechte hälfte (mus snicht genau die hälfte sein, aber kamera seitig versetzt eher nach rechts). Achte aber darauf wo du das hq bei den vielen elmenten platzierst !“ Starmap forms from the constellation (ok). Stagger: „siehe meine notizen, check das, das will ich nicht exakt bestimmen“. Sections appear once (ok). Minor pages: „siehe meine anderen notizen“.
- HQ station annotation: „passt!“
- Verse: „den schwenk bei verse finde ich nicht so pralle...“
- News B: „warum zwei bewegungen zum planeten, finde das mit den zwei andere richtugne nbewgungen irgendwie immer doof... (das finde ich generell doof mit den richtungswechseln!) Gern bestimmte kamera tricks und co, dezente führungen aber nicht dieses ich fahre komplett wo anders hin und dkehrer danmn zu einer anderen richtung um (außer wenn man natürlich währendndesssen einen andnerne menüpunkt odder so geklickt hatt usw.) aber das mit dem großen planeten finde ich shcon besser, wobei man dann auf dem gleichen bild nicht dieandere planeten sehen sollte - weder background planet noch andere planeten von galerie und patches und co:!“
- Codex / HQ / HQ · Lager: „mega!“ / „mega“ / „mega“
- Admin: „hier sollte auch nur die raumstation, gern in groß im background sein! kein anderer planet sichtbar!“
- Pin map HQ · Lager: „wir haben ja noch weitere hq unterseiten, aber die gern dann einfach darunter, passt“
- Pin entrance: „ich finde erst muss der hero titel erscheinen, richtig in szene gesetzt schön animativ, dann darunter die suchleiste. So ist klar was man macht, dann die ganzen unwichitggen elemnete inkl. patches. Und mit versatz fängt der erste planet an seine news unten zu projezieren! Aueßrdem bitte die namen der planetchen weg lassen und nur bei ohover over anzeigen, wie bei der sonne und co auch!“
- Pins menu switch: „das finde ich ok“ (camera pan 1.1 s, header stays) · „Das sollte so sein, wie beim erstbesucht, alsod die hero oben von patches, titel und suche“ · „der rest kommt mir zuuu prompt und zu einfallslos danach“
- Pins scroll page: „Ne, die kopfzeile sollte transofmreiren! Und erst mit abstand danach das darunter kommen!“ · „die kommen zu schnell direkt auf... die mit kurztdelay dann aufploppen lassen nacheinander schnell wie jetzt, aber schöner bitte!“ · „Erst kopf transfomriert sich, dann kommt seitenleiste  und rolle usw rein und dann erst die big list !“
- Pin detail: „Ja das ganze andocken finde ich gut! aber noch nciht gut genug polished von der animation her“
- Pins minor page: „gern leicht spektakullärere arber dacord, das kommt recht ratz fat rein“ · „bitte die menüleiste hier so transofmrieren wie bei hq wo sie am bildschirmrand hängt, bitte genauso und auch mit icons usw... das ist der neue style“
- Pins small popup: „viel zu boring viel zu unintegrativ viel zu wenig spacig“ · „das gilt auch als popup auch wenn automatische s“
- Pin large popup: „Gute idee, gern noch etwas spaciger davor und dann dieser aufbau erst alles und die liste dann ziele für zeile schnell wie bei codex index“

### Round 4
- Length: „das will ich nicht bestimmen! DDa gibt es keine vorgabe von rmir!“ → Claude decides (r5): page stands at 5.5 s, search usable from 3.5 s, projector is not part of the entrance.
- Straight camera paths: ok. Planet names on phones: **first tap shows the name, second opens**. HQ rail: **on all pages with a section menu**. Automatic notices open like small popups: ok.
- Sternkarte: „hier sollte dann auch nur die sternenkarte sein, der background planet ok, leicht sichtbar, aber nicht rechts der galieri planet sichtbar 1“
- Large popup: „animativ sind die popups schon besser aber ich mag das design nicht mit den komischen ecken drum...  das ist nicht spacig.... eher nur zukunftsmäßig...“
- Pin entrance/projector: „Das zünden von news planet des projektor und panel darf ruhig mit deutlichen versatz geschehnen, eher sptäer nach 5s weiteren und dann 5s stehen lassen und dann 5 sekunden ohne projektion und panel und dann das nächste vom anderen planeten ussw. Das gilt aber generell egal wann ich woher komme“
- Pin scroll: „der header mit icon namen  und die suche und die profilicons usw. sollten sich transformieren in diesen subheader, viel besser bitte! schau dir das intensiv  an wie das aktuell gehscieht !“
- Pin minor: „Bitte den titel auch auf die richitsige seitenbreite justierne“

### Round 5 (implement)
- general: „bitte mobile auch voll testen und animieren, damit es gut anghezeigt wird“
- Large popup: **A Horizont** + „die nehmen wir! Bitte aber nochz stark polsihen!“
- Projection order: **„Das Neueste zuerst“** (the planet with the newest content starts; order changes day to day).
- Header on phones: **„Nach unten in die Daumenleiste“** (search flies down, logo and route stay on top).
- Header mapping: **ok** + „ja, aber gern imm baluf noch etwas polishen“
- Pin projector cycle: „während der püause wird das ganze pnale mit den bestehenden animationen weg projeziert“

## Checklist (one line per accepted item)

Scene and camera
- [ ] C1 One continuous scene; Verse, Codex, HQ, Admin are fixed places in it; transitions are camera pans/zooms only, never a background swap or fade (r1–r2, rounds/04+05 world).
- [ ] C2 View Transitions no longer snapshot the scene: own view-transition-name without animation, camera moves live (r2 snapshot).
- [ ] C3 Straight paths: zoom log-interpolated about the fixed point of both poses (`poseAt` in the mocks), no direction change; a click mid-flight retargets from the current pose (r2, r4).
- [ ] C4 Main ↔ main 1100 ms; subpage = push-in towards the clicked element, back pulls out, veil carried (r2).
- [ ] C5 Subpage isolation: News/Patches/Galerie = that planet big at the left edge, page-header emblem removed, every other planet incl. the big one hidden; Admin = only the station, big; Sternkarte = constellation morphs into the star map, big planet faint (~0.3), Galerie planet hidden (r3, r4).
- [ ] C6 HQ on the planet surface, right side, zoomed in so only a calm hint of city lights shows; ground station on the right limb in the Verse view between Galerie planet and notice; further HQ subpages continue below HQ · Lager (r1, r3, r4).
- [ ] C7 Codex and Codex index backgrounds unchanged (r2).
- [ ] C8 Reduced motion: 420 ms crossfade instead of every flight, push-in and arrival (r2).
- [ ] C9 Everything stays behind the shell beta (r2 scope).

Entrance and main pages
- [ ] E1 Cinematic entrance only on a direct call of the bare domain (`/`, no path), once per tab; same-tab reload = short build ≤ 0.8 s; any input skips with ≤ 300 ms crossfade and typed keys land in the search (r3, research). Starts after the #1067 boot splash.
- [ ] E2 Order and beats (rounds/05 `d5-pb-main`): stars ignite → camera dolly from depth (0.8 s, 2.7 s) → title light-edge scan + afterglow (2.2 s) → search grows out of the title, usable (3.5 s) → header, "Patches", rest (4.3 s) → "Mehr im Verse" breathes once (5.0 s) → page stands 5.5 s.
- [ ] E3 Planet names only on hover/focus via `[scTooltip]` like the sun; phones: first tap shows the name, second opens (r3, r4).
- [ ] E4 Menu switch (rounds/05 `d5-pb-nav`): camera pan 1.1 s with header standing; title scan 0.75 s, search 1.05 s, Patches/notices 1.3 s, planets send impulses one after another 1.55 s — built like the first visit, not "prompt und einfallslos".
- [ ] E5 Projector cycle (rounds/05 `d5-pb-cycle`): 5 s after the page stands the first planet ignites (beam + panel), panel stands 5 s, then 5 s without projection and panel, then the next planet, endlessly; regardless of where the user came from; order = newest content first; in the pause the panel is projected away with the existing projection animations reversed; pauses on hover/focus of the panel, stops when the tab is hidden or reduced motion is on.

Scroll pages
- [ ] S1 Header morph (rounds/05 `d5-pb-scroll` morph list): each element flies on one straight line from the big header to its place in the subheader — search up into the bar, logo + two-line name → one line, active area (VERSE/CODEX/HQ) → crumb, account icons slide inwards, hit count fades in, capsule light trace, settle; scroll up plays it backwards; polish further (r4, r5).
- [ ] S2 No empty slab / blank frame during the dock jump (live capture `v5` glide-02); the search never shrinks first and widens later; account icons never vanish.
- [ ] S3 Phones ≤ 720 px: the search flies down into the bottom thumb bar; logo and route stay on top (r5).
- [ ] S4 Order after the header: gap, then section head + sidebar + role filters, then the list; rows pop one by one (~70 ms apart) after a short delay with a light edge (r3, r4).
- [ ] S5 Camera tilts slightly with scroll (stars slower than the page), compositor only (r2).
- [ ] S6 Native CSS scroll-snap replaces the glide scripts (`page-glide.ts`, `briefing-dock.ts`) with the same behaviour (r2).

Detail pages
- [ ] D1 Detail (rounds/04 `d4-pb-detail`): push-in 0.7 s, header stays, title scan, ship materialises as a hologram (flicker), side panel docks with overshoot + light edge, stat bar columns ignite left to right; more polish than the mock (r3 pin).

Minor pages
- [ ] M1 HQ-style icon rail at the screen edge (model: `src/app/hq/hq-rail.component.ts`) on **all** pages with a section menu (settings, profile, patch file, …) (r3, r4).
- [ ] M2 Title and cards share the left edge of the page frame (r4 pin; rounds/05 `d5-pb-minor`).
- [ ] M3 Minor page entrance, slightly spectacular: scene dims, rail icons glide in one by one, title scan, cards rise staggered with a light edge (~1.5 s) (r3, r4).

Popups
- [ ] P1 Small popups (wishlist, apps menu, profile menu) and automatic notices/toasts (rounds/05 `d5-pb-pop-s`): impulse from the trigger, light beam to panel width, panel unfolds from the beam, top edge catches horizon light (no corner brackets), entries flicker in; close = reverse in 60 % of the time (r3, r4, r5).
- [ ] P2 Large popups (swap part, compare, part sheet) = **A Horizont** (rounds/05 `d5-pb-pop-la`): push + dim, drifting stars, a planet horizon rises at the bottom, the plate rises behind it with a light-catching top edge, head + filters, table rows line by line as fast as the Codex index, footnotes last, horizon sinks back; no corner brackets, no scan line; "stark polishen"; close = reverse in 60 % of the time (r4, r5).

Performance and quality
- [ ] Q1 `backdrop-filter` only in header, menus and dialogs; cards and lists get a fixed dark tone that looks the same (r2).
- [ ] Q2 The scroll listeners share one rAF tick per frame, behaviour unchanged (r2).
- [ ] Q3 No frame over 33 ms during flights and scrolling, measured on a real GPU at 60 Hz and 144 Hz, before and after in the report (r2); visual jank while scrolling removed (initial request).
- [ ] Q4 Phones fully tested and animated so everything shows well (r5 general).
- [ ] Q5 Living spec / `docs/concepts/verse-aufbau-ui-spec.md` updated to the new entrance timing; every user-facing string via ngx-translate; repo rules (`scAction`, anchors, no native dialogs, `--sc-float-bottom`) kept.
