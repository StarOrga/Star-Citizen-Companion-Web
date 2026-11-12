// Tests for the app-origin concept loader public/concept-frame.html (#330).
// Whatever the loader fetches is written into a document on the APP origin,
// so its allow-list is a security boundary: only our own Supabase project's
// concept-page function, for exactly the id in the loader's path. The inline
// script is pulled out of the html file and run in a node:vm context with a
// fake location/document/fetch:
//   node --test supabase/functions/concept-page/frame-loader.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/** The Deno parity run has no --allow-read; the loader lives outside the function, so only Node reads it. */
const readState = (globalThis as { Deno?: { permissions?: { querySync?: (d: { name: string }) => { state: string } } } })
  .Deno?.permissions?.querySync?.({ name: 'read' }).state;
const cannotRead = readState !== undefined && readState !== 'granted';
const SKIP = { skip: cannotRead && 'Deno run without --allow-read' };

const SCRIPT = (() => {
  if (cannotRead) return '';
  const html = readFileSync(fileURLToPath(new URL('../../../public/concept-frame.html', import.meta.url)), 'utf8');
  const m = /<script>([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('loader script not found');
  return m[1];
})();

const ID = '2e0b5a3c-9b1f-4c6e-8d1a-0f7e6c5b4a39';
const PROJECT = 'https://hcnqhvzlavdycidqyaai.supabase.co';
const GOOD = `${PROJECT}/functions/v1/concept-page/${ID}?t=YWJjLmRlZi4xMjM0LnNpZw`;
const APP = 'https://versecompanion-alpha.vercel.app';

interface FetchCall {
  url: string;
  init: Record<string, unknown>;
}

/** Runs the loader at `href` (path + hash); resolves after the fetch chain settled. */
async function run(href: string, body = '<html><body>ok</body></html>', resUrl?: string) {
  const loc = new URL(href);
  const fetched: FetchCall[] = [];
  const written: string[] = [];
  const msg = { textContent: '', attrs: {} as Record<string, string>, setAttribute(k: string, v: string) { this.attrs[k] = v; } };
  const ctx = vm.createContext({
    navigator: { language: 'en' },
    location: { pathname: loc.pathname, hash: loc.hash, hostname: loc.hostname, origin: loc.origin },
    document: {
      getElementById: () => msg,
      open: () => undefined,
      write: (s: string) => written.push(s),
      close: () => undefined,
    },
    URL,
    fetch: (url: string, init: Record<string, unknown>) => {
      fetched.push({ url, init });
      return Promise.resolve({ redirected: false, url: resUrl ?? url, text: () => Promise.resolve(body) });
    },
  });
  vm.runInContext(SCRIPT, ctx);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return { fetched, written, msg };
}

const frame = (src: string, host = APP, id = ID) => `${host}/concept-frame/${id}.html#${encodeURIComponent(src)}`;

test('loads our own project\'s concept-page document for the id in the path', SKIP, async () => {
  const env = await run(frame(GOOD));
  assert.equal(env.fetched.length, 1);
  assert.equal(env.fetched[0].url, GOOD);
  assert.equal(env.fetched[0].init.credentials, 'omit');
  assert.equal(env.fetched[0].init.redirect, 'error');
  assert.deepEqual(env.written, ['<html><body>ok</body></html>']);
});

test('refuses a foreign Supabase project (the review blocker)', SKIP, async () => {
  for (const host of [
    'https://attacker.supabase.co',
    'https://hcnqhvzlavdycidqyaai-evil.supabase.co',
    'https://evil.hcnqhvzlavdycidqyaai.supabase.co',
    'https://hcnqhvzlavdycidqyaai.supabase.co.evil.example',
    'https://hcnqhvzlavdycidqyaai.supabase.com',
    'http://hcnqhvzlavdycidqyaai.supabase.co',
  ]) {
    const env = await run(frame(`${host}/functions/v1/concept-page/${ID}?t=abc`));
    assert.equal(env.fetched.length, 0, host);
    assert.equal(env.written.length, 0, host);
    assert.equal(env.msg.attrs.role, 'alert', host);
  }
});

test('refuses userinfo, backslash and path tricks on the pinned host', SKIP, async () => {
  for (const src of [
    `https://hcnqhvzlavdycidqyaai.supabase.co@attacker.example/functions/v1/concept-page/${ID}?t=abc`,
    `https://attacker.example\\@hcnqhvzlavdycidqyaai.supabase.co/functions/v1/concept-page/${ID}?t=abc`,
    `https://attacker.example/x#https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/concept-page/${ID}?t=abc`,
    `${PROJECT}/functions/v1/concept-page/../other/${ID}?t=abc`,
    `${PROJECT}/functions/v1/other-fn/${ID}?t=abc`,
    `${PROJECT}/functions/v1/concept-page/${ID}?t=abc&redirect=https://attacker.example`,
    `${PROJECT}/functions/v1/concept-page/${ID}?t=abc#frag`,
    `${PROJECT}/functions/v1/concept-page/${ID}`,
    'javascript:alert(1)',
  ]) {
    const env = await run(frame(src));
    assert.equal(env.fetched.length, 0, src);
  }
});

test('refuses a document for a different concept id than the loader path', SKIP, async () => {
  const other = '11111111-2222-4333-8444-555555555555';
  const env = await run(frame(`${PROJECT}/functions/v1/concept-page/${other}?t=abc`));
  assert.equal(env.fetched.length, 0);
  const bad = await run(frame(GOOD, APP, 'not-a-uuid'));
  assert.equal(bad.fetched.length, 0);
});

test('a local Supabase stack is accepted only while the loader runs on localhost', SKIP, async () => {
  const local = `http://127.0.0.1:54321/functions/v1/concept-page/${ID}?t=abc`;
  const prod = await run(frame(local));
  assert.equal(prod.fetched.length, 0, 'never on the deployed app');
  const dev = await run(frame(local, 'http://127.0.0.1:4200'));
  assert.equal(dev.fetched.length, 1);
  const devForeign = await run(frame(`https://attacker.supabase.co/functions/v1/concept-page/${ID}?t=abc`, 'http://localhost:4200'));
  assert.equal(devForeign.fetched.length, 0, 'the pin holds on localhost too');
});

test('does not write a response that came from somewhere else, nor a non-html body', SKIP, async () => {
  const moved = await run(frame(GOOD), '<html>evil</html>', 'https://attacker.example/x');
  assert.equal(moved.written.length, 0);
  const json = await run(frame(GOOD), '{"error":"not_found"}');
  assert.equal(json.written.length, 0);
});

test('vercel.json pins the loader CSP to our project and the app frames only itself', SKIP, () => {
  const vercel = JSON.parse(readFileSync(fileURLToPath(new URL('../../../vercel.json', import.meta.url)), 'utf8')) as {
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };
  const cspOf = (source: string) =>
    vercel.headers.find((h) => h.source === source)?.headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
  const directive = (csp: string, name: string) =>
    csp.split(';').map((d) => d.trim().split(/\s+/)).find(([n]) => n === name)?.slice(1) ?? [];

  const loader = cspOf('/concept-frame/(.*)');
  assert.ok(loader, 'the loader has its own CSP');
  // The second layer behind the loader's allow-list: even a bypassed check
  // cannot fetch html from a foreign project.
  assert.deepEqual(directive(loader, 'connect-src'), ["'self'", PROJECT]);
  assert.ok(!loader.includes('*.supabase.co'), 'no wildcard Supabase origin in the loader CSP');
  assert.deepEqual(directive(loader, 'frame-ancestors'), ["'self'"]);

  const app = cspOf('/((?!concept-frame/).*)');
  assert.ok(app, 'the app rule excludes the loader path');
  assert.ok(!directive(app, 'frame-src').some((s) => s.includes('supabase.co')), 'the app frames no Supabase origin');
  assert.ok(directive(app, 'frame-src').includes("'self'"));
});
