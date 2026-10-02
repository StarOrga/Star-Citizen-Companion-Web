// node --test supabase/functions/ingest-skins/_hulls.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HULLS_DIR,
  droppedHulls,
  hullPath,
  hullSha,
  isHullPath,
  isReservedShipId,
  MAX_HULL_BYTES,
  checkHull,
  modelPathFor,
  needsVerification,
  sha256Hex,
  shaOfHullPath,
} from './_hulls.ts';
import { createHash } from 'node:crypto';

const SHA = 'a'.repeat(64);
const SHA2 = 'b'.repeat(64);

describe('hullSha', () => {
  it('accepts only a lowercase 64-hex digest', () => {
    assert.equal(hullSha(SHA), SHA);
    assert.equal(hullSha('A'.repeat(64)), null);
    assert.equal(hullSha('a'.repeat(63)), null);
    assert.equal(hullSha(`../${'a'.repeat(61)}`), null);
    assert.equal(hullSha(undefined), null);
    assert.equal(hullSha(42), null);
  });
});

describe('paths', () => {
  it('puts a hashed model in the shared dir only when sharing is on', () => {
    assert.equal(modelPathFor('DRAK_Cutlass_Black', 'standard', SHA, true), `_hulls/${SHA}.glb`);
    assert.equal(modelPathFor('DRAK_Cutlass_Black', 'standard', SHA, false), 'DRAK_Cutlass_Black/standard.glb');
    assert.equal(modelPathFor('DRAK_Cutlass_Black', 'standard', null, true), 'DRAK_Cutlass_Black/standard.glb');
  });

  it('matches the asset worker key shape ship-skins/<seg>/<seg>.glb', () => {
    assert.match(`ship-skins/${hullPath(SHA)}`, /^ship-skins\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(glb|webp)$/);
    assert.ok(hullPath(SHA).startsWith(HULLS_DIR));
  });

  it('reserves underscore ship ids so a ship folder can never be _hulls', () => {
    assert.ok(isReservedShipId('_hulls'));
    assert.ok(!isReservedShipId('DRAK_Cutlass_Black'));
  });

  it('recognises only well-formed shared paths', () => {
    assert.ok(isHullPath(hullPath(SHA)));
    assert.ok(!isHullPath('DRAK_Cutlass_Black/standard.glb'));
    assert.ok(!isHullPath(`_hulls/${SHA}.webp`));
    assert.ok(!isHullPath(null));
  });
});

describe('droppedHulls', () => {
  it('lists shared hulls the ship no longer uses, never per-ship paths or kept ones', () => {
    const prev = [hullPath(SHA), hullPath(SHA2), hullPath(SHA2), 'S/standard.glb', null];
    assert.deepEqual(droppedHulls(prev, new Set([hullPath(SHA)])), [hullPath(SHA2)]);
    assert.deepEqual(droppedHulls(prev, new Set([hullPath(SHA), hullPath(SHA2)])), []);
  });
});

describe('commit-time hull verification', () => {
  const bytes = new TextEncoder().encode('glb-bytes');
  const sha = createHash('sha256').update('glb-bytes').digest('hex');
  const path = hullPath(sha);

  it('hashes like node:crypto and reads the hash back from the path', async () => {
    assert.equal(await sha256Hex(bytes), sha);
    assert.equal(shaOfHullPath(path), sha);
    assert.equal(shaOfHullPath('S/standard.glb'), null);
  });

  it('verifies only shared hulls no row references yet', () => {
    assert.ok(needsVerification(path, 0));
    assert.ok(!needsVerification(path, 3));
    assert.ok(!needsVerification(path, null));
    assert.ok(!needsVerification('S/standard.glb', 0));
  });

  it('accepts matching bytes and flags a mismatch', async () => {
    assert.equal(await checkHull(path, bytes.byteLength, async () => bytes), 'ok');
    assert.equal(await checkHull(hullPath(SHA), bytes.byteLength, async () => bytes), 'hash_mismatch');
  });

  it('refuses an oversized object without reading it', async () => {
    let read = false;
    const r = await checkHull(path, MAX_HULL_BYTES + 1, async () => {
      read = true;
      return bytes;
    });
    assert.equal(r, 'too_large');
    assert.equal(read, false);
    assert.equal(await checkHull(path, 10, async () => new Uint8Array(MAX_HULL_BYTES + 1)), 'too_large');
  });
});
