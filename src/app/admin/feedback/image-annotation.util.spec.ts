import {
  ANNOTATION_COLORS,
  AnnotationShape,
  drawAnnotations,
  exportAnnotated,
  strokeWidthFor,
} from './image-annotation.util';

/**
 * A 4x4 fully transparent PNG, produced by the browser rather than typed out as
 * a base64 literal: a hand-written one decodes in an <img> even when a byte is
 * off, and then fails in the stricter decoders (createImageBitmap) that the
 * composer actually uses — a trap worth not laying twice.
 */
function transparentPng(size = 4): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas.toDataURL('image/png');
}

const TINY_PNG = transparentPng();

function scratch(w: number, h: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context in this browser');
  return ctx;
}

/** `[r, g, b, a]` of one pixel. */
function pixel(ctx: CanvasRenderingContext2D, x: number, y: number): number[] {
  return Array.from(ctx.getImageData(x, y, 1, 1).data);
}

/**
 * Mark-up on a feedback screenshot (admin feedback 312a4acc). The shapes are
 * stored in IMAGE coordinates and flattened into the picture on save, so these
 * tests work on a real canvas and look at real pixels: a rectangle that renders
 * one pixel off, or a colour that silently does not survive the export, is
 * exactly the class of bug a shape-count assertion would miss.
 */
describe('image annotation', () => {
  describe('strokeWidthFor', () => {
    it('scales the stroke with the image so a mark stays visible at any size', () => {
      expect(strokeWidthFor(3840, 2160)).toBeGreaterThan(strokeWidthFor(390, 844));
    });

    it('never goes below a 2px hairline, however small the image', () => {
      expect(strokeWidthFor(10, 10)).toBe(2);
    });
  });

  describe('drawAnnotations', () => {
    it('strokes a rectangle on its edges and leaves the inside alone', () => {
      const ctx = scratch(40, 40);
      const shape: AnnotationShape = {
        tool: 'rect',
        color: '#ff0000',
        width: 4,
        points: [
          { x: 10, y: 10 },
          { x: 30, y: 30 },
        ],
      };
      drawAnnotations(ctx, [shape]);

      const [r, g, b, a] = pixel(ctx, 10, 20);
      expect(a).withContext('the edge is painted').toBeGreaterThan(200);
      expect(r).toBeGreaterThan(200);
      expect(g).toBeLessThan(60);
      expect(b).toBeLessThan(60);
      expect(pixel(ctx, 20, 20)[3]).withContext('the inside stays transparent').toBe(0);
    });

    it('normalises a rectangle dragged up and to the left', () => {
      const ctx = scratch(40, 40);
      // Same box, dragged from the bottom-right corner to the top-left one.
      drawAnnotations(ctx, [
        { tool: 'rect', color: '#00ff00', width: 4, points: [{ x: 30, y: 30 }, { x: 10, y: 10 }] },
      ]);
      expect(pixel(ctx, 10, 20)[3]).toBeGreaterThan(200);
      expect(pixel(ctx, 20, 20)[3]).toBe(0);
    });

    it('gives an arrow a filled head at the end the user dragged to', () => {
      const ctx = scratch(60, 60);
      drawAnnotations(ctx, [
        { tool: 'arrow', color: '#ffffff', width: 3, points: [{ x: 5, y: 30 }, { x: 50, y: 30 }] },
      ]);
      // The head is wider than the shaft: a few pixels off-axis near the tip are
      // painted, while the same offset near the tail is not.
      expect(pixel(ctx, 42, 27)[3]).withContext('arrow head').toBeGreaterThan(150);
      expect(pixel(ctx, 10, 27)[3]).withContext('bare shaft').toBe(0);
    });

    it('draws a freehand path through every point it was given', () => {
      const ctx = scratch(40, 40);
      drawAnnotations(ctx, [
        {
          tool: 'pen',
          color: '#ffffff',
          width: 3,
          points: [
            { x: 5, y: 5 },
            { x: 5, y: 30 },
            { x: 30, y: 30 },
          ],
        },
      ]);
      expect(pixel(ctx, 5, 20)[3]).toBeGreaterThan(150);
      expect(pixel(ctx, 20, 30)[3]).toBeGreaterThan(150);
      expect(pixel(ctx, 25, 10)[3]).toBe(0);
    });

    it('renders a single tap as a visible dot rather than nothing', () => {
      const ctx = scratch(20, 20);
      drawAnnotations(ctx, [{ tool: 'pen', color: '#ffffff', width: 4, points: [{ x: 10, y: 10 }] }]);
      expect(pixel(ctx, 10, 10)[3]).toBeGreaterThan(150);
    });

    it('paints nothing for a shape with no points', () => {
      const ctx = scratch(20, 20);
      drawAnnotations(ctx, [{ tool: 'rect', color: '#ffffff', width: 4, points: [] }]);
      expect(pixel(ctx, 10, 10)[3]).toBe(0);
    });

    it('offers four distinct colours', () => {
      expect(new Set(ANNOTATION_COLORS).size).toBe(ANNOTATION_COLORS.length);
      expect(ANNOTATION_COLORS.length).toBe(4);
    });
  });

  describe('exportAnnotated', () => {
    it('flattens the marks into a JPEG at the source resolution', async () => {
      const out = await exportAnnotated(TINY_PNG, [
        { tool: 'rect', color: '#ff0000', width: 1, points: [{ x: 0, y: 0 }, { x: 3, y: 3 }] },
      ]);
      expect(out.startsWith('data:image/jpeg')).toBeTrue();

      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('export did not decode'));
        el.src = out;
      });
      expect(img.naturalWidth).toBe(4);
      expect(img.naturalHeight).toBe(4);
    });

    it('mattes transparency to white instead of letting JPEG turn it black', async () => {
      const out = await exportAnnotated(TINY_PNG, []);
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('export did not decode'));
        el.src = out;
      });
      const ctx = scratch(4, 4);
      ctx.drawImage(img, 0, 0);
      // Fully transparent source + white matte = white, not black.
      expect(pixel(ctx, 2, 2)[0]).toBeGreaterThan(230);
    });

    it('rejects when the source cannot be loaded at all', async () => {
      await expectAsync(exportAnnotated('data:image/png;base64,not-an-image', [])).toBeRejected();
    });
  });
});
