// starscape-summary/image-select.ts
// -----------------------------------------------------------------------
// Chooses the best summary image for a news item from its candidate urls.
//
// Why this exists: an RSI comm-link's first image (its `thumbnail`) is often a
// tall, mostly-TRANSPARENT "title-card" overlay — e.g. "Alpha 4.9 Frontier
// Tensions" ships a 1140×2019 PNG that is 97.6% alpha=0. Inlined into the SVG it
// composites to an empty box. The website's <sc-news-thumb> already dodges this
// with a landscape-ratio heuristic (portrait images are treated as non-title and
// the opaque landscape images are shown instead). We mirror that here: pick the
// first candidate that is OPAQUE and LANDSCAPE (ratio ≥ 1.2), else the first
// opaque one, else whatever loaded, else nothing (→ branded placeholder).
//
// Uses only web-standard globals (fetch, DecompressionStream, ReadableStream,
// Response) so this module runs unmodified in BOTH the Deno edge runtime and the
// Node preview/verification harness — the same portability contract summary-svg.ts
// relies on.
// -----------------------------------------------------------------------

// A landscape image (ratio ≥ this) reads as a usable banner. Mirrors
// MIN_LANDSCAPE_RATIO in src/app/news/news-thumb.component.ts.
const MIN_LANDSCAPE_RATIO = 1.2;
// Alpha below this counts as transparent when measuring opaque coverage.
const ALPHA_OPAQUE_MIN = 16;
// A PNG with fewer than this fraction of opaque pixels is rejected as an overlay.
const MIN_OPAQUE_COVERAGE = 0.5;
// Cap fetches per item so a pathological images[] list can't stall the render.
const DEFAULT_MAX_CANDIDATES = 4;

export interface ImageMeta {
  width: number;
  height: number;
  opaque: boolean;
}

export interface FetchedImage {
  bytes: Uint8Array;
  contentType: string;
}

export type ImageFetcher = (url: string) => Promise<FetchedImage | undefined>;

/** Ordered, deduped candidate urls for an item: thumbnail first, then images[]. */
export function imageCandidates(
  item: { thumbnail?: string; images?: string[] },
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const url of [item.thumbnail, ...(item.images ?? [])]) {
    if (!url || seen.has(url)) continue;
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

/** Inflate a zlib stream (PNG IDAT) with the platform DecompressionStream. */
async function inflateZlib(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const src = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  const ab = await new Response(src.pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(ab);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** In-place reverse of a PNG scanline filter (types 0–4), given the row above. */
function unfilterRow(cur: Uint8Array, prev: Uint8Array, filter: number, bpp: number): void {
  const n = cur.length;
  switch (filter) {
    case 1: // Sub
      for (let i = bpp; i < n; i++) cur[i] = (cur[i] + cur[i - bpp]) & 0xff;
      break;
    case 2: // Up
      for (let i = 0; i < n; i++) cur[i] = (cur[i] + prev[i]) & 0xff;
      break;
    case 3: // Average
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0;
        cur[i] = (cur[i] + ((a + prev[i]) >> 1)) & 0xff;
      }
      break;
    case 4: // Paeth
      for (let i = 0; i < n; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0;
        const c = i >= bpp ? prev[i - bpp] : 0;
        cur[i] = (cur[i] + paeth(a, prev[i], c)) & 0xff;
      }
      break;
    default: // 0 = None
      break;
  }
}

/** Concatenate all IDAT chunk payloads of a PNG. */
function collectIdat(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let o = 8;
  while (o + 8 <= b.length) {
    const len = readU32BE(b, o);
    const type = String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
    const start = o + 8;
    if (type === 'IDAT') parts.push(b.subarray(start, start + len));
    if (type === 'IEND') break;
    o = start + len + 4; // data + CRC
  }
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Fraction of pixels with alpha ≥ ALPHA_OPAQUE_MIN for an 8-bit gray+alpha (4) or
 * RGBA (6) PNG. Rows are fully un-filtered (later filters reference the row above)
 * but only a sparse grid is sampled to bound work. Returns 1 (treat as opaque) for
 * anything we can't cheaply decode — interlaced, non-8-bit, or a decode error — so
 * a valid-but-unusual image is never wrongly rejected.
 */
async function pngOpaqueCoverage(b: Uint8Array, width: number, height: number, colorType: number): Promise<number> {
  try {
    const bitDepth = b[24];
    const interlace = b[28];
    if (bitDepth !== 8 || interlace !== 0 || width <= 0 || height <= 0) return 1;
    const raw = await inflateZlib(collectIdat(b));
    const bpp = colorType === 6 ? 4 : 2; // RGBA vs gray+alpha
    const alphaIdx = colorType === 6 ? 3 : 1;
    const stride = width * bpp;
    if (raw.length < (stride + 1) * height) return 1; // truncated — don't over-reject

    const prev = new Uint8Array(stride);
    const cur = new Uint8Array(stride);
    let pos = 0;
    let sampled = 0;
    let opaque = 0;
    const rowStep = Math.max(1, Math.floor(height / 64));
    const colStep = Math.max(1, Math.floor(width / 64));
    for (let y = 0; y < height; y++) {
      const filter = raw[pos++];
      cur.set(raw.subarray(pos, pos + stride));
      pos += stride;
      unfilterRow(cur, prev, filter, bpp);
      if (y % rowStep === 0) {
        for (let x = 0; x < width; x += colStep) {
          sampled++;
          if (cur[x * bpp + alphaIdx] >= ALPHA_OPAQUE_MIN) opaque++;
        }
      }
      prev.set(cur);
    }
    return sampled ? opaque / sampled : 1;
  } catch {
    return 1;
  }
}

/** Decode just enough of an image to know its size and whether it is opaque. */
export async function imageMeta(bytes: Uint8Array, _contentType: string): Promise<ImageMeta> {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return { ...jpegSize(bytes), opaque: true };
  }
  if (bytes.length >= 33 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    const width = readU32BE(bytes, 16);
    const height = readU32BE(bytes, 20);
    const colorType = bytes[25];
    const opaque = colorType === 4 || colorType === 6
      ? (await pngOpaqueCoverage(bytes, width, height, colorType)) >= MIN_OPAQUE_COVERAGE
      : true; // grayscale / RGB / palette carry no alpha channel
    return { width, height, opaque };
  }
  // Unknown-but-valid format: keep it as a usable opaque fallback (no ratio).
  return { width: 0, height: 0, opaque: true };
}

/**
 * Pick the best image for an item. Prefers the first OPAQUE + LANDSCAPE candidate
 * (returns as soon as one is found — usually the thumbnail on its first try),
 * then the first opaque candidate, then anything that loaded. `undefined` means
 * no candidate was usable → the caller falls back to the branded placeholder.
 */
export async function selectBestImage(
  candidates: string[],
  fetchImage: ImageFetcher,
  maxCandidates: number = DEFAULT_MAX_CANDIDATES,
): Promise<(FetchedImage & { url: string }) | undefined> {
  let firstOpaque: (FetchedImage & { url: string }) | undefined;
  let firstAny: (FetchedImage & { url: string }) | undefined;
  let tried = 0;
  for (const url of candidates) {
    if (tried >= maxCandidates) break;
    tried++;
    const fetched = await fetchImage(url);
    if (!fetched || !fetched.bytes.length) continue;
    const withUrl = { url, ...fetched };
    firstAny ??= withUrl;
    const meta = await imageMeta(fetched.bytes, fetched.contentType);
    if (meta.opaque) {
      firstOpaque ??= withUrl;
      const ratio = meta.height > 0 ? meta.width / meta.height : 0;
      if (ratio >= MIN_LANDSCAPE_RATIO) return withUrl;
    }
  }
  return firstOpaque ?? firstAny;
}
