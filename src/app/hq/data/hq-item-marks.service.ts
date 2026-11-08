import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { toErrorKey } from '../../core/describe-error';
import { SupabaseClientProvider } from '../../core/supabase.client';

export const HQ_ITEM_NOTE_MAX = 500;
export const HQ_ITEM_PIN_MAX = 99;

/** One row of `hq_item_marks` (migration 20261108200000): the reader's note and pin on an item. */
export interface HqItemMark {
  class_name: string;
  note: string | null;
  pinned_rank: number | null;
}

/**
 * Personal note and pin per inventory item (keyed by class_name, not by storage place), shown on
 * the item page's "Dein Bestand" card. Reads and writes are RLS self-only.
 */
@Injectable({ providedIn: 'root' })
export class HqItemMarksService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);

  readonly marks = signal<readonly HqItemMark[]>([]);
  readonly loaded = signal(false);
  /** i18n key of the last failed load/save, never raw text. */
  readonly error = signal<string | null>(null);

  private readonly byClass = computed(() => new Map(this.marks().map((m) => [m.class_name, m])));
  private inFlight: Promise<void> | null = null;

  markOf(className: string): HqItemMark | null {
    return this.byClass().get(className) ?? null;
  }

  noteOf(className: string): string | null {
    return this.markOf(className)?.note ?? null;
  }

  isPinned(className: string): boolean {
    return this.markOf(className)?.pinned_rank != null;
  }

  /** Loads once per session; a signed-out reader gets an empty list. */
  ensureLoaded(): Promise<void> {
    if (this.loaded()) return Promise.resolve();
    if (!this.inFlight) {
      this.inFlight = this.loadOnce().finally(() => (this.inFlight = null));
    }
    return this.inFlight;
  }

  private async loadOnce(): Promise<void> {
    if (!this.auth.user()) return;
    this.error.set(null);
    try {
      const { data, error } = await this.sb.client.from('hq_item_marks' as never).select('class_name,note,pinned_rank');
      if (error) throw error;
      this.marks.set((data ?? []) as unknown as HqItemMark[]);
      this.loaded.set(true);
    } catch (err) {
      this.error.set(toErrorKey('hq', 'itemMarks.load', err));
    }
  }

  /** Saves the note (blank clears it). False on invalid input or failure. */
  setNote(className: string, note: string): Promise<boolean> {
    const n = note.trim();
    if (n.length > HQ_ITEM_NOTE_MAX) return Promise.resolve(false);
    return this.write(className, { note: n || null }, 'note');
  }

  /** Pins (next free rank) or unpins the item. */
  setPinned(className: string, pinned: boolean): Promise<boolean> {
    const rank = pinned ? Math.min(HQ_ITEM_PIN_MAX, Math.max(0, ...this.marks().map((m) => m.pinned_rank ?? 0)) + 1) : null;
    return this.write(className, { pinned_rank: rank }, 'pin');
  }

  private async write(className: string, patch: Partial<HqItemMark>, op: string): Promise<boolean> {
    const userId = this.auth.user()?.id;
    const cls = className.trim();
    if (!userId || !cls || cls.length > 200) return false;
    this.error.set(null);
    try {
      const have = this.markOf(cls);
      const next: HqItemMark = { class_name: cls, note: have?.note ?? null, pinned_rank: have?.pinned_rank ?? null, ...patch };
      const empty = next.note === null && next.pinned_rank === null;
      const t = this.sb.client.from('hq_item_marks' as never);
      const { error } = empty
        ? await t.delete().eq('user_id', userId).eq('class_name', cls)
        : await t.upsert({ user_id: userId, ...next } as never, { onConflict: 'user_id,class_name' });
      if (error) throw error;
      this.marks.set([...this.marks().filter((m) => m.class_name !== cls), ...(empty ? [] : [next])]);
      return true;
    } catch (err) {
      this.error.set(toErrorKey('hq', `itemMarks.${op}`, err));
      return false;
    }
  }
}
