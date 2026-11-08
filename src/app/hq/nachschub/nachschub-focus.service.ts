import { Injectable, computed, inject, signal } from '@angular/core';
import { logWarn } from '../../core/log';
import { NachschubService } from './nachschub.service';

export const NACHSCHUB_FOCUS_KEY = 'sc.hq.nachschub.focus';

/**
 * Which Nachschub HQ is looking at: Planen shows it in full, Jetzt runs exactly this one (concept round 3: "Jetzt
 * bedient genau dieses Nachschub"). Remembered in this browser; an id that no longer names an active Nachschub
 * falls back to the first slot.
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
