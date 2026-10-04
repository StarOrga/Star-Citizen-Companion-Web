import { describe, it, expect } from 'vitest';
import {
  CATALOG_SUBTHEMES,
  SUBTHEMES,
  SUBTHEME_KEYS,
  currentRevisions,
  phasesOf,
  planSubthemes,
} from '../src/lib/subthemes.js';
import { CATALOG_PHASE_ORDER } from '../src/lib/catalog-phases.js';
import { parseBuildNumber } from '../src/lib/discovery.js';
import { pickSubthemeCandidates } from '../src/lib/auto-run.js';
import { fetchLedger, recordLedger } from '../src/lib/subtheme-ledger.js';
import type { DiscoveredChannel } from '../src/lib/discovery.js';

const allHeld = () => SUBTHEMES.map((s) => ({ subtheme: s.key, revision: s.revision }));

describe('subtheme table', () => {
  it('assigns every catalog data phase to exactly one subtheme', () => {
    const data = CATALOG_PHASE_ORDER.filter((p) => p !== 'init' && p !== 'finalize');
    const owned = SUBTHEMES.flatMap((s) => [...s.phases]);
    expect([...owned].sort()).toEqual([...data].sort());
    expect(new Set(owned).size).toBe(owned.length);
  });

  it('has unique keys and positive revisions', () => {
    expect(new Set(SUBTHEME_KEYS).size).toBe(SUBTHEME_KEYS.length);
    for (const s of SUBTHEMES) expect(s.revision).toBeGreaterThan(0);
  });

  it('keeps silhouettes and hulls out of the catalog subthemes', () => {
    expect(CATALOG_SUBTHEMES).not.toContain('silhouettes');
    expect(CATALOG_SUBTHEMES).not.toContain('hulls');
    expect(CATALOG_SUBTHEMES).toContain('ships');
  });
});

describe('planSubthemes', () => {
  it('skips every subtheme the ledger holds at the current revision', () => {
    const plan = planSubthemes({ buildNumber: '9876543', ledger: allHeld(), force: false });
    expect(plan.reason).toBe('ledger');
    expect(plan.pending).toEqual([]);
    expect(plan.skip).toEqual([...SUBTHEME_KEYS]);
  });

  it('runs a subtheme whose revision was bumped since its upload', () => {
    const revisions = { ...currentRevisions(), ships: currentRevisions().ships + 1 };
    const plan = planSubthemes({ buildNumber: '1', ledger: allHeld(), force: false, revisions });
    expect(plan.pending).toEqual(['ships']);
  });

  it('runs subthemes missing from the ledger (new build)', () => {
    const plan = planSubthemes({ buildNumber: '1', ledger: [], force: false });
    expect(plan.reason).toBe('ledger');
    expect(plan.skip).toEqual([]);
  });

  it('skips nothing when unsure or forced', () => {
    expect(planSubthemes({ buildNumber: '', ledger: allHeld(), force: false }).reason).toBe('unknown-build');
    expect(planSubthemes({ buildNumber: null, ledger: allHeld(), force: false }).skip).toEqual([]);
    expect(planSubthemes({ buildNumber: '1', ledger: null, force: false }).reason).toBe('no-ledger');
    const forced = planSubthemes({ buildNumber: '1', ledger: allHeld(), force: true });
    expect(forced.reason).toBe('force');
    expect(forced.skip).toEqual([]);
  });

  it('maps skipped subthemes to their catalog phases', () => {
    expect(phasesOf(['weapons', 'hulls'])).toEqual(['codex_weapons', 'codex_ammunition']);
    expect(phasesOf([])).toEqual([]);
  });
});

describe('build number + auto-run candidates', () => {
  it('reads RequestedP4ChangeNum from build_manifest.id', () => {
    const raw = '{"Data":{"Branch":"sc-alpha-4.3.1","RequestedP4ChangeNum":"9876543","Tag":"public"}}';
    expect(parseBuildNumber(raw)).toBe('9876543');
    expect(parseBuildNumber('4.3.1.12345')).toBeNull();
  });

  it('only offers installs with version AND build number, by channel priority', () => {
    const ch = (channel: DiscoveredChannel['channel'], buildNumber: string | null): DiscoveredChannel => ({
      channel,
      installPath: `C:/SC/${channel}`,
      dataP4kPath: `C:/SC/${channel}/Data.p4k`,
      version: '4.3.1',
      buildNumber,
      sizeBytes: 1,
      source: 'rsi-launcher',
    });
    const picked = pickSubthemeCandidates([ch('PTU', '2'), ch('LIVE', '1'), ch('EPTU', null)]);
    expect(picked.map((c) => c.channel)).toEqual(['LIVE', 'PTU']);
  });
});

describe('ledger client', () => {
  const opts = (fetchImpl: typeof fetch) => ({ apiBase: 'https://x.test', anonKey: 'anon', accessToken: 'jwt', fetchImpl });
  const key = { channel: 'LIVE', patchVersion: '4.3.1', buildNumber: '9876543' };

  it('returns rows on success and null on failure', async () => {
    const ok = (async () => new Response(JSON.stringify([{ subtheme: 'ships', revision: 1 }, { bogus: true }]))) as unknown as typeof fetch;
    expect(await fetchLedger(opts(ok), key)).toEqual([{ subtheme: 'ships', revision: 1 }]);
    const bad = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    expect(await fetchLedger(opts(bad), key)).toBeNull();
    const thrown = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await fetchLedger(opts(thrown), key)).toBeNull();
    expect(await fetchLedger(opts(ok), { ...key, buildNumber: '' })).toBeNull();
  });

  it('records the current revision of each landed subtheme', async () => {
    let body: Record<string, unknown> = {};
    const capture = (async (_url: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response('1');
    }) as unknown as typeof fetch;
    expect(await recordLedger(opts(capture), key, ['ships', 'hulls'], '0.124.0')).toBe(true);
    expect(body['p_revisions']).toEqual({ ships: currentRevisions().ships, hulls: currentRevisions().hulls });
    expect(body['p_build_number']).toBe('9876543');
    expect(await recordLedger(opts(capture), key, [], '0.124.0')).toBe(false);
  });
});
