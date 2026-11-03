import { HttpClient } from '@angular/common/http';
import { Injectable, NgZone, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { TranslateLoader, TranslationObject } from '@ngx-translate/core';
import { Observable, Subject, filter, first, from, of, race, shareReplay, switchMap } from 'rxjs';
import { LocaleService } from './locale.service';

const EN = 'en';

/** What `public/i18n-boot.js` left on the window: the table it already requested. */
export interface I18nBoot {
  lang: string;
  table: Promise<TranslationObject | null>;
}

declare global {
  interface Window {
    __scI18nBoot?: I18nBoot;
  }
}

/** How long the unused fallback table waits after boot, in ms. */
export const FALLBACK_DELAY_MS = 4000;

/**
 * Loads the i18n tables without making the first paint pay for them.
 *
 * Both tables are about 80 KB on the wire, and the plain HTTP loader requested
 * both only after the whole bundle had run. Two changes:
 *
 *  - The active language reuses the request `public/i18n-boot.js` started next
 *    to the bundle.
 *  - English, while it is only the fallback, waits until the page is up. `de`
 *    and `en` carry the same keys, so a German page does not read it during
 *    startup, and ngx-translate waits per language, so nothing blocks on it.
 *    It loads at once when English becomes the active language (a profile
 *    setting can do that) or someone asks a second time
 *    (`EnglishStringsService.ensureLoaded`).
 */
@Injectable()
export class AppTranslateLoader extends TranslateLoader {
  private readonly http = inject(HttpClient);
  private readonly zone = inject(NgZone);
  private readonly language$ = toObservable(inject(LocaleService).language);
  private readonly fallbackWanted = new Subject<void>();
  private fallback$?: Observable<TranslationObject>;
  private boot = window.__scI18nBoot;

  override getTranslation(lang: string): Observable<TranslationObject> {
    const boot = this.boot;
    if (boot?.lang === lang) {
      this.boot = undefined;
      return from(boot.table).pipe(switchMap((table) => (table ? of(table) : this.fetchTable(lang))));
    }
    if (lang !== EN) return this.fetchTable(lang);
    if (this.fallback$) {
      this.fallbackWanted.next();
      return this.fallback$;
    }
    this.fallback$ = this.whenFallbackIsDue().pipe(
      switchMap(() => this.fetchTable(lang)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.fallback$;
  }

  private fetchTable(lang: string): Observable<TranslationObject> {
    return this.http.get<TranslationObject>(`i18n/${lang}.json`);
  }

  private whenFallbackIsDue(): Observable<unknown> {
    // The timer stays outside the zone so it cannot hold back `registerWhenStable`.
    const delay = new Observable<void>((subscriber) => {
      const handle = this.zone.runOutsideAngular(() =>
        setTimeout(() => this.zone.run(() => subscriber.next()), FALLBACK_DELAY_MS),
      );
      return () => clearTimeout(handle);
    });
    return race(delay, this.fallbackWanted, this.language$.pipe(filter((lang) => lang === EN))).pipe(first());
  }
}
