// starscape-summary/image-select.ts
// -----------------------------------------------------------------------
// Chooses the best summary image for a news item from its candidate urls.
//
// Why this exists: an RSI comm-link's first image (its `thumbnail`) is often a
// tall, mostly-TRANSPARENT "title-card" overlay — e.g. "Alpha 4.9 Frontier
// Tensions" ships a 1140×2019 PNG that is 97.6% alpha=0. Inlined into the SVG it
// composites to an empty box. The website's <sc-news-thumb> already dodges this
// with a landscape-ratio heuristic (portrait images are treated as non-title and
// the opaque landscape images are shown instead). We mirror that here.
//
// Selection is deliberately CHEAP — dimensions from the file header plus a
// one-byte alpha-channel flag (PNG colorType), NO pixel decode. An earlier
// version fully inflated + un-filtered the PNG to measure alpha coverage; that
// allocated ~9 MB per transparent title-card and pushed the resvg render over
// the edge-runtime memory limit (WORKER_RESOURCE_LIMIT at ≥1920×1080). The
// portrait-ratio filter alone already rejects the title cards (they are tall),
// and preferring a definitely-opaque candidate (JPEG / non-alpha PNG) avoids the
// rarer landscape-transparent banner — both without decoding a single pixel.
//
// Uses only web-standard globals so this module runs unmodified in BOTH the Deno
// edge runtime and the Node preview/verification harness.
// -----------------------------------------------------------------------

// A landscape image (ratio ≥ this) reads as a usable banner. Mirrors
// MIN_LANDSCAPE_RATIO in src/app/news/news-thumb.component.ts.
const MIN_LANDSCAPE_RATIO = 1.2;
// Cap fetches per item so a pathological images[] list can't stall the render.
const DEFAULT_MAX_CANDIDATES = 4;

export interface ImageMeta {
  width: number;
  height: number;
  /** PNG with an alpha channel (colorType 4/6) — MAY be a transparent overlay. */
  hasAlpha: boolean;
}

export interface FetchedImage {
  bytes: Uint8Array;
  contentType: string;
}

export type ImageFetcher = (url: string) => Promise<FetchedImage | undefined>;

// A comm-link that embeds a clip lists the clip itself among its media urls.
// Those can never become a wallpaper, and each one wasted one of the four
// candidate slots below on a multi-MB download that only ever fails to decode.
// Deny-list: RSI's signed `/i/<sha1>/…` proxy urls carry no extension at all.
const NON_IMAGE_URL = /\.(mp4|webm|mov|m4v|avi|mkv|ogv|ogg|mp3|wav|pdf|zip)(?:[?#]|$)/i;

/** Ordered, deduped candidate urls for an item: thumbnail first, then images[]. */
export function imageCandidates(
  item: { thumbnail?: string; images?: string[] },
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const url of [item.thumbnail, ...(item.images ?? [])]) {
    if (!url || seen.has(url) || NON_IMAGE_URL.test(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function readU32BE(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

/** Width/height of a JPEG by walking to its first Start-Of-Frame marker. */
function jpegSize(b: Uint8Array): { width: number; height: number } {
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) {
      o++;
      continue;
    }
    const marker = b[o + 1];
    // SOF0..SOF15 carry the frame dimensions, except the non-SOF markers
    // C4 (DHT), C8 (JPG), CC (DAC) that share the 0xC. range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (b[o + 5] << 8) | b[o + 6];
      const width = (b[o + 7] << 8) | b[o + 8];
      return { width, height };
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      o += 2; // standalone markers carry no length
      continue;
    }
    const len = (b[o + 2] << 8) | b[o + 3];
    if (len < 2) break;
    o += 2 + len;
  }
  return { width: 0, height: 0 };
}

/** Read just the header: dimensions + whether a PNG carries an alpha channel. */
export function imageMeta(bytes: Uint8Array): ImageMeta {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return { ...jpegSize(bytes), hasAlpha: false }; // JPEG has no alpha
  }
  if (bytes.length >= 26 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    const colorType = bytes[25]; // 4 = gray+alpha, 6 = RGBA
    return {
      width: readU32BE(bytes, 16),
      height: readU32BE(bytes, 20),
      hasAlpha: colorType === 4 || colorType === 6,
    };
  }
  return { width: 0, height: 0, hasAlpha: false };
}

/**
 * Pick the best image for an item. Prefers the first LANDSCAPE + definitely-opaque
 * candidate (JPEG or non-alpha PNG) — returns as soon as one is found, usually the
 * thumbnail on its first try. Falls back to the first landscape candidate (even if
 * it may be transparent), then to whatever loaded. `undefined` means no candidate
 * was usable → the caller falls back to the branded placeholder.
 */
export async function selectBestImage(
  candidates: string[],
  fetchImage: ImageFetcher,
  maxCandidates: number = DEFAULT_MAX_CANDIDATES,
): Promise<(FetchedImage & { url: string }) | undefined> {
  let firstLandscape: (FetchedImage & { url: string }) | undefined;
  let firstLoaded: (FetchedImage & { url: string }) | undefined;
  let tried = 0;
  for (const url of candidates) {
    if (tried >= maxCandidates) break;
    tried++;
    const fetched = await fetchImage(url);
    if (!fetched || !fetched.bytes.length) continue;
    const withUrl = { url, ...fetched };
    firstLoaded ??= withUrl;
    const { width, height, hasAlpha } = imageMeta(fetched.bytes);
    const landscape = height > 0 && width / height >= MIN_LANDSCAPE_RATIO;
    if (landscape && !hasAlpha) return withUrl; // best: opaque banner
    if (landscape) firstLandscape ??= withUrl;
  }
  return firstLandscape ?? firstLoaded;
}
