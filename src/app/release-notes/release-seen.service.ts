import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { AccountPrefsService } from '../core/account-prefs.service';
import { AuthService } from '../auth/auth.service';
import { ReleaseNotesService } from './release-notes.service';

const PREF_KEY = 'releaseNotesSeen';

function readLocal(): string | null {
  try {
    return localStorage.getItem(PREF_KEY);
  } catch {
    return null;
  }
}

/**
 * "Is there a release this reader has not looked at yet?" — drives the blue dot
 * on the footer's About link and is cleared by the About page's feature card.
 *
 * The seen version lives in the account (`ui_prefs.releaseNotesSeen`) so it
 * follows the user across browsers, and in localStorage while signed out.
 * A reader with no stored value starts with the CURRENT version counted as
 * seen (written once), so a new account gets no dot for history. Unseen =
 * newest release in release-notes.json differs from the stored version.
 */
@Injectable({ providedIn: 'root' })
export class ReleaseSeenService {
  private readonly notes = inject(ReleaseNotesService);
  private readonly prefs = inject(AccountPrefsService);
  private readonly auth = inject(AuthService);

  private readonly local = signal<string | null>(readLocal());
  /** The reader looked at the newest release in this session. */
  private readonly seenNow = signal(false);

  /** Newest release version, null until release-notes.json has loaded. */
  readonly latest = computed(() => {
    const n = this.notes.notes();
    return n?.current ?? n?.releases[0]?.version ?? null;
  });

  /** Stored seen version: string, null = none stored, undefined = not known yet. */
  private readonly stored = computed<string | null | undefined>(() => {
    if (this.auth.user()) {
      const p = this.prefs.prefs();
      if (p === null) return undefined;
      const v = p[PREF_KEY];
      return typeof v === 'string' ? v : null;
    }
    return this.local();
  });

  readonly unseen = computed(() => {
    const latest = this.latest();
    const stored = this.stored();
    return !!latest && typeof stored === 'string' && stored !== latest && !this.seenNow();
  });

  constructor() {
    void this.notes.load();
    effect(() => {
      const latest = this.latest();
      const stored = this.stored();
      if (!latest || stored === undefined) return;
      // First contact: history counts as seen. Afterwards: write on "seen".
      if (stored === null || (this.seenNow() && stored !== latest)) this.persist(latest);
    });
  }

  /** The reader looked at the newest release. */
  markSeen(): void {
    this.seenNow.set(true);
  }

  private persist(version: string): void {
    if (this.auth.user()) {
      this.prefs.set(PREF_KEY, version);
      return;
    }
    try {
      localStorage.setItem(PREF_KEY, version);
    } catch {
      /* private mode: the dot returns next visit, nothing breaks */
    }
    this.local.set(version);
  }
}
