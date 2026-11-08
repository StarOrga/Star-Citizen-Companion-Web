import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSccRelease } from './_parse.ts';

test('reads version from the body and size from the .exe asset', () => {
  const r = parseSccRelease({
    body: 'Always the newest app (currently `v0.100.0`).',
    assets: [
      { name: 'latest.yml', size: 300 },
      { name: 'SCC-Standalone-Setup.exe', size: 104857600 },
    ],
  });
  assert.deepEqual(r, { version: 'v0.100.0', sizeBytes: 104857600 });
});

test('keeps a prerelease suffix', () => {
  assert.equal(parseSccRelease({ body: 'currently `v1.2.3-beta.1`' }).version, 'v1.2.3-beta.1');
});

test('nulls on a missing body, no .exe or garbage input', () => {
  assert.deepEqual(parseSccRelease({}), { version: null, sizeBytes: null });
  assert.deepEqual(parseSccRelease(null), { version: null, sizeBytes: null });
  assert.deepEqual(parseSccRelease({ body: 5, assets: 'x' }), { version: null, sizeBytes: null });
  assert.deepEqual(parseSccRelease({ assets: [{ name: 'a.exe', size: 'big' }] }), { version: null, sizeBytes: null });
});
