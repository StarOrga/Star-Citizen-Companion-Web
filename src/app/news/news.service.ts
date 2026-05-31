import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

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

const ALL_CHANNELS: NewsChannel[] = ['comm-link', 'spectrum', 'youtube', 'patch'];

@Injectable({ providedIn: 'root' })
export class NewsService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.supabase.url}/functions/v1/fetch-verse-news`;

  readonly feed = signal<VerseFeed | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  // Set of active channel filters. Empty set = "Alle" (all channels visible).
  readonly activeChannels = signal<Set<NewsChannel>>(this.loadFilterFromStorage());

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
    const active = this.activeChannels();
    const filtered = active.size === 0 ? f.news : f.news.filter((n) => active.has(n.channel));
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
      this.feed.set(data);
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
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(Array.from(set)));
    } catch { /* quota / private mode */ }
  }
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
