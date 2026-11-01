import { Injectable, inject, signal } from '@angular/core';
import { logWarn } from '../../../core/log';
import { SupabaseClientProvider } from '../../../core/supabase.client';
import { VISIBLE_VARIANT_ROLES } from '../../../starscape/starscape.service';
import type { VerseDigestItem } from '../../data/verse.models';

/**
 * The newest pictures of the gallery source `/verse/gallery` lists
 * (`verse_wallpapers`, one representative per artwork), as digest-shaped items:
 * the hub's mosaic fills up from them when the digest carries fewer gallery
 * items than the 1 + 6 tiles (`fillGallery`). One read per page load, errors
 * only log — the mosaic then simply shows what the digest had.
 */
@Injectable({ providedIn: 'root' })
export class BriefingGalleryFillService {
  private readonly sb = inject(SupabaseClientProvider);
  readonly items = signal<readonly VerseDigestItem[]>([]);
  private started = false;

  async load(limit = 14): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      const { data, error } = await this.sb.client
        .from('verse_wallpapers')
        .select('image_id, preview_url, title, series, published_at')
        .in('variant_role', VISIBLE_VARIANT_ROLES)
        .order('published_at', { ascending: false, nullsFirst: false })
        .order('image_id', { ascending: false })
        .range(0, limit - 1);
      if (error) throw error;
      this.items.set((data ?? []).flatMap((r, i) => {
        const row = r as Record<string, unknown>;
        const id = String(row['image_id'] ?? '');
        const image = typeof row['preview_url'] === 'string' ? row['preview_url'] : null;
        if (!id || !image) return [];
        return [{
          key: `gallery:${id}`, kind: 'gallery' as const,
          title: String(row['title'] ?? row['series'] ?? ''),
          url: `/verse/gallery?image=${encodeURIComponent(id)}`, summary: null, image,
          at: typeof row['published_at'] === 'string' ? row['published_at'] : null,
          pinned: false, score: 0, rank: 10_000 + i,
        }];
      }));
    } catch (err) {
      this.started = false;
      logWarn('verse.gallery-fill', 'gallery fill failed', err);
    }
  }
}
