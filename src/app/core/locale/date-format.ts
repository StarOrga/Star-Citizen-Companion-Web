import type { DateOrder, RegionCode } from './locale.types';
import { dateOrderForRegion, usesTwelveHourClock } from './region.data';

/**
 * The app's single date renderer (feedback 38b3d25a).
 *
 * The admin's spec: **always spell the month out**, in the order the user's
 * region reads dates, separated by ` / `:
 *
 * | region order | example (de) | example (en) |
 * |--------------|--------------|--------------|
 * | `dmy`        | `31 / Juli / 2026`   | `31 / July / 2026`   |
 * | `mdy`        | `Juli / 31 / 2026`   | `July / 31 / 2026`   |
 * | `ymd`        | `2026 / Juli / 31`   | `2026 / July / 31`   |
 *
 * The month NAME comes from the language (`Juli` vs `July`), the ORDER comes
 * from the region — the two axes stay independent, which is the whole point of
 * resolving them separately.
 *
 * Timestamps append the clock behind a `·`: `31 / Juli / 2026 · 14:05`. The
 * 12- vs 24-hour choice is regional and pinned by `usesTwelveHourClock()`
 * rather than left to ICU, so a `de-US` pairing renders predictably.
 */

export type ScDateStyle =
  /** Calendar date only — the default. */
  | 'date'
  /** Calendar date + clock. */
  | 'datetime'
  /** Clock only (no calendar fields). */
  | 'time';

/** Anything a call site realistically holds: ISO string, epoch ms, or Date. */
export type ScDateInput = string | number | Date | null | undefined;

export interface ScDateFormatOptions {
  /** UI language — drives the month name. */
  readonly language: string;
  /** ISO 3166-1 alpha-2 region — drives field order and the clock. */
  readonly region: RegionCode;
  readonly style?: ScDateStyle;
}

/** Field separator. Punctuation, not copy — identical in every language. */
const FIELD_SEPARATOR = ' / ';
/** Separates the calendar date from the clock. */
const DATE_TIME_SEPARATOR = ' · ';

/** Parses whatever a call site holds into a valid `Date`, or `null`. */
export function toDateOrNull(value: ScDateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// `Intl.DateTimeFormat` construction is the expensive part; the same handful of
// locale/style combinations is used thousands of times per page.
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;
  let made: Intl.DateTimeFormat;
  try {
    made = new Intl.DateTimeFormat(locale, options);
  } catch {
    // Malformed tag (e.g. a region code the runtime rejects) — English is a
    // readable fallback and never throws.
    made = new Intl.DateTimeFormat('en', options);
  }
  formatterCache.set(key, made);
  return made;
}

function part(parts: readonly Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((p) => p.type === type)?.value ?? '';
}

/** `31 / Juli / 2026` — calendar fields in the region's order, month spelled out. */
export function formatScCalendarDate(date: Date, language: string, region: RegionCode): string {
  const locale = intlLocaleOf(language, region);
  const parts = formatter(locale, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).formatToParts(date);
  const day = part(parts, 'day');
  const month = part(parts, 'month');
  const year = part(parts, 'year');
  return orderedFields(dateOrderForRegion(region), day, month, year).join(FIELD_SEPARATOR);
}

/**
 * `31.07.` / `07/31` — the numeric short form, for places where a spelled-out
 * month physically cannot fit: chart axis ticks and other few-pixel labels.
 *
 * The spelled-out month is the admin's stated preference and `formatScCalendarDate`
 * is the default everywhere; this is the documented exception, not an
 * alternative. ICU already orders the two fields per region, so the tag from
 * `intlLocaleOf()` is enough — no manual reordering needed.
 */
export function formatScCompactDate(date: Date, language: string, region: RegionCode): string {
  return formatter(intlLocaleOf(language, region), {
    day: '2-digit',
    month: '2-digit',
  }).format(date);
}

/** The month name alone (`Juli` / `July`), in the UI language. */
export function formatScMonthName(date: Date, language: string, region: RegionCode): string {
  return formatter(intlLocaleOf(language, region), { month: 'long' }).format(date);
}

/** `14:05` (24h regions) or `2:05 PM` (12h regions). */
export function formatScTime(date: Date, language: string, region: RegionCode): string {
  return formatter(intlLocaleOf(language, region), {
    hour: '2-digit',
    minute: '2-digit',
    hour12: usesTwelveHourClock(region),
  }).format(date);
}

/** The BCP-47 tag handed to `Intl` for a language/region pair. */
export function intlLocaleOf(language: string, region: RegionCode): string {
  const lang = (language || 'en').split(/[-_]/)[0].toLowerCase();
  const reg = (region || '').toUpperCase();
  return /^[A-Z]{2}$/.test(reg) ? `${lang}-${reg}` : lang;
}

function orderedFields(order: DateOrder, day: string, month: string, year: string): string[] {
  switch (order) {
    case 'mdy':
      return [month, day, year];
    case 'ymd':
      return [year, month, day];
    default:
      return [day, month, year];
  }
}

/**
 * The app-wide date formatter. Returns `''` for missing or unparseable input,
 * so templates can drop the value in unguarded exactly like Angular's
 * `DatePipe` did.
 */
export function formatScDate(value: ScDateInput, options: ScDateFormatOptions): string {
  const date = toDateOrNull(value);
  if (!date) return '';
  const { language, region, style = 'date' } = options;
  if (style === 'time') return formatScTime(date, language, region);
  const calendar = formatScCalendarDate(date, language, region);
  if (style === 'date') return calendar;
  return `${calendar}${DATE_TIME_SEPARATOR}${formatScTime(date, language, region)}`;
}
