import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { formatScDate, relativeDayBucket, type ScDateInput } from './date-format';
import { LocaleService } from './locale.service';

/**
 * Renders a date as its coarse age instead of its calendar fields (feedback
 * 9a65a040) — what a scanning reader actually wants off a topic card:
 *
 * ```html
 * {{ row.created_at | scDateRelative }}          <!-- heute / gestern / letzte Woche -->
 * {{ row.created_at | scDateRelative: 'since' }} <!-- seit heute / seit letzter Woche -->
 * ```
 *
 * The `since` form exists because German does not let one label serve both
 * slots: *letzte Woche* standing alone, but *seit letzter Woche* behind the
 * preposition. Two key sets, one pipe.
 *
 * A date the buckets cannot describe — the future, or an unparseable value —
 * falls back to the absolute date rather than inventing a label.
 *
 * **Impure for the same reason as `ScDatePipe`** (locale signals live outside
 * the arguments), with one extra: the bucket depends on the wall clock, so a
 * card left open across midnight has to be free to re-render as *gestern*.
 */
@Pipe({ name: 'scDateRelative', standalone: true, pure: false })
export class ScDateRelativePipe implements PipeTransform {
  private readonly locale = inject(LocaleService);
  private readonly translate = inject(TranslateService);

  private lastKey = '';
  private lastResult = '';
  private primed = false;

  transform(value: ScDateInput, form: 'plain' | 'since' = 'plain'): string {
    const language = this.locale.language();
    const region = this.locale.region();
    const bucket = relativeDayBucket(value);
    const stamp = value instanceof Date ? value.getTime() : String(value ?? '');
    const key = `${language}|${region}|${this.translate.getCurrentLang()}|${form}|${bucket}|${bucket ? '' : stamp}`;
    if (this.primed && key === this.lastKey) return this.lastResult;
    this.lastKey = key;
    this.lastResult = bucket
      ? this.translate.instant(`date.${form === 'since' ? 'relativeSince' : 'relative'}.${bucket}`)
      : formatScDate(value, { language, region });
    this.primed = true;
    return this.lastResult;
  }
}
