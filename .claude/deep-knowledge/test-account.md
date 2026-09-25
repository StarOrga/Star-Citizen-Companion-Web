# Test account — signed-in browsers for Claude

Almost every route sits behind `authGuard` + `approvedGuard`, so a signed-out
browser proves nothing beyond `/login` and `/about`. This is how Claude gets a
signed-in browser, locally and live, without ever touching a password.

## Why it is built this way

- **Claude never types a password and never creates an account** — a hard rule
  on the model's side, not something a prompt can lift. The account is created
  and its password stored by the admin; only scripts read it.
- **The admin's own session cannot be shared.** Supabase rotates the refresh
  token on every refresh and, when a rotated token is presented again, revokes
  the whole session family. Two browsers holding one copied session log each
  other out — the admin included — within the hour.
- **Playwright's default profile is per worktree.** The Playwright MCP keeps one
  persistent profile per working directory
  (`%LOCALAPPDATA%\ms-playwright-mcp\mcp-chrome-<sha256(cwd)[0:7]>`), so every new
  worktree started signed out — dozens of those directories piled up.

## How it works

`.claude/settings.json` → `env`:

| Variable | Value | Effect |
|---|---|---|
| `PLAYWRIGHT_MCP_INIT_PAGE` | `scripts/playwright/test-session.cjs` | Node module Playwright runs for every new tab, resolved against the session's cwd |
| `PLAYWRIGHT_MCP_ISOLATED` | `true` | in-memory profile per launch: no session on disk, parallel sessions never share a profile |

Verified 2026-09-25 with a headless `claude -p` session: settings `env` reaches
the plugin's Playwright MCP server, and the relative path resolves in the
checkout. The server reads it at startup, so a change takes effect with the
**next** session.

Per browser context the init page reads the credential once (~1 s for the
Credential Manager), then:

1. adds an init script that, on an app origin with no `sc.auth` yet, fetches
   `/__sc-test-session` **synchronously** — before any app script runs;
2. answers that path from a Playwright route (the request never reaches a server)
   with a session minted right then for that origin;
3. the init script writes `sc.auth` and — if nothing is stored — `sc.consent` =
   essential only (no banner over the page, no analytics from the test account).

Each origin gets its own session, and so does a new tab after a sign-out, so no
refresh token is ever shared. It is seeded once per tab: a tab that signs out
stays signed out.

App origins (`APP_ORIGIN_RULES` in `scripts/lib/test-account.cjs`):
`http://127.0.0.1|localhost` on ports 4200–4399, `https://sc-companion.vercel.app`,
`https://star-citizen-companion-website*.vercel.app` (previews).

A second init script added from inside the route handler looks simpler, but
`addInitScript` deadlocks while a navigation request is held.

## One-time setup (admin)

1. `/admin` → **Registrieren**: enter the test email, role **admin** (decided
   2026-09-25 — admin sees every surface and can "view as" any lower role).
2. Create the user: Supabase Dashboard → Authentication → Users → **Add user** →
   email + password, **Auto Confirm User** on. `handle_new_user()` finds the
   allowlist row and approves the account with that role.
3. Store the credential (hidden password prompt, nothing lands in the repo):
   ```
   cmdkey /generic:sc-companion/test-account /user:<email> /pass
   ```
4. `npm run test-account` → `role admin · approved` and `✓ Ready`.

Other sources, first match wins: `SC_TEST_EMAIL`/`SC_TEST_PASSWORD`, then the
legacy `SC_GATE_EMAIL`/`SC_GATE_PASSWORD`, then the Credential Manager entry.
`npm run gate:mobile:auth` uses the same account.

## Rules for Claude

- **Never read `sc.auth`** (`browser_evaluate`, storage dumps) — the token stays
  out of the transcript.
- **It is an admin on production data.** `npm start` talks to the cloud project
  too, so "local" is live data. Deleting, suspending, replying to feedback,
  inviting or anything else irreversible or outward-facing needs the admin's
  explicit OK per action — like any other irreversible click.
- **Sign-out is global.** `AuthService.signOut()` uses Supabase's default scope,
  which revokes *every* session of the account: every parallel Claude browser
  drops at its next token refresh. Only test sign-out when asked; afterwards
  `browser_close` and navigate again for a fresh session.
- **Came up signed out?** Read `%TEMP%\sc-test-session.log` (`ready` / `skip` /
  `signed in` / `sign-in failed`), run `npm run test-account`, then
  `browser_close` and navigate again. A session that started before this was
  merged has no init page at all — the MCP read its env at startup.
- **The Desktop Browser pane is separate.** `mcp__Claude_Browser__*` keeps its own
  storage per origin — today the admin's own session on `127.0.0.1:4200`. The
  admin can sign in once on `sc-companion.vercel.app` there for pane checks on
  live. The devops browsertest gate still only recognises Playwright.

## Limits

- Vercel's Security Checkpoint may challenge an automated Chrome on live or on
  previews; then verify against a local dev server or `--base-url` build.
- Each browser launch adds a row to `auth.sessions` per origin it visits, and on
  the free plan sessions never time out. A few KB a day — if it ever shows in the
  DB budget (`storage.md`), prune stale ones:
  `delete from auth.sessions where user_id = '<test user id>' and coalesce(refreshed_at, updated_at) < now() - interval '1 day';`
