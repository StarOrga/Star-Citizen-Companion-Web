import { Injectable, computed, signal } from '@angular/core';

/**
 * Browser-storage consent (issue #130, extended for analytics in #139).
 *
 * The app sets no cookies — it uses localStorage in three categories:
 *  - `essential`: required for the app to function. Auth session (`sc.auth`),
 *    language (`sc.lang`), the composer's Enter-key mapping
 *    (`sc.composer.sendOnEnter`, see `ComposerPrefsService`), and the consent
 *    decision itself (`sc.consent`). Not configurable — without these, login,
 *    language selection and a deliberately chosen keyboard mapping break.
 *  - `preferences`: convenience state (news channel filter, saved articles,
 *    favorited upcoming ships and their seen-baseline, admin UI defaults).
 *    Opt-in: nothing in this category is written until the user allows it;
 *    declining purges what exists. Composer drafts used to live here and no
 *    longer do — unsent text is the user's own content, so it is stored on the
 *    account instead (`FeedbackDraftService`) and never gated.
 *  - `statistics`: anonymous product analytics (PostHog, EU region). Opt-in:
 *    no analytics library is loaded and no event is sent until the user
 *    allows it; declining purges PostHog's own localStorage state.
 *
 * The decision is stored in localStorage itself — persisting the consent
 * choice is universally treated as strictly necessary.
 */
export type ConsentCategory = 'essential' | 'preferences' | 'statistics';

interface ConsentState {
  preferences: boolean;
  statistics: boolean;
  decidedAt: string;
}

const CONSENT_KEY = 'sc.consent';

// Keys purged when preference storage is declined. Keep in sync with the
// literals at their write sites (news.service, telemetry-stats, admin-feedback).
//
// The two `*.draft` keys are legacy: composer drafts moved onto the account
// (`public.feedback_drafts`, migration 20260729120000) and are no longer written
// here at all. `FeedbackDraftService` imports and removes them on first load;
// they stay listed so a decline also clears the copy of anyone who has not
// opened the feedback panel since.
const PREFERENCE_KEYS = [
  'sc-companion.news.channels',
  'sc-companion.news.favorites',
  'sc-companion.news.watched',
  'sc-companion.upcoming.favorites',
  'sc-companion.upcoming.baseline',
  'sc-telemetry-product',
  'sc.adminFeedback.draft',
  'sc.adminFeedback.lastSeenDelivered',
  // Retired by the 2026-09-04 rethink and no longer written: the view
  // switch, the run's tick-off map and its two lenses. Listed so a decline
  // clears them for anyone who never opens the panel again;
  // `AdminFeedbackComponent` also drops them on load.
  'sc.adminFeedback.view',
  'sc.adminFeedback.handled',
  'sc.adminFeedback.workflowScope',
  'sc.adminFeedback.workflowKind',
  'sc.userFeedback.draft',
] as const;

// PostHog namespaces its localStorage entries `ph_<projectKey>_*`, so the exact
// key depends on the project key. Purge by prefix instead of an exact list.
const STATISTICS_KEY_PREFIX = 'ph_';

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

  /**
   * May anonymous analytics be collected? Opt-in and independent of
   * `preferences`: false until explicitly allowed, and false for anyone who
   * decided before this category existed (their stored state has no
   * `statistics` field — see `readState`).
   */
  readonly statisticsAllowed = computed(() => this.state()?.statistics ?? false);

  /** Banner: accept all categories. */
  acceptAll(): void {
    this.set({ preferences: true, statistics: true });
  }

  /** Banner: essential only. */
  essentialOnly(): void {
    this.set({ preferences: false, statistics: false });
  }

  /** Settings toggle. Declining purges already-stored preference keys. */
  setPreferences(allowed: boolean): void {
    this.set({ preferences: allowed });
  }

  /** Settings toggle. Declining purges PostHog's stored analytics state. */
  setStatistics(allowed: boolean): void {
    this.set({ statistics: allowed });
  }

  /**
   * Applies a partial decision on top of the current one. An undecided visitor
   * toggling a single category implicitly declines the categories they did not
   * touch — opt-in means absence of consent is a "no".
   */
  private set(patch: Partial<Omit<ConsentState, 'decidedAt'>>): void {
    const current = this.state();
    const next: ConsentState = {
      preferences: patch.preferences ?? current?.preferences ?? false,
      statistics: patch.statistics ?? current?.statistics ?? false,
      decidedAt: new Date().toISOString(),
    };
    this.state.set(next);
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify(next));
    } catch {
      /* private mode / quota — the in-memory signal still applies this session */
    }
    if (!next.preferences) purgePreferenceKeys();
    if (!next.statistics) purgeStatisticsKeys();
  }
}

function readState(): ConsentState | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ConsentState>;
    if (typeof parsed?.preferences !== 'boolean') return null;
    return {
      preferences: parsed.preferences,
      // Absent for anyone who decided before the statistics category existed.
      // Re-asking would be more correct than assuming, but assuming "no" is the
      // safe direction: they simply stay opted out until they opt in.
      statistics: typeof parsed.statistics === 'boolean' ? parsed.statistics : false,
      decidedAt: parsed.decidedAt ?? '',
    };
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

function purgeStatisticsKeys(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const stale = Object.keys(localStorage).filter((k) => k.startsWith(STATISTICS_KEY_PREFIX));
    for (const key of stale) localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
