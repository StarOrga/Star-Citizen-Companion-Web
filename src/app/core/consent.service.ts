import { Injectable, computed, signal } from '@angular/core';

/**
 * Browser-storage consent (issue #130).
 *
 * The app sets no cookies — it uses localStorage in two categories:
 *  - `essential`: required for the app to function. Auth session (`sc.auth`),
 *    language (`sc.lang`), and the consent decision itself (`sc.consent`).
 *    Not configurable — without these, login and language selection break.
 *  - `preferences`: convenience state (news channel filter, saved articles,
 *    admin UI drafts/defaults). Opt-in: nothing in this category is written
 *    until the user allows it; declining purges what exists.
 *
 * The decision is stored in localStorage itself — persisting the consent
 * choice is universally treated as strictly necessary.
 */
export type ConsentCategory = 'essential' | 'preferences';

interface ConsentState {
  preferences: boolean;
  decidedAt: string;
}

const CONSENT_KEY = 'sc.consent';

// Keys purged when preference storage is declined. Keep in sync with the
// literals at their write sites (news.service, telemetry-stats, admin-feedback).
const PREFERENCE_KEYS = [
  'sc-companion.news.channels',
  'sc-companion.news.favorites',
  'sc-telemetry-product',
  'sc.adminFeedback.draft',
] as const;

@Injectable({ providedIn: 'root' })
export class ConsentService {
  private readonly state = signal<ConsentState | null>(readState());

  /** True once the user made an explicit choice (banner answered / settings). */
  readonly decided = computed(() => this.state() !== null);

  /**
   * May preference-category state be written? Opt-in: false until the user
   * explicitly allows it (an undecided first visit does not persist filters
   * or favorites — the session still works, the state is just not saved).
   */
  readonly preferencesAllowed = computed(() => this.state()?.preferences ?? false);

  /** Banner: accept both categories. */
  acceptAll(): void {
    this.setPreferences(true);
  }

  /** Banner: essential only. */
  essentialOnly(): void {
    this.setPreferences(false);
  }

  /** Settings toggle. Declining purges already-stored preference keys. */
  setPreferences(allowed: boolean): void {
    const next: ConsentState = { preferences: allowed, decidedAt: new Date().toISOString() };
    this.state.set(next);
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify(next));
    } catch {
      /* private mode / quota — the in-memory signal still applies this session */
    }
    if (!allowed) purgePreferenceKeys();
  }
}

function readState(): ConsentState | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConsentState>;
    if (typeof parsed?.preferences !== 'boolean') return null;
    return { preferences: parsed.preferences, decidedAt: parsed.decidedAt ?? '' };
  } catch {
    return null;
  }
}

function purgePreferenceKeys(): void {
  if (typeof localStorage === 'undefined') return;
  for (const key of PREFERENCE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}
