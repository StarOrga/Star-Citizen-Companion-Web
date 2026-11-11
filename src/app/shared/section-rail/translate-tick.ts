import { toSignal } from '@angular/core/rxjs-interop';
import type { TranslateService } from '@ngx-translate/core';
import { merge, startWith } from 'rxjs';

/**
 * A signal that changes when the language or its strings do. A page that builds the rail's names with
 * `translate.instant` inside a `computed` reads it, so the names follow a language switch and late-loading strings.
 * Call it in an injection context (a field initialiser).
 */
export function translateTick(translate: TranslateService) {
  return toSignal(merge(translate.onLangChange, translate.onTranslationChange).pipe(startWith(null)));
}
