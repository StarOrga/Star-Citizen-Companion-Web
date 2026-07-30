import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseClientProvider } from '../../core/supabase.client';

/**
 * Liveness of the local admin-feedback routine (feedback a7573f0e).
 *
 * The routine is a Claude scheduled task on the dev PC that fires roughly
 * every 20 minutes — not a cloud agent. When the machine is off, Claude is
 * closed, or the usage limit is reached, it stops without saying so, and from
 * the board "nothing open" and "nothing running" look identical.
 *
 * Every cycle the routine stamps `public.routine_heartbeat` before it does
 * anything else (runbook STEP 0.5), so its poll doubles as a proof-of-life.
 * This service reads that single row; the panel turns it into a small dot.
 */

/** Row key the scheduled task stamps. */
export const HEARTBEAT_ROUTINE_ID = 'admin-feedback-routine';

/**
 * How old a stamp may get before we call the dev PC unreachable.
 *
 * The cadence is 20 minutes, so 45 lets ~2 cycles go missing before the dot
 * turns red. Anything tighter (say 25 min) would cry wolf on every cycle that
 * merely ran long or started late; anything much wider would hide a genuinely
 * dead routine for most of an hour.
 */
export const HEARTBEAT_FRESH_MS = 45 * 60 * 1000;

/** How often the panel re-reads the row while it is open. */
export const HEARTBEAT_POLL_MS = 60_000;

/**
 * `unknown` is a first-class state, not an error bucket: a missing row or a
 * failed query says nothing about the dev PC, and painting that red would be
 * a lie the admin then has to go and disprove.
 */
export type HeartbeatState = 'online' | 'offline' | 'unknown';

/**
 * Pure freshness verdict — the whole decision, extracted so it is testable
 * without a Supabase client or a fake clock inside the service.
 */
export function heartbeatState(lastSeenAt: string | null | undefined, now: number): HeartbeatState {
  if (!lastSeenAt) return 'unknown';
  const seen = Date.parse(lastSeenAt);
  if (!Number.isFinite(seen)) return 'unknown';
  // A stamp from the future means clock skew, not death — treat it as fresh.
  return now - seen < HEARTBEAT_FRESH_MS ? 'online' : 'offline';
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

  private readonly lastSeenAt = signal<string | null>(null);
  private readonly noteText = signal<string | null>(null);
  /** True after a query that came back with an error — forces `unknown`. */
  private readonly errored = signal(false);
  /** Our own clock, bumped on every poll, so staleness decays on screen. */
  private readonly now = signal(Date.now());
  private inFlight = false;

  /** Newest stamp we know of, ISO-8601, or null when we have never seen one. */
  readonly lastSeen = this.lastSeenAt.asReadonly();
  /** Short note the routine left with its stamp (may be null). */
  readonly note = this.noteText.asReadonly();
  /** Clock the freshness verdict is measured against. */
  readonly checkedAt = this.now.asReadonly();

  readonly state = computed<HeartbeatState>(() =>
    this.errored() ? 'unknown' : heartbeatState(this.lastSeenAt(), this.now()),
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
        .select('last_seen_at, note')
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
      const row = data as { last_seen_at?: string | null; note?: string | null } | null;
      this.lastSeenAt.set(row?.last_seen_at ?? null);
      this.noteText.set(row?.note ?? null);
    } catch {
      this.errored.set(true);
    } finally {
      this.inFlight = false;
    }
  }
}
