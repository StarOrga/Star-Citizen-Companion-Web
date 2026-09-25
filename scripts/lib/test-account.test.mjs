/**
 * Tests for the test-account plumbing: scripts/lib/test-account.cjs and the
 * Playwright-MCP init page scripts/playwright/test-session.cjs.
 * Run: npm run test:gate
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const lib = require('./test-account.cjs');
const initPage = require('../playwright/test-session.cjs');
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('isAppOrigin', () => {
  const yes = [
    'http://127.0.0.1:4200/news',
    'http://localhost:4310/',
    'http://127.0.0.1:4399',
    'https://sc-companion.vercel.app/codex',
    'https://star-citizen-companion-website.vercel.app/',
    'https://star-citizen-companion-website-git-feat-x-someteam.vercel.app/',
  ];
  const no = [
    'http://127.0.0.1:4400/',
    'http://127.0.0.1:4199/',
    'http://localhost/',
    'https://localhost:4200/',
    'http://sc-companion.vercel.app/',
    'https://evil-sc-companion.vercel.app/',
    'https://sc-companion.vercel.app.evil.test/',
    'https://example.test/',
    'about:blank',
    'not a url',
  ];
  for (const url of yes) it(`accepts ${url}`, () => assert.equal(lib.isAppOrigin(url), true));
  for (const url of no) it(`rejects ${url}`, () => assert.equal(lib.isAppOrigin(url), false));

  it('accepts URL objects', () => assert.equal(lib.isAppOrigin(new URL('http://127.0.0.1:4200/')), true));

  it('survives being injected by source, as the init page does', () => {
    const injected = new Function(`return (${lib.isAppOrigin})`)();
    assert.equal(injected('http://127.0.0.1:4200/', lib.APP_ORIGIN_RULES), true);
    assert.equal(injected('https://example.test/', lib.APP_ORIGIN_RULES), false);
  });
});

describe('readSupabaseConfig', () => {
  it('reads url and publishable key from the app environment', () => {
    const config = lib.readSupabaseConfig(REPO_ROOT);
    assert.match(config.url, /^https:\/\/[a-z0-9]+\.supabase\.co$/);
    assert.match(config.publishableKey, /^sb_publishable_/);
  });

  it('returns null outside a checkout', () => assert.equal(lib.readSupabaseConfig(tmpdir()), null));
});

describe('readTestAccount', () => {
  const read = (env) => lib.readTestAccount({ env, credentialManager: false });

  it('prefers SC_TEST_*', () => {
    const account = read({
      SC_TEST_EMAIL: 'a@example.test',
      SC_TEST_PASSWORD: 'x',
      SC_GATE_EMAIL: 'b@example.test',
      SC_GATE_PASSWORD: 'y',
    });
    assert.deepEqual(account, { email: 'a@example.test', password: 'x', source: 'env SC_TEST_EMAIL' });
  });

  it('falls back to the legacy SC_GATE_* names', () => {
    const account = read({ SC_TEST_EMAIL: 'a@example.test', SC_GATE_EMAIL: 'b@example.test', SC_GATE_PASSWORD: 'y' });
    assert.equal(account.email, 'b@example.test');
  });

  it('returns null when nothing complete is configured', () => {
    assert.equal(read({ SC_TEST_EMAIL: 'a@example.test' }), null);
    assert.equal(read({}), null);
  });
});

describe('decodeCredentialBlob', () => {
  it('decodes UTF-16LE as written by cmdkey', () => {
    assert.equal(lib.decodeCredentialBlob(Buffer.from('pässwörd-42', 'utf16le')), 'pässwörd-42');
  });
  it('decodes UTF-8 as written by Go keyrings', () => {
    assert.equal(lib.decodeCredentialBlob(Buffer.from('secret-token', 'utf8')), 'secret-token');
    assert.equal(lib.decodeCredentialBlob(Buffer.from('pässwort', 'utf8')), 'pässwort');
  });
  it('handles an empty blob', () => assert.equal(lib.decodeCredentialBlob(Buffer.alloc(0)), ''));
});

describe('toStoredSession', () => {
  const token = { access_token: 'a', token_type: 'bearer', expires_in: 3600, refresh_token: 'r', user: { id: 'u' } };
  it('derives expires_at when the server omits it', () => {
    assert.equal(lib.toStoredSession(token, 1000).expires_at, 4600);
  });
  it('keeps the server expires_at', () => {
    assert.equal(lib.toStoredSession({ ...token, expires_at: 42 }, 1000).expires_at, 42);
  });
});

describe('mintSession', () => {
  const config = { url: 'https://proj.supabase.co', publishableKey: 'sb_publishable_x' };
  const account = { email: 'a@example.test', password: 'hunter22' };

  it('uses the password grant and returns the stored-session shape', async () => {
    let seen;
    const fetchImpl = async (url, init) => {
      seen = { url, init };
      return new Response(
        JSON.stringify({ access_token: 'at', token_type: 'bearer', expires_in: 3600, refresh_token: 'rt', user: { id: 'u' } }),
        { status: 200 },
      );
    };
    const session = await lib.mintSession(config, account, { fetchImpl });
    assert.equal(seen.url, 'https://proj.supabase.co/auth/v1/token?grant_type=password');
    assert.equal(seen.init.headers.apikey, 'sb_publishable_x');
    assert.deepEqual(JSON.parse(seen.init.body), { email: 'a@example.test', password: 'hunter22' });
    assert.deepEqual(Object.keys(session).sort(), [
      'access_token',
      'expires_at',
      'expires_in',
      'refresh_token',
      'token_type',
      'user',
    ]);
  });

  it('throws the server reason without echoing the password', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid login credentials' }), {
        status: 400,
      });
    await assert.rejects(lib.mintSession(config, account, { fetchImpl }), (e) => {
      assert.match(e.message, /HTTP 400.*Invalid login credentials/);
      assert.doesNotMatch(e.message, /hunter22/);
      return true;
    });
  });
});

describe('maskEmail', () => {
  it('keeps the domain and two characters', () => assert.equal(lib.maskEmail('claude-test@example.test'), 'cl***@example.test'));
  it('masks garbage entirely', () => assert.equal(lib.maskEmail('nope'), '***'));
});

/** Runs the init page's injected seed script against a fake window. */
function runSeed({ href, stored = {}, flagged = false, xhr = { status: 200, body: null } }) {
  const local = new Map(Object.entries(stored));
  const session = new Map(flagged ? [['sc.test-session.seeded', '1']] : []);
  const storage = (m) => ({ getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) });
  const requests = [];
  class FakeXhr {
    open(method, path, async) {
      requests.push({ method, path, async });
    }
    send() {
      this.status = xhr.status;
      this.responseText = xhr.body;
    }
  }
  const sandbox = {
    location: new URL(href),
    localStorage: storage(local),
    sessionStorage: storage(session),
    XMLHttpRequest: FakeXhr,
    URL,
    RegExp,
    Number,
    String,
    JSON,
  };
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  vm.runInNewContext(initPage.seedScriptSource(), sandbox);
  return { local, session, requests };
}

describe('seed script (runs in the page)', () => {
  const body = JSON.stringify({ session: '{"access_token":"at"}', consent: '{"preferences":false}' });

  it('fetches a session synchronously and stores it before the app boots', () => {
    const { local, requests } = runSeed({ href: 'http://127.0.0.1:4200/news', xhr: { status: 200, body } });
    assert.deepEqual(requests, [{ method: 'GET', path: initPage.SESSION_PATH, async: false }]);
    assert.equal(local.get('sc.auth'), '{"access_token":"at"}');
    assert.equal(local.get('sc.consent'), '{"preferences":false}');
  });

  it('never asks a foreign origin', () => {
    const { local, requests } = runSeed({ href: 'https://example.test/', xhr: { status: 200, body } });
    assert.equal(requests.length, 0);
    assert.equal(local.size, 0);
  });

  it('leaves an existing session and consent alone', () => {
    const { local, requests } = runSeed({
      href: 'http://127.0.0.1:4200/',
      stored: { 'sc.auth': 'mine', 'sc.consent': 'mine' },
      xhr: { status: 200, body },
    });
    assert.equal(requests.length, 0);
    assert.equal(local.get('sc.auth'), 'mine');
  });

  it('seeds a tab only once, so a signed-out tab stays signed out', () => {
    const { requests } = runSeed({ href: 'http://127.0.0.1:4200/', flagged: true, xhr: { status: 200, body } });
    assert.equal(requests.length, 0);
  });

  it('stays signed out when no session is available', () => {
    const { local } = runSeed({ href: 'http://127.0.0.1:4200/', xhr: { status: 204, body: '' } });
    assert.equal(local.has('sc.auth'), false);
  });
});

/** A fake BrowserContext recording what the init page registers. */
function fakeContext() {
  const ctx = { routes: [], initScripts: [] };
  ctx.route = async (predicate, handler) => ctx.routes.push({ predicate, handler });
  ctx.addInitScript = async (script) => ctx.initScripts.push(script);
  return ctx;
}

function fakeRoute(url, callerUrl = url) {
  const route = { fulfilled: null };
  route.request = () => ({ url: () => url, frame: () => ({ url: () => callerUrl }) });
  route.fulfill = async (response) => {
    route.fulfilled = response;
  };
  return route;
}

describe('createTestSession (the init page)', () => {
  const config = { url: 'https://proj.supabase.co', publishableKey: 'k' };
  const account = { email: 'claude-test@example.test', password: 'p', source: 'fake' };

  function setup({ readAccount = () => account, mint } = {}) {
    const lines = [];
    let mints = 0;
    const init = initPage.createTestSession({
      cwd: 'x',
      readConfig: () => config,
      readAccount,
      mint:
        mint ??
        (async () => {
          mints++;
          await new Promise((r) => setTimeout(r, 10));
          return { access_token: `at${mints}`, refresh_token: `rt${mints}` };
        }),
      logLine: (l) => lines.push(l),
    });
    const context = fakeContext();
    const page = { context: () => context };
    return { init, context, page, lines, mints: () => mints };
  }

  it('is a no-op without an account', async () => {
    const { init, context, page, lines } = setup({ readAccount: () => null });
    await init({ page });
    assert.equal(context.routes.length, 0);
    assert.equal(context.initScripts.length, 0);
    assert.match(lines[0], /no test account/);
  });

  it('prepares each browser context once', async () => {
    const { init, context, page } = setup();
    await init({ page });
    await init({ page });
    assert.equal(context.routes.length, 1);
    assert.equal(context.initScripts.length, 1);
  });

  it('answers only the session path on app origins', async () => {
    const { init, context, page } = setup();
    await init({ page });
    const { predicate } = context.routes[0];
    assert.equal(predicate(new URL(`http://127.0.0.1:4200${initPage.SESSION_PATH}`)), true);
    assert.equal(predicate(new URL('http://127.0.0.1:4200/news')), false);
    assert.equal(predicate(new URL(`https://example.test${initPage.SESSION_PATH}`)), false);
  });

  it('shares one sign-in between parallel requests, then mints fresh', async () => {
    const { init, context, page, mints } = setup();
    await init({ page });
    const { handler } = context.routes[0];
    const url = `http://127.0.0.1:4200${initPage.SESSION_PATH}`;
    const [a, b] = [fakeRoute(url), fakeRoute(url)];
    await Promise.all([handler(a), handler(b)]);
    assert.equal(mints(), 1);
    assert.equal(a.fulfilled.status, 200);
    assert.equal(JSON.parse(JSON.parse(a.fulfilled.body).session).access_token, 'at1');
    assert.equal(JSON.parse(a.fulfilled.body).session, JSON.parse(b.fulfilled.body).session);

    const c = fakeRoute(url);
    await handler(c);
    assert.equal(mints(), 2);
    assert.equal(JSON.parse(JSON.parse(c.fulfilled.body).session).access_token, 'at2');
  });

  it('refuses a session request from another origin without signing in', async () => {
    const { init, context, page, mints } = setup();
    await init({ page });
    const route = fakeRoute(`http://127.0.0.1:4200${initPage.SESSION_PATH}`, 'https://example.test/attack');
    await context.routes[0].handler(route);
    assert.equal(route.fulfilled.status, 403);
    assert.equal(mints(), 0);
  });

  it('answers 204 when the sign-in fails', async () => {
    const { init, context, page, lines } = setup({
      mint: async () => {
        throw new Error('sign-in refused (HTTP 400): Invalid login credentials');
      },
    });
    await init({ page });
    const route = fakeRoute(`http://127.0.0.1:4200${initPage.SESSION_PATH}`);
    await context.routes[0].handler(route);
    assert.equal(route.fulfilled.status, 204);
    assert.ok(lines.some((l) => /sign-in failed for http:\/\/127\.0\.0\.1:4200/.test(l)));
  });
});
