import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { AnalyticsService } from '../../core/analytics.service';
import { logWarn } from '../../core/log';
import { VERSE_BETA_AREAS, VerseBetaArea } from './verse.models';

/** localStorage key of the per-menu-item β opt-ins. */
export const VERSE_BETA_STORAGE_KEY = 'sc.verse.beta';

/** PostHog flag key for an area, e.g. `verse-beta-news`. */
export function verseBetaFlagKey(area: VerseBetaArea): string {
  return `verse-beta-${area}`;
}

type Choices = Partial<Record<VerseBetaArea, boolean>>;

/**
 * Per-menu-item opt-in to the new Verse UI (big-bang release behind the β
 * switch). One UI switch per area, one backend.
 *
 * Resolution per area: a PostHog flag `verse-beta-<area>` set to `false` is a
 * kill switch (forces off); otherwise the user's explicit choice wins; with no
 * choice a flag `true` turns it on; default off. Flags are only ever read after
 * statistics consent (`AnalyticsService.flags`).
 *
 * The choice is persisted in localStorage like the composer's key mapping: a
 * deliberate UI choice, stored without the preferences gate. Storage failures
 * (private mode, quota) degrade to an in-memory choice.
 */
@Injectable({ providedIn: 'root' })
export class VerseBetaService {
  private readonly analytics = inject(AnalyticsService);
  private readonly choices = signal<Choices>(readChoices());

  /** Effective on/off per area. */
  readonly state = computed<Record<VerseBetaArea, boolean>>(() => {
    const chosen = this.choices();
    const flags = this.analytics.flags();
    const out = {} as Record<VerseBetaArea, boolean>;
    for (const area of VERSE_BETA_AREAS) {
      const flag = flags[verseBetaFlagKey(area)];
      if (flag === false) out[area] = false;
      else if (chosen[area] !== undefined) out[area] = chosen[area] === true;
      else out[area] = flag === true;
    }
    return out;
  });

  /** True if the flag forces the area off (the switch should render disabled). */
  readonly locked = computed<Record<VerseBetaArea, boolean>>(() => {
    const flags = this.analytics.flags();
    const out = {} as Record<VerseBetaArea, boolean>;
    for (const area of VERSE_BETA_AREAS) out[area] = flags[verseBetaFlagKey(area)] === false;
    return out;
  });

  /** True if any area is opted in. */
  readonly anyEnabled = computed(() => VERSE_BETA_AREAS.some((a) => this.state()[a]));

  isEnabled(area: VerseBetaArea): Signal<boolean> {
    return computed(() => this.state()[area]);
  }

  /** Records the user's choice, persists it and emits `verse_beta_toggle`. */
  set(area: VerseBetaArea, enabled: boolean): void {
    if (!VERSE_BETA_AREAS.includes(area)) return;
    this.choices.update((c) => ({ ...c, [area]: enabled }));
    writeChoices(this.choices());
    this.analytics.captureVerse('verse_beta_toggle', { area, enabled });
  }

  toggle(area: VerseBetaArea): void {
    this.set(area, !this.state()[area]);
  }

  /** Forgets every explicit choice (back to flag/default). */
  reset(): void {
    this.choices.set({});
    try {
      localStorage.removeItem(VERSE_BETA_STORAGE_KEY);
    } catch (err) {
      logWarn('verse-beta', 'storage remove failed', err);
    }
  }
}

function readChoices(): Choices {
  try {
    const raw = localStorage.getItem(VERSE_BETA_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Choices = {};
    for (const area of VERSE_BETA_AREAS) {
      const v = (parsed as Record<string, unknown>)[area];
      if (typeof v === 'boolean') out[area] = v;
    }
    return out;
  } catch (err) {
    logWarn('verse-beta', 'storage read failed', err);
    return {};
  }
}

function writeChoices(c: Choices): void {
  try {
    localStorage.setItem(VERSE_BETA_STORAGE_KEY, JSON.stringify(c));
  } catch (err) {
    logWarn('verse-beta', 'storage write failed', err);
  }
}
