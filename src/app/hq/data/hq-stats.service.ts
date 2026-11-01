import { Injectable, inject, signal } from '@angular/core';
import { toErrorKey } from '../../core/describe-error';
import { SupabaseClientProvider } from '../../core/supabase.client';
import type { HqStats, HqStatsPoint, HqStatsRange } from './hq-db.types';

export const HQ_STATS_RANGES: readonly HqStatsRange[] = ['7d', '30d', '90d'];

const DAY_MS = 86_400_000;
const rangeDays: Record<HqStatsRange, number> = { '7d': 7, '30d': 30, '90d': 90 };

/** `YYYY-MM-DD` of a UTC instant. */
const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * The bucket keys of a range, oldest first, ending at `now`'s bucket. Day buckets are the
 * calendar days; week buckets are Mondays (Postgres `date_trunc('week')`), UTC.
 */
export function bucketKeys(range: HqStatsRange, bucket: 'day' | 'week', now: number = Date.now()): string[] {
  const days = rangeDays[range];
  const keys: string[] = [];
  if (bucket === 'day') {
    for (let i = days - 1; i >= 0; i--) keys.push(dayKey(now - i * DAY_MS));
    return keys;
  }
  const d = new Date(now);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  const thisMonday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - sinceMonday * DAY_MS;
  const weeks = Math.ceil(days / 7);
  for (let i = weeks - 1; i >= 0; i--) keys.push(dayKey(thisMonday - i * 7 * DAY_MS));
  return keys;
}

/** Fills a sparse series with zeros so every bucket of the range has a value. Unknown buckets (outside the range) are kept out. */
export function zeroFill(
  series: readonly HqStatsPoint[] | null | undefined,
  range: HqStatsRange,
  bucket: 'day' | 'week',
  now: number = Date.now(),
): HqStatsPoint[] {
  const have = new Map((series ?? []).map((p) => [String(p.bucket).slice(0, 10), Number(p.value) || 0]));
  return bucketKeys(range, bucket, now).map((b) => ({ bucket: b, value: have.get(b) ?? 0 }));
}

/** A series with both deaths and claims, filled the same way. */
export function zeroFillPair(
  series: readonly { bucket: string; deaths: number; claims: number }[] | null | undefined,
  range: HqStatsRange,
  bucket: 'day' | 'week',
  now: number = Date.now(),
): { bucket: string; deaths: number; claims: number }[] {
  const have = new Map((series ?? []).map((p) => [String(p.bucket).slice(0, 10), p]));
  return bucketKeys(range, bucket, now).map((b) => ({
    bucket: b,
    deaths: Number(have.get(b)?.deaths) || 0,
    claims: Number(have.get(b)?.claims) || 0,
  }));
}

/** The RPC result with every series zero-filled and every total a number. Empty/partial data = zeros. */
export function normalizeStats(raw: Partial<HqStats> | null | undefined, range: HqStatsRange, now: number = Date.now()): HqStats {
  const bucket = raw?.bucket ?? (range === '90d' ? 'week' : 'day');
  const n = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const fill = (s: readonly HqStatsPoint[] | undefined) => zeroFill(s, range, bucket, now);
  return {
    range,
    bucket,
    auec: {
      earned: n(raw?.auec?.earned),
      spent: n(raw?.auec?.spent),
      net: n(raw?.auec?.net),
      series: fill(raw?.auec?.series),
    },
    missions: { total: n(raw?.missions?.total), series: fill(raw?.missions?.series) },
    deaths_claims: {
      deaths: n(raw?.deaths_claims?.deaths),
      claims: n(raw?.deaths_claims?.claims),
      series: zeroFillPair(raw?.deaths_claims?.series, range, bucket, now),
    },
    crimestat: { total: n(raw?.crimestat?.total), series: fill(raw?.crimestat?.series) },
    refinery: { total: n(raw?.refinery?.total), series: fill(raw?.refinery?.series) },
    blueprints: { total: n(raw?.blueprints?.total), series: fill(raw?.blueprints?.series) },
  };
}

/** Statistik (D40): one RPC, zero-filled client-side. Empty data is zeros, a failed call is an error. */
@Injectable({ providedIn: 'root' })
export class HqStatsService {
  private readonly sb = inject(SupabaseClientProvider);

  readonly range = signal<HqStatsRange>('30d');
  readonly stats = signal<HqStats | null>(null);
  readonly loading = signal(false);
  /** i18n key of the last failed load, never raw text. */
  readonly error = signal<string | null>(null);

  private seq = 0;

  async load(range: HqStatsRange = this.range()): Promise<void> {
    const mine = ++this.seq;
    this.range.set(range);
    this.loading.set(true);
    this.error.set(null);
    try {
      const { data, error } = await this.sb.client.rpc('hq_stats' as never, { p_range: range } as never);
      if (error) throw error;
      if (mine !== this.seq) return;
      this.stats.set(normalizeStats(data as Partial<HqStats> | null, range));
    } catch (err) {
      if (mine !== this.seq) return;
      this.error.set(toErrorKey('hq', 'stats.load', err, { range }));
    } finally {
      if (mine === this.seq) this.loading.set(false);
    }
  }
}
