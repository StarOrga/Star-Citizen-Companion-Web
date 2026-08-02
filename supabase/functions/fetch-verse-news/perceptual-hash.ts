// Near-duplicate detection for the Starscape gallery.
//
// ---------------------------------------------------------------------------
// Why this exists
//
// `verse_wallpapers` dedupes by CDN media id, which only ever catches the SAME
// asset. It cannot see that RSI published one studio scene as several separate
// assets: the Foundation Festival 2026 comm-link contributed EIGHT rows, four of
// which are the same hangar with the same lighting and camera, differing only in
// which armour set the two models wear — two of them wear the SAME yellow suit,
// front view and back view. At the ~320 CSS px a gallery tile renders at, those
// read as the identical photo repeated, all linking to the identical comm-link.
//
// A wallpaper gallery wants distinct artwork, not a product-shot series, so the
// capture path now rejects a candidate whose PICTURE already exists.
//
// ---------------------------------------------------------------------------
// The signal: 16×16 dHash (difference hash)
//
// The image is reduced to a 17×16 luma grid and each cell compared with its
// right-hand neighbour — 256 bits recording where the image gets brighter or
// darker. It keys on layout and structure, survives re-encoding and rescaling,
// and ignores absolute brightness and colour.
//
// Ignoring colour is deliberate and load-bearing. Measured on the live gallery,
// the four Foundation Festival studio renders sit 16–33 bits apart while the
// nearest UNRELATED pair in the whole 35-row table is 98 bits apart. There is no
// threshold that separates the two yellow-suit shots (25) from the yellow-vs-
// white pair (16) — a colour term does not fix that either, because the suits
// occupy too little of the frame to move a colour signature (measured: 2.0 vs
// 4.9 average channel distance, far too close to split). So the whole studio
// scene collapses to one row, which is the right outcome for a wallpaper
// gallery: one artwork per scene.
//
// ---------------------------------------------------------------------------
// Deno + Node, pixels in, hex out
//
// Pure and decoder-agnostic — the caller supplies RGBA, exactly like
// `wallpaper-quality.ts`. That lets the edge function (Deno) and the backfill
// script (Node) classify identically instead of drifting apart.

/** Grid edge. 16×16 comparisons = 256 bits = 64 hex chars. */
export const DHASH_EDGE = 16;

/** Bit length of a hash — also the maximum possible Hamming distance. */
export const DHASH_BITS = DHASH_EDGE * DHASH_EDGE;

/**
 * At or below this Hamming distance two images count as the same picture.
 *
 * Calibrated against all 35 live `verse_wallpapers` rows (2026-08-02): the
 * widest near-duplicate gap measured was 33 bits (the two most dissimilar
 * Foundation Festival studio renders) and the narrowest unrelated gap was 98
 * bits. 48 sits in that empty band with ~15 bits of headroom below and ~50
 * above — the separation is wide enough that the exact value is not delicate.
 */
export const NEAR_DUPLICATE_MAX_DISTANCE = 48;

/**
 * 256-bit dHash of decoded RGBA pixels, as 64 lowercase hex chars.
 *
 * Returns null when the buffer cannot describe the claimed image, so a caller
 * that got a short/garbled decode stores no hash rather than a misleading one.
 */
export function perceptualHash(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): string | null {
  if (!width || !height || rgba.length < width * height * 4) return null;

  const gw = DHASH_EDGE + 1;
  const gh = DHASH_EDGE;
  const sum = new Float64Array(gw * gh);
  const count = new Float64Array(gw * gh);

  // Box-average every source pixel into its grid cell. Cheap, allocation-light
  // and stable under rescaling — which is what makes a 3840px and a 7680px
  // render of one scene hash alike.
  for (let y = 0; y < height; y++) {
    const ty = Math.min(gh - 1, Math.floor((y * gh) / height));
    for (let x = 0; x < width; x++) {
      const tx = Math.min(gw - 1, Math.floor((x * gw) / width));
      const si = (y * width + x) * 4;
      // Rec. 601 luma, matching wallpaper-quality.ts.
      sum[ty * gw + tx] +=
        0.299 * rgba[si] + 0.587 * rgba[si + 1] + 0.114 * rgba[si + 2];
      count[ty * gw + tx]++;
    }
  }

  let hex = '';
  let nibble = 0;
  let bitsInNibble = 0;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < DHASH_EDGE; x++) {
      const l = sum[y * gw + x] / (count[y * gw + x] || 1);
      const r = sum[y * gw + x + 1] / (count[y * gw + x + 1] || 1);
      nibble = (nibble << 1) | (l > r ? 1 : 0);
      if (++bitsInNibble === 4) {
        hex += nibble.toString(16);
        nibble = 0;
        bitsInNibble = 0;
      }
    }
  }
  return hex;
}

/** Popcount table for one byte — the hot path of every pairwise comparison. */
const POPCOUNT = new Uint8Array(256);
for (let i = 0; i < 256; i++) POPCOUNT[i] = (i & 1) + POPCOUNT[i >> 1];

/**
 * Bits that differ between two hex hashes, or null when they are not comparable
 * (malformed, or different lengths — a hash from a future/other scheme).
 * Null means "no verdict": callers must treat it as NOT a duplicate.
 */
export function hammingDistance(a: string, b: string): number | null {
  if (!a || !b || a.length !== b.length || a.length % 2 !== 0) return null;
  let d = 0;
  for (let i = 0; i < a.length; i += 2) {
    const x = Number.parseInt(a.slice(i, i + 2), 16);
    const y = Number.parseInt(b.slice(i, i + 2), 16);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    d += POPCOUNT[x ^ y];
  }
  return d;
}

/**
 * True when two hashes describe the same picture.
 *
 * Conservative by construction: a missing or unreadable hash answers false, so
 * an image we could not hash is always KEPT. Over-keeping shows a redundant
 * tile; over-rejecting silently loses artwork that no later crawl can restore,
 * because a rejected candidate is never written and its article eventually
 * leaves the feed.
 */
export function isNearDuplicate(
  a: string | null | undefined,
  b: string | null | undefined,
  maxDistance = NEAR_DUPLICATE_MAX_DISTANCE,
): boolean {
  if (!a || !b) return false;
  const d = hammingDistance(a, b);
  return d !== null && d <= maxDistance;
}
