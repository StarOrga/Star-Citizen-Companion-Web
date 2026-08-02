import { Pipe, PipeTransform, inject } from '@angular/core';
import { formatScDate, type ScDateInput, type ScDateStyle } from './date-format';
import { LocaleService } from './locale.service';

/**
 * Renders any calendar date in the app's format (feedback 38b3d25a) — the
 * replacement for Angular's `DatePipe` at every call site:
 *
 * ```html
 * {{ row.created_at | scDate }}            <!-- 31 / Juli / 2026 -->
 * {{ row.created_at | scDate: 'datetime' }}<!-- 31 / Juli / 2026 · 14:05 -->
 * {{ row.created_at | scDate: 'time' }}    <!-- 14:05 -->
 * ```
 *
 * **Impure by design.** The output depends on two signals (`language`,
 * `region`) that are NOT part of the pipe's arguments; a pure pipe would keep
 * serving its cached string after the user switches locale in the settings,
 * because Angular skips `transform()` entirely when the input reference is
 * unchanged. Impure means it is asked on every change-detection pass — so the
 * work is memoized below and reduces to three comparisons and a cache hit.
 */
@Pipe({ name: 'scDate', standalone: true, pure: false })
export class ScDatePipe implements PipeTransform {
  private readonly locale = inject(LocaleService);

  private lastValue: ScDateInput;
  private lastStyle: ScDateStyle | undefined;
  private lastLanguage = '';
  private lastRegion = '';
  private lastResult = '';
  private primed = false;

  transform(value: ScDateInput, style: ScDateStyle = 'date'): string {
    const language = this.locale.language();
    const region = this.locale.region();
    if (
      this.primed &&
      language === this.lastLanguage &&
      region === this.lastRegion &&
      style === this.lastStyle &&
      sameInstant(value, this.lastValue)
    ) {
      return this.lastResult;
    }
    this.lastValue = value;
    this.lastStyle = style;
    this.lastLanguage = language;
    this.lastRegion = region;
    this.lastResult = formatScDate(value, { language, region, style });
    this.primed = true;
    return this.lastResult;
  }
}

/** Cheap equality that also treats two equal `Date` objects as the same input. */
function sameInstant(a: ScDateInput, b: ScDateInput): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return false;
}
