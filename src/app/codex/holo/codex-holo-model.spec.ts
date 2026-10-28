import { PIN_MIN_GAP, ringPositions, shipNameWithoutMaker, spreadStackedPins } from './codex-holo-model';

function gaps(points: { x: number; y: number }[]): number[] {
  return points.map((p, i) => {
    const q = points[(i + 1) % points.length];
    return Math.hypot(q.x - p.x, q.y - p.y);
  });
}

describe('ringPositions', () => {
  it('starts at the nose (top centre) and runs clockwise', () => {
    const pts = ringPositions({ cx: 50, cy: 50, rx: 40, ry: 40 }, 4);
    expect(pts[0].x).toBeCloseTo(50, 5);
    expect(pts[0].y).toBeCloseTo(10, 5);
    expect(pts[1].x).toBeCloseTo(90, 5); // east second = clockwise on screen
    expect(pts[2].y).toBeCloseTo(90, 5);
    expect(pts[3].x).toBeCloseTo(10, 5);
  });

  // A capital ship's ring is tall and narrow: equal ANGLE steps bunched its
  // nose and tail pins on top of each other while the flanks stayed sparse.
  it('keeps neighbours equally far apart on an elongated ring', () => {
    const pts = ringPositions({ cx: 50, cy: 50, rx: 20, ry: 54 }, 41);
    const g = gaps(pts);
    const min = Math.min(...g);
    const max = Math.max(...g);
    expect(min / max).toBeGreaterThan(0.95);
  });

  it('returns nothing for no pins', () => {
    expect(ringPositions({ cx: 50, cy: 50, rx: 40, ry: 40 }, 0)).toEqual([]);
  });
});

describe('spreadStackedPins', () => {
  function minGap(points: { x: number; y: number }[]): number {
    let min = Infinity;
    for (let i = 0; i < points.length; i++)
      for (let j = i + 1; j < points.length; j++) min = Math.min(min, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y));
    return min;
  }

  it('keeps pins that stand alone exactly on their anchor', () => {
    const pts = [{ x: 20, y: 30 }, { x: 70, y: 30 }, { x: 50, y: 80 }];
    expect(spreadStackedPins(pts)).toEqual(pts);
  });

  it('fans out coinciding anchors so every dot stays visible (Nomad: 3 shield generators on one spot)', () => {
    const out = spreadStackedPins([{ x: 50, y: 40 }, { x: 50, y: 40 }, { x: 50.5, y: 40.2 }, { x: 20, y: 70 }]);
    expect(minGap(out)).toBeGreaterThanOrEqual(PIN_MIN_GAP - 1e-9);
    expect(out[3]).toEqual({ x: 20, y: 70 });
    // The cluster stays centred on where the parts really are.
    const cx = (out[0].x + out[1].x + out[2].x) / 3;
    const cy = (out[0].y + out[1].y + out[2].y) / 3;
    expect(cx).toBeCloseTo(50.1667, 3);
    expect(cy).toBeCloseTo(40.0667, 3);
  });

  it('puts a stacked pair side by side, first pin on the left', () => {
    const [a, b] = spreadStackedPins([{ x: 50, y: 50 }, { x: 50, y: 50 }]);
    expect(a.x).toBeLessThan(b.x);
    expect(a.y).toBeCloseTo(b.y, 6);
    expect(b.x - a.x).toBeCloseTo(PIN_MIN_GAP, 6);
  });

  it('pushes a fanned-out pair off the neighbour it lands on (Nomad: 1 under 16)', () => {
    // The pair fans out to 46.75 / 53.25 — right onto the lone pin at 43.
    const out = spreadStackedPins([{ x: 50, y: 56.5 }, { x: 50, y: 56.5 }, { x: 41, y: 56.5 }, { x: 50, y: 10 }]);
    expect(minGap(out)).toBeGreaterThanOrEqual(PIN_MIN_GAP - 1e-6);
    expect(out[3]).toEqual({ x: 50, y: 10 });
  });

  it('steps an estimated ring pin off an anchored dot (Nomad: 15 over 3)', () => {
    const out = spreadStackedPins([{ x: 50, y: 7.2 }, { x: 50, y: 4 }]);
    expect(minGap(out)).toBeGreaterThanOrEqual(PIN_MIN_GAP - 1e-6);
    for (const p of out) expect(p.y).toBeGreaterThanOrEqual(0);
  });

  it('chains near neighbours into one cluster and stays on the canvas', () => {
    // 40↔43 and 43↔46 are each too close; 40↔46 alone would not be.
    expect(minGap(spreadStackedPins([{ x: 40, y: 50 }, { x: 43, y: 50 }, { x: 46, y: 50 }]))).toBeGreaterThanOrEqual(PIN_MIN_GAP - 1e-9);
    for (const p of spreadStackedPins([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }])) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('shipNameWithoutMaker', () => {
  it('drops the maker word the display name repeats', () => {
    expect(shipNameWithoutMaker('Aegis Avenger Stalker', 'Aegis Dynamics')).toBe('Avenger Stalker');
    expect(shipNameWithoutMaker('Drake Cutlass Black', 'Drake Interplanetary')).toBe('Cutlass Black');
  });

  it('keeps names that do not start with the maker word, and bare maker names', () => {
    expect(shipNameWithoutMaker('RSI Polaris', 'Roberts Space Industries')).toBe('RSI Polaris');
    expect(shipNameWithoutMaker('Aegis', 'Aegis Dynamics')).toBe('Aegis');
    expect(shipNameWithoutMaker('Idris-P', null)).toBe('Idris-P');
  });
});
