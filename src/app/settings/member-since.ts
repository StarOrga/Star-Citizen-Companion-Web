/**
 * Coarse "member since" bucket (admin feedback af058ca4).
 *
 * The account card used to print the raw registration date; the ask is a
 * single, glanceable unit — days OR months OR years, never a
 * "1 year 2 months 3 days" breakdown. The exact timestamp stays available as
 * a tooltip, so nothing is lost by rounding here.
 */
export type MemberSinceUnit = 'today' | 'days' | 'months' | 'years';

export interface MemberSince {
  readonly unit: MemberSinceUnit;
  /** Whole units elapsed. Always 0 for `today`. */
  readonly count: number;
}

const DAY_MS = 86_400_000;

/**
 * Largest sensible whole unit between `from` and `now`.
 *
 * Months and years are counted on the calendar (not on a 30-day average), so
 * an account created on 15 March is "1 month" old on 15 April, not on the
 * 30th. A future or unparsable date degrades to `today` rather than rendering
 * a negative duration.
 */
export function memberSince(from: Date, now: Date = new Date()): MemberSince {
  const elapsed = now.getTime() - from.getTime();
  if (!Number.isFinite(elapsed) || elapsed < DAY_MS) return { unit: 'today', count: 0 };

  const months = calendarMonthsBetween(from, now);
  if (months >= 12) return { unit: 'years', count: Math.floor(months / 12) };
  if (months >= 1) return { unit: 'months', count: months };
  return { unit: 'days', count: Math.floor(elapsed / DAY_MS) };
}

/** Whole calendar months between two dates, floored at 0. */
function calendarMonthsBetween(from: Date, now: Date): number {
  let months =
    (now.getFullYear() - from.getFullYear()) * 12 + (now.getMonth() - from.getMonth());
  // The anniversary day has not been reached yet this month.
  if (now.getDate() < from.getDate()) months -= 1;
  return Math.max(0, months);
}
