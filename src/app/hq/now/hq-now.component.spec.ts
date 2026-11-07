import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { HqLiveEventRow } from '../data/hq-db.types';
import { DesktopConnectionService } from '../../desktop/desktop-connection.service';
import { ConnectionState } from '../../desktop/desktop-access';
import { HqLogDialogComponent } from './hq-log-dialog.component';
import { HqLiveService } from './hq-live.service';
import { HqNowComponent } from './hq-now.component';
import { HqEinsatzService } from '../data/hq-einsatz.service';
import { NachschubService } from '../nachschub/nachschub.service';
import type { Nachschub } from '../nachschub/nachschub.model';

function ev(i: number): HqLiveEventRow {
  return {
    user_id: 'u1', id: 'e' + i, type: 'qt.arrived', data: {}, at: new Date(Date.now() - i * 60_000).toISOString(),
    applied: null, undone: false, synced_at: '', updated_at: '',
  };
}

function fakeLive(state: Record<string, unknown> | null, events: HqLiveEventRow[] = []) {
  return {
    state: signal(state),
    stateUpdatedAt: signal<string | null>(null),
    events: signal(events),
    loaded: signal(true),
    error: signal<string | null>(null),
    hasMore: signal(true),
    toast: signal<HqLiveEventRow | null>(null),
    connected: signal(true),
    refresh: jasmine.createSpy('refresh'),
    loadMore: jasmine.createSpy('loadMore').and.resolveTo(),
    undo: jasmine.createSpy('undo'),
    undoable: () => false,
    dismissToast: () => undefined,
  };
}

describe('HqNowComponent', () => {
  function mount(live: ReturnType<typeof fakeLive>, conn: ConnectionState = 'never'): ComponentFixture<HqNowComponent> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService(),
        { provide: HqLiveService, useValue: live },
        { provide: DesktopConnectionService, useValue: { stateFor: () => conn, refresh: () => Promise.resolve() } },
      ],
    });
    const f = TestBed.createComponent(HqNowComponent);
    f.detectChanges();
    return f;
  }

  it('shows the one start action when there is no state', () => {
    const f = mount(fakeLive(null));
    expect((f.nativeElement as HTMLElement).querySelector('.connect sc-hq-app-launch')).toBeTruthy();
    expect((f.nativeElement as HTMLElement).querySelector('a[href="/apps"]')).toBeNull();
    expect((f.nativeElement as HTMLElement).querySelector('.anchor')).toBeNull();
  });

  it('tells a connected app without live data to enable the sync', () => {
    const f = mount(fakeLive(null), 'connected');
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('.connect .connect-title')?.textContent).toContain('hq.now.connect.syncOffTitle');
    expect(el.querySelector('.connect .muted')?.textContent).toContain('hq.now.connect.syncOffHint');
  });

  it('explains what Jetzt shows with three examples in both connect states', () => {
    for (const conn of ['never', 'connected'] as ConnectionState[]) {
      TestBed.resetTestingModule();
      const el = mount(fakeLive(null), conn).nativeElement as HTMLElement;
      expect(el.querySelector('.connect .explain-what')?.textContent).toContain('hq.now.connect.explain.what');
      expect(el.querySelectorAll('.connect .explain-list li').length).toBe(3);
    }
  });

  it('shows no explanation once live data flows', () => {
    const el = mount(fakeLive({ location: { name: 'Lorville', system: null } })).nativeElement as HTMLElement;
    expect(el.querySelector('.explain')).toBeNull();
  });

  const presence = (ageMs: number, gameRunning = true) => ({
    gameRunning,
    at: new Date(Date.now() - ageMs).toISOString(),
  });

  it('shows the location as last known without any life sign', () => {
    const live = fakeLive({ location: { name: 'Stanton4_NewBabbage', system: 'Stanton' } });
    live.stateUpdatedAt.set(new Date().toISOString());
    const el = mount(live).nativeElement as HTMLElement;
    expect(el.querySelector('#hq-now-anchor')?.textContent).toContain('hq.now.anchor.lastSeen');
    expect(el.querySelector('.fresh')?.textContent).toContain('hq.now.fresh.ended');
    expect(el.querySelector('.place')?.textContent).toBe('New Babbage');
  });

  it('shows the location as last known with a stale life sign', () => {
    const live = fakeLive({ location: { name: 'Lorville', system: null }, presence: presence(4 * 60_000) });
    const el = mount(live).nativeElement as HTMLElement;
    expect(el.querySelector('#hq-now-anchor')?.textContent).toContain('hq.now.anchor.lastSeen');
  });

  it('marks the location as last known once the session ended', () => {
    const live = fakeLive({ location: { name: 'Lorville', system: null }, presence: presence(1000) }, [
      { ...ev(0), type: 'session.quit', at: new Date().toISOString() },
      { ...ev(1), type: 'session.joined' },
    ]);
    live.stateUpdatedAt.set(new Date().toISOString());
    const el = mount(live).nativeElement as HTMLElement;
    expect(el.querySelector('#hq-now-anchor')?.textContent).toContain('hq.now.anchor.lastSeen');
    expect(el.querySelector('.fresh')?.textContent).toContain('hq.now.fresh.ended');
  });

  it('shows you are here only with a fresh life sign of a running game', () => {
    const live = fakeLive({ location: { name: 'Lorville', system: null }, presence: presence(1000) }, [
      { ...ev(0), type: 'session.joined' },
    ]);
    const el = mount(live).nativeElement as HTMLElement;
    expect(el.querySelector('#hq-now-anchor')?.textContent).toContain('hq.now.anchor.label');
    expect(el.querySelector('.fresh')?.textContent).toContain('hq.now.fresh.updated');
  });

  it('stays live when only an older session end is known (the app attached to a running game)', () => {
    const live = fakeLive({ location: { name: 'Lorville', system: null }, presence: presence(1000) }, [
      { ...ev(0), type: 'session.quit', at: new Date(Date.now() - 86_400_000).toISOString() },
    ]);
    const el = mount(live).nativeElement as HTMLElement;
    expect(el.querySelector('#hq-now-anchor')?.textContent).toContain('hq.now.anchor.label');
  });

  describe('zone', () => {
    const zoneTexts = (el: HTMLElement) => Array.from(el.querySelectorAll('.zone')).map((z) => z.textContent?.trim());

    it('shows the current zone while the game is live and flags a restricted area', () => {
      const live = fakeLive({ location: { name: 'Lorville', system: null }, presence: presence(1000) }, [
        { ...ev(0), type: 'restricted.entered' },
        { ...ev(1), type: 'armistice.entered' },
        { ...ev(2), type: 'session.joined' },
      ]);
      const el = mount(live).nativeElement as HTMLElement;
      expect(zoneTexts(el)).toEqual(['hq.now.zone.restricted', 'hq.now.zone.armistice']);
      expect(el.querySelector('.zone')?.classList.contains('warn')).toBeTrue();
    });

    it('reads unknown when this session has no zone event', () => {
      const live = fakeLive({ location: { name: 'Lorville', system: null }, presence: presence(1000) }, [
        { ...ev(0), type: 'session.joined' },
        { ...ev(1), type: 'armistice.entered' },
      ]);
      expect(zoneTexts(mount(live).nativeElement as HTMLElement)).toEqual(['hq.now.zone.unknown']);
    });

    it('shows no zone without a live signal', () => {
      const live = fakeLive({ location: { name: 'Lorville', system: null }, presence: presence(4 * 60_000) }, [
        { ...ev(0), type: 'armistice.entered' },
        { ...ev(1), type: 'session.joined' },
      ]);
      expect((mount(live).nativeElement as HTMLElement).querySelector('.zones')).toBeNull();
    });
  });

  it('renders the location anchor as system > place with the ship and the mission count', () => {
    const f = mount(
      fakeLive({
        location: { name: 'Lorville', system: 'Stanton' },
        currentShip: 'Cutlass Black',
        contracts: [{ missionId: 'm1', name: 'Delivery' }, { missionId: 'm2', name: 'Bounty' }],
      }),
    );
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('.sys')?.textContent).toBe('Stanton');
    expect(el.querySelector('.place')?.textContent).toBe('Lorville');
    expect(el.querySelector('.ship-name')?.textContent).toBe('Cutlass Black');
    expect(el.querySelector('.count')?.textContent).toBe('2');
    expect(el.querySelector('.toast')).toBeNull();
  });

  it('previews 3 log rows and offers "show all" only beyond that', () => {
    const f = mount(fakeLive({ location: { name: 'X', system: null } }, [0, 1, 2, 3, 4].map(ev)));
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.log li').length).toBe(3);
    expect(el.querySelectorAll('.log-head button').length).toBe(1);
  });

  it('log dialog groups by day and pages with "Mehr laden"', async () => {
    // Fixed local times: events relative to "now" split into an extra day just after midnight.
    const at = (day: number, minute: number) => new Date(2026, 10, day, 12, minute).toISOString();
    const live = fakeLive({}, [{ ...ev(0), at: at(5, 1) }, { ...ev(1), at: at(5, 0) }, { ...ev(2), at: at(2, 0) }]);
    TestBed.configureTestingModule({
      providers: [provideTranslateService(), { provide: HqLiveService, useValue: live }],
    });
    const f = TestBed.createComponent(HqLogDialogComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelectorAll('h4.day').length).toBe(2);
    (el.querySelector('button.more') as HTMLButtonElement).click();
    await f.whenStable();
    expect(live.loadMore).toHaveBeenCalledTimes(1);
  });

  describe('Nachschub bundle', () => {
    beforeEach(() => localStorage.removeItem('sc.hq.nachschub.focus'));
    afterEach(() => localStorage.removeItem('sc.hq.nachschub.focus'));
    const nach = (id: string, name: string, slot: number): Nachschub => ({ id, name, status: 'active', slot, snapshot: {}, createdAt: '2026-11-07T10:00:00Z', archivedAt: null });
    const step = (kind: 'buy' | 'mine', label: string, location: string | null, system: string | null) => ({
      kind, label, location, system, className: null, qty: 2, supplyId: null, missionRef: null,
    });

    function mountRun() {
      const f = mount(fakeLive({ location: { name: 'Lorville', system: 'Stanton' } }));
      const ns = TestBed.inject(NachschubService);
      ns.packages.set([nach('n1', 'Rattler-Vorrat', 1), nach('n2', 'Medpens', 2)]);
      const einsatz = TestBed.inject(HqEinsatzService);
      einsatz.create({ title: 'Einkauf Area18', packageId: 'n1', steps: [step('buy', 'Rattler', 'Area18', 'Stanton'), step('mine', 'Titan', 'Pyro I', 'Pyro')] });
      einsatz.create({ title: 'Anderer', packageId: 'n2', steps: [step('buy', 'Medpen', 'Area18', 'Stanton')] });
      f.detectChanges();
      return { f, el: f.nativeElement as HTMLElement, einsatz };
    }

    it('runs the Einsatz bundle of the focused Nachschub: its name, the route graphic and the next step', () => {
      const { el } = mountRun();
      expect(el.querySelector('.run-t b')?.textContent).toBe('Rattler-Vorrat');
      expect(el.querySelector('sc-hq-route-graphic')).not.toBeNull();
      expect(el.querySelector('.now-h')?.textContent).toContain('Rattler');
      expect(el.querySelectorAll('.cta button').length).toBe(1);
    });

    it('"Schritt erledigt" ticks the next step and moves on to the following one', () => {
      const { f, el, einsatz } = mountRun();
      (el.querySelector('.cta button') as HTMLButtonElement).click();
      f.detectChanges();
      expect(einsatz.ofPackage('n1')[0].steps[0].state).toBe('done');
      expect(el.querySelector('.now-h')?.textContent).toContain('Titan');
      // The step just finished can be taken back.
      expect(el.querySelectorAll('.cta button').length).toBe(2);
    });

    it('offers to switch the Nachschub, and the other one shows its own bundle', () => {
      const { f, el } = mountRun();
      (el.querySelector('.sw button') as HTMLButtonElement).click();
      f.detectChanges();
      const items = el.querySelectorAll('.menu button');
      expect(items.length).toBe(2);
      (items[1] as HTMLButtonElement).click();
      f.detectChanges();
      expect(el.querySelector('.run-t b')?.textContent).toBe('Medpens');
    });

    it('without any Nachschub it explains itself and leads to Planen', () => {
      const f = mount(fakeLive({}));
      const el = f.nativeElement as HTMLElement;
      expect(el.querySelector('.run')).toBeNull();
      expect(el.querySelector('.empty a')).not.toBeNull();
    });
  });
});
