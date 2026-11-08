import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { ShellChromeService } from '../../shell/fusion-bar/shell-chrome.service';
import { fakeSupabase } from '../../testing/fake-supabase';
import { HqEinsatzService } from '../data/hq-einsatz.service';
import { EventHqService } from '../events/event-hq.service';
import { normalizeSheet } from '../events/event-sheet';
import { NachschubFocusService } from '../nachschub/nachschub-focus.service';
import { NachschubNamingService } from '../nachschub/nachschub-naming';
import type { Nachschub, WishPosition } from '../nachschub/nachschub.model';
import { NachschubService } from '../nachschub/nachschub.service';
import { litCubes } from '../nachschub/nachschub-crate.component';
import { HqNeedSourcesService } from './hq-need-sources.service';
import { HqNachschubArchiveDialogComponent, HqNachschubRemoveDialogComponent } from './hq-nachschub-dialogs.component';
import { HqNachschubBoardComponent } from './hq-nachschub-board.component';
import { HqNachschubFlowComponent } from './hq-nachschub-flow.component';
import { HqNachschubPanelComponent, goodsOf, systemsOf } from './hq-nachschub-panel.component';

const nach = (id: string, name: string, slot: number | null, status: 'active' | 'archived' = 'active'): Nachschub => ({
  id,
  name,
  status,
  slot,
  snapshot: {},
  createdAt: '2026-11-07T10:00:00Z',
  archivedAt: status === 'archived' ? '2026-11-07T12:00:00Z' : null,
});

const click = (f: { detectChanges(): void }, el: Element | null) => {
  (el as HTMLElement).click();
  f.detectChanges();
};

describe('crate fill', () => {
  it('lights cubes with progress, at least one once anything is done', () => {
    expect(litCubes(0, 8)).toBe(0);
    expect(litCubes(1, 100)).toBe(1);
    expect(litCubes(4, 9)).toBe(5);
    expect(litCubes(5, 5)).toBe(12);
    expect(litCubes(3, 0)).toBe(0);
  });
});

describe('Nachschub board, panel and dialogs', () => {
  function setup() {
    TestBed.resetTestingModule();
    localStorage.removeItem('sc.hq.nachschub.focus');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService(),
        fakeSupabase().provider,
        { provide: AuthService, useValue: { user: signal(null) } },
      ],
    });
    return TestBed.inject(NachschubService);
  }

  it('board: oldest first, exactly one plus, all seven places always shown, the archive with its count', () => {
    const svc = setup();
    svc.packages.set([nach('a', 'Rattler-Vorrat', 1), nach('b', 'Medpens', 3), nach('old', 'Altes', null, 'archived')]);
    const f = TestBed.createComponent(HqNachschubBoardComponent);
    f.componentRef.setInput('selectedId', 'a');
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const slots = el.querySelectorAll('.board .slot');
    expect(slots.length).toBe(7);
    expect(slots[0].classList).toContain('on');
    expect(slots[0].querySelector('.name')?.textContent).toBe('Rattler-Vorrat');
    expect(slots[1].querySelector('.name')?.textContent).toBe('Medpens');
    expect(slots[2].classList).toContain('free');
    expect(el.querySelectorAll('.slot.free').length).toBe(1);
    // The places after the one plus are quiet outlines, not buttons.
    expect([...slots].slice(3).every((x) => x.classList.contains('ghost'))).toBe(true);
    expect(el.querySelectorAll('.slot.ghost button').length).toBe(0);
    expect(el.querySelector('.board > li:last-child .archive')).not.toBeNull();
    expect(el.querySelector('.teaser')).toBeNull();
    f.componentRef.setInput('eventAvailable', true);
    f.detectChanges();
    expect(el.querySelector('.slot.free .teaser')).not.toBeNull();
    expect(el.querySelector('.archive b')?.textContent).toBe('1');
    // Separate objects: each slot is its own card with a gap between them, not one strip.
    expect(el.querySelectorAll('.slot sc-nachschub-crate').length).toBe(2);
  });

  it('board: a free slot starts a new Nachschub, the trash button asks to delete, the archive opens', () => {
    const svc = setup();
    svc.packages.set([nach('a', 'Rattler-Vorrat', 1)]);
    const f = TestBed.createComponent(HqNachschubBoardComponent);
    f.detectChanges();
    const calls: string[] = [];
    f.componentInstance.create.subscribe(() => calls.push('create'));
    f.componentInstance.remove.subscribe((id) => calls.push(`remove:${id}`));
    f.componentInstance.openArchive.subscribe(() => calls.push('archive'));
    const el = f.nativeElement as HTMLElement;
    click(f, el.querySelector('.slot.free .hit'));
    click(f, el.querySelector('.slot .del'));
    click(f, el.querySelector('.archive'));
    expect(calls).toEqual(['create', 'remove:a', 'archive']);
  });

  it('board: a finished Nachschub reads as done', () => {
    const svc = setup();
    svc.packages.set([nach('a', 'Titan-Erz', 1)]);
    vi.spyOn(svc, 'evaluation').mockReturnValue({ statuses: new Map(), snapshot: {}, snapshotChanged: false, closeIds: [], progress: { done: 5, total: 5 }, finished: true });
    const f = TestBed.createComponent(HqNachschubBoardComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('.slot.done')).not.toBeNull();
    expect(el.querySelector('sc-nachschub-crate.full')).not.toBeNull();
  });

  it('panel: Einsätze first with goods as chips, the route beside them, no "Jetzt" / "Leeren" in the header', () => {
    const svc = setup();
    svc.packages.set([nach('a', 'Rattler-Vorrat', 1)]);
    const einsatz = TestBed.inject(HqEinsatzService);
    const st = (kind: 'buy' | 'mine' | 'craft', label: string, qty: number | null, location: string | null, system: string | null) => ({
      kind, label, location, system, className: label.toLowerCase(), qty, supplyId: null, missionRef: null,
    });
    einsatz.create({ title: 'Einkauf Area18', packageId: 'a', steps: [st('buy', 'Rattler', 6, 'Area18', 'Stanton'), st('buy', 'Medpen', 12, 'Area18', 'Stanton')] });
    einsatz.create({ title: 'Craften', packageId: 'a', steps: [st('craft', 'Gallant', 2, null, null)] });
    const f = TestBed.createComponent(HqNachschubPanelComponent);
    f.componentRef.setInput('nachschub', svc.packages()[0]);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const cards = el.querySelectorAll('.ecard');
    expect(cards.length).toBe(2);
    expect(cards[0].querySelector('.pick')?.textContent).toBe('Einkauf Area18');
    expect([...cards[0].querySelectorAll('.good')].map((g) => g.textContent?.trim())).toEqual(['6× Rattler', '12× Medpen']);
    expect(el.querySelector('sc-hq-route-graphic')).not.toBeNull();
    // Jetzt runs the Nachschub picked here by itself, and an emptied Nachschub is a deleted one: neither is a button.
    const acts = [...el.querySelectorAll('.acts [scAction]')].map((b) => b.textContent ?? '');
    expect(acts.some((t) => t.includes('hq.panel.run') || t.includes('hq.panel.empty') || t.includes('hq.einsatz.add.action'))).toBe(false);
    // "Einsatz hinzufügen" sits inline after the cards, not as a header action.
    expect(el.querySelector('.cards .add-e')).not.toBeNull();
    // Picking the second Einsatz moves the route.
    click(f, cards[1].querySelector('.pick'));
    expect(cards[1].classList).toContain('on');
  });

  it('panel: renames in place and keeps the name within 28 characters', async () => {
    const svc = setup();
    svc.packages.set([nach('a', 'Rattler-Vorrat', 1)]);
    const spy = vi.spyOn(svc, 'rename').mockResolvedValue(true);
    const f = TestBed.createComponent(HqNachschubPanelComponent);
    f.componentRef.setInput('nachschub', svc.packages()[0]);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    click(f, el.querySelector('.name .pen'));
    const input = el.querySelector('input.rename') as HTMLInputElement;
    expect(input.maxLength).toBe(28);
    input.value = 'Ein viel zu langer Name, der nie passt, oder doch';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    f.detectChanges();
    expect(spy).toHaveBeenCalled();
    expect((vi.mocked(spy).mock.lastCall![1] as string).length).toBeLessThanOrEqual(28);
  });

  it('panel: the rename field takes the focus when it appears and the pen gets it back afterwards', async () => {
    const svc = setup();
    svc.packages.set([nach('a', 'Rattler-Vorrat', 1)]);
    vi.spyOn(svc, 'rename').mockResolvedValue(true);
    const f = TestBed.createComponent(HqNachschubPanelComponent);
    f.componentRef.setInput('nachschub', svc.packages()[0]);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    click(f, el.querySelector('.name .pen'));
    await f.whenStable();
    f.detectChanges();
    const input = el.querySelector('input.rename') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect(el.querySelector('input.rename')).toBeNull();
    expect(document.activeElement).toBe(el.querySelector('.name .pen'));
  });

  describe('Einsatz names', () => {
    const one = (title: string) => ({
      title,
      packageId: 'a',
      steps: [{ kind: 'buy' as const, label: 'X', location: null, system: null, className: 'x', qty: 1, supplyId: null, missionRef: null }],
    });
    function mountPanel() {
      const svc = setup();
      svc.packages.set([nach('a', 'Rattler-Vorrat', 1)]);
      const einsatz = TestBed.inject(HqEinsatzService);
      einsatz.create(one('Einkauf'));
      const f = TestBed.createComponent(HqNachschubPanelComponent);
      f.componentRef.setInput('nachschub', svc.packages()[0]);
      f.detectChanges();
      return { f, el: f.nativeElement as HTMLElement, einsatz };
    }
    const key = (input: HTMLInputElement, k: string) => input.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
    const type = (input: HTMLInputElement, v: string) => {
      input.value = v;
      input.dispatchEvent(new Event('input'));
    };

    it('renames an Einsatz in its card: 40 characters, Enter saves, the pen gets the focus back', async () => {
      const { f, el, einsatz } = mountPanel();
      click(f, el.querySelector('.ecard .epen'));
      await f.whenStable();
      f.detectChanges();
      const input = el.querySelector('input.erename') as HTMLInputElement;
      expect(input.maxLength).toBe(40);
      expect(document.activeElement).toBe(input);
      type(input, 'Alles bei Area18 kaufen');
      key(input, 'Enter');
      f.detectChanges();
      await f.whenStable();
      f.detectChanges();
      expect(einsatz.ofPackage('a')[0].title).toBe('Alles bei Area18 kaufen');
      expect(el.querySelector('.ecard .pick')?.textContent).toBe('Alles bei Area18 kaufen');
      expect(document.activeElement).toBe(el.querySelector('.ecard .epen'));
    });

    it('Escape drops the edit; a blank name is not saved and says why', () => {
      const { f, el, einsatz } = mountPanel();
      click(f, el.querySelector('.ecard .epen'));
      let input = el.querySelector('input.erename') as HTMLInputElement;
      type(input, 'Anders');
      key(input, 'Escape');
      f.detectChanges();
      expect(einsatz.ofPackage('a')[0].title).toBe('Einkauf');
      expect(el.querySelector('input.erename')).toBeNull();
      click(f, el.querySelector('.ecard .epen'));
      input = el.querySelector('input.erename') as HTMLInputElement;
      type(input, '   ');
      key(input, 'Enter');
      f.detectChanges();
      expect(el.querySelector('.eerr')?.textContent).toContain('hq.einsatz.rename.empty');
      expect(einsatz.ofPackage('a')[0].title).toBe('Einkauf');
    });

    it('"Einsatz hinzufügen" is guided: what you do, to what, where and how many make one Einsatz with one step', async () => {
      const { f, el, einsatz } = mountPanel();
      vi.spyOn(TestBed.inject(NachschubNamingService), 'einsatzName').mockResolvedValue('Medpens kaufen');
      click(f, el.querySelector('.cards .add-e'));
      const form = el.querySelector('form.addform') as HTMLFormElement;
      expect(form).not.toBeNull();
      const save = form.querySelector('button[type="submit"]') as HTMLButtonElement;
      // Buying needs a thing and a place.
      expect(save.disabled).toBe(true);
      type(form.querySelector('.af-input') as HTMLInputElement, 'Medpen');
      f.detectChanges();
      expect(save.disabled).toBe(true);
      // A mission may leave the place open.
      const mission = [...form.querySelectorAll('.seg button')].find((b) => b.textContent?.includes('hq.step.kind.mission'))!;
      click(f, mission);
      expect(save.disabled).toBe(false);
      const more = form.querySelectorAll('.stepper .step')[1] as HTMLButtonElement;
      click(f, more);
      click(f, save);
      await f.whenStable();
      f.detectChanges();
      const list = einsatz.ofPackage('a');
      expect(list.map((e) => e.title)).toEqual(['Einkauf', 'Medpens kaufen']);
      expect(list[1].steps.map((x) => ({ kind: x.kind, label: x.label, qty: x.qty }))).toEqual([{ kind: 'mission', label: 'Medpen', qty: 2 }]);
      expect(el.querySelector('form.addform')).toBeNull();
    });

    it('cancelling the guided form adds nothing', () => {
      const { f, el, einsatz } = mountPanel();
      click(f, el.querySelector('.cards .add-e'));
      type(el.querySelector('form.addform .af-input') as HTMLInputElement, 'Fracht');
      f.detectChanges();
      const cancel = [...el.querySelectorAll('form.addform .af-acts button')].find((b) => b.textContent?.includes('common.dialog.cancel'))!;
      click(f, cancel);
      expect(el.querySelector('form.addform')).toBeNull();
      expect(einsatz.ofPackage('a').length).toBe(1);
    });
  });

  it('panel: a Nachschub without Einsätze offers to propose them (opens the flow on its Einsätze, step 2)', () => {
    const svc = setup();
    svc.packages.set([nach('a', 'Leer', 1)]);
    const f = TestBed.createComponent(HqNachschubPanelComponent);
    f.componentRef.setInput('nachschub', svc.packages()[0]);
    f.detectChanges();
    const steps: number[] = [];
    f.componentInstance.edit.subscribe((s) => steps.push(s));
    click(f, (f.nativeElement as HTMLElement).querySelector('.none button'));
    expect(steps).toEqual([2]);
  });

  it('panel: marks a place that also serves another Nachschub and switches to it on click', () => {
    const svc = setup();
    svc.packages.set([nach('a', 'Eins', 1), nach('b', 'Zwei', 2)]);
    const einsatz = TestBed.inject(HqEinsatzService);
    const st = (location: string) => ({ kind: 'buy' as const, label: 'X', location, system: 'Stanton', className: 'x', qty: 1, supplyId: null, missionRef: null });
    einsatz.create({ title: 'A', packageId: 'a', steps: [st('Area18')] });
    einsatz.create({ title: 'B', packageId: 'b', steps: [st('Area18')] });
    const f = TestBed.createComponent(HqNachschubPanelComponent);
    f.componentRef.setInput('nachschub', svc.packages()[0]);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const hint = el.querySelector('.shared') as SVGGElement;
    expect(hint).not.toBeNull();
    hint.dispatchEvent(new Event('click'));
    expect(TestBed.inject(NachschubFocusService).selected()?.id).toBe('b');
  });

  it('goods and systems of an Einsatz', () => {
    const steps = [
      { kind: 'buy', label: 'Medpen', className: 'medpen', qty: 2, state: 'done', system: 'Stanton' },
      { kind: 'buy', label: 'Medpen', className: 'medpen', qty: 3, state: 'todo', system: 'Stanton' },
      { kind: 'mine', label: 'Titan', className: 'titan', qty: null, state: 'done', system: 'Pyro' },
      { kind: 'transport', label: 'Jump', className: null, qty: null, state: 'todo', system: null },
    ] as never;
    expect(goodsOf({ steps })).toEqual([
      { label: 'Medpen', qty: 5, done: false },
      { label: 'Titan', qty: 1, done: true },
    ]);
    expect(systemsOf({ steps })).toEqual(['Stanton', 'Pyro']);
  });

  it('remove dialog: the "back to the wishlist" choice starts on and is handed back', () => {
    setup();
    const f = TestBed.createComponent(HqNachschubRemoveDialogComponent);
    f.componentRef.setInput('name', 'Rattler-Vorrat');
    f.componentRef.setInput('open', 3);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const got: boolean[] = [];
    f.componentInstance.confirmed.subscribe((b) => got.push(b));
    expect(el.querySelector('.hint')?.textContent).toContain('hq.remove.backOn');
    click(f, el.querySelector('.dlg-foot button:last-child'));
    click(f, el.querySelector('.opt sc-tristate button'));
    expect(el.querySelector('.hint')?.textContent).toContain('hq.remove.backOff');
    click(f, el.querySelector('.dlg-foot button:last-child'));
    expect(got).toEqual([true, false]);
  });

  it('remove dialog: with nothing open there is no choice to make', () => {
    setup();
    const f = TestBed.createComponent(HqNachschubRemoveDialogComponent);
    f.componentRef.setInput('name', 'Leer');
    f.componentRef.setInput('open', 0);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('.opt')).toBeNull();
  });

  it('archive dialog: reactivation is blocked while all seven slots are active', () => {
    const svc = setup();
    svc.packages.set([...Array.from({ length: 7 }, (_, i) => nach(`n${i}`, `N${i}`, i + 1)), nach('old', 'Altes', null, 'archived')]);
    const f = TestBed.createComponent(HqNachschubArchiveDialogComponent);
    f.detectChanges();
    const btn = (f.nativeElement as HTMLElement).querySelector('.list button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});

describe('HqNachschubFlowComponent', () => {
  const w = (kind: string, className: string, qty: number, forClassName: string | null = null, name: string | null = null): WishPosition => ({
    kind,
    className,
    name: name ?? className,
    qty,
    forClassName,
  });
  const WISH = [w('item', 'medpen', 12, null, 'Medpen'), w('blueprint', 'gallant', 2, null, 'Gallant'), w('material', 'aluminium', 16, 'gallant', 'Aluminium')];

  function setup(wish: WishPosition[] = WISH, sources = new Map<string, unknown>(), drain = false) {
    TestBed.resetTestingModule();
    // The real service empties the wishlist of what it took; `drain` makes the fake do the same (H5).
    const live = signal<readonly WishPosition[]>(wish);
    const created = vi.fn().mockName('createFromWishlist').mockImplementation(async () => {
      if (drain) live.set([]);
      return { ok: true, key: 'hq.nachschub.done.created', id: 'new' };
    });
    const fake = {
      wishPositions: () => live(),
      packages: signal<Nachschub[]>([]),
      linesOf: () => [],
      createFromWishlist: created,
      rename: vi.fn().mockName('rename').mockResolvedValue(true),
      addFromWishlist: vi.fn().mockName('addFromWishlist'),
      removeLine: vi.fn().mockName('removeLine'),
    };
    const startSearch = vi.fn().mockName('startSupplySearch');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService(),
        fakeSupabase().provider,
        { provide: AuthService, useValue: { user: signal(null) } },
        { provide: NachschubService, useValue: fake },
        { provide: NachschubNamingService, useValue: { nachschubName: () => Promise.resolve('Gallant-Ausrüstung'), einsatzName: () => Promise.resolve('Ein Einsatz') } },
        { provide: HqNeedSourcesService, useValue: { ensure: () => undefined, sources: signal(sources) } },
        { provide: ShellChromeService, useValue: { startSupplySearch: startSearch } },
      ],
    });
    const f = TestBed.createComponent(HqNachschubFlowComponent);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, created, startSearch };
  }

  function setupEdit() {
    TestBed.resetTestingModule();
    const fake = {
      wishPositions: () => [] as WishPosition[],
      packages: signal<Nachschub[]>([{ ...nach('n1', 'Bestehend', 1), type: 'event', eventId: 'ev0' }]),
      linesOf: () => [{ id: 'line1', className: 'ARGO_KEELBACK' }],
      createFromWishlist: vi.fn().mockName('createFromWishlist'),
      rename: vi.fn().mockName('rename').mockResolvedValue(true),
      addFromWishlist: vi.fn().mockName('addFromWishlist').mockResolvedValue({ ok: true, key: 'hq.nachschub.done.added', id: 'n1' }),
      removeLine: vi.fn().mockName('removeLine'),
    };
    const reward = { id: 'r1', name: 'Keelback', className: 'ARGO_KEELBACK', variant: null, channel: 'pledge', timing: { kind: 'immediate', date: null }, trackId: null, tier: null };
    const sheet = normalizeSheet({ schema: 1, fields: { rewards: { value: [reward], confidence: 1, source: 'admin', review: 'approved' } } });
    const row = { id: 'ev', name: 'Ev', startDate: '2000-01-01', endDate: '2999-12-31', dateStatus: 'confirmed', status: 'scheduled', hidden: false, freeFly: false, sheet };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService(),
        fakeSupabase().provider,
        { provide: AuthService, useValue: { user: signal(null) } },
        { provide: NachschubService, useValue: fake },
        { provide: EventHqService, useValue: { open: signal([{ event: row, end: { at: '2999-12-31', basis: 'official' }, state: 'open' }]), ensure: () => undefined } },
        { provide: NachschubNamingService, useValue: { nachschubName: () => Promise.resolve('x'), einsatzName: () => Promise.resolve('Ein Einsatz') } },
        { provide: HqNeedSourcesService, useValue: { ensure: () => undefined, sources: signal(new Map()) } },
        { provide: ShellChromeService, useValue: { startSupplySearch: () => undefined } },
      ],
    });
    const f = TestBed.createComponent(HqNachschubFlowComponent);
    f.componentRef.setInput('mode', 'edit');
    f.componentRef.setInput('nachschubId', 'n1');
    f.detectChanges();
    return { f, fake };
  }

  const whenIdle = async (f: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    await f.whenStable();
    f.detectChanges();
  };

  it('edit: adding an event binds its rewards as lines with their own event step', async () => {
    const { f, fake } = setupEdit();
    const einsatz = TestBed.inject(HqEinsatzService);
    const create = vi.spyOn(einsatz, 'create').mockReturnValue(null);
    const cmp = f.componentInstance as unknown as { eventPicks: { set(v: unknown): void }; name: { set(v: string): void }; save(): Promise<void> };
    cmp.eventPicks.set(new Map([['ev', new Set(['r1'])]]));
    cmp.name.set('Bestehend');
    await cmp.save();
    const args = vi.mocked(fake.addFromWishlist).mock.lastCall! as [string, unknown[], { eventId: string; className: string }[]];
    expect(args[0]).toBe('n1');
    expect(args[1]).toEqual([]);
    expect(args[2].map((r) => [r.eventId, r.className])).toEqual([['ev', 'ARGO_KEELBACK']]);
    const steps = vi.mocked(create).mock.lastCall![0].steps;
    expect(steps.map((s) => [s.kind, s.eventId, s.className])).toEqual([['event', 'ev', 'ARGO_KEELBACK']]);
  });

  it('step 1 shows the Wunschliste under its own title with its own search, also when it is empty', () => {
    const { el, startSearch } = setup([]);
    expect(el.querySelector('.wishsec h3')?.textContent?.trim()).toBe('hq.flow.wishTitle');
    expect(el.querySelector('.wishsec sc-hq-wish-search input[type="search"]')).not.toBeNull();
    expect(el.querySelector('.wishsec .dlg-msg')?.textContent).toContain('hq.flow.emptyWish');
    // Searching happens in place: the flow is never left for the shell's search.
    expect(startSearch).not.toHaveBeenCalled();
  });

  it('a hit put on the wishlist from the flow search is ticked at once', () => {
    const { f, el } = setup();
    (f.componentInstance as unknown as { onWishAdded(a: { kind: string; className: string; name: string }): void }).onWishAdded({ kind: 'item', className: 'medpen', name: 'Medpen' });
    f.detectChanges();
    expect(el.querySelectorAll('.grp li.on').length).toBe(1);
  });

  it('the name sits on top of step 1 and only the X, Abbrechen or Escape close the flow', () => {
    const { f, el } = setup();
    expect(el.querySelector('.name-field input')).not.toBeNull();
    let closes = 0;
    f.componentInstance.closed.subscribe(() => closes++);
    click(f, el.querySelector('.scrim'));
    expect(closes).toBe(0);
    click(f, el.querySelector('.dlg-head [scAction]'));
    expect(closes).toBe(1);
  });

  it('step 1 groups the wishlist (items first, the blueprint group last) and "Alles" picks it all', () => {
    const { f, el } = setup();
    expect([...el.querySelectorAll('.grp h3')].map((h) => h.textContent?.trim())).toEqual(['hq.flow.group.items', 'Gallant']);
    click(f, el.querySelector('.pick-bar button'));
    expect(el.querySelector('.tally')?.textContent).toContain('hq.flow.picked');
    expect(el.querySelectorAll('.grp li.on').length).toBe(3);
    // Next stays off until something is picked.
    expect((el.querySelector('.dlg-foot button:last-child') as HTMLButtonElement).disabled).toBe(false);
  });

  it('cannot go on without a pick', () => {
    const { el } = setup();
    expect((el.querySelector('.dlg-foot button:last-child') as HTMLButtonElement).disabled).toBe(true);
  });

  it('walks the two steps and creates the Nachschub with its Einsätze, crafting last', async () => {
    const { f, el, created } = setup();
    const einsatz = TestBed.inject(HqEinsatzService);
    const done: unknown[] = [];
    f.componentInstance.done.subscribe((r) => done.push(r));
    click(f, el.querySelector('.pick-bar button'));
    click(f, el.querySelector('.dlg-foot button:last-child')); // Weiter
    await whenIdle(f);
    expect(el.querySelectorAll('.steps li').length).toBe(2);
    expect(el.querySelector('.steps li.on b')?.textContent).toBe('2');
    expect((el.querySelector('.name-field input') as HTMLInputElement).value).toBe('Gallant-Ausrüstung');
    expect(el.querySelector('.einsatz-head small')?.textContent).toContain('hq.flow.einsatzCount');
    const cards = [...el.querySelectorAll('.ecard')];
    expect(cards.length).toBeGreaterThanOrEqual(2);
    expect(cards[cards.length - 1].classList).toContain('last');
    // Material can be switched between buying and mining.
    expect(el.querySelectorAll('.mats').length).toBe(2);
    expect(el.querySelectorAll('.mats li').length).toBe(2);
    // The item has no merchant and no blueprint here: no placeless buy step, a way out instead (W5.4/W5.5).
    const item = [...el.querySelectorAll('.mats li')].find((li) => li.textContent?.includes('Medpen'))!;
    expect(item.textContent).toContain('hq.flow.noMerchant');
    expect(item.querySelector('sc-select')).not.toBeNull();
    expect(item.querySelector('button.leave')).not.toBeNull();
    expect(el.querySelectorAll('.ecard').length).toBe(cards.length);

    click(f, el.querySelector('.dlg-foot button:last-child')); // Nachschub anlegen
    await whenIdle(f);
    expect(created).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(created).mock.lastCall![0] as { picks: { key: string; qty: number }[]; name: string };
    expect(arg.name).toBe('Gallant-Ausrüstung');
    expect(arg.picks.map((p) => p.key).sort()).toEqual(['blueprint:gallant', 'item:medpen', 'material:aluminium@gallant']);
    expect(einsatz.ofPackage('new').length).toBe(cards.length);
    expect(einsatz.ofPackage('new').at(-1)?.steps[0].kind).toBe('craft');
    expect(done.length).toBe(1);
  });

  it('H5: the Einsätze are written from the proposal as it was BEFORE the wishlist emptied', async () => {
    const { f, el, created } = setup(WISH, new Map(), true);
    const einsatz = TestBed.inject(HqEinsatzService);
    click(f, el.querySelector('.pick-bar button'));
    click(f, el.querySelector('.dlg-foot button:last-child'));
    await whenIdle(f);
    const cards = el.querySelectorAll('.ecard').length;
    expect(cards).toBeGreaterThanOrEqual(2);
    click(f, el.querySelector('.dlg-foot button:last-child')); // Nachschub anlegen: the wishlist is empty from here on
    await whenIdle(f);
    expect(created).toHaveBeenCalledTimes(1);
    expect(einsatz.ofPackage('new').length).toBe(cards);
    expect(einsatz.ofPackage('new').every((e) => e.steps.length > 0)).toBe(true);
  });

  async function toStep2(r: ReturnType<typeof setup>) {
    click(r.f, r.el.querySelector('.pick-bar button'));
    click(r.f, r.el.querySelector('.dlg-foot button:last-child'));
    await whenIdle(r.f);
  }
  const itemRow = (el: HTMLElement) => [...el.querySelectorAll('.mats li')].find((li) => li.textContent?.includes('Medpen'))!;

  it('W5.4: a craftable item without a merchant is crafted by default; the line offers only what is available', async () => {
    const r = setup(WISH, new Map([['medpen', { state: 'ready', kind: 'item', options: [], craftable: true }]]));
    await toStep2(r);
    const row = itemRow(r.el);
    expect([...row.querySelectorAll('.seg button')].map((b) => b.textContent?.trim())).toEqual(['hq.step.kind.craft']);
    expect(row.textContent).not.toContain('hq.flow.noMerchant');
    expect(r.el.querySelector('.ecard.last')).not.toBeNull();
  });

  it('W5.5: a line without a merchant can get a place of its own, or be taken out of the Einsatz and put back', async () => {
    const r = setup(WISH, new Map([['medpen', { state: 'ready', kind: 'item', options: [] }]]));
    await toStep2(r);
    const cardsBefore = r.el.querySelectorAll('.ecard').length;
    let row = itemRow(r.el);
    expect(row.querySelector('a[href*="/codex/item/medpen"]')).not.toBeNull();
    expect(row.querySelector('sc-select')).not.toBeNull();
    // Set the place: the line turns into a buy step there.
    const sel = r.f.debugElement.query((d) => d.nativeElement === row.querySelector('sc-select')).componentInstance as { valueChange: { emit(v: string | null): void } };
    sel.valueChange.emit('stanton/arccorp/area18');
    r.f.detectChanges();
    row = itemRow(r.el);
    expect(row.textContent).not.toContain('hq.flow.noMerchant');
    expect([...r.el.querySelectorAll('.ecard')].some((c) => c.textContent?.includes('area18') || c.textContent?.includes('Area18'))).toBe(true);
    // Take it out: no buy Einsatz is left for it, and it can come back.
    click(r.f, row.querySelector('button.leave'));
    row = itemRow(r.el);
    expect(row.classList).toContain('out');
    expect(r.el.querySelectorAll('.ecard').length).toBeLessThan(cardsBefore + 1);
    click(r.f, row.querySelector('button[scaction], button'));
    expect(itemRow(r.el).classList).not.toContain('out');
  });

  it('splitting a quantity takes only that part into the Einsätze', async () => {
    const { f, el } = setup();
    click(f, el.querySelector('.grp li sc-tristate button'));
    const more = [...el.querySelectorAll('.grp li .step')];
    click(f, more[0]); // less
    click(f, el.querySelector('.dlg-foot button:last-child'));
    await whenIdle(f);
    expect(itemRow(el).textContent).toContain('×11');
  });

  it('crafting an item checks its blueprint and material and plans what is missing', async () => {
    const recipe = { blueprintClassName: 'bp_medpen', blueprintName: 'Medpen-Blaupause', ingredients: [{ className: 'chem', name: 'Chemikalie', qty: 2 }] };
    const r = setup([w('item', 'medpen', 3, null, 'Medpen')], new Map([['medpen', { state: 'ready', kind: 'item', options: [], craftable: true, recipe }]]));
    await toStep2(r);
    const row = itemRow(r.el);
    expect(row.querySelector('.craft')?.textContent).toContain('hq.flow.craft.bpMissing');
    expect(row.querySelector('.craft')?.textContent).toContain('hq.flow.craft.matMissing');
    // The missing material is a line of its own for the item; a mission earns the blueprint; crafting is last.
    const chem = [...r.el.querySelectorAll('.mats li')].find((li) => li.textContent?.includes('Chemikalie'))!;
    expect(chem.textContent).toContain('×6');
    expect(chem.textContent).toContain('hq.flow.craft.forItem');
    const cards = [...r.el.querySelectorAll('.cards .ecard')];
    expect(cards.length).toBe(3);
    expect(cards[cards.length - 1].classList).toContain('last');
  });

  describe('edit mode: Einsätze for the lines a Nachschub already has', () => {
    const line = (id: string, kind: string, className: string, qty: number, forClassName: string | null, done = false) => ({
      id, name: className, qty, done, entityKind: kind, className, forClassName,
    });
    const LINES = [line('l1', 'blueprint', 'gallant', 2, null), line('l2', 'material', 'aluminium', 16, 'gallant'), line('l3', 'material', 'titan', 4, null, true)];

    function setupEdit(lines: unknown[], withEinsatz = false) {
      TestBed.resetTestingModule();
      const fake = {
        wishPositions: () => [],
        packages: signal<Nachschub[]>([nach('p1', 'Gallant-Ausrüstung', 1)]),
        linesOf: () => lines,
        rename: vi.fn().mockName('rename').mockResolvedValue(true),
        addFromWishlist: vi.fn().mockName('addFromWishlist'),
        removeLine: vi.fn().mockName('removeLine'),
      };
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          provideTranslateService(),
          fakeSupabase().provider,
          { provide: AuthService, useValue: { user: signal(null) } },
          { provide: NachschubService, useValue: fake },
          { provide: NachschubNamingService, useValue: { nachschubName: () => Promise.resolve('X'), einsatzName: () => Promise.resolve('Mein Einsatz') } },
          { provide: HqNeedSourcesService, useValue: { ensure: () => undefined, sources: signal(new Map<string, unknown>()) } },
          { provide: ShellChromeService, useValue: { startSupplySearch: () => undefined } },
        ],
      });
      const einsatz = TestBed.inject(HqEinsatzService);
      if (withEinsatz) {
        einsatz.create({ title: 'Schon da', packageId: 'p1', steps: [{ kind: 'buy', label: 'A', location: null, system: null, className: 'a', qty: 1, supplyId: null, missionRef: null }] });
      }
      const f = TestBed.createComponent(HqNachschubFlowComponent);
      f.componentRef.setInput('mode', 'edit');
      f.componentRef.setInput('nachschubId', 'p1');
      f.componentRef.setInput('startStep', 2);
      f.detectChanges();
      return { f, el: f.nativeElement as HTMLElement, einsatz };
    }

    it('proposes Einsätze from the open lines when the Nachschub has none, and writes them on save', async () => {
      const { f, el, einsatz } = setupEdit(LINES);
      await whenIdle(f);
      expect(el.querySelector('.dlg-msg')).toBeNull();
      const cards = el.querySelectorAll('.ecard:not(.have-card)');
      expect(cards.length).toBeGreaterThan(0);
      // Only the open lines count: the ticked titan line is not proposed again.
      expect(el.textContent).not.toContain('titan');
      click(f, el.querySelector('.dlg-foot button:last-child'));
      await whenIdle(f);
      const made = einsatz.ofPackage('p1');
      expect(made.length).toBe(cards.length);
      expect(made.flatMap((e) => e.steps).every((s) => s.supplyId === 'l1' || s.supplyId === 'l2' || s.supplyId === null)).toBe(true);
    });

    it('proposes nothing new once the Nachschub has Einsätze', async () => {
      const { f, el } = setupEdit(LINES, true);
      await whenIdle(f);
      expect(el.querySelector('.dlg-msg')?.textContent).toContain('hq.flow.noNewLines');
      expect(el.querySelectorAll('.ecard:not(.have-card)').length).toBe(0);
      expect(el.querySelectorAll('.have-card').length).toBe(1);
    });
  });

  it('new mode shows the slot number only while a slot is free (never a taken one)', () => {
    const { f, el } = setup();
    expect(el.querySelector('.dlg-title small')?.textContent).toContain('hq.flow.slotOf');
    const fake = TestBed.inject(NachschubService) as unknown as { packages: { set(v: Nachschub[]): void } };
    fake.packages.set(Array.from({ length: 7 }, (_, i) => nach(`n${i}`, `N${i}`, i + 1)));
    f.detectChanges();
    expect(el.querySelector('.dlg-title small')).toBeNull();
  });

  it('a blueprint follows its material when only part of the material is taken (2x becomes 1x)', () => {
    const { f, el } = setup();
    const groups = [...el.querySelectorAll('.grp')];
    click(f, groups[1].querySelector('header sc-tristate button'));
    const aluminium = groups[1].querySelectorAll('li')[1];
    for (let i = 0; i < 8; i++) click(f, aluminium.querySelector('.stepper .step'));
    const bp = groups[1].querySelectorAll('li')[0];
    expect(bp.querySelector('.stepper .n')?.textContent?.trim()).toContain('1');
  });
});
