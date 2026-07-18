// --------------------- Wallpaper quality scorer (#133) ---------------------
// Pure, decoder-agnostic content scorer for Starscape wallpapers. The existing
// ingest gate (index.ts) looks only at metadata (content-type, byte size, pixel
// dimensions, aspect) and therefore lets through images that are technically
// "big landscape rasters" but visually broken:
//   - corrupted / truncated JPEGs that render as glitch stripes over a large
//     uniform gray/white block (the decoder fills the undelivered scanlines),
//   - near-blank dark "pattern" backgrounds with no actual artwork subject.
//
// This module inspects the DECODED PIXELS. It is intentionally free of any
// Node- or Deno-specific API so the same file runs on Supabase Edge (Deno) and
// in a Node calibration harness. Decoding (fetch + JPEG/PNG/WebP → RGBA) is the
// caller's responsibility; we only consume raw RGBA.
//
// Design: prefer a few robust, well-separated metrics over many fragile ones.
// Every threshold below was calibrated against the live `verse_wallpapers`
// dataset (see scratchpad calibration report, #133). Thresholds are exported so
// the caller can log/tune them without editing logic.

/** Internal working resolution. We area-average the source down to at most this
 *  many pixels on the long edge before measuring. Small enough to be cheap on
 *  Edge, large enough to preserve texture/edge structure. */
export const WORK_MAX_EDGE = 256;

// Every constant below was calibrated on the live dataset (26 rows, #133).
// Each is deliberately placed with a wide margin to the nearest real-artwork
// image so the filter generalises rather than overfitting these 26 samples.
// The observed safe margins are noted per constant.

/** Grayscale Shannon entropy (bits, 64-bin histogram). Real artwork is rich;
 *  degenerate blank frames collapse toward a single bin. Kept intentionally
 *  LOW: genuinely dark space scenes with a small bright subject score as low as
 *  ~3.6 bits and MUST be kept, so this only trips on near-constant frames.
 *  Below → reject. (nearest real keep observed: 3.61) */
export const MIN_ENTROPY = 2.5;

/** Max per-channel standard deviation (0-255). A flat colour/gray/white swatch
 *  has near-zero spread on every channel. Below → reject.
 *  (nearest real keep observed: 20.2) */
export const MIN_CHANNEL_STD = 10;

/** Share of pixels falling in the single most-common coarse colour bucket
 *  (4 bits/channel = 4096 buckets). Glitch gray/white fills, flat swatches and
 *  text-on-solid title cards pile into one bucket. At/above → reject.
 *  (nearest real keep observed: 0.34) */
export const MAX_DOMINANT_BUCKET_SHARE = 0.6;

/** Fraction of pixels that are near-white (luma > BRIGHT_LUMA). A truncated /
 *  corrupted JPEG frequently paints its undelivered region as a large blown-out
 *  gray/white block; real space wallpapers are dark and never blow out half the
 *  frame. At/above → reject. (nearest real keep observed: 0.058) */
export const MAX_BRIGHT_FRAC = 0.35;
export const BRIGHT_LUMA = 235;

/** Longest run of consecutive rows that are BOTH horizontally near-uniform
 *  (row std < UNIFORM_ROW_STD) AND near-constant in mean across the run
 *  (within BAND_MEAN_TOL) — i.e. one solid colour band — as a fraction of
 *  height. This is the truncated-JPEG gray-bottom / letterbox signature. The
 *  same-colour constraint is what keeps it from firing on a smooth vertical
 *  gradient sky (whose rows are flat but change colour top-to-bottom).
 *  At/above → reject. (nearest real keep observed: ~0.13) */
export const MAX_UNIFORM_ROW_RUN = 0.35;
export const UNIFORM_ROW_STD = 6;
export const BAND_MEAN_TOL = 8;

/** Fraction of pixels with a gradient (Sobel) magnitude above EDGE_MAG_THRESH.
 *  Flat pattern backgrounds have almost no structure; artwork has plenty.
 *  Below → reject. (nearest real keep observed: 0.30) */
export const MIN_EDGE_DENSITY = 0.12;
export const EDGE_MAG_THRESH = 24;

export interface WallpaperScore {
  ok: boolean;
  reasons: string[];
  metrics: Record<string, number>;
}

interface SmallImage {
  gray: Float64Array; // length w*h, 0-255
  r: Float64Array;
  g: Float64Array;
  b: Float64Array;
  w: number;
  h: number;
}

/** Area-average downscale to <= WORK_MAX_EDGE on the long edge. Produces the
 *  grayscale plane plus per-channel planes used by the metrics. */
function downscale(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): SmallImage {
  const scale = Math.min(1, WORK_MAX_EDGE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const r = new Float64Array(w * h);
  const g = new Float64Array(w * h);
  const b = new Float64Array(w * h);
  const gray = new Float64Array(w * h);
  const cnt = new Float64Array(w * h);

  // Scatter each source pixel into its target cell, accumulate, then average.
  for (let sy = 0; sy < height; sy++) {
    const ty = Math.min(h - 1, Math.floor(sy * scale));
    for (let sx = 0; sx < width; sx++) {
      const tx = Math.min(w - 1, Math.floor(sx * scale));
      const si = (sy * width + sx) * 4;
      const ti = ty * w + tx;
      r[ti] += rgba[si];
      g[ti] += rgba[si + 1];
      b[ti] += rgba[si + 2];
      cnt[ti]++;
    }
  }
  for (let i = 0; i < w * h; i++) {
    const c = cnt[i] || 1;
    r[i] /= c;
    g[i] /= c;
    b[i] /= c;
    // Rec. 601 luma.
    gray[i] = 0.299 * r[i] + 0.587 * g[i] + 0.114 * b[i];
  }
  return { gray, r, g, b, w, h };
}

function std(plane: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < plane.length; i++) sum += plane[i];
  const mean = sum / plane.length;
  let v = 0;
  for (let i = 0; i < plane.length; i++) {
    const d = plane[i] - mean;
    v += d * d;
  }
  return Math.sqrt(v / plane.length);
}

function grayEntropy(gray: Float64Array): number {
  const bins = 64;
  const hist = new Float64Array(bins);
  for (let i = 0; i < gray.length; i++) {
    let b = Math.floor((gray[i] / 256) * bins);
    if (b < 0) b = 0;
    else if (b >= bins) b = bins - 1;
    hist[b]++;
  }
  const n = gray.length;
  let e = 0;
  for (let i = 0; i < bins; i++) {
    if (hist[i] === 0) continue;
    const p = hist[i] / n;
    e -= p * Math.log2(p);
  }
  return e;
}

/** Share of pixels in the single most-populated 4-bit-per-channel colour cube. */
function dominantBucketShare(img: SmallImage): number {
  const buckets = new Map<number, number>();
  const n = img.w * img.h;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const key =
      ((img.r[i] >> 4) << 8) | ((img.g[i] >> 4) << 4) | (img.b[i] >> 4);
    const c = (buckets.get(key) || 0) + 1;
    buckets.set(key, c);
    if (c > max) max = c;
  }
  return max / n;
}

/** Fraction of pixels brighter than BRIGHT_LUMA — a blown-out-highlight proxy
 *  for the large gray/white fill blocks that corrupt JPEGs paint. */
function brightFraction(gray: Float64Array): number {
  let n = 0;
  for (let i = 0; i < gray.length; i++) if (gray[i] > BRIGHT_LUMA) n++;
  return n / gray.length;
}

/** Longest consecutive run of near-uniform, near-constant-colour rows (a single
 *  solid band), as a fraction of height. Detects truncated-JPEG bottoms and
 *  letterbox bars while ignoring smooth gradients (whose row means drift). */
function maxUniformRowRun(img: SmallImage): number {
  const { gray, w, h } = img;
  const rowMean = new Float64Array(h);
  const rowFlat = new Uint8Array(h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < w; x++) sum += gray[y * w + x];
    const mean = sum / w;
    rowMean[y] = mean;
    let v = 0;
    for (let x = 0; x < w; x++) {
      const d = gray[y * w + x] - mean;
      v += d * d;
    }
    rowFlat[y] = Math.sqrt(v / w) < UNIFORM_ROW_STD ? 1 : 0;
  }
  let best = 0;
  let run = 0;
  let bandMean = 0;
  for (let y = 0; y < h; y++) {
    if (rowFlat[y] && (run === 0 || Math.abs(rowMean[y] - bandMean) <= BAND_MEAN_TOL)) {
      if (run === 0) bandMean = rowMean[y];
      run++;
      if (run > best) best = run;
    } else {
      run = rowFlat[y] ? 1 : 0;
      bandMean = rowFlat[y] ? rowMean[y] : 0;
    }
  }
  return best / h;
}

/** Fraction of interior pixels whose Sobel gradient magnitude exceeds the
 *  threshold. Cheap texture/structure proxy. */
function edgeDensity(img: SmallImage): number {
  const { gray, w, h } = img;
  if (w < 3 || h < 3) return 1;
  let strong = 0;
  const total = (w - 2) * (h - 2);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const tl = gray[(y - 1) * w + (x - 1)];
      const tc = gray[(y - 1) * w + x];
      const tr = gray[(y - 1) * w + (x + 1)];
      const ml = gray[y * w + (x - 1)];
      const mr = gray[y * w + (x + 1)];
      const bl = gray[(y + 1) * w + (x - 1)];
      const bc = gray[(y + 1) * w + x];
      const br = gray[(y + 1) * w + (x + 1)];
      const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
      const gy = bl + 2 * bc + br - (tl + 2 * tc + tr);
      if (Math.sqrt(gx * gx + gy * gy) > EDGE_MAG_THRESH) strong++;
    }
  }
  return strong / total;
}

/**
 * Score decoded RGBA pixels for wallpaper quality.
 * @param rgba  Row-major RGBA bytes, length >= width*height*4.
 * @param width  Source width in pixels.
 * @param height Source height in pixels.
 */
export function scoreWallpaper(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): WallpaperScore {
  const reasons: string[] = [];
  if (!width || !height || rgba.length < width * height * 4) {
    return {
      ok: false,
      reasons: ['decode-failed'],
      metrics: { width, height, bytes: rgba.length },
    };
  }

  const img = downscale(rgba, width, height);
  const entropy = grayEntropy(img.gray);
  const channelStd = Math.max(std(img.r), std(img.g), std(img.b));
  const dominant = dominantBucketShare(img);
  const bright = brightFraction(img.gray);
  const uniformRun = maxUniformRowRun(img);
  const edges = edgeDensity(img);

  if (entropy < MIN_ENTROPY) reasons.push('low-entropy');
  if (channelStd < MIN_CHANNEL_STD) reasons.push('low-contrast');
  if (dominant >= MAX_DOMINANT_BUCKET_SHARE) reasons.push('dominant-color');
  if (bright >= MAX_BRIGHT_FRAC) reasons.push('blown-fill');
  if (uniformRun >= MAX_UNIFORM_ROW_RUN) reasons.push('uniform-band');
  if (edges < MIN_EDGE_DENSITY) reasons.push('flat-pattern');

  return {
    ok: reasons.length === 0,
    reasons,
    metrics: {
      entropy: round(entropy),
      channelStd: round(channelStd),
      dominantShare: round(dominant),
      brightFrac: round(bright),
      uniformRun: round(uniformRun),
      edgeDensity: round(edges),
      workW: img.w,
      workH: img.h,
    },
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
