import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface VerseNewsItem {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  channel: 'comm-link' | 'spectrum' | 'status' | 'patch';
  summary?: string;
  thumbnail?: string;
  category?: string;
}

export interface VerseStatus {
  overall: 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'maintenance' | 'unknown';
  services: Array<{ name: string; status: string; updated?: string }>;
  updatedAt: string;
}

export interface VerseFeed {
  status: VerseStatus | null;
  news: VerseNewsItem[];
  fetchedAt: string;
}

@Injectable({ providedIn: 'root' })
export class NewsService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.supabase.url}/functions/v1/fetch-verse-news`;

  readonly feed = signal<VerseFeed | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const data = await firstValueFrom(this.http.get<VerseFeed>(this.endpoint));
      this.feed.set(data);
    } catch (err) {
      this.error.set((err as Error).message ?? 'Unknown error');
    } finally {
      this.loading.set(false);
    }
  }
}
