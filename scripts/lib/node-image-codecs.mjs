// Node binding of the shared news-image variant pipeline's codecs.
//
// Deliberately the SAME two pure-JS libraries the edge function uses
// (supabase/functions/fetch-verse-news/image-codecs.ts), so a backfilled object
// is byte-comparable with one produced by live ingest. Swapping in `sharp` here
// would give smaller files but silently split the bucket into two encodings and
// add a native build dependency to the repo for a one-off migration.

import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

const MAX_DECODE_MB = 512;

const looksPng = (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
const looksJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8;

/** @type {import('../../supabase/functions/fetch-verse-news/image-variants.ts').VariantCodecs} */
export const nodeCodecs = {
  // Magic bytes decide, not the file extension: RSI serves plenty of `.jpg` urls
  // whose payload is actually a PNG, and the wrong decoder throws.
  decode(bytes, hint) {
    try {
      if (looksPng(bytes)) {
        const png = PNG.sync.read(Buffer.from(bytes));
        return { data: new Uint8Array(png.data), width: png.width, height: png.height };
      }
      if (looksJpeg(bytes) || /jpe?g/i.test(hint ?? '')) {
        const img = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: MAX_DECODE_MB });
        return { data: new Uint8Array(img.data), width: img.width, height: img.height };
      }
      return null;
    } catch {
      return null;
    }
  },
  encodeJpeg(img, quality) {
    return new Uint8Array(jpeg.encode({ data: img.data, width: img.width, height: img.height }, quality).data);
  },
  encodePng(img) {
    const png = new PNG({ width: img.width, height: img.height });
    png.data = Buffer.from(img.data);
    return new Uint8Array(PNG.sync.write(png, { deflateLevel: 9 }));
  },
};
