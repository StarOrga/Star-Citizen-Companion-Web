import { Injectable, inject } from '@angular/core';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { HqLiveEventRow, HqLiveStateRow } from '../data/hq-db.types';

export type LiveStatus = 'SUBSCRIBED' | 'CLOSED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | string;

export interface LiveSubscription {
  onState: (row: HqLiveStateRow) => void;
  onEvent: (row: HqLiveEventRow) => void;
  onStatus: (status: LiveStatus) => void;
}

/** Thin Supabase access of the live page (the one place that knows table names), swapped out in specs. */
@Injectable({ providedIn: 'root' })
export class HqLiveStore {
  private readonly sb = inject(SupabaseClientProvider);

  async fetchState(uid: string): Promise<HqLiveStateRow | null> {
    const { data, error } = await this.sb.client.from('hq_live_state').select('*').eq('user_id', uid).maybeSingle();
    if (error) throw error;
    return (data as HqLiveStateRow | null) ?? null;
  }

  /** Newest first; `before` = ISO timestamp, only strictly older rows. */
  async fetchEvents(uid: string, limit: number, before?: string): Promise<HqLiveEventRow[]> {
    let q = this.sb.client.from('hq_live_events').select('*').eq('user_id', uid);
    if (before) q = q.lt('at', before);
    const { data, error } = await q.order('at', { ascending: false }).limit(limit);
    if (error) throw error;
    return (data ?? []) as HqLiveEventRow[];
  }

  /** Atomic claim: only one tab/device gets `true` for a not yet applied event. */
  async claim(uid: string, id: string, marker: Record<string, unknown>): Promise<boolean> {
    const { data, error } = await this.sb.client
      .from('hq_live_events')
      .update({ applied: marker })
      .eq('user_id', uid)
      .eq('id', id)
      .is('applied', null)
      .select('id');
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  }

  async patch(uid: string, id: string, patch: { applied?: Record<string, unknown>; undone?: boolean }): Promise<void> {
    const { error } = await this.sb.client.from('hq_live_events').update(patch).eq('user_id', uid).eq('id', id);
    if (error) throw error;
  }

  subscribe(uid: string, cb: LiveSubscription): () => void {
    const client = this.sb.client;
    const filter = `user_id=eq.${uid}`;
    const channel = client
      .channel(`hq-live-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hq_live_state', filter }, (p) => {
        if (p.new && 'state' in p.new) cb.onState(p.new as HqLiveStateRow);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hq_live_events', filter }, (p) => {
        if (p.new && 'type' in p.new) cb.onEvent(p.new as HqLiveEventRow);
      })
      .subscribe((status) => cb.onStatus(status));
    return () => {
      void client.removeChannel(channel);
    };
  }
}
