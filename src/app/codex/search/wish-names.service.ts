import { Injectable, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { logWarn } from '../../core/log';
import { CodexService, pickLocalized } from '../codex.service';
import type { Lang } from '../codex.types';

/**
 * Display names for entries that only carry a class name: a wish stored before `search_wishlist.name`
 * existed, a wished ship (the hangar row has no name), a Nachschub line. One batched catalog lookup
 * per new class set, answered into a signal so every row re-renders when the names arrive. Rows keep
 * the readable class name until then; a class the catalog does not know keeps it for good.
 */
@Injectable({ providedIn: 'root' })
export class WishNamesService {
  private readonly codex = inject(CodexService);
  private readonly translate = inject(TranslateService);

  private readonly names = signal<ReadonlyMap<string, string>>(new Map());
  private readonly asked = new Set<string>();

  /** The resolved name of a class (UI language), or null while unknown. Reads a signal. */
  nameOf = (_kind: string, className: string): string | null => this.names().get(className.toLowerCase()) ?? null;

  /** Ask for the names of classes not asked for yet. Safe to call repeatedly. */
  request(classNames: readonly string[]): void {
    const fresh = [...new Set(classNames.map((c) => c.trim()).filter(Boolean))].filter((c) => !this.asked.has(c.toLowerCase()));
    if (!fresh.length) return;
    fresh.forEach((c) => this.asked.add(c.toLowerCase()));
    const lang = ((this.translate.getCurrentLang() ?? 'en') === 'de' ? 'de' : 'en') as Lang;
    void this.codex
      .resolveEntities(fresh)
      .then((found) => {
        if (!found.size) return;
        const next = new Map(this.names());
        for (const [cls, e] of found) {
          const name = (e.name ? pickLocalized(e.name, lang) : '') || e.nameLocalized;
          if (name) next.set(cls.toLowerCase(), name);
        }
        this.names.set(next);
      })
      .catch((err) => {
        // A failed lookup is asked again next time, the class name stays meanwhile.
        fresh.forEach((c) => this.asked.delete(c.toLowerCase()));
        logWarn('wishlist', 'names unavailable', err);
      });
  }
}
