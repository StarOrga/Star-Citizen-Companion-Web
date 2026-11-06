# Performance-Plan — flüssiger Start auf PC und Handy

Stand: 2026-11-04 · Branch `claude/funny-keller-7pm4ty` · Auftrag des Owners:

> Die Seite soll beim Öffnen auf PC und Handy ohne Ruckler laufen (die Lags gab
> es auch auf einem PC mit 250-Mbit-Leitung). **Qualität und Funktionen bleiben
> exakt gleich** — es ändert sich nur, *wann* etwas geladen oder berechnet wird.
> Regelmäßig committen und pushen, damit eine andere Sitzung / ein anderes
> Modell jederzeit hier weitermachen kann.

Dieses Dokument ist die Übergabe: was gemessen wurde, was erledigt ist, was
offen ist — jeweils mit genug Detail, um ohne erneute Analyse weiterzumachen.
Nach jedem erledigten Punkt hier abhaken und mit committen.

---

## 1. Messaufbau (zum Nachmessen)

Die Live-Seite und Supabase sind aus Cloud-Sitzungen nicht erreichbar
(Netzwerk-Policy). Gemessen wird deshalb der Produktions-Build lokal, mit einer
gefälschten, freigeschalteten Sitzung und Fixture-Antworten für jedes Backend:

```bash
npx ng build --source-map --output-path=/tmp/perf-build
```

```bash
NODE_PATH=$(npm root -g) node scripts/perf/profile-startup.cjs /tmp/perf-build/browser /verse --beta --profile
```

- Flags: `--beta` (Verse-/Shell-Beta an, dort lebt der Planet), `--de`
  (deutsche Locale), `--secs=N`, `--profile` (CPU-Profil, über Source Maps auf
  `src/`-Dateien und Funktionen aufgelöst), `--reqs` (Request-Liste), `--warm`.
- Gibt aus: FCP, LCP, Long Tasks (Zeitpunkt:Dauer), laufende CSS-Animationen
  (Eigenschaft, Element, sichtbar/offscreen), i18n-Requests, Top-Funktionen.
- WebGL läuft dort auf SwiftShader (Software): GPU-lastige Zahlen sind zu
  pessimistisch, Haupt-Thread-/JS-Zahlen sind belastbar.

## 2. Ausgangsmessung (vor den Änderungen)

| Befund | Messung | Ursache |
|---|---|---|
| `/hq` friert ein | Long Task **1,2 s** | `codex-board-figure`: `hasWebgl()` erzeugte einen Wegwerf-WebGL-Kontext (0,95 s), danach three.js einen zweiten (0,5 s) |
| Planet kommt spät / „falsche Reihenfolge“ | nach 10–14 s noch nicht fertig | Welt + Texturen wurden bei jedem Besuch im Browser berechnet (~1,1 s CPU auf schnellem PC, Handy 3–5 s); Intro wartet max. 3 s, danach liefen die Reste in 10-ms-Idle-Häppchen (≈5 % Haupt-Thread) |
| News-Vorschaubilder ziehen dauerhaft CPU/GPU | Canvas-Loop pro Bild, endlos | `scNeuroField`-Skeleton wurde nach dem Laden nur auf `opacity: 0` gesetzt — IntersectionObserver meldet weiter „sichtbar“, Loop lief weiter, darüber eine `backdrop-filter`-Pille |
| ~100-ms-Ruckler nach dem Rendern der News-Liste | 9–15 Long Tasks | 80 Skeletons lasen je `getComputedStyle`/`getBoundingClientRect` zwischen den Canvas-Writes der vorigen → Kette erzwungener Layouts |
| Deutsche Nutzer laden beide Sprachdateien | `en.json` + `de.json` (2 × ~250 kB) beim Start | `fallbackLang: 'en'` in `provideTranslateService` lädt Englisch sofort; Parität beider Dateien ist per Spec garantiert |
| News-Edge-Function langsam | jeder Aufruf crawlt 5 Quellen + Bild-Dekodierung + DB-Writes | kein Server-Cache |

Weitere Haupt-Thread-Kosten aus den Profilen (noch offen, siehe §4):
`shell.component.ts › publishTopbarHeight` (20–40 ms), `fusion-bar.component.ts ›
measureTrail/placeStage/publishHeight` (~95 ms auf `/verse` mit Beta),
`stage-hero.directive.ts › align`, `verse-briefing.component.ts › lines` (32 ms),
`locale-resolution.ts › readBrowserLocaleSignals` (10–19 ms beim Boot),
`news-thumb.component.ts › detectFramePads` (Pixel-Analyse je Bild auf dem Haupt-Thread).

## 3. Erledigt

| Commit | Änderung |
|---|---|
| `03acc56` | **News-Edge-Function**: Feed pro Isolate 2 min memoisiert, Bild-/DB-Nacharbeit nur einmal pro Build (`supabase/functions/fetch-verse-news/feed-memo.ts` + Test). Wird erst live mit `functions:deploy` nach dem Merge. |
| `ff008ee` | **Skeleton-Animation** (`core/neuro-field.directive.ts`): neuer Input `neuroActive` — stoppt 600 ms nach dem Ausblenden (news-thumb bindet `!loaded()`); ein gemeinsamer Intersection-/ResizeObserver für alle Felder, Lesen und Schreiben getrennt (keine Layout-Kette mehr). |
| `538f752` | **Codex-Board-Figur**: kein Probe-Kontext mehr; Vorab-Check = API vorhanden + seitenweites Flag nach gescheitertem Renderer. |
| ~~`0ca4f45`~~ | i18n-Fallback verzögert — **zurückgenommen** (`0919013`), weil `main` (#907) dasselbe besser löst. |
| `64e5267` | **Planet-Loop** pausiert, solange der Planet aus dem Bild gescrollt ist. |
| `1d4e1e9` | **News-Vorschaubilder**: Rahmen-Messung pro URL einmal pro Sitzung, ein wiederverwendetes Mess-Canvas. |
| `e16efcb` | **Planet gebacken**: `scripts/bake-planet.mjs` → `public/planet/` (verlustfreies WebP, pixelgenau verifiziert; `world.json` bitgenau, Spec `planet-assets.spec.ts`). Komponente lädt die Dateien parallel, dekodiert per `createImageBitmap` abseits des Haupt-Threads; Berechnung im Browser nur noch als Rückfall (mit fairer Idle-Planung). Prebuild prüft per Quell-Hash, ob neu gebacken werden muss (`npm run gen:planet`). Service Worker cacht `/planet/**`. |

### Nachmessung (gleicher Aufbau, 2026-11-03)

| Seite | vorher | nachher |
|---|---|---|
| `/verse` (Beta) — Planet fertig (`sc-verse-planet-ready`) | nach 14 s noch nicht | **0,95 s** |
| `/verse` (Beta) — längste Blockade | 0,27 s + endlose Generierung | 0,43 s (Textur-Upload auf SwiftShader; echte GPU: Bruchteil) |
| `/verse` — Long Tasks | 9–15 Stück, 0,95–1,4 s gesamt | **2 Stück, 0,14 s** |
| `/hq` — längste Blockade | **1,07–1,22 s** | **0,10 s** |

Weitere Commits: `6e21c8f` (Anisotropie-Limit einmal vor den Uploads lesen —
`getParameter` ist ein synchroner GPU-Roundtrip; Uploads einzeln per Frame zu
verteilen war **schlechter**: 5,8-s-Blockade, nicht wieder versuchen),
`0eaf5b3` (`set_ui_pref` nur bei echter Änderung), `e91249b` (SW-Timeout 4 s),
`a28e2f0` (`rsi-upcoming-ships` memoisiert).

### Endstand (Produktions-Build, 2026-11-04 ~00:25 MEZ)

| Seite | Ergebnis |
|---|---|
| `/verse` (Beta) | Planet fertig nach **0,89 s**; 3 Long Tasks (max. 0,42 s = Textur-Upload auf SwiftShader) |
| `/verse` | 2 Long Tasks, **0,12 s** gesamt |
| `/verse` (deutsch) | `de.json` nach 31 ms, `en.json` erst nach 4,1 s (#907) |
| `/hq` | max. 0,6 s = ein WebGL-Kontext der 3D-Figur auf SwiftShader (echte GPU ~50–150 ms), vorher 1,1–1,2 s mit zweitem Probe-Kontext |
| `/codex` | 2 Long Tasks, max. 0,1 s; Leerlauf weggescrollt 0 ms statt 236 ms / 5 s |

Checks auf diesem Stand: Typecheck ✔, Lint 0 Fehler ✔, Karma **5331/5331** ✔,
`test:gate` 89/89 ✔, `test:functions` 340/340 ✔, `npm run build` inkl. aller
Prebuild-Guards ✔, `gate:mobile:quick` grün ✔.

**Deploy-Hinweis:** Die zwei Edge-Function-Änderungen (`fetch-verse-news`,
`rsi-upcoming-ships`) wirken erst nach `npm run functions:deploy` bzw. dem
Deploy-Workflow nach dem Merge.

Noch nicht untersucht: LCP liegt in der Lab-Messung auf `/verse` und `/codex`
bei ~3 s (vor wie nach den Änderungen) — mit echten `web_vitals`-Daten aus
PostHog prüfen, ob das echte Nutzer betrifft, bevor man es angeht.

## 4. Offen — in dieser Reihenfolge

Jeder Punkt: umsetzen → `npm run typecheck` → betroffene Specs
(`node scripts/run-karma.mjs --include='src/app/<bereich>/**/*.spec.ts'`) →
committen → pushen → hier abhaken.

1. **`main` regelmäßig mergen** (`git fetch origin main && git merge origin/main`).
   Zuletzt gemergt: #907 (2026-11-03, 23:40) — der löst das i18n-Doppel-Laden
   mit `public/i18n-boot.js` + `AppTranslateLoader`; der eigene Ansatz dieses
   Branches wurde dafür zurückgenommen.

2. ~~**Planet-Loop entlasten**~~ — erledigt: Loop pausiert per
   IntersectionObserver, wenn der Planet aus dem Bild gescrollt ist.
   `geometry()` (2 × `getBoundingClientRect` pro Frame) bleibt bewusst: das
   Intro bewegt den Anker per CSS, ein Cache würde den Planeten versetzen.
   Zeichnen ist bereits gedrosselt (Planet ≤ 15 fps, Züge ≤ 30 fps).

3. ~~**Dauer-Animationen**~~ — erledigt für die Codex-Holotable:
   `shared/pause-offscreen.directive.ts` setzt `data-sc-offscreen`, solange der
   Host ganz aus dem Bild ist; die Holotable hält dann nur ihre Endlos-Schleifen
   an (nie etwas in einem `.leaving`-Teil — `[animate.leave]` wartet darauf).
   Leerlauf weggescrollt: 236 ms → 0 ms pro 5 s. Sterne/Stadtlichter der
   Shell-Szene sind immer sichtbar und reine Opacity (Compositor) — bleiben.
   Ursprüngliche Notiz („RUNNING ANIMATIONS“ des Profilers):
   - `/codex`: `rays` (opacity), `motes` (**background-position**, nicht
     composited), `band` — laufen endlos, auch auf einem 480×0-Element.
   - `/verse` Beta: `fs-demo-1/2/3` (**clip-path**, endlos, Such-Platzhalter),
     `sc-scene-twinkle`/`sc-scene-city` (Vollbild-opacity), Sonnen-Beacons
     (`breathe`, `corona`, `erupt`, `boil`, `flash`).
   - Ziel ohne optische Änderung: endlose Animationen pausieren
     (`animation-play-state: paused`), solange ihr Element nicht im Viewport
     ist oder 0 Fläche hat; nicht-compositete Eigenschaften nur dort ersetzen,
     wo das Bild identisch bleibt.

4. **Erzwungene Layouts im Shell-Code** — Hinweis: `publishTopbarHeight` muss
   synchron bleiben (Versuch, die Erstmessung dem ResizeObserver zu überlassen,
   brach 3 Specs in `shell-nav.spec.ts`, u. a. die Header-Kompression) — nicht
   erneut versuchen. Übrige Kandidaten: `shell.component.ts › publishTopbarHeight`,
   `fusion-bar.component.ts › measureTrail / placeStage / publishHeight`,
   `stage-hero.directive.ts › align`, `verse-briefing.component.ts › lines/measure`.
   Muster: Messen nur in ResizeObserver-/IntersectionObserver-Callbacks oder
   gebündelt in einem rAF (erst alle Reads, dann alle Writes); keine
   Messung in jedem Scroll-Event ohne rAF-Bündelung.

5. ~~**`news-thumb › detectFramePads`**~~ — erledigt: Ergebnis pro Bild-URL
   modulweit gecacht, ein wiederverwendetes Mess-Canvas. Bleibt bewusst
   synchron im `load`-Handler: verschoben würde der Bild-Zoom sichtbar springen.

6. ~~**Gezieltes Vorladen**~~ — erledigt (`core/idle-preloading.strategy.ts`):
   Routen mit `data: { preload: true }` (Verse-Start, Codex-Landing,
   Codex-Detail, HQ + HQ-Landing) laden ≥ 3 s nach dem Start im Leerlauf,
   nacheinander, nur eingeloggt, nie bei Save-Data/2G. Offen als Ergänzung:
   Vorladen bei Hover/Touch eines Links (braucht URL→Route-Zuordnung).
   Ursprüngliche Notiz:
   eigene `PreloadingStrategy` — nach dem ersten Paint im Leerlauf die
   Nachbarbereiche der Einstiegsseite (Verse → Codex-Landing, HQ; Codex →
   Codex-Detail, Verse), bei Hover/Touch eines Links dessen Route; Admin-Routen
   nur für Admins; nichts bei `navigator.connection.saveData` oder 2G.
   Route-`data: { preload: … }` als Markierung.

7. **Service Worker** (`ngsw-config.json`): heute lädt `app` mit `"/*.js"` +
   `prefetch` **alle** 184 Chunks (~1,7 MB gz) beim ersten Besuch (registriert
   30 s nach Start) und nach jedem Deploy die geänderten (~1 MB, Hash-Kaskade).
   Vorschlag: `app` nur `index.html`, `*.css`, `main-*.js`, `polyfills-*.js`;
   eigene Gruppe `chunks` (`/chunk-*.js`, `installMode: lazy`, `updateMode:
   prefetch`). Risiko: Chunk eines alten Builds nach Deploy nicht im Cache →
   `RouteLoadRecoveryService` lädt neu (existiert, prüfen). Erst nach Punkt 6
   umsetzen, damit vorgeladene Chunks im Cache landen.

8. **Backend-Requests beim Start** (je Seitenaufruf ~15):
   - `profiles` wird 4× gelesen (`role.service.ts`, `profile.service.ts`,
     `account-prefs.service.ts`, `app.component.ts` Sprache/Region). Bewusst
     **nicht** zusammengelegt: die vier Primärschlüssel-Reads laufen parallel
     (Wartezeit ≈ einer), und `role.service` trägt die Fail-closed-Logik des
     Freischalt-Guards — ein gemeinsamer Read würde den Auth-Pfad anfassen
     für kaum messbaren Gewinn.
   - ~~`rpc/set_ui_pref` bei jedem Laden~~ — war ein Artefakt der Fixtures
     (Erstkontakt ohne gespeicherten Wert). Trotzdem erledigt:
     `AccountPrefsService.set()` schreibt nicht mehr, wenn das Konto den Wert
     schon hält (die Codex-Landing setzt „News gesehen“ bei jedem Öffnen).
   - ~~`rsi-upcoming-ships` Edge Function~~ — erledigt: Antwort pro Isolate
     30 min memoisiert (gleicher Baustein `fetch-verse-news/feed-memo.ts`).
     Live erst nach `functions:deploy`.
   - ~~SW-`dataGroups` Timeout~~ — erledigt: `verse-news` und
     `rsi-upcoming-ships` warten 4 s statt 10 s aufs Netz, bevor die
     zwischengespeicherte Antwort (max. 15 min bzw. 6 h alt, unverändert) greift.

9. ~~**Unsichtbares später rendern**~~ — geprüft: Bilder sind schon lazy
   (`news-thumb` mit `fetchpriority` fürs Titelbild, `fallback-image` lazy per
   Default); die News-Liste ist auf `/verse` ohne Beta die ganze Seite, kein
   Block unter dem Falz. Die 3D-Figur auf `/hq` steht oben im Bild — ihr
   WebGL-Kontext (SwiftShader 0,6 s, echte GPU ~50–150 ms) gehört zum
   sichtbaren Inhalt. Ursprüngliche Notiz: `@defer (on viewport)` mit Platzhalter in
   fester Höhe für Blöcke unterhalb des Falzes (z. B. `<sc-news-list>` am Ende
   der Verse-Beta-Seite); Bilder unterhalb des Falzes `loading="lazy"` +
   `decoding="async"`, Titelbild `fetchpriority="high"`. Vorher prüfen, dass
   keine `#fragment`-Links in die verzögerten Blöcke zeigen
   (`anchorScrolling: 'enabled'`).

10. **Zoneless — geprüft, bewusst zurückgestellt.** Voraussetzungen erfüllt
    (alle Komponenten `OnPush`, keine `onStable`/`afterEveryRender`/`ngDoCheck`,
    keine dynamisch angehängten Views). Experiment: TestBed global zoneless
    (temporäre Spec-Datei mit `resetTestEnvironment()` +
    `initTestEnvironment([BrowserTestingModule, Modul mit
    provideZonelessChangeDetection()], platformBrowserTesting())`) →
    **153 von 5327 Specs rot**, v. a. `CodexDetailComponent` (26),
    `HangarShipDetailComponent` (9), `HangarDashboardComponent` (9),
    `CodexSwapPickerComponent` (17), `KeybindsComponent` (9); Fehlerbilder:
    Element nach Async-Schritt `null`, `flush failed after reaching the limit`.
    Vor einer Umstellung jeden Fall einordnen (Test-Artefakt vs. echte
    Regression). Gewinn klein: zone.js ≈ 40 ms Haupt-Thread pro Laden,
    11,6 kB gz.

11. ~~**Echte Nutzerdaten**~~ — erledigt (`core/web-vitals.service.ts`):
    Ereignis `web_vitals` (area = erstes Pfadsegment, navigation, ttfb, fcp,
    lcp, cls, inp, long_tasks, long_task_ms, connection), einmal pro Laden beim
    Verlassen/Ausblenden, nur mit Statistik-Einwilligung. Datenschutzerklärung
    nennt jetzt „Ladezeiten“ (Stand November 2026). In PostHog auswerten, um zu
    sehen, wo echte Nutzer hängen — die Lab-Messung sieht keine echten Geräte.

12. **Abschluss**: voller Lauf (`npm run lint`, `npm test`, `npm run test:gate`,
    `npm run test:functions`, `npm run build`), Nachmessung mit dem Profiler,
    Vorher/Nachher-Tabelle hier ergänzen.

---

## 5. Folgeauftrag 2026-11-04 — Kino-Intro auf `/verse` (Beta-Bühne)

Owner-Feedback nach v0.201.0: Beim Neuladen (`Strg+R`) erscheint erst ein
blauer Hintergrund, dann das Sternbild, der Planet blinkt, dann „Patches 4.10“
(die „10“ abgeschnitten), dann die Suche — der Rest ploppt auf, statt sich
aufzubauen; die Suche taucht auf, verschwindet und kommt wieder; alles
verschwindet kurz außer den Admin-Elementen; die Sternschnuppe kommt mitten im
Aufbau.

**Soll-Ablauf** (nur erster Besuch in der Sitzung bzw. Neuladen; Rückkehr
innerhalb der Sitzung = alles sofort da):

1. Zuerst **nur der Sternenhimmel**.
2. In der Mitte, wo sonst der erste Titel steht: **„Star Citizen Companion“**.
3. Danach baut sich alles **nacheinander und weich** auf: Kopfzeile, Suche,
   Beacons/Monde. Kein Element erscheint, verschwindet und kommt wieder.
4. Der große Planet **schiebt sich von unten herein**, sobald er geladen ist —
   kein Blinken.
5. Die **Sternschnuppe** erst ganz am Schluss („alles fertig“).
6. Dann springt der Titel auf die erste Meldung; „Star Citizen Companion“
   kommt in der Rotation **nicht** mehr vor.
7. Admin-Elemente (Admin-Konsole unten rechts, Admin-Links) stehen ohne
   Animation da.
8. Fehler: Titel abgeschnitten, Planet blinkt, alles verschwindet kurz.

Ansehen: Bildfolge über CDP `Page.captureScreenshot` (Playwrights
`page.screenshot` wartet auf der Beta-Bühne bis zu 9 s auf einen Frame).

**Stand der Umsetzung (2026-11-04, Branch `claude/funny-keller-7pm4ty`):**

| Punkt | Umsetzung |
|---|---|
| Sterne zuerst | Boot-Himmel in `src/styles.scss`: bis die erste Seite steht, ist der Seitenhintergrund der Szenen-Himmel (gleiche Felder/Seeds wie `shell-scene`); Splash-Ring erst nach 1,2 s |
| Name in der Mitte | `brand()` in `verse-briefing.component.ts`: „Star Citizen Companion“ (`verse.hub.brand`) statt der ersten Story, ohne Rubrik und Pfeile; auch während die Übersicht lädt (kein Platzhalter-Balken) |
| Aufbau nacheinander | Zeitplan ab Intro-Start: Balken 0,15 s, Name 0,35 s + 45 ms/Buchstabe, Kopfzeile 1,9 s, Suche 2,3 s, Sonne 2,6 s, Planeten schweben 2,9 s ein, „Mehr im Verse“ 3,05 s |
| Kein Auftauchen-Verschwinden | Shell kündigt das Intro beim Start an (`holdHeroIntro`): Kopfzeile/Suche stehen ab dem ersten Frame auf ihrem verborgenen Startbild; die Suche bleibt unsichtbar, bis sie auf der Bühne steht |
| Planet von unten | `sc-briefing-planet`: gleitet beim Bereitwerden herein (1,5 s), das Intro wartet nicht mehr auf ihn |
| Nur ein Planet | CSS-Planet nur noch ohne WebGL (keine 3-s-/8-s-Ersatz-Einblendung mehr) |
| Sternschnuppe zuletzt | `.finale`: frühestens nach dem Aufbau (3,6 s) und wenn der Planet steht, spätestens 7 s; danach zündet das Sternbild, bei +0,8 s wechselt der Titel zur ersten Story; der Name kommt nie wieder |
| Nur beim Öffnen/Neuladen | volles Intro nur, wenn die Seite auf `/verse` geöffnet wurde (erster Besuch der Sitzung oder Neuladen); sonst steht alles sofort |
| „4.10“ abgeschnitten | Titel wird beim Wechsel Name → Story neu eingepasst |

Checks: Karma 5336/5336, Lint 0 Fehler, Build inkl. Guards, Mobile-Gate grün.

---

## 6. Planet and bodies in workers (performance audit 2026-11-05, GL-1 to GL-7)

**What froze `/verse` on boot** (real GPU, RTX 2080 Super, Direct3D 11, cold shader
cache, every WebGL call timed from the page): `getProgramParameter(LINK_STATUS)`
3.5 s + 0.33 s + 0.12 s, then the canvas resize 0.9 s, which is where the GPU
catches up on texture uploads and mipmaps. `texImage2D` itself takes 35 ms. The
lab profiler's "resize 4530 ms" was that flush seen on software WebGL; its
"body-engine `e`" was the link of the bodies' planet shader. With a warm shader
cache the same page blocks about 1.3 s, most of it app boot.

**The shape now:**

- `planet/planet-scene.ts`: the planet's animation, free of the DOM. It runs in
  `planet/planet.worker.ts` or, as the fallback, on the page. The page stays clock
  and ruler: every frame it measures the anchor and posts the view, and the worker
  draws on arrival. A reader changing one path changes both.
- `bodies/body-gl.ts`: the same split for the small bodies. Their canvases move
  with the page, so `bodies/bodies.worker.ts` runs its own animation frames and the
  page reports only changes (size, on screen, stage pause). SVG maps are rasterised
  on the page (that takes a document) and sent over as `ImageBitmap`s. Where
  `KHR_parallel_shader_compile` exists, a body does not wait for another's shader.
- A canvas goes to a worker only after that worker said it can draw, so a failed
  worker leaves the page free to draw. After a hand-over the planet gets fresh
  canvases; a body falls back to its CSS art.
- The planet's canvases and worker outlive the component (`sessionLink`), so a
  return inside the session compiles and uploads nothing.
- Context loss: restore, else after 3 s the CSS planet or CSS art stands in.
- WebGL starts after the next paint (`after-paint.ts`): on software rendering the
  GPU process's work otherwise holds up the first paint even from a worker.

**What is rendered without being seen (GL-4), measured by reading every frame back:**

| Pass | Result | Decision |
|---|---|---|
| Train layer, full canvas, 30 fps | 73 of 128 clears had no train on them | Removed: untouched until a train is lit |
| Planet pass while disc and halo are above the canvas | blank canvas, redrawn | Removed: one blank frame, then nothing |
| Planet base at 15 fps | 0 of 79 frames identical | Kept: pixels change, so it is not needless |
| Bodies at 30 fps | 0 of 540 frames identical | Kept: same reason |
| Bodies off screen | already paused by IntersectionObserver | Nothing to do |
| 2D copy per body | under 0.1 ms per body on the main thread | Kept: one context needs it |

Not taken then, because pixels would change: a slower planet pass, a smaller canvas,
drawing the surface once and compositing the aurora over it. Section 7 reopens the
smaller canvas. The planet pass stays at 15 fps, the owner's choice after seeing it live.

**Texture size (GL-7).** The disc is `160vw` wide, so r = 0.8 x viewport width, and
1:1 at the disc's centre takes W = 2 pi r. There is no 8k asset.

| Texture | W | Texels per device pixel at 1920 wide (r = 1536) | Decision |
|---|---|---|---|
| night | 4096 | 0.42 | Kept. 1:1 would take 9651 |
| day, cloud | 1024 | 0.11 | Kept |
| body maps | 1024, now 512 at dpr 1 | 2.7 before, 1.3 now (body 115 px) | Lowered: `bodyMapWidth()` |

Body maps stay at or above 1:1 for the size a body can reach on this screen. This
saves download, GPU memory and upload.

**Baked body maps.** `scripts/bake-body-maps.mjs` writes the SVG rasters as lossless
WebP to `public/planet/bodies/` (8 maps at 512 and 1024: 0.9 MB and 3.0 MB;
`/planet/**` is already in the service worker's `assets` group). The bodies' worker
loads them itself, so the SVG filters, 1.4 s on the main thread in tasks up to
0.55 s, no longer run on the page. A failed file falls back to rasterising the SVG.
The prebuild check hashes the SVGs. Re-baking needs a GPU, because the filters come
out differently on Skia's CPU backend (75-85 % of the pixels, by 1-2 of 255 on
average); the manifest names the renderer.
Real GPU, cold, real CSP: 2 long tasks, sum 0.3 s, max 0.22 s, planet ready 2.1-2.5 s
(before: 8-9 tasks, sum 1.8-2.1 s, max 0.59-0.60 s, ready 3.5-3.9 s). The price is a
download: 0.9 MB at dpr 1, 3.0 MB at high density, against about 10 kB of SVG.

**Software WebGL: no special path.** Same session, cold, FCP in seconds, four rounds:
old page path 5.6, 6.4, 10.7, 8.9; worker 8.1, 3.9, 7.6, 6.3. The audit's "3.1 s
before, 6.3-9.9 s after" does not hold up: with the box loaded the old build scatters
just as far. Keeping such machines on the page path (detect the renderer, or no
transfer API) measured 3.0, 9.8, 8.8, 10.6 s with 8-11 s of blocked main thread against
0.4-1.5 s, so it buys nothing and costs a frozen page. Holding WebGL back until the
first contentful paint measured 3.1, 8.1, 9.8, 6.5 s: also nothing, so it was taken
out again. Real cost on software that remains: the planet stands after about 17-19 s
instead of 4-6 s, while the page stays usable.

**Service worker:** the worker files are `worker-*.js` in the dist root. If
`ngsw-config.json` narrows `/*.js`, they need a rule of their own. Without one they
still load online; offline the page draws the planet itself.

## 7. What the page costs at rest (concept 2026-11-06 "Planet-Leistung")

Concept and decisions: `docs/concepts/20261106-0930-planet-leistung/`.

**Method.** Production build with the fixtures of section 1, real GPU (RTX 2080 Super,
Direct3D 11), 1920x1000. Load is the CPU of the renderer and GPU processes in % of one
core (`SystemInfo.getProcessInfo` over the browser CDP session). Headless Edge has the
real GPU and about 150 rAF/s, and opens no window. A visible window needs
`--disable-features=CalculateNativeWinOcclusion`: covered, its rAF drops to 1/s. Check
that the planet's measures per second look right before trusting a row. Between runs the
base moves by about 7.

**Findings.**

- The planet's shader is cheap on this GPU: under 1 ms a frame, even at 4K. Its cost
  was the page following the monitor: about 175 measures and messages a second for 15
  pictures.
- The planet was about 12 % of the page. Removing sources one by one shifts the shares:
  a source can hide behind another that keeps the same frames alive (`wave` looked like
  9 first and turned out to be about 54 once the others were gone).
- Menu clicks: `.stars` carried 226 radial-gradient layers. After a click, frames stood
  for 630 ms on average, with no long task and no blocking script, so the wait was in
  raster. Without the gradients the longest gap was 51 ms. A `will-change` or a sky
  without its flight did not help. `field-image` draws the same spots as one SVG image
  (largest difference 9 of 255, on the stars' edges only).

**Result, same session, 2 rounds each (headless Edge).**

| | Before | After |
|---|---|---|
| /verse at rest | 188 | 128 |
| /verse without window focus | 193 | 38 |
| Scrolling | 240 | 226 |
| Longest frame gap after a menu click, average | 595 ms | 91 ms |
| Page measures per second at rest | 349 | 28 |

The planet alone on a quiet page: +28 before. After: the page with it went from 70.8 to
57.7, and the difference to the page without it reads +4.3, which understates it, because
the twinkling stars keep compositor frames alive in that base. The tick test of the
concept (+13.7) is the better figure. A sixth to a half of before, not a tenth, except
without focus, where it does not run at all.

**Rules that follow.**

- At rest a timer sets the planet's pace. It is followed every frame only while it moves
  on screen; the loop finds that out by itself, so the entrance and the shake need no hook.
- Never animate `box-shadow`, a custom property in a gradient or a window-sized layer in
  an infinite loop. Opacity on a small layer of its own does the same job.
- Never many gradient layers for a static picture: use one image.
- An animation under `opacity: 0` still costs its frames.

**The remainder: frames, not layers.** With every animation frozen and only the planet
and the moons at 15 Hz, /verse costs 35. With nothing but the three 5 px stars running
and no planet, it costs 68. Filters, `backdrop-filter`, blend modes and `will-change` make
no measurable difference. One running animation of any size makes the browser produce and
draw whole frames at the display's rate, so the load follows from how often anything moves.
Pausing one group at a time shows almost nothing (fb-breathe, the sun's parts: 0 to 5),
because the others keep the same frames alive; "about 75 with nothing animated" above was
wrong, the earlier test had left the stars and transitions running.

`SlowMotionService` therefore advances the endless animations of the scene, the fusion bar
and the briefing at 15 Hz by hand, and the stars with them. `fs-demo` runs three loops and
then stands.

| | Before | After section 7 | With the 15 Hz clock |
|---|---|---|---|
| /verse at rest | 199 | 128 | 86 |
| /verse without window focus | 204 | 38 | 39 |
| Scrolling | 213 | 226 | 164 |
| Frame gap after a menu click, average of all hops | 1313 ms | not comparable | 146 ms |

The "before" column here is the same build as above, measured again in the later run; 188
to 199 at rest shows the spread between runs. A menu hop now usually takes about 100 ms;
one of twelve took 511 ms. With everything frozen 35 is the floor of the 15 Hz canvases, and
the three clocks (planet, moons, animations) do not tick in step, so up to 45 frames a
second remain. Aligning them is the next lever, unmeasured.

**Live, v0.215.0, 2 runs.** The real Vercel bundle in headless Edge, with the fixtures and a
stubbed session, because /verse needs a sign-in: at rest 84, without focus 45, scrolling
188. Menu hops usually take about 100 ms, loading 0 to 1 chunk. The first hop to the Codex
after a start still stands for 461 to 483 ms, here and in the local run (511 ms); that hop
was not taken apart.

**Rule.** No endless animation runs at display rate on a page that is meant to stand: put
it inside the scope of `SlowMotionService`, or give it an end.
