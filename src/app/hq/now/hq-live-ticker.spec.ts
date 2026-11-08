import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import type { HqLiveEventRow } from '../data/hq-db.types';
import { HqLiveTickerComponent } from './hq-live-ticker.component';
import { HqLiveService } from './hq-live.service';
import { lastRelevantEvent, tickerAge, tickerVisible } from './hq-live-ticker.util';

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

describe('live ticker rules', () => {
  it('shows only on HQ pages other than Start and only once the app was ever connected', () => {
    expect(tickerVisible('inventar', true)).toBe(true);
    expect(tickerVisible('start', true)).toBe(false);
    expect(tickerVisible(null, true)).toBe(false);
    expect(tickerVisible('planen', false)).toBe(false);
  });

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
    expect(tickerAge(new Date(now - 2 * 86_400_000).toISOString(), now)).toEqual({ unit: 'days', n: 2 });
    expect(tickerAge('junk', now).unit).toBe('now');
  });
});

describe('HqLiveTickerComponent', () => {
  function mount(page: 'inventar' | 'start', opts: { conn?: 'connected' | 'expired' | 'never'; events?: HqLiveEventRow[]; state?: Record<string, unknown> | null }) {
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService(),
        { provide: HqLiveService, useValue: { state: signal(opts.state ?? (opts.conn === 'connected' ? { presence: { at: new Date().toISOString(), gameRunning: false } } : null)), events: signal(opts.events ?? []) } },
      ],
    });
    const f = TestBed.createComponent(HqLiveTickerComponent);
    f.componentRef.setInput('page', page);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  it('is green while the app is connected and names the last relevant event', () => {
    const el = mount('inventar', { conn: 'connected', events: [ev('inventory.opened', 2, { location: 'Lorville' })] });
    const t = el.querySelector('.ticker')!;
    expect(t.classList).not.toContain('off');
    expect(t.querySelector('.state')?.textContent).toBe('hq.ticker.on');
    expect(t.querySelector('em')?.textContent).toBe('hq.log.event.inventory.opened');
    expect(t.querySelector('small')?.textContent).toBe('hq.ticker.ago.minutes');
  });

  it('is grey when the app is off but was connected before, and still shows the last event', () => {
    const el = mount('inventar', { conn: 'expired', events: [ev('shop.purchase', 90)] });
    const t = el.querySelector('.ticker')!;
    expect(t.classList).toContain('off');
    expect(t.querySelector('.state')?.textContent).toBe('hq.ticker.off');
    expect(t.querySelector('em')?.textContent).toBe('hq.log.event.shop.purchase');
  });

  it('does not exist on Start, nor before the app was ever connected', () => {
    expect(mount('start', { conn: 'connected' }).querySelector('.ticker')).toBeNull();
    TestBed.resetTestingModule();
    expect(mount('inventar', { conn: 'never' }).querySelector('.ticker')).toBeNull();
    // A Starscape-only account is not an SCC signal: no state, no events -> no ticker at all.
  });
});
