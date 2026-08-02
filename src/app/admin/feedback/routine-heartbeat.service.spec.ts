import { TestBed } from '@angular/core/testing';
import { SupabaseClientProvider } from '../../core/supabase.client';
import {
  HEARTBEAT_FRESH_MS,
  HeartbeatState,
  RoutineHeartbeatService,
  heartbeatState,
  relativeFromNow,
} from './routine-heartbeat.service';

const MIN = 60_000;
const NOW = Date.parse('2026-07-30T12:00:00.000Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

/** Minimal PostgREST stub: `.from().select().eq().maybeSingle()`. */
function fakeSupabase(result: { data: unknown; error: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve(result),
  };
  return { client: { from: () => chain } } as unknown as SupabaseClientProvider;
}

/**
 * Liveness of the local admin-feedback routine (feedback a7573f0e): green when
 * the dev PC stamped recently, red when it went quiet, grey whenever we simply
 * do not know — the third state exists so a query failure can never be reported
 * as an outage.
 */
describe('routine heartbeat', () => {
  describe('heartbeatState', () => {
    it('is online for a stamp inside the freshness window', () => {
      expect(heartbeatState(iso(0), NOW)).toBe('online');
      expect(heartbeatState(iso(19 * MIN), NOW)).toBe('online');
      // One missed cycle must NOT cry wolf — that is why the window is 45 min
      // against a 20-minute cadence.
      expect(heartbeatState(iso(41 * MIN), NOW)).toBe('online');
      expect(heartbeatState(iso(HEARTBEAT_FRESH_MS - 1), NOW)).toBe('online');
    });

    it('is offline once the stamp ages past the window', () => {
      expect(heartbeatState(iso(HEARTBEAT_FRESH_MS), NOW)).toBe('offline');
      expect(heartbeatState(iso(3 * 60 * MIN), NOW)).toBe('offline');
      expect(heartbeatState(iso(9 * 24 * 60 * MIN), NOW)).toBe('offline');
    });

    it('treats a future stamp as clock skew, not as death', () => {
      expect(heartbeatState(iso(-5 * MIN), NOW)).toBe('online');
    });

    it('is unknown without a usable timestamp', () => {
      expect(heartbeatState(null, NOW)).toBe('unknown');
      expect(heartbeatState(undefined, NOW)).toBe('unknown');
      expect(heartbeatState('', NOW)).toBe('unknown');
      expect(heartbeatState('not-a-date', NOW)).toBe('unknown');
    });
  });

  describe('relativeFromNow', () => {
    it('formats the last check-in in the active language', () => {
      expect(relativeFromNow(iso(5 * MIN), NOW, 'de')).toContain('5');
      expect(relativeFromNow(iso(3 * 60 * MIN), NOW, 'en')).toContain('3');
    });

    it('returns null when there is nothing to describe', () => {
      expect(relativeFromNow(null, NOW, 'de')).toBeNull();
      expect(relativeFromNow('not-a-date', NOW, 'de')).toBeNull();
    });
  });

  describe('RoutineHeartbeatService', () => {
    async function stateFor(result: { data: unknown; error: unknown }): Promise<HeartbeatState> {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [{ provide: SupabaseClientProvider, useValue: fakeSupabase(result) }],
      });
      const svc = TestBed.inject(RoutineHeartbeatService);
      await svc.refresh();
      return svc.state();
    }

    it('reports online for a fresh row', async () => {
      expect(await stateFor({ data: { last_seen_at: new Date().toISOString(), note: 'cycle ok' }, error: null })).toBe(
        'online',
      );
    });

    it('reports offline for a stale row', async () => {
      const stale = new Date(Date.now() - (HEARTBEAT_FRESH_MS + MIN)).toISOString();
      expect(await stateFor({ data: { last_seen_at: stale, note: null }, error: null })).toBe('offline');
    });

    it('reports unknown when the row does not exist yet', async () => {
      expect(await stateFor({ data: null, error: null })).toBe('unknown');
    });

    it('reports unknown — never offline — when the query fails', async () => {
      expect(await stateFor({ data: null, error: { message: 'permission denied' } })).toBe('unknown');
    });

    it('keeps the note for the tooltip', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          {
            provide: SupabaseClientProvider,
            useValue: fakeSupabase({ data: { last_seen_at: new Date().toISOString(), note: 'queue empty' }, error: null }),
          },
        ],
      });
      const svc = TestBed.inject(RoutineHeartbeatService);
      await svc.refresh();
      expect(svc.note()).toBe('queue empty');
    });
  });
});
