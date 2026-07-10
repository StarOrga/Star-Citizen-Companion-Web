import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';

/**
 * Starscape wallpaper gallery data (#133). Reads the metadata rows the
 * fetch-verse-news edge function captures — every image stays on the RSI CDN
 * (hotlinks only, `source.<ext>` = original resolution), we never store bytes.
 */
export interface Wallpaper {
  imageId: string;
  sourceUrl: string; // ORIGINAL full-res CDN url (lightbox + download)
  previewUrl: string; // cover variant (≤1140w) for the grid
  title: string | null;
  series: string | null;
  articleUrl: string; // RSI permalink → attribution
  publishedAt: string | null;
}

const PAGE_SIZE = 24;

@Injectable({ providedIn: 'root' })
export class StarscapeService {
  private readonly sb = inject(SupabaseClientProvider);

  readonly wallpapers = signal<Wallpaper[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly activeSeries = signal<string>('');

  /** Filter chips derived from the loaded pages (no extra distinct query). */
  readonly seriesOptions = computed(() => {
    const set = new Set<string>();
    for (const w of this.wallpapers()) if (w.series) set.add(w.series);
    return [...set].sort((a, b) => a.localeCompare(b));
  });

  readonly hasMore = computed(() => this.wallpapers().length < this.total());

  async load(reset = false): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    const offset = reset ? 0 : this.wallpapers().length;
    try {
      let q = this.sb.client
        .from('verse_wallpapers')
        .select('image_id, source_url, preview_url, title, series, article_url, published_at', {
          count: 'exact',
        })
        .order('published_at', { ascending: false, nullsFirst: false })
        .range(offset, offset + PAGE_SIZE - 1);
      const series = this.activeSeries();
      if (series) q = q.eq('series', series);
      const { data, error, count } = await q;
      if (error) throw new Error(error.message);
      const mapped = (data ?? []).map(mapRow);
      this.wallpapers.set(reset ? mapped : [...this.wallpapers(), ...mapped]);
      this.total.set(count ?? mapped.length);
    } catch (err) {
      this.error.set((err as Error).message ?? 'load failed');
    } finally {
      this.loading.set(false);
    }
  }

  async setSeries(series: string): Promise<void> {
    if (this.activeSeries() === series) return;
    this.activeSeries.set(series);
    await this.load(true);
  }
}

function mapRow(r: Record<string, unknown>): Wallpaper {
  return {
    imageId: (r['image_id'] as string) ?? '',
    sourceUrl: (r['source_url'] as string) ?? '',
    previewUrl: (r['preview_url'] as string) ?? '',
    title: (r['title'] as string | null) ?? null,
    series: (r['series'] as string | null) ?? null,
    articleUrl: (r['article_url'] as string) ?? '',
    publishedAt: (r['published_at'] as string | null) ?? null,
  };
}
