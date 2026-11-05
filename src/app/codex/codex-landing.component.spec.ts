import { ComponentFixture, TestBed, discardPeriodicTasks, fakeAsync, flush, tick } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexLandingComponent, ROTATION_MS } from './codex-landing.component';
import { CodexLandingDataService } from './landing/codex-landing-data.service';
import { LandingCodex, LandingItem, LandingPaint, PatchSummaryView } from './landing/codex-landing-data.types';
import { BetaService } from '../core/beta.service';
import { CodexService } from './codex.service';
import { CLAIM_MS } from './landing/codex-landing-claims';

function item(over: Partial<LandingItem> & { className: string; category: LandingItem['category'] }): LandingItem {
  const kind = over.category === 'component' ? 'component' : over.category === 'armor' ? 'item' : 'weapon';
  return {
    kind,
    name: over.className,
    eyebrow: { manufacturer: 'Behring', descriptor: null },
    detailRoute: ['/codex', kind, over.className],
    imageUrl: null,
    previewUrl: null,
    overview: [
      { id: 'type', value: 'Rifle' },
      { id: 'size', value: null },
      { id: 'manufacturer', value: 'Behring' },
    ],
    topValues: [
      { key: 'weaponParams.damage', value: 42, unit: null },
      { key: 'weaponParams.fireRate', value: 600, unit: null },
      { key: 'weaponParams.range', value: 80, unit: null },
      { key: 'weaponParams.ammo', value: 30, unit: null },
    ],
    ...over,
  };
}

function paint(i: number): LandingPaint {
  return {
    id: `p${i}`,
    name: `Paint ${i}`,
    imageUrl: `https://media.example.com/p${i}.jpg`,
    rsiUrl: `https://robertsspaceindustries.com/paint/${i}`,
    recencyAt: '2026-10-01T00:00:00Z',
    isNew: i === 1,
  };
}

class FakeData {
  readonly error = signal<string | null>(null);
  readonly summary = signal<PatchSummaryView | null>(null);
  readonly patchSummary = computed(() => this.summary());
  readonly unread = signal(false);
  readonly newsUnread = computed(() => this.unread());
  items: LandingItem[] = [];
  paintList: LandingPaint[] = [];
  markNewsSeen = jasmine.createSpy('markNewsSeen');
  itemByClass = jasmine.createSpy('itemByClass').and.callFake(async (category: LandingItem['category'], className: string) =>
    item({ category, className, name: 'Picked ' + className, fresh: true }),
  );
  rotationItems = jasmine.createSpy('rotationItems').and.callFake(async () => this.items);
  news: LandingCodex = {
    patch: '4.3',
    categories: [
      {
        category: 'fpsWeapon',
        count: 12,
        entries: [
          { id: 'BEHR_Rifle', name: 'BEHR_Rifle', route: ['/codex', 'weapon', 'BEHR_Rifle'], announced: false },
          { id: 'KSAR_Smg', name: 'Karna SMG', route: ['/codex', 'weapon', 'KSAR_Smg'], announced: false },
        ],
        more: 10,
        announced: 0,
      },
      { category: 'armor', count: 8, entries: [], more: 0, announced: 0 },
      { category: 'component', count: 31, entries: [], more: 0, announced: 0 },
      {
        category: 'ship',
        count: 14,
        entries: [{ id: 'polaris', name: 'RSI Polaris', route: ['/codex', 'upcoming', 'polaris'], announced: true }],
        more: 9,
        announced: 1,
      },
    ],
  };
  codexNews = jasmine.createSpy('codexNews').and.callFake(async () => this.news);
  paintsFor = jasmine.createSpy('paintsFor').and.callFake(async () => this.paintList);
  loadPatchSummary = jasmine.createSpy('loadPatchSummary').and.callFake(async () => this.summary());
}

describe('CodexLandingComponent', () => {
  let data: FakeData;
  let fixture: ComponentFixture<CodexLandingComponent>;
  let el: HTMLElement;

  function setup(items: LandingItem[]): void {
    data = new FakeData();
    data.items = items;
    TestBed.configureTestingModule({
      imports: [CodexLandingComponent],
      providers: [
        provideRouter([]),
        provideTranslateService(),
        { provide: CodexLandingDataService, useValue: data },
        { provide: CodexService, useValue: { silhouette: async () => null } },
        { provide: BetaService, useValue: { isEnabled: () => signal(true) } },
      ],
    });
    fixture = TestBed.createComponent(CodexLandingComponent);
    fixture.componentInstance.still.set(false);
    fixture.componentInstance.hidden.set(false);
    el = fixture.nativeElement as HTMLElement;
  }

  function settle(): void {
    tick();
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
  }

  const three = () => [
    item({ category: 'fpsWeapon', className: 'BEHR_Rifle' }),
    item({ category: 'armor', className: 'CDS_Heavy_Core' }),
    item({ category: 'component', className: 'POWR_S2' }),
  ];

  const piece = () => el.querySelector<HTMLElement>('.piece:not(.leaving)')!;

  it('renders hero, Kennung + hologram as anchors, Codex list with keybindings last and nothing removed coming back', fakeAsync(() => {
    setup(three());
    settle();
    expect(el.querySelector('h1')).not.toBeNull();
    expect(el.querySelector('[scStageSearch]')).not.toBeNull();
    expect(piece().querySelector<HTMLAnchorElement>('a.k-name')!.getAttribute('href')).toBe('/codex/weapon/BEHR_Rifle');
    expect(piece().querySelector<HTMLAnchorElement>('a.holo')!.getAttribute('href')).toBe('/codex/weapon/BEHR_Rifle');
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('sc-codex-landing-codex-pane a'));
    expect(links[links.length - 1].getAttribute('href')).toBe('/codex/keybinds');
    expect(el.querySelector<HTMLAnchorElement>('sc-codex-landing-values-pane a.go')!.getAttribute('href')).toBe('/codex/weapon/BEHR_Rifle');
    // Removed parts (round 4: no filmstrip, no Datenkarte; brief A9 earlier).
    for (const sel of ['sc-codex-landing-filmstrip', 'sc-codex-landing-card', 'sc-codex-stage', 'sc-codex-compare-tray', 'sc-upcoming-teaser']) {
      expect(el.querySelector(sel)).withContext(sel).toBeNull();
    }
    flush();
  }));

  it('rotates every ROTATION_MS, holds on a Codex row click and resumes on the second click', fakeAsync(() => {
    setup(three());
    settle();
    const cmp = fixture.componentInstance;
    expect(cmp.active()).toBe(0);
    tick(ROTATION_MS);
    fixture.detectChanges();
    expect(cmp.active()).toBe(1);
    expect(cmp.switchNo()).toBe(1);

    const rows = () => el.querySelectorAll<HTMLButtonElement>('sc-codex-landing-codex-pane button.tab');
    rows()[2].click();
    fixture.detectChanges();
    expect(cmp.active()).toBe(2);
    expect(cmp.held()).toBeTrue();
    expect(rows()[2].getAttribute('aria-pressed')).toBe('true');
    tick(ROTATION_MS * 2);
    fixture.detectChanges();
    expect(cmp.active()).withContext('held').toBe(2);

    rows()[2].click();
    fixture.detectChanges();
    expect(cmp.held()).toBeFalse();
    expect(cmp.active()).toBe(0);
    discardPeriodicTasks();
    flush();
  }));

  it('Codex list: counts per category, the item on the table marked, search link and "Alle" filter', fakeAsync(() => {
    setup(three());
    settle();
    const pane = el.querySelector<HTMLElement>('sc-codex-landing-codex-pane')!;
    expect(pane.querySelector('.ph')!.textContent).toContain('codex.landing.codex.title');
    expect(pane.querySelectorAll('.tabs .tab').length).toBe(4);
    expect(pane.querySelector('.open .sum')!.textContent).toContain('codex.landing.codex.count');
    const open = pane.querySelector<HTMLElement>('.open')!;
    const entries = Array.from(open.querySelectorAll<HTMLAnchorElement>('.new a.ent'));
    expect(entries.length).toBe(2);
    expect(entries[0].closest('li')!.classList).toContain('table');
    expect(entries[0].querySelector('.here')).not.toBeNull();
    expect(entries[1].querySelector('.here')).toBeNull();
    expect(open.querySelector<HTMLAnchorElement>('a.more')!.getAttribute('href')).toBe('/codex/index?kind=weapon&weaponClass=FPS&sort=new');
    expect(open.querySelector<HTMLAnchorElement>('a.all')!.getAttribute('href')).toBe('/codex/index?kind=weapon&weaponClass=FPS');
    flush();
  }));

  it('ships: announced entries carry the tag, the search link is pre-filtered to "new"', fakeAsync(() => {
    const ship = item({ category: 'fpsWeapon', className: 'AEGS_Gladius', imageUrl: null });
    setup([{ ...ship, category: 'ship', kind: 'ship', detailRoute: ['/codex', 'ship', 'AEGS_Gladius'] }]);
    settle();
    const open = el.querySelector<HTMLElement>('sc-codex-landing-codex-pane .open')!;
    const entries = Array.from(open.querySelectorAll<HTMLAnchorElement>('.new a.ent'));
    // The item on the table leads, the announced ship follows with its tag.
    expect(entries[0].getAttribute('href')).toBe('/codex/ship/AEGS_Gladius');
    expect(entries[1].querySelector('.soon')).not.toBeNull();
    expect(entries[1].getAttribute('href')).toBe('/codex/upcoming/polaris');
    expect(open.querySelector<HTMLAnchorElement>('a.more')!.getAttribute('href')).toBe('/codex/index?kind=ship&sort=new');
    flush();
  }));

  const entries = () => Array.from(el.querySelectorAll<HTMLAnchorElement>('sc-codex-landing-codex-pane .new a.ent'));

  it('B2.1/B2.2: a plain left click puts the entry on this pages table and holds it; the arrow and modified clicks open the subpage', fakeAsync(() => {
    setup(three());
    settle();
    const cmp = fixture.componentInstance;
    const second = entries()[1];
    const arrow = second.parentElement!.querySelector<HTMLAnchorElement>('a.go')!;
    expect(second.getAttribute('href')).toBe('/codex/weapon/KSAR_Smg');
    expect(arrow.getAttribute('href')).toBe('/codex/weapon/KSAR_Smg');

    const ctrl = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    second.dispatchEvent(ctrl);
    expect(ctrl.defaultPrevented).withContext('Ctrl+click falls through to the anchor').toBeFalse();
    expect(cmp.picked()).toBeNull();

    const plain = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    second.dispatchEvent(plain);
    settle();
    expect(plain.defaultPrevented).toBeTrue();
    expect(data.itemByClass).toHaveBeenCalledWith('fpsWeapon', 'KSAR_Smg');
    expect(cmp.current()!.className).toBe('KSAR_Smg');
    expect(cmp.held()).toBeTrue();
    expect(piece().querySelector('.k-name')!.textContent).toContain('Picked KSAR_Smg');
    tick(ROTATION_MS * 2);
    expect(cmp.current()!.className).withContext('held').toBe('KSAR_Smg');
    // The category tab again resumes the rotation: the picked entry gives way.
    el.querySelector<HTMLButtonElement>('sc-codex-landing-codex-pane button.tab.on')!.click();
    fixture.detectChanges();
    expect(cmp.picked()).toBeNull();
    expect(cmp.held()).toBeFalse();
    discardPeriodicTasks();
    flush();
  }));

  it('B2.3: an announced ship stands on the table with name and icon only, no values; its arrow opens the upcoming page', fakeAsync(() => {
    const ship = item({ category: 'fpsWeapon', className: 'AEGS_Gladius' });
    setup([{ ...ship, category: 'ship', kind: 'ship', detailRoute: ['/codex', 'ship', 'AEGS_Gladius'] }]);
    settle();
    const cmp = fixture.componentInstance;
    const soon = entries().find((a) => a.querySelector('.soon'))!;
    expect(soon.parentElement!.querySelector('a.go')!.getAttribute('href')).toBe('/codex/upcoming/polaris');
    soon.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    settle();
    expect(data.itemByClass).not.toHaveBeenCalled();
    expect(cmp.current()!.announced).toBeTrue();
    expect(cmp.held()).toBeTrue();
    expect(piece().querySelector('.k-name')!.textContent).toContain('RSI Polaris');
    expect(piece().querySelectorAll('.call').length).withContext('no values').toBe(0);
    expect(piece().querySelector('.sil sc-codex-icon')).withContext('category icon').not.toBeNull();
    expect(piece().querySelector('.k-eye')!.textContent).toContain('codex.landing.holo.announced');
    discardPeriodicTasks();
    flush();
  }));

  it('B2.4: the category bar shows the active category with its name, the others icon only', fakeAsync(() => {
    setup(three());
    settle();
    const tabs = Array.from(el.querySelectorAll<HTMLButtonElement>('sc-codex-landing-codex-pane .tabs .tab'));
    expect(tabs.length).toBe(4);
    expect(tabs.filter((t) => t.querySelector('.nm')).length).toBe(1);
    expect(el.querySelector('sc-codex-landing-codex-pane .tab.on .nm')).not.toBeNull();
    expect(tabs.every((t) => !!t.getAttribute('aria-label'))).toBeTrue();
    flush();
  }));

  it('callouts only for values with an anchor; the rest becomes bars', fakeAsync(() => {
    const ship = item({
      category: 'fpsWeapon',
      className: 'AEGS_Gladius',
      topValues: [
        { key: 'flight.scmSpeed', value: 220, unit: 'm/s', classAvg: 200, classMax: 300, higherIsBetter: true },
        { key: 'hull.hp', value: 4300, unit: 'hp', classAvg: 5000, classMax: 9000, higherIsBetter: true },
      ],
    });
    setup([{ ...ship, category: 'ship', kind: 'ship', detailRoute: ['/codex', 'ship', 'AEGS_Gladius'] }]);
    settle();
    const calls = piece().querySelectorAll('.call');
    expect(calls.length).toBe(1);
    expect(calls[0].querySelector('.c-value')!.getAttribute('href')).toBe('/codex/ship/AEGS_Gladius');
    expect(calls[0].querySelector('.c-cmp.worse')).withContext('worse than its class').not.toBeNull();
    expect(piece().querySelectorAll('.leaders path').length).toBe(1);
    const bars = el.querySelectorAll('sc-codex-landing-values-pane .row:not(.callout)');
    expect(bars.length).toBe(1);
    expect(bars[0].querySelector('.bar u')).withContext('class mean tick').not.toBeNull();
    flush();
  }));

  it('paint chips: three, then "+ N" that expands; a chip opens the RSI image and holds the rotation', fakeAsync(() => {
    const ship = item({ category: 'fpsWeapon', className: 'X' });
    setup([
      { ...ship, category: 'ship', kind: 'ship', detailRoute: ['/codex', 'ship', 'X'] },
      item({ category: 'armor', className: 'CDS_Heavy_Core' }),
    ]);
    data.paintList = [1, 2, 3, 4, 5, 6].map(paint);
    settle();
    const cmp = fixture.componentInstance;
    let chips = Array.from(piece().querySelectorAll<HTMLButtonElement>('.chip'));
    expect(chips.length).toBe(4);
    expect(chips[3].classList).toContain('more');
    expect(chips[3].textContent).toContain('+ 3');
    chips[1].click();
    fixture.detectChanges();
    expect(piece().querySelector<HTMLImageElement>('.pv img')!.src).toContain('p2.jpg');
    expect(cmp.paintOpen()).toBeTrue();
    tick(ROTATION_MS * 2);
    expect(cmp.active()).withContext('held while the preview is open').toBe(0);
    chips = Array.from(piece().querySelectorAll<HTMLButtonElement>('.chip'));
    chips[3].click();
    fixture.detectChanges();
    expect(piece().querySelectorAll('.chip:not(.more)').length).toBe(6);
    piece().querySelector<HTMLButtonElement>('.pv-x')!.click();
    fixture.detectChanges();
    expect(cmp.paintOpen()).toBeFalse();
    tick(ROTATION_MS);
    expect(cmp.active()).toBe(1);
    discardPeriodicTasks();
    flush();
  }));

  it('hero claims: seven per category, CLAIM_MS each while the category stays, paused on hover', fakeAsync(() => {
    setup([item({ category: 'fpsWeapon', className: 'BEHR_Rifle' })]);
    settle();
    const cmp = fixture.componentInstance;
    expect(cmp.claims().length).toBe(7);
    expect(cmp.claimIndex()).toBe(0);
    tick(CLAIM_MS);
    fixture.detectChanges();
    expect(cmp.claimIndex()).toBe(1);
    el.querySelector<HTMLElement>('.hero')!.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();
    tick(CLAIM_MS * 2);
    expect(cmp.claimIndex()).withContext('paused while hovered').toBe(1);
    el.querySelector<HTMLElement>('.hero')!.dispatchEvent(new MouseEvent('mouseleave'));
    fixture.detectChanges();
    tick(CLAIM_MS);
    expect(cmp.claimIndex()).toBe(2);
    cmp.still.set(true);
    fixture.detectChanges();
    tick(CLAIM_MS * 2);
    expect(cmp.claimIndex()).withContext('reduced motion stands still').toBe(2);
    discardPeriodicTasks();
    flush();
  }));

  it('hero claims also roll every CLAIM_MS while the rotation runs (cx-claims)', fakeAsync(() => {
    setup(three());
    settle();
    const cmp = fixture.componentInstance;
    expect(cmp.paused()).withContext('rotation runs').toBeFalse();
    expect(cmp.claimIndex()).toBe(0);
    tick(CLAIM_MS);
    fixture.detectChanges();
    expect(cmp.active()).withContext('still the first category').toBe(0);
    expect(cmp.claimIndex()).withContext('claim advanced during rotation').toBe(1);
    tick(ROTATION_MS - CLAIM_MS);
    fixture.detectChanges();
    expect(cmp.active()).toBe(1);
    expect(cmp.claimIndex()).withContext('next category starts on its own cursor').toBe(0);
    tick(CLAIM_MS);
    fixture.detectChanges();
    expect(cmp.claimIndex()).toBe(1);
    discardPeriodicTasks();
    flush();
  }));
  it('renders an error state with retry instead of the empty state', fakeAsync(() => {
    setup([]);
    data.error.set('errors.codex.load.network');
    settle();
    expect(el.querySelector('.err[role="alert"]')).not.toBeNull();
    expect(el.querySelector('.empty')).toBeNull();
    data.error.set(null);
    data.items = three();
    el.querySelector<HTMLButtonElement>('.err button')!.click();
    settle();
    expect(el.querySelector('.err')).toBeNull();
    expect(data.rotationItems).toHaveBeenCalledTimes(2);
    flush();
  }));

  it('shows News only with a summary, marks it seen on open', fakeAsync(() => {
    setup(three());
    settle();
    expect(el.querySelector('.news button')).toBeNull();
    data.summary.set({
      patchVersion: '4.3.1',
      lines: ['a', 'b'],
      generatedAt: null,
      patchNotesUrl: 'https://robertsspaceindustries.com/patch-notes',
      patchNotesIsThread: false,
    });
    data.unread.set(true);
    fixture.detectChanges();
    expect(el.querySelector('.news .dot')).not.toBeNull();
    el.querySelector<HTMLButtonElement>('sc-codex-landing-news button')!.click();
    fixture.detectChanges();
    expect(data.markNewsSeen).toHaveBeenCalled();
    const link = el.querySelector<HTMLAnchorElement>('.pop a')!;
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(el.querySelectorAll('.pop li').length).toBe(2);
    flush();
  }));
});
