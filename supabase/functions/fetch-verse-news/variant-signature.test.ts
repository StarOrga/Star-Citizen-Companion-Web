// Tests for variant-signature.ts. Pure logic, no Deno APIs, so it runs under
// both `deno test` (Edge parity) and Node 24's built-in runner + type stripping:
//   node --test variant-signature.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RATIO_DISTINCT_FACTOR,
  SAME_ARTWORK_MAX_COLOUR_DISTANCE,
  SAME_ARTWORK_MIN_CORRELATION,
  THUMB_HEIGHT,
  THUMB_MAX_WIDTH,
  buildThumb,
  compareThumbs,
  decodeThumb,
  encodeThumb,
  groupVariants,
  isDistinctRatio,
  isSameArtwork,
  pickForScreen,
} from './variant-signature.ts';

/** Synthesise RGBA from a pixel function — a stand-in for a decoded image. */
function render(
  w: number,
  h: number,
  px: (x: number, y: number) => [number, number, number],
): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y);
      const i = (y * w + x) * 4;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
    }
  }
  return out;
}

/**
 * A deterministic "master render" in MASTER coordinates (0..1 on both axes),
 * with enough structure and colour that a crop of it is recognisable: a warm
 * horizon, a dark ridge and a bright blob left of centre.
 */
function master(u: number, v: number): [number, number, number] {
  const ridge = v > 0.62 + 0.08 * Math.sin(u * 9) ? 0.25 : 1;
  const blob = Math.hypot(u - 0.32, v - 0.4) < 0.1 ? 70 : 0;
  const sky = 40 + 170 * u;
  return [
    Math.min(255, (sky + blob) * ridge),
    Math.min(255, (sky * 0.7 + blob) * ridge),
    Math.min(255, (sky * 0.45 + 30 + blob) * ridge),
  ];
}

/** Render a rectangular window of the master at a given output resolution. */
function crop(
  w: number,
  h: number,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
): { rgba: Uint8Array; w: number; h: number } {
  return {
    rgba: render(w, h, (x, y) => master(u0 + ((u1 - u0) * x) / w, v0 + ((v1 - v0) * y) / h)),
    w,
    h,
  };
}

const thumbOf = (c: { rgba: Uint8Array; w: number; h: number }) => {
  const t = buildThumb(c.rgba, c.w, c.h);
  assert.ok(t, 'thumbnail should build');
  return t;
};

// --------------------------------------------------------------------------
// Thumbnail

test('thumbnail is height-normalised and aspect-preserving', () => {
  const t = thumbOf(crop(800, 450, 0, 0, 1, 1)); // 16:9
  assert.equal(t.height, THUMB_HEIGHT);
  assert.equal(t.width, Math.round(THUMB_HEIGHT * (16 / 9)));
  assert.equal(t.rgb.length, t.width * t.height * 3);
});

test('an absurdly wide banner is clamped, not stored at full width', () => {
  const t = thumbOf(crop(4000, 200, 0, 0, 1, 1)); // 20:1
  assert.equal(t.width, THUMB_MAX_WIDTH);
});

test('a short or garbled buffer yields no thumbnail', () => {
  assert.equal(buildThumb(new Uint8Array(10), 100, 100), null);
  assert.equal(buildThumb(new Uint8Array(400), 0, 0), null);
});

test('encode/decode round-trips byte for byte', () => {
  const t = thumbOf(crop(640, 360, 0, 0, 1, 1));
  const back = decodeThumb(encodeThumb(t));
  assert.ok(back);
  assert.equal(back.width, t.width);
  assert.equal(back.height, t.height);
  assert.deepEqual([...back.rgb], [...t.rgb]);
});

test('a malformed or foreign signature decodes to null, never to garbage', () => {
  assert.equal(decodeThumb(null), null);
  assert.equal(decodeThumb(''), null);
  assert.equal(decodeThumb('deadbeef'), null);
  assert.equal(decodeThumb('v2:10x20:AAAA'), null); // future scheme
  assert.equal(decodeThumb('v1:10x20:AAAA'), null); // length does not match
});

// --------------------------------------------------------------------------
// Matching

test('the same frame at 2x resolution is the same artwork', () => {
  // The cheap case dHash already handled: RSI ships one render at 3840 and 7680.
  const small = thumbOf(crop(400, 225, 0, 0, 1, 1));
  const large = thumbOf(crop(800, 450, 0, 0, 1, 1));
  assert.equal(isSameArtwork(small, large), true);
});

test('a 21:9 letterbox crop of a 16:9 master is the same artwork', () => {
  // The bug this module exists for: vertical crop, which shifts every cell of a
  // global hash. (Live: 13tm836w1fwe3 vs depg5suek1a91, dHash 100 bits apart.)
  const wide = thumbOf(crop(1920, 1080, 0, 0, 1, 1));
  const letterbox = thumbOf(crop(3840, 1646, 0, 0.11, 1, 0.89));
  const m = compareThumbs(wide, letterbox);
  assert.ok(
    m.correlation >= SAME_ARTWORK_MIN_CORRELATION,
    `correlation ${m.correlation.toFixed(3)} should clear the gate`,
  );
  assert.ok(
    m.colourDistance <= SAME_ARTWORK_MAX_COLOUR_DISTANCE,
    `colour distance ${m.colourDistance.toFixed(1)} should clear the gate`,
  );
  assert.equal(isSameArtwork(wide, letterbox), true);
});

test('a 16:9 cut-in of a 21:9 master is the same artwork', () => {
  // Horizontal crop — the other family. (Live: b7qrao0tzzs4l vs y7g1jd5dfu5sz.)
  const ultra = thumbOf(crop(3840, 1646, 0, 0, 1, 1));
  const cutIn = thumbOf(crop(2926, 1646, 0.12, 0, 0.88, 1));
  assert.equal(isSameArtwork(ultra, cutIn), true);
});

test('a different scene is not the same artwork', () => {
  const scene = thumbOf(crop(1920, 1080, 0, 0, 1, 1));
  const other = buildThumb(
    render(1920, 1080, (x, y) => {
      const u = x / 1920;
      const v = y / 1080;
      return [20 + 60 * v, 90 + 120 * u, 200 - 100 * v];
    }),
    1920,
    1080,
  );
  assert.equal(isSameArtwork(scene, other), false);
});

test('a missing signature never matches anything', () => {
  const t = thumbOf(crop(640, 360, 0, 0, 1, 1));
  assert.equal(isSameArtwork(t, null), false);
  assert.equal(isSameArtwork(null, t), false);
  assert.equal(isSameArtwork(null, null), false);
});

// --------------------------------------------------------------------------
// Ratios

test('21:9 and 16:9 are genuinely different, near-identical shapes are not', () => {
  assert.equal(isDistinctRatio(21 / 9, 16 / 9), true);
  assert.equal(isDistinctRatio(3840 / 1023, 3840 / 1646), true);
  assert.equal(isDistinctRatio(1.778, 1.809), false); // a 3840x2123 crop
  assert.equal(isDistinctRatio(1.778, 1.6), false); // 16:9 vs 16:10
  assert.equal(isDistinctRatio(1.778, 1.778), false);
  assert.equal(isDistinctRatio(0, 1.778), false); // unknown size: never distinct
});

test('the distinct-ratio factor is symmetric', () => {
  const a = 2;
  const b = a * RATIO_DISTINCT_FACTOR * 1.01;
  assert.equal(isDistinctRatio(a, b), isDistinctRatio(b, a));
  assert.equal(isDistinctRatio(a, b), true);
});

// --------------------------------------------------------------------------
// Grouping

test('a lone wallpaper is its own group and stays visible', () => {
  const t = thumbOf(crop(1920, 1080, 0, 0, 1, 1));
  const [only] = groupVariants([{ imageId: 'a', thumb: t, width: 1920, height: 1080 }]);
  assert.deepEqual(only, { imageId: 'a', group: 'a', role: 'single' });
});

test('crops of one artwork collapse to a primary plus one alt per real ratio', () => {
  const members = [
    // 16:9, 2.07 MP
    { imageId: 'sixteen', thumb: thumbOf(crop(1920, 1080, 0, 0, 1, 1)), width: 1920, height: 1080 },
    // 21:9, 6.32 MP — most pixels, so this is the representative
    {
      imageId: 'ultrawide',
      thumb: thumbOf(crop(3840, 1646, 0, 0.11, 1, 0.89)),
      width: 3840,
      height: 1646,
    },
    // 16:9 again, 0.92 MP — same shape as `sixteen`, fewer pixels
    { imageId: 'tiny', thumb: thumbOf(crop(1280, 720, 0, 0, 1, 1)), width: 1280, height: 720 },
  ];
  const roles = new Map(groupVariants(members).map((a) => [a.imageId, a]));
  assert.equal(roles.get('ultrawide')?.role, 'primary');
  assert.equal(roles.get('sixteen')?.role, 'ratio');
  assert.equal(roles.get('tiny')?.role, 'duplicate');
  for (const a of roles.values()) assert.equal(a.group, 'ultrawide');
});

test('grouping is idempotent and independent of input order', () => {
  const members = [
    { imageId: 'b', thumb: thumbOf(crop(1920, 1080, 0, 0, 1, 1)), width: 1920, height: 1080 },
    {
      imageId: 'a',
      thumb: thumbOf(crop(3840, 1646, 0, 0.11, 1, 0.89)),
      width: 3840,
      height: 1646,
    },
    { imageId: 'c', thumb: null, width: 800, height: 450 },
  ];
  const first = groupVariants(members);
  const second = groupVariants([...members].reverse());
  assert.deepEqual(first, second);
  assert.deepEqual(groupVariants(members), first);
});

test('a row without a signature is never grouped with anything', () => {
  const members = [
    { imageId: 'a', thumb: thumbOf(crop(1920, 1080, 0, 0, 1, 1)), width: 1920, height: 1080 },
    { imageId: 'b', thumb: null, width: 1920, height: 1080 },
  ];
  const roles = new Map(groupVariants(members).map((a) => [a.imageId, a.role]));
  assert.equal(roles.get('a'), 'single');
  assert.equal(roles.get('b'), 'single');
});

// --------------------------------------------------------------------------
// Screen fit

test('a group member is picked by shape first, pixels only as tiebreak', () => {
  const group = [
    { id: 'ultra', width: 3840, height: 1646 },
    { id: 'sixteen', width: 1920, height: 1080 },
    { id: 'sixteenBig', width: 3840, height: 2160 },
  ];
  assert.equal(pickForScreen(group, 3440, 1440)?.id, 'ultra'); // 21:9 monitor
  assert.equal(pickForScreen(group, 2560, 1440)?.id, 'sixteenBig'); // 16:9, more px
  assert.equal(pickForScreen(group, 0, 0)?.id, 'ultra'); // unknown screen: first
  assert.equal(pickForScreen([], 1920, 1080), null);
});
