// Tests for shim.ts (#330). The shim is browser code kept as a string, so it
// runs here in a node:vm context with a fake window/location/fetch. Pure logic,
// no Deno APIs:
//   node --test supabase/functions/concept-page/shim.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildShim, shimSource, SHIM } from './shim.ts';

const ID = '2e0b5a3c-9b1f-4c6e-8d1a-0f7e6c5b4a39';
const BASE = `https://abc.supabase.co/functions/v1/concept-page/${ID}`;

/** Runs the shim in a fake browser at `href`; returns the patched fetch/beacon + call logs. */
function run(source: string, href: string) {
  const loc = new URL(href);
  const fetched: string[] = [];
  const beacons: string[] = [];
  const dataset: Record<string, string> = {};
  const window = {
    fetch: (input: unknown) => {
      fetched.push(typeof input === 'string' ? input : String((input as { url?: string }).url ?? input));
      return Promise.resolve('ok');
    },
  } as { fetch: (input: unknown, init?: unknown) => Promise<unknown> };
  const navigator = {
    sendBeacon: (url: string) => {
      beacons.push(url);
      return true;
    },
  } as { sendBeacon: (url: string, data?: unknown) => boolean };
  const ctx = vm.createContext({
    window,
    navigator,
    location: { origin: loc.origin === 'null' ? 'null' : loc.origin, pathname: loc.pathname, search: loc.search },
    document: { documentElement: { dataset } },
    URLSearchParams,
    URL,
    Request: class {
      url: string;
      constructor(url: string) {
        this.url = url;
      }
    },
  });
  vm.runInContext(source, ctx);
  return { window, navigator, fetched, beacons, dataset };
}

test('rewrites the bridge paths to the baked-in absolute function URL + ticket', () => {
  const env = run(shimSource({ base: BASE, ticket: 'tick+et' }), `https://app.example/concept-frame/${ID}.html#x`);
  env.window.fetch('/decisions');
  env.window.fetch('/reload?since=3');
  env.window.fetch('/heartbeat');
  env.window.fetch('/draft');
  assert.deepEqual(env.fetched, [
    `${BASE}/decisions?t=tick%2Bet`,
    `${BASE}/reload?since=3&t=tick%2Bet`,
    `${BASE}/heartbeat?t=tick%2Bet`,
    `${BASE}/draft?t=tick%2Bet`,
  ]);
  assert.equal(env.dataset.conceptHosted, '1');
});

test('rewrites the engine\'s absolute `location.origin + /heartbeat` too', () => {
  const env = run(shimSource({ base: BASE, ticket: 't1' }), `https://app.example/concept-frame/${ID}.html`);
  env.window.fetch('https://app.example/heartbeat?tab=a');
  assert.deepEqual(env.fetched, [`${BASE}/heartbeat?tab=a&t=t1`]);
});

test('leaves every other fetch untouched', () => {
  const env = run(shimSource({ base: BASE, ticket: 't1' }), `https://app.example/concept-frame/${ID}.html`);
  env.window.fetch('/i18n/de.json');
  env.window.fetch('https://other.example/decisions');
  env.window.fetch('/decisionsX');
  assert.deepEqual(env.fetched, ['/i18n/de.json', 'https://other.example/decisions', '/decisionsX']);
});

test('sendBeacon gets the same rewrite', () => {
  const env = run(shimSource({ base: BASE, ticket: 't1' }), `https://app.example/concept-frame/${ID}.html`);
  env.navigator.sendBeacon('/draft', '{}');
  env.navigator.sendBeacon('/elsewhere', '{}');
  assert.deepEqual(env.beacons, [`${BASE}/draft?t=t1`, '/elsewhere']);
});

test('without a baked-in base it falls back to the document location (pre-#330 form)', () => {
  const env = run(shimSource(null), `${BASE}?t=old`);
  env.window.fetch('/decisions');
  assert.deepEqual(env.fetched, [`${BASE}/decisions?t=old`]);
  assert.match(SHIM, /^<script data-concept-shim>/);
});

test('a hostile ticket cannot break out of the inline script', () => {
  const html = buildShim({ base: BASE, ticket: '</script><script>alert(1)</script>\u2028' });
  assert.equal(html.match(/<\/script>/g)?.length, 1, 'only the closing tag of the shim itself');
  assert.ok(!html.includes('\u2028'));
  const env = run(shimSource({ base: BASE, ticket: '</script>' }), `https://app.example/x.html`);
  env.window.fetch('/reload');
  assert.deepEqual(env.fetched, [`${BASE}/reload?t=${encodeURIComponent('</script>')}`]);
});
