# SC Companion

**Version: 0.82.6**

> Star Citizen companion — Verse News, P4K analyzer, and more.
> Built with Angular 21 PWA · Supabase (Auth + Postgres + Storage + Edge Functions) · Vercel.

[![Live](https://img.shields.io/badge/live-sc--companion.vercel.app-00d4ff)](https://sc-companion.vercel.app)
[![Stack](https://img.shields.io/badge/stack-Angular%2021%20%C2%B7%20Supabase%20%C2%B7%20Vercel-00d4ff)](#)
[![Phase](https://img.shields.io/badge/phase-alpha-fbbf24)](#)
[![License](https://img.shields.io/badge/license-MIT-4ade80)](LICENSE)

**Production:** <https://sc-companion.vercel.app>

A fan-made Star Citizen companion: log in, follow the Verse News (Comm-Link + Spectrum + RSI status) 1:1, drop a `Data.p4k` to extract metadata automatically (with channel detection: live / ptu / eptu / tech-preview). Long-term goal: do everything erkul.games does, plus more.

> **Not affiliated with Cloud Imperium Games or Roberts Space Industries.** See [LICENSE](LICENSE).

## Quick start

```bash
npm install
npm start             # http://127.0.0.1:4200 — talks to the cloud Supabase project
npm run build         # production build into dist/sc-companion/browser
npm run typecheck     # tsc --noEmit
npm test              # Karma + Jasmine (ChromeHeadless)
```

### Supabase

- **Cloud project:** `hcnqhvzlavdycidqyaai.supabase.co` (region `eu-central-1`, free tier).
- **Schema:** `supabase/migrations/` — applied via the Supabase MCP / `npm run db:push`.
- **Edge Functions:** `supabase/functions/` — `fetch-verse-news` (RSI news proxy), `process-p4k` (upload analyzer).
- **Storage:** bucket `p4k-uploads` — per-user folder layout, RLS scoped to `auth.uid()`.

Local stack (optional, Docker required):

```bash
npx supabase start   # bring up Postgres + Auth + Storage + Functions locally
npx supabase db reset
npx supabase functions serve fetch-verse-news --no-verify-jwt
```

### Vercel

- **Production:** <https://sc-companion.vercel.app> — auto-deployed from `main`. Vercel's project default `star-citizen-companion-website.vercel.app` redirects here.
- `vercel.json` configures SPA rewrites, security headers, and a CSP that allows Supabase + Google OAuth.
- The build output is `dist/sc-companion/browser`.
- **Initial connect (one-time):** open https://vercel.com/new, import `StarOrga/Star-Citizen-Companion-Web`, accept the defaults. Subsequent pushes to `main` deploy automatically.

## Architecture

```
src/app/
  core/            Supabase client provider
  auth/            Sign-in, OAuth, route guards, HTTP interceptor (adds bearer to edge-function calls)
  shell/           Authenticated top-bar layout
  news/            Verse News feature (proxy via fetch-verse-news)
  p4k/             P4K upload + history (proxy via process-p4k)
  profile/         Account metadata
public/i18n/       en.json, de.json — ngx-translate
supabase/
  migrations/      00001_init_schema.sql, 00002_storage_bucket_p4k.sql
  functions/       fetch-verse-news/, process-p4k/
browser-extension/ Chrome MV3 hangar import (no bundler, no npm deps)
```

### Hangar import via browser extension

The web app cannot read robertsspaceindustries.com — the same-origin policy
forbids it and RSI publishes no hangar API. [`browser-extension/`](browser-extension/README.md)
closes that gap: it reads the ship list on the user's own hangar page, offers
the import only when the fleet's fingerprint changed (no daily nagging), and
hands the list to `/hangar/import` through `chrome.storage.local` +
`postMessage`. No new endpoint, no token, no RLS change — the confirmed ships
are written by the user's own Supabase session. Install and privacy details
live in-app at `/tools/extension`.

### Key rules

- Standalone components only (no NgModules), `OnPush` change detection, `providedIn: 'root'` services.
- All user-facing strings are in `public/i18n/{de,en}.json`. Never hardcode UI text.
- Third-party APIs go through Edge Functions (`fetch-verse-news` proxies `api.star-citizen.wiki`). Keys never enter the client bundle.
- `authGuard` waits for `auth.ready()` before deciding, to avoid a flash-of-login on hard refresh.
- Service worker: network-first for JS/CSS, lazy assets, 15-min data cache on `fetch-verse-news`.

## Documentation

- **Public docs site:** <https://star-citizen-companion.readme.io> — authored in
  [`docs/readme-io/pages/`](docs/readme-io/pages) and published by ReadMe's Git
  Sync via a mirror repository. Never edit it in ReadMe's web editor; see
  [docs/readme-io/README.md](docs/readme-io/README.md) and
  [GIT-SYNC-SETUP.md](docs/readme-io/GIT-SYNC-SETUP.md).
- **API reference:** `GET /openapi.json` on the public API, rendered at `/docs`.

## Roadmap

- **Phase 1 (alpha, this MVP):** login, Verse News feed, P4K upload + header heuristics.
- **Phase 2:** deeper P4K parsing — extract Manifest.xml entries, ship/weapon catalogs.
- **Phase 3:** loadout planner (à la erkul.games) backed by the parsed catalogs.
- **Phase 4:** community sharing — saved loadouts, fleet view, organization linking via RSI handle.

## Contributing

PRs welcome. Convention: branch off `main` (`feat/...`, `fix/...`), Conventional Commit-style messages.
This repo is Claude-Code-fit — see [.claude/CLAUDE.md](.claude/CLAUDE.md).
