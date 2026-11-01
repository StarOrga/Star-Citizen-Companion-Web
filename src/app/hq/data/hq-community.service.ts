import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
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

  private readonly auth = inject(AuthService);

  /** The opt-in of the signed-in account (stored per user: a shared browser must not carry it over). */
  readonly shareEnabled = signal<boolean>(false);

  constructor() {
    effect(() => {
      const id = this.auth.user()?.id ?? null;
      untracked(() => this.shareEnabled.set(id ? readShare(id) : false));
    });
  }

  setShare(on: boolean): void {
    const id = this.auth.user()?.id ?? null;
    if (!id) return;
    this.shareEnabled.set(on);
    try {
      if (on) localStorage.setItem(communityShareKey(id), '1');
      else localStorage.removeItem(communityShareKey(id));
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

/** Storage key of one account's opt-in: `sc.hq.community.share.<uid>`. */
export function communityShareKey(uid: string): string {
  return `${COMMUNITY_SHARE_KEY}.${uid}`;
}

function readShare(uid: string): boolean {
  try {
    return localStorage.getItem(communityShareKey(uid)) === '1';
  } catch {
    return false;
  }
}
