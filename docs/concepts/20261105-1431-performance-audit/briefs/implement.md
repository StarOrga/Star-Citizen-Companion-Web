# Implement brief — Performance-Audit (round 1)

Source of decisions: `docs/concepts/20261105-1431-performance-audit-decisions.json`
(round 1, action `implement`). Page: `docs/concepts/20261105-1431-performance-audit.html`.

## The owner's original request (verbatim)

> Warum ist die website so unsagbar langsam, auch wenn mein pc im idle läuft uznd hardware ok! andere seiten ok! es muss entweder an vercel / supabase / cloudflare liegen oder an den website mechansimsen selber, analyisiere und auditiere das!

## The owner's comments (verbatim, round 1)

- **Daten-Upload (`d-ingest` → keep):**
  > Also data uploader ist nicht meini thema, der kann ruhig lang laufen! AUßerdem speichern wir doch in cloudflare die daten oder nicht und nur wenig in supabase? Oder verstehe cih das falssch.
  > Mein punkt war eher die scc website!
- **Planeten-Start (`d-webgl` → worker):**
  > [Befund · Frage 1]  Ja genau, ggf. auch die webgl themen stark verbessern, weil wir doch viel statisches haben (z. B. das planetenbild, was in einzelheiten drehen vs beleuchtungen daruf dauer rendered), wird ggf. zu viel was gar nicht vor dem user angezeigt wird gerendered? Ich will die qualiätt, übergänge und animationen nicht minimieren / verschlechteern
- **Service Worker (`d-churn` → lazy):**
  > Ja genau, also der browser braucht nicht komplett direkt offline funktionieren mit allen codex infos! Das kann gern lazy und oder aasynchron geladen werden - lazy, bei bedarf auf jeden fall, asynchron damit man unahbhngig davon die infos auch alle hat!
- **Fremde Erweiterung (`d-rokt` → wrong, correction):**
  > check mal meine edge erweiterungen! das habe ich nicht installiert, ist das überhautp seriös!?

Comment text was normalised for one broken umlaut byte in the payload; wording is unchanged.

## Decisions that change nothing (do NOT touch these)

- `d-ingest` = keep: no change to the Data Uploader or `ingest-catalog`.
- `d-gates` = keep: no change to the mobile gate or CI test load.
- `d-rokt`: not a code change. The session answers it (done: it comes from the Klarna extension).

## Checklist — accepted items

- [ ] **ENT-1** `d-entrance` = daily: the full entrance plays once per day, per device. Reloads and new tabs on the same day show the content at once. Today's rule is `claimIntro()` in `src/app/verse/pages/briefing/briefing.model.ts:222` (sessionStorage per tab, reload replays full) and `peekIntro()` right below it.
- [ ] **ENT-2** The first-of-day full entrance itself stays exactly as it is, including timing and transitions. Update existing specs for `claimIntro`/`peekIntro`.
- [ ] **ENT-3** Check the Fusion bar stage entrance (`ENTER_MS = 3100`, `src/app/shell/fusion-bar/fusion-bar.component.ts:62`, `:876`): if it holds content back on a same-day reload or new tab, apply the same daily rule. Report what you found either way.
- [ ] **FAN-1** `d-fanout` = rpc: a new Postgres RPC returns the class names added in the current LIVE build compared with the previous one, per kind, with one request. It replaces the paged browser loop in `src/app/codex/codex-build-diff.service.ts:103-118` and `:146-168` (`classNames`, `shipClassNames`).
- [ ] **FAN-2** The RPC keeps today's semantics, including the default browse filters for ships (`is_variant = false`, named, `NON_SHIP_VEHICLE_PREFIXES`). `MAX_PAGES = 10` silently caps the client at 10,000 rows; the RPC must not carry that cap over, and the report must say whether it was truncating.
- [ ] **FAN-3** Find which caller triggers this on `/verse` during boot and report it (file:line). A boot-time caller that only feeds a closed search panel must wait until it is needed.
- [ ] **FAN-4** Migration under `supabase/migrations/` with a unique timestamp prefix, grants for `authenticated`/`anon` matching the tables it reads, safe under the statement timeouts (anon 3 s, authenticated 8 s). The body must not fetch `payload`. Dry-run and measure it in a rolled-back transaction on the live DB as a real role. Do NOT push the migration.
- [ ] **SW-1** `d-churn` = lazy: `ngsw-config.json` stops prefetching every chunk. The boot shell (`index.html`, `main-*`, `polyfills-*`, `styles-*`, plus what first paint needs) stays prefetched; `chunk-*` becomes `installMode: lazy`, `updateMode: prefetch`.
- [ ] **SW-2** "lazy, bei bedarf auf jeden fall, asynchron": the main areas still reach the browser in the background, independent of use. `IdlePreloadingStrategy` (`src/app/core/idle-preloading.strategy.ts`) already does this for marked routes; verify it still runs and that its chunks land in the SW cache. The rest of the app does not have to be available offline.
- [ ] **SW-3** A dead chunk URL answers 200 `text/html` on Vercel (see memory note in `sc-vercel-immutable-dead-chunks`), so an old tab asking for a chunk gone after a deploy gets HTML. `src/app/core/route-load-recovery.service.ts` must recover from that case: verify which error Chromium raises for a module served as `text/html` and extend the matcher plus its spec if it is not covered. A preload failure stays quiet.
- [ ] **SW-4** The auto-reload rule in `src/app/core/sw-update.service.ts` keeps working with the new groups. Update any spec or check that pins `ngsw-config.json`.
- [ ] **GL-1** `d-webgl` = worker: the big planet (`briefing-planet.component.ts`, `planet/planet-gl.ts`) renders in a Web Worker through `OffscreenCanvas`, so shader compile, texture upload and canvas sizing leave the main thread. The same applies to the small bodies (`bodies/body-engine.ts`, `bodies/body.directive.ts`).
- [ ] **GL-2** Without `OffscreenCanvas` WebGL support in a worker, today's main-thread path stays as the fallback. WebGL unavailable still ends in the existing `unavailable`/CSS path.
- [ ] **GL-3** The main-thread freeze on `/verse` boot shrinks measurably. Measure before/after with `scripts/perf/profile-startup.cjs` (route `/verse --beta --de --profile`), and report the numbers.
- [ ] **GL-4** Owner's question answered with evidence: what is rendered without being visible, and what is re-rendered although static? Examine: the planet base redrawn at about 15 fps for a surface turning once in 30 minutes (`briefing-planet.component.ts` draw loop, `lastPlanet`, `66` ms); the train canvas; the small bodies at 30 fps; bodies and canvases off-screen or covered; the 2-D copy per body in `body-engine.ts`. Remove every render that changes no visible pixel.
- [ ] **GL-5** Hard constraint from the owner: quality, transitions and animations must not get smaller or worse. No lower resolution, no lower frame rate on anything that visibly moves, no dropped effect. Rendering less is allowed only where the pixels would be identical. Reduced motion, the stage pause (`--sc-brief-play`), the entrance's planet wait and `onPlanetSettled`, session re-entry (`builtWorld`, `instant`) and dock flight all keep working.
- [ ] **GL-6** CSP: `worker-src 'self' blob:` is already in `vercel.json`; a worker must load from the app origin and work under the real CSP and through the service worker.

## Hard constraints from the repo

- Read `CLAUDE.md`; it binds. `OnPush`, signals, no `console.*` (use `core/log.ts`), no new user-visible string without i18n keys in both languages.
- Do not commit. Do not push. Do not run `db:push` or deploy functions. Do not touch other sessions' processes: no pattern kills, only your own PIDs.
- Fixtures use `.test`/`@example.com` addresses only.
- Template changes are not covered by `npm run typecheck`; `npm run build` is the gate for those.
- Karma needs `CHROME_BIN=P:/packages/chrome-for-testing/chrome/win64-157.0.8103.38/chrome-win64/chrome.exe`. Never chain the test runner with `&&`; run it in its own call.

## What each agent returns

One row per checklist line it owns: item → done / partial / not done → evidence (file:line, spec name, measured number). Assumptions are listed apart, never folded into "done".
