import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../auth/auth.service';
import { HangarService } from '../../hangar/hangar.service';
import { NewsService } from '../../news/news.service';
import { HqEinsatzService } from '../data/hq-einsatz.service';
import { HqInventoryService } from '../data/hq-inventory.service';
import type { Nachschub } from '../nachschub/nachschub.model';
import { NachschubService } from '../nachschub/nachschub.service';
import { HqLiveService } from '../now/hq-live.service';
import type { EventRow } from './event-logic';
import { EventHqService } from './event-hq.service';
import { normalizeSheet } from './event-sheet';
import { EventSheetService } from './event-sheet.service';
import { UserEventStateService } from './user-event-state.service';

const field = (value: unknown) => ({ value, confidence: 1, source: 'admin', review: 'approved' });

const event: EventRow = {
  id: 'ev', name: 'Ev', startDate: '2000-01-01', endDate: '2999-12-31', dateStatus: 'confirmed', status: 'scheduled', hidden: false, freeFly: false,
  sheet: normalizeSheet({ schema: 1, fields: { area: field({ kind: 'places', systems: ['stanton'], places: ['lorville'] }), venues: field(['verse']) } }),
};
const n: Nachschub = { id: 'n', name: 'N', status: 'active', slot: 1, snapshot: {}, createdAt: '2026-11-02', archivedAt: null, type: 'event', eventId: 'ev' };

describe('EventHqService offer freshness (F9)', () => {
  const state = signal<Record<string, unknown> | null>(null);

  beforeEach(() => {
    state.set({ location: { system: 'Stanton', place: 'Lorville' }, presence: { gameRunning: true, at: new Date().toISOString() } });
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { user: () => null } },
        { provide: EventSheetService, useValue: { events: signal([event]), byId: signal(new Map([['ev', event]])), loaded: signal(true), error: signal(null), load: () => Promise.resolve() } },
        { provide: UserEventStateService, useValue: { states: signal(new Map()), done: signal([]), loaded: signal(true), error: signal(null), stateOf: () => ({ status: 'open', progress: {}, claimed: {} }) } },
        { provide: NewsService, useValue: { patchLines: () => [] } },
        { provide: NachschubService, useValue: { active: () => [n], packages: signal([n]), loaded: signal(true) } },
        { provide: HqEinsatzService, useValue: { ofPackage: () => [], ready: signal(false) } },
        { provide: HqInventoryService, useValue: {} },
        { provide: HangarService, useValue: {} },
        { provide: HqLiveService, useValue: { state, events: signal([]) } },
      ],
    });
  });

  it('offers while the life sign is fresh and withdraws once it is stale', () => {
    const svc = TestBed.inject(EventHqService);
    const now = Date.now();
    state.set({ location: { system: 'Stanton', place: 'Lorville' }, presence: { gameRunning: true, at: new Date(now).toISOString() } });
    expect(svc.offer(null, null, now)?.nachschubId).toBe('n');
    // Same state object, ten minutes later: the life sign is stale, so there is no offer any more.
    expect(svc.offer(null, null, now + 10 * 60 * 1000)).toBeNull();
  });

  it('no app signal, no offer', () => {
    const svc = TestBed.inject(EventHqService);
    state.set(null);
    expect(svc.offer(null, null, Date.now())).toBeNull();
  });
});
