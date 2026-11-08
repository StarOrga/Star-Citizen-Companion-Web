import { Injectable, computed, inject, signal } from '@angular/core';
import { toErrorKey } from '../../core/describe-error';
import { SupabaseClientProvider } from '../../core/supabase.client';
import type { EventRow } from './event-logic';
import { normalizeSheet, type EventSheet } from './event-sheet';

/** `sc_events` row as PostgREST returns it (only the columns the rules need). */
export interface ScEventDbRow {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  date_status: 'confirmed' | 'estimated';
  status: 'scheduled' | 'cancelled';
  hidden: boolean;
  free_fly: boolean;
  sheet: unknown;
}

export function toEventRow(r: ScEventDbRow): EventRow {
  return {
    id: r.id,
    name: r.name,
    startDate: r.start_date,
    endDate: r.end_date,
    dateStatus: r.date_status,
    status: r.status,
    hidden: r.hidden,
    freeFly: r.free_fly,
    sheet: r.sheet ? normalizeSheet(r.sheet) : null,
  };
}

/**
 * Events with their PUBLIC data sheet (sc_events.sheet; fields under admin review are already blanked by the
 * database). Read-only; the admin side (drafts, history, apply) belongs to the review page.
 */
@Injectable({ providedIn: 'root' })
export class EventSheetService {
  private readonly sb = inject(SupabaseClientProvider);

  readonly events = signal<readonly EventRow[]>([]);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  /** i18n key of the last failed load, never raw text. */
  readonly error = signal<string | null>(null);

  private inFlight: Promise<void> | null = null;

  readonly byId = computed(() => new Map(this.events().map((e) => [e.id, e] as const)));

  sheetOf(eventId: string): EventSheet | null {
    return this.byId().get(eventId)?.sheet ?? null;
  }

  load(): Promise<void> {
    if (!this.inFlight) this.inFlight = this.loadOnce().finally(() => (this.inFlight = null));
    return this.inFlight;
  }

  private async loadOnce(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const since = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await this.sb.client
        .from('sc_events' as never)
        .select('id,name,start_date,end_date,date_status,status,hidden,free_fly,sheet')
        .eq('hidden', false)
        .gte('end_date', since)
        .order('start_date', { ascending: false })
        .limit(200);
      if (error) throw error;
      this.events.set(((data ?? []) as unknown as ScEventDbRow[]).map(toEventRow));
      this.loaded.set(true);
    } catch (err) {
      this.error.set(toErrorKey('hq', 'events.load', err));
    } finally {
      this.loading.set(false);
    }
  }
}
