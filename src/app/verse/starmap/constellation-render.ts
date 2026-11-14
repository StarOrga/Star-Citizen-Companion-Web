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
 * The default look is a real night sky (2026-11-13): no Milky Way band, no
 * glinting spikes, star brightness falls off like a real magnitude spread (many
 * faint, very few bright), and the user's own constellation sits small in one
 * spot - found on the second look, not painted over the sky. `hero: true`
 * (the shared Kartograph badge) keeps the large, centred figure.
 *
 *  1. BACKGROUND  vertical linear gradient #02040a → #050916 → #020309, a radial
 *     vignette (centre transparent → edge rgba(0,0,0,0.5)) and a low airglow
 *     along the bottom edge (rgba(40,70,110,0.10) → 0 over the lowest 35 % h).
 *  2. AIRGLOW     2 very wide, very faint tints; per tint rnd() for x, y,
 *     radius 420..700 u and hue (210 or 250 by rnd() < 0.5, ±15 by rnd()).
 *     Always a faint airglow (alpha 0.02); `nebula: true` lifts it to 0.045.
 *     Default look only (no nebula reward, not hero) adds the MAGIC layer
 *     (2026-11-14): a soft blue veil (radial gradient, 380 u, rgba(70,120,220,
 *     0.18) → 0) centred on the own constellation, drawn before the stars so
 *     they stay on top, and a glow under the own lines (two wider low-alpha
 *     strokes behind the 40 % line). No random draws, stars stay untouched.
 *  3. STARFIELD   three layers, counts scale with the area in u² / 1e6:
 *       faint  1700 × area, radius 0.3..0.65 u, alpha 0.12..0.45
 *       small   260 × area, radius 0.6..1.05 u, alpha 0.35..0.7
 *       bright   12 × area, radius 1.0..1.6 u,  alpha 0.8..1, plus a soft halo
 *                (radial gradient, 3.5× radius) - no spikes.
 *     Each star draws rnd() for x, y, radius, alpha, and colour temperature
 *     (rnd() < 0.1 → warm #ffe6c4, < 0.25 → cool #c9dbff, else #f6f8ff).
 *  4. ROAD        (`road: true`, ≥ 2 constellations) a barely visible dashed
 *     polyline through the centroids of all constellations, newest last.
 *  5. CONSTELLATIONS  `constellations[0]` is the current patch. Older ones are
 *     drawn when `companions` is not false (default true; the rank page passes
 *     the tier-3 reward) or the road is on. `tint` (tier-4 reward) draws the
 *     own lines, glow and lit stars in a warm amber instead of blue. Default: box
 *     20 % of the short side centred at (0.70 w, 0.30 h); older ones (max 6) in
 *     6 % boxes at the fixed OLDER_SPOTS. `hero`: box 62 % at (0.40 w, 0.52 h),
 *     older ones 17 % on an arc on the right.
 *     Per constellation, points (0..1) map into the box (aspect kept).
 *       a. lines: closed outline in stored order, visible (default lit 0.4 /
 *          unlit 0.12; hero 0.42 / 0.14), width 0.7 u (hero 1.6 u, small 0.8 u).
 *       b. stars: lit = soft glow + core, unlit = a faint disc. Lit = the first
 *          `starCount` indices of the SYMMETRIC order (symmetricLightOrder).
 *       c. sun (`sun: true`): above-right of the box, a small warm star (core
 *          3.5 u current / 1.6 u older; hero 16 u / 4 u) with a soft corona.
 *  6. SUPERNOVA   (`supernova: true`) a burst around the current constellation
 *     centre (scaled with the box) plus the brand initials (BRAND_INITIALS) at
 *     alpha 0.06 below-right of it - the subtle hint.
 *  7. WATERMARK   the current patch number (e.g. "4.4"), no prefix, alpha 0.07,
 *     beside the lit star with the lowest index (else point 0) - a catalogue
 *     mark noticed on the third look.
 *
 * The Starscape app's Rust mirror still draws the previous sky (the hero
 * layout with nebula blobs and glints); port this when that renderer is next
 * touched.
 *
 * Animation (`animateConstellation`) never redraws the static layers: it blits
 * a cached base image and adds a twinkle overlay (and meteors when `meteor`)
 * at ≤ 30 fps, pauses when the canvas is off-screen or the tab is hidden, and
 * renders exactly one static frame under `prefers-reduced-motion`.
 */

import type { VersePoint } from '../data/verse.models';
import { hashSeed, litIndices, mulberry32 } from './starmap.model';
import { BRAND_INITIALS } from '../../core/brand';

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
  /** Older patch lines as faint companions; default true, the rank page gates it on tier 3. */
  readonly companions?: boolean;
  /** Warm amber tint of the own constellation (rank reward from tier 4). */
  readonly tint?: boolean;
  /** Large centred figure (Kartograph badge); default = a small figure in a real night sky. */
  readonly hero?: boolean;
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
export function constellationBoxes(width: number, height: number, count: number, hero = false): Box[] {
  const short = Math.min(width, height);
  const boxes: Box[] = [];
  if (hero) {
    if (count > 0) boxes.push(placeBox(width * 0.4, height * 0.52, short * 0.62));
    for (let k = 0; k < Math.min(6, count - 1); k++) {
      boxes.push(placeBox(width * 0.8 + Math.sin(k * 0.9) * width * 0.06, height * 0.18 + k * height * 0.13, short * 0.17));
    }
    return boxes;
  }
  if (count > 0) boxes.push(placeBox(width * 0.7, height * 0.3, short * 0.2));
  for (let k = 0; k < Math.min(6, count - 1); k++) {
    const [x, y] = OLDER_SPOTS[k];
    boxes.push(placeBox(width * x, height * y, short * 0.06));
  }
  return boxes;
}

/** Where older constellations hide in the default sky (fractions of w / h), well apart from the current one. */
const OLDER_SPOTS: readonly (readonly [number, number])[] = [
  [0.22, 0.24],
  [0.42, 0.62],
  [0.86, 0.66],
  [0.14, 0.7],
  [0.55, 0.16],
  [0.33, 0.42],
];

function drawBackground(ctx: Ctx2D, w: number, h: number): void {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#02040a');
  bg.addColorStop(0.6, '#050916');
  bg.addColorStop(1, '#020309');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const r = Math.hypot(w, h) / 2;
  const v = ctx.createRadialGradient(w / 2, h / 2, r * 0.35, w / 2, h / 2, r);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
  const air = ctx.createLinearGradient(0, h, 0, h * 0.65);
  air.addColorStop(0, 'rgba(40,70,110,0.10)');
  air.addColorStop(1, 'rgba(40,70,110,0)');
  ctx.fillStyle = air;
  ctx.fillRect(0, h * 0.65, w, h * 0.35);
}

/** Two very wide, very faint tints (natural airglow, never a Milky Way band); the draws are consumed either way. */
function drawNebula(ctx: Ctx2D, w: number, h: number, u: number, rnd: () => number, on: boolean): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 2; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = lerp(420, 700, rnd()) * u;
    const base = rnd() < 0.5 ? 210 : 250;
    const hue = Math.round(base + (rnd() - 0.5) * 30);
    // Default: a barely-there airglow (the magic); the nebula reward lifts it to a visible cloud.
    const a = on ? 0.045 : 0.02;
    glow(ctx, x, y, r, `hsla(${hue}, 45%, 35%, ${a})`, `hsla(${hue}, 45%, 35%, 0)`);
  }
  ctx.restore();
}

function starColor(t: number): string {
  if (t < 0.1) return '#ffe6c4';
  if (t < 0.25) return '#c9dbff';
  return '#f6f8ff';
}

function drawStarfield(ctx: Ctx2D, w: number, h: number, u: number, rnd: () => number): void {
  const area = (w / u) * (h / u) / 1e6;
  const layers = [
    { n: 1700, r: [0.3, 0.65], a: [0.12, 0.45], bright: false },
    { n: 260, r: [0.6, 1.05], a: [0.35, 0.7], bright: false },
    { n: 12, r: [1.0, 1.6], a: [0.8, 1], bright: true },
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
      if (layer.bright) glow(ctx, x, y, r * 3.5, 'rgba(210,225,255,0.22)', 'rgba(210,225,255,0)');
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

interface FigureStyle {
  /** Soft glow under the own lines (default look only). */
  readonly magic: boolean;
  /** RGB triplet of the own lines. */
  readonly line: string;
  /** Inner colour of the lit-star glow. */
  readonly glowInner: string;
}
const BLUE_STYLE: Pick<FigureStyle, 'line' | 'glowInner'> = { line: '150,190,255', glowInner: 'rgba(235,242,255,0.55)' };
const AMBER_STYLE: Pick<FigureStyle, 'line' | 'glowInner'> = { line: '255,205,140', glowInner: 'rgba(255,238,212,0.55)' };

function drawConstellation(ctx: Ctx2D, c: RenderConstellation, box: Box, u: number, large: boolean, hero: boolean, style: FigureStyle): void {
  const pts = c.points.map((p) => mapPoint(p, box));
  const lit = litIndices(c.points, c.starCount);
  const anyLit = lit.size > 0;
  if (pts.length > 1) {
    const a = hero ? (anyLit ? 0.42 : 0.14) : anyLit ? (large ? 0.4 : 0.14) : 0.12;
    const width = (hero ? (large ? 1.6 : 0.8) : large ? 1.1 : 0.7) * u;
    if (style.magic && large && anyLit) {
      // Soft glow: two wider, very faint strokes behind the line (no blur filter, so it stays deterministic everywhere).
      for (const [mul, alpha] of [[7, 0.08], [3.4, 0.13]] as const) {
        ctx.strokeStyle = `rgba(${style.line},${alpha})`;
        ctx.lineWidth = width * mul;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.strokeStyle = `rgba(${style.line},${a})`;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.stroke();
  }
  // Hero: the large figure as before. Night sky: lit stars read as a touch brighter real stars.
  const k = hero ? (large ? 1 : 0.45) : large ? 0.7 : 0.3;
  pts.forEach(([x, y], i) => {
    if (lit.has(i)) {
      glow(ctx, x, y, 3.2 * (hero ? 9 : 5) * k * u, hero ? 'rgba(255,255,255,0.9)' : style.glowInner, 'rgba(120,170,255,0)');
      disc(ctx, x, y, 3.2 * k * u, '#ffffff');
    } else {
      disc(ctx, x, y, 2.2 * k * u, hero ? 'rgba(200,215,255,0.28)' : 'rgba(200,215,255,0.2)');
    }
  });
  if (c.sun) {
    const sx = box.x + box.w * 1.02;
    const sy = box.y - box.h * 0.02;
    const core = (hero ? (large ? 16 : 4) : large ? 3.5 : 1.6) * u;
    glow(ctx, sx, sy, core * (hero && large ? 9 : 5), 'rgba(255,214,140,0.45)', 'rgba(255,170,80,0)');
    glow(ctx, sx, sy, core * 1.6, '#fff6e0', 'rgba(255,220,150,0.2)');
    disc(ctx, sx, sy, core, '#fff3d6');
  }
}

/** `u` here is already scaled to the figure (smaller in the night sky). */
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
  ctx.fillText(BRAND_INITIALS, cx + 120 * u, cy + 150 * u);
  ctx.restore();
}

function drawWatermark(ctx: Ctx2D, c: RenderConstellation, box: Box, u: number, hero: boolean): void {
  if (!c.patchLine || c.points.length === 0) return;
  const order = [...litIndices(c.points, c.starCount)];
  const anchor = mapPoint(c.points[order.length ? Math.min(...order) : 0], box);
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = '#dfe8ff';
  const k = hero ? 1 : 0.6;
  ctx.font = `600 ${Math.max(6, Math.round(14 * k * u))}px Rajdhani, sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText(c.patchLine, anchor[0] + 14 * k * u, anchor[1] + 10 * k * u);
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
  const hero = !!opts.hero;
  const magic = !hero && !opts.nebula;
  const tint = !hero && !!opts.tint;
  const older = opts.companions !== false || !!opts.road;
  const list = opts.constellations.slice(0, older ? 7 : 1);
  const boxes = constellationBoxes(w, h, list.length, hero);
  if (magic && list.length > 0) {
    // The blue veil sits behind the constellation and under the stars.
    const [vx, vy] = centroid(list[0].points, boxes[0]);
    glow(ctx, vx, vy, 380 * u, tint ? 'rgba(200,130,70,0.15)' : 'rgba(70,120,220,0.18)', tint ? 'rgba(200,130,70,0)' : 'rgba(70,120,220,0)');
  }
  drawStarfield(ctx, w, h, u, rnd);
  if (opts.road && list.length > 1) {
    const cs = list.map((c, i) => centroid(c.points, boxes[i])).reverse();
    ctx.strokeStyle = `rgba(180,200,255,${hero ? 0.16 : 0.05})`;
    ctx.lineWidth = 1.2 * u;
    ctx.setLineDash([6 * u, 10 * u]);
    ctx.beginPath();
    ctx.moveTo(cs[0][0], cs[0][1]);
    for (let i = 1; i < cs.length; i++) ctx.lineTo(cs[i][0], cs[i][1]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  list.forEach((c, i) =>
    drawConstellation(ctx, c, boxes[i], u, i === 0, hero, { magic: magic && i === 0, ...(tint && i === 0 ? AMBER_STYLE : BLUE_STYLE) }),
  );
  if (opts.supernova && list.length > 0) {
    const [cx, cy] = centroid(list[0].points, boxes[0]);
    drawSupernova(ctx, cx, cy, hero ? u : u * 0.35, rnd);
  }
  if (list.length > 0) drawWatermark(ctx, list[0], boxes[0], u, hero);
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
    hero: true,
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
