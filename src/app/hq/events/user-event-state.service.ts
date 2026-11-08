import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { toErrorKey } from '../../core/describe-error';
import { SupabaseClientProvider } from '../../core/supabase.client';
import {
  USER_EVENT_STATUSES,
  emptyState,
  setProgress,
  type ClaimedReward,
  type ProgressSource,
  type TrackProgress,
  type UserEventState,
  type UserEventStatus,
} from './event-logic';

/** `user_event_state` row as PostgREST returns it. */
export interface UserEventStateDbRow {
  user_id: string;
  event_id: string;
  status: string;
  progress: Record<string, { value?: number; source?: string; updated_at?: string }> | null;
  claimed: Record<string, { channel?: string; at?: string; stored?: boolean; by?: string }> | null;
  updated_at: string;
}

export function toUserEventState(r: UserEventStateDbRow): UserEventState {
  const progress: Record<string, TrackProgress> = {};
  for (const [k, v] of Object.entries(r.progress ?? {})) {
    if (typeof v?.value !== 'number') continue;
    progress[k] = { value: v.value, source: v.source === 'live' ? 'live' : 'manual', updatedAt: v.updated_at ?? r.updated_at };
  }
  const claimed: Record<string, ClaimedReward> = {};
  for (const [k, v] of Object.entries(r.claimed ?? {})) {
    const channel = v?.channel === 'pledge' || v?.channel === 'both' ? v.channel : 'ingame';
    claimed[k] = { channel, at: v?.at ?? r.updated_at, stored: !!v?.stored, by: v?.by === 'live' ? 'live' : 'user' };
  }
  const status = (USER_EVENT_STATUSES as readonly string[]).includes(r.status) ? (r.status as UserEventStatus) : 'open';
  return { eventId: r.event_id, status, progress, claimed, updatedAt: r.updated_at };
}

/**
 * The signed-in user's event state (`user_event_state`, own rows). Writes go through `user_event_state_report`, which
 * merges progress per track and claims per reward by timestamp - so the SCC-App and the web can both write.
 */
@Injectable({ providedIn: 'root' })
export class UserEventStateService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);

  readonly states = signal<ReadonlyMap<string, UserEventState>>(new Map());
  readonly loading = signal(false);
  readonly loaded = signal(false);
  /** i18n key of the last failed load/save, never raw text. */
  readonly error = signal<string | null>(null);

  /** Completed events (Statistik). */
  readonly done = computed(() => [...this.states().values()].filter((s) => s.status === 'done'));

  private inFlight: Promise<void> | null = null;

  /** State of one event; an event the user never touched is `open` with no progress. */
  stateOf(eventId: string): UserEventState {
    return this.states().get(eventId) ?? emptyState(eventId, new Date(0).toISOString());
  }

  load(): Promise<void> {
    if (!this.inFlight) this.inFlight = this.loadOnce().finally(() => (this.inFlight = null));
    return this.inFlight;
  }

  private async loadOnce(): Promise<void> {
    if (!this.auth.user()) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const { data, error } = await this.sb.client.from('user_event_state' as never).select('*');
      if (error) throw error;
      const map = new Map<string, UserEventState>();
      for (const r of (data ?? []) as unknown as UserEventStateDbRow[]) map.set(r.event_id, toUserEventState(r));
      this.states.set(map);
      this.loaded.set(true);
    } catch (err) {
      this.error.set(toErrorKey('hq', 'events.state.load', err));
    } finally {
      this.loading.set(false);
    }
  }

  /** Sets the event status (open / done / dismissed / aborted). Progress and claims stay untouched. */
  setStatus(eventId: string, status: UserEventStatus): Promise<boolean> {
    return this.report(eventId, { status });
  }

  /** Manual progress for one track. */
  setTrackProgress(eventId: string, trackId: string, value: number, source: ProgressSource = 'manual'): Promise<boolean> {
    const at = new Date().toISOString();
    const next = setProgress(this.stateOf(eventId), trackId, value, source, at).progress[trackId];
    return this.report(eventId, { progress: { [trackId]: { value: next.value, source: next.source, updated_at: next.updatedAt } } });
  }

  /** Records a claim; `stored` = put into Bestand. */
  claim(eventId: string, rewardId: string, channel: 'pledge' | 'ingame' | 'both', stored: boolean): Promise<boolean> {
    return this.report(eventId, { claimed: { [rewardId]: { channel, at: new Date().toISOString(), stored, by: 'user' } } });
  }

  private async report(
    eventId: string,
    p: { status?: UserEventStatus; progress?: Record<string, unknown>; claimed?: Record<string, unknown> },
  ): Promise<boolean> {
    if (!this.auth.user()) return false;
    this.error.set(null);
    try {
      const { data, error } = await this.sb.client.rpc('user_event_state_report' as never, {
        p_event_id: eventId,
        p_progress: p.progress ?? {},
        p_claimed: p.claimed ?? {},
        p_status: p.status ?? null,
      } as never);
      if (error) throw error;
      const row = data as unknown as UserEventStateDbRow | null;
      if (row) {
        const map = new Map(this.states());
        map.set(row.event_id, toUserEventState(row));
        this.states.set(map);
      }
      return true;
    } catch (err) {
      this.error.set(toErrorKey('hq', 'events.state.save', err));
      return false;
    }
  }
}
