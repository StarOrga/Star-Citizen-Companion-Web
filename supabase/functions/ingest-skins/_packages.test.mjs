// node --test supabase/functions/ingest-skins/_packages.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  CLASS_NAME,
  MAX_BYTES,
  checkManifestBytes,
  isPackageKind,
  packagePath,
  parseManifest,
  parseObject,
} from './_packages.ts';

const SHA = 'a'.repeat(64);
const SHA2 = 'b'.repeat(64);
const SHA3 = 'c'.repeat(64);
const enc = (o) => new TextEncoder().encode(JSON.stringify(o));
const sha = (b) => createHash('sha256').update(b).digest('hex');

const shipManifest = () => ({
  schemaVersion: 1,
  kind: 'ship',
  entity: { className: 'DRAK_Cutlass_Black', guid: 'x' },
  root: { sha256: SHA, bytes: 1000 },
  interior: { sha256: SHA2, bytes: 500 },
  parts: { [SHA3]: { bytes: 200 } },
});

describe('packagePath', () => {
  it('maps each type to its content-addressed directory', () => {
    assert.equal(packagePath('part', SHA), `_parts/${SHA}.glb`);
    assert.equal(packagePath('interior', SHA), `_interiors/${SHA}.glb`);
    assert.equal(packagePath('manifest', SHA), `_manifests/${SHA}.json`);
    assert.equal(packagePath('hull', SHA), `_hulls/${SHA}.glb`);
  });
});

describe('parseObject', () => {
  it('accepts a well-formed object', () => {
    assert.deepEqual(parseObject({ type: 'part', sha256: SHA, bytes: 10 }), {
      type: 'part',
      sha: SHA,
      bytes: 10,
      path: `_parts/${SHA}.glb`,
    });
  });
  it('rejects traversal, uppercase, hull type, bad sizes', () => {
    for (const o of [
      { type: 'part', sha256: '../x', bytes: 1 },
      { type: 'part', sha256: SHA.toUpperCase(), bytes: 1 },
      { type: 'hull', sha256: SHA, bytes: 1 },
      { type: 'part', sha256: SHA, bytes: 0 },
      { type: 'part', sha256: SHA, bytes: 1.5 },
      { type: 'part', sha256: SHA, bytes: '5' },
      { type: 'part', sha256: SHA, bytes: MAX_BYTES.part + 1 },
      { type: 'manifest', sha256: SHA, bytes: MAX_BYTES.manifest + 1 },
    ]) {
      assert.equal(typeof parseObject(o), 'string', JSON.stringify(o));
    }
  });
});

describe('class names and kinds', () => {
  it('only safe identifiers', () => {
    assert.ok(CLASS_NAME.test('behr_rifle_ballistic_01'));
    assert.ok(!CLASS_NAME.test('../a'));
    assert.ok(!CLASS_NAME.test('a/b'));
    assert.ok(!CLASS_NAME.test(''));
    assert.ok(isPackageKind('fps_weapon') && !isPackageKind('vehicle'));
  });
});

describe('parseManifest', () => {
  it('derives refs for a ship (hull counted, not a part)', () => {
    const r = parseManifest(shipManifest());
    assert.equal(r.rootSha, SHA);
    assert.equal(r.interiorSha, SHA2);
    assert.equal(r.partCount, 1);
    assert.equal(r.totalBytes, 1700);
  });
  it('an fps root is a part', () => {
    const m = { ...shipManifest(), kind: 'fps_weapon', interior: null };
    const r = parseManifest(m);
    assert.deepEqual(r.parts.map((p) => p.sha).sort(), [SHA, SHA3]);
    assert.equal(r.totalBytes, 1200);
  });
  it('refuses unknown schema, bad class and malformed refs', () => {
    assert.equal(typeof parseManifest({ ...shipManifest(), schemaVersion: 2 }), 'string');
    assert.equal(typeof parseManifest({ ...shipManifest(), entity: { className: '../x' } }), 'string');
    assert.equal(typeof parseManifest({ ...shipManifest(), root: { sha256: 'zz', bytes: 1 } }), 'string');
    assert.equal(typeof parseManifest({ ...shipManifest(), parts: { nothex: { bytes: 1 } } }), 'string');
    assert.equal(typeof parseManifest(null), 'string');
  });
  it('tolerates a package without root or interior', () => {
    const r = parseManifest({ ...shipManifest(), root: null, interior: null, parts: {} });
    assert.equal(r.rootSha, null);
    assert.equal(r.partCount, 0);
  });
});

describe('checkManifestBytes', () => {
  it('ok when hash, kind and entity match', async () => {
    const b = enc(shipManifest());
    const r = await checkManifestBytes(b, sha(b), 'ship', 'DRAK_Cutlass_Black');
    assert.equal(r.ok, true);
  });
  it('hash mismatch, wrong entity, not JSON, too large', async () => {
    const b = enc(shipManifest());
    assert.equal((await checkManifestBytes(b, SHA, 'ship', 'DRAK_Cutlass_Black')).error, 'manifest_hash_mismatch');
    assert.equal((await checkManifestBytes(b, sha(b), 'ship', 'ANVL_Arrow')).error, 'manifest_mismatch');
    assert.equal((await checkManifestBytes(b, sha(b), 'fps_weapon', 'DRAK_Cutlass_Black')).error, 'manifest_mismatch');
    const junk = new TextEncoder().encode('{nope');
    assert.equal((await checkManifestBytes(junk, sha(junk), 'ship', 'x')).error, 'manifest_invalid');
    const big = new Uint8Array(MAX_BYTES.manifest + 1);
    assert.equal((await checkManifestBytes(big, sha(big), 'ship', 'x')).error, 'manifest_too_large');
  });
});
