// node --test supabase/functions/ingest-skins/_r2-usage.test.mjs
// Node 24 strips the TypeScript types of the imported .ts module on its own.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FREE_TIER,
  LIMIT_SHARE,
  USAGE_TTL_MS,
  classifyAction,
  isFresh,
  monthStart,
  overLimit,
  parseUsage,
  usageGate,
} from './_r2-usage.ts';

const body = (storage, ops) => ({ data: { viewer: { accounts: [{ storage, ops }] } } });

describe('classifyAction', () => {
  it('follows the official R2 class lists', () => {
    assert.equal(classifyAction('PutObject'), 'A');
    assert.equal(classifyAction('ListObjects'), 'A');
    assert.equal(classifyAction('GetObject'), 'B');
    assert.equal(classifyAction('HeadObject'), 'B');
    assert.equal(classifyAction('DeleteObject'), 'free');
  });
  it('counts an unknown action as Class A, the expensive side', () => {
    assert.equal(classifyAction('SomethingNew'), 'A');
    assert.equal(classifyAction(''), 'A');
  });
});

describe('parseUsage', () => {
  it('takes the newest storage row per bucket and sums the ops by class', () => {
    const u = parseUsage(
      body(
        [
          { max: { payloadSize: 300, metadataSize: 5 }, dimensions: { datetime: '2026-09-25T10:00:00Z', bucketName: 'a' } },
          { max: { payloadSize: 100, metadataSize: 1 }, dimensions: { datetime: '2026-09-24T10:00:00Z', bucketName: 'a' } },
          { max: { payloadSize: 50, metadataSize: 0 }, dimensions: { datetime: '2026-09-25T09:00:00Z', bucketName: 'b' } },
        ],
        [
          { sum: { requests: 400 }, dimensions: { actionType: 'PutObject' } },
          { sum: { requests: 10 }, dimensions: { actionType: 'ListObjects' } },
          { sum: { requests: 9000 }, dimensions: { actionType: 'GetObject' } },
          { sum: { requests: 70 }, dimensions: { actionType: 'DeleteObject' } },
        ],
      ),
    );
    assert.deepEqual(u, { storageBytes: 355, classA: 410, classB: 9000 });
  });
  it('reads an empty month as zero usage', () => {
    assert.deepEqual(parseUsage(body([], [])), { storageBytes: 0, classA: 0, classB: 0 });
  });
  it('throws on GraphQL errors and on an unexpected shape — unknown is never zero', () => {
    assert.throws(() => parseUsage({ errors: [{ message: 'not authorized' }] }), /analytics/);
    assert.throws(() => parseUsage({ data: { viewer: { accounts: [] } } }), /shape/);
    assert.throws(() => parseUsage(null), /shape/);
  });
});

describe('overLimit', () => {
  it('lets usage below every threshold through', () => {
    assert.equal(overLimit({ storageBytes: 1e9, classA: 1000, classB: 1000 }), null);
  });
  it('trips at LIMIT_SHARE of each allowance', () => {
    assert.match(overLimit({ storageBytes: FREE_TIER.storageBytes * LIMIT_SHARE, classA: 0, classB: 0 }), /storage/);
    assert.match(overLimit({ storageBytes: 0, classA: FREE_TIER.classA * LIMIT_SHARE, classB: 0 }), /class A/);
    assert.match(overLimit({ storageBytes: 0, classA: 0, classB: FREE_TIER.classB * LIMIT_SHARE }), /class B/);
  });
});

describe('monthStart', () => {
  it('is the first of the month in UTC', () => {
    assert.equal(monthStart(new Date('2026-09-25T13:45:00Z')), '2026-09-01T00:00:00.000Z');
    assert.equal(monthStart(new Date('2026-01-01T00:00:00Z')), '2026-01-01T00:00:00.000Z');
  });
});

describe('usageGate', () => {
  const H = 60 * 60 * 1000;
  const now = Date.UTC(2026, 8, 15, 12, 0, 0);
  const low = { storageBytes: 1e9, classA: 10, classB: 10 };
  const high = { storageBytes: FREE_TIER.storageBytes * LIMIT_SHARE, classA: 0, classB: 0 };

  it('a fresh reading under the limits signs', () => {
    assert.deepEqual(usageGate({ at: now, usage: low }, null, now), { kind: 'ok', stale: false });
  });
  it('a fresh reading over a limit refuses with the reason', () => {
    const g = usageGate({ at: now, usage: high }, null, now);
    assert.equal(g.kind, 'over');
    assert.equal(g.stale, false);
    assert.match(g.over, /^storage /);
  });
  it('a read error is bridged by a good reading 2 h old from the same month', () => {
    assert.deepEqual(usageGate({ at: now - 2 * H, usage: low }, 'analytics HTTP 502', now), { kind: 'ok', stale: true });
  });
  it('a reading 25 h old no longer decides', () => {
    assert.deepEqual(usageGate({ at: now - 25 * H, usage: low }, 'analytics HTTP 502', now), {
      kind: 'unknown',
      reason: 'analytics HTTP 502',
    });
  });
  it('a reading from last month never decides, even when only 2 h old', () => {
    const at = Date.UTC(2026, 7, 31, 23, 0, 0);
    const later = Date.UTC(2026, 8, 1, 1, 0, 0);
    assert.equal(usageGate({ at, usage: low }, 'timeout', later).kind, 'unknown');
  });
  it('a bridged reading over a limit still refuses', () => {
    const g = usageGate({ at: now - 2 * H, usage: high }, 'timeout', now);
    assert.equal(g.kind, 'over');
    assert.equal(g.stale, true);
  });
  it('a read error without any reading fails closed', () => {
    assert.deepEqual(usageGate(null, 'CF_ANALYTICS_TOKEN is not set', now), {
      kind: 'unknown',
      reason: 'CF_ANALYTICS_TOKEN is not set',
    });
  });
});

describe('isFresh', () => {
  const now = Date.UTC(2026, 8, 15, 12, 0, 0);
  const usage = { storageBytes: 0, classA: 0, classB: 0 };
  it('reuses a reading for 5 minutes', () => {
    assert.equal(USAGE_TTL_MS, 5 * 60 * 1000);
    assert.equal(isFresh({ at: now - (4 * 60 + 59) * 1000, usage }, now), true);
    assert.equal(isFresh({ at: now - (5 * 60 + 1) * 1000, usage }, now), false);
    assert.equal(isFresh(null, now), false);
  });
});
