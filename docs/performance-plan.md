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
