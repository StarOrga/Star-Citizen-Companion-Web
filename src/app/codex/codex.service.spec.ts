import { TestBed } from '@angular/core/testing';
import {
  CODEX_KINDS,
  CodexKind,
  CodexService,
  PAYLOAD_READS_IN_FLIGHT,
  forEachLimited,
  manufacturerFacetOptions,
  manufacturerLabel,
} from './codex.service';
import { UpcomingShipsService } from './upcoming-ships.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { environment } from '../../environments/environment';
import { LOCALE_SHARD_BASE, LOCALE_SHARD_FETCH } from './codex-locale-shards';

/** No R2 index for any build: resolveLocaleKeys reads the database table. */
const noR2 = (async () => new Response('not found', { status: 404 })) as unknown as typeof fetch;

const BUILD_ID = 'b77f1586-d1fe-4be9-a359-f397266acb86';

/**
 * The URL postgrest-js actually builds for one `resolveLocaleKeys` batch —
 * `select` + `build_id` + `lang` + the encoded `key=in.(…)` list. The Supabase
 * edge answers a bare `400 Bad Request` past ~25 300 characters (measured
 * against the live project), so the contract this spec guards is that no single
 * request ever gets near that.
 */
function requestUrlLength(values: string[]): number {
  const url = new URL(`${environment.supabase.url}/rest/v1/codex_locale_strings`);
  url.searchParams.append('select', 'key, value');
  url.searchParams.append('build_id', `eq.${BUILD_ID}`);
  url.searchParams.append('lang', 'eq.de');
  url.searchParams.append('key', `in.(${values.join(',')})`);
  return url.toString().length;
}

interface Capture {
  /** Every `in('key', …)` list handed to postgrest, in call order. */
  batches: string[][];
}

/**
 * Fluent mock of the two supabase chains CodexService touches here:
 * codex_builds → …maybeSingle(), codex_locale_strings → …in(), plus the
 * fire-and-forget p4k_bundles_public_stats freshness probe.
 */
function mockProvider(
  cap: Capture,
  respond: (keys: string[], nth: number) => { data: unknown; error: unknown },
): SupabaseClientProvider {
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: () => chain,
      eq: () => (table === 'p4k_bundles_public_stats'
        ? Promise.resolve({ data: [], error: null })
        : chain),
      maybeSingle: () =>
        Promise.resolve({
          data: { id: BUILD_ID, channel: 'LIVE', patch_version: '4.0', build_number: '1', is_current: true },
          error: null,
        }),
      in: (_col: string, values: string[]) => {
        const nth = cap.batches.length;
        cap.batches.push(values);
        return Promise.resolve(respond(values, nth));
      },
    });
    return chain;
  };
  return { client: { from } } as unknown as SupabaseClientProvider;
}

function makeService(
  cap: Capture,
  respond: (keys: string[], nth: number) => { data: unknown; error: unknown },
  r2Fetch: typeof fetch = noR2,
): CodexService {
  TestBed.configureTestingModule({
    providers: [
      CodexService,
      { provide: SupabaseClientProvider, useValue: mockProvider(cap, respond) },
      { provide: LOCALE_SHARD_FETCH, useValue: r2Fetch },
      { provide: LOCALE_SHARD_BASE, useValue: 'https://assets.test' },
    ],
  });
  return TestBed.inject(CodexService);
}

/** Echo every requested key back as `<key> DE` so merges are traceable. */
const echo = (keys: string[]) => ({
  data: keys.map((k) => ({ key: k, value: `${k} DE` })),
  error: null,
});

/** ~1 250 keys of realistic shape — what /codex/keybinds asks for on every load. */
const KEYBIND_KEYS = Array.from({ length: 1254 }, (_, i) => `@ui_CIEmergencyExitDescription_${i}`);

describe('CodexService.resolveLocaleKeys', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('keeps every request URL well under the edge limit for a keybinds-sized key list', async () => {
    const cap: Capture = { batches: [] };
    const svc = makeService(cap, echo);

    await svc.resolveLocaleKeys(KEYBIND_KEYS, 'de');

    expect(cap.batches.length).toBeGreaterThan(1);
    for (const batch of cap.batches) {
      expect(batch.length).toBeGreaterThan(0);
      // postgrest-js itself warns past 8 000 chars; the edge hard-fails at ~25 300.
      expect(requestUrlLength(batch)).toBeLessThanOrEqual(8000);
      // A batch must also stay under PostgREST's 1 000-row response cap, or the
      // reply is silently truncated instead of erroring.
      expect(batch.length).toBeLessThan(1000);
    }
  });

  it('resolves every key exactly once across the batches', async () => {
    const cap: Capture = { batches: [] };
    const svc = makeService(cap, echo);

    const out = await svc.resolveLocaleKeys(KEYBIND_KEYS, 'de');

    const requested = cap.batches.flat();
    expect(requested.length).toBe(KEYBIND_KEYS.length);
    expect(new Set(requested).size).toBe(KEYBIND_KEYS.length);
    // Keyed by the ORIGINAL `@`-prefixed input, values from the stripped rows.
    expect(out.size).toBe(KEYBIND_KEYS.length);
    expect(out.get('@ui_CIEmergencyExitDescription_0')).toBe('ui_CIEmergencyExitDescription_0 DE');
    expect(out.get('@ui_CIEmergencyExitDescription_1253')).toBe('ui_CIEmergencyExitDescription_1253 DE');
  });

  it('sends a short key list as a single request', async () => {
    const cap: Capture = { batches: [] };
    const svc = makeService(cap, echo);

    await svc.resolveLocaleKeys(['@ui_role_bomber', '@ui_role_fighter'], 'en');

    expect(cap.batches).toEqual([['ui_role_bomber', 'ui_role_fighter']]);
  });

  it('reads a build that has an R2 index from its shards and never asks the table', async () => {
    const cap: Capture = { batches: [] };
    const asked: string[] = [];
    const r2 = (async (url: string) => {
      asked.push(url);
      if (url.endsWith('/index.json')) {
        return Response.json({ v: 1, build_id: BUILD_ID, lang: 'de', gen: 'abc12345', count: 2, groups: {}, misc: 1 });
      }
      return Response.json({ ui_role_bomber: 'Bomber DE', ui_role_fighter: 'Jäger' });
    }) as unknown as typeof fetch;
    const svc = makeService(cap, echo, r2);

    const out = await svc.resolveLocaleKeys(['@ui_role_bomber', '@ui_role_fighter', '@ui_missing', 'plain'], 'de');

    expect(cap.batches).toEqual([]);
    expect(asked).toEqual([
      `https://assets.test/codex-locale/${BUILD_ID}/de/index.json`,
      `https://assets.test/codex-locale/${BUILD_ID}/de/abc12345/_misc-0.json`,
    ]);
    expect([...out]).toEqual([
      ['@ui_role_bomber', 'Bomber DE'],
      ['@ui_role_fighter', 'Jäger'],
    ]);
  });

  it('keeps the batches that succeeded when one fails — localization never blocks the view', async () => {
    const cap: Capture = { batches: [] };
    const svc = makeService(cap, (keys, nth) =>
      nth === 0 ? { data: null, error: { message: 'boom' } } : echo(keys),
    );

    const out = await svc.resolveLocaleKeys(KEYBIND_KEYS, 'de');

    expect(cap.batches.length).toBeGreaterThan(1);
    expect(out.size).toBeGreaterThan(0);
    expect(out.size).toBeLessThan(KEYBIND_KEYS.length);
  });
});

/**
 * PostgREST answers every request with at most `max-rows` rows (1000 on the
 * hosted stack) and says so only in `content-range` — a plain select of a
 * larger table comes back short, with no error. The mock reproduces exactly
 * that, so a service that forgets to page fails here the same way it fails
 * against the live project (measured: 1103 keybinds, 1000 returned).
 */
const SERVER_MAX_ROWS = 1000;

/** One codex_keybinds row; `sort` is the extractor's global document-order index. */
function keybindRow(i: number) {
  const actionmap = `actionmap_${String(Math.floor(i / 97)).padStart(2, '0')}`;
  return {
    actionmap,
    action_name: `action_${String(i).padStart(4, '0')}`,
    label_key: `@ui_CILabel${i}`,
    description_key: `@ui_CIDesc${i}`,
    category_label_key: `@ui_CCat_${actionmap}`,
    activation_mode: null,
    binding_keyboard: `key_${i}`,
    binding_mouse: null,
    binding_gamepad: null,
    binding_joystick: null,
    sort: i,
  };
}

/** One entry per codex_keybinds request: the `.range()` it asked for, or null. */
interface RangeCapture {
  ranges: ([number, number] | null)[];
}

/**
 * Fluent mock of the keybind chain: from().select().eq().order().order().range().
 * Every builder method returns the same thenable, so the bare
 * `from().select().eq()` of the freshness probe resolves too.
 */
function keybindProvider(
  rows: unknown[],
  cap: RangeCapture,
  error: { message: string } | null = null,
): SupabaseClientProvider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const from = (table: string): any => {
    let range: [number, number] | null = null;
    const result = () => {
      if (table !== 'codex_keybinds') return { data: [], error: null };
      if (error) return { data: null, error };
      cap.ranges.push(range);
      const start = range ? range[0] : 0;
      // An explicit range wider than max-rows is still truncated to max-rows.
      const end = range ? Math.min(range[1] + 1, start + SERVER_MAX_ROWS) : start + SERVER_MAX_ROWS;
      return { data: rows.slice(start, end), error: null };
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      range: (a: number, b: number) => {
        range = [a, b];
        return chain;
      },
      maybeSingle: () =>
        Promise.resolve({
          data: table === 'codex_builds'
            ? { id: BUILD_ID, channel: 'LIVE', patch_version: '4.9.0', build_number: 'desktop', is_current: true }
            : null,
          error: null,
        }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      then: (onOk: any, onErr: any) => Promise.resolve(result()).then(onOk, onErr),
    };
    return chain;
  };
  return { client: { from } } as unknown as SupabaseClientProvider;
}

function makeKeybindService(
  rows: unknown[],
  cap: RangeCapture = { ranges: [] },
  error: { message: string } | null = null,
): CodexService {
  TestBed.configureTestingModule({
    providers: [CodexService, { provide: SupabaseClientProvider, useValue: keybindProvider(rows, cap, error) }],
  });
  return TestBed.inject(CodexService);
}

describe('CodexService.listKeybinds', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('pages past the 1000-row server cap and returns every row of a 1103-row build', async () => {
    const rows = Array.from({ length: 1103 }, (_, i) => keybindRow(i));
    const cap: RangeCapture = { ranges: [] };
    const svc = makeKeybindService(rows, cap);

    const binds = await svc.listKeybinds();

    // The regression: an unpaged select silently yields 1000 of 1103.
    expect(binds.length).toBe(1103);
    expect(cap.ranges.length).toBeGreaterThan(1);
  });

  it('keeps the global sort order across the page boundary', async () => {
    const rows = Array.from({ length: 1103 }, (_, i) => keybindRow(i));
    const svc = makeKeybindService(rows);

    const binds = await svc.listKeybinds();

    // Callers group *consecutive* rows by actionmap, so a duplicated or
    // out-of-order row across the boundary would split a group in two.
    expect(binds.map((b) => b.sort)).toEqual(rows.map((r) => r.sort));
    expect(binds[999].actionName).toBe('action_0999');
    expect(binds[1000].actionName).toBe('action_1000');
    expect(binds[1102].actionName).toBe('action_1102');
  });

  it('maps every column of a row, bindings included', async () => {
    const svc = makeKeybindService([keybindRow(0)]);

    const [b] = await svc.listKeybinds();

    expect(b).toEqual({
      actionmap: 'actionmap_00',
      actionName: 'action_0000',
      labelKey: '@ui_CILabel0',
      descriptionKey: '@ui_CIDesc0',
      categoryLabelKey: '@ui_CCat_actionmap_00',
      activationMode: null,
      bindings: { keyboard: 'key_0', mouse: null, gamepad: null, joystick: null },
      sort: 0,
    });
  });

  it('stops on the first short page instead of probing to the page cap', async () => {
    const cap: RangeCapture = { ranges: [] };
    const svc = makeKeybindService(Array.from({ length: 42 }, (_, i) => keybindRow(i)), cap);

    const binds = await svc.listKeybinds();

    expect(binds.length).toBe(42);
    expect(cap.ranges.length).toBe(1);
  });

  it('stops after an exact-multiple build once the trailing page comes back empty', async () => {
    const cap: RangeCapture = { ranges: [] };
    const svc = makeKeybindService(Array.from({ length: 2000 }, (_, i) => keybindRow(i)), cap);

    const binds = await svc.listKeybinds();

    expect(binds.length).toBe(2000);
    expect(cap.ranges.length).toBe(3); // 1000 + 1000 + empty probe
  });

  it('throws the query error instead of rendering a truncated list', async () => {
    const svc = makeKeybindService([], { ranges: [] }, { message: 'boom' });

    await expectAsync(svc.listKeybinds()).toBeRejectedWithError('boom');
  });
});

/**
 * Feedback cdc69f53: the Codex landing showed "AEG" / "DRAK" where the game
 * data has spelled-out names. These pin the contract that the name comes from
 * the extracted payload and that an unresolvable one degrades to the code —
 * never to an invented expansion.
 */
describe('manufacturerLabel', () => {
  const payload = (name: unknown) => ({ manufacturer: { code: 'AEG', name } });

  it('never prints a livery token from the code column as a maker', () => {
    expect(manufacturerLabel({ payload: {}, manufacturerCode: 'Paint_Gladius_Black_Grey_Grey_Geometric_Logo' }, 'en')).toBeNull();
    expect(manufacturerLabel({ payload: {}, manufacturerCode: 'AEGS' }, 'en')).toBe('AEGS');
  });

  it('spells the manufacturer out from the payload, not from the code', () => {
    const row = {
      manufacturerCode: 'AEG',
      payload: payload({ de: 'Aegis Dynamics', en: 'Aegis Dynamics', key: '@manufacturer_NameAEGS' }),
    };
    expect(manufacturerLabel(row, 'de')).toBe('Aegis Dynamics');
    expect(manufacturerLabel(row, 'en')).toBe('Aegis Dynamics');
  });

  it('prefers the app language when the extract genuinely differs', () => {
    const row = {
      manufacturerCode: 'XIAN',
      payload: payload({ de: 'Aopoa DE', en: 'Aopoa', key: '@manufacturer_NameXIAN' }),
    };
    expect(manufacturerLabel(row, 'de')).toBe('Aopoa DE');
    expect(manufacturerLabel(row, 'en')).toBe('Aopoa');
  });

  it('falls back to the promoted code for an unresolved @-key name', () => {
    const row = {
      manufacturerCode: 'ASD',
      payload: payload({ de: '@manufacturer_NameASAD', en: '@manufacturer_NameASAD', key: '@manufacturer_NameASAD' }),
    };
    expect(manufacturerLabel(row, 'en')).toBe('ASD');
  });

  it('falls back to the code when the payload carries no manufacturer at all', () => {
    expect(manufacturerLabel({ manufacturerCode: 'DRAK', payload: {} }, 'en')).toBe('DRAK');
    expect(manufacturerLabel({ manufacturerCode: 'DRAK', payload: null }, 'en')).toBe('DRAK');
  });

  it('returns null rather than inventing a name when nothing is known', () => {
    expect(manufacturerLabel({ manufacturerCode: null, payload: {} }, 'en')).toBeNull();
    expect(manufacturerLabel(null, 'en')).toBeNull();
  });
});

/**
 * The facet keeps FILTERING on the promoted code (`listByKind` does
 * `.eq('manufacturer_code', …)`) while only the LABEL is spelled out, so a
 * relabelling can never silently break the query.
 */
describe('manufacturerFacetOptions', () => {
  const row = (code: string | null, name?: string) => ({
    manufacturerCode: code,
    payload: name
      ? { manufacturer: { code, name: { de: name, en: name, key: `@manufacturer_Name${code}` } } }
      : {},
  });

  it('labels each code with its extracted name and sorts by the label', () => {
    expect(
      manufacturerFacetOptions(
        [row('RSI', 'Roberts Space Industries'), row('DRAK', 'Drake Interplanetary')],
        'en',
      ),
    ).toEqual([
      { code: 'DRAK', label: 'Drake Interplanetary' },
      { code: 'RSI', label: 'Roberts Space Industries' },
    ]);
  });

  it('keeps the code as its own label when no row of that code resolves a name', () => {
    expect(manufacturerFacetOptions([row('XNAA'), row('XNAA')], 'en')).toEqual([
      { code: 'XNAA', label: 'XNAA' },
    ]);
  });

  it('lets a later row with a real name upgrade a code-only label', () => {
    expect(manufacturerFacetOptions([row('AEG'), row('AEG', 'Aegis Dynamics')], 'en')).toEqual([
      { code: 'AEG', label: 'Aegis Dynamics' },
    ]);
  });

  it('drops rows without a code — there is nothing to filter on', () => {
    expect(manufacturerFacetOptions([row(null, 'Nowhere Inc')], 'en')).toEqual([]);
  });

  it('drops livery tokens that paint items carry in place of a maker code', () => {
    expect(
      manufacturerFacetOptions(
        [row('Paint_400i_Black_Orange_Logo', 'Origin Jumpworks'), row('ORIG', 'Origin Jumpworks')],
        'en',
      ),
    ).toEqual([{ code: 'ORIG', label: 'Origin Jumpworks' }]);
  });
});

// Archive audit 2026-09-25: a failed build lookup used to be cached for the
// session, and every archive reader then rendered "nothing here" until a full
// reload. Readers now see the failure (error card + retry), and the retry reads
// the build again.
describe('CodexService archive readers and the build lookup', () => {
  interface Calls {
    builds: number;
    filters: string[];
  }

  function provider(calls: Calls, buildFailsFirst: boolean): SupabaseClientProvider {
    const from = (table: string) => {
      const chain: Record<string, unknown> = {};
      const listResult = { data: [], count: 0, error: null };
      Object.assign(chain, {
        select: () => chain,
        eq: (col: string, value: unknown) => {
          if (table === 'p4k_bundles_public_stats') return Promise.resolve({ data: [], error: null });
          calls.filters.push(`${table}:eq:${col}=${String(value)}`);
          return chain;
        },
        or: (expr: string) => {
          calls.filters.push(`${table}:or:${expr}`);
          return chain;
        },
        not: (col: string, op: string, value: string) => {
          calls.filters.push(`${table}:not:${col}.${op}.${value}`);
          return chain;
        },
        in: () => chain,
        order: () => chain,
        range: () => Promise.resolve(listResult),
        maybeSingle: () => {
          calls.builds++;
          if (buildFailsFirst && calls.builds === 1) return Promise.resolve({ data: null, error: new Error('network down') });
          return Promise.resolve({
            data: { id: BUILD_ID, channel: 'LIVE', patch_version: '4.0', build_number: '1', is_current: true },
            error: null,
          });
        },
      });
      return chain;
    };
    return { client: { from } } as unknown as SupabaseClientProvider;
  }

  function make(calls: Calls, buildFailsFirst = false): CodexService {
    TestBed.configureTestingModule({
      providers: [CodexService, { provide: SupabaseClientProvider, useValue: provider(calls, buildFailsFirst) }],
    });
    return TestBed.inject(CodexService);
  }

  it('surfaces a failed build lookup to the list, and the retry reads the build again', async () => {
    const calls: Calls = { builds: 0, filters: [] };
    const svc = make(calls, true);

    spyOn(console, 'warn');
    // The reader gets the ORIGINAL failure to classify; the service flag holds a key.
    await expectAsync(svc.listByKind('item')).toBeRejectedWithError('network down');
    expect(svc.buildError()).toBe('errors.generic');
    await expectAsync(svc.listByKind('item')).toBeResolved();
    expect(calls.builds).toBe(2);
  });

  it('ANDs one name/className group per search token, tolerant of separators', async () => {
    const calls: Calls = { builds: 0, filters: [] };
    const svc = make(calls);

    await svc.listByKind('weapon', { search: '  p4ar   Rifle ' });

    // "p4ar" must find "P4-AR": the letter/digit boundary becomes a wildcard,
    // and every token is its own AND-ed or() group.
    expect(calls.filters).toContain(
      'codex_weapons:or:name_localized.ilike.*p4ar*,class_name.ilike.*p4ar*,name_localized.ilike.*p4_ar*,class_name.ilike.*p4_ar*,' +
        'name_localized.ilike.*p_4ar*,class_name.ilike.*p_4ar*,name_localized.ilike.*p_4_ar*,class_name.ilike.*p_4_ar*',
    );
    expect(calls.filters).toContain('codex_weapons:or:name_localized.ilike.*rifle*,class_name.ilike.*rifle*');
  });

  it('asks the server nothing for a term it cannot match (no ASCII letter or digit)', async () => {
    const calls: Calls = { builds: 0, filters: [] };
    const svc = make(calls);
    const res = await svc.listByKind('item', { search: '\u00df \u0440\u0443\u0441' });
    expect(res).toEqual({ rows: [], count: 0 });
    expect(calls.filters.some((f) => f.startsWith('codex_items:'))).toBeFalse();
  });

  it('never sends or() grammar characters from the term', async () => {
    const calls: Calls = { builds: 0, filters: [] };
    const svc = make(calls);

    await svc.listByKind('ship', { search: 'AEGS_glad,(i)' });
    const groups = calls.filters.filter((f) => f.includes('.ilike.*'));

    expect(groups.length).toBe(3);
    const patterns = groups.flatMap((g) => [...g.matchAll(/ilike\.([^,]*)/g)].map((m) => m[1]));
    expect(patterns).toEqual(['*aegs*', '*aegs*', '*glad*', '*glad*', '*i*', '*i*']);
  });

  it('drops nameless records and non-ship vehicles from the default browse only', async () => {
    const calls: Calls = { builds: 0, filters: [] };
    const svc = make(calls);

    await svc.listByKind('ship');
    const browse = [...calls.filters];
    calls.filters.length = 0;
    await svc.listByKind('ship', { includeVariants: true });
    const raw = [...calls.filters];

    expect(browse).toContain('codex_ships:or:name_localized.is.null,name_localized.not.like.!*');
    expect(browse).toContain('codex_ships:not:class_name.ilike.SalvageableDebris*');
    expect(raw.some((f) => f.includes('not.like.!*') || f.includes('SalvageableDebris'))).toBeFalse();
  });
});

describe('CodexService.listFpsCatalog and countSearchMatches', () => {
  interface Cap {
    selects: string[];
    ranges: [number, number][];
    filters: string[];
  }
  const fresh = (): Cap => ({ selects: [], ranges: [], filters: [] });

  /** `n` slim FPS weapon rows, the shape the JSON-path select returns. */
  const fpsRows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      class_name: `klwe_pistol_${String(i).padStart(4, '0')}`,
      name_localized: `Pistol ${i}`,
      manufacturer_code: 'KLWE',
      attach_type: null,
      sub_type: 'Small',
      size: 1,
      grade: null,
      is_variant: false,
      weapon_class: 'FPS',
      name: { de: `Pistole ${i}`, en: `Pistol ${i}`, key: '@item_Name' },
      previewImage: `thumbs/p${i}.webp`,
      manufacturer: { code: 'KLWE', name: 'Klaus & Werner' },
    }));

  /**
   * Pages `rows` like PostgREST (max 1000 per response); head-only queries
   * answer `count`. The first `failReads` page reads fail.
   */
  function provider(rows: unknown[], cap: Cap, opts: { failReads?: number; count?: number } = {}): SupabaseClientProvider {
    let failures = opts.failReads ?? 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const from = (table: string): any => {
      let range: [number, number] | null = null;
      let head = false;
      let withCount = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        select: (cols: string, o?: { head?: boolean; count?: string }) => {
          if (table !== 'codex_builds') cap.selects.push(`${table}:${cols}`);
          head = !!o?.head;
          withCount = o?.count === 'exact' && !o?.head;
          return chain;
        },
        eq: (col: string, value: unknown) => {
          if (table === 'p4k_bundles_public_stats') return Promise.resolve({ data: [], error: null });
          if (table !== 'codex_builds') cap.filters.push(`${table}:eq:${col}=${String(value)}`);
          return chain;
        },
        in: (col: string) => {
          cap.filters.push(`${table}:in:${col}`);
          return chain;
        },
        or: (expr: string) => {
          cap.filters.push(`${table}:or:${expr}`);
          return chain;
        },
        not: (col: string, op: string, value: string) => {
          cap.filters.push(`${table}:not:${col}.${op}.${value}`);
          return chain;
        },
        order: () => chain,
        range: (a: number, b: number) => {
          range = [a, b];
          return chain;
        },
        maybeSingle: () =>
          Promise.resolve({
            data: { id: BUILD_ID, channel: 'LIVE', patch_version: '4.0', build_number: '1', is_current: true },
            error: null,
          }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        then: (onOk: any, onErr: any) => {
          const answer = () => {
            if (head) return { data: null, count: opts.count ?? 0, error: null };
            if (!range) return { data: [], error: null };
            cap.ranges.push(range);
            if (failures > 0) {
              failures--;
              return { data: null, error: new Error('flaky') };
            }
            const data = rows.slice(range[0], Math.min(range[1] + 1, range[0] + 1000));
            return { data, count: withCount ? rows.length : null, error: null };
          };
          return Promise.resolve(answer()).then(onOk, onErr);
        },
      };
      return chain;
    };
    return { client: { from } } as unknown as SupabaseClientProvider;
  }

  function make(rows: unknown[], cap: Cap, opts: { failReads?: number; count?: number } = {}): CodexService {
    TestBed.configureTestingModule({
      providers: [CodexService, { provide: SupabaseClientProvider, useValue: provider(rows, cap, opts) }],
    });
    return TestBed.inject(CodexService);
  }

  afterEach(() => TestBed.resetTestingModule());

  it('reads the whole category past the 1000-row cap and stops on the first short page', async () => {
    const cap = fresh();
    const rows = await make(fpsRows(1103), cap).listFpsCatalog('weapon');

    expect(rows.length).toBe(1103);
    expect(cap.ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('selects slim columns and hands the three payload paths to the card as its payload', async () => {
    const cap = fresh();
    const [row] = await make(fpsRows(1), cap).listFpsCatalog('weapon');

    const select = cap.selects.find((s) => s.startsWith('codex_weapons:'))!;
    expect(select).toContain('name:payload->name');
    // Never the whole payload column: ~10 kB per armour row, 3 % of it on a card.
    expect(select).not.toMatch(/(:|, )payload(,|$)/);
    expect(row.classNameSlug).toBe('klwe_pistol_0000');
    expect(row.payload).toEqual({
      name: { de: 'Pistole 0', en: 'Pistol 0', key: '@item_Name' },
      previewImage: 'thumbs/p0.webp',
      manufacturer: { code: 'KLWE', name: 'Klaus & Werner' },
    });
  });

  it('serves repeat calls from the cache, per category and variant switch', async () => {
    const cap = fresh();
    const svc = make(fpsRows(3), cap);

    await svc.listFpsCatalog('weapon');
    await svc.listFpsCatalog('weapon');
    expect(cap.ranges.length).toBe(1);

    await svc.listFpsCatalog('weapon', true);
    await svc.listFpsCatalog('armor');
    expect(cap.ranges.length).toBe(3);
  });

  it('drops a failed read from the cache, so the retry reads again', async () => {
    const cap = fresh();
    const svc = make(fpsRows(3), cap, { failReads: 1 });

    await expectAsync(svc.listFpsCatalog('weapon')).toBeRejectedWithError('flaky');
    expect((await svc.listFpsCatalog('weapon')).length).toBe(3);
    expect(cap.ranges.length).toBe(2);
  });

  it('applies the default browse filters unless the raw records are asked for', async () => {
    const cap = fresh();
    const svc = make([], cap);

    await svc.listFpsCatalog('armor');
    expect(cap.filters).toContain('codex_items:eq:is_variant=false');
    expect(cap.filters).toContain('codex_items:or:name_localized.is.null,name_localized.not.like.!*');
    expect(cap.filters).toContain('codex_items:in:attach_type');

    cap.filters.length = 0;
    await svc.listFpsCatalog('armor', true);
    expect(cap.filters.some((f) => f.includes('is_variant') || f.includes('not.like.!*'))).toBeFalse();
  });

  it('counts other categories under the same default filters as their lists', async () => {
    const cap = fresh();
    const counts = await make([], cap, { count: 4 }).countSearchMatches('titan', ['ship', 'item']);

    expect(counts.get('ship')).toBe(4);
    expect(counts.get('item')).toBe(4);
    expect(cap.filters).toContain('codex_ships:not:class_name.ilike.SalvageableDebris*');
    expect(cap.filters).toContain('codex_items:eq:is_variant=false');
    expect(cap.filters).toContain('codex_ships:or:name_localized.ilike.*titan*,class_name.ilike.*titan*');
  });

  it('counts nothing for a term with fewer than three characters left after escaping', async () => {
    const cap = fresh();
    const svc = make([], cap, { count: 99 });

    // `(((` escapes to an empty pattern, which would match every record.
    expect((await svc.countSearchMatches('(((', ['ship'])).size).toBe(0);
    expect((await svc.countSearchMatches('a,', ['ship'])).size).toBe(0);
    expect(cap.selects.length).toBe(0);
  });

  it('asks each kind once per term — a category switch re-uses the counts it already has', async () => {
    const cap = fresh();
    const svc = make([], cap, { count: 2 });

    await svc.countSearchMatches('titan', ['ship', 'item']);
    const first = cap.selects.length;
    const again = await svc.countSearchMatches('Titan', ['item', 'weapon']);

    expect(again.get('item')).toBe(2);
    expect(cap.selects.length - first).toBe(1); // only the new kind, weapon
  });

  it('counts the archive per armour position with head-only queries, once per build', async () => {
    const cap = fresh();
    const svc = make([], cap, { count: 7 });

    const counts = await svc.countItemsByAttachType(['Char_Armor_Helmet', 'Char_Armor_Torso']);
    expect([...counts.entries()]).toEqual([
      ['Char_Armor_Helmet', 7],
      ['Char_Armor_Torso', 7],
    ]);
    expect(cap.filters).toContain('codex_items:eq:attach_type=Char_Armor_Helmet');
    expect(cap.filters).toContain('codex_items:eq:is_variant=false');

    const before = cap.selects.length;
    await svc.countItemsByAttachType(['Char_Armor_Torso']);
    expect(cap.selects.length).toBe(before);
  });
});

describe('the placeholder manufacturer (UNKN)', () => {
  const row = { manufacturerCode: 'UNKN', payload: { manufacturer: { code: 'UNKN', name: 'PH Unknown Manufacturer' } } };

  it('gets no card badge and no facet option', () => {
    expect(manufacturerLabel(row, 'de')).toBeNull();
    expect(manufacturerFacetOptions([row], 'de')).toEqual([]);
  });
});

/**
 * AUD-063: /codex/index's dropdowns need the COMPLETE facet values, not just
 * what the loaded pages carry — this is what talks to `codex_facet_values`.
 */
describe('CodexService.facetValues', () => {
  interface RpcCall {
    fn: string;
    params: Record<string, unknown>;
  }

  function provider(
    calls: RpcCall[],
    respond: () => { data: unknown; error: unknown },
  ): SupabaseClientProvider {
    const from = (table: string) => {
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        select: () => chain,
        eq: () =>
          table === 'p4k_bundles_public_stats' ? Promise.resolve({ data: [], error: null }) : chain,
        maybeSingle: () =>
          Promise.resolve({
            data: { id: BUILD_ID, channel: 'LIVE', patch_version: '4.0', build_number: '1', is_current: true },
            error: null,
          }),
      });
      return chain;
    };
    const rpc = (fn: string, params: Record<string, unknown>) => {
      calls.push({ fn, params });
      return Promise.resolve(respond());
    };
    return { client: { from, rpc } } as unknown as SupabaseClientProvider;
  }

  function make(
    calls: RpcCall[],
    respond: () => { data: unknown; error: unknown },
  ): CodexService {
    TestBed.configureTestingModule({
      providers: [CodexService, { provide: SupabaseClientProvider, useValue: provider(calls, respond) }],
    });
    return TestBed.inject(CodexService);
  }

  afterEach(() => TestBed.resetTestingModule());

  const okResponse = () => ({
    data: {
      manufacturers: [{ code: 'AEG', name: { en: 'Aegis Dynamics', de: 'Aegis Dynamics', key: '@manufacturer_NameAEG' } }],
      sizes: [1, 2, 3],
      grades: ['A', 'B'],
      componentKinds: ['Shield'],
    },
    error: null,
  });

  it('calls the RPC with the current build and the requested kind', async () => {
    const calls: RpcCall[] = [];
    const svc = make(calls, okResponse);

    const result = await svc.facetValues('component');

    expect(calls).toEqual([{ fn: 'codex_facet_values', params: { p_build_id: BUILD_ID, p_kind: 'component' } }]);
    expect(result).toEqual({
      manufacturers: [{ code: 'AEG', name: { en: 'Aegis Dynamics', de: 'Aegis Dynamics', key: '@manufacturer_NameAEG' } }],
      sizes: [1, 2, 3],
      grades: ['A', 'B'],
      componentKinds: ['Shield'],
    });
  });

  it('caches the answer per build + kind — a second call for the same kind does not ask again', async () => {
    const calls: RpcCall[] = [];
    const svc = make(calls, okResponse);

    await svc.facetValues('weapon');
    await svc.facetValues('weapon');

    expect(calls.length).toBe(1);
  });

  it('asks again per kind — a different kind is a different cache key', async () => {
    const calls: RpcCall[] = [];
    const svc = make(calls, okResponse);

    await svc.facetValues('weapon');
    await svc.facetValues('item');

    expect(calls.length).toBe(2);
  });

  it('returns null (never throws) when the RPC errors — e.g. the migration is not deployed yet', async () => {
    const calls: RpcCall[] = [];
    const svc = make(calls, () => ({ data: null, error: new Error('function does not exist') }));

    const result = await svc.facetValues('ship');

    expect(result).toBeNull();
  });

  it('does not cache a failed read — a retry asks the RPC again', async () => {
    const calls: RpcCall[] = [];
    const svc = make(calls, () => ({ data: null, error: new Error('boom') }));

    await svc.facetValues('ship');
    await svc.facetValues('ship');

    expect(calls.length).toBe(2);
  });
});

describe('CodexService.resolveEntities', () => {
  /**
   * One table (codex_weapons) carries the requested class name with a
   * payload->name JSON path; every other entity table answers empty. Mirrors
   * the real "first table that owns a class name wins" shape without needing
   * all five tables populated.
   */
  function provider(rows: Record<string, unknown>[]): SupabaseClientProvider {
    const from = (table: string) => {
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        select: () => chain,
        eq: () => chain,
        in: () =>
          table === 'codex_weapons'
            ? Promise.resolve({ data: rows, error: null })
            : Promise.resolve({ data: [], error: null }),
        maybeSingle: () =>
          Promise.resolve({
            data: { id: BUILD_ID, channel: 'LIVE', patch_version: '4.0', build_number: '1', is_current: true },
            error: null,
          }),
      });
      return chain;
    };
    return { client: { from } } as unknown as SupabaseClientProvider;
  }

  function make(rows: Record<string, unknown>[]): CodexService {
    TestBed.configureTestingModule({
      providers: [CodexService, { provide: SupabaseClientProvider, useValue: provider(rows) }],
    });
    return TestBed.inject(CodexService);
  }

  it('maps the payload->name localized field alongside name_localized', async () => {
    const svc = make([
      {
        class_name: 'LH86',
        name_localized: 'LH86 Pistol',
        manufacturer_code: 'KRIG',
        size: 1,
        grade: 'A',
        name: { key: '@item_LH86_Name', en: 'LH86 Pistol', de: 'LH86 Pistole' },
      },
    ]);

    const resolved = await svc.resolveEntities(['LH86']);

    expect(resolved.get('LH86')?.name).toEqual({ key: '@item_LH86_Name', en: 'LH86 Pistol', de: 'LH86 Pistole' });
    expect(resolved.get('LH86')?.nameLocalized).toBe('LH86 Pistol');
  });

  it('leaves name null when the row carries no payload name', async () => {
    const svc = make([
      {
        class_name: 'LH86',
        name_localized: 'LH86 Pistol',
        manufacturer_code: 'KRIG',
        size: 1,
        grade: 'A',
        name: null,
      },
    ]);

    const resolved = await svc.resolveEntities(['LH86']);

    expect(resolved.get('LH86')?.name).toBeNull();
  });
});

describe('forEachLimited', () => {
  it('never runs more than the limit at once, and runs every item once, in order', async () => {
    let inFlight = 0;
    let peak = 0;
    const started: number[] = [];
    const items = Array.from({ length: 10 }, (_, i) => i);
    await forEachLimited(items, 3, async (i) => {
      started.push(i);
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      await Promise.resolve();
      inFlight--;
    });
    expect(peak).toBe(3);
    expect(started).toEqual(items);
  });

  it('settles at once for no items', async () => {
    const task = jasmine.createSpy('task');
    await forEachLimited([], 3, task);
    expect(task).not.toHaveBeenCalled();
  });
});

describe('CodexService.getEntityPayloads', () => {
  /**
   * Every entity table answers each chunk on a promise the spec releases, so
   * the number of reads in flight can be read off at any moment. `owners`
   * says which tables hold a row for a class name.
   */
  function setup(owners: Record<string, string[]>) {
    const pending: { table: string; release: () => void }[] = [];
    const from = (table: string) => {
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        select: () => chain,
        eq: () => chain,
        in: (_col: string, names: string[]) =>
          new Promise((resolve) =>
            pending.push({
              table,
              release: () =>
                resolve({
                  data: names
                    .filter((n) => (owners[n] ?? []).includes(table))
                    .map((n) => ({ class_name: n, payload: { from: table } })),
                  error: null,
                }),
            }),
          ),
        maybeSingle: () =>
          Promise.resolve({
            data: { id: BUILD_ID, channel: 'LIVE', patch_version: '4.0', build_number: '1', is_current: true },
            error: null,
          }),
      });
      return chain;
    };
    TestBed.configureTestingModule({
      providers: [CodexService, { provide: SupabaseClientProvider, useValue: { client: { from } } }],
    });
    return { svc: TestBed.inject(CodexService), pending };
  }

  const settle = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  // 2026-10-08: the whole-fleet cohort fired ~75 payload reads at once and
  // held PostgREST's pool; a fresh page's `profiles` read then queued past
  // approvedGuard's 5 s and landed on /unavailable.
  it('keeps at most PAYLOAD_READS_IN_FLIGHT chunk reads in flight for a fleet-sized list', async () => {
    const names = Array.from({ length: 1000 }, (_, i) => `CLS_${i}`); // 5 chunks × 3 tables
    const { svc, pending } = setup({});
    const done = svc.getEntityPayloads(names);
    let reads = 0;
    for (;;) {
      await settle();
      if (pending.length === 0) break;
      expect(pending.length).toBeLessThanOrEqual(PAYLOAD_READS_IN_FLIGHT);
      reads += pending.length;
      pending.splice(0).forEach((p) => p.release());
    }
    await done;
    expect(reads).toBe(15);
  });

  it('lets the first table that owns a class name win, whatever order the answers arrive in', async () => {
    const { svc, pending } = setup({ SHARED: ['codex_weapons', 'codex_items'], ONLY_ITEM: ['codex_items'] });
    const done = svc.getEntityPayloads(['SHARED', 'ONLY_ITEM']);
    for (;;) {
      await settle();
      if (pending.length === 0) break;
      // Answer last-asked first: the items table answers before the weapons table.
      pending.splice(0).reverse().forEach((p) => p.release());
    }
    const out = await done;
    expect(out.get('SHARED')).toEqual({ kind: 'weapon', payload: { from: 'codex_weapons' } });
    expect(out.get('ONLY_ITEM')).toEqual({ kind: 'item', payload: { from: 'codex_items' } });
  });
});

describe('CodexService.getDetail', () => {
  /**
   * Every query is a chain that ends in a thenable; `maybeSingle()` answers the
   * build lookup and the entity row, the chosen side read answers with an error.
   */
  function provider(failing: 'codex_item_ports' | 'codex_entity_strings'): SupabaseClientProvider {
    const from = (table: string) => {
      const result = () =>
        table === failing
          ? { data: null, error: { code: 'XX000', message: 'boom', details: '', hint: '' } }
          : { data: [], error: null };
      const chain: Record<string, unknown> = new Proxy(
        {},
        {
          get: (_t, prop) => {
            if (prop === 'then') {
              return (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
                Promise.resolve(result()).then(ok, bad);
            }
            if (prop === 'maybeSingle') {
              return () =>
                Promise.resolve(
                  table === 'codex_builds'
                    ? {
                        data: { id: BUILD_ID, channel: 'LIVE', patch_version: '4.0', build_number: '1', is_current: true },
                        error: null,
                      }
                    : { data: { class_name: 'AEGS_Gladius', payload: {} }, error: null },
                );
            }
            return () => chain;
          },
        },
      );
      return chain;
    };
    return { client: { from } } as unknown as SupabaseClientProvider;
  }

  function make(failing: 'codex_item_ports' | 'codex_entity_strings'): CodexService {
    TestBed.configureTestingModule({
      providers: [CodexService, { provide: SupabaseClientProvider, useValue: provider(failing) }],
    });
    return TestBed.inject(CodexService);
  }

  afterEach(() => TestBed.resetTestingModule());

  it('throws when the ports read fails, instead of rendering "no ports" (AUD-110)', async () => {
    const svc = make('codex_item_ports');
    await expectAsync(svc.getDetail('ship', 'AEGS_Gladius')).toBeRejected();
  });

  it('throws when the strings read fails', async () => {
    const svc = make('codex_entity_strings');
    await expectAsync(svc.getDetail('ship', 'AEGS_Gladius')).toBeRejected();
  });
});

describe('CodexService.revalidateLiveBuild', () => {
  const T0 = new Date('2026-09-29T12:00:00Z').getTime();
  const GAP = 5 * 60 * 1000 + 1;

  interface World {
    /** The `is_current` LIVE row the next read answers with; an Error fails the read. */
    live: { id: string; patch_version: string } | Error;
    /** Build ids that still exist in `codex_builds`. */
    existing: Set<string>;
    liveReads: number;
  }

  function provider(world: World): SupabaseClientProvider {
    const from = (table: string) => {
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        select: () => chain,
        eq: (col: string, value: unknown) => {
          if (table === 'p4k_bundles_public_stats') return Promise.resolve({ data: [], error: null });
          filters[col] = value;
          return chain;
        },
        maybeSingle: () => {
          if ('id' in filters) {
            const id = String(filters['id']);
            return Promise.resolve({ data: world.existing.has(id) ? { id } : null, error: null });
          }
          world.liveReads++;
          if (world.live instanceof Error) return Promise.resolve({ data: null, error: world.live });
          return Promise.resolve({
            data: { ...world.live, channel: 'LIVE', build_number: '1', is_current: true },
            error: null,
          });
        },
      });
      return chain;
    };
    return { client: { from } } as unknown as SupabaseClientProvider;
  }

  async function make(world: World): Promise<CodexService> {
    TestBed.configureTestingModule({
      providers: [CodexService, { provide: SupabaseClientProvider, useValue: provider(world) }],
    });
    const svc = TestBed.inject(CodexService);
    await svc.loadCurrentBuild();
    return svc;
  }

  function world(): World {
    return { live: { id: 'b1', patch_version: '4.3.0' }, existing: new Set(['b1', 'b0']), liveReads: 0 };
  }

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(T0));
    spyOn(console, 'warn');
  });
  afterEach(() => {
    jasmine.clock().uninstall();
    TestBed.resetTestingModule();
  });

  function later(ms = GAP): void {
    jasmine.clock().mockDate(new Date(Date.now() + ms));
  }

  it('does nothing when the LIVE build is unchanged', async () => {
    const w = world();
    const svc = await make(w);
    later();
    await svc.revalidateLiveBuild();
    expect(w.liveReads).toBe(2);
    expect(svc.build()?.id).toBe('b1');
    expect(svc.buildRefresh()).toBe(0);
    expect(svc.liveMovedNotice()).toBeNull();
  });

  it('moves a reader on live to the new LIVE build and says so once', async () => {
    const w = world();
    const svc = await make(w);
    w.live = { id: 'b2', patch_version: '4.3.1' };
    later();
    await svc.revalidateLiveBuild();
    expect(svc.build()?.id).toBe('b2');
    expect(svc.liveBuild()?.id).toBe('b2');
    expect(svc.buildRefresh()).toBe(1);
    expect(svc.liveMovedNotice()).toBe('4.3.1');
    expect(svc.viewingPastPatch()).toBeFalse();
  });

  it('keeps a reader on an older patch that still exists', async () => {
    const w = world();
    const svc = await make(w);
    svc.selectBuild({ ...svc.build()!, id: 'b0', patchVersion: '4.2.0', isCurrent: false });
    w.live = { id: 'b2', patch_version: '4.3.1' };
    later();
    await svc.revalidateLiveBuild();
    expect(svc.build()?.id).toBe('b0');
    expect(svc.liveBuild()?.id).toBe('b2');
    expect(svc.viewingPastPatch()).toBeTrue();
    expect(svc.buildRefresh()).toBe(0);
    expect(svc.liveMovedNotice()).toBeNull();
  });

  it('moves a reader whose older patch was deleted to the new LIVE build', async () => {
    const w = world();
    const svc = await make(w);
    svc.selectBuild({ ...svc.build()!, id: 'gone', patchVersion: '4.1.0', isCurrent: false });
    w.live = { id: 'b2', patch_version: '4.3.1' };
    later();
    await svc.revalidateLiveBuild();
    expect(svc.build()?.id).toBe('b2');
    expect(svc.buildRefresh()).toBe(1);
    expect(svc.liveMovedNotice()).toBe('4.3.1');
  });

  it('only logs a failed read — buildError stays clear', async () => {
    const w = world();
    const svc = await make(w);
    w.live = new Error('network down');
    later();
    await svc.revalidateLiveBuild();
    expect(svc.buildError()).toBeNull();
    expect(svc.build()?.id).toBe('b1');
    expect(console.warn).toHaveBeenCalled();
  });

  it('reads at most once per five minutes', async () => {
    const w = world();
    const svc = await make(w);
    await svc.revalidateLiveBuild(); // right after the load — throttled
    expect(w.liveReads).toBe(1);
    later();
    await svc.revalidateLiveBuild();
    later(60_000);
    await svc.revalidateLiveBuild();
    expect(w.liveReads).toBe(2);
  });
});

describe('CodexService.armorRating', () => {
  interface Answer { data: unknown; error: unknown; status?: number }

  function make(
    answers: Answer[],
    opts: { noBuild?: boolean } = {},
  ): { svc: CodexService; rpcCalls: () => number; rpcLog: [string, unknown][] } {
    let calls = 0;
    const rpcLog: [string, unknown][] = [];
    const from = (table: string) => {
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        select: () => chain,
        eq: () => (table === 'p4k_bundles_public_stats' ? Promise.resolve({ data: [], error: null }) : chain),
        maybeSingle: () =>
          Promise.resolve({
            data: opts.noBuild ? null : { id: BUILD_ID, channel: 'LIVE', patch_version: '4.0', build_number: '1', is_current: true },
            error: null,
          }),
      });
      return chain;
    };
    const rpc = (name: string, params: unknown) => {
      rpcLog.push([name, params]);
      const a = answers[Math.min(calls, answers.length - 1)];
      calls++;
      return Promise.resolve({ status: 200, ...a });
    };
    TestBed.configureTestingModule({
      providers: [CodexService, { provide: SupabaseClientProvider, useValue: { client: { from, rpc } } }],
    });
    return { svc: TestBed.inject(CodexService), rpcCalls: () => calls, rpcLog };
  }

  beforeEach(() => spyOn(console, 'warn'));
  afterEach(() => TestBed.resetTestingModule());

  it('answers an empty name list with no rows, without a read', async () => {
    const { svc, rpcCalls } = make([{ data: [], error: null }]);
    expect(await svc.armorRating([])).toEqual({ rows: [] });
    expect(rpcCalls()).toBe(0);
  });

  it('answers "no rating" when there is no LIVE build', async () => {
    const { svc } = make([{ data: [], error: null }], { noBuild: true });
    expect(await svc.armorRating(['A'])).toEqual({ rows: null });
  });

  it('retries a statement timeout (57014) once and returns the warm answer', async () => {
    const rows = [{ className: 'A' }];
    const { svc, rpcCalls } = make([
      { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' }, status: 500 },
      { data: rows, error: null },
    ]);
    expect(await svc.armorRating(['A'])).toEqual({ rows } as never);
    expect(rpcCalls()).toBe(2);
  });

  it('gives up after one retry with a failed result that is not cached', async () => {
    const err = { code: '57014', message: 'canceling statement due to statement timeout' };
    const { svc, rpcCalls } = make([{ data: null, error: err }]);
    const res = await svc.armorRating(['A']);
    expect(res).toEqual({ failed: true, error: err });
    expect(rpcCalls()).toBe(2);
    await svc.armorRating(['A']);
    expect(rpcCalls()).toBe(4);
  });

  // REQ-1 (AUD-117, AUD-202): the set rating reads one RPC, cached per build
  // and per class-name SET — order must not matter, a patch switch must.
  it('asks codex_armor_rating with the build id and the class names', async () => {
    const rows = [{ className: 'A' }];
    const { svc, rpcLog } = make([{ data: rows, error: null }]);
    expect(await svc.armorRating(['B', 'A'])).toEqual({ rows } as never);
    expect(rpcLog).toEqual([['codex_armor_rating', { p_build_id: BUILD_ID, p_class_names: ['B', 'A'] }]]);
  });

  it('serves the same class names in another order from the cache', async () => {
    const { svc, rpcCalls } = make([{ data: [{ className: 'A' }], error: null }]);
    await svc.armorRating(['A', 'B', 'C']);
    await svc.armorRating(['C', 'A', 'B']);
    expect(rpcCalls()).toBe(1);
    await svc.armorRating(['A', 'B']);
    expect(rpcCalls()).toBe(2);
  });

  it("drops the previous build's answers on a build switch", async () => {
    const { svc, rpcCalls, rpcLog } = make([{ data: [{ className: 'A' }], error: null }]);
    await svc.armorRating(['A']);
    const first = svc.build();
    expect(first).not.toBeNull();
    svc.build.set({ ...first!, id: 'other-build' });
    await svc.armorRating(['A']);
    expect(rpcCalls()).toBe(2);
    expect((rpcLog[1][1] as { p_build_id: string }).p_build_id).toBe('other-build');
    // Back on the first build: its entry was pruned by the switch, so it reads again.
    svc.build.set(first);
    await svc.armorRating(['A']);
    expect(rpcCalls()).toBe(3);
  });

  it('answers a thrown RPC with a failed result instead of throwing', async () => {
    const { svc } = make([{ data: [], error: null }]);
    const boom = new Error('network down');
    (TestBed.inject(SupabaseClientProvider).client as unknown as { rpc: () => never }).rpc = () => {
      throw boom;
    };
    await expectAsync(svc.armorRating(['A'])).toBeResolvedTo({ failed: true, error: boom });
  });

  it('does not retry a non-transient RPC error', async () => {
    const err = { code: '42883', message: 'function does not exist' };
    const { svc, rpcCalls } = make([{ data: null, error: err, status: 404 }]);
    expect(await svc.armorRating(['A'])).toEqual({ failed: true, error: err });
    expect(rpcCalls()).toBe(1);
  });
});

describe('CodexService.searchAll', () => {
  function listRow(slug: string, name: string | null = slug) {
    return {
      classNameSlug: slug,
      nameLocalized: name,
      manufacturerCode: null,
      size: null,
      grade: null,
      role: null,
      crewSize: null,
      weaponClass: null,
      componentKind: null,
      subType: null,
      attachType: null,
      speed: null,
      isVariant: false,
      payload: {},
      blueprintCategory: null,
      blueprintTier: null,
      craftTimeSec: null,
    };
  }

  function make(upcoming: Partial<UpcomingShipsService> = {}): CodexService {
    TestBed.configureTestingModule({
      providers: [
        CodexService,
        { provide: SupabaseClientProvider, useValue: { client: { from: () => ({}) } } },
        {
          provide: UpcomingShipsService,
          useValue: { searchShips: jasmine.createSpy('searchShips').and.resolveTo([]), ...upcoming },
        },
      ],
    });
    return TestBed.inject(CodexService);
  }

  afterEach(() => TestBed.resetTestingModule());

  it('answers a blank term with nothing and asks no source', async () => {
    const svc = make();
    const list = spyOn(svc, 'listByKind');
    expect((await svc.searchAll('   ')).hits).toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });

  it('over-fetches perKind × 4 rows from every kind with the trimmed term', async () => {
    const svc = make();
    const list = spyOn(svc, 'listByKind').and.resolveTo({ rows: [], count: 0 });

    await svc.searchAll('  gladius ', 5);

    expect(list).toHaveBeenCalledTimes(CODEX_KINDS.length);
    for (const kind of CODEX_KINDS) {
      expect(list).toHaveBeenCalledWith(kind, { search: 'gladius', limit: 20 });
    }
  });

  it('ranks, dedupes and truncates per kind — the best match survives the alphabetical over-fetch', async () => {
    const svc = make();
    spyOn(svc, 'listByKind').and.callFake(async (kind: CodexKind) => {
      if (kind !== 'weapon') return { rows: [], count: 0 };
      return {
        rows: [
          listRow('a_rifle', 'Aardvark P4 Rifle Mount'),
          listRow('b_rifle', 'Bravo P4 Rifle'),
          listRow('b_rifle', 'Bravo P4 Rifle'),
          listRow('c_rifle', 'Charlie P4 Rifle'),
          listRow('behr_rifle_p4ar', 'P4-AR Rifle'),
        ],
        count: 5,
      };
    });

    const { hits } = await svc.searchAll('p4-ar', 2);

    expect(hits.length).toBe(2);
    expect(hits[0].classNameSlug).toBe('behr_rifle_p4ar');
    expect(new Set(hits.map((h) => h.classNameSlug)).size).toBe(2);
  });

  it('skips a kind whose read fails instead of failing the whole search', async () => {
    const svc = make();
    spyOn(svc, 'listByKind').and.callFake(async (kind: CodexKind) => {
      if (kind === 'ship') throw new Error('timeout');
      if (kind === 'blueprint') return { rows: [listRow('BP_Gladius', 'Gladius Blueprint')], count: 1 };
      return { rows: [], count: 0 };
    });

    const { hits } = await svc.searchAll('gladius');

    expect(hits.map((h) => `${h.kind}:${h.classNameSlug}`)).toEqual(['blueprint:BP_Gladius']);
  });

  it('names the kinds it could not search, so the UI can say the result is partial', async () => {
    const svc = make();
    const timeout = new Error('canceling statement due to statement timeout');
    spyOn(svc, 'listByKind').and.callFake(async (kind: CodexKind) => {
      if (kind === 'ship' || kind === 'item') throw timeout;
      return { rows: [], count: 0 };
    });

    const res = await svc.searchAll('gladius');

    expect(res.failed).toEqual(jasmine.arrayWithExactContents(['ship', 'item']));
    expect(res.failure).toBe(timeout);
  });

  it('reports nothing failed when every source answered', async () => {
    const svc = make();
    spyOn(svc, 'listByKind').and.resolveTo({ rows: [], count: 0 });

    const res = await svc.searchAll('gladius');

    expect(res.failed).toBeUndefined();
  });

  it('rejects when every source failed — an outage is an error, not "no results"', async () => {
    const svc = make({
      searchShips: jasmine.createSpy('searchShips').and.rejectWith(new TypeError('Failed to fetch')),
    } as Partial<UpcomingShipsService>);
    spyOn(svc, 'listByKind').and.rejectWith(new TypeError('Failed to fetch'));

    await expectAsync(svc.searchAll('gladius')).toBeRejectedWithError(TypeError);
  });

  it('adds announced ships from the upcoming feed as an extra source, tagged upcoming', async () => {
    const searchShips = jasmine.createSpy('searchShips').and.resolveTo([
      { id: 'rsi-arrastra', name: 'Arrastra', manufacturer: 'Argo Astronautics', manufacturerCode: 'ARGO' },
    ]);
    const svc = make({ searchShips } as Partial<UpcomingShipsService>);
    spyOn(svc, 'listByKind').and.resolveTo({ rows: [], count: 0 });

    const { hits } = await svc.searchAll('arrastra', 3);

    expect(searchShips).toHaveBeenCalledWith('arrastra', 500);
    expect(hits.length).toBe(1);
    expect(hits[0].kind).toBe('upcoming');
    expect(hits[0].scope).toBe('upcoming');
    expect(hits[0].nameLocalized).toBe('Arrastra');
  });

  it('keeps the archive hits when the upcoming feed rejects', async () => {
    const svc = make({
      searchShips: jasmine.createSpy('searchShips').and.rejectWith(new Error('proxy down')),
    } as Partial<UpcomingShipsService>);
    spyOn(svc, 'listByKind').and.callFake(async (kind: CodexKind) =>
      kind === 'ship' ? { rows: [listRow('AEGS_Gladius', 'Gladius')], count: 1 } : { rows: [], count: 0 },
    );

    const { hits } = await svc.searchAll('gladius');

    expect(hits.map((h) => h.classNameSlug)).toEqual(['AEGS_Gladius']);
  });

  it('reports the per-kind totals the index will show, beyond the per-kind cap', async () => {
    const searchShips = jasmine.createSpy('searchShips').and.resolveTo([
      { id: 'a', name: 'Gladius II', manufacturer: null, manufacturerCode: null },
      { id: 'b', name: 'Gladius III', manufacturer: null, manufacturerCode: null },
    ]);
    const svc = make({ searchShips } as Partial<UpcomingShipsService>);
    spyOn(svc, 'listByKind').and.callFake(async (kind: CodexKind) =>
      kind === 'component'
        ? { rows: [listRow('A', 'Gladius A'), listRow('B', 'Gladius B')], count: 37 }
        : { rows: [], count: 0 },
    );

    const { hits, totals } = await svc.searchAll('gladius', 1);

    expect(totals.component).toBe(37);
    expect(totals.ship).toBe(0);
    expect(totals.upcoming).toBe(2);
    expect(hits.filter((h) => h.kind === 'upcoming').length).toBe(1);
  });
});

describe('CodexService.listByKind search post-filter', () => {
  function make(rows: Record<string, unknown>[], count: number | null): CodexService {
    const from = (table: string) => {
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        select: () => chain,
        eq: () => (table === 'p4k_bundles_public_stats' ? Promise.resolve({ data: [], error: null }) : chain),
        or: () => chain,
        not: () => chain,
        in: () => chain,
        order: () => chain,
        range: () => Promise.resolve({ data: rows, count, error: null }),
        maybeSingle: () =>
          Promise.resolve({
            data: { id: BUILD_ID, channel: 'LIVE', patch_version: '4.0', build_number: '1', is_current: true },
            error: null,
          }),
      });
      return chain;
    };
    TestBed.configureTestingModule({
      providers: [CodexService, { provide: SupabaseClientProvider, useValue: { client: { from } } }],
    });
    return TestBed.inject(CodexService);
  }

  afterEach(() => TestBed.resetTestingModule());

  it('drops a server false hit for "p4ar" and lowers the count by the dropped rows', async () => {
    const svc = make(
      [
        { class_name: 'behr_rifle_ballistic_01', name_localized: 'P4-AR Rifle' },
        { class_name: 'DRAK_Caterpillar_BIS2949', name_localized: 'Drake Caterpillar BIS 2949' },
      ],
      12,
    );

    const res = await svc.listByKind('weapon', { search: 'p4ar' });

    expect(res.rows.map((r) => r.classNameSlug)).toEqual(['behr_rifle_ballistic_01']);
    expect(res.count).toBe(11);
  });

  it('keeps every row and the server count when no search is set', async () => {
    const svc = make(
      [
        { class_name: 'a', name_localized: 'Alpha' },
        { class_name: 'b', name_localized: 'Bravo' },
      ],
      40,
    );

    const res = await svc.listByKind('weapon');

    expect(res.rows.length).toBe(2);
    expect(res.count).toBe(40);
  });

  it('never reports a count below the rows actually returned', async () => {
    const svc = make([{ class_name: 'behr_rifle_ballistic_01', name_localized: 'P4-AR Rifle' }], null);

    const res = await svc.listByKind('weapon', { search: 'p4ar' });

    expect(res.count).toBe(1);
  });
});

/**
 * Codex UX audit 2026-10-02 L05/L06: German names and "did you mean" go
 * through the `codex_search` / `codex_search_suggest` RPCs — and must degrade
 * to the old behaviour while that migration is not live yet.
 */
describe('CodexService German-name search and suggestions', () => {
  interface Seen {
    rpc: { fn: string; params: Record<string, unknown> }[];
    ins: { col: string; values: unknown[] }[];
    ranges: number;
  }

  function make(
    seen: Seen,
    pages: { data: Record<string, unknown>[]; count: number }[],
    rpc: ((fn: string) => { data: unknown; error: unknown; status?: number }) | null,
  ): CodexService {
    const from = (table: string) => {
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        select: () => chain,
        eq: () => (table === 'p4k_bundles_public_stats' ? Promise.resolve({ data: [], error: null }) : chain),
        or: () => chain,
        not: () => chain,
        in: (col: string, values: unknown[]) => {
          seen.ins.push({ col, values });
          return chain;
        },
        order: () => chain,
        range: () => Promise.resolve({ ...pages[Math.min(seen.ranges++, pages.length - 1)], error: null }),
        maybeSingle: () =>
          Promise.resolve({
            data: { id: BUILD_ID, channel: 'LIVE', patch_version: '4.0', build_number: '1', is_current: true },
            error: null,
          }),
      });
      return chain;
    };
    const client: Record<string, unknown> = { from };
    if (rpc) {
      client['rpc'] = (fn: string, params: Record<string, unknown>) => {
        seen.rpc.push({ fn, params });
        return Promise.resolve(rpc(fn));
      };
    }
    TestBed.configureTestingModule({
      providers: [CodexService, { provide: SupabaseClientProvider, useValue: { client } }],
    });
    return TestBed.inject(CodexService);
  }

  const fresh = (): Seen => ({ rpc: [], ins: [], ranges: 0 });
  const missing = () => ({
    data: null,
    error: { code: 'PGRST202', message: 'Could not find the function public.codex_search_suggest' },
    status: 404,
  });

  afterEach(() => TestBed.resetTestingModule());

  it('suggestNames returns the RPC names best-first without duplicates', async () => {
    const seen = fresh();
    const svc = make(seen, [{ data: [], count: 0 }], () => ({
      data: [
        { name: 'Aegis Gladius', score: 0.57 },
        { name: 'aegis gladius', score: 0.57 },
        { name: 'Anvil Gladiator', score: 0.5 },
      ],
      error: null,
    }));

    const names = await svc.suggestNames('ship', '  Gladus ');

    expect(names).toEqual(['Aegis Gladius', 'Anvil Gladiator']);
    expect(seen.rpc).toEqual([
      { fn: 'codex_search_suggest', params: { p_kind: 'ship', p_build: BUILD_ID, p_term: 'Gladus', p_limit: 3 } },
    ]);
  });

  it('suggestNames resolves [] when the RPC does not exist yet, and stops asking', async () => {
    const seen = fresh();
    const svc = make(seen, [{ data: [], count: 0 }], missing);

    expect(await svc.suggestNames('ship', 'gladus')).toEqual([]);
    expect(await svc.suggestNames('ship', 'arowhead')).toEqual([]);
    expect(seen.rpc.length).toBe(1);
  });

  it('suggestNames resolves [] without a client rpc', async () => {
    const svc = make(fresh(), [{ data: [], count: 0 }], null);

    expect(await svc.suggestNames('item', 'gewehr')).toEqual([]);
  });

  it('suggestNames skips terms under three searchable characters', async () => {
    const seen = fresh();
    const svc = make(seen, [{ data: [], count: 0 }], () => ({ data: [{ name: 'x' }], error: null }));

    expect(await svc.suggestNames('item', ' a* ')).toEqual([]);
    expect(seen.rpc.length).toBe(0);
  });

  it('listByKind falls back to German names when the English search finds nothing', async () => {
    const seen = fresh();
    const svc = make(
      seen,
      [
        { data: [], count: 0 },
        { data: [{ class_name: 'behr_rifle_ballistic_01', name_localized: 'P4-AR Rifle' }], count: 1 },
      ],
      () => ({ data: [{ class_name: 'behr_rifle_ballistic_01', name_localized: 'P4-AR Rifle', rank: 1 }], error: null }),
    );

    const res = await svc.listByKind('weapon', { search: 'Gewehr', weaponClass: 'Rifle', limit: 20, offset: 0 });

    expect(seen.rpc).toEqual([
      {
        fn: 'codex_search',
        params: { p_kind: 'weapon', p_build: BUILD_ID, p_tokens: ['gewehr'], p_limit: 100, p_offset: 0 },
      },
    ]);
    // The second list query is restricted to the RPC's class names, not to the term.
    expect(seen.ins.at(-1)).toEqual({ col: 'class_name', values: ['behr_rifle_ballistic_01'] });
    expect(seen.ranges).toBe(2);
    // A German hit is kept although its English name does not contain "gewehr".
    expect(res.rows.map((r) => r.classNameSlug)).toEqual(['behr_rifle_ballistic_01']);
    expect(res.count).toBe(1);
  });

  it('listByKind keeps its empty result when the search RPC is missing', async () => {
    const seen = fresh();
    const svc = make(seen, [{ data: [], count: 0 }], missing);

    const res = await svc.listByKind('item', { search: 'rustung' });

    expect(res).toEqual({ rows: [], count: 0 });
    expect(seen.ranges).toBe(1);
  });

  it('listByKind never calls the search RPC without a search, or when the English search hits', async () => {
    const seen = fresh();
    const rows = [{ class_name: 'AEGS_Gladius', name_localized: 'Aegis Gladius' }];
    const svc = make(seen, [{ data: rows, count: 1 }], () => ({ data: [], error: null }));

    await svc.listByKind('ship');
    await svc.listByKind('ship', { search: 'gladius' });

    expect(seen.rpc).toEqual([]);
    expect(seen.ranges).toBe(2);
  });
});
