/**
 * Runtime sampling for the Codex landing split-stage hero (K2 "Spot" — see
 * `designer-r14.md`). Everything here runs client-side against a small canvas
 * downscale of the RSI render: no server, no AI. Two halves:
 *
 *  - {@link sampleStage} decodes an `<img>` onto a 128×72 canvas and reduces it
 *    to a {@link StageSample}: the nebula field color, the ship's bbox, and the
 *    text-zone luma the caller uses to shift the bbox target off the caption.
 *    Guarded: a tainted/no-CORS canvas throws on `getImageData` and this
 *    returns `null` rather than propagating.
 *  - {@link spotGeometry} turns a `StageSample` plus the stage/image pixel
 *    sizes into the CSS numbers the K2 layer stack needs (bbox-fit scale,
 *    position, and the elliptical mask radii/center). Pure — no canvas, no
 *    DOM — so it is unit-testable without a browser.
 */

/** Normalized (0..1) extent of the detected ship silhouette within the image. */
export interface StageBbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface StageSample {
  /** Corner-median nebula color, e.g. `#071520`. Never mixed with a UI panel color. */
  field: string;
  /** `null` when no pixel cleared the hit threshold (near-blank source). */
  bbox: StageBbox | null;
  /** Mean luma (0..255) of the bottom-left caption zone (x 0–40%, y 70–100%). */
  textZoneLuma: number;
}

/** Geometry the K2 layer stack applies to `.img` and its `mask-image`. */
export interface SpotGeometry {
  /** Image element position/size, in stage px (the image may exceed the stage — overflow hidden). */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Mask ellipse radii, in px, relative to the (scaled) image box. */
  rx: number;
  ry: number;
  /** Mask ellipse center, in % of the image box (bbox center — stable under uniform scale/no-crop). */
  cx: number;
  cy: number;
}

/** Centered `object-fit: contain` box — the no-sample / no-CORS fallback. */
export interface ContainGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Default nebula field when sampling failed or found nothing (`designer-r14.md` K2). */
export const DEFAULT_FIELD = '#071520';

const SAMPLE_WIDTH = 128;
const SAMPLE_HEIGHT = 72;
const CORNER_BLOCK = 8;
const LUMA_HIT_THRESHOLD = 150;
/** A pixel counts as hull when it is this much brighter than the estimated nebula behind it.
 *  (An RGB-distance test caught the bright nebula clouds themselves and inflated the bbox to the whole frame.) */
const LUMA_ABOVE_BG_THRESHOLD = 80;
/** Rows/cols with fewer than this fraction of hits are ignored (stars, lens flares). */
const ROW_COL_HIT_FLOOR = 0.02;

interface Rgb { r: number; g: number; b: number; }

function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function blockMedian(
  data: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Rgb {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      rs.push(data[i]);
      gs.push(data[i + 1]);
      bs.push(data[i + 2]);
    }
  }
  return { r: median(rs), g: median(gs), b: median(bs) };
}

function toHex({ r, g, b }: Rgb): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) };
}

/**
 * Reduce raw RGBA pixels (from a `width`×`height` canvas) to a {@link StageSample}.
 * Pure — the part of the pipeline that is testable without a real `<canvas>`.
 */
export function computeStageSample(data: Uint8ClampedArray, width: number, height: number): StageSample {
  if (width <= 0 || height <= 0) return { field: DEFAULT_FIELD, bbox: null, textZoneLuma: 0 };

  const bw = Math.min(CORNER_BLOCK, width);
  const bh = Math.min(CORNER_BLOCK, height);
  const tl = blockMedian(data, width, 0, 0, bw, bh);
  const tr = blockMedian(data, width, width - bw, 0, width, bh);
  const bl = blockMedian(data, width, 0, height - bh, bw, height);
  const br = blockMedian(data, width, width - bw, height - bh, width, height);

  const field = toHex({
    r: median([tl.r, tr.r, bl.r, br.r]),
    g: median([tl.g, tr.g, bl.g, br.g]),
    b: median([tl.b, tr.b, bl.b, br.b]),
  });

  const bg = (x: number, y: number): Rgb => {
    const u = width > 1 ? x / (width - 1) : 0;
    const v = height > 1 ? y / (height - 1) : 0;
    const top = lerpRgb(tl, tr, u);
    const bottom = lerpRgb(bl, br, u);
    return lerpRgb(top, bottom, v);
  };

  const hitsPerRow = new Array<number>(height).fill(0);
  const hitsPerCol = new Array<number>(width).fill(0);

  let textZoneSum = 0;
  let textZoneCount = 0;
  const textZoneX1 = Math.floor(width * 0.4);
  const textZoneY0 = Math.ceil(height * 0.7);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const l = luma(r, g, b);

      const est = bg(x, y);
      const bgLuma = luma(est.r, est.g, est.b);
      if (l > LUMA_HIT_THRESHOLD || l > bgLuma + LUMA_ABOVE_BG_THRESHOLD) {
        hitsPerRow[y]++;
        hitsPerCol[x]++;
      }

      if (x < textZoneX1 && y >= textZoneY0) {
        textZoneSum += l;
        textZoneCount++;
      }
    }
  }

  const rowFloor = width * ROW_COL_HIT_FLOOR;
  const colFloor = height * ROW_COL_HIT_FLOOR;
  let rowMin = -1;
  let rowMax = -1;
  for (let y = 0; y < height; y++) {
    if (hitsPerRow[y] >= rowFloor) {
      if (rowMin === -1) rowMin = y;
      rowMax = y;
    }
  }
  let colMin = -1;
  let colMax = -1;
  for (let x = 0; x < width; x++) {
    if (hitsPerCol[x] >= colFloor) {
      if (colMin === -1) colMin = x;
      colMax = x;
    }
  }

  const bbox: StageBbox | null =
    rowMin === -1 || colMin === -1
      ? null
      : { x0: colMin / width, y0: rowMin / height, x1: (colMax + 1) / width, y1: (rowMax + 1) / height };

  return {
    field,
    bbox,
    textZoneLuma: textZoneCount > 0 ? textZoneSum / textZoneCount : 0,
  };
}

/**
 * Sample a decoded `<img>` on a {@link SAMPLE_WIDTH}×{@link SAMPLE_HEIGHT} canvas.
 * `null` when the canvas cannot be read (tainted / no CORS headers, no 2D
 * context available, or the image has no natural size yet) — callers then use
 * {@link fallbackGeometry} with {@link DEFAULT_FIELD}.
 */
export function sampleStage(
  img: HTMLImageElement,
  opts: { width?: number; height?: number } = {},
): StageSample | null {
  const width = opts.width ?? SAMPLE_WIDTH;
  const height = opts.height ?? SAMPLE_HEIGHT;
  try {
    if (!img.naturalWidth || !img.naturalHeight) return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height); // throws on a tainted canvas
    return computeStageSample(data, width, height);
  } catch {
    return null;
  }
}

/**
 * K2 "Spot" geometry: bbox-fit the image to the stage (it may overflow — the
 * stage clips), then place the ship bbox at (50%, 47%) of the stage, or
 * (56%, 45%) when the bbox touches the caption's text zone (x < 40%, y > 70%).
 * The mask ellipse follows the SCALED bbox plus a fixed stage-relative margin,
 * clamped so the feather never reaches past the image's own edge.
 *
 * `sample.bbox === null` (no hits) degrades to treating the whole image as the
 * bbox, which still produces a sane, centered ellipse.
 */
export function spotGeometry(
  sample: StageSample,
  stageW: number,
  stageH: number,
  imgW: number,
  imgH: number,
): SpotGeometry {
  const bbox = sample.bbox ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
  const bboxWFrac = Math.max(bbox.x1 - bbox.x0, 1 / imgW);
  const bboxHFrac = Math.max(bbox.y1 - bbox.y0, 1 / imgH);
  const bboxWPx = bboxWFrac * imgW;
  const bboxHPx = bboxHFrac * imgH;

  const scale = Math.min((0.88 * stageW) / bboxWPx, (0.84 * stageH) / bboxHPx);
  const width = imgW * scale;
  const height = imgH * scale;

  const bboxWScaled = bboxWFrac * width;
  const bboxHScaled = bboxHFrac * height;

  const touchesTextZone = bbox.x0 < 0.4 && bbox.y1 > 0.7;
  const targetXFrac = touchesTextZone ? 0.56 : 0.5;
  const targetYFrac = touchesTextZone ? 0.45 : 0.47;

  const bboxCenterXScaled = ((bbox.x0 + bbox.x1) / 2) * width;
  const bboxCenterYScaled = ((bbox.y0 + bbox.y1) / 2) * height;

  const left = targetXFrac * stageW - bboxCenterXScaled;
  const top = targetYFrac * stageH - bboxCenterYScaled;

  const rx = bboxWScaled / 2 + 0.18 * stageW;
  const ry = Math.max(0, Math.min(bboxHScaled / 2 + 0.22 * stageH, 0.5 * height - 8));

  const cx = ((bbox.x0 + bbox.x1) / 2) * 100;
  const cy = ((bbox.y0 + bbox.y1) / 2) * 100;

  return { left, top, width, height, rx, ry, cx, cy };
}

/** Centered `object-fit: contain` box — used with {@link DEFAULT_FIELD} when sampling fails. */
export function fallbackGeometry(stageW: number, stageH: number, imgW: number, imgH: number): ContainGeometry {
  const scale = Math.min(stageW / imgW, stageH / imgH);
  const width = imgW * scale;
  const height = imgH * scale;
  return { left: (stageW - width) / 2, top: (stageH - height) / 2, width, height };
}
