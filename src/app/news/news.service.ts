import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { ConsentService } from '../core/consent.service';

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

export type TimeBucket = 'today' | 'week' | 'older';
export interface BucketedNews {
  today: VerseNewsItem[];
  week: VerseNewsItem[];
  older: VerseNewsItem[];
}

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const FILTER_STORAGE_KEY = 'sc-companion.news.channels';
const FAVORITES_STORAGE_KEY = 'sc-companion.news.favorites';
const WATCHED_STORAGE_KEY = 'sc-companion.news.watched';

// How many recent videos the Verse News video rail surfaces at once (#146).
const VIDEO_RAIL_SIZE = 5;

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

const ALL_CHANNELS: NewsChannel[] = ['comm-link', 'spectrum', 'youtube', 'patch'];

@Injectable({ providedIn: 'root' })
export class NewsService {
  private readonly http = inject(HttpClient);
  private readonly consent = inject(ConsentService);
  private readonly endpoint = `${environment.supabase.url}/functions/v1/fetch-verse-news`;

  readonly feed = signal<VerseFeed | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  // Set of active channel filters. Empty set = "Alle" (all channels visible).
  readonly activeChannels = signal<Set<NewsChannel>>(this.loadFilterFromStorage());

  // Saved ("Merken") article ids, persisted in localStorage.
  readonly favoriteIds = signal<Set<string>>(this.loadFavoritesFromStorage());
  // When true, the stream shows only saved items (overrides channel filters).
  readonly favoritesOnly = signal(false);
  // How many saved items are present in the current feed (drives the chip count).
  readonly favoriteCount = computed(() => {
    const f = this.feed();
    const favs = this.favoriteIds();
    return f ? f.news.filter((n) => favs.has(n.id)).length : 0;
  });

  // Videos the user has effectively "watched" (hover-dwell or open), persisted
  // in localStorage so already-seen clips drop out of the rail over time (#146).
  readonly watchedIds = signal<Set<string>>(this.loadWatchedFromStorage());

  // All video items in the current feed, newest first — the pool the Verse News
  // video rail draws its recent-unwatched slice from (#146).
  readonly allVideos = computed<VerseNewsItem[]>(() => {
    const f = this.feed();
    if (!f) return [];
    return f.news
      .filter((n) => n.channel === 'youtube')
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  });

  // Items the user hasn't seen yet (newer than lastSeenAt) buffered for the "X neue Posts"-pill.
  private readonly _lastSeenAt = signal<number>(Date.now());
  readonly pendingCount = computed(() => {
    const f = this.feed();
    if (!f) return 0;
    const cutoff = this._lastSeenAt();
    return f.news.filter((n) => Date.parse(n.publishedAt) > cutoff).length;
  });

  readonly bucketed = computed<BucketedNews>(() => {
    const f = this.feed();
    if (!f) return { today: [], week: [], older: [] };
    if (this.favoritesOnly()) {
      const favs = this.favoriteIds();
      return bucketByTime(f.news.filter((n) => favs.has(n.id)));
    }
    const active = this.activeChannels();
    // In the default "Alle" view videos have their own recent-videos rail
    // (#146), so drop them from the stream to avoid showing each clip twice.
    // Selecting the YouTube channel explicitly still lists every video here.
    const filtered = active.size === 0
      ? f.news.filter((n) => n.channel !== 'youtube')
      : f.news.filter((n) => active.has(n.channel));
    return bucketByTime(filtered);
  });

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private visibilityListener: (() => void) | null = null;
  private refreshSeq = 0;

  async refresh(silent = false): Promise<void> {
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

  acknowledgeNewPosts(): void {
    this._lastSeenAt.set(Date.now());
  }

  toggleChannel(channel: NewsChannel): void {
    const next = new Set(this.activeChannels());
    if (next.has(channel)) next.delete(channel);
    else next.add(channel);
    this.activeChannels.set(next);
    this.persistFilter(next);
  }

  clearFilter(): void {
    this.activeChannels.set(new Set());
    this.persistFilter(new Set());
  }

  channelCount(channel: NewsChannel): number {
    return this.feed()?.news.filter((n) => n.channel === channel).length ?? 0;
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

  /** Switch the stream between "all channels" and "saved only". */
  toggleFavoritesOnly(): void {
    this.favoritesOnly.update((v) => !v);
  }

  isWatched(id: string): boolean {
    return this.watchedIds().has(id);
  }

  /**
   * Mark a video "watched" (hover-dwell threshold reached, or opened). Persisted
   * so it drops out of the recent-videos rail on subsequent loads (#146). Idempotent.
   */
  markWatched(id: string): void {
    const current = this.watchedIds();
    if (current.has(id)) return;
    const next = new Set(current);
    next.add(id);
    this.watchedIds.set(next);
    this.persistWatched(next);
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

  private loadFilterFromStorage(): Set<NewsChannel> {
    if (typeof localStorage === 'undefined') return new Set();
    try {
      const raw = localStorage.getItem(FILTER_STORAGE_KEY);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return new Set();
      return new Set(arr.filter((c): c is NewsChannel => ALL_CHANNELS.includes(c as NewsChannel)));
    } catch {
      return new Set();
    }
  }

  private persistFilter(set: Set<NewsChannel>): void {
    // Preference-category storage is opt-in (#130) — skip until allowed.
    if (!this.consent.preferencesAllowed()) return;
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(Array.from(set)));
    } catch { /* quota / private mode */ }
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

  private loadWatchedFromStorage(): Set<string> {
    if (typeof localStorage === 'undefined') return new Set();
    try {
      const raw = localStorage.getItem(WATCHED_STORAGE_KEY);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === 'string')) : new Set();
    } catch {
      return new Set();
    }
  }

  private persistWatched(set: Set<string>): void {
    // Preference-category storage is opt-in (#130) — skip until allowed.
    if (!this.consent.preferencesAllowed()) return;
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(WATCHED_STORAGE_KEY, JSON.stringify(Array.from(set)));
    } catch { /* quota / private mode */ }
  }
}

/**
 * Pure selector for the Verse News video rail (#146): the newest `limit` videos
 * the user hasn't watched yet. The caller passes a `watched` snapshot rather than
 * the live set so freshly-dwelled clips don't reshuffle out from under the cursor
 * — they only drop on the next load. Falls back to the newest videos when every
 * candidate is already watched, so the rail never renders empty while videos exist.
 */
export function pickRecentVideos(
  videos: VerseNewsItem[],
  watched: Set<string>,
  limit = VIDEO_RAIL_SIZE,
): VerseNewsItem[] {
  const unseen = videos.filter((v) => !watched.has(v.id));
  return (unseen.length > 0 ? unseen : videos).slice(0, limit);
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

function bucketByTime(items: VerseNewsItem[]): BucketedNews {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfWeek = startOfToday - 6 * 24 * 60 * 60 * 1000;
  const out: BucketedNews = { today: [], week: [], older: [] };
  for (const item of items) {
    const t = Date.parse(item.publishedAt);
    if (!Number.isFinite(t)) { out.older.push(item); continue; }
    if (t >= startOfToday) out.today.push(item);
    else if (t >= startOfWeek) out.week.push(item);
    else out.older.push(item);
  }
  return out;
}
