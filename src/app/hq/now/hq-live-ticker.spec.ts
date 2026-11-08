import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { DesktopCapabilityService } from '../../core/desktop-capability.service';
import type { HqLiveEventRow } from '../data/hq-db.types';
import type { HqPageId } from '../hq-routes';
import { AUSSICHT_SEEN_KEY } from './hq-app-status.util';
import { HqLiveTickerComponent } from './hq-live-ticker.component';
import { HqLiveService } from './hq-live.service';
import { lastRelevantEvent, tickerAge } from './hq-live-ticker.util';

const LAUNCHED_KEY = 'sc.sccApp.launchedBefore';

const ev = (type: string, minutesAgo: number, data: Record<string, unknown> = {}): HqLiveEventRow => ({
  user_id: 'u',
  id: `${type}-${minutesAgo}`,
  type,
  data,
  at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  applied: null,
  undone: false,
  synced_at: '',
  updated_at: '',
});

const presence = (minutesAgo: number, gameRunning: boolean) => ({
  presence: { at: new Date(Date.now() - minutesAgo * 60_000).toISOString(), gameRunning },
});

describe('live ticker rules', () => {
  it('picks the last event that is relevant for the page, else the newest of any type', () => {
    const events = [ev('qt.arrived', 1), ev('inventory.snapshot', 10), ev('shop.purchase', 20)];
    expect(lastRelevantEvent(events, 'inventar')?.type).toBe('inventory.snapshot');
    expect(lastRelevantEvent(events, 'planen')?.type).toBe('shop.purchase');
    expect(lastRelevantEvent([ev('qt.arrived', 1)], 'inventar')?.type).toBe('qt.arrived');
    expect(lastRelevantEvent([], 'inventar')).toBeNull();
  });

  it('ages coarsely', () => {
    const now = Date.now();
    expect(tickerAge(new Date(now - 10_000).toISOString(), now).unit).toBe('now');
    expect(tickerAge(new Date(now - 5 * 60_000).toISOString(), now)).toEqual({ unit: 'minutes', n: 5 });
    expect(tickerAge(new Date(now - 3 * 3_600_000).toISOString(), now)).toEqual({ unit: 'hours', n: 3 });
    expect(tickerAge(new Date(now - 26 * 3_600_000).toISOString(), now)).toEqual({ unit: 'day', n: 1 });
    expect(tickerAge(new Date(now - 2 * 86_400_000).toISOString(), now)).toEqual({ unit: 'days', n: 2 });
    expect(tickerAge('junk', now).unit).toBe('now');
  });
});

describe('HqLiveTickerComponent (App-Status)', () => {
  beforeEach(() => {
    localStorage.removeItem(LAUNCHED_KEY);
    localStorage.removeItem(AUSSICHT_SEEN_KEY);
  });
  afterEach(() => {
    localStorage.removeItem(LAUNCHED_KEY);
    localStorage.removeItem(AUSSICHT_SEEN_KEY);
  });

  function mount(
    page: HqPageId,
    opts: { state?: Record<string, unknown> | null; events?: HqLiveEventRow[]; canInstall?: boolean; loaded?: boolean } = {},
  ) {
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService(),
        {
          provide: HqLiveService,
          useValue: {
            state: signal(opts.state ?? null),
            stateUpdatedAt: signal<string | null>(null),
            events: signal(opts.events ?? []),
            loaded: signal(opts.loaded ?? true),
            error: signal<string | null>(null),
          },
        },
        { provide: DesktopCapabilityService, useValue: { canInstall: signal(opts.canInstall ?? true) } },
      ],
    });
    const f = TestBed.createComponent(HqLiveTickerComponent);
    f.componentRef.setInput('page', page);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    return { f, el, dock: el.querySelector('.dock') as HTMLElement | null };
  }

  it('App fehlt: on Start too, before any connection, with the download and the Aussicht open once', () => {
    const { dock } = mount('start');
    expect(dock?.dataset['state']).toBe('missing');
    expect(dock?.querySelector('.state')?.textContent).toBe('hq.appStatus.state.missing');
    expect(dock?.querySelector('sc-hq-app-launch a')?.textContent).toContain('hq.app.downloadCta');
    expect(dock?.querySelector('.aussicht .a-text')?.textContent).toBe('hq.appStatus.aussicht.start');
    expect(dock?.querySelector('.face')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('closing the Aussicht while the app is missing is remembered per page', () => {
    const { f, dock } = mount('planen');
    (dock!.querySelector('.a-x') as HTMLButtonElement).click();
    f.detectChanges();
    expect(dock!.querySelector('.aussicht')).toBeNull();
    expect(JSON.parse(localStorage.getItem(AUSSICHT_SEEN_KEY)!)).toEqual(['planen']);
    TestBed.resetTestingModule();
    expect(mount('planen').dock?.querySelector('.aussicht')).toBeNull();
    TestBed.resetTestingModule();
    expect(mount('statistik').dock?.querySelector('.aussicht .a-text')?.textContent).toBe('hq.appStatus.aussicht.statistik');
  });

  it('App aus: grey ring, last seen, the start action, Aussicht closed until asked', () => {
    const { f, dock } = mount('inventar', { state: presence(90, true) });
    expect(dock?.dataset['state']).toBe('off');
    expect(dock?.querySelector('small')?.textContent).toContain('hq.appStatus.last');
    expect(dock?.querySelector('sc-hq-app-launch a')?.textContent).toContain('hq.app.launch');
    expect(dock?.querySelector('.aussicht')).toBeNull();
    // A closed panel is not in the DOM, so the toggle must not point at it.
    expect(dock?.querySelector('.face')?.hasAttribute('aria-controls')).toBe(false);
    (dock!.querySelector('.face') as HTMLButtonElement).click();
    f.detectChanges();
    expect(dock?.querySelector('.aussicht .a-text')?.textContent).toBe('hq.appStatus.aussicht.inventar');
    const controls = dock?.querySelector('.face')?.getAttribute('aria-controls');
    expect(controls && dock?.querySelector(`#${controls}`)).toBeTruthy();
  });

  it('App aus also when only this browser remembers the app', () => {
    localStorage.setItem(LAUNCHED_KEY, '1');
    expect(mount('jetzt').dock?.dataset['state']).toBe('off');
  });

  it('App bereit: green ring, waits for Star Citizen, no button', () => {
    const { dock } = mount('jetzt', { state: presence(1, false) });
    expect(dock?.dataset['state']).toBe('ready');
    expect(dock?.querySelector('em')?.textContent).toBe('hq.appStatus.waiting');
    expect(dock?.querySelector('sc-hq-app-launch')).toBeNull();
  });

  it('Tracking: the last event that matters for the page, no button', () => {
    const { dock } = mount('inventar', { state: presence(1, true), events: [ev('inventory.opened', 2, { location: 'Lorville' })] });
    expect(dock?.dataset['state']).toBe('tracking');
    expect(dock?.querySelector('em')?.textContent).toBe('hq.log.event.inventory.opened');
    expect(dock?.querySelector('small')?.textContent).toBe('hq.ticker.ago.minutes');
    expect(dock?.querySelector('sc-hq-app-launch')).toBeNull();
  });

  it('the Jetzt Aussicht carries the three examples that used to stand in the connect block', () => {
    const { f, dock } = mount('jetzt', { state: presence(1, false) });
    (dock!.querySelector('.face') as HTMLButtonElement).click();
    f.detectChanges();
    expect(dock!.querySelectorAll('.aussicht .a-list li').length).toBe(3);
  });

  it('stays away where nothing can be installed, and until the live data loaded', () => {
    expect(mount('start', { canInstall: false }).dock).toBeNull();
    TestBed.resetTestingModule();
    expect(mount('jetzt', { loaded: false }).dock).toBeNull();
  });

  it('stands above the footer on the last page', () => {
    expect(mount('statistik').dock?.classList).toContain('above-footer');
  });
});
