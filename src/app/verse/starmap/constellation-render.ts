/**
 * Constellation wallpaper renderer — pure TypeScript over a 2D canvas context.
 *
 * The Starscape desktop app mirrors this algorithm in Rust, so every step is
 * deterministic and expressed in resolution-independent units:
 *
 *   u   = min(width, height) / 1000          (one "unit"; all sizes are in u)
 *   rnd = mulberry32(fnv1a32(seed))           (see starmap.model.ts; one stream,
 *                                              consumed in exactly this order)
 *
 *  1. BACKGROUND  vertical linear gradient #03050c → #070b1a → #02030a, then a
 *     radial vignette (centre transparent → edge rgba(0,0,0,0.55)).
 *  2. NEBULA      4 soft blobs (`nebula: true` → 7, brighter). Per blob draw
 *     rnd() for x, y (in 0..1 of the canvas), radius 180..480 u, hue
 *     (base hue 205 or 265 by rnd() < 0.5, ±25), then fill a radial gradient
 *     hsla(h, 70%, 45%, a) → transparent with composite 'lighter';
 *     a = 0.10 (0.16 with `nebula`).
 *  3. STARFIELD   three layers, counts scale with the area in u² / 1e6:
 *       far  1400 × area, radius 0.35..0.9 u, alpha 0.25..0.6
 *       mid   420 × area, radius 0.8..1.6 u, alpha 0.45..0.85
 *       near   60 × area, radius 1.4..2.6 u, alpha 0.8..1, plus a soft glow
 *              (radial gradient, 6× radius) and a 4-point glint (two thin
 *              lines, 10× radius, alpha 0.35).
 *     Each star draws rnd() for x, y, radius, alpha, and colour temperature
 *     (rnd() < 0.15 → warm #ffe2b8, < 0.3 → cool #bcd4ff, else #ffffff).
 *  4. ROAD        (`road: true`, ≥ 2 constellations) a faint dashed polyline
 *     through the centroids of all constellations, newest last.
 *  5. CONSTELLATIONS  `constellations[0]` is the current patch: box 62 % of the
 *     short side, centred at (0.40 w, 0.52 h). Older ones (max 6) sit on an
 *     arc on the right: box 17 % of the short side, centres at
 *     (0.80 w + sin(k·0.9)·0.06 w, 0.18 h + k·0.13 h) for k = 0..5.
 *     Per constellation, points (0..1) map into the box (aspect kept).
 *       a. lines: closed outline through the points in their stored order,
 *          stroke rgba(150,190,255, lit ? 0.42 : 0.14), width 1.6 u (0.8 u small)
 *       b. stars: unlit = 2.2 u disc rgba(200,215,255,0.28); lit = glow
 *          (radial gradient white → rgba(120,170,255,0) at 9× r) + 3.2 u core,
 *          small constellations scale r by 0.45. Lit = the first `starCount`
 *          indices of the SYMMETRIC order (starmap.model.ts symmetricLightOrder).
 *       c. sun (`sun: true`): above-right of the box (box.x + box.w·1.02,
 *          box.y − box.h·0.02). Current sun core 16 u with corona 9× core;
 *          older suns core 4 u, corona 5× — only the current sun is large.
 *  6. SUPERNOVA   (`supernova: true`) a burst around the current constellation
 *     centre: 3 concentric radial gradients (warm white → magenta → transparent)
 *     plus 28 rays (length 90..260 u from rnd()), and the letters "SCC" at
 *     alpha 0.06 below-right of the burst — the subtle hint.
 *  7. WATERMARK   the current patch number (e.g. "4.4"), no prefix, no dot,
 *     font 600 14 u "Rajdhani, sans-serif", alpha 0.07, placed 14 u right and
 *     10 u below the lit star with the lowest index (else point 0) of the current
 *     constellation —
 *     a catalogue mark noticed on the third look.
 *
 * Animation (`animateConstellation`) never redraws the static layers: it blits
 * a cached base image and adds a twinkle overlay (and meteors when `meteor`)
 * at ≤ 30 fps, pauses when the canvas is off-screen or the tab is hidden, and
 * renders exactly one static frame under `prefers-reduced-motion`.
 */

import type { VersePoint } from '../data/verse.models';
import { hashSeed, litIndices, mulberry32 } from './starmap.model';

export interface RenderConstellation {
  readonly patchLine: string;
  readonly points: readonly VersePoint[];
  readonly starCount: number;
  readonly sun: boolean;
}

export interface ConstellationRenderOptions {
  readonly width: number;
  readonly height: number;
  /** Any string; same seed + same inputs → identical image. */
  readonly seed: string;
  /** Newest first; [0] is drawn large. */
  readonly constellations: readonly RenderConstellation[];
  readonly nebula?: boolean;
  readonly road?: boolean;
  readonly supernova?: boolean;
}

/** The subset of CanvasRenderingContext2D the renderer uses (fakeable in specs). */
export type Ctx2D = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'beginPath'
  | 'closePath'
  | 'moveTo'
  | 'lineTo'
  | 'arc'
  | 'fill'
  | 'stroke'
  | 'fillRect'
  | 'fillText'
  | 'setLineDash'
  | 'createLinearGradient'
  | 'createRadialGradient'
> & {
  fillStyle: CanvasRenderingContext2D['fillStyle'];
  strokeStyle: CanvasRenderingContext2D['strokeStyle'];
  lineWidth: number;
  globalAlpha: number;
  globalCompositeOperation: GlobalCompositeOperation;
  font: string;
  textAlign: CanvasTextAlign;
};

export const WALLPAPER_4K = { width: 3840, height: 2160 } as const;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function glow(ctx: Ctx2D, x: number, y: number, r: number, inner: string, outer: string): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function disc(ctx: Ctx2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Maps 0..1 points into a square box centred at (cx, cy). */
function placeBox(cx: number, cy: number, size: number): Box {
  return { x: cx - size / 2, y: cy - size / 2, w: size, h: size };
}

function mapPoint(p: VersePoint, box: Box): [number, number] {
  return [box.x + p[0] * box.w, box.y + p[1] * box.h];
}

/** Box of every constellation slot, index-aligned with `constellations`. */
export function constellationBoxes(width: number, height: number, count: number): Box[] {
  const short = Math.min(width, height);
  const boxes: Box[] = [];
  if (count > 0) boxes.push(placeBox(width * 0.4, height * 0.52, short * 0.62));
  for (let k = 0; k < Math.min(6, count - 1); k++) {
    boxes.push(placeBox(width * 0.8 + Math.sin(k * 0.9) * width * 0.06, height * 0.18 + k * height * 0.13, short * 0.17));
  }
  return boxes;
}

function drawBackground(ctx: Ctx2D, w: number, h: number): void {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#03050c');
  bg.addColorStop(0.55, '#070b1a');
  bg.addColorStop(1, '#02030a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const r = Math.hypot(w, h) / 2;
  const v = ctx.createRadialGradient(w / 2, h / 2, r * 0.35, w / 2, h / 2, r);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

function drawNebula(ctx: Ctx2D, w: number, h: number, u: number, rnd: () => number, strong: boolean): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const blobs = strong ? 7 : 4;
  const a = strong ? 0.16 : 0.1;
  for (let i = 0; i < blobs; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = lerp(180, 480, rnd()) * u;
    const base = rnd() < 0.5 ? 205 : 265;
    const hue = Math.round(base + (rnd() - 0.5) * 50);
    glow(ctx, x, y, r, `hsla(${hue}, 70%, 45%, ${a})`, `hsla(${hue}, 70%, 45%, 0)`);
  }
  ctx.restore();
}

function starColor(t: number): string {
  if (t < 0.15) return '#ffe2b8';
  if (t < 0.3) return '#bcd4ff';
  return '#ffffff';
}

function drawStarfield(ctx: Ctx2D, w: number, h: number, u: number, rnd: () => number): void {
  const area = (w / u) * (h / u) / 1e6;
  const layers = [
    { n: 1400, r: [0.35, 0.9], a: [0.25, 0.6], near: false },
    { n: 420, r: [0.8, 1.6], a: [0.45, 0.85], near: false },
    { n: 60, r: [1.4, 2.6], a: [0.8, 1], near: true },
  ] as const;
  for (const layer of layers) {
    const count = Math.round(layer.n * area);
    for (let i = 0; i < count; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const r = lerp(layer.r[0], layer.r[1], rnd()) * u;
      const alpha = lerp(layer.a[0], layer.a[1], rnd());
      const color = starColor(rnd());
      ctx.globalAlpha = alpha;
      if (layer.near) {
        glow(ctx, x, y, r * 6, 'rgba(190,210,255,0.35)', 'rgba(190,210,255,0)');
        ctx.globalAlpha = alpha * 0.35;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(0.5, u * 0.4);
        ctx.beginPath();
        ctx.moveTo(x - r * 10, y);
        ctx.lineTo(x + r * 10, y);
        ctx.moveTo(x, y - r * 10);
        ctx.lineTo(x, y + r * 10);
        ctx.stroke();
        ctx.globalAlpha = alpha;
      }
      disc(ctx, x, y, r, color);
    }
  }
  ctx.globalAlpha = 1;
}

function centroid(points: readonly VersePoint[], box: Box): [number, number] {
  if (points.length === 0) return [box.x + box.w / 2, box.y + box.h / 2];
  const sx = points.reduce((a, p) => a + p[0], 0) / points.length;
  const sy = points.reduce((a, p) => a + p[1], 0) / points.length;
  return mapPoint([sx, sy], box);
}

function drawConstellation(ctx: Ctx2D, c: RenderConstellation, box: Box, u: number, large: boolean): void {
  const pts = c.points.map((p) => mapPoint(p, box));
  const lit = litIndices(c.points, c.starCount);
  const anyLit = lit.size > 0;
  if (pts.length > 1) {
    ctx.strokeStyle = `rgba(150,190,255,${anyLit ? 0.42 : 0.14})`;
    ctx.lineWidth = (large ? 1.6 : 0.8) * u;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.stroke();
  }
  const k = large ? 1 : 0.45;
  pts.forEach(([x, y], i) => {
    if (lit.has(i)) {
      glow(ctx, x, y, 3.2 * 9 * k * u, 'rgba(255,255,255,0.9)', 'rgba(120,170,255,0)');
      disc(ctx, x, y, 3.2 * k * u, '#ffffff');
    } else {
      disc(ctx, x, y, 2.2 * k * u, 'rgba(200,215,255,0.28)');
    }
  });
  if (c.sun) {
    const sx = box.x + box.w * 1.02;
    const sy = box.y - box.h * 0.02;
    const core = (large ? 16 : 4) * u;
    glow(ctx, sx, sy, core * (large ? 9 : 5), 'rgba(255,214,140,0.55)', 'rgba(255,170,80,0)');
    glow(ctx, sx, sy, core * 1.6, '#fff6e0', 'rgba(255,220,150,0.2)');
    disc(ctx, sx, sy, core, '#fff3d6');
  }
}

function drawSupernova(ctx: Ctx2D, cx: number, cy: number, u: number, rnd: () => number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  glow(ctx, cx, cy, 340 * u, 'rgba(255,90,200,0.18)', 'rgba(255,90,200,0)');
  glow(ctx, cx, cy, 160 * u, 'rgba(255,170,230,0.35)', 'rgba(255,170,230,0)');
  glow(ctx, cx, cy, 46 * u, 'rgba(255,250,240,0.95)', 'rgba(255,230,200,0)');
  ctx.strokeStyle = 'rgba(255,220,240,0.22)';
  ctx.lineWidth = 0.9 * u;
  ctx.beginPath();
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const len = lerp(90, 260, rnd()) * u;
    ctx.moveTo(cx + Math.cos(a) * 30 * u, cy + Math.sin(a) * 30 * u);
    ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
  }
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = '#ffffff';
  ctx.font = `600 ${Math.round(18 * u)}px Rajdhani, sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText('SCC', cx + 120 * u, cy + 150 * u);
  ctx.restore();
}

function drawWatermark(ctx: Ctx2D, c: RenderConstellation, box: Box, u: number): void {
  if (!c.patchLine || c.points.length === 0) return;
  const order = [...litIndices(c.points, c.starCount)];
  const anchor = mapPoint(c.points[order.length ? Math.min(...order) : 0], box);
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = '#dfe8ff';
  ctx.font = `600 ${Math.round(14 * u)}px Rajdhani, sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText(c.patchLine, anchor[0] + 14 * u, anchor[1] + 10 * u);
  ctx.restore();
}

/** Draws the static wallpaper. Deterministic for identical options. */
export function renderConstellationWallpaper(ctx: Ctx2D, opts: ConstellationRenderOptions): void {
  const { width: w, height: h } = opts;
  const u = Math.min(w, h) / 1000;
  const rnd = mulberry32(hashSeed(opts.seed));
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  drawBackground(ctx, w, h);
  drawNebula(ctx, w, h, u, rnd, !!opts.nebula);
  drawStarfield(ctx, w, h, u, rnd);
  const list = opts.constellations.slice(0, 7);
  const boxes = constellationBoxes(w, h, list.length);
  if (opts.road && list.length > 1) {
    const cs = list.map((c, i) => centroid(c.points, boxes[i])).reverse();
    ctx.strokeStyle = 'rgba(180,200,255,0.16)';
    ctx.lineWidth = 1.2 * u;
    ctx.setLineDash([6 * u, 10 * u]);
    ctx.beginPath();
    ctx.moveTo(cs[0][0], cs[0][1]);
    for (let i = 1; i < cs.length; i++) ctx.lineTo(cs[i][0], cs[i][1]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  list.forEach((c, i) => drawConstellation(ctx, c, boxes[i], u, i === 0));
  if (opts.supernova && list.length > 0) {
    const [cx, cy] = centroid(list[0].points, boxes[0]);
    drawSupernova(ctx, cx, cy, u, rnd);
  }
  if (list.length > 0) drawWatermark(ctx, list[0], boxes[0], u);
  ctx.restore();
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

/** Renders to a PNG blob (default 4K). */
export function renderConstellationPng(
  opts: Omit<ConstellationRenderOptions, 'width' | 'height'> & { width?: number; height?: number },
): Promise<Blob> {
  const width = opts.width ?? WALLPAPER_4K.width;
  const height = opts.height ?? WALLPAPER_4K.height;
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('canvas 2d unavailable'));
  renderConstellationWallpaper(ctx, { ...opts, width, height });
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  );
}

/** Saves a blob through a temporary anchor download. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Live preview (sr-live / sr-meteor): static base + twinkle (+ meteors).
 * Returns a stop function. Resource-saving: cached base, ≤ 30 fps, paused while
 * off-screen or hidden, one static frame under reduced motion.
 */
export function animateConstellation(
  canvas: HTMLCanvasElement,
  opts: ConstellationRenderOptions & { meteor?: boolean },
): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => undefined;
  const base = makeCanvas(opts.width, opts.height);
  const bctx = base.getContext('2d');
  if (!bctx) return () => undefined;
  renderConstellationWallpaper(bctx, opts);
  ctx.drawImage(base, 0, 0);
  if (prefersReducedMotion()) return () => undefined;

  const u = Math.min(opts.width, opts.height) / 1000;
  const rnd = mulberry32(hashSeed(`${opts.seed}:live`));
  const twinkles = Array.from({ length: 40 }, () => ({
    x: rnd() * opts.width,
    y: rnd() * opts.height,
    r: lerp(1, 2.4, rnd()) * u,
    phase: rnd() * Math.PI * 2,
    speed: lerp(0.6, 1.8, rnd()),
  }));
  const meteors = opts.meteor
    ? Array.from({ length: 6 }, () => ({ start: rnd() * 6000, x: rnd(), y: rnd() * 0.5, len: lerp(120, 260, rnd()) }))
    : [];

  let raf = 0;
  let last = 0;
  let visible = true;
  const frame = (t: number): void => {
    raf = requestAnimationFrame(frame);
    if (!visible || document.hidden || t - last < 33) return;
    last = t;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(base, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    for (const s of twinkles) {
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(s.phase + (t / 1000) * s.speed);
      glow(ctx, s.x, s.y, s.r * 5, 'rgba(220,235,255,0.7)', 'rgba(220,235,255,0)');
    }
    for (const m of meteors) {
      const p = ((t + m.start) % 6000) / 1200;
      if (p > 1) continue;
      const x = (m.x + p * 0.35) * opts.width;
      const y = (m.y + p * 0.25) * opts.height;
      const g = ctx.createLinearGradient(x, y, x - m.len * u, y - m.len * u * 0.7);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(160,200,255,0)');
      ctx.globalAlpha = 1 - p;
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.6 * u;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - m.len * u, y - m.len * u * 0.7);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };
  const io =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => (visible = entries.some((e) => e.isIntersecting)))
      : null;
  io?.observe(canvas);
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    io?.disconnect();
  };
}

/** Social-card size of the shared Kartograph badge. */
export const BADGE_SIZE = { width: 1200, height: 630 } as const;

export interface KartographBadgeRender {
  readonly width: number;
  readonly height: number;
  readonly constellation: RenderConstellation;
  /** Already translated, e.g. "Kartograph · Rang 2". */
  readonly title: string;
  /** Already translated, e.g. "Patch 4.4 · 7 von 7 Sternen". */
  readonly subtitle: string;
}

/**
 * The friend badge: the newest constellation as a wallpaper (seed = patch line,
 * same as the Starscape app) with a calm caption panel bottom-left.
 */
export function renderKartographBadge(ctx: Ctx2D, b: KartographBadgeRender): void {
  renderConstellationWallpaper(ctx, {
    width: b.width,
    height: b.height,
    seed: b.constellation.patchLine,
    constellations: [b.constellation],
    nebula: true,
  });
  const u = Math.min(b.width, b.height) / 1000;
  ctx.save();
  const panel = ctx.createLinearGradient(0, b.height * 0.62, 0, b.height);
  panel.addColorStop(0, 'rgba(3,5,12,0)');
  panel.addColorStop(1, 'rgba(3,5,12,0.85)');
  ctx.fillStyle = panel;
  ctx.fillRect(0, b.height * 0.62, b.width, b.height * 0.38);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#eef3ff';
  ctx.font = `700 ${Math.round(64 * u)}px Rajdhani, sans-serif`;
  ctx.fillText(b.title, 60 * u, b.height - 120 * u);
  ctx.fillStyle = '#9fb3d9';
  ctx.font = `500 ${Math.round(34 * u)}px Rajdhani, sans-serif`;
  ctx.fillText(b.subtitle, 60 * u, b.height - 60 * u);
  ctx.restore();
}

export function renderKartographBadgePng(b: Omit<KartographBadgeRender, 'width' | 'height'>): Promise<Blob> {
  const canvas = makeCanvas(BADGE_SIZE.width, BADGE_SIZE.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('canvas 2d unavailable'));
  renderKartographBadge(ctx, { ...b, ...BADGE_SIZE });
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png'),
  );
}
