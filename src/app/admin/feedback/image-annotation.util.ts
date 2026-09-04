/**
 * Mark-up layer for feedback screenshots (admin feedback 312a4acc).
 *
 * "Here — this button" is the single most common thing a bug report needs, and
 * writing it out in prose is exactly the step people skip. So every image
 * attached to a feedback message can be drawn on before it is sent: a couple of
 * high-contrast colours, a rectangle, an arrow and a freehand pen.
 *
 * Deliberately its own tiny geometry module rather than a drawing library: the
 * shapes are stored as plain data in *image* pixel coordinates, so the same
 * list renders identically on the small on-screen canvas and on the full-size
 * export canvas — only the scale differs. That also makes undo a `pop()` and
 * makes the whole thing unit-testable without a DOM.
 */

/** The three marks the lightbox offers. */
export type AnnotationTool = 'rect' | 'arrow' | 'pen';

/** A point in *image* pixel coordinates (not screen coordinates). */
export interface AnnotationPoint {
  readonly x: number;
  readonly y: number;
}

/** One drawn mark. `rect`/`arrow` use the first and last point, `pen` all of them. */
export interface AnnotationShape {
  readonly tool: AnnotationTool;
  readonly color: string;
  /** Stroke width in image pixels. */
  readonly width: number;
  readonly points: readonly AnnotationPoint[];
}

/**
 * Palette. Picked for contrast against both the dark app chrome and the light
 * cards, and kept to four so the row fits next to the tool buttons on a phone.
 * These are literal colours, not theme tokens: they are burned into an image
 * that will be looked at outside the app, where a CSS variable means nothing.
 */
export const ANNOTATION_COLORS = ['#ff3b30', '#ffd60a', '#00d4ff', '#30d158'] as const;

/**
 * Stroke width relative to the image's longest edge, so a mark on a 4K
 * screenshot is as visible as the same mark on a phone shot.
 */
export function strokeWidthFor(imageWidth: number, imageHeight: number): number {
  return Math.max(2, Math.round(Math.max(imageWidth, imageHeight) / 260));
}

/** Draw every mark onto a context already scaled to the image's coordinates. */
export function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  shapes: readonly AnnotationShape[],
): void {
  for (const shape of shapes) drawShape(ctx, shape);
}

/** Draw a single mark. Exported for the live preview of the in-progress shape. */
export function drawShape(ctx: CanvasRenderingContext2D, shape: AnnotationShape): void {
  const pts = shape.points;
  if (pts.length === 0) return;
  ctx.save();
  ctx.strokeStyle = shape.color;
  ctx.fillStyle = shape.color;
  ctx.lineWidth = shape.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (shape.tool === 'pen') {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    // A single tap is a dot, not nothing — otherwise a tap looks like a bug.
    if (pts.length === 1) ctx.lineTo(pts[0].x + 0.01, pts[0].y);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const a = pts[0];
  const b = pts[pts.length - 1];
  if (shape.tool === 'rect') {
    ctx.strokeRect(
      Math.min(a.x, b.x),
      Math.min(a.y, b.y),
      Math.abs(b.x - a.x),
      Math.abs(b.y - a.y),
    );
    ctx.restore();
    return;
  }

  // Arrow: the shaft plus a filled head sized off the stroke width, so it stays
  // proportional at every image size.
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len > 0.5) {
    const head = Math.max(shape.width * 3.5, 8);
    const angle = Math.atan2(dy, dx);
    const spread = Math.PI / 7;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - head * Math.cos(angle - spread), b.y - head * Math.sin(angle - spread));
    ctx.lineTo(b.x - head * Math.cos(angle + spread), b.y - head * Math.sin(angle + spread));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Load an image for annotation.
 *
 * `crossOrigin = 'anonymous'` is not optional: a restored draft's thumbnail is a
 * `https://…supabase.co/storage/…` URL, and drawing a plainly-loaded
 * cross-origin image into a canvas taints it, which makes the `toDataURL()`
 * export throw `SecurityError`. The bucket is public and serves permissive CORS
 * headers, so the anonymous request succeeds; a `data:` URI (everything just
 * pasted, dropped or captured) is same-origin anyway and unaffected.
 */
export function loadAnnotatableImage(src: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('annotation source could not be loaded'));
    img.src = src;
  });
}

/**
 * Burn the marks into the image and return a JPEG data URI.
 *
 * Flattening rather than storing the shapes alongside the image is the whole
 * point: the annotated picture is what gets uploaded, so it is also what the
 * routine, the admin board and every later reader see — there is no second
 * rendering path that could disagree with the one the author looked at.
 */
export async function exportAnnotated(
  src: string,
  shapes: readonly AnnotationShape[],
  quality = 0.9,
): Promise<string> {
  const img = await loadAnnotatableImage(src);
  const w = Math.max(1, img.naturalWidth || img.width);
  const h = Math.max(1, img.naturalHeight || img.height);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  // White matte first: the source may be a transparent PNG and JPEG has no
  // alpha, which would otherwise come out black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  drawAnnotations(ctx, shapes);
  return canvas.toDataURL('image/jpeg', quality);
}
