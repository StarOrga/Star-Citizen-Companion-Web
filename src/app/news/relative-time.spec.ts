import { relativeTime } from './relative-time';

/** A fake `t` that prints the key and its count so the bucket is visible. */
const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${params['n']}` : key);

const NOW = Date.parse('2026-09-28T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
  it('says "now" under a minute, including a timestamp slightly in the future', () => {
    expect(relativeTime(ago(30_000), NOW, t)).toBe('news.relative.now');
    expect(relativeTime(ago(-5_000), NOW, t)).toBe('news.relative.now');
  });

  it('counts minutes up to 59', () => {
    expect(relativeTime(ago(MIN), NOW, t)).toBe('news.relative.minutes:1');
    expect(relativeTime(ago(59 * MIN + 59_000), NOW, t)).toBe('news.relative.minutes:59');
  });

  it('counts hours up to 23', () => {
    expect(relativeTime(ago(HOUR), NOW, t)).toBe('news.relative.hours:1');
    expect(relativeTime(ago(23 * HOUR + 30 * MIN), NOW, t)).toBe('news.relative.hours:23');
  });

  it('uses its own key for yesterday, then counts days up to 6', () => {
    expect(relativeTime(ago(DAY), NOW, t)).toBe('news.relative.yesterday');
    expect(relativeTime(ago(2 * DAY), NOW, t)).toBe('news.relative.days:2');
    expect(relativeTime(ago(6 * DAY + HOUR), NOW, t)).toBe('news.relative.days:6');
  });

  it('switches to weeks, with a singular key for one week', () => {
    expect(relativeTime(ago(7 * DAY), NOW, t)).toBe('news.relative.week:1');
    expect(relativeTime(ago(14 * DAY), NOW, t)).toBe('news.relative.weeks:2');
  });

  it('returns an empty string for an unparseable date', () => {
    expect(relativeTime('not a date', NOW, t)).toBe('');
    expect(relativeTime('', NOW, t)).toBe('');
  });
});
