import { signal } from '@angular/core';
import type { HqItemMark } from './hq-item-marks.service';

/**
 * In-memory stand-in for `HqItemMarksService` in specs that render the ownership card: the real
 * service queries `hq_item_marks` through the live Supabase client, which never answers inside
 * Karma and leaves `whenStable()` waiting until the spec times out.
 */
export function fakeItemMarks(start: readonly HqItemMark[] = []) {
  const marks = signal<readonly HqItemMark[]>(start);
  const markOf = (className: string) => marks().find((m) => m.class_name === className) ?? null;
  return {
    marks,
    loaded: signal(true),
    error: signal<string | null>(null),
    markOf,
    noteOf: (className: string) => markOf(className)?.note ?? null,
    isPinned: (className: string) => markOf(className)?.pinned_rank != null,
    ensureLoaded: () => Promise.resolve(),
    setNote: (className: string, note: string) => {
      const rest = marks().filter((m) => m.class_name !== className);
      const prev = markOf(className);
      marks.set([...rest, { class_name: className, note: note.trim() || null, pinned_rank: prev?.pinned_rank ?? null }]);
      return Promise.resolve(true);
    },
    setPinned: (className: string, pinned: boolean) => {
      const rest = marks().filter((m) => m.class_name !== className);
      const prev = markOf(className);
      marks.set([...rest, { class_name: className, note: prev?.note ?? null, pinned_rank: pinned ? 1 : null }]);
      return Promise.resolve(true);
    },
  };
}
