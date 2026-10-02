import * as THREE from 'three';
import {
  SUIT_PARTS,
  ZONE_ORDER,
  buildHardsuit,
  convexHull,
  fallbackAnchors,
  pointInPolygon,
} from './codex-board-suit';

// Projection, zones-vs-anchors and paintPart are pinned in
// codex-board-figure.component.spec.ts; these cover the geometry helpers.
describe('codex-board-suit helpers', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];

  it('convexHull drops interior points and keeps the corners', () => {
    const hull = convexHull([...square, { x: 0.5, y: 0.5 }, { x: 0.2, y: 0.8 }]);
    expect(hull.length).toBe(4);
    for (const c of square) expect(hull).toContain(jasmine.objectContaining(c));
  });

  it('convexHull returns fewer than three points unchanged', () => {
    expect(convexHull([{ x: 1, y: 2 }])).toEqual([{ x: 1, y: 2 }]);
    expect(convexHull([])).toEqual([]);
  });

  it('pointInPolygon tells inside from outside', () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, square)).toBeTrue();
    expect(pointInPolygon({ x: 1.5, y: 0.5 }, square)).toBeFalse();
    expect(pointInPolygon({ x: 0.5, y: -0.1 }, square)).toBeFalse();
  });

  it('places every fallback anchor inside the figure box, left of its right twin', () => {
    const anchors = fallbackAnchors();
    for (const part of SUIT_PARTS) {
      const { left, right } = anchors[part];
      for (const p of [left, right]) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1);
      }
      expect(left.x).toBeLessThan(right.x);
    }
  });

  it('paints every part exactly once in ZONE_ORDER, helmet last (on top)', () => {
    expect([...ZONE_ORDER].sort()).toEqual([...SUIT_PARTS].sort());
    expect(ZONE_ORDER[ZONE_ORDER.length - 1]).toBe('helmet');
  });

  it('dispose() frees every geometry and material of the suit', () => {
    const suit = buildHardsuit(THREE, { idle: '#3d5a6c', tint: '#f0c27b', accent: '#52c1e6' });
    const geometries: THREE.BufferGeometry[] = [];
    suit.root.traverse((n) => {
      const m = n as THREE.Mesh;
      if (m.isMesh) geometries.push(m.geometry);
    });
    const disposed = geometries.map((g) => spyOn(g, 'dispose').and.callThrough());
    const materials = [...SUIT_PARTS.map((p) => suit.armour[p]), suit.joint, suit.glass].map((m) =>
      spyOn(m, 'dispose').and.callThrough(),
    );

    suit.dispose();

    expect(geometries.length).toBeGreaterThan(20);
    for (const s of [...disposed, ...materials]) expect(s).toHaveBeenCalled();
  });
});
