import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { AuthService } from '../../auth/auth.service';
import { toErrorKey } from '../../core/describe-error';
import {
  PatchPrediction,
  PatchReadiness,
  PredictionMedian,
  VerseConstellation,
  VerseDigest,
  VerseDigestItem,
  VerseExplorerState,
  VerseLoadState,
  VerseResult,
  VerseStarKey,
  VERSE_STAR_KEYS,
  mapConstellation,
  mapDigest,
  mapExplorer,
  rankTopItems,
} from './verse.models';

const SCOPE = 'verse';

/**
 * Data layer of the Verse hub (migration 20261009090000_verse_hub.sql).
 *
 * Shared state (digest, seen keys, explorer state) lives in signals; one-off
 * reads and writes return a {@link VerseResult} whose `errorKey` is an
 * `errors.*` i18n key — never a raw message.
 */
@Injectable({ providedIn: 'root' })
export class VerseApiService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);

  private readonly _digest = signal<VerseDigest | null>(null);
  private readonly _digestState = signal<VerseLoadState>('idle');
  private readonly _digestError = signal<string | null>(null);
  private readonly _seen = signal<ReadonlySet<string>>(new Set());
  private readonly _explorer = signal<VerseExplorerState | null>(null);
  private readonly _explorerState = signal<VerseLoadState>('idle');
  private readonly _explorerError = signal<string | null>(null);

  readonly digest = this._digest.asReadonly();
  readonly digestState = this._digestState.asReadonly();
  /** `errors.*` key of the last failed digest load. */
  readonly digestError = this._digestError.asReadonly();
  /** Item keys the signed-in user has seen (empty when signed out). */
  readonly seen = this._seen.asReadonly();
  /** Briefing top list: pins, then unseen, then seen — cut to the adaptive 3..7. */
  readonly topItems = computed<VerseDigestItem[]>(() => rankTopItems(this._digest(), this._seen()));
  readonly explorer = this._explorer.asReadonly();
  readonly explorerState = this._explorerState.asReadonly();
  readonly explorerError = this._explorerError.asReadonly();

  /** Loads the briefing payload (GET, so the service worker / CDN can cache it 60 s). */
  async loadDigest(): Promise<void> {
    this._digestState.set('loading');
    this._digestError.set(null);
    try {
      const { data, error } = await this.sb.client.rpc('verse_digest', {}, { get: true });
      if (error) throw error;
      const digest = mapDigest(data);
      if (!digest) throw new Error('verse_digest: malformed payload');
      this._digest.set(digest);
      this._digestState.set('ready');
    } catch (err) {
      this._digestError.set(toErrorKey(SCOPE, 'loadDigest', err));
      this._digestState.set('error');
    }
  }

  /** Loads the caller's seen keys; a no-op (clears) when signed out. */
  async loadSeen(): Promise<void> {
    if (!this.auth.isAuthenticated()) {
      this._seen.set(new Set());
      return;
    }
    try {
      const { data, error } = await this.sb.client.from('verse_seen').select('item_key').limit(500);
      if (error) throw error;
      this._seen.set(new Set((data ?? []).map((r: { item_key: string }) => r.item_key)));
    } catch (err) {
      // Seen-state only reorders the list; the briefing works without it.
      toErrorKey(SCOPE, 'loadSeen', err);
    }
  }

  /** Optimistically marks items seen; reverts on failure. Signed out: no-op. */
  async markSeen(keys: readonly string[]): Promise<VerseResult<void>> {
    const fresh = keys.filter((k) => k && !this._seen().has(k));
    if (!fresh.length || !this.auth.isAuthenticated()) return { ok: true, data: undefined };
    const before = this._seen();
    this._seen.set(new Set([...before, ...fresh]));
    const { error } = await this.sb.client
      .from('verse_seen')
      .upsert(fresh.map((item_key) => ({ item_key })), { onConflict: 'user_id,item_key' });
    if (error) {
      this._seen.set(before);
      return { ok: false, errorKey: toErrorKey(SCOPE, 'markSeen', error) };
    }
    return { ok: true, data: undefined };
  }

  async getReadiness(patchLine: string): Promise<VerseResult<PatchReadiness | null>> {
    const { data, error } = await this.sb.client
      .from('patch_readiness')
      .select('patch_line, checklist, updated_at')
      .eq('patch_line', patchLine)
      .maybeSingle();
    if (error) return { ok: false, errorKey: toErrorKey(SCOPE, 'getReadiness', error) };
    return {
      ok: true,
      data: data ? { patchLine: data.patch_line, checklist: data.checklist ?? {}, updatedAt: data.updated_at } : null,
    };
  }

  async saveReadiness(patchLine: string, checklist: Readonly<Record<string, boolean>>): Promise<VerseResult<void>> {
    const { error } = await this.sb.client
      .from('patch_readiness')
      .upsert({ patch_line: patchLine, checklist, updated_at: new Date().toISOString() }, { onConflict: 'user_id,patch_line' });
    if (error) return { ok: false, errorKey: toErrorKey(SCOPE, 'saveReadiness', error) };
    return { ok: true, data: undefined };
  }

  async getMyPrediction(patchLine: string): Promise<VerseResult<PatchPrediction | null>> {
    const { data, error } = await this.sb.client
      .from('patch_prediction')
      .select('patch_line, predicted_live_date, created_at')
      .eq('patch_line', patchLine)
      .maybeSingle();
    if (error) return { ok: false, errorKey: toErrorKey(SCOPE, 'getMyPrediction', error) };
    return {
      ok: true,
      data: data
        ? { patchLine: data.patch_line, predictedLiveDate: data.predicted_live_date, createdAt: data.created_at }
        : null,
    };
  }

  /**
   * Submits the comet vote (`YYYY-MM-DD`, today or later). Insert-only: the
   * server refuses a second vote and any vote once the patch is LIVE. Earns
   * the 'comet' star server-side.
   */
  async submitPrediction(patchLine: string, predictedLiveDate: string): Promise<VerseResult<void>> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(predictedLiveDate)) {
      return { ok: false, errorKey: toErrorKey(SCOPE, 'submitPrediction', new Error('invalid date')) };
    }
    const { error } = await this.sb.client
      .from('patch_prediction')
      .insert({ patch_line: patchLine, predicted_live_date: predictedLiveDate });
    if (error) return { ok: false, errorKey: toErrorKey(SCOPE, 'submitPrediction', error) };
    return { ok: true, data: undefined };
  }

  /** Community median — `null` until the caller has voted on this patch line. */
  async predictionMedian(patchLine: string): Promise<VerseResult<PredictionMedian | null>> {
    const { data, error } = await this.sb.client.rpc('patch_prediction_median', { p_patch_line: patchLine });
    if (error) return { ok: false, errorKey: toErrorKey(SCOPE, 'predictionMedian', error) };
    if (!data || typeof data !== 'object' || !(data as { median?: unknown }).median) return { ok: true, data: null };
    const d = data as { patch_line: string; median: string; votes: number };
    return { ok: true, data: { patchLine: d.patch_line, median: d.median, votes: Number(d.votes) || 0 } };
  }

  /** The <= 7 star keys offered for a patch. */
  async starPool(patchLine: string): Promise<VerseResult<VerseStarKey[]>> {
    const { data, error } = await this.sb.client.rpc('verse_star_pool', { p_patch_line: patchLine });
    if (error) return { ok: false, errorKey: toErrorKey(SCOPE, 'starPool', error) };
    const keys = (Array.isArray(data) ? data : []).filter((k): k is VerseStarKey =>
      VERSE_STAR_KEYS.includes(k as VerseStarKey),
    );
    return { ok: true, data: keys };
  }

  /**
   * Claims a star (not 'comet' — that one comes with the prediction).
   * `data` is true when it was newly earned. Refreshes the explorer state.
   */
  async earnStar(patchLine: string, starKey: Exclude<VerseStarKey, 'comet'>): Promise<VerseResult<boolean>> {
    const { data, error } = await this.sb.client.rpc('verse_earn_star', {
      p_patch_line: patchLine,
      p_star_key: starKey,
    });
    if (error) return { ok: false, errorKey: toErrorKey(SCOPE, 'earnStar', error) };
    if (data === true) void this.loadExplorer();
    return { ok: true, data: data === true };
  }

  /** Loads stars, suns, streak and unlocks; clears when signed out. */
  async loadExplorer(): Promise<void> {
    if (!this.auth.isAuthenticated()) {
      this._explorer.set(null);
      this._explorerState.set('idle');
      return;
    }
    this._explorerState.set('loading');
    this._explorerError.set(null);
    try {
      const { data, error } = await this.sb.client.rpc('verse_explorer_state', {}, { get: true });
      if (error) throw error;
      this._explorer.set(mapExplorer(data));
      this._explorerState.set('ready');
    } catch (err) {
      this._explorerError.set(toErrorKey(SCOPE, 'loadExplorer', err));
      this._explorerState.set('error');
    }
  }

  async constellation(patchLine: string): Promise<VerseResult<VerseConstellation | null>> {
    const { data, error } = await this.sb.client
      .from('verse_constellations')
      .select('patch_line, class_name, kind, points')
      .eq('patch_line', patchLine)
      .maybeSingle();
    if (error) return { ok: false, errorKey: toErrorKey(SCOPE, 'constellation', error) };
    return { ok: true, data: mapConstellation(data) };
  }

  /** All constellations, newest first ("Meine Sternbilder" filters by earned wallpapers). */
  async constellations(limit = 50): Promise<VerseResult<VerseConstellation[]>> {
    const { data, error } = await this.sb.client
      .from('verse_constellations')
      .select('patch_line, class_name, kind, points')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return { ok: false, errorKey: toErrorKey(SCOPE, 'constellations', error) };
    return { ok: true, data: (data ?? []).map(mapConstellation).filter((c): c is VerseConstellation => c !== null) };
  }
}
