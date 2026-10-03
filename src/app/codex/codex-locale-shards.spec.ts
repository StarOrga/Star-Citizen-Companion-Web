import { TestBed } from '@angular/core/testing';
import {
  CodexLocaleShards,
  LOCALE_SHARD_BASE,
  LOCALE_SHARD_FETCH,
  LocaleIndex,
  fnv1a,
  shardFor,
} from './codex-locale-shards';

const BUILD = 'a3fb1249-9115-4035-9039-2ffc6043d832';
const BASE = 'https://assets.test';
const DIR = `${BASE}/codex-locale/${BUILD}/en/`;

// Same vectors as supabase/functions/ingest-catalog/_locale.test.mjs — the
// writer and this reader must place every key in the same shard.
const GOLDEN_INDEX = { groups: { ui: 3, item: 26 }, misc: 4 };
const GOLDEN: [string, number, string][] = [
  ['ui_CIEmergencyExitDescription_0', 1092807338, 'ui-2'],
  ['item_NameAEGS_Gladius', 39184882, 'item-22'],
  ['pu_foo', 2054069677, '_misc-1'],
  ['Human_First_Names_M_0602', 325737125, '_misc-1'],
  ['weird-key.x', 134492222, '_misc-2'],
  ['ä_umlaut', 591518336, '_misc-0'],
];

const INDEX: LocaleIndex = { v: 1, build_id: BUILD, lang: 'en', gen: 'mgaq1z2k', count: 4, groups: { ui: 2 }, misc: 1 };

/** Every shard the fake Worker holds, built with the real lookup. */
function shardsFor(entries: Record<string, string>): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const [k, v] of Object.entries(entries)) {
    const url = `${DIR}${INDEX.gen}/${shardFor(INDEX, k)}.json`;
    out.set(url, { ...(out.get(url) ?? {}), [k]: v });
  }
  return out;
}

const ENTRIES = { ui_a: 'A', ui_b: 'B', ui_c: 'C', 'dlg_x': 'X' };

function setup(
  handler: (url: string) => Response | Promise<Response>,
  base = BASE,
): { svc: CodexLocaleShards; calls: string[] } {
  const calls: string[] = [];
  const fetchFn = (async (url: string) => {
    calls.push(url);
    return handler(url);
  }) as unknown as typeof fetch;
  TestBed.configureTestingModule({
    providers: [
      { provide: LOCALE_SHARD_FETCH, useValue: fetchFn },
      { provide: LOCALE_SHARD_BASE, useValue: base },
    ],
  });
  return { svc: TestBed.inject(CodexLocaleShards), calls };
}

function worker(shards = shardsFor(ENTRIES), index: unknown = INDEX) {
  return (url: string) => {
    if (url === `${DIR}index.json`) return Response.json(index);
    const shard = shards.get(url);
    return shard ? Response.json(shard) : new Response('not found', { status: 404 });
  };
}

describe('CodexLocaleShards', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('places keys exactly like the ingest-catalog writer (golden vectors)', () => {
    for (const [key, hash, shard] of GOLDEN) {
      expect(fnv1a(key)).withContext(key).toBe(hash);
      expect(shardFor(GOLDEN_INDEX, key)).withContext(key).toBe(shard);
    }
  });

  it('fetches the index once and each needed shard once', async () => {
    const { svc, calls } = setup(worker());

    const out = await svc.resolve(BUILD, 'en', ['ui_a', 'ui_b', 'ui_c', 'dlg_x']);

    expect(out && Object.fromEntries(out)).toEqual(ENTRIES);
    const shardCalls = calls.filter((c) => !c.endsWith('index.json'));
    expect(calls.filter((c) => c.endsWith('index.json')).length).toBe(1);
    expect(new Set(shardCalls).size).toBe(shardCalls.length);
    expect(shardCalls.length).toBe(shardsFor(ENTRIES).size);
  });

  it('caches index and shards per build: a second call costs no request', async () => {
    const { svc, calls } = setup(worker());
    await svc.resolve(BUILD, 'en', ['ui_a', 'dlg_x']);
    const before = calls.length;

    const out = await svc.resolve(BUILD, 'en', ['ui_a', 'dlg_x']);

    expect(calls.length).toBe(before);
    expect(out?.get('ui_a')).toBe('A');
  });

  it('answers null for a build without an R2 index (404), and remembers it', async () => {
    const { svc, calls } = setup(() => new Response('not found', { status: 404 }));

    expect(await svc.resolve(BUILD, 'en', ['ui_a'])).toBeNull();
    expect(await svc.resolve(BUILD, 'en', ['ui_a'])).toBeNull();

    expect(calls).toEqual([`${DIR}index.json`]);
  });

  it('answers null on an outage but asks again next time', async () => {
    let down = true;
    const healthy = worker();
    const { svc, calls } = setup((url) => (down ? new Response('', { status: 502 }) : healthy(url)));

    expect(await svc.resolve(BUILD, 'en', ['ui_a'])).toBeNull();
    down = false;
    const out = await svc.resolve(BUILD, 'en', ['ui_a']);

    expect(out?.get('ui_a')).toBe('A');
    expect(calls.filter((c) => c.endsWith('index.json')).length).toBe(2);
  });

  it('treats an index for another build or a malformed one as unusable', async () => {
    const { svc } = setup(worker(undefined, { ...INDEX, build_id: 'other' }));
    expect(await svc.resolve(BUILD, 'en', ['ui_a'])).toBeNull();
  });

  it('leaves the keys of a failed shard unresolved and keeps the rest', async () => {
    const shards = shardsFor(ENTRIES);
    const dlgUrl = `${DIR}${INDEX.gen}/${shardFor(INDEX, 'dlg_x')}.json`;
    shards.delete(dlgUrl);
    const { svc } = setup(worker(shards));

    const out = await svc.resolve(BUILD, 'en', ['ui_a', 'dlg_x']);

    expect(out?.get('ui_a')).toBe('A');
    expect(out?.has('dlg_x')).toBeFalse();
  });

  it('omits keys the build does not have', async () => {
    const { svc } = setup(worker());
    const out = await svc.resolve(BUILD, 'en', ['ui_missing']);
    expect(out?.size).toBe(0);
  });

  it('stays on the database path when no assets host is configured', async () => {
    const { svc, calls } = setup(worker(), '');
    expect(await svc.resolve(BUILD, 'en', ['ui_a'])).toBeNull();
    expect(calls).toEqual([]);
  });
});
