import { toErrorKey } from '../core/describe-error';
import { logWarn } from '../core/log';
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
 * The `verse_wallpapers.variant_role` values the gallery lists.
 *
 * RSI publishes one artwork in several crops — a 21:9 hero, a 16:9 version, a
 * HUD-framed banner — under separate CDN ids, so the gallery showed the same
 * picture two or three times. fetch-verse-news now groups those rows
 * (`variant-signature.ts`) and marks one representative per artwork; the
 * others stay in the table, addressable by a `?image=<id>` share link, but out
 * of the grid. See migration 20260903170000.
 *
 * `single` is the default for every row the grouper has not reached, so a fresh
 * capture is visible immediately and a failed grouping hides nothing.
 */
export const VISIBLE_VARIANT_ROLES = ['single', 'primary'] as const;

/** Postgres `undefined_column`, which PostgREST forwards verbatim. */
const UNDEFINED_COLUMN = '42703';

/** True when a query failed only because the variant columns are not deployed yet. */
function isMissingVariantColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === UNDEFINED_COLUMN || /variant_role/.test(error.message ?? '');
}

/**
 * The "which images" dimension of the gallery: exactly four named views.
 *
 * `id` is a stable identity, not a label (labels come from i18n): the Starscape
 * desktop app offers the same views in its tray menu and cannot key off a
 * translated string. Series is deliberately no filter any more - it stays a
 * badge on the tile.
 */
export type StarscapeFilterId = 'all' | 'newest' | 'top' | 'mine';

export interface StarscapeFilterOption {
  readonly id: StarscapeFilterId;
  /** i18n key of the segment label. */
  readonly labelKey: string;
}

/** The four views, in display order. `all` is the default. */
export const STARSCAPE_FILTERS: readonly StarscapeFilterOption[] = [
  { id: 'all', labelKey: 'starscape.filter.all' },
  { id: 'newest', labelKey: 'starscape.filter.newest' },
  { id: 'top', labelKey: 'starscape.filter.top' },
  { id: 'mine', labelKey: 'starscape.filter.mine' },
];

/** Id of the default view. */
export const STARSCAPE_FILTER_DEFAULT: StarscapeFilterId = 'all';

/** True for an id the service knows (a stale persisted value must not break the page). */
export function isStarscapeFilter(id: string): id is StarscapeFilterId {
  return STARSCAPE_FILTERS.some((f) => f.id === id);
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
  /** i18n key, never raw text. */
  readonly error = signal<string | null>(null);
  /** The last failure was our own {@link LOAD_TIMEOUT_MS} abort, not a server error. */
  readonly timedOut = signal(false);
  /** The active view - see {@link StarscapeFilterId}. */
  readonly filter = signal<StarscapeFilterId>(STARSCAPE_FILTER_DEFAULT);

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
    this.timedOut.set(false);
    const offset = reset ? 0 : this.wallpapers().length;
    const filter = this.filter();
    // Deadline for the whole page request - see LOAD_TIMEOUT_MS. `expired` is
    // what distinguishes our abort from a genuine server error, because the
    // client reports both as a plain rejected/errored query.
    const abort = new AbortController();
    let expired = false;
    const deadline = setTimeout(() => {
      expired = true;
      abort.abort();
    }, LOAD_TIMEOUT_MS);
    const page = (hideVariants: boolean) => {
      let q = this.sb.client
        .from('verse_wallpapers')
        .select('image_id, source_url, preview_url, title, series, article_url, published_at', {
          count: 'exact',
        });
      if (hideVariants) q = q.in('variant_role', VISIBLE_VARIANT_ROLES);
      q = q
        .order('published_at', { ascending: false, nullsFirst: false })
        // Tiebreaker, and it is not cosmetic: a comm-link contributes up to six
        // rows sharing one `published_at` to the second, and Postgres gives no
        // stable order inside a tie. With plain `range()` paging, that let one
        // row come back on page 1 AND page 2 while another never appeared -
        // a duplicate tile with no duplicate data behind it.
        .order('image_id', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      return q.abortSignal(abort.signal);
    };
    try {
      let mapped: Wallpaper[];
      let total: number;
      if (filter === 'all') {
        let { data, error, count } = await page(true);
        // Deploy-order guard: the bundle reaches visitors the moment Vercel
        // finishes, but migration 20260903170000 is applied out of band. Without
        // this the gallery would answer 42703 ("column variant_role does not
        // exist") and show an error page for the whole gap. Costs one retry, only
        // ever on that specific error, and disappears once the column is there.
        if (error && isMissingVariantColumn(error)) {
          logWarn('starscape', 'variant columns not deployed yet, listing every row');
          ({ data, error, count } = await page(false));
        }
        if (error) throw error;
        mapped = (data ?? []).map(mapWallpaperRow);
        total = count ?? mapped.length;
      } else {
        // Newest / Community Top / My votes: ranked or per-user, so server-side
        // (starscape_gallery_page aggregates the self-read-only wallpaper_votes).
        const { data, error } = await this.sb.client
          .rpc('starscape_gallery_page', {
            p_filter: filter,
            p_limit: PAGE_SIZE,
            p_offset: offset,
          })
          .abortSignal(abort.signal);
        if (error) throw error;
        const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
        mapped = rows.map(mapWallpaperRow);
        total = rows.length > 0 ? Number(rows[0]['total_count'] ?? mapped.length) : offset;
      }
      // The user switched view while this page was in flight: it belongs to a
      // list that is no longer on screen.
      if (filter !== this.filter()) return;
      this.wallpapers.set(reset ? mapped : [...this.wallpapers(), ...mapped]);
      this.total.set(total);
    } catch (err) {
      this.timedOut.set(expired);
      const key = toErrorKey('starscape', 'load', err, { expired });
      this.error.set(expired ? 'errors.timeout' : key);
    } finally {
      clearTimeout(deadline);
      this.loading.set(false);
    }
  }

  /**
   * A single wallpaper by image id — what a shared `?image=<id>` link resolves.
   * Fetched directly instead of paging the grid until it appears: the target is
   * usually hundreds of rows deep.
   *
   * Deliberately NOT filtered by `variant_role`: a link shared before its row
   * became a hidden crop variant must still open the picture someone sent.
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

  /**
   * Switch the view and reload from the top. A pick that arrives while a page
   * request is still running waits for it, then loads - otherwise `load()`'s
   * in-flight guard would swallow the pick and leave the old list on screen.
   */
  async setFilter(id: StarscapeFilterId): Promise<void> {
    if (this.filter() === id) return;
    this.filter.set(id);
    // Drop the old list at once: tiles of another view must not linger (and
    // be appended to) while the new one loads.
    this.wallpapers.set([]);
    this.total.set(0);
    while (this.loading()) await new Promise((r) => setTimeout(r, 50));
    if (this.filter() !== id) return;
    await this.load(true);
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
