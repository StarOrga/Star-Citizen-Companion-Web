// node --test supabase/functions/nachschub-names/_cors.test.mjs
// The web app calls nachschub-names from the browser (functions.invoke). Without an OPTIONS answer and CORS headers
// the preflight fails (405) and every name silently falls back to the rule-based one - shipped that way in v0.226.0.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('nachschub-names CORS', () => {
  it('answers the preflight before the method check', () => {
    const options = src.indexOf("req.method === 'OPTIONS'");
    const notPost = src.indexOf("req.method !== 'POST'");
    assert.ok(options > -1, 'OPTIONS branch missing');
    assert.ok(options < notPost, 'OPTIONS must be handled before the POST-only guard');
  });

  it('sends CORS headers that allow the supabase-js invoke headers', () => {
    assert.match(src, /'Access-Control-Allow-Origin':\s*'\*'/);
    assert.match(src, /'Access-Control-Allow-Headers':\s*'authorization, x-client-info, apikey, content-type'/);
    assert.match(src, /'Access-Control-Allow-Methods':\s*'POST, OPTIONS'/);
    assert.match(src, /headers:\s*\{\s*'content-type':\s*'application\/json',\s*\.\.\.CORS\s*\}/);
  });
});
