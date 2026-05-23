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

## Worktrees

Aktuelle Worktrees liegen unter `.claude/worktrees/<random-slug>/`. Jeder
worktree hat seinen eigenen Branch — beim Sync auf `main` ist es der
worktree-Branch der gepusht wird, nicht ein generischer `feature/...`-Name.
