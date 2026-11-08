import { FAN_SPACING_PX, LABEL_GAP, LABEL_MARGIN, cycleId, fanOut, placeLabel, rectOf, ringPose, FIT_PADDING, type SafeArea, type Vec3Like, type ViewBasis, fitDistance, calloutGutter, calloutSize, placeCallout, usableSafeArea } from './holo-overlay';

const VP = { w: 1000, h: 600 };
const LABEL = { w: 200, h: 50 };
const HULL = { left: 300, top: 200, right: 700, bottom: 400 };

function inside(p: { left: number; top: number }) {
  return (
    p.left >= LABEL_MARGIN &&
    p.top >= LABEL_MARGIN &&
    p.left + LABEL.w <= VP.w - LABEL_MARGIN &&
    p.top + LABEL.h <= VP.h - LABEL_MARGIN
  );
}

function overlapsHull(p: { left: number; top: number }) {
  return p.left < HULL.right && p.left + LABEL.w > HULL.left && p.top < HULL.bottom && p.top + LABEL.h > HULL.top;
}

describe('placeLabel', () => {
  it('puts the label outside the hull on the side of the anchor', () => {
    const right = placeLabel({ x: 650, y: 300 }, HULL, LABEL, VP);
    expect(right.side).toBe('right');
    expect(right.left).toBe(HULL.right + LABEL_GAP);
    expect(overlapsHull(right)).toBe(false);
    const left = placeLabel({ x: 320, y: 300 }, HULL, LABEL, VP);
    expect(left.side).toBe('left');
    expect(left.left + LABEL.w).toBe(HULL.left - LABEL_GAP);
    expect(overlapsHull(left)).toBe(false);
  });

  it('centres the label on the anchor height and clamps it into the viewer', () => {
    const p = placeLabel({ x: 650, y: 300 }, HULL, LABEL, VP);
    expect(p.top).toBe(300 - LABEL.h / 2);
    const low = placeLabel({ x: 650, y: 598 }, HULL, LABEL, VP);
    expect(low.top).toBe(VP.h - LABEL.h - LABEL_MARGIN);
    expect(inside(low)).toBe(true);
  });

  it('switches to the other side when the preferred one has no room', () => {
    const wideRight = { left: 300, top: 200, right: 900, bottom: 400 };
    const p = placeLabel({ x: 850, y: 300 }, wideRight, LABEL, VP);
    expect(p.side).toBe('left');
    expect(inside(p)).toBe(true);
  });

  it('goes above or below a hull that fills the width', () => {
    const wide = { left: 20, top: 220, right: 980, bottom: 380 };
    const p = placeLabel({ x: 500, y: 250 }, wide, LABEL, VP);
    expect(p.side).toBe('top');
    expect(p.top + LABEL.h).toBeLessThanOrEqual(wide.top);
    const q = placeLabel({ x: 500, y: 370 }, wide, LABEL, VP);
    expect(q.side).toBe('bottom');
  });

  it('stays inside the viewer when the hull fills it completely', () => {
    const all = { left: -50, top: -50, right: 1050, bottom: 650 };
    const p = placeLabel({ x: 990, y: 5 }, all, LABEL, VP);
    expect(p.side).toBe('over');
    expect(inside(p)).toBe(true);
  });

  it('draws the leader line from the clamped anchor to the nearest label edge', () => {
    const p = placeLabel({ x: 650, y: 300 }, HULL, LABEL, VP);
    expect(p.line.x1).toBe(650);
    expect(p.line.y1).toBe(300);
    expect(p.line.x2).toBe(p.left);
    expect(p.line.y2).toBe(300);
    const off = placeLabel({ x: -200, y: 900 }, HULL, LABEL, VP);
    expect(off.line.x1).toBe(0);
    expect(off.line.y1).toBe(VP.h);
    expect(inside(off)).toBe(true);
  });

  it('works without a silhouette (falls back to the anchor itself)', () => {
    const p = placeLabel({ x: 400, y: 300 }, null, LABEL, VP);
    expect(p.side).toBe('right');
    expect(p.left).toBe(400 + LABEL_GAP);
  });
});

describe('rectOf', () => {
  it('bounds projected points', () => {
    expect(rectOf([])).toBeNull();
    expect(rectOf([{ x: 3, y: 9 }, { x: -1, y: 4 }])).toEqual({ left: -1, top: 4, right: 3, bottom: 9 });
  });
});

describe('ringPose (empty-slot ring)', () => {
  it('rotates and pulses over time', () => {
    const a = ringPose(0, false);
    const b = ringPose(0.45, false);
    expect(b.angle).toBeGreaterThan(a.angle);
    expect(b.scale).not.toBe(a.scale);
    expect(b.alpha).not.toBe(a.alpha);
    for (const t of [0, 0.3, 0.9, 1.7, 5]) {
      const p = ringPose(t, false);
      expect(p.scale).toBeGreaterThanOrEqual(1);
      expect(p.alpha).toBeGreaterThan(0.5);
      expect(p.alpha).toBeLessThanOrEqual(1);
    }
  });

  it('is static with reduced motion', () => {
    expect(ringPose(0, true)).toEqual(ringPose(7.3, true));
    expect(ringPose(7.3, true).angle).toBe(0);
    expect(ringPose(7.3, true).scale).toBe(1);
  });
});

describe('cycleId', () => {
  const ids = ['a', 'b', 'c'];
  it('steps forward and back with wrap-around', () => {
    expect(cycleId(ids, 'a', 1)).toBe('b');
    expect(cycleId(ids, 'c', 1)).toBe('a');
    expect(cycleId(ids, 'a', -1)).toBe('c');
  });
  it('starts at an end without a current slot', () => {
    expect(cycleId(ids, null, 1)).toBe('a');
    expect(cycleId(ids, 'zz', -1)).toBe('c');
    expect(cycleId([], 'a', 1)).toBeNull();
  });
});

describe('fanOut (stacked hotspots)', () => {
  const dots = (...xy: [number, number][]) => xy.map(([x, y], i) => ({ id: `p${i}`, x, y }));
  const minDist = (m: Map<string, { x: number; y: number }>) => {
    const v = [...m.values()];
    let d = Infinity;
    for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) d = Math.min(d, Math.hypot(v[i].x - v[j].x, v[i].y - v[j].y));
    return d;
  };

  it('leaves lone dots where they are', () => {
    const m = fanOut(dots([10, 10], [100, 100], [10 + FAN_SPACING_PX + 30, 10]));
    expect(m.get('p0')).toEqual({ x: 10, y: 10 });
    expect(m.get('p2')).toEqual({ x: 10 + FAN_SPACING_PX + 30, y: 10 });
  });

  it('spreads a stack around its centroid so no two dots are closer than the spacing', () => {
    for (const n of [2, 3, 5, 9, 34]) {
      const items = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, x: 200 + (i % 3), y: 150 + (i % 2) }));
      const m = fanOut(items);
      expect(m.size).toBe(n);
      expect(minDist(m)).toBeGreaterThanOrEqual(FAN_SPACING_PX - 0.01);
    }
  });

  it('is stable: same input, same output', () => {
    const a = fanOut(dots([50, 50], [52, 51], [49, 53]));
    const b = fanOut(dots([50, 50], [52, 51], [49, 53]));
    expect([...a]).toEqual([...b]);
  });

  it('chains: A near B near C is one stack', () => {
    const m = fanOut(dots([0, 0], [9, 0], [18, 0]));
    expect(minDist(m)).toBeGreaterThanOrEqual(FAN_SPACING_PX - 0.01);
  });
});

describe('fitDistance', () => {
  // Looking straight down -z, so the projection below is the camera's own.
  const basis: ViewBasis = { right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, back: { x: 0, y: 0, z: 1 } };
  const box = (x: number, y: number, z: number): Vec3Like[] => {
    const out: Vec3Like[] = [];
    for (const a of [-x, x]) for (const b of [-y, y]) for (const c of [-z, z]) out.push({ x: a, y: b, z: c });
    return out;
  };
  const pivot = { x: 0, y: 0, z: 0 };
  const FOV = 35;

  function extent(corners: Vec3Like[], d: number, h: number) {
    const f = h / 2 / Math.tan((FOV * Math.PI) / 360);
    let px = 0;
    let py = 0;
    for (const c of corners) {
      px = Math.max(px, (Math.abs(c.x) * f) / (d - c.z));
      py = Math.max(py, (Math.abs(c.y) * f) / (d - c.z));
    }
    return { px, py };
  }

  const canvases = [{ w: 1286, h: 850 }, { w: 960, h: 670 }, { w: 700, h: 700 }];
  const gutters: SafeArea = { left: 190, right: 190, top: 0, bottom: 60 };
  const hulls = { wide: box(30, 3, 8), long: box(4, 3, 40), tall: box(4, 20, 4), cube: box(5, 5, 5) };

  for (const vp of canvases) {
    for (const [name, corners] of Object.entries(hulls)) {
      it(`fits a ${name} hull into the safe area of ${vp.w} x ${vp.h}, and touches its limit`, () => {
        const d = fitDistance(corners, pivot, basis, FOV, vp, gutters);
        const { px, py } = extent(corners, d, vp.h);
        const halfW = (vp.w - gutters.left - gutters.right) / 2 - FIT_PADDING;
        const halfH = (vp.h - gutters.top - gutters.bottom) / 2 - FIT_PADDING;
        expect(px).toBeLessThanOrEqual(halfW + 1e-6);
        expect(py).toBeLessThanOrEqual(halfH + 1e-6);
        // Solved, not a fixed scale: one axis sits right at its limit.
        expect(Math.max(px / halfW, py / halfH)).toBeCloseTo(1, 5);
      });
    }
  }

  it('wider gutters push the camera back', () => {
    const narrow = fitDistance(hulls.wide, pivot, basis, FOV, canvases[0], { left: 0, right: 0, top: 0, bottom: 0 });
    const wide = fitDistance(hulls.wide, pivot, basis, FOV, canvases[0], gutters);
    expect(wide).toBeGreaterThan(narrow);
  });
});

describe('usableSafeArea', () => {
  it('passes sane insets and scales absurd ones so the model keeps room', () => {
    const vp = { w: 1000, h: 500 };
    const ok: SafeArea = { left: 190, right: 190, top: 0, bottom: 60 };
    expect(usableSafeArea(ok, vp)).toEqual(ok);
    const s = usableSafeArea({ left: 600, right: 600, top: 0, bottom: 0 }, vp);
    expect(1000 - s.left - s.right).toBeCloseTo(150, 5);
    expect(s.left).toBeCloseTo(s.right, 5);
  });
});

describe('placeCallout', () => {
  const vp = { w: 1200, h: 800 };
  const box = { w: 168, h: 66 };
  const safe: SafeArea = { left: 190, right: 190, top: 0, bottom: 60 };

  it('stays inside the gutter on the anchor side, whatever the anchor does', () => {
    for (const [x, y] of [[300, 400], [590, 5], [100, 790], [-50, 400]]) {
      const c = placeCallout({ x, y }, box, vp, safe)!;
      expect(c.side).toBe('left');
      expect(c.left + box.w).toBeLessThanOrEqual(safe.left);
      expect(c.top).toBeGreaterThanOrEqual(0);
      expect(c.top + box.h).toBeLessThanOrEqual(vp.h);
    }
    const r = placeCallout({ x: 900, y: 400 }, box, vp, safe)!;
    expect(r.side).toBe('right');
    expect(r.left).toBeGreaterThanOrEqual(vp.w - safe.right);
    expect(r.left + box.w).toBeLessThanOrEqual(vp.w);
  });

  it('uses the other gutter when its own is too small, none when both are', () => {
    expect(placeCallout({ x: 300, y: 400 }, box, vp, { ...safe, left: 40 })!.side).toBe('right');
    expect(placeCallout({ x: 300, y: 400 }, box, vp, { ...safe, left: 0, right: 0 })).toBeNull();
  });

  it('starts the line at the marker ring and ends it on the box', () => {
    const c = placeCallout({ x: 300, y: 400 }, box, vp, safe)!;
    expect(Math.hypot(c.line.x1 - 300, c.line.y1 - 400)).toBeCloseTo(13, 5);
    expect(c.line.x2).toBe(c.left + box.w);
  });
});

describe('calloutSize', () => {
  it('is 168 x 66 at 1920 and above, scales down gently, and the gutter holds it', () => {
    expect(calloutSize(1920)).toEqual({ w: 168, h: 66 });
    expect(calloutSize(2560)).toEqual({ w: 168, h: 66 });
    expect(calloutSize(1440).w).toBeCloseTo(147, 5);
    expect(calloutSize(1440).h).toBeCloseTo(57.75, 5);
    expect(calloutSize(600).w).toBeCloseTo(134.4, 5);
    for (const w of [1024, 1366, 1440, 1920]) {
      const vp = { w: 1000, h: 700 };
      const gutter = calloutGutter(w);
      const c = placeCallout({ x: 100, y: 300 }, calloutSize(w), vp, { left: gutter, right: gutter, top: 0, bottom: 0 });
      expect(c).not.toBeNull();
      expect(c!.left + calloutSize(w).w).toBeLessThanOrEqual(gutter);
    }
  });
});
