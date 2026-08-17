# Local Development — Gotchas & Recipes

## Dev-Server bindet auf 127.0.0.1, nicht 0.0.0.0

`npm start` läuft als `ng serve --host 127.0.0.1 --port 4200`
(hardcoded in `package.json`). Das ist eine bewusste Engstelle (kein LAN-Expose
in der Default-Konfiguration), hat aber eine Browser-Gotcha:

**Symptom:** Edge / Chrome zeigen `ERR_CONNECTION_REFUSED` oder weiße Seite
beim Öffnen von `http://localhost:4200`. Curl gegen die gleiche URL liefert
HTTP 200.

**Ursache:** Windows mappt `localhost` standardmäßig auf IPv6 (`::1`). Der
Dev-Server lauscht nur auf IPv4 (`127.0.0.1`). Connect schlägt fehl, bevor
ein HTTP-Handshake stattfindet.

**Lösungen (von leichteste zu invasivste):**

1. **Direkt IPv4 nutzen** — `http://127.0.0.1:4200` in der Adresszeile
   (statt `localhost`). Funktioniert immer, kein Config-Change.
2. **Edge auf IPv4 zwingen** — Edge flag `chrome://flags/#use-ipv6-first` auf
   `Disabled`. Persistent für das Browser-Profil, betrifft aber jede `localhost`-
   Verbindung.
3. **Server auf 0.0.0.0 binden** — `package.json` editieren:
   ```diff
   - "start": "ng serve --host 127.0.0.1 --port 4200",
   + "start": "ng serve --host 0.0.0.0 --port 4200",
   ```
   **Tradeoff:** Server ist dann auch von anderen Geräten im LAN erreichbar
   (Phone-Testing pro, aber CORS und Supabase-Origin müssten ggf. mit). Nicht
   ohne Grund machen.

**Empfehlung:** Option 1 für tägliches Arbeiten. Option 3 nur wenn LAN-Test
explizit gewünscht ist (z. B. PWA-Install auf Phone testen).

## Docker für lokalen Supabase-Stack

`npm run db:reset` und `supabase start` brauchen Docker Desktop laufend.
Wenn Docker down ist:

- `supabase status` → `Cannot connect to Docker daemon`
- Migrations können trotzdem direkt gegen Cloud gepusht werden via
  `npm run db:push` (braucht `supabase link` einmalig) ODER via Supabase MCP
  `apply_migration` (kein link nötig).

## Auth-gated Seiten lokal testen (Login-Wall umgehen)

`/news`, `/profile` etc. liegen hinter `authGuard` — ohne Login kein Zugriff,
und gegen die Cloud-Instanz hat man i. d. R. keine Test-Credentials. Reproduzierbarer
lokaler Test (z. B. um den Verse-News-Render-Pfad zu prüfen):

1. **Port-Konflikt mit Hatchit.** Das Sibling-Projekt Hatchit belegt die
   Standard-Supabase-Ports → SC-Start scheitert mit `port is already allocated`.
   Hatchit **nicht** stoppen (fremdes Projekt; der Auto-Mode-Classifier blockt das
   zu Recht). Stattdessen SC temporär auf verschobene Ports in `supabase/config.toml`:
   `[api] 54421`, `[db] 54422` + `shadow_port 54420`, `[studio] 54423`,
   `[analytics] 54427`, `[inbucket] 54424`. Dann `npx supabase start`.
2. **App auf den lokalen Stack zeigen.** `src/environments/environment.ts`
   temporär: `url: 'http://127.0.0.1:54421'` + der vom Stack ausgegebene lokale
   Publishable-Key. Vite rebuildet — vor dem Login-Versuch den Rebuild abwarten
   (neuer Chunk-Hash), sonst geht der Login noch gegen die Cloud.
3. **Test-User anlegen.** Lokal ist `[auth.email] enable_confirmations = false`
   → ein `POST http://127.0.0.1:54421/auth/v1/signup` (Header `apikey` = lokaler
   Publishable-Key, Body `{email,password}`) ist sofort aktiv und bekommt per
   Trigger einen `profiles`-Eintrag. Account (nur lokales DB-Volume,
   `project_id=sc-companion`, übersteht `supabase stop/start`):
   `testlocal@sc-companion.dev` / `ScTest!Local2026`. Nicht-sensibel (lokaler
   Stack mit Default-Insecure-Keys), daher hier dokumentiert.
4. **Login im Preview-Browser.** Angulars Reactive Form registriert per
   `preview_fill` gesetzte Werte nicht zuverlässig. Werte über den nativen
   Value-Setter + `dispatchEvent(new Event('input'/'change'))` setzen und das
   Formular per `form.requestSubmit()` absenden — `preview_click` auf den
   Submit-Button löst `ngSubmit` nicht aus.
5. **Aufräumen.** `git checkout -- supabase/config.toml src/environments/environment.ts`
   (keine lokalen Ports/Keys committen) und `npx supabase stop --project-id sc-companion`.
   Der Account bleibt im Volume; Hatchit bleibt unberührt.

## Worktrees

Aktuelle Worktrees liegen unter `.claude/worktrees/<random-slug>/`. Jeder
worktree hat seinen eigenen Branch — beim Sync auf `main` ist es der
worktree-Branch der gepusht wird, nicht ein generischer `feature/...`-Name.

## Concept-/Decision-Pages: echte Skill + Server-Root im Worktree

Wenn eine Entscheidungs-/Feedback-Seite gewünscht ist (z. B. `/tune-rethink`
Step 6): **immer** die `/concept`-Skill nutzen (Bridge-Server + zwei
Submit-Buttons + Heartbeat), **nie** ein statisches HTML von Hand bauen und
**nie** im Claude-Preview-Panel öffnen — das Panel hat keinen Heartbeat, die
Seite zeigt dann dauerhaft „Claude nicht verbunden". Concept-Pages gehören in
**echtes Edge** via Bridge (Mechanik: Plugin-`deep-knowledge/bridge-server.md`).

**Worktree-Falle (die eigentliche Projekt-Gotcha):** Server-Roots divergieren.
Der Claude-Preview-MCP (`preview_start`, launch.json) rootet im **Worktree-cwd**;
der `/concept`-Bridge rootet laut Skill im **Main-Projekt-Root**. Schreibt
man das Artefakt in den einen Root und serviert/öffnet es über einen Server im
anderen, gibt es `404` / „nicht verbunden". Regel: **Artefakt-Pfad, cwd des
serviernden Servers und die geöffnete URL müssen denselben Root teilen.** Beim
Concept-Flow also HTML in den Main-Root schreiben und dort den Bridge starten
(nicht über einen Worktree-Preview-Server öffnen).
