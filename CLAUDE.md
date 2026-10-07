# SC Companion

Angular 22 PWA · Supabase · Vercel — live at `sc-companion.vercel.app` (the project default `star-citizen-companion-website.vercel.app` 307s to it)

## Commands

- `npm start` — `ng serve` on `http://127.0.0.1:4200` (default = cloud Supabase)
- `npm run build` — production build → `dist/sc-companion/browser`
- `npm run typecheck` — `tsc --noEmit -p tsconfig.app.json`
- `npm test` — Karma + Jasmine (ChromeHeadless), no watch
- `npm run lint` — ESLint via angular-eslint (`ng lint`)
- `npm run test:functions` — every `supabase/functions/**/*.test.{ts,mjs}` under `node --test`
- `npm run test:gate` — script/hook tests (node --test)
- `npm run db:push` — apply `supabase/migrations/` to cloud project
- `npm run db:reset` — local stack only, drops and re-applies
- `npm run functions:deploy` — deploy all edge functions

CI: `.github/workflows/web-ci.yml` runs typecheck, lint, Karma, gate scripts, build and the mobile gate on every PR; `edge-functions-deploy.yml` runs the function tests (Node + Deno) before it deploys. Node 24 (`.nvmrc`).

## Key Rules

- Standalone components, signals, `providedIn: 'root'` services, `OnPush`.
- **All user-facing strings localized via ngx-translate** (`{{ 'key' | translate }}` in templates). Never hardcode UI text in DE/EN — add keys to `public/i18n/{de,en}.json`.
- **Navigations are real anchors.** Anything that takes the user somewhere (card, tile, list row, thumbnail) must render as `<a [routerLink]>` / `<a [href] target="_blank" rel="noopener noreferrer">`, never a `<div>`/`<button>` with `(click)` — middle click, Ctrl/⌘+click and "open link in new tab" are browser features that only work on an anchor. Where the plain left click stays in-app (overlay, lightbox), gate the handler with `isPlainLeftClick` (`src/app/core/modified-click.util.ts`) so modified clicks fall through untouched. Real *actions* (toggle, delete, submit, open a picker) stay `<button>`.
- **Red means "elevated access".** `--sc-accent-hot` marks navigation/menu surfaces a normal user never reaches (admin nav links, the admin feedback FAB, the collaborator-gated Data Uploader). Anything a plain viewer may use — including the public Starscape App download — uses `--sc-accent`. Inside a red group box, individual entries that are *not* admin-only stay in the normal accent, and an admin-only entry says so in words as well as in colour. `--sc-danger` stays reserved for errors and destructive actions. **Foreign brands are the one exception:** a third-party mark (YouTube, Spectrum) appears as its unaltered logo in its own colours (`src/app/news/channel-icons.ts`); its label, border, badges and hover states stay on app tokens, and a brand colour never becomes a token for a state. **A worse comparison value** (a negative delta, a weaker axis) uses `--sc-warning`, never `--sc-danger` — a comparison is not an error.
- **One page frame.** The shell's `.content` (and the public layout's) sizes every page: `--sc-page-max` / `--sc-page-gutter` in `src/styles.scss` ("PAGE FRAME"), 1280px up to full HD, growing to 1600px on QHD/ultrawide. A routed page never sets `max-width`, a centring margin or side/top padding on its root — that is how pages drifted into eight widths. What reads better narrower limits itself inside the frame: running text takes `--sc-measure`, a page of text cards uses `.sc-card-page`, a dialog-like card keeps its own `max-width`.
- **One page header.** Codex and Hangar pages open with `<sc-page-header>` (`src/app/shared/page-header/`): breadcrumb crumbs as real anchors, eyebrow, the page's only `<h1>`, subtitle, `phAside` / `phActions` slots. A detail page's parent crumb comes from `originCrumb()` (`NavOriginService`), so it leads back to where the reader came from — the index with its filters, the FPS list, the ship — never a hard-wired "← Zurück". A page whose title lives in its own stage passes no `title`, only crumbs and `rememberAs`.
- **No native browser dialogs.** Questions go through `ScConfirmService` (`src/app/shared/dialog/`: `confirm()` / `prompt()`, `tone: 'danger'` for destructive ones); any dialog-like element gets `[scDialog]` for focus in, Tab trap, Escape and focus return. `scripts/check-native-ui.mjs` (prebuild) fails the build on `window.confirm/prompt/alert`, a native `title` tooltip or a native `<select>` — hints use `[scTooltip]` (`src/app/shared/tooltip/`), lists use `<sc-select>`; an icon-only button shows its aria-label as its tooltip.
- **Errors are translated, never raw.** A failure shown to the user goes through `toErrorKey(scope, op, err)` / `describeError` (`src/app/core/describe-error.ts`) → an `errors.*` i18n key, and a load failure renders an error state with retry, never the empty state. Logging only via `core/log.ts` (`logWarn`/`logError`) — no `console.*` in `src/app`; the `check-raw-errors` prebuild guard enforces both.
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
- `.claude/deep-knowledge/scheduled-tasks.md` — the feedback routine as a Desktop scheduled task: one session per tick, why every tick archives older sessions and itself, what to check before touching cron or cadence
- `.claude/deep-knowledge/test-account.md` — signed-in Playwright browsers via the test account (init page, Credential Manager setup, admin-on-prod rules, why sign-out is global)
- `.claude/deep-knowledge/storage.md` — which data lives where (Supabase / R2 via Worker / Vercel / GitHub mirror), the 500 MB DB budget and codex retention, R2 cost guard, why no Redis yet
