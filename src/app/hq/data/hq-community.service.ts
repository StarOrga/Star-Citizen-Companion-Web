import { Injectable, inject, signal } from '@angular/core';
import { toErrorKey } from '../../core/describe-error';
import { SupabaseClientProvider } from '../../core/supabase.client';
import type { HqCommunityMedianRow, HqCommunityReportInsert } from './hq-db.types';

/** Opt-in "Community-Daten teilen" (D43, plan §3.5). Default off. */
export const COMMUNITY_SHARE_KEY = 'sc.hq.community.share';

export type CommunityKind = HqCommunityReportInsert['kind'];

export type MedianResult = { ok: true; rows: HqCommunityMedianRow[] } | { ok: false; errorKey: string };
export type ReportResult = { ok: true } | { ok: false; skipped: true } | { ok: false; errorKey: string };

/**
 * Community prices / stock / locations (D43): reads the per-location median of
 * at least five reports (`hq_community_median`, aggregates only) and, only when
 * the user opted in, inserts their own reports into `hq_community_reports`
 * (RLS: insert self, no select). The opt-in lives in this browser.
 */
@Injectable({ providedIn: 'root' })
export class HqCommunityService {
  private readonly sb = inject(SupabaseClientProvider);

  readonly shareEnabled = signal<boolean>(readShare());

  setShare(on: boolean): void {
    this.shareEnabled.set(on);
    try {
      if (on) localStorage.setItem(COMMUNITY_SHARE_KEY, '1');
      else localStorage.removeItem(COMMUNITY_SHARE_KEY);
    } catch {
      /* storage blocked: the choice holds for this session */
    }
  }

  async median(kind: CommunityKind, className: string): Promise<MedianResult> {
    try {
      const { data, error } = await this.sb.client.rpc('hq_community_median', {
        p_kind: kind,
        p_class_name: className,
      });
      if (error) throw error;
      const rows = ((data as HqCommunityMedianRow[] | null) ?? []).map((r) => ({
        location: r.location,
        median: Number(r.median),
        n: Number(r.n),
        newest: r.newest,
      }));
      return { ok: true, rows };
    } catch (err) {
      return { ok: false, errorKey: toErrorKey('hq-community', 'median', err, { kind, className }) };
    }
  }

  /** Sends reports only when sharing is on; an empty or invalid batch is a no-op. */
  async report(reports: readonly HqCommunityReportInsert[]): Promise<ReportResult> {
    if (!this.shareEnabled()) return { ok: false, skipped: true };
    const clean = reports.filter(
      (r) => r.class_name.trim() && r.location.trim() && Number.isFinite(r.value) && r.value >= 0,
    );
    if (clean.length === 0) return { ok: true };
    try {
      const { error } = await this.sb.client.from('hq_community_reports').insert(clean);
      if (error) throw error;
      return { ok: true };
    } catch (err) {
      return { ok: false, errorKey: toErrorKey('hq-community', 'report', err, { count: clean.length }) };
    }
  }
}

function readShare(): boolean {
  try {
    return localStorage.getItem(COMMUNITY_SHARE_KEY) === '1';
  } catch {
    return false;
  }
}
