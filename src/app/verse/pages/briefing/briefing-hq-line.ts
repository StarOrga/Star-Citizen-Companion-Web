import { DestroyRef, Injectable, Injector, computed, effect, inject, signal } from '@angular/core';
import { AuthService } from '../../../auth/auth.service';
import { logWarn } from '../../../core/log';
import { endMs, openEvents, type OpenEvent } from '../../../hq/events/event-logic';
import type { EventSheetService } from '../../../hq/events/event-sheet.service';
import type { UserEventStateService } from '../../../hq/events/user-event-state.service';
import type { NachschubService } from '../../../hq/nachschub/nachschub.service';

/** One translated line: an i18n key under `verse.hub` plus its params. */
export interface HqLine {
  readonly key: string;
  readonly params: Readonly<Record<string, string | number>>;
}

const DAY_MS = 86_400_000;

/**
 * The HQ station's one value line (concept 2026-11-08, round 3 pin: "nur eine
 * zeile, event vorrangig sonst Offene Nachschübe oder alles paletti"):
 * a running limited-time event first (the one that ends first), else the open
 * Nachschübe, else the thematic all-clear.
 */
export function hqLine(open: readonly OpenEvent[], activeNachschub: number, nowMs: number): HqLine {
  const ev = open.find((o) => endMs(o.end) !== null) ?? open[0] ?? null;
  if (ev) {
    const name = ev.event.name;
    const end = endMs(ev.end);
    if (end === null) return { key: 'verse.hub.hqEventOpen', params: { name } };
    const days = Math.ceil((end - nowMs) / DAY_MS);
    if (days <= 0) return { key: 'verse.hub.hqEventToday', params: { name } };
    if (days === 1) return { key: 'verse.hub.hqEventOne', params: { name } };
    return { key: 'verse.hub.hqEvent', params: { name, n: days } };
  }
  if (activeNachschub === 1) return { key: 'verse.hub.hqSuppliesOne', params: {} };
  if (activeNachschub > 1) return { key: 'verse.hub.hqSupplies', params: { n: activeNachschub } };
  return { key: 'verse.hub.hqCalm', params: {} };
}

interface HqSources {
  readonly sheets: EventSheetService;
  readonly states: UserEventStateService;
  readonly ns: NachschubService;
}

/**
 * Feeds {@link hqLine} for the stage. Signed out it stays on the all-clear and
 * makes no call at all (events and Nachschübe are readable only signed in).
 * Signed in, the HQ services are imported lazily — the landing chunk does not
 * carry the HQ — and loaded once; a failed load simply keeps the all-clear.
 */
@Injectable({ providedIn: 'root' })
export class BriefingHqLineService {
  private readonly auth = inject(AuthService);
  private readonly injector = inject(Injector);
  private readonly src = signal<HqSources | null>(null);
  private readonly now = signal(Date.now());
  private loading = false;

  readonly line = computed<HqLine>(() => {
    const s = this.src();
    if (!s || !this.auth.user()) return hqLine([], 0, this.now());
    const open = openEvents(s.sheets.events(), s.states.states(), null, this.now());
    return hqLine(open, s.ns.active().length, this.now());
  });

  /** Starts the lazy load for the signed-in user; call from the stage once it rendered. */
  watch(destroyRef: DestroyRef): void {
    const ref = effect(
      () => {
        if (!this.auth.user()) return;
        this.now.set(Date.now());
        void this.load();
      },
      { injector: this.injector },
    );
    destroyRef.onDestroy(() => ref.destroy());
  }

  private async load(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      const [a, b, c] = await Promise.all([
        import('../../../hq/events/event-sheet.service'),
        import('../../../hq/events/user-event-state.service'),
        import('../../../hq/nachschub/nachschub.service'),
      ]);
      const s: HqSources = { sheets: this.injector.get(a.EventSheetService), states: this.injector.get(b.UserEventStateService), ns: this.injector.get(c.NachschubService) };
      await Promise.all([s.sheets.load(), s.states.load(), s.ns.ensureLoaded()]);
      this.src.set(s);
    } catch (err) {
      logWarn('verse', 'hq line load failed — showing the all-clear', { err: String(err) });
    } finally {
      this.loading = false;
    }
  }
}
