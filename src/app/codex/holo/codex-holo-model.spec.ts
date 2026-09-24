import { ringPositions, shipNameWithoutMaker } from './codex-holo-model';

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
