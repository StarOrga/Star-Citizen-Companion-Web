import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { NachschubNamingService } from './nachschub-naming';
import { fallbackEinsatzName, fallbackNachschubName } from './nachschub-fallback-names';

describe('nachschub-naming fallbacks', () => {
  it('Nachschub: one item, two items, many items, none', () => {
    expect(fallbackNachschubName([{ name: 'Rattler II', qty: 4 }], 'Neuer Nachschub')).toBe('Rattler II');
    expect(fallbackNachschubName([{ name: 'Medpen', qty: 1 }, { name: 'Gallant', qty: 2 }], 'x')).toBe('Gallant + Medpen');
    const many = fallbackNachschubName(
      [{ name: 'Rattler II', qty: 9 }, { name: 'Pembroke Helm', qty: 3 }, { name: 'Medpen', qty: 2 }, { name: 'Gallant', qty: 1 }],
      'x',
    );
    expect(many.endsWith(' +2')).toBe(true);
    expect(many.length).toBeLessThanOrEqual(28);
    expect(fallbackNachschubName([], 'Neuer Nachschub')).toBe('Neuer Nachschub');
  });

  it('Nachschub names never exceed 28 characters', () => {
    const long = fallbackNachschubName([{ name: 'Ein sehr langer Gegenstandsname mit vielen Woertern', qty: 1 }], 'x');
    expect(Array.from(long).length).toBeLessThanOrEqual(28);
  });

  it('Einsatz: the most frequent step kind phrased with its first label, within 40', () => {
    const verb = (k: string, label: string) => `${label} ${({ mine: 'abbauen', buy: 'kaufen' } as Record<string, string>)[k] ?? k}`;
    const name = fallbackEinsatzName(
      [{ kind: 'buy', label: 'Medpens' }, { kind: 'mine', label: 'Titan-Erz' }, { kind: 'mine', label: 'Quantanium' }],
      verb,
      'Neuer Einsatz',
    );
    expect(name).toBe('Titan-Erz abbauen');
    expect(fallbackEinsatzName([], verb, 'Neuer Einsatz')).toBe('Neuer Einsatz');
    expect(Array.from(fallbackEinsatzName([{ kind: 'buy', label: 'x'.repeat(100) }], verb, 'd')).length).toBeLessThanOrEqual(40);
  });
});

describe('NachschubNamingService', () => {
  function mount() {
    const invoke = vi.fn().mockResolvedValue({ data: { status: 'no_key' }, error: null });
    TestBed.configureTestingModule({
      providers: [provideTranslateService(), { provide: SupabaseClientProvider, useValue: { client: { functions: { invoke } } } }],
    });
    return { svc: TestBed.inject(NachschubNamingService), invoke };
  }

  it('names an item-less Nachschub after its event, without asking the model', async () => {
    const { svc, invoke } = mount();
    expect(await svc.nachschubName([], 'Day of the Vara 2956')).toBe('Day of the Vara 2956');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('never falls back to the generic new-Nachschub label', async () => {
    const { svc } = mount();
    const name = await svc.nachschubName([]);
    expect(name).toBe('hq.nachschub.dayName');
    expect(name).not.toContain('newName');
  });

  it('uses the rule-based name when the model gives none', async () => {
    const { svc } = mount();
    expect(await svc.nachschubName([{ name: 'Rattler II', qty: 4 }], 'Event')).toBe('Rattler II');
  });
});
