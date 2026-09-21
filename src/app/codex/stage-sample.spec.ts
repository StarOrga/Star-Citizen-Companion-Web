import {
  DEFAULT_FIELD,
  StageSample,
  computeStageSample,
  fallbackGeometry,
  sampleStage,
  spotGeometry,
} from './stage-sample';

/** Builds a flat RGBA buffer: `paint(x, y) => [r, g, b, a]` for every pixel. */
function makeCanvas(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number, number],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const [r, g, b, a] = paint(x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return data;
}

describe('computeStageSample', () => {
  it('reads the nebula field as the median of the four corners on a flat image', () => {
    const width = 16;
    const height = 16;
    const data = makeCanvas(width, height, () => [7, 21, 32, 255]);
    const sample = computeStageSample(data, width, height);
    expect(sample.field).toBe('#071520');
    expect(sample.bbox).toBeNull(); // nothing brighter/different than the (uniform) background
  });

  it('finds a bright rectangle in the middle as the bbox', () => {
    const width = 40;
    const height = 40;
    const data = makeCanvas(width, height, (x, y) => {
      const inShip = x >= 15 && x < 25 && y >= 10 && y < 30;
      return inShip ? [220, 220, 220, 255] : [8, 20, 30, 255];
    });
    const sample = computeStageSample(data, width, height);
    expect(sample.bbox).not.toBeNull();
    const bbox = sample.bbox!;
    // Normalized extent should bracket the painted rectangle (15..25 of 40, 10..30 of 40).
    expect(bbox.x0).toBeCloseTo(15 / 40, 1);
    expect(bbox.x1).toBeCloseTo(25 / 40, 1);
    expect(bbox.y0).toBeCloseTo(10 / 40, 1);
    expect(bbox.y1).toBeCloseTo(30 / 40, 1);
  });

  it('ignores sparse single-pixel noise (stars, lens flares) below the 1% row/col floor', () => {
    // 1 hit pixel in a 300-wide row is 0.33% of the row — clearly below the 1%
    // floor (a 100-wide row would put a single pixel exactly AT 1%, which the
    // floor keeps by design: "< 1%" is dropped, not "<= 1%").
    const width = 300;
    const height = 200;
    const data = makeCanvas(width, height, (x, y) => {
      const isStar = x === 3 && y === 3;
      return isStar ? [255, 255, 255, 255] : [7, 21, 32, 255];
    });
    const sample = computeStageSample(data, width, height);
    expect(sample.bbox).toBeNull();
  });

  it('measures the caption text zone (x 0-40%, y 70-100%) independently of the ship', () => {
    const width = 20;
    const height = 20;
    const data = makeCanvas(width, height, (x, y) => {
      const inTextZone = x < 8 && y >= 14;
      return inTextZone ? [255, 255, 255, 255] : [0, 0, 0, 255];
    });
    const sample = computeStageSample(data, width, height);
    expect(sample.textZoneLuma).toBeCloseTo(255, 0);
  });

  it('degrades gracefully for a zero-sized buffer', () => {
    const sample = computeStageSample(new Uint8ClampedArray(0), 0, 0);
    expect(sample).toEqual({ field: DEFAULT_FIELD, bbox: null, textZoneLuma: 0 });
  });
});

describe('sampleStage', () => {
  it('returns null for an image that has not decoded (no natural size)', () => {
    const img = new Image();
    expect(sampleStage(img)).toBeNull();
  });

  it('samples a real same-origin canvas image without throwing', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 36;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#071520';
    ctx.fillRect(0, 0, 64, 36);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(20, 10, 20, 16);

    const img = new Image();
    img.src = canvas.toDataURL();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('image failed to load'));
    });

    const sample = sampleStage(img);
    expect(sample).not.toBeNull();
    expect(sample!.bbox).not.toBeNull();
  });
});

describe('spotGeometry', () => {
  const stageW = 853;
  const stageH = 400;

  function sample(bbox: StageSample['bbox']): StageSample {
    return { field: '#071520', bbox, textZoneLuma: 0 };
  }

  it('scales the image so the bbox fills 88% width / 84% height, whichever binds', () => {
    // store_large-shaped render (2.84:1), bbox close to the file edges.
    const imgW = 818;
    const imgH = 288;
    const bbox = { x0: 0.1, y0: 0.02, x1: 0.91, y1: 0.98 };
    const g = spotGeometry(sample(bbox), stageW, stageH, imgW, imgH);

    const bboxWPx = (bbox.x1 - bbox.x0) * imgW;
    const bboxHPx = (bbox.y1 - bbox.y0) * imgH;
    const expectedScale = Math.min((0.88 * stageW) / bboxWPx, (0.84 * stageH) / bboxHPx);
    expect(g.width).toBeCloseTo(imgW * expectedScale, 3);
    expect(g.height).toBeCloseTo(imgH * expectedScale, 3);
  });

  it('centers the bbox at (50%, 47%) of the stage when it does not touch the text zone', () => {
    const imgW = 648;
    const imgH = 366;
    const bbox = { x0: 0.5, y0: 0.3, x1: 0.7, y1: 0.5 }; // clear of x<40%/y>70%
    const g = spotGeometry(sample(bbox), stageW, stageH, imgW, imgH);
    const bboxCenterXScaled = ((bbox.x0 + bbox.x1) / 2) * g.width;
    const bboxCenterYScaled = ((bbox.y0 + bbox.y1) / 2) * g.height;
    expect(g.left + bboxCenterXScaled).toBeCloseTo(0.5 * stageW, 3);
    expect(g.top + bboxCenterYScaled).toBeCloseTo(0.47 * stageH, 3);
  });

  it('shifts the target to (56%, 45%) when the bbox touches the text zone', () => {
    const imgW = 648;
    const imgH = 366;
    const bbox = { x0: 0.1, y0: 0.3, x1: 0.35, y1: 0.9 }; // x0<0.4 and y1>0.7
    const g = spotGeometry(sample(bbox), stageW, stageH, imgW, imgH);
    const bboxCenterXScaled = ((bbox.x0 + bbox.x1) / 2) * g.width;
    const bboxCenterYScaled = ((bbox.y0 + bbox.y1) / 2) * g.height;
    expect(g.left + bboxCenterXScaled).toBeCloseTo(0.56 * stageW, 3);
    expect(g.top + bboxCenterYScaled).toBeCloseTo(0.45 * stageH, 3);
  });

  it('sets the mask ellipse center (cx/cy) to the bbox center as a % of the image, independent of scale', () => {
    const bbox = { x0: 0.2, y0: 0.1, x1: 0.6, y1: 0.9 };
    const g1 = spotGeometry(sample(bbox), stageW, stageH, 648, 366);
    const g2 = spotGeometry(sample(bbox), 1920, 400, 3436, 2160);
    expect(g1.cx).toBeCloseTo(40, 5); // (0.2+0.6)/2 * 100
    expect(g1.cy).toBeCloseTo(50, 5); // (0.1+0.9)/2 * 100
    expect(g2.cx).toBeCloseTo(g1.cx, 5);
    expect(g2.cy).toBeCloseTo(g1.cy, 5);
  });

  it('clamps ry so the feather never reaches past the scaled image edge', () => {
    // A bbox spanning nearly the full image height forces ry's raw formula
    // well past half the image height.
    const bbox = { x0: 0.4, y0: 0.02, x1: 0.6, y1: 0.98 };
    const g = spotGeometry(sample(bbox), stageW, stageH, 400, 400);
    expect(g.ry).toBeLessThanOrEqual(0.5 * g.height - 8 + 1e-6);
  });

  it('falls back to a whole-image bbox when the sample found nothing', () => {
    const g = spotGeometry(sample(null), stageW, stageH, 648, 366);
    expect(g.width).toBeGreaterThan(0);
    expect(g.height).toBeGreaterThan(0);
    expect(g.cx).toBeCloseTo(50, 5);
    expect(g.cy).toBeCloseTo(50, 5);
  });
});

describe('fallbackGeometry', () => {
  it('centers a contain-fit box inside the stage', () => {
    const g = fallbackGeometry(853, 400, 648, 366);
    const scale = Math.min(853 / 648, 400 / 366);
    expect(g.width).toBeCloseTo(648 * scale, 5);
    expect(g.height).toBeCloseTo(366 * scale, 5);
    expect(g.left).toBeCloseTo((853 - g.width) / 2, 5);
    expect(g.top).toBeCloseTo((400 - g.height) / 2, 5);
  });

  it('never exceeds the stage on either axis', () => {
    const g = fallbackGeometry(390, 300, 818, 288);
    expect(g.width).toBeLessThanOrEqual(390 + 1e-6);
    expect(g.height).toBeLessThanOrEqual(300 + 1e-6);
  });
});
