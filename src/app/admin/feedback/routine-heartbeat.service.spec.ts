import { TestBed } from '@angular/core/testing';
import { SupabaseClientProvider } from '../../core/supabase.client';
import {
  HEARTBEAT_FRESH_MS,
  HEARTBEAT_GRACE_MS,
  HeartbeatState,
  RUN_LOCK_MAX_MS,
  RoutineHeartbeatService,
  heartbeatState,
  noteKey,
  relativeFromNow,
} from './routine-heartbeat.service';

const MIN = 60_000;
const NOW = Date.parse('2026-07-30T12:00:00.000Z');
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const ahead = (msAhead: number) => new Date(NOW + msAhead).toISOString();

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
 * as an outage. Since the 2026-09-13 concept the row also announces its next
 * run, so the verdict follows the routine's real cadence instead of a constant.
 */
describe('routine heartbeat', () => {
  describe('heartbeatState — legacy rows (no next_run_at)', () => {
    it('is online for a stamp inside the freshness window', () => {
      expect(heartbeatState(iso(0), NOW)).toBe('online');
      expect(heartbeatState(iso(19 * MIN), NOW)).toBe('online');
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
      expect(heartbeatState({ last_seen_at: null, next_run_at: ahead(MIN) }, NOW)).toBe('unknown');
    });
  });

  describe('heartbeatState — rows that announce their next run', () => {
    it('is online while the announced next run (plus grace) is still ahead, however old the stamp', () => {
      // An hourly cadence: stamped 55 minutes ago, next run in 5 minutes — that
      // is a healthy routine, and the old fixed window would have called it red.
      expect(heartbeatState({ last_seen_at: iso(55 * MIN), next_run_at: ahead(5 * MIN) }, NOW)).toBe('online');
      // A two-hour night slot is just as healthy.
      expect(heartbeatState({ last_seen_at: iso(110 * MIN), next_run_at: ahead(10 * MIN) }, NOW)).toBe('online');
      expect(heartbeatState({ last_seen_at: iso(20 * MIN), next_run_at: iso(1), state: 'idle' }, NOW)).toBe('online');
    });

    it('is offline once the announced run is overdue by more than the grace', () => {
      expect(heartbeatState({ last_seen_at: iso(30 * MIN), next_run_at: iso(HEARTBEAT_GRACE_MS + 1) }, NOW)).toBe('offline');
      expect(heartbeatState({ last_seen_at: iso(5 * 24 * 60 * MIN), next_run_at: iso(5 * 24 * 60 * MIN) }, NOW)).toBe('offline');
    });

    it('reports running while a run holds the lock', () => {
      expect(
        heartbeatState({ last_seen_at: iso(MIN), next_run_at: ahead(19 * MIN), state: 'running', run_started_at: iso(40 * MIN) }, NOW),
      ).toBe('running');
      // A lock that was released is no longer running.
      expect(
        heartbeatState(
          { last_seen_at: iso(MIN), next_run_at: ahead(19 * MIN), state: 'running', run_started_at: iso(40 * MIN), run_finished_at: iso(2 * MIN) },
          NOW,
        ),
      ).toBe('online');
    });

    it('stops calling a dead run "running" once its lock is older than the takeover limit', () => {
      const dead = { last_seen_at: iso(MIN), next_run_at: ahead(19 * MIN), state: 'running', run_started_at: iso(RUN_LOCK_MAX_MS + MIN) };
      expect(heartbeatState(dead, NOW)).toBe('online');
    });

    it('reports paused while the usage brake is engaged and the routine keeps stamping', () => {
      expect(heartbeatState({ last_seen_at: iso(MIN), next_run_at: ahead(19 * MIN), state: 'paused' }, NOW)).toBe('paused');
      // A paused routine that stopped stamping is offline, not paused.
      expect(heartbeatState({ last_seen_at: iso(3 * 60 * MIN), next_run_at: iso(2 * 60 * MIN), state: 'paused' }, NOW)).toBe('offline');
    });
  });

  describe('noteKey', () => {
    it('maps the gate keys to i18n keys, counted ones with their number', () => {
      expect(noteKey('queue-empty')).toEqual({ key: 'adminFeedback.heartbeat.note.queueEmpty' });
      expect(noteKey('work:3')).toEqual({ key: 'adminFeedback.heartbeat.note.work', params: { n: '3' } });
      expect(noteKey('shipped:2')).toEqual({ key: 'adminFeedback.heartbeat.note.shipped', params: { n: '2' } });
      expect(noteKey('paused-usage-limit')).toEqual({ key: 'adminFeedback.heartbeat.note.pausedUsageLimit' });
    });

    it('leaves a free-text note to be shown verbatim', () => {
      expect(noteKey('queue empty, keine Holds')).toBeNull();
      expect(noteKey(null)).toBeNull();
      expect(noteKey('')).toBeNull();
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

    it('reports online for an old stamp whose announced next run is still ahead', async () => {
      const stamped = new Date(Date.now() - 55 * MIN).toISOString();
      const next = new Date(Date.now() + 5 * MIN).toISOString();
      expect(await stateFor({ data: { last_seen_at: stamped, note: 'queue-empty', next_run_at: next, state: 'idle' }, error: null })).toBe(
        'online',
      );
    });

    it('reports running while the run lock is held', async () => {
      const now = Date.now();
      const row = {
        last_seen_at: new Date(now - MIN).toISOString(),
        next_run_at: new Date(now + 19 * MIN).toISOString(),
        state: 'running',
        run_started_at: new Date(now - 10 * MIN).toISOString(),
        run_finished_at: null,
      };
      expect(await stateFor({ data: row, error: null })).toBe('running');
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
