import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { ShellChromeService } from '../../shell/fusion-bar/shell-chrome.service';
import { fakeSupabase } from '../../testing/fake-supabase';
import { HqEinsatzService } from '../data/hq-einsatz.service';
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

  it('board: oldest first, exactly one plus, the archive with its count', () => {
    const svc = setup();
    svc.packages.set([nach('a', 'Rattler-Vorrat', 1), nach('b', 'Medpens', 3), nach('old', 'Altes', null, 'archived')]);
    const f = TestBed.createComponent(HqNachschubBoardComponent);
    f.componentRef.setInput('selectedId', 'a');
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const slots = el.querySelectorAll('.board .slot');
    expect(slots.length).toBe(3);
    expect(slots[0].classList).toContain('on');
    expect(slots[0].querySelector('.name')?.textContent).toBe('Rattler-Vorrat');
    expect(slots[1].querySelector('.name')?.textContent).toBe('Medpens');
    expect(slots[2].classList).toContain('free');
    expect(el.querySelectorAll('.slot.free').length).toBe(1);
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
    spyOn(svc, 'evaluation').and.returnValue({ statuses: new Map(), snapshot: {}, snapshotChanged: false, closeIds: [], progress: { done: 5, total: 5 }, finished: true });
    const f = TestBed.createComponent(HqNachschubBoardComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('.slot.done')).not.toBeNull();
    expect(el.querySelector('sc-nachschub-crate.full')).not.toBeNull();
  });

  it('panel: Einsätze first with goods as chips, the route beside them, "Jetzt" as the one primary', () => {
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
    expect(el.querySelectorAll('[scAction][class*="primary"], .sc-action--primary').length).toBe(1);
    // Picking the second Einsatz moves the route.
    click(f, cards[1].querySelector('.pick'));
    expect(cards[1].classList).toContain('on');
  });

  it('panel: renames in place and keeps the name within 28 characters', async () => {
    const svc = setup();
    svc.packages.set([nach('a', 'Rattler-Vorrat', 1)]);
    const spy = spyOn(svc, 'rename').and.resolveTo(true);
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
    expect((spy.calls.mostRecent().args[1] as string).length).toBeLessThanOrEqual(28);
  });

  it('panel: a Nachschub without Einsätze offers to propose them (opens the flow on step 3)', () => {
    const svc = setup();
    svc.packages.set([nach('a', 'Leer', 1)]);
    const f = TestBed.createComponent(HqNachschubPanelComponent);
    f.componentRef.setInput('nachschub', svc.packages()[0]);
    f.detectChanges();
    const steps: number[] = [];
    f.componentInstance.edit.subscribe((s) => steps.push(s));
    click(f, (f.nativeElement as HTMLElement).querySelector('.none button'));
    expect(steps).toEqual([3]);
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
    expect(btn.disabled).toBeTrue();
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

  function setup(wish: WishPosition[] = WISH, sources = new Map<string, unknown>()) {
    TestBed.resetTestingModule();
    const created = jasmine.createSpy('createFromWishlist').and.callFake(async () => ({ ok: true, key: 'hq.nachschub.done.created', id: 'new' }));
    const fake = {
      wishPositions: () => wish,
      packages: signal<Nachschub[]>([]),
      linesOf: () => [],
      createFromWishlist: created,
      rename: jasmine.createSpy('rename').and.resolveTo(true),
      addFromWishlist: jasmine.createSpy('addFromWishlist'),
      removeLine: jasmine.createSpy('removeLine'),
    };
    const startSearch = jasmine.createSpy('startSupplySearch');
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

  const whenIdle = async (f: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    await f.whenStable();
    f.detectChanges();
  };

  it('step 1 on an empty wishlist explains and leads to filling it', () => {
    const { f, el, startSearch } = setup([]);
    expect(el.querySelector('.empty')).not.toBeNull();
    click(f, el.querySelector('.empty button'));
    expect(startSearch).toHaveBeenCalled();
  });

  it('step 1 groups the wishlist (items first, the blueprint group last) and "Alles" picks it all', () => {
    const { f, el } = setup();
    expect([...el.querySelectorAll('.grp h3')].map((h) => h.textContent?.trim())).toEqual(['hq.flow.group.items', 'Gallant']);
    click(f, el.querySelector('.pick-bar button'));
    expect(el.querySelector('.tally')?.textContent).toContain('hq.flow.picked');
    expect(el.querySelectorAll('.grp li.on').length).toBe(3);
    // Next stays off until something is picked.
    expect((el.querySelector('.dlg-foot button:last-child') as HTMLButtonElement).disabled).toBeFalse();
  });

  it('cannot go on without a pick', () => {
    const { el } = setup();
    expect((el.querySelector('.dlg-foot button:last-child') as HTMLButtonElement).disabled).toBeTrue();
  });

  it('walks the three steps and creates the Nachschub with its Einsätze, crafting last', async () => {
    const { f, el, created } = setup();
    const einsatz = TestBed.inject(HqEinsatzService);
    const done: unknown[] = [];
    f.componentInstance.done.subscribe((r) => done.push(r));
    click(f, el.querySelector('.pick-bar button'));
    click(f, el.querySelector('.dlg-foot button:last-child')); // Weiter
    await whenIdle(f);
    expect(el.querySelector('.steps li.on b')?.textContent).toBe('2');
    expect((el.querySelector('.name-field input') as HTMLInputElement).value).toBe('Gallant-Ausrüstung');
    click(f, el.querySelector('.dlg-foot button:last-child'));
    await whenIdle(f);
    expect(el.querySelector('.steps li.on b')?.textContent).toBe('3');
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
    const arg = created.calls.mostRecent().args[0] as { picks: { key: string; qty: number }[]; name: string };
    expect(arg.name).toBe('Gallant-Ausrüstung');
    expect(arg.picks.map((p) => p.key).sort()).toEqual(['blueprint:gallant', 'item:medpen', 'material:aluminium@gallant']);
    expect(einsatz.ofPackage('new').length).toBe(cards.length);
    expect(einsatz.ofPackage('new').at(-1)?.steps[0].kind).toBe('craft');
    expect(done.length).toBe(1);
  });

  async function toStep3(r: ReturnType<typeof setup>) {
    click(r.f, r.el.querySelector('.pick-bar button'));
    click(r.f, r.el.querySelector('.dlg-foot button:last-child'));
    await whenIdle(r.f);
    click(r.f, r.el.querySelector('.dlg-foot button:last-child'));
    await whenIdle(r.f);
  }
  const itemRow = (el: HTMLElement) => [...el.querySelectorAll('.mats li')].find((li) => li.textContent?.includes('Medpen'))!;

  it('W5.4: a craftable item without a merchant is crafted by default; the line offers only what is available', async () => {
    const r = setup(WISH, new Map([['medpen', { state: 'ready', kind: 'item', options: [], craftable: true }]]));
    await toStep3(r);
    const row = itemRow(r.el);
    expect([...row.querySelectorAll('.seg button')].map((b) => b.textContent?.trim())).toEqual(['hq.step.kind.craft']);
    expect(row.textContent).not.toContain('hq.flow.noMerchant');
    expect(r.el.querySelector('.ecard.last')).not.toBeNull();
  });

  it('W5.5: a line without a merchant can get a place of its own, or be taken out of the Einsatz and put back', async () => {
    const r = setup(WISH, new Map([['medpen', { state: 'ready', kind: 'item', options: [] }]]));
    await toStep3(r);
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
    expect([...r.el.querySelectorAll('.ecard')].some((c) => c.textContent?.includes('area18') || c.textContent?.includes('Area18'))).toBeTrue();
    // Take it out: no buy Einsatz is left for it, and it can come back.
    click(r.f, row.querySelector('button.leave'));
    row = itemRow(r.el);
    expect(row.classList).toContain('out');
    expect(r.el.querySelectorAll('.ecard').length).toBeLessThan(cardsBefore + 1);
    click(r.f, row.querySelector('button[scaction], button'));
    expect(itemRow(r.el).classList).not.toContain('out');
  });

  it('splitting a quantity keeps the rest on the wishlist and shows it in the summary', async () => {
    const { f, el } = setup();
    click(f, el.querySelector('.grp li sc-tristate button'));
    const more = [...el.querySelectorAll('.grp li .step')];
    click(f, more[0]); // less
    click(f, el.querySelector('.dlg-foot button:last-child'));
    await whenIdle(f);
    expect(el.querySelector('.rest .chips li')?.textContent).toContain('Medpen');
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
