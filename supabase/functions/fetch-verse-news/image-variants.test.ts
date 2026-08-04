// Tests for image-variants.ts. Pure logic, runs under both `deno test` and
// Node 24's `node --test` (type stripping). Guards the header pixel-gate that
// keeps an oversized source from ever reaching the decoder — the 2026-08-04
// outage was a source under the OLD 16 MP ceiling OOM-crashing the feed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVariants, MAX_DECODE_PIXELS, type RgbaImage, type VariantCodecs } from './image-variants.ts';

/** Minimal 24-byte PNG header (signature + IHDR width/height) — all readImageSize reads. */
function pngHeader(w: number, h: number): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0); // signature
  b.set([0x00, 0x00, 0x00, 0x0d], 8); // IHDR length
  b.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  b[16] = (w >>> 24) & 0xff; b[17] = (w >>> 16) & 0xff; b[18] = (w >>> 8) & 0xff; b[19] = w & 0xff;
  b[20] = (h >>> 24) & 0xff; b[21] = (h >>> 16) & 0xff; b[22] = (h >>> 8) & 0xff; b[23] = h & 0xff;
  return b;
}

/** Codecs that count decode calls, so we can assert a decode never ran. */
function countingCodecs(): { codecs: VariantCodecs; decodes: () => number } {
  let n = 0;
  const codecs: VariantCodecs = {
    decode(): RgbaImage { n++; return { data: new Uint8Array([10, 20, 30, 255]), width: 1, height: 1 }; },
    encodeJpeg(): Uint8Array { return new Uint8Array([1, 2, 3]); },
    encodePng(): Uint8Array { return new Uint8Array([1, 2, 3]); },
  };
  return { codecs, decodes: () => n };
}

test('refuses a source above MAX_DECODE_PIXELS WITHOUT decoding', () => {
  const w = 4000;
  const h = Math.ceil(MAX_DECODE_PIXELS / w) + 100; // guaranteed over the ceiling
  assert.ok(w * h > MAX_DECODE_PIXELS);
  const { codecs, decodes } = countingCodecs();
  assert.equal(buildVariants(pngHeader(w, h), 'png', codecs), null);
  assert.equal(decodes(), 0, 'the header gate must reject before any decode allocation');
});

test('the 3840×2160 (8.3 MP) /i/ original that 546-crashed the feed is now refused', () => {
  // The exact source class that drove worker RSS +220MB on 2026-08-04. It sat
  // UNDER the old 16 MP ceiling; this locks in that 8.3 MP no longer decodes.
  const { codecs, decodes } = countingCodecs();
  assert.equal(buildVariants(pngHeader(3840, 2160), 'png', codecs), null);
  assert.equal(decodes(), 0);
});

test('a normal in-budget source is still decoded', () => {
  const { codecs, decodes } = countingCodecs();
  const result = buildVariants(pngHeader(1000, 800), 'png', codecs); // 0.8 MP
  assert.notEqual(result, null);
  assert.equal(decodes(), 1);
});
