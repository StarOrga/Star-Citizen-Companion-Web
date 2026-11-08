import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { logWarn } from '../../core/log';
import { NachschubService } from './nachschub.service';

export const NACHSCHUB_FOCUS_KEY = 'sc.hq.nachschub.focus';

/**
 * Which Nachschub HQ is looking at: Planen shows it in full, Jetzt runs exactly this one (concept round 3: "Jetzt
 * bedient genau dieses Nachschub"). Remembered in this browser. Two views of the same pick:
 *
 *  - `selected`: an ACTIVE Nachschub (Planen's board); a pick that archived falls back to the first slot there, the
 *    archive stays one click away.
 *  - `current`: what Jetzt runs. A pick that finished and archived is KEPT (its Einsaetze are still the route the reader
 *    is on) instead of silently switching to another Nachschub; only a pick that no longer exists at all (deleted)
 *    falls back to the first active one.
 */
@Injectable({ providedIn: 'root' })
export class NachschubFocusService {
  private readonly nachschub = inject(NachschubService);
  private readonly picked = signal<string | null>(read());

  /** The Nachschub in focus (an active one), else the first active, else null. */
  readonly selected = computed(() => {
    const active = this.nachschub.active();
    return active.find((n) => n.id === this.picked()) ?? active[0] ?? null;
  });

  /** What Jetzt showed while nobody had picked one yet (the first active): it must not jump when that one archives. */
  private readonly shown = signal<string | null>(null);

  /** The pick as Jetzt runs it: active, else archived (kept, see above), else the first active, else null. */
  readonly current = computed(() => {
    const id = this.picked() ?? this.shown();
    const all = this.nachschub.packages();
    const pick = id ? all.find((n) => n.id === id) : undefined;
    return pick ?? this.nachschub.active()[0] ?? null;
  });

  constructor() {
    effect(() => {
      const first = this.selected()?.id ?? null;
      const all = this.nachschub.packages();
      untracked(() => {
        if (this.picked()) return;
        const s = this.shown();
        if (first && (!s || !all.some((n) => n.id === s))) this.shown.set(first);
      });
    });
  }

  select(id: string | null): void {
    this.picked.set(id);
    try {
      if (id) localStorage.setItem(NACHSCHUB_FOCUS_KEY, id);
      else localStorage.removeItem(NACHSCHUB_FOCUS_KEY);
    } catch (err) {
      logWarn('hq', 'nachschub focus write failed', err);
    }
  }
}

function read(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(NACHSCHUB_FOCUS_KEY);
  } catch {
    return null;
  }
}
