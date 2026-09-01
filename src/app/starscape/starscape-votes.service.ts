import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { AuthService } from '../auth/auth.service';
import { Wallpaper, mapWallpaperRow } from './starscape.service';

/**
 * Starscape thumbs-up + the global Top-N ranking (admin feedback 058468f7).
 *
 * The vote itself is a row in `wallpaper_votes`, keyed on
 * `(verse_wallpapers.image_id, auth.users.id)` — the gallery's own stable CDN
 * media id, the same one the share deep link (`/starscape?image=<id>`) hands
 * out. The primary key IS the "one vote per user per image" rule, so this
 * service never has to defend it in the client.
 *
 * Reads go through two SECURITY DEFINER RPCs rather than the table, because
 * `wallpaper_votes` is self-read-only: a public select would publish who liked
 * what. `starscape_vote_state` answers "how many, and did I" without ever
 * returning a user id; `starscape_top_wallpapers` is the shared ranking the
 * desktop tray app will reuse.
 */

/** How many wallpapers the "Top" toggle shows. Named in the UI copy as well. */
export const TOP_LIMIT = 7;

/**
 * Where a signed-out visitor's toggle lives. Signed-in users keep it on their
 * profile (`profiles.starscape_top_only`) so the desktop app sees the same
 * preference — but the gallery is a public page, and a visitor who flips the
 * toggle should still find it flipped after a reload.
 */
const TOP_ONLY_STORAGE_KEY = 'sc.starscape.topOnly';

/** Postgres unique_violation — a second insert of a vote that already exists. */
const UNIQUE_VIOLATION = '23505';

interface VoteStateRow {
  image_id?: string;
  votes?: number | string;
  voted?: boolean;
}

@Injectable({ providedIn: 'root' })
export class StarscapeVotesService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);

  /** Public vote count per image id. A missing entry means zero. */
  readonly counts = signal<ReadonlyMap<string, number>>(new Map());
  /** Image ids the current user has voted for. */
  readonly mine = signal<ReadonlySet<string>>(new Set());
  /** Images with a vote write in flight — keeps a double tap from double-firing. */
  readonly busy = signal<ReadonlySet<string>>(new Set());

  /** "Only show the Top 7" — the per-user toggle. */
  readonly topOnly = signal(false);
  readonly topWallpapers = signal<readonly Wallpaper[]>([]);
  readonly topLoading = signal(false);

  readonly topLimit = TOP_LIMIT;

  /** Voting needs an account; signed-out visitors see the count, disabled. */
  readonly canVote = computed(() => this.auth.isAuthenticated());

  countFor(imageId: string): number {
    return this.counts().get(imageId) ?? 0;
  }

  hasVoted(imageId: string): boolean {
    return this.mine().has(imageId);
  }

  isBusy(imageId: string): boolean {
    return this.busy().has(imageId);
  }

  /**
   * Refresh counts + own-vote flags for the images currently on screen.
   * Best-effort: the gallery is fully usable without them, so a failure is
   * swallowed rather than turned into an error banner over the artwork.
   */
  async syncCounts(imageIds: readonly string[]): Promise<void> {
    const ids = [...new Set(imageIds)].filter((id) => id.length > 0);
    if (ids.length === 0) return;
    try {
      const { data, error } = await this.sb.client.rpc('starscape_vote_state', {
        p_image_ids: ids,
      });
      if (error) return;
      const rows = (Array.isArray(data) ? data : []) as VoteStateRow[];
      // Only the requested ids are replaced — a later page must not wipe the
      // counts an earlier one already resolved.
      const counts = new Map(this.counts());
      const mine = new Set(this.mine());
      for (const id of ids) {
        counts.set(id, 0);
        mine.delete(id);
      }
      for (const row of rows) {
        const id = row.image_id;
        if (!id) continue;
        counts.set(id, Number(row.votes ?? 0));
        if (row.voted) mine.add(id);
      }
      this.counts.set(counts);
      this.mine.set(mine);
    } catch {
      /* the tiles simply keep whatever counts they had */
    }
  }

  /**
   * Cast or revoke this user's vote. Optimistic: the icon and the count flip
   * immediately and roll back only if the write actually fails — a thumbs-up is
   * a one-tap gesture, and waiting a round trip for it to light up is the whole
   * difference between "responsive" and "did that register?".
   */
  async toggle(imageId: string): Promise<void> {
    const user = this.auth.user();
    if (!user || !imageId || this.isBusy(imageId)) return;
    const had = this.hasVoted(imageId);
    this.markBusy(imageId, true);
    this.applyLocal(imageId, !had);
    try {
      if (had) {
        const { error } = await this.sb.client
          .from('wallpaper_votes')
          .delete()
          .eq('image_id', imageId)
          .eq('user_id', user.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await this.sb.client
          .from('wallpaper_votes')
          .insert({ image_id: imageId, user_id: user.id });
        // A duplicate means the vote is already there — which is exactly the
        // state we optimistically painted, so it is a success, not a failure.
        if (error && error.code !== UNIQUE_VIOLATION) throw new Error(error.message);
      }
    } catch {
      this.applyLocal(imageId, had);
    } finally {
      this.markBusy(imageId, false);
    }
  }

  /** Flip one image's local vote state and its count by ±1. */
  private applyLocal(imageId: string, voted: boolean): void {
    const mine = new Set(this.mine());
    const counts = new Map(this.counts());
    const current = counts.get(imageId) ?? 0;
    if (voted) {
      if (!mine.has(imageId)) counts.set(imageId, current + 1);
      mine.add(imageId);
    } else {
      if (mine.has(imageId)) counts.set(imageId, Math.max(0, current - 1));
      mine.delete(imageId);
    }
    this.mine.set(mine);
    this.counts.set(counts);
  }

  private markBusy(imageId: string, on: boolean): void {
    const next = new Set(this.busy());
    if (on) next.add(imageId);
    else next.delete(imageId);
    this.busy.set(next);
  }

  /**
   * The globally highest-voted wallpapers. Ranking lives in
   * `starscape_top_wallpapers` (SQL), not here, so the desktop tray app can ask
   * the same question and get the same seven images. Early on, when barely
   * anything has been voted for, the RPC fills the remaining slots with the
   * newest wallpapers — the list is never short and never empty.
   */
  async loadTop(): Promise<void> {
    if (this.topLoading()) return;
    this.topLoading.set(true);
    try {
      const { data, error } = await this.sb.client.rpc('starscape_top_wallpapers', {
        p_limit: TOP_LIMIT,
      });
      if (error) return;
      const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
      this.topWallpapers.set(rows.map(mapWallpaperRow));
      // The ranking already carries the counts — no second round trip.
      const counts = new Map(this.counts());
      const mine = new Set(this.mine());
      for (const row of rows) {
        const id = (row['image_id'] as string) ?? '';
        if (!id) continue;
        counts.set(id, Number(row['votes'] ?? 0));
        if (row['voted'] === true) mine.add(id);
        else mine.delete(id);
      }
      this.counts.set(counts);
      this.mine.set(mine);
    } catch {
      /* keep whatever ranking we had; the toggle stays usable */
    } finally {
      this.topLoading.set(false);
    }
  }

  /**
   * Restore the toggle. Signed in, the profile column wins (it is what the
   * desktop app reads); signed out, the local copy is all there is.
   */
  async loadPreference(): Promise<void> {
    const local = readStoredTopOnly();
    if (local !== null) this.topOnly.set(local);
    const user = this.auth.user();
    if (!user) return;
    try {
      const { data, error } = await this.sb.client
        .from('profiles')
        .select('starscape_top_only')
        .eq('id', user.id)
        .maybeSingle();
      if (error || !data) return;
      this.topOnly.set(data['starscape_top_only'] === true);
    } catch {
      /* the local copy (or the default) stands */
    }
  }

  /** Flip the toggle and persist it for whoever this visitor is. */
  async setTopOnly(on: boolean): Promise<void> {
    this.topOnly.set(on);
    writeStoredTopOnly(on);
    if (on) await this.loadTop();
    if (!this.auth.user()) return;
    try {
      const { error } = await this.sb.client.rpc('set_starscape_top_only', { enabled: on });
      if (error) console.warn('[starscape] set_starscape_top_only failed:', error.message);
    } catch {
      /* the toggle still works for this session */
    }
  }
}

function readStoredTopOnly(): boolean | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(TOP_ONLY_STORAGE_KEY);
    return raw === null ? null : raw === '1';
  } catch {
    return null;
  }
}

function writeStoredTopOnly(on: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(TOP_ONLY_STORAGE_KEY, on ? '1' : '0');
  } catch {
    /* private mode / blocked storage — the signed-in path still persists */
  }
}
