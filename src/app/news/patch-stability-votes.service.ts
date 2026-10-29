import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { toErrorKey } from '../core/describe-error';
import { SupabaseClientProvider } from '../core/supabase.client';
import { CommunityCorrection, StabilityWord, VoteAggregate, communityCorrection } from './patch-stability';

const WORDS: readonly StabilityWord[] = ['stabil', 'wackelig', 'instabil'];

/** Row of `patch_stability_vote_state()`. */
interface VoteStateRow {
  w_stabil: number;
  w_wackelig: number;
  w_instabil: number;
  sum_w: number;
  sum_w2: number;
  votes: number;
  own_verdict: string | null;
  own_next_change_at: string | null;
}

export function toVoteAggregate(r: VoteStateRow | null | undefined): VoteAggregate {
  const own = WORDS.find((w) => w === r?.own_verdict) ?? null;
  return {
    wStabil: Number(r?.w_stabil ?? 0),
    wWackelig: Number(r?.w_wackelig ?? 0),
    wInstabil: Number(r?.w_instabil ?? 0),
    sumW: Number(r?.sum_w ?? 0),
    sumW2: Number(r?.sum_w2 ?? 0),
    votes: Number(r?.votes ?? 0),
    ownVerdict: own,
    ownNextChangeAt: own ? (r?.own_next_change_at ?? null) : null,
  };
}

export type CastResult = 'ok' | 'too-soon' | 'signed-out' | 'error';

/**
 * The community verdict of ONE patch line (the LIVE line): its aggregate and
 * the signed-in user's own vote. Call `load(line)` for the line the page shows;
 * `castVote` upserts and reloads. The 12 h change limit is enforced by the DB
 * trigger — `'too-soon'` is its answer, `own().nextChangeAt` says when.
 */
@Injectable({ providedIn: 'root' })
export class PatchStabilityVotesService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);

  private readonly _line = signal<string | null>(null);
  private readonly _aggregate = signal<VoteAggregate | null>(null);
  private readonly _loading = signal(false);
  private readonly _saving = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly line = this._line.asReadonly();
  /** Null until the first successful load for `line`. */
  readonly aggregate = this._aggregate.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly saving = this._saving.asReadonly();
  /** `errors.*` i18n key of the last failure; null when fine. A load failure is an error state, not "no votes". */
  readonly error = this._error.asReadonly();

  readonly own = computed(() => {
    const a = this._aggregate();
    return { verdict: a?.ownVerdict ?? null, nextChangeAt: a?.ownNextChangeAt ?? null };
  });

  /** Correction for computed stability `S` against the loaded votes; null before the load. */
  correctionFor(S: number): CommunityCorrection | null {
    const a = this._aggregate();
    return a ? communityCorrection(S, a) : null;
  }

  async load(line: string): Promise<void> {
    if (this._line() !== line) this._aggregate.set(null);
    this._line.set(line);
    this._loading.set(true);
    try {
      const { data, error } = await this.sb.client.rpc('patch_stability_vote_state', { p_line: line });
      if (error) throw error;
      if (this._line() !== line) return; // a newer load took over
      const row = (Array.isArray(data) ? data[0] : data) as VoteStateRow | null;
      this._aggregate.set(toVoteAggregate(row));
      this._error.set(null);
    } catch (err) {
      this._error.set(toErrorKey('news', 'stability vote state load', err, { line }));
    } finally {
      this._loading.set(false);
    }
  }

  /** Cast the first vote or change it (upsert). Reloads the aggregate on success. */
  async castVote(line: string, verdict: StabilityWord): Promise<CastResult> {
    const userId = this.auth.user()?.id ?? null;
    if (!userId) return 'signed-out';
    this._saving.set(true);
    try {
      const { error } = await this.sb.client
        .from('patch_stability_votes')
        .upsert({ user_id: userId, patch_line: line, verdict }, { onConflict: 'user_id,patch_line' });
      if (error) {
        if (typeof error.message === 'string' && error.message.includes('vote_change_too_soon')) {
          await this.load(line);
          return 'too-soon';
        }
        throw error;
      }
      this._error.set(null);
      await this.load(line);
      return 'ok';
    } catch (err) {
      this._error.set(toErrorKey('news', 'stability vote cast', err, { line }));
      return 'error';
    } finally {
      this._saving.set(false);
    }
  }
}
