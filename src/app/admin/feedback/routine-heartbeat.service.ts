import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseClientProvider } from '../../core/supabase.client';

/**
 * Liveness of the local admin-feedback routine (feedback a7573f0e).
 *
 * The routine is a Claude scheduled task on the dev PC — not a cloud agent.
 * When the machine is off, Claude is closed, or the usage limit is reached,
 * it stops without saying so, and from the board "nothing open" and "nothing
 * running" look identical.
 *
 * Every cycle the routine's gate script stamps `public.routine_heartbeat`
 * before it does anything else, so its poll doubles as a proof-of-life. This
 * service reads that single row; the panel turns it into a tint on its title.
 *
 * Since migration 20260913121500 the row also carries `next_run_at` (when the
 * scheduler will fire next — the cadence is a table in the gate script and is
 * NOT mirrored here), `state` (idle / running / paused) and the run lock
 * timestamps. The freshness verdict therefore no longer hard-codes a cadence:
 * a stamp is fresh while the announced next run, plus a small grace for the
 * scheduler's jitter, lies in the future. Rows written before that migration
 * (no `next_run_at`) fall back to the old fixed window.
 */

/** Row key the scheduled task stamps. */
export const HEARTBEAT_ROUTINE_ID = 'admin-feedback-routine';

/**
 * Legacy freshness window, used ONLY for rows that carry no `next_run_at`
 * (stamped by a routine that predates the gate script). Kept at its original
 * value so an old stamp is judged exactly as before.
 */
export const HEARTBEAT_FRESH_MS = 45 * 60 * 1000;

/**
 * Slack added on top of `next_run_at` before we call the routine late. The
 * Desktop scheduler applies a deterministic jitter of a few minutes and a
 * cycle needs a moment to reach the gate; 15 minutes covers both without
 * hiding a genuinely dead routine for long.
 */
export const HEARTBEAT_GRACE_MS = 15 * 60 * 1000;

/**
 * A `running` state older than this is a run that died without releasing its
 * lock. The gate takes such a lock over; the panel stops calling it running.
 * Mirrors the gate script's `RUN_LOCK_MAX_MIN`.
 */
export const RUN_LOCK_MAX_MS = 3 * 60 * 60 * 1000;

/** How often the panel re-reads the row while it is open. */
export const HEARTBEAT_POLL_MS = 60_000;

/**
 * `unknown` is a first-class state, not an error bucket: a missing row or a
 * failed query says nothing about the dev PC, and painting that red would be
 * a lie the admin then has to go and disprove.
 *
 * `running` and `paused` are the two states the old dot could not express —
 * "a run is working right now" and "the routine polls but claims nothing
 * because the usage limit is close". Both are alive; neither is green-idle.
 */
export type HeartbeatState = 'online' | 'running' | 'paused' | 'offline' | 'unknown';

/** The columns the panel reads (all optional: older rows lack the new ones). */
export interface HeartbeatRow {
  last_seen_at?: string | null;
  note?: string | null;
  next_run_at?: string | null;
  state?: string | null;
  run_started_at?: string | null;
  run_finished_at?: string | null;
}

const parse = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/**
 * Pure freshness verdict — the whole decision, extracted so it is testable
 * without a Supabase client or a fake clock inside the service. Accepts the
 * bare `last_seen_at` string for callers (and tests) written before the row
 * grew its extra columns.
 */
export function heartbeatState(row: HeartbeatRow | string | null | undefined, now: number): HeartbeatState {
  const r: HeartbeatRow | null = typeof row === 'string' ? { last_seen_at: row } : (row ?? null);
  const seen = parse(r?.last_seen_at);
  if (seen === null) return 'unknown';

  // A live run lock outranks the clock: the routine is demonstrably busy.
  if (r?.state === 'running') {
    const started = parse(r.run_started_at);
    const finished = parse(r.run_finished_at);
    const stillHeld = started !== null && (finished === null || finished < started);
    if (stillHeld && now - started < RUN_LOCK_MAX_MS) return 'running';
  }

  const due = parse(r?.next_run_at);
  // A stamp from the future means clock skew, not death — treat it as fresh.
  const fresh = due !== null ? now < due + HEARTBEAT_GRACE_MS : now - seen < HEARTBEAT_FRESH_MS;
  if (!fresh) return 'offline';
  return r?.state === 'paused' ? 'paused' : 'online';
}

/**
 * The routine's `note` is a machine key, not prose (migration 20260913121500):
 * the panel translates the known keys and shows anything else verbatim, so a
 * hand-written note from an older run still reaches the tooltip.
 */
export function noteKey(note: string | null | undefined): { key: string; params?: Record<string, string> } | null {
  if (!note) return null;
  const n = note.trim();
  const counted = /^(work|shipped|claimed):(\d+)$/.exec(n);
  if (counted) return { key: `adminFeedback.heartbeat.note.${counted[1]}`, params: { n: counted[2] } };
  const plain: Record<string, string> = {
    'queue-empty': 'queueEmpty',
    'paused-usage-limit': 'pausedUsageLimit',
    'skip-cadence': 'skipCadence',
    'gate-error': 'gateError',
    running: 'running',
  };
  return plain[n] ? { key: `adminFeedback.heartbeat.note.${plain[n]}` } : null;
}

/**
 * Localized "vor 5 Minuten" / "5 minutes ago" for the tooltip. Returns null
 * when there is nothing to describe, so callers can fall back to their
 * "never seen" wording instead of printing an empty gap.
 */
export function relativeFromNow(lastSeenAt: string | null | undefined, now: number, locale: string): string | null {
  if (!lastSeenAt) return null;
  const seen = Date.parse(lastSeenAt);
  if (!Number.isFinite(seen)) return null;

  const minutes = Math.round((seen - now) / 60_000);
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    Math.abs(minutes) < 60
      ? [minutes, 'minute']
      : Math.abs(minutes) < 60 * 48
        ? [Math.round(minutes / 60), 'hour']
        : [Math.round(minutes / (60 * 24)), 'day'];

  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(value, unit);
  } catch {
    // Exotic locale tag or an engine without RelativeTimeFormat — the dot is
    // the signal that matters, the tooltip may degrade.
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class RoutineHeartbeatService {
  private readonly sb = inject(SupabaseClientProvider);

  private readonly row = signal<HeartbeatRow | null>(null);
  /** True after a query that came back with an error — forces `unknown`. */
  private readonly errored = signal(false);
  /** Our own clock, bumped on every poll, so staleness decays on screen. */
  private readonly now = signal(Date.now());
  private inFlight = false;

  /** Newest stamp we know of, ISO-8601, or null when we have never seen one. */
  readonly lastSeen = computed(() => this.row()?.last_seen_at ?? null);
  /** Short note the routine left with its stamp (may be null). */
  readonly note = computed(() => this.row()?.note ?? null);
  /** When the routine announced its next cycle (null on legacy rows). */
  readonly nextRunAt = computed(() => this.row()?.next_run_at ?? null);
  /** Clock the freshness verdict is measured against. */
  readonly checkedAt = this.now.asReadonly();

  readonly state = computed<HeartbeatState>(() =>
    this.errored() ? 'unknown' : heartbeatState(this.row(), this.now()),
  );

  /**
   * Re-read the row. Advances the internal clock even when the request is
   * skipped or fails, so an unreachable backend still lets the dot age out
   * instead of freezing on a stale green.
   */
  async refresh(): Promise<void> {
    this.now.set(Date.now());
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const { data, error } = await this.sb.client
        .from('routine_heartbeat')
        .select('last_seen_at, note, next_run_at, state, run_started_at, run_finished_at')
        .eq('id', HEARTBEAT_ROUTINE_ID)
        .maybeSingle();

      if (error) {
        // Don't drop what we knew — `errored` alone decides the verdict, so a
        // transient failure reads as "unknown" and recovers on the next poll.
        this.errored.set(true);
        return;
      }

      this.errored.set(false);
      // No row (never stamped, or RLS says this session is not an admin) is
      // legitimately "unknown", not "offline".
      this.row.set((data as HeartbeatRow | null) ?? null);
    } catch {
      this.errored.set(true);
    } finally {
      this.inFlight = false;
    }
  }
}
