import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { ConsentService } from '../core/consent.service';
import { PatchLineGroup, groupPatchNotes } from './patch-notes';
import { BuildVerdict, buildStream, buildVerdict, pickStage } from './news-stage';

export type NewsChannel = 'comm-link' | 'spectrum' | 'status' | 'patch' | 'youtube';
export type StatusLevel = 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'maintenance' | 'unknown';

export interface VerseNewsItem {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  channel: NewsChannel;
  summary?: string;
  thumbnail?: string;
  images?: string[];
  category?: string;
  source: 'comm-link' | 'patch-notes' | 'spectrum' | 'youtube' | 'status';
}

export interface VerseStatusComponent {
  name: string;
  status: StatusLevel;
}

export interface VerseStatus {
  overall: StatusLevel;
  label: string;
  components: VerseStatusComponent[];
  updatedAt: string;
}

/** Severity order for comparing two status levels (higher = worse). */
const STATUS_PRIORITY: Record<StatusLevel, number> = {
  unknown: -1,
  operational: 0,
  maintenance: 1,
  degraded: 2,
  partial_outage: 3,
  major_outage: 4,
};

/**
 * Playability-aware headline status. RSI's Statuspage overall indicator only
 * reflects declared incidents and stays "operational" during a scheduled
 * Persistent Universe maintenance — which would wrongly read as "Playable"
 * (feedback 740d31cb). The headline chip is about whether the game can be
 * played, so escalate it to at least the Persistent Universe component's level.
 * Other services' maintenance (website, platform) does not flip the headline;
 * it stays visible in the per-service drill-down.
 */
export function effectivePlayability(st: VerseStatus): StatusLevel {
  const pu = st.components.find((c) => /persistent universe/i.test(c.name));
  if (!pu) return st.overall;
  return STATUS_PRIORITY[pu.status] > STATUS_PRIORITY[st.overall] ? pu.status : st.overall;
}

export interface VerseFeed {
  status: VerseStatus | null;
  news: VerseNewsItem[];
  fetchedAt: string;
}

/** Background refresh cadence for the feed. */
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const FAVORITES_STORAGE_KEY = 'sc-companion.news.favorites';

/**
 * Retention window for VIDEOS in Verse News (feedback e7082310): only today,
 * this week and this month are kept. The rule is enforced server-side — the
 * ingest neither serves nor caches older clips and deletes their cached
 * thumbnails — and re-applied here on every payload, because the service
 * worker serves the feed from cache when offline and that copy can be far
 * older than the window (its thumbnails are already gone from storage).
 *
 * Rolling 31 days, mirroring supabase/functions/fetch-verse-news/video-retention.ts
 * — keep the two in sync.
 */
export const VIDEO_RETENTION_DAYS = 31;

@Injectable({ providedIn: 'root' })
export class NewsService {
  private readonly http = inject(HttpClient);
  private readonly consent = inject(ConsentService);
  private readonly endpoint = `${environment.supabase.url}/functions/v1/fetch-verse-news`;

  readonly feed = signal<VerseFeed | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  // Saved ("Gemerkt") article ids, persisted in localStorage.
  readonly favoriteIds = signal<Set<string>>(this.loadFavoritesFromStorage());
  // When true, the stream shows only saved items (overrides channel filters).
  readonly favoritesOnly = signal(false);

  /**
   * Patch notes grouped by main patch line, newest line first (44e90e30).
   * Derived from the titles, so a brand-new line (4.10, 5.0, …) groups itself.
   */
  readonly patchLines = computed<PatchLineGroup[]>(() => groupPatchNotes(this.feed()?.news ?? []));

  /** How many patch notes the feed carries — the count on the patch board. */
  readonly patchCount = computed(
    () => this.feed()?.news.filter((n) => n.channel === 'patch').length ?? 0,
  );

  /**
   * The one item on the stage (2026-08-20 rethink, design Ⓐ).
   *
   * Scored over the WHOLE editorial pool rather than taken from a time bucket:
   * the old page defined its hero as "first item of Today" and therefore had no
   * hero at all on any day without a fresh article — which, measured in
   * production, was the normal case. See `news-stage.ts`.
   */
  readonly stage = computed<VerseNewsItem | null>(
    () => pickStage(this.feed()?.news ?? [], Date.now()),
  );

  /**
   * The flat, reverse-chronological stream BEFORE the saved-only filter. Both
   * halves of the stream toggle count against this same base, so "Gemerkt 3"
   * can never open a list holding two items (the staged article and the patch
   * notes are not part of the stream, and were double-counted before).
   */
  private readonly streamAll = computed<VerseNewsItem[]>(
    () => buildStream(this.feed()?.news ?? [], this.stage()),
  );

  /** Everything in the stream — the left half of the toggle. */
  readonly streamCount = computed(() => this.streamAll().length);

  /** The saved slice of the stream — the right half of the toggle. */
  readonly favoriteCount = computed(() => {
    const favs = this.favoriteIds();
    return this.streamAll().filter((n) => favs.has(n.id)).length;
  });

  /**
   * The flat, reverse-chronological stream — everything editorial except the
   * item already on the stage. Honours the "saved only" toggle.
   */
  readonly stream = computed<VerseNewsItem[]>(() => {
    const items = this.streamAll();
    if (!this.favoritesOnly()) return items;
    const favs = this.favoriteIds();
    return items.filter((n) => favs.has(n.id));
  });

  /** Which build is live, and when the next one is due — the verdict card. */
  readonly verdict = computed<BuildVerdict>(() => buildVerdict(this.patchLines(), Date.now()));

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private visibilityListener: (() => void) | null = null;
  private refreshSeq = 0;
  private inFlight: Promise<void> | null = null;

  /**
   * Load the feed. Concurrent callers share one request: since the playability
   * chip moved into the app header (feedback #79) there are two independent
   * consumers of this feed, and on a cold start of /news both ask for it in the
   * same tick. Coalescing keeps that a single fetch — the second caller still
   * gets a promise that resolves when the data is in.
   */
  refresh(silent = false): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const run = this.fetchFeed(silent);
    this.inFlight = run;
    return run.finally(() => {
      if (this.inFlight === run) this.inFlight = null;
    });
  }

  private async fetchFeed(silent: boolean): Promise<void> {
    const seq = ++this.refreshSeq;
    if (!silent) this.loading.set(true);
    this.error.set(null);
    try {
      const data = await firstValueFrom(this.http.get<VerseFeed>(this.endpoint));
      if (seq !== this.refreshSeq) return;
      // Drop videos that fell out of the retention window before anything sees
      // them, so counts, buckets, the rail and deep-links all agree (e7082310).
      this.feed.set({ ...data, news: pruneExpiredVideos(data?.news ?? []) });
    } catch (err) {
      if (seq !== this.refreshSeq) return;
      this.error.set((err as Error).message ?? 'Unknown error');
    } finally {
      if (seq === this.refreshSeq) this.loading.set(false);
    }
  }

  /** Look up a feed item by id (deep-link / share target). */
  itemById(id: string): VerseNewsItem | undefined {
    return this.feed()?.news.find((n) => n.id === id);
  }

  isFavorite(id: string): boolean {
    return this.favoriteIds().has(id);
  }

  /** Toggle "Merken" for an article; persisted across sessions. */
  toggleFavorite(id: string): void {
    const next = new Set(this.favoriteIds());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.favoriteIds.set(next);
    this.persistFavorites(next);
    // Leaving the favorites view empty would strand the user on a blank stream.
    if (this.favoritesOnly() && next.size === 0) this.favoritesOnly.set(false);
  }

  /**
   * Switch the stream between "everything" and "saved only".
   *
   * Set, not toggled: the stream header is a segmented control that STATES
   * which half is active, so pressing the active half again must be a no-op —
   * a toggle there would flip it and contradict its own `aria-pressed`.
   */
  setFavoritesOnly(only: boolean): void {
    this.favoritesOnly.set(only);
  }

  startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
        this.refresh(true);
      }
    }, POLL_INTERVAL_MS);
    if (typeof document !== 'undefined') {
      this.visibilityListener = () => {
        if (document.visibilityState === 'visible') this.refresh(true);
      };
      document.addEventListener('visibilitychange', this.visibilityListener);
    }
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.visibilityListener && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityListener);
      this.visibilityListener = null;
    }
  }

  private loadFavoritesFromStorage(): Set<string> {
    if (typeof localStorage === 'undefined') return new Set();
    try {
      const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === 'string')) : new Set();
    } catch {
      return new Set();
    }
  }

  private persistFavorites(set: Set<string>): void {
    // Preference-category storage is opt-in (#130) — skip until allowed.
    if (!this.consent.preferencesAllowed()) return;
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(Array.from(set)));
    } catch { /* quota / private mode */ }
  }

}

/**
 * Remove videos older than the retention window (e7082310). Non-video news is
 * deliberately untouched — the window is a video-storage rule, not a feed rule.
 * A video with an unparseable date is dropped: it is undatable, so the server
 * cannot have kept its thumbnail either.
 */
export function pruneExpiredVideos(news: VerseNewsItem[], now = Date.now()): VerseNewsItem[] {
  const cutoff = now - VIDEO_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return news.filter((n) => {
    if (n.channel !== 'youtube') return true;
    const t = Date.parse(n.publishedAt);
    return Number.isFinite(t) && t >= cutoff;
  });
}

