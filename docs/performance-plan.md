# Performance-Plan — flüssiger Start auf PC und Handy

Stand: 2026-11-03 · Branch `claude/funny-keller-7pm4ty` · Auftrag des Owners:

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
| `0ca4f45` | **i18n**: Englisch als Fallback erst nach dem ersten Paint (Englisch sofort, sonst `requestIdleCallback` ≤ 5 s). `EnglishStringsService` lädt Englisch für die Keybinds weiter bei Bedarf. |
| `e16efcb` | **Planet gebacken**: `scripts/bake-planet.mjs` → `public/planet/` (verlustfreies WebP, pixelgenau verifiziert; `world.json` bitgenau, Spec `planet-assets.spec.ts`). Komponente lädt die Dateien parallel, dekodiert per `createImageBitmap` abseits des Haupt-Threads; Berechnung im Browser nur noch als Rückfall (mit fairer Idle-Planung). Prebuild prüft per Quell-Hash, ob neu gebacken werden muss (`npm run gen:planet`). Service Worker cacht `/planet/**`. |

## 4. Offen — in dieser Reihenfolge

Jeder Punkt: umsetzen → `npm run typecheck` → betroffene Specs
(`node scripts/run-karma.mjs --include='src/app/<bereich>/**/*.spec.ts'`) →
committen → pushen → hier abhaken.

1. **`main` regelmäßig mergen** (`git fetch origin main && git merge origin/main`).

2. ~~**Planet-Loop entlasten**~~ — erledigt: Loop pausiert per
   IntersectionObserver, wenn der Planet aus dem Bild gescrollt ist.
   `geometry()` (2 × `getBoundingClientRect` pro Frame) bleibt bewusst: das
   Intro bewegt den Anker per CSS, ein Cache würde den Planeten versetzen.
   Zeichnen ist bereits gedrosselt (Planet ≤ 15 fps, Züge ≤ 30 fps).

3. **Dauer-Animationen** (Ausgabe „RUNNING ANIMATIONS“ des Profilers):
   - `/codex`: `rays` (opacity), `motes` (**background-position**, nicht
     composited), `band` — laufen endlos, auch auf einem 480×0-Element.
   - `/verse` Beta: `fs-demo-1/2/3` (**clip-path**, endlos, Such-Platzhalter),
     `sc-scene-twinkle`/`sc-scene-city` (Vollbild-opacity), Sonnen-Beacons
     (`breathe`, `corona`, `erupt`, `boil`, `flash`).
   - Ziel ohne optische Änderung: endlose Animationen pausieren
     (`animation-play-state: paused`), solange ihr Element nicht im Viewport
     ist oder 0 Fläche hat; nicht-compositete Eigenschaften nur dort ersetzen,
     wo das Bild identisch bleibt.

4. **Erzwungene Layouts im Shell-Code**: `shell.component.ts › publishTopbarHeight`,
   `fusion-bar.component.ts › measureTrail / placeStage / publishHeight`,
   `stage-hero.directive.ts › align`, `verse-briefing.component.ts › lines/measure`.
   Muster: Messen nur in ResizeObserver-/IntersectionObserver-Callbacks oder
   gebündelt in einem rAF (erst alle Reads, dann alle Writes); keine
   Messung in jedem Scroll-Event ohne rAF-Bündelung.

5. ~~**`news-thumb › detectFramePads`**~~ — erledigt: Ergebnis pro Bild-URL
   modulweit gecacht, ein wiederverwendetes Mess-Canvas. Bleibt bewusst
   synchron im `load`-Handler: verschoben würde der Bild-Zoom sichtbar springen.

6. **Gezieltes Vorladen** (`app.config.ts › provideRouter(withPreloading(...))`):
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
     `account-prefs.service.ts`, `app.component.ts` Sprache/Region) → ein
     gemeinsamer Read mit allen Spalten.
   - `rpc/set_ui_pref` (ein **Write**) bei jedem Laden → nur bei echter Änderung.
   - `rsi-upcoming-ships` Edge Function: gleiches Muster wie `fetch-verse-news`
     prüfen und ggf. memoisieren.
   - SW-`dataGroups` `verse-news`: `freshness` mit `timeout: 10s` → bei
     langsamer Function wartet die UI bis zu 10 s; Timeout senken (z. B. 3 s),
     damit der Cache greift.

9. **Unsichtbares später rendern**: `@defer (on viewport)` mit Platzhalter in
   fester Höhe für Blöcke unterhalb des Falzes (z. B. `<sc-news-list>` am Ende
   der Verse-Beta-Seite); Bilder unterhalb des Falzes `loading="lazy"` +
   `decoding="async"`, Titelbild `fetchpriority="high"`. Vorher prüfen, dass
   keine `#fragment`-Links in die verzögerten Blöcke zeigen
   (`anchorScrolling: 'enabled'`).

10. **Zoneless** (`provideZonelessChangeDetection()`, zone.js aus den
    Polyfills): alle 221 Komponenten sind schon `OnPush`. Vorher prüfen:
    `NgZone.onStable/onMicrotaskEmpty/isStable`, `ApplicationRef.isStable`
    (SW-Registrierung `registerWhenStable`), `fakeAsync`-Specs (zone.js für
    Tests behalten).

11. **Echte Nutzerdaten**: LCP, CLS, INP, Long Tasks per `PerformanceObserver`
    über den vorhandenen `AnalyticsService` (nur mit Statistik-Einwilligung).

12. **Abschluss**: voller Lauf (`npm run lint`, `npm test`, `npm run test:gate`,
    `npm run test:functions`, `npm run build`), Nachmessung mit dem Profiler,
    Vorher/Nachher-Tabelle hier ergänzen.
