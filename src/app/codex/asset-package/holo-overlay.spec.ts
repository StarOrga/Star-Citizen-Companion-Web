import { LABEL_GAP, LABEL_MARGIN, cycleId, placeLabel, rectOf, ringPose } from './holo-overlay';

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
    expect(overlapsHull(right)).toBeFalse();
    const left = placeLabel({ x: 320, y: 300 }, HULL, LABEL, VP);
    expect(left.side).toBe('left');
    expect(left.left + LABEL.w).toBe(HULL.left - LABEL_GAP);
    expect(overlapsHull(left)).toBeFalse();
  });

  it('centres the label on the anchor height and clamps it into the viewer', () => {
    const p = placeLabel({ x: 650, y: 300 }, HULL, LABEL, VP);
    expect(p.top).toBe(300 - LABEL.h / 2);
    const low = placeLabel({ x: 650, y: 598 }, HULL, LABEL, VP);
    expect(low.top).toBe(VP.h - LABEL.h - LABEL_MARGIN);
    expect(inside(low)).toBeTrue();
  });

  it('switches to the other side when the preferred one has no room', () => {
    const wideRight = { left: 300, top: 200, right: 900, bottom: 400 };
    const p = placeLabel({ x: 850, y: 300 }, wideRight, LABEL, VP);
    expect(p.side).toBe('left');
    expect(inside(p)).toBeTrue();
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
    expect(inside(p)).toBeTrue();
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
    expect(inside(off)).toBeTrue();
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
