import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { SccAppLauncherService } from '../../desktop/scc-app-launcher.service';
import { HangarService } from '../../hangar/hangar.service';
import { HqEinsatzService } from '../data/hq-einsatz.service';
import { EventHqService } from '../events/event-hq.service';
import { HqInventoryService } from '../data/hq-inventory.service';
import { HqStatsService } from '../data/hq-stats.service';
import { HqOwnershipService } from '../hq-ownership.service';
import { HqPageNavService } from '../hq-page-nav.service';
import { HqSuppliesService } from '../hq-supplies.service';
import { HqLiveService } from '../now/hq-live.service';
import { HqPatchHit } from './hq-start-feed.service';
import { HqStartComponent } from './hq-start.component';
import { HqStartTilesComponent, agoText, missionsThisWeek } from './hq-start-tiles.component';

interface Setup {
  user?: boolean;
  ships?: number;
  hangarError?: string | null;
  state?: Record<string, unknown> | null;
  events?: { type: string; at: string }[];
  liveLoaded?: boolean;
  liveError?: string | null;
  upcoming?: unknown[];
  einsatzReady?: boolean;
  syncError?: string | null;
  supplies?: number;
  remembered?: boolean;
  snapshots?: { location: string; taken_at: string }[];
  missions?: number;
  openEvents?: string[];
}

const liveState = () => ({
  presence: { at: new Date().toISOString(), gameRunning: true },
  location: { name: 'Stanton4_NewBabbage', system: 'Stanton' },
  currentShip: { name: 'Cutlass Black' },
});
const step = (label: string, state: 'todo' | 'done' = 'todo') => ({ ord: 0, kind: 'buy', label, state });
const einsatz = (id: string, title: string, steps: unknown[]) => ({ id, title, status: 'planned', steps });

function providers(o: Setup) {
  const launcher = {
    launch: () => Promise.resolve(false),
    launchedBefore: () => !!o.remembered,
    downloadInstaller: vi.fn().mockName('downloadInstaller'),
    rememberLaunch: vi.fn().mockName('rememberLaunch'),
    remembered: signal(!!o.remembered),
  };
  const refresh = vi.fn().mockName('refresh');
  const sync = vi.fn().mockName('sync');
  return {
    launcher,
    refresh,
    sync,
    list: [
      provideRouter([]),
      provideTranslateService(),
      { provide: AuthService, useValue: { user: signal(o.user === false ? null : { id: 'u1' }) } },
      {
        provide: HangarService,
        useValue: {
          ships: signal(Array.from({ length: o.ships ?? 0 }, (_, i) => ({ id: `s${i}`, status: 'owned' }))),
          roleLoadouts: signal([{ id: 'r1' }]),
          error: signal(o.hangarError ?? null),
          loadAll: () => Promise.resolve(),
        },
      },
      { provide: HqOwnershipService, useValue: { configs: signal([{ id: 'c1' }, { id: 'c2' }]), ensureLoaded: () => Promise.resolve() } },
      {
        provide: HqInventoryService,
        useValue: { snapshots: signal(o.snapshots ?? []), items: signal([]), error: signal(null), loaded: signal(true), load: () => Promise.resolve() },
      },
      {
        provide: HqStatsService,
        useValue: { stats: signal(o.missions ? { blueprints: { total: 37 }, missions: { series: [{ bucket: new Date().toISOString(), value: o.missions }] } } : null) },
      },
      {
        provide: HqLiveService,
        useValue: {
          state: signal(o.state ?? null),
          events: signal(o.events ?? []),
          stateUpdatedAt: signal(null),
          loaded: signal(o.liveLoaded ?? true),
          error: signal(o.liveError ?? null),
          refresh,
        },
      },
      {
        provide: HqEinsatzService,
        useValue: { upcoming: signal(o.upcoming ?? []), items: signal(o.upcoming ?? []), ready: signal(o.einsatzReady ?? true), syncError: signal(o.syncError ?? null), sync },
      },
      { provide: HqSuppliesService, useValue: { open: signal(Array.from({ length: o.supplies ?? 0 }, (_, i) => ({ id: `n${i}` }))) } },
      { provide: SccAppLauncherService, useValue: launcher },
      {
        provide: EventHqService,
        useValue: (() => {
          const open = signal((o.openEvents ?? []).map((name) => ({ event: { name } })));
          return { open, nearest: () => open()[0] ?? null, ensure: () => undefined };
        })(),
      },
    ],
  };
}

async function mount(o: Setup = {}) {
  const p = providers(o);
  TestBed.configureTestingModule({ providers: p.list });
  const f = TestBed.createComponent(HqStartTilesComponent);
  f.detectChanges();
  await Promise.resolve();
  await Promise.resolve();
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const tile = (name: string) => el.querySelector(`[data-tile="${name}"]`) as HTMLElement;
  return { f, el, tile, ...p };
}

describe('HqStartTilesComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('stands Bestand left, Jetzt centre, Planen right; on the phone Jetzt is pulled first by the grid', async () => {
    const { el } = await mount();
    expect(Array.from(el.querySelectorAll('[data-tile]')).map((t) => t.getAttribute('data-tile'))).toEqual(['bestand', 'jetzt', 'planen']);
  });

  it('each tile is one real anchor to its page, never nesting an own target', async () => {
    const { el, tile } = await mount({ ships: 0, upcoming: [einsatz('e1', 'Bounty v3', [step('S3')])] });
    expect(tile('bestand').querySelector('a.stretch')?.getAttribute('href')).toBe('/hq#inventar');
    expect(tile('jetzt').querySelector('a.stretch')?.getAttribute('href')).toBe('/hq#jetzt');
    expect(tile('planen').querySelector('a.stretch')?.getAttribute('href')).toBe('/hq#planen');
    expect(el.querySelector('a a')).toBeNull();
  });

  it('a plain click goes through the page nav, a modified click is left to the browser', async () => {
    const { tile } = await mount();
    const nav = TestBed.inject(HqPageNavService);
    const open = vi.fn().mockName('open');
    nav.attach(open);
    const a = tile('planen').querySelector('a.stretch') as HTMLAnchorElement;
    let leftAlone: boolean | null = null;
    a.addEventListener('click', (e) => { leftAlone = !e.defaultPrevented; e.preventDefault(); }, { once: true });
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    expect(leftAlone).toBe(true);
    expect(open).not.toHaveBeenCalled();
    const plain = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('planen');
  });

  it('Bestand and Planen show no visible open-link line; the words sit in the anchor name and tooltip only', async () => {
    const { tile } = await mount({ ships: 3 });
    const bestand = tile('bestand').querySelector('a.stretch') as HTMLAnchorElement;
    const planen = tile('planen').querySelector('a.stretch') as HTMLAnchorElement;
    expect(bestand.getAttribute('aria-label')).toBe('hq.start.bestand.open');
    expect(planen.getAttribute('aria-label')).toBe('hq.start.planen.open');
    expect(tile('bestand').querySelector('.cta')).toBeNull();
    expect(tile('planen').querySelector('.cta')).toBeNull();
    expect(bestand.textContent?.trim()).toBe('');
  });

  it('Bestand and Planen share one fixed height, whatever they hold', async () => {
    const { tile } = await mount({ ships: 3, upcoming: [einsatz('e1', 'Bounty v3', [step('S3')])], openEvents: ['Xenothreat', 'Jumptown', 'Siege of Orison'] });
    const h = (n: string) => tile(n).getBoundingClientRect().height;
    expect(getComputedStyle(tile('bestand')).height).toBe(getComputedStyle(tile('planen')).height);
    expect(h('bestand')).toBeGreaterThan(0);
    expect(Math.abs(h('bestand') - h('planen'))).toBeLessThan(0.5);
    expect(Math.abs(tile('bestand').getBoundingClientRect().width - tile('planen').getBoundingClientRect().width)).toBeLessThan(0.5);
  });

  it('every tile says its hotkey for assistive tech (1 Bestand, 2 Jetzt, 3 Planen)', async () => {
    const { tile } = await mount();
    expect(['bestand', 'jetzt', 'planen'].map((n) => tile(n).querySelector('a.stretch')?.getAttribute('aria-keyshortcuts'))).toEqual(['1', '2', '3']);
  });

  describe('Bestand', () => {
    it('empty: no ships, the next step is marked and RSI-Hangar holen has its own target', async () => {
      const { tile } = await mount({ ships: 0 });
      expect(tile('bestand').classList).toContain('next');
      expect(tile('bestand').textContent).toContain('hq.start.bestand.empty');
      expect(tile('bestand').querySelector('a.own')?.getAttribute('href')).toBe('/hq/hangar');
    });

    it('with ships: count, sets, Bestand ansehen; no own target', async () => {
      const { tile } = await mount({ ships: 23, missions: 3 });
      expect(tile('bestand').classList).not.toContain('next');
      expect(tile('bestand').textContent).toContain('hq.start.bestand.ships');
      expect(tile('bestand').textContent).toContain('hq.start.bestand.sets');
      expect(tile('bestand').textContent).toContain('hq.start.bestand.blueprints');
      expect(tile('bestand').querySelector('a.own')).toBeNull();
    });

    it('an old stock stand gets a warning line, a fresh one none', async () => {
      const old = new Date(Date.now() - 9 * 86_400_000).toISOString();
      const a = await mount({ ships: 1, snapshots: [{ location: 'x', taken_at: old }] });
      expect(a.tile('bestand').querySelector('.warn')?.textContent).toContain('hq.start.bestand.stale');
      TestBed.resetTestingModule();
      const b = await mount({ ships: 1, snapshots: [{ location: 'x', taken_at: new Date().toISOString() }] });
      expect(b.tile('bestand').querySelector('.warn')).toBeNull();
    });

    it('a load failure is an error state with retry, not the empty state', async () => {
      const { tile } = await mount({ ships: 0, hangarError: 'errors.hq.load' });
      expect(tile('bestand').querySelector('[role="alert"]')?.textContent).toContain('errors.hq.load');
      expect(tile('bestand').textContent).not.toContain('hq.start.bestand.empty');
      expect(tile('bestand').querySelector('button.retry')).not.toBeNull();
    });
  });

  describe('Planen', () => {
    it('empty: nothing planned, no own target', async () => {
      const { tile } = await mount();
      expect(tile('planen').textContent).toContain('hq.start.planen.empty');
      expect(tile('planen').querySelector('a.own')).toBeNull();
    });

    it('with plans: count and name, no text link of its own; the whole tile leads to Planen', async () => {
      const { tile, f } = await mount({ upcoming: [einsatz('e1', 'Bounty v3', [step('S3'), step('Core')])] });
      f.detectChanges();
      expect(tile('planen').textContent).toContain('hq.start.planen.count');
      expect(tile('planen').textContent).toContain('Bounty v3');
      expect(tile('planen').querySelector('a.own')).toBeNull();
      expect(tile('planen').querySelector('a.stretch')?.getAttribute('href')).toBe('/hq#planen');
    });

    it('open events are one compact line inside the tile, not a link box of their own', async () => {
      const { tile, f } = await mount({ openEvents: ['Xenothreat', 'Jumptown', 'Siege of Orison'] });
      f.detectChanges();
      const mark = tile('planen').querySelector('[data-event-marker]') as HTMLElement;
      expect(mark).not.toBeNull();
      expect(mark.tagName).toBe('SPAN');
      expect(mark.textContent).toContain('hq.events.marker');
      expect(tile('planen').querySelectorAll('a').length).toBe(1);
      const line = parseFloat(getComputedStyle(mark).lineHeight) || 20;
      expect(mark.getBoundingClientRect().height).toBeLessThan(line * 1.6);
    });

    it('a sync failure before the first pull is an error state with retry', async () => {
      const { tile, sync } = await mount({ einsatzReady: false, syncError: 'errors.hq.sync' });
      expect(tile('planen').querySelector('[role="alert"]')?.textContent).toContain('errors.hq.sync');
      (tile('planen').querySelector('button.retry') as HTMLButtonElement).click();
      expect(sync).toHaveBeenCalled();
    });
  });

  describe('Jetzt', () => {
    const appAnchor = (tile: HTMLElement) => tile.querySelector('sc-hq-app-launch a.go') as HTMLAnchorElement | null;

    it('no signal and no memory: App fehlt, App downloaden', async () => {
      const { tile } = await mount();
      expect(tile('jetzt').textContent).toContain('hq.appStatus.state.missing');
      expect(appAnchor(tile('jetzt'))?.textContent).toContain('hq.app.downloadCta');
    });

    it('local memory alone: App aus, App starten', async () => {
      const { tile } = await mount({ remembered: true });
      expect(tile('jetzt').textContent).toContain('hq.appStatus.state.off');
      expect(appAnchor(tile('jetzt'))?.textContent).toContain('hq.app.launch');
    });

    it('an account signal in a new browser: App aus, App starten', async () => {
      const { tile } = await mount({ state: { location: { name: 'Stanton4_NewBabbage', system: 'Stanton' } } });
      expect(tile('jetzt').textContent).toContain('hq.appStatus.state.off');
      expect(appAnchor(tile('jetzt'))?.textContent).toContain('hq.app.launch');
    });

    it('a fresh life sign without the game: App bereit, waiting, no button', async () => {
      const { tile } = await mount({ state: { presence: { at: new Date().toISOString(), gameRunning: false } } });
      expect(tile('jetzt').textContent).toContain('hq.appStatus.state.ready');
      expect(tile('jetzt').textContent).toContain('hq.appStatus.waiting');
      expect(tile('jetzt').querySelector('sc-hq-app-launch')).toBeNull();
    });

    it('live with a planned Einsatz: green state, place, ship, and a button with its next step', async () => {
      const { tile, launcher } = await mount({
        state: liveState(),
        upcoming: [einsatz('e1', 'Bounty v3', [step('Done', 'done'), step('S3-Repeater')])],
      });
      const now = tile('jetzt');
      expect(now.classList).toContain('on');
      expect(now.textContent).toContain('hq.start.now.live');
      expect(now.textContent).toContain('New Babbage');
      expect(now.textContent).toContain('Stanton');
      expect(now.textContent).toContain('Cutlass Black');
      expect(now.querySelector('a.own.go')?.getAttribute('href')).toBe('/hq?einsatz=e1#planen');
      expect(now.querySelector('sc-hq-app-launch')).toBeNull();
      expect(launcher.rememberLaunch).toHaveBeenCalled();
    });

    it('live without a planned Einsatz: no button at all', async () => {
      const { tile } = await mount({ state: liveState() });
      expect(tile('jetzt').classList).toContain('on');
      expect(tile('jetzt').querySelector('a.own.go')).toBeNull();
      expect(tile('jetzt').querySelector('button')).toBeNull();
    });

    it('live with an Einsatz whose steps are all done: no button either', async () => {
      const { tile } = await mount({ state: liveState(), upcoming: [einsatz('e1', 'x', [step('a', 'done')])] });
      expect(tile('jetzt').querySelector('a.own.go')).toBeNull();
    });

    it('offline shows no rings class and does not remember the app', async () => {
      const { tile, launcher } = await mount({ state: { location: 'Area18' } });
      expect(tile('jetzt').classList).not.toContain('on');
      expect(launcher.rememberLaunch).not.toHaveBeenCalled();
    });

    it('a live load failure is an error state with retry', async () => {
      const { tile, refresh } = await mount({ liveError: 'errors.hq.live' });
      expect(tile('jetzt').querySelector('[role="alert"]')?.textContent).toContain('errors.hq.live');
      (tile('jetzt').querySelector('button.retry') as HTMLButtonElement).click();
      expect(refresh).toHaveBeenCalled();
    });

    it('a signed-out reader sees the offline state, never an endless loading line', async () => {
      const { tile } = await mount({ user: false, liveLoaded: false });
      expect(tile('jetzt').textContent).toContain('hq.appStatus.state.missing');
      expect(tile('bestand').textContent).toContain('hq.start.bestand.empty');
    });
  });

  describe('Statistik', () => {
    it('is absent on a first visit', async () => {
      const { el } = await mount();
      expect(el.querySelector('a.stat')).toBeNull();
    });

    it('is a quiet real anchor with hotkey 4 and the missions of this week', async () => {
      const { el } = await mount({ ships: 2, missions: 14 });
      const a = el.querySelector('a.stat') as HTMLAnchorElement;
      expect(a.getAttribute('href')).toBe('/hq#statistik');
      expect(a.getAttribute('aria-keyshortcuts')).toBe('4');
      expect(a.textContent).toContain('hq.start.stats.missions');
    });

    it('counts from this week\'s Monday and writes relative times', () => {
      const wed = Date.UTC(2026, 10, 4, 12);
      const series = [
        { bucket: '2026-11-01', value: 5 },
        { bucket: '2026-11-02', value: 2 },
        { bucket: '2026-11-04', value: 1 },
      ];
      expect(missionsThisWeek(series, wed)).toBe(3);
      expect(agoText(new Date(wed - 2 * 86_400_000).toISOString(), 'en', wed)).toBe('2 days ago');
      expect(agoText(new Date(wed - 5 * 60_000).toISOString(), 'en', wed)).toBe('5 minutes ago');
    });
  });
});

describe('HqStartComponent hero', () => {
  async function hero(patch: HqPatchHit | null) {
    const p = providers({});
    TestBed.configureTestingModule({ providers: p.list });
    const f = TestBed.createComponent(HqStartComponent);
    f.componentRef.setInput('patch', patch);
    f.detectChanges();
    await Promise.resolve();
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('without a hit: eyebrow, the one h1 and the stage search', async () => {
    const el = await hero(null);
    expect(el.querySelector('.kicker')?.textContent).toContain('hq.start.kicker');
    expect(el.querySelector('h1')?.textContent).toContain('hq.start.title');
    expect(el.querySelector('[scStageSearch]')).not.toBeNull();
  });

  it('a patch hit replaces eyebrow and title, and the title is a real link', async () => {
    const el = await hero({ plan: 'Bounty v3', build: '4.3.1', name: 'S3-Repeater', pct: 8, weaker: true, link: ['/hq/hangar', 'sh1'] });
    expect(el.querySelector('.kicker')?.textContent).toContain('hq.start.patch.eyebrow');
    const a = el.querySelector('h1 a') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('/hq/hangar/sh1');
    expect(a.textContent).toContain('hq.start.patch.weaker');
  });

  it('a hit without a set stays plain text', async () => {
    const el = await hero({ plan: null, build: null, name: 'x', pct: 3, weaker: false });
    expect(el.querySelector('.kicker')?.textContent).toContain('hq.start.patch.eyebrowPlain');
    expect(el.querySelector('h1 a')).toBeNull();
    expect(el.querySelector('h1')?.textContent).toContain('hq.start.patch.stronger');
  });
});
