// Deno / Supabase-Edge binding of the shared variant pipeline's codecs.
//
// Pure-JS on purpose. jpeg-js + pngjs are the two decoders this function already
// runs in production (wallpaper content scoring, #133), so they are the only
// codecs proven to work inside the Supabase edge runtime — no wasm blob to ship,
// no native addon, no cold-start penalty.
//
// That also settles the output format question: there is no lightweight pure-JS
// WebP/AVIF *encoder*, and pulling a wasm codec into a request-scoped function
// that serves the entire news page is a bad trade for the remaining ~35 % those
// formats would buy. The dominant win here is resizing + de-duplication (an
// order of magnitude), not the entropy coder. Sources we cannot decode
// (GIF/SVG/WebP) fall back to the `w0` passthrough in index.ts.

import { Buffer } from 'node:buffer';
import jpeg from 'npm:jpeg-js@0.4.4';
import { PNG } from 'npm:pngjs@7.0.0';
import type { RgbaImage, VariantCodecs } from './image-variants.ts';

/** 512 MB matches the existing wallpaper decode budget in index.ts. */
const MAX_DECODE_MB = 512;

function looksPng(b: Uint8Array): boolean {
  return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}

function looksJpeg(b: Uint8Array): boolean {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8;
}

export const edgeCodecs: VariantCodecs = {
  // The magic bytes decide, not the hint: RSI serves plenty of `.jpg` urls whose
  // payload is actually a PNG (and vice versa), and a wrong decoder throws.
  decode(bytes: Uint8Array, hint: string): RgbaImage | null {
    try {
      if (looksPng(bytes)) {
        const png = PNG.sync.read(Buffer.from(bytes));
        return { data: new Uint8Array(png.data), width: png.width, height: png.height };
      }
      if (looksJpeg(bytes) || /jpe?g/i.test(hint)) {
        const img = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: MAX_DECODE_MB });
        return { data: new Uint8Array(img.data), width: img.width, height: img.height };
      }
      return null;
    } catch {
      return null;
    }
  },
  encodeJpeg(img: RgbaImage, quality: number): Uint8Array {
    return new Uint8Array(jpeg.encode({ data: img.data, width: img.width, height: img.height }, quality).data);
  },
  encodePng(img: RgbaImage): Uint8Array {
    const png = new PNG({ width: img.width, height: img.height });
    png.data = Buffer.from(img.data);
    return new Uint8Array(PNG.sync.write(png, { deflateLevel: 9 }));
  },
};
