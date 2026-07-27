import {
  detectFramePads, frameInset, frameZoom, isPixelReadable, FramePads,
} from './news-thumb.component';
import { environment } from '../../environments/environment';

const SLOT_16_9 = 16 / 9;
const SLOT_21_9 = 21 / 9;

function pads(left: number, right: number, top: number, bottom: number): FramePads {
  return { left, right, top, bottom };
}

/**
 * Paint a subject rectangle full of hard edges onto a flat backdrop and hand it
 * back as a decoded, same-origin (untainted) image — the shape of the framed
 * launcher screenshot from feedback db5eba1e.
 */
function framedImage(
  width: number, height: number, padX: number, padY: number,
): Promise<HTMLImageElement> {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  // Backdrop: a gradient, not a flat fill — the real ones are starfields, which
  // is exactly why colour-uniformity detection was not good enough.
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#07171f');
  bg.addColorStop(1, '#10334a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const x = Math.round(width * padX), y = Math.round(height * padY);
  const w = width - 2 * x, h = height - 2 * y;
  ctx.fillStyle = '#132430';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#e8f4ff';
  for (let i = 0; i < 24; i++) {
    ctx.fillRect(x + 8, y + 8 + i * (h - 16) / 24, w - 16, Math.max(2, h / 90));
  }

  const img = new Image();
  const done = new Promise<HTMLImageElement>((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('probe image failed to load'));
  });
  img.src = canvas.toDataURL('image/png');
  return done;
}

/**
 * Noisy full-bleed art carrying one razor-sharp seam — the kind of single outlier
 * that a max-based activity threshold would let dominate the whole measurement.
 */
function spikedImage(width: number, height: number): Promise<HTMLImageElement> {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  // Mid-contrast texture across the ENTIRE frame — no margin anywhere.
  for (let y = 0; y < height; y += 6) {
    for (let x = 0; x < width; x += 6) {
      const v = 60 + ((x * 7 + y * 13) % 40);
      ctx.fillStyle = `rgb(${v},${v + 6},${v + 14})`;
      ctx.fillRect(x, y, 5, 5);
    }
  }
  // The outlier: a black-on-white seam down the middle.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(Math.round(width / 2), 0, Math.round(width / 40), height);
  ctx.fillStyle = '#000000';
  ctx.fillRect(Math.round(width / 2) + Math.round(width / 40), 0, Math.round(width / 40), height);

  const img = new Image();
  const done = new Promise<HTMLImageElement>((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('probe image failed to load'));
  });
  img.src = canvas.toDataURL('image/png');
  return done;
}

describe('frameInset', () => {
  it('trims a symmetric frame down to the narrower side', () => {
    expect(frameInset(pads(0.195, 0.188, 0.181, 0.208))).toEqual({ x: 0.188, y: 0.181 });
  });

  it('ignores a one-sided margin — an open sky is content, not a frame', () => {
    // A 5120x1440 render that simply opens on empty sky at the top.
    expect(frameInset(pads(0.008, 0, 0.111, 0))).toEqual({ x: 0, y: 0 });
  });

  it('ignores hairline margins that are only measurement noise', () => {
    expect(frameInset(pads(0.014, 0.008, 0.008, 0))).toEqual({ x: 0, y: 0 });
  });

  it('never claims more than 30% per side', () => {
    expect(frameInset(pads(0.48, 0.47, 0, 0)).x).toBe(0.3);
  });
});

describe('frameZoom', () => {
  it('leaves an unframed image completely alone', () => {
    expect(frameZoom({ x: 0, y: 0 }, 16 / 9, SLOT_16_9)).toBe(1);
  });

  it('fills the tile with the subject of the framed launcher screenshot', () => {
    // 1680x945 with ~19% side and ~18% top/bottom margin (feedback db5eba1e).
    const zoom = frameZoom({ x: 0.188, y: 0.181 }, 1680 / 945, SLOT_16_9);
    expect(zoom).toBeCloseTo(1.6, 1);
  });

  it('derives the same zoom for the wider featured slot', () => {
    const regular = frameZoom({ x: 0.188, y: 0.181 }, 1680 / 945, SLOT_16_9);
    const featured = frameZoom({ x: 0.188, y: 0.181 }, 1680 / 945, SLOT_21_9);
    expect(featured).toBeCloseTo(regular, 2);
  });

  it('does not zoom a 4:3 letterbox that cover already crops away', () => {
    // A 480x360 YouTube thumbnail: the black bars fall outside the 16:9 window
    // on their own, so zooming would only throw resolution away.
    expect(frameZoom({ x: 0, y: 0.115 }, 480 / 360, SLOT_16_9)).toBe(1);
  });

  it('caps the zoom so a mis-measure cannot blow the thumbnail up', () => {
    expect(frameZoom({ x: 0.3, y: 0.3 }, 16 / 9, SLOT_16_9)).toBeLessThanOrEqual(2.2);
  });

  it('leaves a portrait poster alone even when it has real side margins', () => {
    // Measured on the live feed: a 743x1050 Spectrum poster reads ~11% per side.
    // Width binds in a landscape slot, so trimming it would cost ~28% of the
    // height cover had left — a strictly worse tile.
    expect(frameZoom({ x: 0.11, y: 0 }, 743 / 1050, SLOT_16_9)).toBe(1);
    expect(frameZoom({ x: 0.11, y: 0 }, 743 / 1050, SLOT_21_9)).toBe(1);
  });

  it('is inert for a degenerate ratio', () => {
    expect(frameZoom({ x: 0.2, y: 0.2 }, 0, SLOT_16_9)).toBe(1);
  });
});

describe('detectFramePads', () => {
  it('measures a symmetric frame on a gradient backdrop', async () => {
    const img = await framedImage(1680, 945, 0.2, 0.18);
    const found = detectFramePads(img);
    expect(found).not.toBeNull();
    expect(found!.left).toBeCloseTo(0.2, 1);
    expect(found!.right).toBeCloseTo(0.2, 1);
    expect(found!.top).toBeCloseTo(0.18, 1);
    expect(found!.bottom).toBeCloseTo(0.18, 1);
    // …and the frame survives the symmetry gate as a real inset.
    expect(frameInset(found!).x).toBeGreaterThan(0.15);
  });

  it('reports no margin for a full-bleed image', async () => {
    const img = await framedImage(1280, 720, 0, 0);
    const found = detectFramePads(img);
    expect(found).not.toBeNull();
    expect(frameInset(found!)).toEqual({ x: 0, y: 0 });
  });

  it('returns null for an image with no decoded pixels', () => {
    expect(detectFramePads(new Image())).toBeNull();
  });

  it('does not mistake ordinary detail for margin next to a razor-sharp edge', async () => {
    // Full-bleed art whose only extreme is one hard black/white seam. Scaling the
    // threshold off that single peak would push everything else below the cut and
    // "trim" real content; the quantile reference keeps the image intact.
    const img = await spikedImage(1280, 720);
    const found = detectFramePads(img);
    expect(found).not.toBeNull();
    expect(frameInset(found!)).toEqual({ x: 0, y: 0 });
  });
});

describe('isPixelReadable', () => {
  it('accepts the news-image cache bucket that serves most thumbnails', () => {
    const host = new URL(environment.supabase.url).hostname;
    expect(isPixelReadable(`https://${host}/storage/v1/object/public/news-images/a/cover.jpg`)).toBeTrue();
  });

  it('accepts the RSI media CDN', () => {
    expect(isPixelReadable('https://media.robertsspaceindustries.com/4p0b1xnv3vte5/post.jpg')).toBeTrue();
  });

  it('accepts the Spectrum upload host the launcher screenshots come from', () => {
    expect(isPixelReadable('https://theverse.robertsspaceindustries.com/4ugbc7rewokpz/tavern_upload_large.jpg')).toBeTrue();
  });

  it('refuses the apex proxy, which answers without an ACAO header', () => {
    // Requesting CORS there fails the load and costs a second round trip, so the
    // trim is not worth it — those tiles keep a tainted canvas and no zoom.
    expect(isPixelReadable('https://robertsspaceindustries.com/i/abc123/hero.jpg')).toBeFalse();
  });

  it('refuses anything else, including a malformed url', () => {
    expect(isPixelReadable('https://i.ytimg.com/vi/abc/hqdefault.jpg')).toBeFalse();
    expect(isPixelReadable('not a url')).toBeFalse();
  });
});
