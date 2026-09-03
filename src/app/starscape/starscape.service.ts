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

/**
 * How many rows the one-off series probe reads. Only the `series` column is
 * selected, so this is a few kB even at the ceiling, and the gallery grows by a
 * handful of comm-link images a week — the cap exists purely so the request can
 * never become unbounded, not because it is expected to be reached.
 */
const SERIES_PROBE_LIMIT = 2000;

/**
 * The "which images" dimension of the gallery, as a set of NAMED states.
 *
 * `id` is a stable identity, not a label: `all` and `series:<name>`. The names
 * matter beyond this page — the Starscape desktop app wants to offer the same
 * dimensions in its tray menu, and a menu cannot key off a translated string.
 */
export interface StarscapeSourceOption {
  /** Stable id — `all`, or `series:<series>`. */
  readonly id: string;
  /** The `verse_wallpapers.series` this selects, or null for "every series". */
  readonly series: string | null;
  /** Label straight from the data (an RSI series name), or null when it needs translating. */
  readonly label: string | null;
  /** i18n key for the label, or null when `label` carries it. */
  readonly labelKey: string | null;
}

/** Id of the "no series filter" option. */
export const STARSCAPE_SOURCE_ALL = 'all';

/** Id for one concrete RSI series. */
export function starscapeSourceId(series: string): string {
  return `series:${series}`;
}

/**
 * Hard ceiling for a gallery page request.
 *
 * A plain `await` on the REST call has no deadline: on a flaky mobile
 * connection the socket can stall without ever failing, `loading` stays true
 * and the page keeps painting its twelve placeholder tiles — a screen of
 * grey-blue bars with no error, no retry and no end (admin feedback 4e54ad2c).
 * The abort turns that dead wait into a normal error state the user can act on.
 */
export const LOAD_TIMEOUT_MS = 15_000;

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
  /** The last failure was our own {@link LOAD_TIMEOUT_MS} abort, not a server error. */
  readonly timedOut = signal(false);
  readonly activeSeries = signal<string>('');

  /**
   * Every series the table knows, resolved ONCE from the whole table.
   *
   * This used to be derived from the rows currently on screen, which made the
   * filter rewrite itself on every pick: choosing "Release Info" reloads only
   * Release Info rows, so every other option disappeared from the control. The
   * row then changed width and the Top-N switch beside it visibly jumped
   * (admin feedback 1f78e57f) — and a sibling series was only reachable by
   * going back through "All" first. Empty until the probe answers.
   */
  private readonly seriesCatalogue = signal<readonly string[]>([]);
  /** In-flight/finished probe — the catalogue is fetched at most once per session. */
  private seriesProbe: Promise<void> | null = null;

  /**
   * Filter options, catalogue-backed. Falls back to whatever the loaded pages
   * happen to show if the probe failed, so a dead probe costs completeness, not
   * the filter itself.
   */
  readonly seriesOptions = computed<readonly string[]>(() => {
    const catalogue = this.seriesCatalogue();
    if (catalogue.length > 0) return catalogue;
    const set = new Set<string>();
    for (const w of this.wallpapers()) if (w.series) set.add(w.series);
    return [...set].sort((a, b) => a.localeCompare(b));
  });

  /**
   * The source filter as named states — "all" plus one per series, in a fixed
   * order. Stable across picks by construction, which is what keeps the
   * controls row from reflowing.
   */
  readonly sourceOptions = computed<readonly StarscapeSourceOption[]>(() => [
    { id: STARSCAPE_SOURCE_ALL, series: null, label: null, labelKey: 'starscape.filterAll' },
    ...this.seriesOptions().map((series) => ({
      id: starscapeSourceId(series),
      series,
      label: series,
      labelKey: null,
    })),
  ]);

  /** Id of the currently selected source. */
  readonly activeSource = computed(() => {
    const series = this.activeSeries();
    return series ? starscapeSourceId(series) : STARSCAPE_SOURCE_ALL;
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
    // Independent of the page request and never awaited: the gallery must paint
    // as fast as it always did, the filter just fills in a beat later.
    void this.ensureSeriesCatalogue();
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    this.timedOut.set(false);
    const offset = reset ? 0 : this.wallpapers().length;
    // Deadline for the whole page request — see LOAD_TIMEOUT_MS. `expired` is
    // what distinguishes our abort from a genuine server error, because the
    // client reports both as a plain rejected/errored query.
    const abort = new AbortController();
    let expired = false;
    const deadline = setTimeout(() => {
      expired = true;
      abort.abort();
    }, LOAD_TIMEOUT_MS);
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
      const { data, error, count } = await q.abortSignal(abort.signal);
      if (error) throw new Error(error.message);
      const mapped = (data ?? []).map(mapWallpaperRow);
      this.wallpapers.set(reset ? mapped : [...this.wallpapers(), ...mapped]);
      this.total.set(count ?? mapped.length);
    } catch (err) {
      this.timedOut.set(expired);
      this.error.set(expired ? `timeout after ${LOAD_TIMEOUT_MS / 1000}s` : ((err as Error).message ?? 'load failed'));
    } finally {
      clearTimeout(deadline);
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
      return mapWallpaperRow(data as Record<string, unknown>);
    } catch {
      return null; // a dead link must not break the gallery behind it
    }
  }

  async setSeries(series: string): Promise<void> {
    if (this.activeSeries() === series) return;
    this.activeSeries.set(series);
    await this.load(true);
  }

  /** Pick a source by its stable id (see {@link StarscapeSourceOption}). */
  async setSource(id: string): Promise<void> {
    const option = this.sourceOptions().find((o) => o.id === id);
    if (!option) return; // unknown id — leave the gallery as it is
    await this.setSeries(option.series ?? '');
  }

  /**
   * Read the distinct series once. Deliberately NOT filtered by the active
   * series: the whole point is an option list that does not depend on what is
   * currently shown. One column, capped at {@link SERIES_PROBE_LIMIT} rows.
   */
  private ensureSeriesCatalogue(): Promise<void> {
    this.seriesProbe ??= (async () => {
      try {
        const { data, error } = await this.sb.client
          .from('verse_wallpapers')
          .select('series')
          .not('series', 'is', null)
          .limit(SERIES_PROBE_LIMIT);
        if (error) throw new Error(error.message);
        const set = new Set<string>();
        for (const row of (data ?? []) as { series?: string | null }[]) {
          if (row.series) set.add(row.series);
        }
        this.seriesCatalogue.set([...set].sort((a, b) => a.localeCompare(b)));
      } catch {
        // Silent: `seriesOptions` falls back to the loaded rows, and a retried
        // page load gets a fresh attempt.
        this.seriesProbe = null;
      }
    })();
    return this.seriesProbe;
  }
}

/**
 * Shared row → {@link Wallpaper} mapper. Exported because the Top-N ranking RPC
 * (`starscape_top_wallpapers`, see StarscapeVotesService) projects the exact
 * same columns and must produce the exact same shape.
 */
export function mapWallpaperRow(r: Record<string, unknown>): Wallpaper {
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
