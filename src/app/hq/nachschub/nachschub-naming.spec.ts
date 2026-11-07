import { fallbackEinsatzName, fallbackNachschubName } from './nachschub-fallback-names';

describe('nachschub-naming fallbacks', () => {
  it('Nachschub: one item, two items, many items, none', () => {
    expect(fallbackNachschubName([{ name: 'Rattler II', qty: 4 }], 'Neuer Nachschub')).toBe('Rattler II');
    expect(fallbackNachschubName([{ name: 'Medpen', qty: 1 }, { name: 'Gallant', qty: 2 }], 'x')).toBe('Gallant + Medpen');
    const many = fallbackNachschubName(
      [{ name: 'Rattler II', qty: 9 }, { name: 'Pembroke Helm', qty: 3 }, { name: 'Medpen', qty: 2 }, { name: 'Gallant', qty: 1 }],
      'x',
    );
    expect(many.endsWith(' +2')).toBeTrue();
    expect(many.length).toBeLessThanOrEqual(28);
    expect(fallbackNachschubName([], 'Neuer Nachschub')).toBe('Neuer Nachschub');
  });

  it('Nachschub names never exceed 28 characters', () => {
    const long = fallbackNachschubName([{ name: 'Ein sehr langer Gegenstandsname mit vielen Woertern', qty: 1 }], 'x');
    expect(Array.from(long).length).toBeLessThanOrEqual(28);
  });

  it('Einsatz: verb of the most frequent step kind plus its first label, within 40', () => {
    const verb = (k: string) => ({ mine: 'abbauen', buy: 'kaufen' })[k] ?? k;
    const name = fallbackEinsatzName(
      [{ kind: 'buy', label: 'Medpens' }, { kind: 'mine', label: 'Titan-Erz' }, { kind: 'mine', label: 'Quantanium' }],
      verb,
      'Neuer Einsatz',
    );
    expect(name).toBe('abbauen Titan-Erz');
    expect(fallbackEinsatzName([], verb, 'Neuer Einsatz')).toBe('Neuer Einsatz');
    expect(Array.from(fallbackEinsatzName([{ kind: 'buy', label: 'x'.repeat(100) }], verb, 'd')).length).toBeLessThanOrEqual(40);
  });
});
