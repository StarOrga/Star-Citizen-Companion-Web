/**
 * "vor 3 Std." / "3 hrs ago" for the Verse News surfaces.
 *
 * Pulled out of the news list so the patch-notes section can date its entries
 * the same way without importing a component. Deliberately takes the translate
 * call as a parameter: this stays a pure function, testable without a TestBed,
 * and callers keep using the `news.relative.*` keys they already ship.
 */
export type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

export function relativeTime(iso: string, nowMs: number, t: TranslateFn): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const diffMs = nowMs - at;
  if (diffMs < 60000) return t('news.relative.now');
  const min = Math.floor(diffMs / 60000);
  if (min < 60) return t('news.relative.minutes', { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t('news.relative.hours', { n: h });
  const d = Math.floor(h / 24);
  if (d === 1) return t('news.relative.yesterday');
  if (d < 7) return t('news.relative.days', { n: d });
  const w = Math.floor(d / 7);
  // Own key for the singular — "vor 1 Wochen" is not a sentence (#332).
  return t(w === 1 ? 'news.relative.week' : 'news.relative.weeks', { n: w });
}
