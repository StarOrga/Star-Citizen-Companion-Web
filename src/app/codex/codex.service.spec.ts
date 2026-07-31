import { TestBed } from '@angular/core/testing';
import { CodexService } from './codex.service';
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
