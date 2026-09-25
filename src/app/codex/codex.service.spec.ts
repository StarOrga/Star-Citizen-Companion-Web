import { TestBed } from '@angular/core/testing';
import { CodexService, manufacturerFacetOptions, manufacturerLabel } from './codex.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { environment } from '../../environments/environment';

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
): CodexService {
  TestBed.configureTestingModule({
    providers: [CodexService, { provide: SupabaseClientProvider, useValue: mockProvider(cap, respond) }],
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

    await expectAsync(svc.listByKind('item')).toBeRejectedWithError('network down');
    await expectAsync(svc.listByKind('item')).toBeResolved();
    expect(calls.builds).toBe(2);
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
    expect(cap.filters).toContain('codex_ships:or:name_localized.ilike.%titan%,class_name.ilike.%titan%');
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
