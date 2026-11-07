import { Injectable, signal } from '@angular/core';

/** localStorage key of the opt-in (`'1'` = non-usable items shown). */
const SHOW_NON_USABLE_KEY = 'sc.codex.showNonUsable';

/**
 * Codex reading preferences (package C, 2026-11-06).
 *
 * `showNonUsable`: game records a player cannot use — doors, seats, displays,
 * control panels, character-creator parts (see codex-area-taxonomy) — are
 * hidden from the area tree, the lists and the search by default. This opt-in
 * shows them as their own "Nicht nutzbar" area and lets the search reach them,
 * always ranked after every usable hit.
 *
 * Persisted unconditionally like the other functional preferences
 * (FeedbackFabPrefsService): it stores no personal data.
 */
@Injectable({ providedIn: 'root' })
export class CodexPrefsService {
  private readonly showNonUsableState = signal(readFlag(SHOW_NON_USABLE_KEY));

  /** `false` (default) → non-usable records stay out of tree, lists and search. */
  readonly showNonUsable = this.showNonUsableState.asReadonly();

  setShowNonUsable(value: boolean): void {
    this.showNonUsableState.set(value);
    try {
      if (value) localStorage.setItem(SHOW_NON_USABLE_KEY, '1');
      else localStorage.removeItem(SHOW_NON_USABLE_KEY);
    } catch {
      /* private mode / quota — the in-memory signal still applies this session */
    }
  }
}

function readFlag(key: string): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
