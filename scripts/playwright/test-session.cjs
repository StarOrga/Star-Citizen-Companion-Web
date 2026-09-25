/**
 * Playwright-MCP init page: every browser Claude opens through the Playwright MCP
 * comes up signed in as the SC Companion test account — locally and live.
 *
 * Wiring: `.claude/settings.json` sets PLAYWRIGHT_MCP_INIT_PAGE to this file
 * (Playwright resolves it against the session's cwd) and PLAYWRIGHT_MCP_ISOLATED
 * to true — a fresh in-memory profile per launch, so no session is ever written
 * to disk and parallel sessions never fight over one profile directory. Without
 * that flag the MCP keeps one profile per worktree path, which is why every new
 * worktree used to start signed out. Playwright calls the default export in its
 * own Node process for every new tab, and awaits it before the first navigation.
 *
 * How: an init script runs in every document before the page's own scripts. On
 * an app origin (`isAppOrigin`) with nothing in `sc.auth` it asks for a session
 * with a SYNCHRONOUS request to `/__sc-test-session` — the app must not boot
 * before the session is in place. That request never reaches a server: the route
 * below answers it from Node with a session minted just now for that origin, so
 * no two origins or tabs share a refresh token (sharing one makes Supabase revoke
 * both at the first rotation). A second init script added from inside the route
 * handler would have been simpler, but `addInitScript` deadlocks while a
 * navigation request is held (verified 2026-09-25).
 *
 * Also seeded where nothing is stored yet: `sc.consent` = essential only, so the
 * banner never covers the page under test and the test account sends no analytics.
 *
 * No account configured → a logged no-op: the browser simply stays signed out.
 * The token never reaches the model — never read `sc.auth` via browser_evaluate.
 * Diagnostics: %TEMP%/sc-test-session.log. Rules: .claude/deep-knowledge/test-account.md
 */
'use strict';

const {
  APP_ORIGIN_RULES,
  isAppOrigin,
  log,
  maskEmail,
  mintSession,
  readSupabaseConfig,
  readTestAccount,
} = require('../lib/test-account.cjs');

const SESSION_PATH = '/__sc-test-session';
const SEEDED_FLAG = 'sc.test-session.seeded';

/** Runs inside the page before its own scripts — must stay self-contained. */
function seedStorage(args, isAppOrigin) {
  try {
    if (window.top !== window || !isAppOrigin(location.href, args.rules)) return;
    // Once per tab: a test that signs out and navigates on must stay signed out.
    if (sessionStorage.getItem(args.flag)) return;
    sessionStorage.setItem(args.flag, '1');
    if (localStorage.getItem('sc.auth')) return;
    const xhr = new XMLHttpRequest();
    xhr.open('GET', args.path, false);
    xhr.send();
    if (xhr.status !== 200) return;
    const seed = JSON.parse(xhr.responseText);
    localStorage.setItem('sc.auth', seed.session);
    if (!localStorage.getItem('sc.consent')) localStorage.setItem('sc.consent', seed.consent);
  } catch {
    /* storage or XHR unavailable — the page simply stays signed out */
  }
}

function seedScriptSource() {
  const args = { path: SESSION_PATH, flag: SEEDED_FLAG, rules: APP_ORIGIN_RULES };
  return `(${seedStorage})(${JSON.stringify(args)}, ${isAppOrigin});`;
}

/**
 * Only the app's own page may collect a session. This guard is load-bearing:
 * Playwright adds `access-control-allow-origin` to every fulfilled response
 * (`_maybeAddCorsHeaders`), so without it any site opened in the test browser
 * could fetch `http://127.0.0.1:4200/__sc-test-session` and read an admin
 * session (verified 2026-09-25: the foreign fetch got a readable status).
 */
function isSameOriginCaller(request, origin) {
  try {
    return new URL(request.frame().url()).origin === origin;
  } catch {
    return false; // no frame (service worker) or an unparsable URL
  }
}

function createTestSession({
  cwd = process.cwd(),
  readAccount = readTestAccount,
  readConfig = readSupabaseConfig,
  mint = mintSession,
  logLine = log,
} = {}) {
  const prepared = new WeakMap();

  async function prepare(context) {
    const config = readConfig(cwd);
    if (!config) {
      logLine(`skip: ${cwd} is not an SC Companion checkout`);
      return;
    }
    const account = readAccount();
    if (!account) {
      logLine('skip: no test account configured — browser stays signed out');
      return;
    }
    logLine(`ready: ${maskEmail(account.email)} from ${account.source}`);

    // Parallel requests from one origin share the sign-in in flight; a later
    // request (a new tab after a sign-out) gets a fresh session of its own.
    const inflight = new Map();
    const sessionFor = (origin) => {
      if (!inflight.has(origin)) {
        const pending = mint(config, account)
          .then((session) => {
            logLine(`signed in: ${origin}`);
            return session;
          })
          .catch((e) => {
            logLine(`sign-in failed for ${origin}: ${e.message}`);
            return null;
          })
          .finally(() => inflight.delete(origin));
        inflight.set(origin, pending);
      }
      return inflight.get(origin);
    };

    await context.route(
      (url) => url.pathname === SESSION_PATH && isAppOrigin(url),
      async (route) => {
        const origin = new URL(route.request().url()).origin;
        if (!isSameOriginCaller(route.request(), origin)) {
          logLine(`refused: session request for ${origin} from another origin`);
          return route.fulfill({ status: 403, headers: { 'cache-control': 'no-store' } });
        }
        const session = await sessionFor(origin);
        if (!session) return route.fulfill({ status: 204, headers: { 'cache-control': 'no-store' } });
        const consent = { preferences: false, statistics: false, decidedAt: new Date().toISOString() };
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'cache-control': 'no-store' },
          body: JSON.stringify({ session: JSON.stringify(session), consent: JSON.stringify(consent) }),
        });
      },
    );
    await context.addInitScript({ content: seedScriptSource() });
  }

  return async function testSession({ page }) {
    const context = page.context();
    if (!prepared.has(context)) {
      prepared.set(context, prepare(context).catch((e) => logLine(`error: ${e.message}`)));
    }
    await prepared.get(context);
  };
}

const testSession = createTestSession();

// Playwright loads init pages with `const { default: fn } = require(path)`.
module.exports = testSession;
module.exports.default = testSession;
module.exports.createTestSession = createTestSession;
module.exports.seedScriptSource = seedScriptSource;
module.exports.SESSION_PATH = SESSION_PATH;
