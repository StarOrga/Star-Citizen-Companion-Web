import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { HqEinsatzService } from '../data/hq-einsatz.service';
import type { Nachschub, NachschubLineInput } from './nachschub.model';
import { NachschubService } from './nachschub.service';
import { NachschubTargetDialogComponent } from './nachschub-target-dialog.component';
import { gatherStopIndex, moveLineStop, routeOrdered, targetsFor } from './nachschub-target.util';

function pkg(id: string, slot: number | null, extra: Partial<Nachschub> = {}): Nachschub {
  return { id, name: `N-${id}`, status: slot === null ? 'archived' : 'active', slot, snapshot: {}, createdAt: '2026-11-08T00:00:00Z', archivedAt: null, ...extra };
}

const AGRICIUM: NachschubLineInput = {
  name: 'Agricium',
  className: 'agricium',
  amount: 10,
  unit: 'scu',
  stops: [
    { location: 'Port Tressler', amount: 3, done: false },
    { location: 'Area18', amount: 4, done: false },
    { location: 'Lorville', amount: 3, done: false },
  ],
};

describe('Nachschub target util', () => {
  const all = [
    pkg('a', 2),
    pkg('b', 1, { type: 'verkauf', goalAuec: 100, progressAuec: 0 }),
    pkg('c', 3, { type: 'event' }),
    pkg('d', null),
    pkg('e', 4, { type: 'normal' }),
  ];

  it('offers active normal Nachschübe for a pick-up and buy, in slot order', () => {
    expect(targetsFor('pickup', all).map((n) => n.id)).toEqual(['a', 'e']);
    expect(targetsFor('buy', all).map((n) => n.id)).toEqual(['a', 'e']);
  });

  it('offers only Verkauf Nachschübe for a sale', () => {
    expect(targetsFor('sell', all).map((n) => n.id)).toEqual(['b']);
  });

  it('orders a gather route by amount, largest first, and lets the player move a stop', () => {
    const ordered = routeOrdered([AGRICIUM]);
    expect(ordered[0].stops!.map((s) => s.location)).toEqual(['Area18', 'Lorville', 'Port Tressler']);
    const moved = moveLineStop(ordered, 0, 2, 0);
    expect(moved[0].stops!.map((s) => s.location)).toEqual(['Port Tressler', 'Area18', 'Lorville']);
  });

  it('finds the stop a Jetzt step stands for', () => {
    const stops = [
      { location: 'Area18', done: true },
      { location: 'Lorville', done: false },
    ];
    expect(gatherStopIndex(stops, 'lorville', true)).toBe(1);
    expect(gatherStopIndex(stops, 'Area18', false)).toBe(0);
    expect(gatherStopIndex(stops, 'Area18', true)).toBeNull();
    expect(gatherStopIndex(stops, null, true)).toBeNull();
  });
});

describe('NachschubTargetDialogComponent', () => {
  const packages = signal<readonly Nachschub[]>([]);
  const result = { ok: true, key: 'hq.nachschub.done.added', id: 'a' };
  let addToNachschub: jasmine.Spy;
  let createSellNachschub: jasmine.Spy;
  let einsatzCreate: jasmine.Spy;

  function setup(intent: 'pickup' | 'sell' | 'buy', lines: NachschubLineInput[] = [AGRICIUM]) {
    addToNachschub = jasmine.createSpy('addToNachschub').and.resolveTo(result);
    createSellNachschub = jasmine.createSpy('createSellNachschub').and.resolveTo({ ...result, id: 'new1' });
    einsatzCreate = jasmine.createSpy('create').and.returnValue(null);
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService(),
        {
          provide: NachschubService,
          useValue: {
            packages,
            ensureLoaded: () => Promise.resolve(),
            addToNachschub,
            createSellNachschub,
            linesOf: () => [{ id: 'L1', name: 'Agricium', className: 'agricium' }],
          },
        },
        { provide: HqEinsatzService, useValue: { create: einsatzCreate } },
      ],
    });
    const fixture = TestBed.createComponent(NachschubTargetDialogComponent);
    fixture.componentRef.setInput('intent', intent);
    fixture.componentRef.setInput('lines', lines);
    const closed: unknown[] = [];
    fixture.componentInstance.closed.subscribe((v) => closed.push(v));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, closed };
  }

  const radios = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLButtonElement>('[role=radio]'));
  const primary = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('footer button[tier=primary], footer button:last-child')!;

  beforeEach(() => packages.set([pkg('a', 1), pkg('b', 2, { type: 'verkauf', goalAuec: 500, progressAuec: 0 })]));

  it('lists "new" plus every active Nachschub of the matching kind as targets', () => {
    const { el } = setup('pickup');
    expect(radios(el).length).toBe(2);
    expect(radios(el)[0].getAttribute('aria-checked')).toBe('true');
  });

  it('adds a pick-up to an existing Nachschub and writes the route as one Einsatz of pickup steps', async () => {
    const { fixture, el, closed } = setup('pickup');
    radios(el)[1].click();
    fixture.detectChanges();
    primary(el).click();
    await fixture.whenStable();
    expect(addToNachschub).toHaveBeenCalledWith('a', jasmine.any(Array));
    const sent = addToNachschub.calls.mostRecent().args[1] as NachschubLineInput[];
    expect(sent[0].stops!.map((s) => s.location)).toEqual(['Area18', 'Lorville', 'Port Tressler']);
    expect(einsatzCreate).toHaveBeenCalled();
    const steps = einsatzCreate.calls.mostRecent().args[0].steps as { kind: string; location: string; supplyId: string }[];
    expect(steps.map((s) => s.location)).toEqual(['Area18', 'Lorville', 'Port Tressler']);
    expect(steps.every((s) => s.kind === 'pickup' && s.supplyId === 'L1')).toBeTrue();
    expect(closed).toEqual([{ nachschubId: 'a', created: false }]);
  });

  it('adds repeatedly to the same Nachschub (no new one is created)', async () => {
    const { fixture, el } = setup('buy', [{ name: 'Medpen', className: 'medpen', amount: 2, unit: 'pcs' }]);
    radios(el)[1].click();
    fixture.detectChanges();
    primary(el).click();
    await fixture.whenStable();
    primary(el).click();
    await fixture.whenStable();
    expect(addToNachschub).toHaveBeenCalledTimes(2);
    expect(einsatzCreate).not.toHaveBeenCalled();
  });

  it('asks the aUEC goal for a sale into a new Nachschub and rejects an unusable goal', async () => {
    const { fixture, el, closed } = setup('sell');
    expect(el.querySelector('input.input')).not.toBeNull();
    const input = el.querySelector<HTMLInputElement>('input.input')!;
    input.value = 'abc';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    primary(el).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(createSellNachschub).not.toHaveBeenCalled();
    expect(el.textContent).toContain('hq.nachschub.sellGoalInvalid');
    input.value = '1.500.000';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    primary(el).click();
    await fixture.whenStable();
    expect(createSellNachschub).toHaveBeenCalledWith(1500000, jasmine.any(Array), { name: 'hq.nachschub.target.sellName' });
    expect(closed).toEqual([{ nachschubId: 'new1', created: true }]);
  });

  it('offers the existing Verkauf Nachschub for a sale and needs no goal then', async () => {
    const { fixture, el } = setup('sell');
    const sellTargets = radios(el);
    expect(sellTargets.length).toBe(2);
    sellTargets[1].click();
    fixture.detectChanges();
    expect(el.querySelector('input.input')).toBeNull();
    primary(el).click();
    await fixture.whenStable();
    expect(addToNachschub).toHaveBeenCalledWith('b', jasmine.any(Array));
  });

  it('shows a translated key when the write fails', async () => {
    const { fixture, el, closed } = setup('pickup');
    addToNachschub.and.resolveTo({ ok: false, key: 'hq.nachschub.slotsFull' });
    radios(el)[1].click();
    fixture.detectChanges();
    primary(el).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('hq.nachschub.slotsFull');
    expect(closed).toEqual([]);
  });

  it('blocks "new" and falls back to an existing Nachschub when all 7 slots are in use', () => {
    packages.set(Array.from({ length: 7 }, (_, i) => pkg(`s${i}`, i + 1)));
    const { el } = setup('pickup');
    expect(radios(el)[0].disabled).toBeTrue();
    expect(radios(el)[1].getAttribute('aria-checked')).toBe('true');
  });
});
