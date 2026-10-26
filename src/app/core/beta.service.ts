import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { AnalyticsService, BetaArea } from './analytics.service';
import { logWarn } from './log';

export type { BetaArea } from './analytics.service';

/** Every β switch, in menu order: the top-level nav items, then the app-wide `shell`. */
export const BETA_AREAS: readonly BetaArea[] = ['verse', 'codex', 'shell'];

/** The β switches that belong to a nav item (and so to a URL prefix); `shell` is app-wide. */
const NAV_BETA_AREAS: readonly BetaArea[] = ['verse', 'codex'];

/**
 * State without an explicit choice or flag. Verse's new view is still opt-in;
 * the Codex/HQ split was live for everyone before it got its switch, so it
 * stays on until the reader turns it off. `shell` (header/footer/page-type
 * redesign, layout contract) is opt-in and app-wide.
 */
const BETA_DEFAULTS: Readonly<Record<BetaArea, boolean>> = { verse: false, codex: true, shell: false };

/** localStorage key of the per-nav-item β opt-ins. */
export const BETA_STORAGE_KEY = 'sc.beta';
/** The former per-Verse-sub-area key; read once, folded into `verse`, removed. */
const LEGACY_VERSE_KEY = 'sc.verse.beta';

/** PostHog flag key for an area, e.g. `beta-codex`. */
export function betaFlagKey(area: BetaArea): string {
  return `beta-${area}`;
}

/**
 * The nav item a URL belongs to, if that item has a β switch. Every page under
 * it differs between on and off — at the very least the nav itself does
 * (Verse: the Starscape entry, Codex: the HQ entry) — so the switch is offered
 * on all of them and nowhere else.
 */
export function betaAreaOf(url: string): BetaArea | null {
  const path = url.split(/[?#]/, 1)[0];
  for (const area of NAV_BETA_AREAS) {
    if (path === `/${area}` || path.startsWith(`/${area}/`)) return area;
  }
  return null;
}

type Choices = Partial<Record<BetaArea, boolean>>;

/**
 * One β switch per top-level nav item: on = the new view of that item, off =
 * what it replaced. A switch only ever changes its own item.
 *
 * Resolution per area: a PostHog flag `beta-<area>` set to `false` is a kill
 * switch (forces off); otherwise the user's explicit choice wins; with no
 * choice a boolean flag decides; else the area's default. Flags are only ever
 * read after statistics consent (`AnalyticsService.flags`).
 *
 * The choice is persisted in localStorage like the composer's key mapping: a
 * deliberate UI choice, stored without the preferences gate. Storage failures
 * (private mode, quota) degrade to an in-memory choice.
 */
@Injectable({ providedIn: 'root' })
export class BetaService {
  private readonly analytics = inject(AnalyticsService);
  private readonly choices = signal<Choices>(readChoices());

  /** Effective on/off per area. */
  readonly state = computed<Record<BetaArea, boolean>>(() => {
    const chosen = this.choices();
    const flags = this.analytics.flags();
    const out = {} as Record<BetaArea, boolean>;
    for (const area of BETA_AREAS) {
      const flag = flags[betaFlagKey(area)];
      if (flag === false) out[area] = false;
      else if (chosen[area] !== undefined) out[area] = chosen[area] === true;
      else out[area] = typeof flag === 'boolean' ? flag : BETA_DEFAULTS[area];
    }
    return out;
  });

  /** True if the flag forces the area off (the switch should render disabled). */
  readonly locked = computed<Record<BetaArea, boolean>>(() => {
    const flags = this.analytics.flags();
    const out = {} as Record<BetaArea, boolean>;
    for (const area of BETA_AREAS) out[area] = flags[betaFlagKey(area)] === false;
    return out;
  });

  isEnabled(area: BetaArea): Signal<boolean> {
    return computed(() => this.state()[area]);
  }

  /** Records the user's choice, persists it and emits `beta_toggle`. */
  set(area: BetaArea, enabled: boolean): void {
    if (!BETA_AREAS.includes(area)) return;
    this.choices.update((c) => ({ ...c, [area]: enabled }));
    writeChoices(this.choices());
    this.analytics.captureVerse('beta_toggle', { area, enabled });
  }

  toggle(area: BetaArea): void {
    this.set(area, !this.state()[area]);
  }

  /** Forgets every explicit choice (back to flag/default). */
  reset(): void {
    this.choices.set({});
    try {
      localStorage.removeItem(BETA_STORAGE_KEY);
    } catch (err) {
      logWarn('beta', 'storage remove failed', err);
    }
  }
}

function readChoices(): Choices {
  try {
    const out: Choices = {};
    const raw = localStorage.getItem(BETA_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      for (const area of BETA_AREAS) {
        const v = (parsed as Record<string, unknown>)[area];
        if (typeof v === 'boolean') out[area] = v;
      }
    }
    const legacy = migrateLegacyVerse();
    if (out.verse === undefined && legacy !== undefined) {
      out.verse = legacy;
      writeChoices(out);
    }
    return out;
  } catch (err) {
    logWarn('beta', 'storage read failed', err);
    return {};
  }
}

/** Old per-sub-area Verse choices: any area opted in → the whole Verse is. */
function migrateLegacyVerse(): boolean | undefined {
  const raw = localStorage.getItem(LEGACY_VERSE_KEY);
  if (raw === null) return undefined;
  localStorage.removeItem(LEGACY_VERSE_KEY);
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') return undefined;
  const values = Object.values(parsed as Record<string, unknown>).filter((v): v is boolean => typeof v === 'boolean');
  return values.length ? values.some(Boolean) : undefined;
}

function writeChoices(c: Choices): void {
  try {
    localStorage.setItem(BETA_STORAGE_KEY, JSON.stringify(c));
  } catch (err) {
    logWarn('beta', 'storage write failed', err);
  }
}
