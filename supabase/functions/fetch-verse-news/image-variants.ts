// Shared news-image variant pipeline — pure, dependency-free.
//
// Imported by BOTH runtimes so ingest and backfill can never drift apart:
//   - Deno / Supabase Edge  → fetch-verse-news/index.ts (npm:jpeg-js, npm:pngjs)
//   - Node 24              → scripts/news-image-compact.mjs (same npm packages)
// Codecs are injected (`VariantCodecs`) because only the binding differs; every
// sizing / quality / naming decision lives here.
//
// ---------------------------------------------------------------------------
// Why this file exists
//
// The first cache generation stored the upstream bytes verbatim under TWO names
// (`<hash>/post.<ext>` and `<hash>/cover.<ext>`). For most sources those two
// downloads returned the SAME file, so the bucket held a byte-identical twin of
// every image, at full RSI resolution — PNGs up to 9.2 MB. 496 objects added up
// to 809 MB, i.e. essentially the whole 1 GB Supabase quota, to serve tiles that
// are 320 CSS px wide.
//
// The replacement scheme is content-sized instead of source-sized:
//   <hash>/w<width>.<ext>      one object per real pixel width, no twins
// with the ladder derived from the source width (see `planVariantWidths`).
//
// ---------------------------------------------------------------------------
// The url contract (client depends on it — src/app/news/news-image-variants.ts)
//
// The stored ladder is fully derivable from the TOP variant's url, so the feed
// only has to hand out one url per image and the browser can build a truthful
// `srcset` from it:
//
//   rungs(top) = RUNG_WIDTHS.filter(w => w < top).concat(top)
//
// Every rung in that list is guaranteed to exist in the bucket. `top` is the
// source width capped at MAX_VARIANT_WIDTH, so a 1140w RSI cover yields
// 400/800/1140 and a 480w YouTube thumb yields 400/480 — never an upscale, never
// two objects with the same pixels.
//
// `w0` is the reserved escape hatch for sources we cannot decode (GIF/SVG/WebP —
// there is no lightweight pure-JS decoder for those and we will not pull a wasm
// codec into the edge runtime for a handful of inline icons). It means "one
// opaque object, unknown width": the client then emits no srcset at all.
// ---------------------------------------------------------------------------

/**
 * Fixed intermediate rungs, ascending. A tile renders at ~320 CSS px, so 400
 * covers DPR 1 and 800 covers DPR 2; the top rung serves the featured 21:9 hero.
 * MUST stay in sync with `RUNG_WIDTHS` in src/app/news/news-image-variants.ts.
 */
export const RUNG_WIDTHS = [400, 800] as const;

/**
 * Hard ceiling for the largest stored variant. No news surface in the app is
 * wider than the featured hero, and 1600 already covers that at DPR 2 on a
 * 1440p viewport. Anything above is quota spent on pixels nobody paints.
 */
export const MAX_VARIANT_WIDTH = 1600;

/**
 * Images with real transparency have to stay PNG (JPEG has no alpha), and PNG
 * does not compress photographic content well — so they get a tighter ceiling.
 * In practice these are logos and UI overlays, never hero artwork.
 */
export const MAX_ALPHA_VARIANT_WIDTH = 800;

/**
 * Byte budget below which a ladder is never truncated for being "bigger than the
 * source" (see `buildVariants`). Three variants of a hero fit comfortably under
 * this, so the rule only ever bites on sources that were already byte-starved.
 */
export const LADDER_BYTE_FLOOR = 160_000;

/** Reserved width for "single object, width unknown" (undecodable source). */
export const OPAQUE_WIDTH = 0;

/**
 * Above this an undecodable source is dropped rather than mirrored verbatim —
 * the whole point of the rewrite is to stop parking multi-MB blobs in the
 * bucket. Dropping only means the card keeps its upstream RSI url.
 */
export const MAX_PASSTHROUGH_BYTES = 400_000;

/**
 * Refuse to decode anything above this pixel count.
 *
 * Decoding materialises `w * h * 4` bytes of RGBA, and the Supabase edge worker
 * has a few hundred MB total. 16 MP ≈ 64 MB of RGBA, which leaves headroom for
 * the inflate buffers and the encoder; a 3840×2160 RSI original (8.3 MP) passes
 * comfortably. Anything larger is left to the caller as "undecodable" rather
 * than risking an OOM that would take the whole news feed down with it.
 */
export const MAX_DECODE_PIXELS = 16_000_000;

/** JPEG quality per rung: smaller variants can afford (and need) less. */
export function qualityForWidth(width: number): number {
  if (width <= 400) return 76;
  if (width <= 800) return 72;
  return 68;
}

/** Long-lived cache header. Paths are content-sized and never rewritten in place. */
export const VARIANT_CACHE_CONTROL = '31536000, immutable';

export interface RgbaImage {
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8Array;
  width: number;
  height: number;
}

export interface EncodedVariant {
  width: number;
  height: number;
  ext: 'jpg' | 'png';
  contentType: string;
  bytes: Uint8Array;
}

export interface VariantCodecs {
  /** RGBA decode, or null when the format is unsupported / the bytes are broken. */
  decode(bytes: Uint8Array, hint: string): RgbaImage | null;
  encodeJpeg(img: RgbaImage, quality: number): Uint8Array;
  encodePng(img: RgbaImage): Uint8Array;
}

/**
 * The ladder for a source of `sourceWidth` pixels.
 *
 * Truthful by construction: every returned width is a width we can actually
 * produce without upscaling, and the top entry is the largest of them — which is
 * what the client reads back out of the url.
 */
export function planVariantWidths(sourceWidth: number, maxWidth = MAX_VARIANT_WIDTH): number[] {
  const top = Math.max(1, Math.min(Math.round(sourceWidth), maxWidth));
  const out = RUNG_WIDTHS.filter((w) => w < top);
  out.push(top);
  return out;
}

/** Storage object path of one variant. */
export function variantPath(hash: string, width: number, ext: string): string {
  return `${hash}/w${width}.${ext}`;
}

/** Object paths of the whole ladder implied by a top width — what must exist. */
export function expectedVariantPaths(hash: string, topWidth: number, ext: string): string[] {
  if (topWidth === OPAQUE_WIDTH) return [variantPath(hash, OPAQUE_WIDTH, ext)];
  return planVariantWidths(topWidth, topWidth).map((w) => variantPath(hash, w, ext));
}

/** The two object names of the superseded first-generation scheme. */
export function legacyVariantPaths(hash: string, ext: string): string[] {
  return [`${hash}/post.${ext}`, `${hash}/cover.${ext}`];
}

/** True when any pixel is meaningfully translucent (so JPEG would destroy it). */
export function hasTransparency(img: RgbaImage): boolean {
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] < 250) return true;
  }
  return false;
}

/**
 * Area-average ("box") downscale. Cheap, allocation-light and visually far
 * better than nearest-neighbour at the 3–10× reductions we do here; a full
 * Lanczos pass is not worth the CPU inside a request-scoped edge function.
 * Upscaling is never requested (see `planVariantWidths`), so no interpolation
 * path is needed.
 */
export function resizeRgba(src: RgbaImage, dw: number, dh: number): RgbaImage {
  if (dw === src.width && dh === src.height) return src;
  const out = new Uint8Array(dw * dh * 4);
  const xRatio = src.width / dw;
  const yRatio = src.height / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * yRatio);
    const y1 = Math.min(src.height, Math.max(y0 + 1, Math.floor((y + 1) * yRatio)));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * xRatio);
      const x1 = Math.min(src.width, Math.max(x0 + 1, Math.floor((x + 1) * xRatio)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        let i = (sy * src.width + x0) * 4;
        for (let sx = x0; sx < x1; sx++, i += 4) {
          r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2]; a += src.data[i + 3];
          n++;
        }
      }
      const o = (y * dw + x) * 4;
      out[o] = (r / n + 0.5) | 0;
      out[o + 1] = (g / n + 0.5) | 0;
      out[o + 2] = (b / n + 0.5) | 0;
      out[o + 3] = (a / n + 0.5) | 0;
    }
  }
  return { data: out, width: dw, height: dh };
}

/** Height that preserves the source aspect ratio at `width`, at least 1px. */
export function scaledHeight(src: RgbaImage, width: number): number {
  return Math.max(1, Math.round((src.height * width) / src.width));
}

/**
 * Decode → downscale → re-encode one source image into its whole ladder.
 *
 * Returns `null` when the bytes cannot be decoded; the caller decides between
 * the `w0` passthrough and dropping the image (see MAX_PASSTHROUGH_BYTES).
 */
export function buildVariants(
  source: Uint8Array,
  hint: string,
  codecs: VariantCodecs,
  maxPixels = MAX_DECODE_PIXELS,
): EncodedVariant[] | null {
  // Header-only size probe first — refusing BEFORE the allocation is the point.
  const header = readImageSize(source);
  if (header && header.w * header.h > maxPixels) return null;

  const decoded = codecs.decode(source, hint);
  if (!decoded || !decoded.width || !decoded.height) return null;

  const alpha = hasTransparency(decoded);
  const ext: 'jpg' | 'png' = alpha ? 'png' : 'jpg';
  const contentType = alpha ? 'image/png' : 'image/jpeg';
  const ceiling = alpha ? MAX_ALPHA_VARIANT_WIDTH : MAX_VARIANT_WIDTH;

  const out: EncodedVariant[] = [];
  for (const width of planVariantWidths(decoded.width, ceiling)) {
    const height = scaledHeight(decoded, width);
    const img = resizeRgba(decoded, width, height);
    const bytes = alpha ? codecs.encodePng(img) : codecs.encodeJpeg(img, qualityForWidth(width));
    out.push({ width, height, ext, contentType, bytes });
  }

  // Don't transcode ourselves into a bigger bucket. A source that is already
  // byte-starved (a 1920px hero squeezed into 40 KB, say) re-encodes at our
  // quality into MORE bytes than it arrived in — the widest rung is the culprit,
  // because it is the one that reproduces the source resolution and therefore
  // adds no compression, only a different entropy coder.
  //
  // Dropping rungs off the TOP is safe for the url contract: any prefix of a
  // ladder is itself the valid ladder of its own top width, so the client's
  // `rungs(top)` derivation still resolves to objects that exist.
  //
  // The floor keeps this from over-correcting: collapsing a hero all the way to
  // a single 400px object to save 40 KB trades visible sharpness for nothing.
  const budget = Math.max(source.length, LADDER_BYTE_FLOOR);
  while (out.length > 1 && totalVariantBytes(out) > budget) out.pop();
  return out;
}

/**
 * Pixel width/height from the file header only — no decode, no allocation.
 * Supports PNG and JPEG; returns null for WEBP/GIF/unknown, so callers must
 * treat "unknown" as "no verdict" rather than "fails the check".
 *
 * Also used by the wallpaper capture path in index.ts to reject non-wallpaper
 * artwork from a 64 KB ranged GET.
 */
export function readImageSize(b: Uint8Array): { w: number; h: number } | null {
  // PNG: 8-byte signature, then IHDR — width/height big-endian at offset 16/20.
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const w = (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19];
    const h = (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23];
    return w > 0 && h > 0 ? { w, h } : null;
  }
  // JPEG: walk marker segments to the Start-Of-Frame (SOFn) that carries the size.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let p = 2;
    while (p + 9 < b.length) {
      if (b[p] !== 0xff) {
        p++;
        continue;
      }
      let marker = b[p + 1];
      while (marker === 0xff && p + 1 < b.length) {
        p++;
        marker = b[p + 1];
      }
      const len = (b[p + 2] << 8) | b[p + 3];
      // SOF0..SOF15 hold the frame dimensions (DHT/DAC/RSTn are not frame headers).
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        const h = (b[p + 5] << 8) | b[p + 6];
        const w = (b[p + 7] << 8) | b[p + 8];
        return w > 0 && h > 0 ? { w, h } : null;
      }
      if (len <= 0) break;
      p += 2 + len;
    }
  }
  return null;
}

/** Total stored bytes of a ladder — what lands in `verse_image_cache.bytes`. */
export function totalVariantBytes(variants: { bytes: { length: number } }[]): number {
  return variants.reduce((sum, v) => sum + v.bytes.length, 0);
}
