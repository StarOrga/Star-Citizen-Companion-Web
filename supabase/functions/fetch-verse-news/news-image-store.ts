// Where cached news images live and how clients reach them (storage plan,
// news-images → R2, 2026-10-03).
//
// New variants are written to Cloudflare R2 under `news-images/<object path>`,
// the same path they had in the Supabase `news-images` bucket. Clients read
// every one of them — new or legacy — through the assets Worker
// (cloudflare/assets-worker) at `<ASSETS_BASE_URL>/news-images/<path>`; the
// Worker streams a key R2 does not hold yet from the public Supabase bucket, so
// the URL is the same wherever the bytes currently sit.
//
// Pure logic only, no Deno or network imports, so the Node tests can load it.

export const NEWS_IMG_BUCKET = 'news-images';

/** Key prefix inside the shared R2 assets bucket. */
export const NEWS_R2_PREFIX = `${NEWS_IMG_BUCKET}/`;

export const DEFAULT_ASSETS_BASE_URL = 'https://sc-assets.sc-assets-worker.workers.dev';

/** `ASSETS_BASE_URL` without trailing slashes, or the workers.dev default. */
export function assetsBaseUrl(get: (k: string) => string | undefined): string {
  const raw = (get('ASSETS_BASE_URL') ?? '').trim().replace(/\/+$/, '');
  return raw || DEFAULT_ASSETS_BASE_URL;
}

/** Public base for cached news images, e.g. `https://…workers.dev/news-images`. */
export function newsImagesPublicBase(assetsBase: string): string {
  return `${assetsBase.replace(/\/+$/, '')}/${NEWS_IMG_BUCKET}`;
}

/** The legacy Supabase public base the first generations of rows were served from. */
export function supabaseNewsImagesBase(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${NEWS_IMG_BUCKET}`;
}

/** R2 key of one stored object (`<hash>/w800.jpg` → `news-images/<hash>/w800.jpg`). */
export function newsR2Key(path: string): string {
  return NEWS_R2_PREFIX + path.replace(/^\/+/, '');
}

/** R2 list prefix that covers every variant of one cache entry. */
export function newsR2FolderPrefix(sourceKey: string): string {
  return `${NEWS_R2_PREFIX}${sourceKey}/`;
}

/**
 * Cache key (first path segment) of a url that already points at one of our
 * public copies, under any of `bases`; null for anything else.
 */
export function cachedSourceKey(url: string, bases: readonly string[]): string | null {
  for (const base of bases) {
    if (!base || !url.startsWith(`${base}/`)) continue;
    const key = url.slice(base.length + 1).split('/')[0];
    return key || null;
  }
  return null;
}
