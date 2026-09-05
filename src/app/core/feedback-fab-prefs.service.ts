import { Injectable, signal } from '@angular/core';

/** localStorage key holding the opt-out (`'1'` = launcher hidden). */
const FAB_HIDDEN_KEY = 'sc.feedback.fabHidden';

/**
 * Per-user visibility preference for the floating feedback launcher.
 *
 * The launcher sits in the bottom-right corner of every page, which is also
 * where a lot of content ends up — so it is a button some people want out of
 * the way. It is an OPT-OUT, never a default: the stored flag says "hidden",
 * so a fresh browser, a cleared profile or an unreadable `localStorage` all
 * fall back to showing it. Failing open matters here more than anywhere else —
 * the launcher is the one control through which a user can report that the app
 * is broken, and it must not be able to disappear by accident.
 *
 * Both launchers read this: the admin board's FAB and the slim user panel's,
 * so "hide the feedback button" means the same thing whichever one you get.
 *
 * Like `ComposerPrefsService`, the choice is persisted **unconditionally** —
 * it stores no personal data and is an essential-category functional
 * preference (see `ConsentService`). A setting the user explicitly changed that
 * silently forgets itself on the next reload is simply broken.
 */
@Injectable({ providedIn: 'root' })
export class FeedbackFabPrefsService {
  private readonly showState = signal(readShowFab());

  /** `true` (default) → the feedback launcher renders on every page. */
  readonly show = this.showState.asReadonly();

  setShow(value: boolean): void {
    this.showState.set(value);
    try {
      // Only the opt-out is written; "show" removes the key so the default
      // wins again for anything reading the raw storage.
      if (value) localStorage.removeItem(FAB_HIDDEN_KEY);
      else localStorage.setItem(FAB_HIDDEN_KEY, '1');
    } catch {
      /* private mode / quota — the in-memory signal still applies this session */
    }
  }
}

function readShowFab(): boolean {
  if (typeof localStorage === 'undefined') return true;
  try {
    return localStorage.getItem(FAB_HIDDEN_KEY) !== '1';
  } catch {
    return true;
  }
}
