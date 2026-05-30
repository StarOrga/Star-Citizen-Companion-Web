# SC Companion

Angular 21 PWA · Supabase · Vercel (`sc-companion.vercel.app`, alias of `star-citizen-companion-web.vercel.app`)

## Commands

- `npm start` — `ng serve` on `http://127.0.0.1:4200` (default = cloud Supabase)
- `npm run build` — production build → `dist/sc-companion/browser`
- `npm run typecheck` — `tsc --noEmit -p tsconfig.app.json`
- `npm test` — Karma + Jasmine (ChromeHeadless), no watch
- `npm run db:push` — apply `supabase/migrations/` to cloud project
- `npm run db:reset` — local stack only, drops and re-applies
- `npm run functions:deploy` — deploy all edge functions

## Key Rules

- Standalone components, signals, `providedIn: 'root'` services, `OnPush`.
- **All user-facing strings localized via ngx-translate** (`{{ 'key' | translate }}` in templates). Never hardcode UI text in DE/EN — add keys to `public/i18n/{de,en}.json`.
- Auth-gated routes use `authGuard` (awaits `auth.ready()`).
- **No API keys in repo or client bundle.** Third-party APIs go through Edge-Function proxies; keys live as Supabase Edge-Function secrets.
- Branch off `main` (`feat/...`, `fix/...`) — main is hook-protected against direct edits.
- **Alpha-Phase data policy:** schema rewrites may drop legacy tables (everything except `auth.users` + `profiles`). Document drops in migration comments.

## Deep Knowledge

- `.claude/deep-knowledge/supabase.md` — schema, RLS, migrations, edge functions
- `.claude/deep-knowledge/verse-news-sources.md` — RSI news APIs, Comm-Link Wiki API, RSS fallbacks
- `.claude/deep-knowledge/p4k-format.md` — CryEngine PAK / ZIP heuristics, what we currently parse
- `.claude/deep-knowledge/local-dev.md` — dev-server IPv4-only bind (localhost ≠ 127.0.0.1), Docker, worktrees
