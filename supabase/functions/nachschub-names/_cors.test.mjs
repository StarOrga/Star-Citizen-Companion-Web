// node --test supabase/functions/nachschub-names/_cors.test.mjs
// The web app calls nachschub-names from the browser (functions.invoke). Without an OPTIONS answer and CORS headers
// the preflight fails (405) and every name silently falls back to the rule-based one - shipped that way in v0.226.0.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CORS, preflight } from './_names.ts';

describe('nachschub-names CORS', () => {
  it('answers the preflight with 2xx and the CORS headers', () => {
    const res = preflight('OPTIONS');
    assert.ok(res, 'OPTIONS must be answered');
    assert.ok(res.status >= 200 && res.status < 300);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  });

  it('allows every header supabase-js invoke sends', () => {
    const allowed = CORS['Access-Control-Allow-Headers'].split(',').map((h) => h.trim());
    for (const h of ['authorization', 'x-client-info', 'apikey', 'content-type']) assert.ok(allowed.includes(h), h);
  });

  it('leaves real requests to the handler', () => {
    assert.equal(preflight('POST'), null);
  });
});
