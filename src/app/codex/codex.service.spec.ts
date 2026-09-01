import { TestBed } from '@angular/core/testing';
import { CodexService, manufacturerLabel } from './codex.service';
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
