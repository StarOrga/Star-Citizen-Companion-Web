import { describe, expect, it } from 'vitest';
import {
  backoffMs,
  chunk,
  isShipFolder,
  mapLimit,
  packageExportArgs,
  planPackage,
  withRetry,
} from '../src/lib/asset-package.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const M = 'd'.repeat(64);

const ship = () => ({
  schemaVersion: 1,
  kind: 'ship',
  entity: { className: 'DRAK_Cutlass_Black' },
  root: { sha256: A, bytes: 1000 },
  interior: { sha256: B, bytes: 500 },
  parts: { [C]: { bytes: 200 } },
});

describe('isShipFolder', () => {
  it('rejects the exporter shared and scratch dirs', () => {
    for (const n of ['_parts', '_interiors', '_work_parts', '_fps', '_items', '_hulls', '.git', '']) {
      expect(isShipFolder(n)).toBe(false);
    }
    expect(isShipFolder('DRAK_Cutlass_Black')).toBe(true);
  });
});

describe('packageExportArgs', () => {
  it('always packages ships with interiors, fps only on request', () => {
    expect(packageExportArgs({})).toEqual(['--package', '--interior']);
    expect(packageExportArgs({ fps: true })).toEqual(['--package', '--interior', '--fps']);
    expect(packageExportArgs({ fps: true, items: true })).toEqual(['--package', '--interior', '--fps', '--items']);
  });
});

describe('planPackage', () => {
  it('lists parts, interior and the manifest last; the ship hull stays out', () => {
    const plan = planPackage(ship(), M, 90);
    expect(plan.kind).toBe('ship');
    expect(plan.entityClass).toBe('DRAK_Cutlass_Black');
    expect(plan.objects).toEqual([
      { type: 'part', sha256: C, bytes: 200 },
      { type: 'interior', sha256: B, bytes: 500 },
      { type: 'manifest', sha256: M, bytes: 90 },
    ]);
  });

  it('treats an fps root as a part, once', () => {
    const m = { ...ship(), kind: 'fps_weapon', interior: null, parts: { [A]: { bytes: 1000 }, [C]: { bytes: 200 } } };
    const plan = planPackage(m, M, 90);
    expect(plan.objects.filter((o) => o.sha256 === A)).toHaveLength(1);
    expect(plan.objects.map((o) => o.type)).toEqual(['part', 'part', 'manifest']);
  });

  it('treats an item root as a part', () => {
    const m = { ...ship(), kind: 'item', interior: null, parts: { [C]: { bytes: 200 } } };
    const plan = planPackage(m, M, 90);
    expect(plan.kind).toBe('item');
    expect(plan.objects.map((o) => o.type)).toEqual(['part', 'part', 'manifest']);
  });

  it('refuses what the server would refuse', () => {
    expect(() => planPackage({ ...ship(), schemaVersion: 2 }, M, 1)).toThrow(/schemaVersion/);
    expect(() => planPackage({ ...ship(), parts: { nothex: { bytes: 1 } } }, M, 1)).toThrow(/sha256/);
    expect(() => planPackage({ ...ship(), parts: { [C]: { bytes: 0 } } }, M, 1)).toThrow(/byte size/);
    expect(() => planPackage({ ...ship(), kind: 'vehicle' }, M, 1)).toThrow(/kind/);
    expect(() => planPackage(null, M, 1)).toThrow();
  });
});

describe('transport primitives', () => {
  it('chunks', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('mapLimit never exceeds the limit and visits everything', async () => {
    let live = 0;
    let peak = 0;
    const seen: number[] = [];
    await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      seen.push(n);
      live--;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('backs off exponentially, capped', () => {
    expect([0, 1, 2, 10].map(backoffMs)).toEqual([500, 1000, 2000, 8000]);
  });

  it('retries with backoff, then succeeds', async () => {
    const waits: number[] = [];
    let n = 0;
    const r = await withRetry(
      async () => {
        if (++n < 3) throw new Error('flaky');
        return 'ok';
      },
      { sleep: async (ms) => void waits.push(ms) },
    );
    expect(r).toBe('ok');
    expect(waits).toEqual([500, 1000]);
  });

  it('gives up after the retries and skips non-retryable errors', async () => {
    let n = 0;
    await expect(
      withRetry(async () => { n++; throw new Error('down'); }, { retries: 2, sleep: async () => {} }),
    ).rejects.toThrow('down');
    expect(n).toBe(3);
    let m = 0;
    await expect(
      withRetry(async () => { m++; throw new Error('fatal'); }, { retryable: () => false, sleep: async () => {} }),
    ).rejects.toThrow('fatal');
    expect(m).toBe(1);
  });
});
