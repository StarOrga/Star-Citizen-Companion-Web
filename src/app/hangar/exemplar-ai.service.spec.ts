import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { ExemplarAiService, loadoutHash, EXEMPLAR_NAME_TIMEOUT_MS } from './exemplar-ai.service';

const L = (portName: string, className: string) => ({ portName, className, kind: 'weapon' });
const changes = [{ slot: 'Waffe 1', from: 'Omnisky VI', to: 'Laser Repeater S3' }];

describe('loadoutHash', () => {
  it('is stable, order independent and sensitive to a swapped part', () => {
    const a = loadoutHash([L('p1', 'A'), L('p2', 'B')]);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(loadoutHash([L('p2', 'B'), L('p1', 'A')])).toBe(a);
    expect(loadoutHash([L('p1', 'A'), L('p2', 'C')])).not.toBe(a);
    expect(loadoutHash([])).toBe(loadoutHash([]));
  });
  it('ignores the display kind', () => {
    const x = { portName: 'p', className: 'A', kind: 'x' };
    const y = { portName: 'p', className: 'A', kind: 'y' };
    expect(loadoutHash([x])).toBe(loadoutHash([y]));
  });
});

describe('ExemplarAiService', () => {
  function mount(opts: { data?: unknown; invokeError?: unknown; stored?: Record<string, unknown> | null; updateError?: unknown; readError?: unknown } = {}) {
    const invoke = vi.fn().mockResolvedValue({
      data: opts.data ?? { ok: true, status: 'generated', text: 'Laser-Jäger' },
      error: opts.invokeError ?? null,
    });
    const eqUpdate = vi.fn().mockResolvedValue({ error: opts.updateError ?? null });
    const update = vi.fn().mockReturnValue({ eq: eqUpdate });
    const maybeSingle = vi.fn().mockResolvedValue({ data: opts.stored ?? null, error: opts.readError ?? null });
    const select = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle }) });
    const from = vi.fn().mockReturnValue({ select, update });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideTranslateService({ fallbackLang: 'de' }), { provide: SupabaseClientProvider, useValue: { client: { functions: { invoke }, from } } }],
    });
    return { svc: TestBed.inject(ExemplarAiService), invoke, update, eqUpdate, select };
  }
  const loadout = [L('p1', 'A')];

  it('suggestName: no call when nothing differs, text when generated, null on any non-text status', async () => {
    const m = mount();
    expect(await m.svc.suggestName('Gladius', [])).toBeNull();
    expect(m.invoke).not.toHaveBeenCalled();
    expect(await m.svc.suggestName('Gladius', changes)).toBe('Laser-Jäger');
    expect(m.invoke).toHaveBeenCalledWith('exemplar-ai', { body: { kind: 'exemplar_name', locale: 'de', ship: 'Gladius', changes }, signal: expect.any(AbortSignal) });
    const n = mount({ data: { ok: true, status: 'no_key' } });
    expect(await n.svc.suggestName('Gladius', changes)).toBeNull();
  });

  it('suggestName: a function that does not answer within 2 s yields null and the request is aborted (D8)', async () => {
    vi.useFakeTimers();
    try {
      const m = mount();
      let signal: AbortSignal | undefined;
      m.invoke.mockImplementation((_name: string, opts: { signal: AbortSignal }) => {
        signal = opts.signal;
        return new Promise(() => undefined);
      });
      const pending = m.svc.suggestName('Gladius', changes);
      await vi.advanceTimersByTimeAsync(EXEMPLAR_NAME_TIMEOUT_MS);
      expect(await pending).toBeNull();
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('suggestName: a failing call yields null, never throws', async () => {
    const m = mount({ invokeError: new Error('boom') });
    expect(await m.svc.suggestName('Gladius', changes)).toBeNull();
  });

  it('ensureSummary: same hash -> no call, no write, stored text returned', async () => {
    const m = mount();
    const r = await m.svc.ensureSummary('c1', { shipName: 'Gladius', loadout, changes, stored: { summary: 'alt', hash: loadoutHash(loadout) } });
    expect(r).toEqual({ summary: 'alt', hash: loadoutHash(loadout), regenerated: false, errorKey: null });
    expect(m.invoke).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it('ensureSummary: different hash -> one call, text and hash written, clamped to 90', async () => {
    const m = mount({ data: { ok: true, status: 'generated', text: 'x'.repeat(200) } });
    const r = await m.svc.ensureSummary('c1', { shipName: 'Gladius', loadout, changes, stored: { summary: 'alt', hash: 'other' } });
    expect(r.regenerated).toBe(true);
    expect(Array.from(r.summary ?? '').length).toBe(90);
    expect(m.invoke).toHaveBeenCalledTimes(1);
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ ai_summary: r.summary, ai_summary_hash: loadoutHash(loadout) }));
    expect(m.eqUpdate).toHaveBeenCalledWith('id', 'c1');
  });

  it('ensureSummary: missing summary columns are detected once, then never queried again', async () => {
    const m = mount({ readError: { code: '42703', message: 'column hangar_ship_configs.ai_summary does not exist' } });
    const first = await m.svc.ensureSummary('c1', { shipName: 'Gladius', loadout, changes });
    expect(first).toEqual({ summary: null, hash: loadoutHash(loadout), regenerated: false, errorKey: null });
    await m.svc.ensureSummary('c2', { shipName: 'Gladius', loadout, changes });
    await m.svc.ensureSummary('c3', { shipName: 'Gladius', loadout, changes, stored: { summary: null, hash: 'other' } });
    expect(m.select).toHaveBeenCalledTimes(1);
    expect(m.invoke).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it('ensureSummary: reads the stored hash itself when the caller gives none', async () => {
    const m = mount({ stored: { ai_summary: 'alt', ai_summary_hash: loadoutHash(loadout) } });
    const r = await m.svc.ensureSummary('c1', { shipName: 'Gladius', loadout, changes });
    expect(r.summary).toBe('alt');
    expect(m.invoke).not.toHaveBeenCalled();
  });

  it('ensureSummary: identical to Werk -> no call, a leftover summary is cleared', async () => {
    const m = mount();
    const r = await m.svc.ensureSummary('c1', { shipName: 'Gladius', loadout, changes: [], stored: { summary: 'alt', hash: 'other' } });
    expect(r.summary).toBeNull();
    expect(m.invoke).not.toHaveBeenCalled();
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ ai_summary: null, ai_summary_hash: loadoutHash(loadout) }));
  });

  it('ensureSummary: graceful status keeps the old text and writes nothing', async () => {
    const m = mount({ data: { ok: true, status: 'rate_limited' } });
    const r = await m.svc.ensureSummary('c1', { shipName: 'Gladius', loadout, changes, stored: { summary: 'alt', hash: 'other' } });
    expect(r).toMatchObject({ summary: 'alt', regenerated: false, errorKey: null });
    expect(m.update).not.toHaveBeenCalled();
  });

  it('ensureSummary: a failed write maps to an errors.* key, no throw', async () => {
    const m = mount({ updateError: { message: 'denied', code: '42501' } });
    const r = await m.svc.ensureSummary('c1', { shipName: 'Gladius', loadout, changes, stored: { summary: null, hash: null } });
    expect(r.errorKey).toMatch(/^errors\./);
    expect(r.regenerated).toBe(false);
  });

  it('ensureSummary: concurrent calls for one exemplar share one request', async () => {
    const m = mount();
    const input = { shipName: 'Gladius', loadout, changes, stored: { summary: null, hash: null } };
    await Promise.all([m.svc.ensureSummary('c1', input), m.svc.ensureSummary('c1', input)]);
    expect(m.invoke).toHaveBeenCalledTimes(1);
  });
});
