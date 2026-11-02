import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { toErrorKey } from '../core/describe-error';
import { SupabaseClientProvider } from '../core/supabase.client';
import { CommunityCorrection, StabilityWord, VoteAggregate, channelStability, communityCorrection } from './patch-stability';
import { CastResult, toVoteAggregate } from './patch-stability-votes.service';

/** The channels a build can be voted in — Evocati never (NDA; the DB CHECK says the same). */
export const VOTABLE_CHANNELS = ['hotfix', 'ptu'] as const;
export type VotableChannel = (typeof VOTABLE_CHANNELS)[number];

export function isVotableChannel(c: string | null | undefined): c is VotableChannel {
  return c === 'hotfix' || c === 'ptu';
}

/** Row of `patch_channel_build_vote_state()`. */
interface BuildVoteStateRow {
  channel: string;
  version: string;
  line: string;
  wave: number | null;
  thread_first_at: string | null;
  replies: number | null;
  ticket_share: number | string | null;
  ticket_vote_share: number | string | null;
  w_stabil: number;
  w_wackelig: number;
  w_instabil: number;
  sum_w: number;
  sum_w2: number;
  votes: number;
  own_verdict: string | null;
  own_next_change_at: string | null;
}

/** One running Hotfix / PTU build with its raw numbers and its votes. */
export interface ChannelBuildVotes {
  channel: VotableChannel;
  version: string;
  line: string;
  wave: number | null;
  /** The computed stability S of the build (community component only); null = too little data. */
  stability: number | null;
  aggregate: VoteAggregate;
}

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function toChannelBuildVotes(r: BuildVoteStateRow, now: number = Date.now()): ChannelBuildVotes | null {
  if (!isVotableChannel(r.channel) || !r.version) return null;
  const s = channelStability({
    replies: Number(r.replies ?? 0),
    ticketShare: num(r.ticket_share),
    ticketVoteShare: num(r.ticket_vote_share),
    fromIso: r.thread_first_at,
    toIso: new Date(now).toISOString(),
  });
  return {
    channel: r.channel,
    version: r.version,
    line: r.line,
    wave: r.wave ?? null,
    stability: s?.stability ?? null,
    aggregate: toVoteAggregate(r),
  };
}

export const buildKey = (channel: string, version: string): string => `${channel}:${version}`;

/**
 * The community verdict of the RUNNING Hotfix / PTU builds (#885). One RPC
 * returns every running build, so the hub row and the dossier share a load.
 * The DB enforces the rules (running build only, 12 h change lock, 3 casts per
 * 24 h, no withdrawal); the results come back as `CastResult`s.
 */
@Injectable({ providedIn: 'root' })
export class ChannelBuildVotesService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);

  private readonly _builds = signal<readonly ChannelBuildVotes[] | null>(null);
  private readonly _loading = signal(false);
  private readonly _saving = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _revealed = signal<ReadonlySet<string>>(new Set());
  private started = false;

  /** Null until the first successful load. */
  readonly builds = this._builds.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly saving = this._saving.asReadonly();
  /** `errors.*` i18n key of the last failure; null when fine. */
  readonly error = this._error.asReadonly();

  /** Load once; later calls are no-ops (a failed first load is retried with `load()`). */
  ensure(): void {
    if (this.started) return;
    this.started = true;
    void this.load();
  }

  async load(): Promise<void> {
    this.started = true;
    this._loading.set(true);
    try {
      const { data, error } = await this.sb.client.rpc('patch_channel_build_vote_state');
      if (error) throw error;
      const rows = (Array.isArray(data) ? data : []) as BuildVoteStateRow[];
      this._builds.set(rows.map((r) => toChannelBuildVotes(r)).filter((b): b is ChannelBuildVotes => b !== null));
      this._error.set(null);
    } catch (err) {
      this._error.set(toErrorKey('news', 'build vote state load', err));
    } finally {
      this._loading.set(false);
    }
  }

  find(channel: string, version: string): ChannelBuildVotes | null {
    return this._builds()?.find((b) => b.channel === channel && b.version === version) ?? null;
  }

  /** Running votable builds of one patch line (`4.4` → its PTU build, `4.3` → its hotfix). */
  forLine(line: string): ChannelBuildVotes[] {
    return (this._builds() ?? []).filter((b) => b.line === line);
  }

  /** Correction of build stability `S`; null before the load or for a build that is not running. */
  correctionFor(channel: string, version: string, S: number): CommunityCorrection | null {
    const b = this.find(channel, version);
    return b ? communityCorrection(S, b.aggregate) : null;
  }

  /** Blind voting per build, exactly as on the LIVE line. */
  blind(channel: string, version: string): boolean {
    const b = this.find(channel, version);
    return !!this.auth.user() && !!b && b.aggregate.ownVerdict === null && !this._revealed().has(buildKey(channel, version));
  }

  reveal(channel: string, version: string): void {
    this._revealed.update((s) => new Set(s).add(buildKey(channel, version)));
  }

  /** Cast the first vote or change it (upsert). Reloads on success and on a rule refusal. */
  async castVote(channel: VotableChannel, version: string, verdict: StabilityWord): Promise<CastResult> {
    const userId = this.auth.user()?.id ?? null;
    if (!userId) return 'signed-out';
    this._saving.set(true);
    try {
      const { error } = await this.sb.client
        .from('patch_channel_build_votes')
        .upsert({ user_id: userId, channel, version, verdict }, { onConflict: 'user_id,channel,version' });
      if (error) {
        const msg = typeof error.message === 'string' ? error.message : '';
        const refusal: CastResult | null = msg.includes('vote_change_too_soon') ? 'too-soon'
          : msg.includes('vote_daily_cap') ? 'daily-cap'
          : msg.includes('vote_build_not_running') ? 'closed'
          : null;
        if (refusal) {
          await this.load();
          return refusal;
        }
        throw error;
      }
      this._error.set(null);
      await this.load();
      return 'ok';
    } catch (err) {
      this._error.set(toErrorKey('news', 'build vote cast', err, { channel, version }));
      return 'error';
    } finally {
      this._saving.set(false);
    }
  }

  /** Signals bound to ONE build, in the shape the Community-Urteil card reads. */
  source(channel: VotableChannel, version: string) {
    const agg = computed(() => this.find(channel, version)?.aggregate ?? null);
    return {
      aggregate: agg,
      error: this.error,
      saving: this.saving,
      blind: computed(() => this.blind(channel, version)),
      own: () => ({ verdict: agg()?.ownVerdict ?? null, nextChangeAt: agg()?.ownNextChangeAt ?? null }),
      correctionFor: (S: number) => this.correctionFor(channel, version, S),
      reveal: () => this.reveal(channel, version),
      retry: () => void this.load(),
      cast: (w: StabilityWord) => this.castVote(channel, version, w),
    };
  }
}
