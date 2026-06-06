import { describe, it, expect } from 'vitest';
import { syncServerCatalog, type SyncProgress } from '../src/lib/sync.js';

function mockFetch(status: number, body: unknown): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

const throwingFetch = (() => {
  throw new TypeError('offline');
}) as unknown as typeof fetch;

function row(over: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: 'id-' + Math.random().toString(36).slice(2),
    channel: 'live',
    patch_version: '4.0.0',
    build_number: '100',
    quality_score: 90,
    entity_counts: { ships: 10, items: 5 },
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

const base = { apiBase: 'https://api.test', anonKey: 'anon', accessToken: 'jwt' };

describe('syncServerCatalog', () => {
  it('builds a keep-latest snapshot grouped per channel', async () => {
    const rows = [
      row({ channel: 'live', patch_version: '4.0.0', created_at: '2026-01-01T00:00:00Z' }),
      row({ channel: 'live', patch_version: '4.1.0', created_at: '2026-02-01T00:00:00Z' }), // newer
      row({ channel: 'ptu', patch_version: '4.2.0', created_at: '2026-03-01T00:00:00Z' }),
    ];
    const r = await syncServerCatalog({ ...base, fetchImpl: mockFetch(200, rows), now: () => 1234 });
    expect(r.ok).toBe(true);
    expect(r.snapshot!.syncedAt).toBe(1234);
    expect(r.snapshot!.bundleCount).toBe(3);
    const live = r.snapshot!.channels.find((c) => c.channel === 'live');
    expect(live!.patchVersion).toBe('4.1.0'); // newest LIVE wins
    expect(live!.entityTotal).toBe(15); // 10 + 5
    expect(r.snapshot!.channels.map((c) => c.channel)).toEqual(['live', 'ptu']); // CHANNEL_ORDER
  });

  it('emits progress that ends at done/100', async () => {
    const events: SyncProgress[] = [];
    const r = await syncServerCatalog({
      ...base,
      fetchImpl: mockFetch(200, [row({})]),
      onProgress: (p) => events.push(p),
    });
    expect(r.ok).toBe(true);
    expect(events[0]?.phase).toBe('connecting');
    const last = events[events.length - 1];
    expect(last?.phase).toBe('done');
    expect(last?.pct).toBe(100);
    // A channel is folded in (drives the "parts build up").
    expect(events.some((e) => e.phase === 'processing' && e.channel)).toBe(true);
  });

  it('normalizes unknown channels', async () => {
    const r = await syncServerCatalog({
      ...base,
      fetchImpl: mockFetch(200, [row({ channel: 'WeIrD' })]),
    });
    expect(r.snapshot!.channels[0]?.channel).toBe('unknown');
  });

  it('handles an empty catalog', async () => {
    const r = await syncServerCatalog({ ...base, fetchImpl: mockFetch(200, []) });
    expect(r.ok).toBe(true);
    expect(r.snapshot!.channels).toEqual([]);
    expect(r.snapshot!.bundleCount).toBe(0);
  });

  it('fails cleanly on a non-OK response', async () => {
    const events: SyncProgress[] = [];
    const r = await syncServerCatalog({
      ...base,
      fetchImpl: mockFetch(403, { message: 'forbidden' }),
      onProgress: (p) => events.push(p),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('forbidden');
    expect(events[events.length - 1]?.phase).toBe('error');
  });

  it('surfaces a network error', async () => {
    const r = await syncServerCatalog({ ...base, fetchImpl: throwingFetch });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('offline');
  });
});
