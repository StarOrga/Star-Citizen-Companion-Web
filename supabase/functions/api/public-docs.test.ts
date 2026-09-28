// Tests for the public spec and docs page (openapi.ts, docs.ts). Both import
// _router.ts only as a type, which Node's type stripping erases, so this runs
// under Node 24's built-in test runner:
//   node --test public-docs.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPEC } from './openapi.ts';
import { serve } from './docs.ts';

const FUNCTION_BASE = 'https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/api';

test('the spec names the function as its server', () => {
  assert.equal(SPEC.servers[0].url, FUNCTION_BASE);
});

test('the docs page loads the spec relative to the function and embeds the function URL', async () => {
  const res = serve({ responseHeaders: new Headers() } as never);
  const html = await res.text();
  assert.match(html, /data-url="\.\/openapi\.json"/);
  assert.ok(html.includes('functions/v1/api/openapi.json'));
  assert.ok(!html.includes('sc-companion.vercel.app/openapi.json'));
});
