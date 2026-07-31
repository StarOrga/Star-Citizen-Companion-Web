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

/** The registered latest Starscape desktop build (from `starscape_latest_release`). */
export interface StarscapeRelease {
  version: string;
  downloadUrl: string;
  sha256: string | null;
  sizeBytes: number | null;
}

/** Starscape release rings, mirroring the uploader's alpha/beta/stable. */
export type StarscapeRing = 'stable' | 'beta' | 'alpha';

/** What a single ring currently serves. */
export interface StarscapeRingRelease extends StarscapeRelease {
  ring: StarscapeRing;
}

/**
 * Rings each role may download, safest first. The website is where the ring is
 * chosen — the app locks to whatever it was downloaded as and offers no in-app
 * switch — so this list decides what a visitor is even shown. It is a UI gate
 * only: `starscape_release_for_channel` clamps server-side by role as well.
 */
const RINGS_BY_ROLE: Record<string, readonly StarscapeRing[]> = {
  admin: ['stable', 'beta', 'alpha'],
  collaborator: ['stable', 'beta'],
  viewer: ['stable'],
};

export function ringsForRole(role: string | null | undefined): readonly StarscapeRing[] {
  return RINGS_BY_ROLE[role ?? 'viewer'] ?? RINGS_BY_ROLE['viewer'];
}

const PAGE_SIZE = 24;

/** Platform entry shape inside `desktop_releases.platforms` for the win-x64 exe. */
interface PlatformAsset {
  url?: string;
  sha256?: string;
  size_bytes?: number;
}

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

  /**
   * The registered latest Starscape desktop build, or null until loaded / when no
   * row is registered. When null the download CTA falls back to the fixed
   * `wallpaper-app-latest` alias URL, so the button always works.
   */
  readonly desktopRelease = signal<StarscapeRelease | null>(null);

  /**
   * Per-ring builds the visitor may download, in `ringsForRole` order. Empty
   * until resolved (or when no Starscape ring pointer is registered yet), in
   * which case the page falls back to the single never-stale alias link.
   */
  readonly ringReleases = signal<readonly StarscapeRingRelease[]>([]);

  /**
   * Resolve one build per allowed ring through `starscape_release_for_channel`.
   *
   * That RPC is SECURITY DEFINER and clamps the requested ring down to the
   * caller's tier, so asking for `alpha` as a viewer silently answers with the
   * stable row. We therefore drop any row whose `channel` is not the ring we
   * asked for — labelling a stable build "Alpha" would be a lie, and the app
   * derives its locked ring from the downloaded FILENAME, so a mislabelled link
   * would also lock the install to the wrong ring.
   */
  async loadRingReleases(rings: readonly StarscapeRing[]): Promise<void> {
    const resolved = await Promise.all(rings.map((ring) => this.loadRing(ring)));
    this.ringReleases.set(resolved.filter((r): r is StarscapeRingRelease => r !== null));
  }

  private async loadRing(ring: StarscapeRing): Promise<StarscapeRingRelease | null> {
    try {
      const { data, error } = await this.sb.client.rpc('starscape_release_for_channel', {
        p_channel: ring,
      });
      if (error) return null;
      const row = (Array.isArray(data) ? data[0] : data) as
        | { channel?: string; version?: string; platforms?: Record<string, PlatformAsset> }
        | null
        | undefined;
      if (!row?.version || row.channel !== ring) return null;
      const platforms = row.platforms ?? {};
      // The ring-suffixed asset is what carries the ring into the download's
      // filename; the plain key is the pre-ring fallback for older catalog rows.
      const win = platforms[`win-x64-${ring}`] ?? platforms['win-x64'];
      if (!win?.url) return null;
      return {
        ring,
        version: row.version,
        downloadUrl: win.url,
        sha256: win.sha256 ?? null,
        sizeBytes: win.size_bytes ?? null,
      };
    } catch {
      return null; // silent — the alias-URL fallback covers it
    }
  }

  /** Resolve the current Starscape build via the public `starscape_latest_release` RPC. */
  async loadDesktopRelease(): Promise<void> {
    try {
      const { data, error } = await this.sb.client.rpc('starscape_latest_release');
      if (error) return; // silent — CTA keeps the fixed-URL fallback
      const row = (Array.isArray(data) ? data[0] : data) as
        | { version?: string; platforms?: Record<string, PlatformAsset> }
        | null
        | undefined;
      const platforms = row?.platforms ?? {};
      const win = platforms['win-x64'] ?? Object.values(platforms)[0];
      if (!row?.version || !win?.url) return;
      this.desktopRelease.set({
        version: row.version,
        downloadUrl: win.url,
        sha256: win.sha256 ?? null,
        sizeBytes: win.size_bytes ?? null,
      });
    } catch {
      /* ignore — the fixed-URL fallback covers it */
    }
  }

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

  /**
   * A single wallpaper by image id — what a shared `?image=<id>` link resolves.
   * Fetched directly instead of paging the grid until it appears: the target is
   * usually hundreds of rows deep.
   */
  async loadOne(imageId: string): Promise<Wallpaper | null> {
    try {
      const { data, error } = await this.sb.client
        .from('verse_wallpapers')
        .select('image_id, source_url, preview_url, title, series, article_url, published_at')
        .eq('image_id', imageId)
        .maybeSingle();
      if (error || !data) return null;
      return mapRow(data as Record<string, unknown>);
    } catch {
      return null; // a dead link must not break the gallery behind it
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
