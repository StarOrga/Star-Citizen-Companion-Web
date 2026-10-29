import { ComponentFixture, TestBed, discardPeriodicTasks, fakeAsync, flush, tick } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexLandingComponent, ROTATION_MS } from './codex-landing.component';
import { CodexLandingDataService } from './landing/codex-landing-data.service';
import { Filmstrip, LandingItem, LandingPaint, PatchSummaryView } from './landing/codex-landing-data.types';
import { BetaService } from '../core/beta.service';
import { CardRestIntent } from './landing/codex-landing-card.component';
import { ACC_REST_MS } from '../verse/pages/briefing/briefing-accordion';

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

const strip = (prefix: string, n: number, more: number): Filmstrip => ({
  tiles: Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    name: `${prefix} ship ${i}`,
    manufacturer: 'RSI',
    imageUrl: null,
    route: ['/codex', 'ship', `${prefix}${i}`],
    isNew: i === 0,
  })),
  more,
  total: n + more,
});

class FakeData {
  readonly error = signal<string | null>(null);
  readonly summary = signal<PatchSummaryView | null>(null);
  readonly patchSummary = computed(() => this.summary());
  readonly unread = signal(false);
  readonly newsUnread = computed(() => this.unread());
  items: LandingItem[] = [];
  paintList: LandingPaint[] = [];
  markNewsSeen = jasmine.createSpy('markNewsSeen');
  rotationItems = jasmine.createSpy('rotationItems').and.callFake(async () => this.items);
  flightReadyFilmstrip = jasmine.createSpy('ready').and.callFake(async () => strip('r', 5, 38));
  announcedFilmstrip = jasmine.createSpy('announced').and.callFake(async () => strip('a', 3, 0));
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
        { provide: BetaService, useValue: { isEnabled: () => signal(true) } },
      ],
    });
    fixture = TestBed.createComponent(CodexLandingComponent);
    fixture.componentInstance.still.set(false);
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

  it('renders hero, holotable plate as anchors, rail with keybindings last and nothing personal', fakeAsync(() => {
    setup(three());
    settle();
    expect(el.querySelector('h1')).not.toBeNull();
    expect(el.querySelector('[scStageSearch]')).not.toBeNull();
    const name = el.querySelector<HTMLAnchorElement>('sc-codex-landing-holotable a.name')!;
    expect(name.getAttribute('href')).toBe('/codex/weapon/BEHR_Rifle');
    expect(el.querySelector<HTMLAnchorElement>('a.holo')!.getAttribute('href')).toBe('/codex/weapon/BEHR_Rifle');
    const rail = Array.from(el.querySelectorAll<HTMLAnchorElement>('nav.rail a'));
    expect(rail.length).toBe(6);
    expect(rail[5].getAttribute('href')).toBe('/codex/keybinds');
    // Removed parts (brief A9).
    for (const sel of ['sc-codex-stage', 'sc-codex-compare-tray', 'sc-app-download-menu', 'sc-upcoming-teaser', 'sc-codex-tool-tiles']) {
      expect(el.querySelector(sel)).withContext(sel).toBeNull();
    }
    flush();
  }));

  it('rotates every ROTATION_MS, holds on a segment click and resumes on the second click', fakeAsync(() => {
    setup(three());
    settle();
    const cmp = fixture.componentInstance;
    expect(cmp.active()).toBe(0);
    tick(ROTATION_MS);
    fixture.detectChanges();
    expect(cmp.active()).toBe(1);

    const segs = () => el.querySelectorAll<HTMLButtonElement>('.seg');
    segs()[2].click();
    fixture.detectChanges();
    expect(cmp.active()).toBe(2);
    expect(segs()[2].getAttribute('aria-pressed')).toBe('true');
    tick(ROTATION_MS * 2);
    fixture.detectChanges();
    expect(cmp.active()).withContext('held').toBe(2);

    segs()[2].click();
    fixture.detectChanges();
    expect(cmp.held()).toBeFalse();
    expect(cmp.active()).toBe(0);
    discardPeriodicTasks();
    flush();
  }));

  it('pauses the rotation while the card is enlarged', fakeAsync(() => {
    setup(three());
    settle();
    const cmp = fixture.componentInstance;
    el.querySelector<HTMLButtonElement>('.card .grow')!.click();
    fixture.detectChanges();
    expect(cmp.cardOpen()).toBeTrue();
    tick(ROTATION_MS * 2);
    expect(cmp.active()).toBe(0);
    cmp.cardOpen.set(false);
    fixture.detectChanges();
    tick(ROTATION_MS);
    expect(cmp.active()).toBe(1);
    flush();
  }));

  it('shows the no-image card with values, enlarges without a flip, Escape closes', fakeAsync(() => {
    setup(three());
    settle();
    expect(el.querySelector('.card .small.solo')).not.toBeNull();
    el.querySelector<HTMLButtonElement>('.card .grow')!.click();
    fixture.detectChanges();
    const big = el.querySelector<HTMLElement>('.card .big')!;
    expect(big.getAttribute('role')).toBe('dialog');
    expect(big.querySelectorAll('.top7 div').length).toBe(4);
    expect(big.querySelector('.fold')).toBeNull();
    // Null overview fields are hidden.
    expect(big.querySelectorAll('.facts div').length).toBe(2);
    big.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector('.card .big')).toBeNull();
    flush();
  }));

  it('lists paints newest first, keeps the order on selection and folds the rest into "+ N"', fakeAsync(() => {
    const ship = item({ category: 'fpsWeapon', className: 'X', imageUrl: 'https://media.example.com/x.jpg' });
    setup([{ ...ship, category: 'ship', kind: 'ship', detailRoute: ['/codex', 'ship', 'X'] }]);
    data.paintList = [1, 2, 3, 4, 5, 6].map(paint);
    settle();
    el.querySelector<HTMLButtonElement>('.card .grow')!.click();
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('.card .big .fold')!.click();
    fixture.detectChanges();
    let tiles = Array.from(el.querySelectorAll<HTMLButtonElement>('.pgrid .pt'));
    expect(tiles.length).toBe(4);
    expect(tiles[3].classList).toContain('pmore');
    expect(tiles[3].textContent).toContain('+3');
    expect(tiles[0].querySelector('em')).not.toBeNull();

    tiles[2].click();
    fixture.detectChanges();
    // Back on the front with the chosen paint.
    expect(el.querySelector<HTMLImageElement>('.card .big .shot')!.src).toContain('p3.jpg');
    el.querySelector<HTMLButtonElement>('.card .big .fold')!.click();
    fixture.detectChanges();
    tiles = Array.from(el.querySelectorAll<HTMLButtonElement>('.pgrid .pt'));
    expect(tiles.map((t) => t.textContent!.trim().replace(/\s+/g, ' ')).slice(0, 3)).toEqual([
      jasmine.stringContaining('Paint 1'),
      'Paint 2',
      'Paint 3',
    ] as unknown as string[]);
    expect(tiles[2].classList).toContain('on');
    flush();
  }));

  it('switches the filmstrip and links "+ N weitere" into the index', fakeAsync(() => {
    setup(three());
    settle();
    const more = el.querySelector<HTMLAnchorElement>('.fcard.rest')!;
    expect(more.getAttribute('href')).toBe('/codex/index?kind=ship&sort=new');
    expect(el.querySelectorAll('.fcard').length).toBe(6);
    el.querySelectorAll<HTMLButtonElement>('.toggle button')[1].click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.fcard').length).toBe(3);
    expect(el.querySelector('.fcard')!.getAttribute('href')).toBe('/codex/ship/a0');
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

describe('CardRestIntent', () => {
  it('opens only after the pointer rested, a fly-over starts nothing', fakeAsync(() => {
    const fire = jasmine.createSpy('fire');
    const intent = new CardRestIntent(fire);
    intent.move(0, 0);
    tick(ACC_REST_MS - 50);
    intent.move(40, 0);
    tick(ACC_REST_MS - 50);
    intent.leave();
    tick(ACC_REST_MS * 2);
    expect(fire).not.toHaveBeenCalled();
    intent.move(10, 10);
    intent.move(11, 10); // jitter below ACC_MOVE_PX keeps the rest
    tick(ACC_REST_MS);
    expect(fire).toHaveBeenCalledTimes(1);
  }));
});
