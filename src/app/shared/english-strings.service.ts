import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateService, TranslateStore, getValue } from '@ngx-translate/core';

/** The one language Star Citizen always ships its own strings in. */
const EN = 'en';

/**
 * Reads app i18n strings in ENGLISH, no matter which language the UI runs in.
 *
 * `TranslateService` always resolves against the *current* language, which is
 * what the app wants everywhere except where a value has to be readable in the
 * game's own language: Star Citizen's client is English for most players, so a
 * German UI still needs a way to render the ORIGINAL English wording next to
 * the translated one (Codex → Input Actions language switch, feedback
 * d8f096a7).
 *
 * English is the app's `fallbackLang`, so its table is normally already in the
 * translate store by the time anything asks. The copy is mirrored into a signal
 * so callers stay synchronous *and* reactive: a lookup can be made straight
 * from a template and still re-runs once the table arrives.
 */
@Injectable({ providedIn: 'root' })
export class EnglishStringsService {
  private readonly t = inject(TranslateService);
  private readonly store = inject(TranslateStore);

  /** The English table, or null while it has not been loaded (yet). */
  private readonly table = signal<unknown>(null);
  private requested = false;

  constructor() {
    this.pull();
    // The store fills asynchronously at bootstrap and again whenever a table is
    // (re)loaded — re-reading on those events keeps the mirror honest without
    // polling, and flips `table` from null to a real object exactly once.
    this.t.onTranslationChange.pipe(takeUntilDestroyed()).subscribe(() => this.pull());
    this.t.onLangChange.pipe(takeUntilDestroyed()).subscribe(() => this.pull());
  }

  /** True once English strings can actually be served. */
  get loaded(): boolean {
    return this.table() !== null;
  }

  /**
   * The English text for `key`, or `null` when English is not loaded or has no
   * entry for it. The caller decides the fallback: silently handing back the
   * current language would be indistinguishable from a successful lookup, and
   * the callers here need to know (a chip that quietly stayed German is the bug
   * this service exists to prevent).
   */
  text(key: string): string | null {
    const table = this.table();
    if (!table) return null;
    const value = getValue(table, key);
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  /**
   * Pull the English table in when the store does not have it. Idempotent and
   * fire-and-forget — English is the fallback language, so this is a safety net
   * for a cold store rather than the normal path, and a failure just leaves
   * `text()` returning null.
   */
  ensureLoaded(): void {
    if (this.requested || this.store.hasTranslationFor(EN)) return;
    this.requested = true;
    this.t.reloadLang(EN).subscribe({ next: () => this.pull(), error: () => undefined });
  }

  private pull(): void {
    if (!this.store.hasTranslationFor(EN)) return;
    this.table.set(this.store.getTranslations(EN));
  }
}
