import { RECENT_ROWS_KEY, StoredRow, dedupeRecentRows, readRecentRows, recentRowKey, rememberRow } from './search-recent-rows';

const target = { link: ['/codex'], queryParams: null, fragment: null } as unknown as StoredRow['target'];

function hitRow(kind: string, slug: string): StoredRow {
  return { type: 'hit', id: `hit-${kind}-${slug}`, hit: { kind, classNameSlug: slug, nameLocalized: slug }, target } as unknown as StoredRow;
}
function ownShip(id: string, slug: string): StoredRow {
  return { type: 'own', id: `own-ship-${id}`, ownKind: 'ship', title: slug, ownName: 'Nachtfalke', classNameSlug: slug, target } as unknown as StoredRow;
}
function ownSet(id: string): StoredRow {
  return { type: 'own', id: `own-set-${id}`, ownKind: 'set', title: 'Set', ownName: null, classNameSlug: null, target } as unknown as StoredRow;
}

describe('recent rows: one entry per class (AUD-17)', () => {
  it('keys a catalog hit and the reader\'s own ship of the same class alike', () => {
    expect(recentRowKey(hitRow('ship', 'ARGO_RAFT'))).toBe(recentRowKey(ownShip('7', 'argo-raft')));
    expect(recentRowKey(ownSet('1'))).toBe('own-set-1');
  });

  it('keeps the newest of a hit and "dein Schiff" and every unrelated row', () => {
    const list = [ownShip('7', 'argo_raft'), hitRow('ship', 'ARGO_RAFT'), hitRow('weapon', 'argo_raft'), ownSet('1')];
    const out = dedupeRecentRows(list);
    expect(out.map((r) => r.id)).toEqual(['own-ship-7', 'hit-weapon-argo_raft', 'own-set-1']);
  });

  it('rememberRow replaces the other row of the same ship when the page is opened', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } as unknown as Storage;
    const first = rememberRow(storage, [], hitRow('ship', 'ARGO_RAFT'));
    const next = rememberRow(storage, first, ownShip('7', 'argo_raft'));
    expect(next.map((r) => r.id)).toEqual(['own-ship-7']);
    expect(readRecentRows(storage).map((r) => r.id)).toEqual(['own-ship-7']);
    expect(store.has(RECENT_ROWS_KEY)).toBeTrue();
  });

  it('reading an old list that already holds both shows one', () => {
    const storage = {
      getItem: () => JSON.stringify([hitRow('ship', 'ARGO_RAFT'), ownShip('7', 'argo_raft')]),
      setItem: () => undefined,
    } as unknown as Storage;
    expect(readRecentRows(storage).length).toBe(1);
  });
});
