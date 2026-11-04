import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { HqLiveEventRow } from '../data/hq-db.types';
import { HqLogDialogComponent } from './hq-log-dialog.component';
import { HqLiveService } from './hq-live.service';
import { HqNowComponent } from './hq-now.component';

function ev(i: number): HqLiveEventRow {
  return {
    user_id: 'u1', id: 'e' + i, type: 'qt.arrived', data: {}, at: new Date(Date.now() - i * 60_000).toISOString(),
    applied: null, undone: false, synced_at: '', updated_at: '',
  };
}

function fakeLive(state: Record<string, unknown> | null, events: HqLiveEventRow[] = []) {
  return {
    state: signal(state),
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
  function mount(live: ReturnType<typeof fakeLive>): ComponentFixture<HqNowComponent> {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideTranslateService(), { provide: HqLiveService, useValue: live }],
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
    const live = fakeLive({}, [ev(0), ev(1), { ...ev(2), at: new Date(Date.now() - 3 * 86_400_000).toISOString() }]);
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
});
