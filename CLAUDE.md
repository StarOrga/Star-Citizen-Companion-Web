# SC Companion

Angular 21 PWA · Supabase · Vercel — live at `sc-companion.vercel.app` (the project default `star-citizen-companion-website.vercel.app` 307s to it)

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
- **Navigations are real anchors.** Anything that takes the user somewhere (card, tile, list row, thumbnail) must render as `<a [routerLink]>` / `<a [href] target="_blank" rel="noopener noreferrer">`, never a `<div>`/`<button>` with `(click)` — middle click, Ctrl/⌘+click and "open link in new tab" are browser features that only work on an anchor. Where the plain left click stays in-app (overlay, lightbox), gate the handler with `isPlainLeftClick` (`src/app/core/modified-click.util.ts`) so modified clicks fall through untouched. Real *actions* (toggle, delete, submit, open a picker) stay `<button>`.
- **Red means "elevated access".** `--sc-accent-hot` marks navigation/menu surfaces a normal user never reaches (admin nav links, the admin feedback FAB, the collaborator-gated Data Uploader). Anything a plain viewer may use — including the public Starscape App download — uses `--sc-accent`. Inside a red group box, individual entries that are *not* admin-only stay in the normal accent, and an admin-only entry says so in words as well as in colour. `--sc-danger` stays reserved for errors and destructive actions.
- Auth-gated routes use `authGuard` (awaits `auth.ready()`).
- **No API keys in repo or client bundle.** Third-party APIs go through Edge-Function proxies; keys live as Supabase Edge-Function secrets.
- Branch off `main` (`feat/...`, `fix/...`) — main is hook-protected against direct edits.
- **Alpha-Phase data policy:** schema rewrites may drop legacy tables (everything except `auth.users` + `profiles`). Document drops in migration comments.

## Deep Knowledge

- `.claude/deep-knowledge/supabase.md` — schema, RLS, migrations, edge functions
- `.claude/deep-knowledge/verse-news-sources.md` — RSI news APIs, Comm-Link Wiki API, RSS fallbacks
- `.claude/deep-knowledge/p4k-format.md` — CryEngine PAK / ZIP heuristics, what we currently parse
- `.claude/deep-knowledge/local-dev.md` — dev-server IPv4-only bind (localhost ≠ 127.0.0.1), Docker, worktrees
- `.claude/deep-knowledge/patch-stability.md` — stability indicator sources (Spectrum replies, status JSON, CIG KB), API quirks, where the formula lives
