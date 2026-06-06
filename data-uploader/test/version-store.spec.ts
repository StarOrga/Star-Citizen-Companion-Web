import { describe, it, expect } from 'vitest';
import { VersionStore, type TextIO } from '../src/lib/version-store.js';
import type { CatalogSnapshot } from '../src/lib/sync.js';

function fakeIO(): TextIO {
  let data: string | null = null;
  return {
    read: () => data,
    write: (t) => {
      data = t;
    },
    remove: () => {
      data = null;
    },
  };
}

const snapA: CatalogSnapshot = {
  syncedAt: 100,
  bundleCount: 1,
  channels: [
    {
      channel: 'live',
      patchVersion: '4.0.0',
      buildNumber: '1',
      qualityScore: 90,
      entityTotal: 10,
      bundleId: 'a',
      createdAt: '2026-01-01T00:00:00Z',
    },
  ],
};

const snapB: CatalogSnapshot = { ...snapA, syncedAt: 200, bundleCount: 2 };

describe('VersionStore', () => {
  it('loads empty state when nothing is stored', () => {
    const s = new VersionStore(fakeIO()).load();
    expect(s.snapshot).toBeNull();
    expect(s.checkpoint).toBeNull();
  });

  it('persists and reloads a snapshot', () => {
    const store = new VersionStore(fakeIO());
    store.saveSnapshot(snapA);
    expect(store.load().snapshot).toEqual(snapA);
  });

  it('keeps only the latest snapshot (overwrites)', () => {
    const store = new VersionStore(fakeIO());
    store.saveSnapshot(snapA);
    store.saveSnapshot(snapB);
    expect(store.load().snapshot).toEqual(snapB);
  });

  it('saving a snapshot clears any in-flight checkpoint', () => {
    const store = new VersionStore(fakeIO());
    store.saveCheckpoint({ phase: 'fetching', pct: 20, updatedAt: 1 });
    store.saveSnapshot(snapA);
    expect(store.load().checkpoint).toBeNull();
  });

  it('remembers a checkpoint without dropping the last good snapshot', () => {
    const store = new VersionStore(fakeIO());
    store.saveSnapshot(snapA);
    store.saveCheckpoint({ phase: 'processing', pct: 60, updatedAt: 5 });
    const s = store.load();
    expect(s.snapshot).toEqual(snapA);
    expect(s.checkpoint).toEqual({ phase: 'processing', pct: 60, updatedAt: 5 });
  });

  it('falls back to empty on corrupt JSON', () => {
    const io = fakeIO();
    io.write('{not valid json');
    expect(new VersionStore(io).load().snapshot).toBeNull();
  });

  it('ignores an incompatible schema version', () => {
    const io = fakeIO();
    io.write(JSON.stringify({ v: 999, snapshot: snapA, checkpoint: null }));
    expect(new VersionStore(io).load().snapshot).toBeNull();
  });

  it('clears stored state', () => {
    const io = fakeIO();
    const store = new VersionStore(io);
    store.saveSnapshot(snapA);
    store.clear();
    expect(io.read()).toBeNull();
    expect(store.load().snapshot).toBeNull();
  });
});
