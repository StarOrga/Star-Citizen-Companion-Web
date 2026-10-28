import { Injectable, computed, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { AuthService } from '../../auth/auth.service';
import { toErrorKey } from '../../core/describe-error';
import { logWarn } from '../../core/log';
import { starEarnedEvent } from '../starmap/starmap.model';
import { trackShown as trackShownFocus } from './shown-tracker';
import {
  PatchPrediction,
  PatchReadiness,
  PredictionMedian,
  StarEarnedEvent,
  VerseGuessOptions,
  VerseGuessResult,
  mapGuessOptions,
  mapGuessResult,
  VerseCommunityStars,
  VerseConstellation,
  VerseSuggestion,
  VerseDigest,
  VerseDigestItem,
  VerseExplorerState,
  VerseLoadState,
  VerseResult,
  VerseStarKey,
  VERSE_STAR_KEYS,
  mapCommunityStars,
  mapConstellation,
  mapSuggestion,
  mapDigest,
  mapExplorer,
  rankTopItems,
} from './verse.models';

const SCOPE = 'verse';

/** A gap of this length without Verse activity ends a session (all tabs of an account share it). */
export const SESSION_GAP_MS = 30 * 60_000;
const SHOWN_KEY_CAP = 200;
const SHOWN_STORAGE_PREFIX = 'sc.verse.shown.';

/** Server refusals (RPC `raise exception '<token>'`) that have their own translated text. */
const RPC_REFUSALS: readonly (readonly [string, string])[] = [
  ['comet_locked', 'errors.cometLocked'],
  ['comet_already_tipped', 'errors.cometTipped'],
  ['comet_date_past', 'errors.cometDatePast'],
  ['guess_already_made', 'errors.guessMade'],
  ['guess_invalid_option', 'errors.guessInvalid'],
  ['guess_unavailable', 'errors.guessUnavailable'],
];

/** `errors.*` key of a failed call: a known server refusal, else the generic translation. */
export function verseErrorKey(op: string, err: unknown): string {
  const text = typeof (err as { message?: unknown } | null)?.message === 'string' ? (err as { message: string }).message : '';
  const hit = RPC_REFUSALS.find(([token]) => text.includes(token));
  if (hit) {
    logWarn(SCOPE, `${op} refused`, { error: err });
    return hit[1];
  }
  return toErrorKey(SCOPE, op, err);
}

interface ShownRecord {
  /** Last activity (ms epoch). */
  at: number;
  keys: string[];
}

/**
 * Data layer of the Verse hub (migration 20261009100000_verse_hub.sql).
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

  private readonly starEvents = new Subject<StarEarnedEvent>();
  /** Fires once per NEWLY earned star (trigger, comet tip, right guess) — the unlock toast subscribes. */
  readonly starEarned$ = this.starEvents.asObservable();
  private readonly _lastStar = signal<StarEarnedEvent | null>(null);
  /** The most recent star event (signal twin of {@link starEarned$}). */
  readonly lastStarEarned = this._lastStar.asReadonly();

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
      // Session rollover: what the PREVIOUS session showed counts as seen from now on.
      const stale = this.takeStaleShown();
      if (stale.length) await this.markSeen(stale);
    } catch (err) {
      // Seen-state only reorders the list; the briefing works without it.
      toErrorKey(SCOPE, 'loadSeen', err);
    }
  }

  /**
   * Records briefing items that were shown (with >= 5 s of page focus, see
   * {@link trackShown}) in the CURRENT session. They count as seen only from the
   * next session on ({@link loadSeen} flushes them), even if never opened.
   * The record lives in localStorage per account, so several tabs share one
   * session; a gap of {@link SESSION_GAP_MS} without activity ends it.
   */
  noteShown(keys: readonly string[]): void {
    const storageKey = this.shownStorageKey();
    if (!storageKey) return;
    const fresh = keys.filter((k) => k && !this._seen().has(k));
    if (!fresh.length) return;
    const now = Date.now();
    let rec = this.readShown(storageKey);
    if (rec && now - rec.at > SESSION_GAP_MS) {
      // The previous session ended before any loadSeen() ran: flush it first.
      void this.markSeen(rec.keys);
      rec = null;
    }
    const merged = [...new Set([...(rec?.keys ?? []), ...fresh])].slice(-SHOWN_KEY_CAP);
    this.writeShown(storageKey, { at: now, keys: merged });
  }

  /**
   * Starts the 5 s focus clock for a rendered briefing list: once the page was
   * visible AND focused for 5 s (accumulated, paused while
   * hidden / blurred) the keys go through {@link noteShown}. Returns a cancel
   * function for the component's teardown.
   */
  trackShown(keys: readonly string[]): () => void {
    return trackShownFocus(keys, (shown) => this.noteShown(shown));
  }

  /** The stale previous session's keys (removed from storage); a fresh record is only touched. */
  private takeStaleShown(): string[] {
    const storageKey = this.shownStorageKey();
    if (!storageKey) return [];
    const rec = this.readShown(storageKey);
    if (!rec) return [];
    if (Date.now() - rec.at > SESSION_GAP_MS) {
      this.clearShown(storageKey);
      return rec.keys;
    }
    this.writeShown(storageKey, { at: Date.now(), keys: rec.keys });
    return [];
  }

  private shownStorageKey(): string | null {
    const id = this.auth.user()?.id;
    return id ? `${SHOWN_STORAGE_PREFIX}${id}` : null;
  }

  private readShown(storageKey: string): ShownRecord | null {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const o = JSON.parse(raw) as Partial<ShownRecord>;
      if (typeof o.at !== 'number' || !Array.isArray(o.keys)) return null;
      return { at: o.at, keys: o.keys.filter((k): k is string => typeof k === 'string') };
    } catch {
      return null;
    }
  }

  private writeShown(storageKey: string, rec: ShownRecord): void {
    try {
      localStorage.setItem(storageKey, JSON.stringify(rec));
    } catch {
      /* storage blocked / full: the rule just degrades to "opened = seen" */
    }
  }

  private clearShown(storageKey: string): void {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* see writeShown */
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
   * server refuses a second vote, and any vote once the patch is LIVE or an
   * official LIVE date was announced (`errors.cometLocked`). Earns the 'comet'
   * star server-side and emits {@link starEarned$}.
   */
  async submitPrediction(patchLine: string, predictedLiveDate: string): Promise<VerseResult<void>> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(predictedLiveDate)) {
      return { ok: false, errorKey: toErrorKey(SCOPE, 'submitPrediction', new Error('invalid date')) };
    }
    const before = await this.explorerSnapshot();
    const { error } = await this.sb.client.rpc('verse_submit_prediction', {
      p_patch_line: patchLine,
      p_date: predictedLiveDate,
    });
    if (error) return { ok: false, errorKey: verseErrorKey('submitPrediction', error) };
    await this.announceStar('comet', patchLine, before);
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
    const before = await this.explorerSnapshot();
    const { data, error } = await this.sb.client.rpc('verse_earn_star', {
      p_patch_line: patchLine,
      p_star_key: starKey,
    });
    if (error) return { ok: false, errorKey: toErrorKey(SCOPE, 'earnStar', error) };
    if (data === true) await this.announceStar(starKey, patchLine, before);
    return { ok: true, data: data === true };
  }

  /**
   * 'cx-newship': the server compares the opened vehicle with the patch's
   * constellation hull (no client-side answer). `earned` / `already` / `no`
   * (not the newest ship) / `guess_first` (the guess is still open — try again
   * after it was made).
   */
  async claimNewShip(
    patchLine: string,
    className: string,
  ): Promise<VerseResult<'earned' | 'already' | 'no' | 'guess_first'>> {
    const before = await this.explorerSnapshot();
    const { data, error } = await this.sb.client.rpc('verse_claim_newship', {
      p_patch_line: patchLine,
      p_class_name: className,
    });
    if (error) return { ok: false, errorKey: toErrorKey(SCOPE, 'claimNewShip', error) };
    const res = data === 'earned' || data === 'already' || data === 'guess_first' ? data : 'no';
    if (res === 'earned') await this.announceStar('cx-newship', patchLine, before);
    return { ok: true, data: res };
  }

  /** "Sternbild erkennen": the 7 options + guess state (answer null while open). */
  async guessOptions(patchLine: string): Promise<VerseResult<VerseGuessOptions>> {
    const { data, error } = await this.sb.client.rpc('verse_guess_options', { p_patch_line: patchLine });
    if (error) return { ok: false, errorKey: verseErrorKey('guessOptions', error) };
    const mapped = mapGuessOptions(data);
    if (!mapped) return { ok: false, errorKey: toErrorKey(SCOPE, 'guessOptions', new Error('malformed payload')) };
    return { ok: true, data: mapped };
  }

  /**
   * The single guess of a patch (`className` from {@link guessOptions}). A wrong
   * guess reveals the answer without a star; a right one lights 'cx-guess' and
   * emits {@link starEarned$}. A second try fails with `errors.guessMade`.
   */
  async submitGuess(patchLine: string, className: string): Promise<VerseResult<VerseGuessResult>> {
    const before = await this.explorerSnapshot();
    const { data, error } = await this.sb.client.rpc('verse_guess_constellation', {
      p_patch_line: patchLine,
      p_class_name: className,
    });
    if (error) return { ok: false, errorKey: verseErrorKey('submitGuess', error) };
    const res = mapGuessResult(data);
    if (!res) return { ok: false, errorKey: toErrorKey(SCOPE, 'submitGuess', new Error('malformed payload')) };
    if (res.starEarned) await this.announceStar('cx-guess', patchLine, before);
    else void this.loadExplorer();
    return { ok: true, data: res };
  }

  /** Loads the explorer state once for a signed-in user (the avatar's rank crest needs it on every page). */
  ensureExplorer(): void {
    if (this.auth.isAuthenticated() && !this._explorer() && this._explorerState() !== 'loading') void this.loadExplorer();
  }

  /** The explorer state before a claim (loaded on demand so reward diffs are exact); null when unavailable. */
  private async explorerSnapshot(): Promise<VerseExplorerState | null> {
    if (!this.auth.isAuthenticated()) return null;
    if (!this._explorer() && this._explorerState() !== 'loading') await this.loadExplorer();
    return this._explorer();
  }

  /** Reloads the explorer and emits the star event with the milestones this star crossed. */
  private async announceStar(key: VerseStarKey, patchLine: string, before: VerseExplorerState | null): Promise<void> {
    await this.loadExplorer();
    const after = this._explorer();
    if (!after) return;
    // Without a prior state a reward diff would claim everything: report no unlocks then.
    const ev = starEarnedEvent(key, patchLine, before ?? after, after);
    if (!ev) return;
    this._lastStar.set(ev);
    this.starEvents.next(ev);
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

  /** Public shape of a patch; `className` is null — the hull is the guess challenge's answer. */
  async constellation(patchLine: string): Promise<VerseResult<VerseConstellation | null>> {
    const { data, error } = await this.sb.client
      .from('verse_constellations')
      .select('patch_line, kind, points')
      .eq('patch_line', patchLine)
      .maybeSingle();
    if (error) return { ok: false, errorKey: toErrorKey(SCOPE, 'constellation', error) };
    return { ok: true, data: mapConstellation(data) };
  }

  /** All constellations, newest first ("Meine Sternbilder" filters by earned wallpapers). */
  async constellations(limit = 50): Promise<VerseResult<VerseConstellation[]>> {
    const { data, error } = await this.sb.client
      .from('verse_constellations')
      .select('patch_line, kind, points')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return { ok: false, errorKey: toErrorKey(SCOPE, 'constellations', error) };
    return { ok: true, data: (data ?? []).map(mapConstellation).filter((c): c is VerseConstellation => c !== null) };
  }

  /** Community constellation of a patch: explorer count + count per star (no user ids). */
  async communityStars(patchLine: string): Promise<VerseResult<VerseCommunityStars | null>> {
    const { data, error } = await this.sb.client.rpc('verse_community_stars', { p_patch_line: patchLine });
    if (error) return { ok: false, errorKey: toErrorKey(SCOPE, 'communityStars', error) };
    return { ok: true, data: mapCommunityStars(data) };
  }

  /** Kartograph (rank >= 1): suggest a top item. RLS refuses lower ranks. */
  async suggest(itemUrl: string, note: string | null): Promise<VerseResult<void>> {
    const { error } = await this.sb.client.from('verse_suggestions').insert({ item_url: itemUrl, note: note || null });
    if (error) return { ok: false, errorKey: toErrorKey(SCOPE, 'suggest', error) };
    return { ok: true, data: undefined };
  }

  /** Own suggestions — or, for an admin, everyone's (RLS decides). Newest first. */
  async suggestions(limit = 50): Promise<VerseResult<VerseSuggestion[]>> {
    const { data, error } = await this.sb.client
      .from('verse_suggestions')
      .select('id, item_url, note, status, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return { ok: false, errorKey: toErrorKey(SCOPE, 'suggestions', error) };
    return { ok: true, data: (data ?? []).map(mapSuggestion) };
  }

  /** Admin: turn a suggestion into a briefing pin. Returns the pin's item key. */
  async promoteSuggestion(id: string, title: string): Promise<VerseResult<string>> {
    const { data, error } = await this.sb.client.rpc('verse_promote_suggestion', { p_id: id, p_title: title });
    if (error) return { ok: false, errorKey: toErrorKey(SCOPE, 'promoteSuggestion', error) };
    return { ok: true, data: String(data ?? '') };
  }

  /** Admin: dismiss a suggestion. */
  async dismissSuggestion(id: string): Promise<VerseResult<void>> {
    const { error } = await this.sb.client.from('verse_suggestions').update({ status: 'dismissed' }).eq('id', id);
    if (error) return { ok: false, errorKey: toErrorKey(SCOPE, 'dismissSuggestion', error) };
    return { ok: true, data: undefined };
  }
}
