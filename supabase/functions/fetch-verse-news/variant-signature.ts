// Crop-tolerant artwork matching for the Starscape gallery.
//
// ---------------------------------------------------------------------------
// Why perceptual-hash.ts was not enough
//
// `perceptual-hash.ts` collapses one scene republished under several CDN ids —
// a 3840px and a 7680px export of the same frame hash within a few bits. It is
// a GLOBAL layout descriptor, so it only works while both images show the same
// frame.
//
// RSI does not publish the same frame. It publishes the same ARTWORK in several
// crops. Measured on the live table (2026-09-03, all 49 rows, covers decoded and
// compared by hand):
//
//   13tm836w1fwe3  1920x1080  16:9    ┐
//   depg5suek1a91  3840x1646  21:9    ├ one Stingray render, three crops,
//   tw49jmj248o8c  1280x720   16:9    ┘ across three different comm-links
//
//   b7qrao0tzzs4l  3840x1646  21:9    ┐ one Frontier Tensions render, the 21:9
//   y7g1jd5dfu5sz  5852x3292  16:9    ┘ carrying the burnt-in title logo
//
//   1gkpdd2d48bxy  1920x1080  16:9    ┐ one Orison window view
//   olr27seq5b4e4  3840x1646  21:9    ┘
//
//   nhnikqjd2gnjg  3840x1646  21:9    ┐ one ridge-line still, one copy framed
//   vxbj4p6p1id9y  3840x1023  3.75:1  ┘ by the comm-link's HUD bars
//
// dHash puts every one of those pairs 100-130 bits apart — further than the
// 48-bit duplicate threshold by a wide margin, and no threshold rescues them:
// the NEAREST unrelated pair in the same table is 78 bits. Cropping shifts every
// cell of the 16x16 grid, so a global hash simply cannot see it. That is the
// bug the gallery still showed: four visibly duplicated tiles out of 49.
//
// ---------------------------------------------------------------------------
// The signal: a tiny thumbnail + a shift search
//
// Two crops of one master share pixels; they differ by a window and a scale.
// So instead of one hash we keep a 20px-tall RGB thumbnail per row and, for a
// pair, slide the smaller one across the larger looking for the alignment that
// explains it:
//
//   * horizontal family — both thumbs are stored height-normalised, so a
//     HORIZONTAL crop (21:9 master -> 16:9 cut-in) leaves the vertical scale
//     untouched: slide along x.
//   * vertical family — resample both to a common WIDTH, which is the scale a
//     VERTICAL crop (16:9 master -> 21:9 letterbox) preserves: slide along y.
//
// Those two cover every RSI crop observed. At each offset we score the overlap
// twice, and BOTH must agree before two rows are called the same artwork:
//
//   1. correlation — zero-mean normalised cross-correlation of the luma. Says
//      "the same shapes are in the same places", and ignores exposure.
//   2. colour distance — mean absolute RGB difference. Says "and it is the same
//      paint", which is what kills the look-alikes correlation alone accepts:
//      two dusk landscapes with a bright sky on the right correlate at 0.87
//      while sitting 41 colour units apart.
//
// Calibrated on all 49 live rows (1176 pairs). Every one of the six true crop
// pairs above passes; the closest false pair is 0.823 / 23.6, and the closest
// false pair on the colour axis alone is 0.774 / 20.8. See the constants.
//
// ---------------------------------------------------------------------------
// Deno + Node, pixels in, text out
//
// Pure and decoder-agnostic, exactly like `perceptual-hash.ts` and
// `wallpaper-quality.ts`: the caller supplies RGBA. The edge function and any
// Node-side backfill therefore classify identically instead of drifting apart.

/**
 * Thumbnail height in pixels. Everything else is derived from it.
 *
 * 20 is not arbitrary. Sweeping 16/20/24/32 against the live table, 16 found
 * all six true pairs but left only 0.002 of correlation headroom to the nearest
 * false pair, and 24/32 lost the HUD-framed pair entirely (its overlay drags
 * the score down as resolution rises). 20 finds all six AND keeps a usable band
 * on both axes.
 */
export const THUMB_HEIGHT = 20;

/** Widest thumbnail we store — 4.8:1, well past any wallpaper-shaped image. */
export const THUMB_MAX_WIDTH = 96;

/** Narrowest thumbnail we store; below this the shift search has nothing to say. */
export const THUMB_MIN_WIDTH = 8;

/** Encoding tag, so a future signature scheme can never be read as this one. */
export const THUMB_FORMAT = 'v1';

/**
 * Minimum luma correlation for "the same artwork".
 *
 * Live separation: the six true pairs score 0.831-0.942; the highest-scoring
 * false pair that also passes the colour gate scores 0.823.
 */
export const SAME_ARTWORK_MIN_CORRELATION = 0.8;

/**
 * Maximum mean absolute RGB difference (0-255) for "the same artwork".
 *
 * Live separation: the six true pairs sit at 7.7-18.3; the nearest false pair
 * that also passes the correlation gate sits at 23.6.
 */
export const SAME_ARTWORK_MAX_COLOUR_DISTANCE = 20;

/**
 * Cheap pre-filter before the shift search: whole-image mean RGB distance.
 *
 * Only ever skips work — a pair further apart than this in average colour has
 * never come close to the real gates (the widest true pair sits at 18.9 by this
 * measure). Keeps the per-crawl regroup linear-ish in practice instead of
 * paying the full search on every one of the n^2 pairs.
 */
export const PREFILTER_MAX_MEAN_COLOUR_DISTANCE = 60;

/**
 * Two aspect ratios count as GENUINELY different when the wider one is more
 * than this factor wider than the narrower one.
 *
 * The maintainer's rule: 21:9 vs 16:9 is a real choice worth keeping, "ganz
 * nah" is not. 1.15 draws that line where it belongs —
 *
 *   16:9 (1.778) vs 21:9 (2.333) -> 1.312  distinct, both kept
 *   16:9 (1.778) vs 3.75:1       -> 2.111  distinct, both kept
 *   16:9 (1.778) vs 16:10 (1.600) -> 1.111 same bucket, only the biggest kept
 *   1.778 vs 1.809 (a 3840x2123)  -> 1.017 same bucket
 *
 * A wallpaper cropped for 16:10 fills a 16:9 screen without anyone noticing; a
 * 16:9 one on an ultrawide does not.
 */
export const RATIO_DISTINCT_FACTOR = 1.15;

/** A decoded thumbnail: `width * height` RGB triplets, row-major. */
export interface VariantThumb {
  readonly width: number;
  readonly height: number;
  /** Length `width * height * 3`, channel order R,G,B. */
  readonly rgb: Uint8Array;
}

/** What a pairwise comparison found at its best alignment. */
export interface ArtworkMatch {
  /** Zero-mean normalised cross-correlation of luma, -1..1. */
  readonly correlation: number;
  /** Mean absolute RGB difference over the overlap, 0..255. */
  readonly colourDistance: number;
}

/**
 * Build the stored signature from decoded RGBA.
 *
 * Returns null when the buffer cannot describe the claimed image, matching
 * `perceptualHash`: a caller that got a short decode stores nothing rather than
 * a misleading signature, and a missing signature never matches anything.
 */
export function buildThumb(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): VariantThumb | null {
  if (!width || !height || rgba.length < width * height * 4) return null;
  const th = THUMB_HEIGHT;
  const tw = clamp(Math.round((th * width) / height), THUMB_MIN_WIDTH, THUMB_MAX_WIDTH);
  const sum = new Float64Array(tw * th * 3);
  const count = new Float64Array(tw * th);
  // Box-average every source pixel into its cell — the same stable-under-
  // rescaling reduction perceptual-hash.ts uses, so a 3840px and a 7680px
  // export of one frame produce the same thumbnail.
  for (let y = 0; y < height; y++) {
    const ty = Math.min(th - 1, Math.floor((y * th) / height));
    for (let x = 0; x < width; x++) {
      const tx = Math.min(tw - 1, Math.floor((x * tw) / width));
      const si = (y * width + x) * 4;
      const di = (ty * tw + tx) * 3;
      sum[di] += rgba[si];
      sum[di + 1] += rgba[si + 1];
      sum[di + 2] += rgba[si + 2];
      count[ty * tw + tx]++;
    }
  }
  const rgb = new Uint8Array(tw * th * 3);
  for (let i = 0; i < tw * th; i++) {
    const c = count[i] || 1;
    rgb[i * 3] = clamp(Math.round(sum[i * 3] / c), 0, 255);
    rgb[i * 3 + 1] = clamp(Math.round(sum[i * 3 + 1] / c), 0, 255);
    rgb[i * 3 + 2] = clamp(Math.round(sum[i * 3 + 2] / c), 0, 255);
  }
  return { width: tw, height: th, rgb };
}

/**
 * `v1:<w>x<h>:<base64 rgb>` — self-describing, so a stored signature can be
 * read back without knowing which THUMB_HEIGHT was in force when it was written.
 */
export function encodeThumb(thumb: VariantThumb): string {
  let binary = '';
  // Chunked: one giant spread argument blows the call stack on large buffers.
  for (let i = 0; i < thumb.rgb.length; i += 1024) {
    binary += String.fromCharCode(...thumb.rgb.subarray(i, i + 1024));
  }
  return `${THUMB_FORMAT}:${thumb.width}x${thumb.height}:${btoa(binary)}`;
}

/** Inverse of {@link encodeThumb}. Anything malformed or foreign answers null. */
export function decodeThumb(encoded: string | null | undefined): VariantThumb | null {
  if (!encoded) return null;
  const m = /^v1:(\d+)x(\d+):([A-Za-z0-9+/=]+)$/.exec(encoded);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!width || !height) return null;
  try {
    const binary = atob(m[3]);
    if (binary.length !== width * height * 3) return null;
    const rgb = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) rgb[i] = binary.charCodeAt(i);
    return { width, height, rgb };
  } catch {
    return null;
  }
}

/** Whole-thumbnail mean RGB distance — the pre-filter, and nothing else. */
export function meanColourDistance(a: VariantThumb, b: VariantThumb): number {
  const ma = meanRgb(a);
  const mb = meanRgb(b);
  return (Math.abs(ma[0] - mb[0]) + Math.abs(ma[1] - mb[1]) + Math.abs(ma[2] - mb[2])) / 3;
}

/**
 * Best alignment of two thumbnails under the two crop families.
 *
 * Reports the scores at the alignment with the highest correlation — not the
 * best of each metric independently, which would let one offset supply the
 * shapes and a different one supply the colours.
 */
export function compareThumbs(a: VariantThumb, b: VariantThumb): ArtworkMatch {
  let best: ArtworkMatch = { correlation: -1, colourDistance: 255 };
  const consider = (m: ArtworkMatch) => {
    if (m.correlation > best.correlation) best = m;
  };

  // Horizontal family — a horizontal crop preserves the full height, and both
  // thumbnails are already height-normalised, so they are at a common scale.
  {
    const h = Math.min(a.height, b.height);
    const A = resample(a, Math.max(1, Math.round((h * a.width) / a.height)), h);
    const B = resample(b, Math.max(1, Math.round((h * b.width) / b.height)), h);
    const [big, small] = A.width >= B.width ? [A, B] : [B, A];
    for (let dx = 0; dx + small.width <= big.width; dx++) {
      consider(scoreOverlap(big, dx, 0, small, small.width, small.height));
    }
  }

  // Vertical family — a vertical crop preserves the full width, so normalise
  // both to one width and slide along y.
  {
    const w = Math.max(THUMB_MIN_WIDTH, Math.round(THUMB_HEIGHT * 2.5));
    const A = resample(a, w, Math.max(1, Math.round((w * a.height) / a.width)));
    const B = resample(b, w, Math.max(1, Math.round((w * b.height) / b.width)));
    const [big, small] = A.height >= B.height ? [A, B] : [B, A];
    for (let dy = 0; dy + small.height <= big.height; dy++) {
      consider(scoreOverlap(big, 0, dy, small, small.width, small.height));
    }
  }
  return best;
}

/**
 * True when two rows show the same artwork in different crops.
 *
 * Conservative by construction, exactly like `isNearDuplicate`: a missing
 * signature answers false, so an image we could not thumbnail is always kept as
 * its own artwork. Over-keeping shows a redundant tile; over-grouping hides a
 * distinct wallpaper. Neither loses data here (grouping only hides), but the
 * visible failure is the cheaper one.
 */
export function isSameArtwork(
  a: VariantThumb | null | undefined,
  b: VariantThumb | null | undefined,
): boolean {
  if (!a || !b) return false;
  if (meanColourDistance(a, b) > PREFILTER_MAX_MEAN_COLOUR_DISTANCE) return false;
  const m = compareThumbs(a, b);
  return (
    m.correlation >= SAME_ARTWORK_MIN_CORRELATION &&
    m.colourDistance <= SAME_ARTWORK_MAX_COLOUR_DISTANCE
  );
}

/** True when two aspect ratios are far enough apart to be worth keeping both. */
export function isDistinctRatio(a: number, b: number): boolean {
  if (!(a > 0) || !(b > 0)) return false;
  return Math.max(a, b) / Math.min(a, b) > RATIO_DISTINCT_FACTOR;
}

/**
 * What a row is within its artwork group.
 *
 * - `single`    — no look-alike found; the row is its own group.
 * - `primary`   — the group's representative: most pixels wins. The gallery and
 *                 the tray app's flat list show exactly the `single` + `primary`
 *                 rows, so one artwork produces one tile.
 * - `ratio`     — a genuinely different aspect ratio of the same artwork. Hidden
 *                 from the flat list, but offered to a client that wants the
 *                 shape closest to its screen.
 * - `duplicate` — same artwork, same shape, fewer pixels. Nothing ever shows it.
 */
export type VariantRole = 'single' | 'primary' | 'ratio' | 'duplicate';

/** One row as the grouper sees it. */
export interface VariantMember {
  readonly imageId: string;
  readonly thumb: VariantThumb | null;
  /** Largest known pixel dimensions of the artwork; null when unread. */
  readonly width: number | null;
  readonly height: number | null;
}

/** Where a row landed. */
export interface VariantAssignment {
  readonly imageId: string;
  readonly group: string;
  readonly role: VariantRole;
}

/**
 * Assign every member a group and a role.
 *
 * Pure and order-independent: members are sorted by image id before clustering
 * and every tie is broken by image id, so re-running over the same rows yields
 * the same answer. That is what makes the crawler's regroup pass idempotent —
 * it can run every crawl and only ever writes when something actually moved.
 *
 * Rows without a signature are never grouped with anything: they come back as
 * their own `single`, which is the safe direction.
 */
export function groupVariants(members: readonly VariantMember[]): VariantAssignment[] {
  const rows = [...members].sort((a, b) => (a.imageId < b.imageId ? -1 : a.imageId > b.imageId ? 1 : 0));
  const parent = rows.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (i: number, j: number) => {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  };

  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].thumb) continue;
    for (let j = i + 1; j < rows.length; j++) {
      if (!rows[j].thumb) continue;
      if (find(i) === find(j)) continue;
      if (isSameArtwork(rows[i].thumb, rows[j].thumb)) union(i, j);
    }
  }

  const clusters = new Map<number, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const root = find(i);
    const list = clusters.get(root);
    if (list) list.push(i);
    else clusters.set(root, [i]);
  }

  const out: VariantAssignment[] = [];
  for (const indices of clusters.values()) {
    const cluster = indices.map((i) => rows[i]);
    if (cluster.length === 1) {
      out.push({ imageId: cluster[0].imageId, group: cluster[0].imageId, role: 'single' });
      continue;
    }
    // Most pixels wins, image id breaks ties — the maintainer's rule, and
    // deterministic so the group key never oscillates between crawls.
    const ranked = [...cluster].sort(
      (a, b) => pixels(b) - pixels(a) || (a.imageId < b.imageId ? -1 : 1),
    );
    const group = ranked[0].imageId;
    const keptRatios: number[] = [aspect(ranked[0])];
    out.push({ imageId: ranked[0].imageId, group, role: 'primary' });
    for (const member of ranked.slice(1)) {
      const a = aspect(member);
      const distinct = a > 0 && keptRatios.every((kept) => isDistinctRatio(a, kept));
      if (distinct) keptRatios.push(a);
      out.push({ imageId: member.imageId, group, role: distinct ? 'ratio' : 'duplicate' });
    }
  }
  return out.sort((a, b) => (a.imageId < b.imageId ? -1 : a.imageId > b.imageId ? 1 : 0));
}

/**
 * Pick the group member whose shape fits a screen best.
 *
 * Used by any client that gets a whole group (the tray app): compare aspect
 * ratios first — a 21:9 wallpaper on a 16:9 screen is cropped or letterboxed no
 * matter how many pixels it has — and let pixel count break a tie.
 */
export function pickForScreen<T extends { width: number | null; height: number | null }>(
  members: readonly T[],
  screenWidth: number,
  screenHeight: number,
): T | null {
  if (members.length === 0) return null;
  if (!(screenWidth > 0) || !(screenHeight > 0)) return members[0];
  const target = screenWidth / screenHeight;
  let best = members[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const m of members) {
    const a = aspect(m);
    // Log distance, so 21:9-on-16:9 and 16:9-on-21:9 are penalised alike.
    const score = a > 0 ? Math.abs(Math.log(a / target)) : Number.POSITIVE_INFINITY;
    const tie = Math.abs(score - bestScore) < 1e-6;
    if (score < bestScore - 1e-6 || (tie && pixels(m) > pixels(best))) {
      best = m;
      bestScore = Math.min(score, bestScore);
    }
  }
  return best;
}

// --------------------------------------------------------------------------

function pixels(m: { width: number | null; height: number | null }): number {
  return (m.width ?? 0) * (m.height ?? 0);
}

function aspect(m: { width: number | null; height: number | null }): number {
  return m.width && m.height ? m.width / m.height : 0;
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

function meanRgb(t: VariantThumb): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  const n = t.width * t.height;
  for (let i = 0; i < n; i++) {
    r += t.rgb[i * 3];
    g += t.rgb[i * 3 + 1];
    b += t.rgb[i * 3 + 2];
  }
  return [r / n, g / n, b / n];
}

/**
 * Box-average when shrinking, nearest neighbour when growing.
 *
 * The "when growing" half is load-bearing: a pure accumulate-and-divide leaves
 * target cells with no source pixel at zero, i.e. black stripes through an
 * upscaled thumbnail, which wrecks both scores.
 */
function resample(t: VariantThumb, tw: number, th: number): VariantThumb {
  if (tw === t.width && th === t.height) return t;
  const rgb = new Uint8Array(tw * th * 3);
  if (tw >= t.width && th >= t.height) {
    for (let y = 0; y < th; y++) {
      const sy = Math.min(t.height - 1, Math.floor((y * t.height) / th));
      for (let x = 0; x < tw; x++) {
        const sx = Math.min(t.width - 1, Math.floor((x * t.width) / tw));
        const si = (sy * t.width + sx) * 3;
        const di = (y * tw + x) * 3;
        rgb[di] = t.rgb[si];
        rgb[di + 1] = t.rgb[si + 1];
        rgb[di + 2] = t.rgb[si + 2];
      }
    }
    return { width: tw, height: th, rgb };
  }
  const sum = new Float64Array(tw * th * 3);
  const count = new Float64Array(tw * th);
  for (let y = 0; y < t.height; y++) {
    const ty = Math.min(th - 1, Math.floor((y * th) / t.height));
    for (let x = 0; x < t.width; x++) {
      const tx = Math.min(tw - 1, Math.floor((x * tw) / t.width));
      const si = (y * t.width + x) * 3;
      const di = (ty * tw + tx) * 3;
      sum[di] += t.rgb[si];
      sum[di + 1] += t.rgb[si + 1];
      sum[di + 2] += t.rgb[si + 2];
      count[ty * tw + tx]++;
    }
  }
  for (let i = 0; i < tw * th; i++) {
    const c = count[i];
    if (c > 0) {
      rgb[i * 3] = Math.round(sum[i * 3] / c);
      rgb[i * 3 + 1] = Math.round(sum[i * 3 + 1] / c);
      rgb[i * 3 + 2] = Math.round(sum[i * 3 + 2] / c);
    } else {
      // Cell no source pixel landed in (mixed shrink/grow) — take the nearest.
      const y = Math.floor(i / tw);
      const x = i - y * tw;
      const sy = Math.min(t.height - 1, Math.floor((y * t.height) / th));
      const sx = Math.min(t.width - 1, Math.floor((x * t.width) / tw));
      const si = (sy * t.width + sx) * 3;
      rgb[i * 3] = t.rgb[si];
      rgb[i * 3 + 1] = t.rgb[si + 1];
      rgb[i * 3 + 2] = t.rgb[si + 2];
    }
  }
  return { width: tw, height: th, rgb };
}

/** Score `small` against the `w x h` window of `big` at (x0, y0). */
function scoreOverlap(
  big: VariantThumb,
  x0: number,
  y0: number,
  small: VariantThumb,
  w: number,
  h: number,
): ArtworkMatch {
  const n = w * h;
  if (n === 0) return { correlation: -1, colourDistance: 255 };
  let ma = 0;
  let mb = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      ma += luma(big.rgb, (y0 + y) * big.width + x0 + x);
      mb += luma(small.rgb, y * w + x);
    }
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  let colour = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ia = (y0 + y) * big.width + x0 + x;
      const ib = y * w + x;
      const va = luma(big.rgb, ia) - ma;
      const vb = luma(small.rgb, ib) - mb;
      num += va * vb;
      da += va * va;
      db += vb * vb;
      colour +=
        (Math.abs(big.rgb[ia * 3] - small.rgb[ib * 3]) +
          Math.abs(big.rgb[ia * 3 + 1] - small.rgb[ib * 3 + 1]) +
          Math.abs(big.rgb[ia * 3 + 2] - small.rgb[ib * 3 + 2])) /
        3;
    }
  }
  const den = Math.sqrt(da * db);
  return { correlation: den > 0 ? num / den : 0, colourDistance: colour / n };
}

/** Rec. 601 luma, matching perceptual-hash.ts and wallpaper-quality.ts. */
function luma(rgb: Uint8Array, i: number): number {
  return 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
}
