// Tests for perceptual-hash.ts. Pure logic, no Deno APIs, so it runs under both
// `deno test` (Edge parity) and Node 24's built-in test runner + type stripping:
//   node --test perceptual-hash.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DHASH_BITS,
  NEAR_DUPLICATE_MAX_DISTANCE,
  hammingDistance,
  isNearDuplicate,
  perceptualHash,
} from './perceptual-hash.ts';

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

/** A deterministic "scene": diagonal structure plus a bright blob. */
const scene = (w: number, h: number) => (x: number, y: number): [number, number, number] => {
  const u = x / w;
  const v = y / h;
  const blob = Math.hypot(u - 0.7, v - 0.35) < 0.12 ? 90 : 0;
  const g = 30 + 170 * ((u + v) % 1) + blob;
  return [g, g, g];
};

test('hash is 64 hex chars = 256 bits', () => {
  const h = perceptualHash(render(120, 80, scene(120, 80)), 120, 80);
  assert.ok(h);
  assert.equal(h.length, DHASH_BITS / 4);
  assert.match(h, /^[0-9a-f]+$/);
});

test('same scene at 2x resolution hashes as the same picture', () => {
  // The live case: RSI ships one render at both 3840px and 7680px.
  const small = perceptualHash(render(320, 180, scene(320, 180)), 320, 180);
  const large = perceptualHash(render(640, 360, scene(640, 360)), 640, 360);
  const d = hammingDistance(small!, large!);
  assert.ok(d !== null && d <= NEAR_DUPLICATE_MAX_DISTANCE, `distance ${d} should be a duplicate`);
  assert.equal(isNearDuplicate(small, large), true);
});

test('recolouring a scene does not make it a different picture', () => {
  // Load-bearing: the four Foundation Festival renders differ mainly in armour
  // colour, and the gallery must collapse them to one.
  const grey = perceptualHash(render(320, 180, scene(320, 180)), 320, 180);
  const tinted = perceptualHash(
    render(320, 180, (x, y) => {
      const [g] = scene(320, 180)(x, y);
      return [Math.min(255, g + 40), g, Math.max(0, g - 40)];
    }),
    320,
    180,
  );
  assert.equal(isNearDuplicate(grey, tinted), true);
});

test('a structurally different picture is not a duplicate', () => {
  const a = perceptualHash(render(320, 180, scene(320, 180)), 320, 180);
  const b = perceptualHash(
    render(320, 180, (x, y) => {
      // Vertical bars — same palette, unrelated layout.
      const g = (Math.floor(x / 9) % 2) * 200 + 30 + (y % 7) * 3;
      return [g, g, g];
    }),
    320,
    180,
  );
  const d = hammingDistance(a!, b!);
  assert.ok(d !== null && d > NEAR_DUPLICATE_MAX_DISTANCE, `distance ${d} should not be a duplicate`);
  assert.equal(isNearDuplicate(a, b), false);
});

test('a buffer too short for its claimed size yields no hash', () => {
  assert.equal(perceptualHash(new Uint8Array(10), 100, 100), null);
  assert.equal(perceptualHash(new Uint8Array(0), 0, 0), null);
});

test('hammingDistance refuses incomparable inputs instead of guessing', () => {
  assert.equal(hammingDistance('ffff', 'ff'), null); // different lengths
  assert.equal(hammingDistance('', 'ff'), null);
  assert.equal(hammingDistance('zzzz', 'ffff'), null); // not hex
  assert.equal(hammingDistance('ffff', 'ffff'), 0);
  assert.equal(hammingDistance('0000', 'ffff'), 16);
});

test('a missing hash is never a duplicate (undecodable images are kept)', () => {
  const h = perceptualHash(render(64, 64, scene(64, 64)), 64, 64);
  assert.equal(isNearDuplicate(null, h), false);
  assert.equal(isNearDuplicate(h, null), false);
  assert.equal(isNearDuplicate(null, null), false);
  assert.equal(isNearDuplicate(undefined, h), false);
});

test('identical hashes are duplicates at any threshold', () => {
  const h = perceptualHash(render(64, 64, scene(64, 64)), 64, 64);
  assert.equal(isNearDuplicate(h, h, 0), true);
});
