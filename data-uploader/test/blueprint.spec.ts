import { describe, expect, it } from 'vitest';
import { Document, NodeIO } from '@gltf-transform/core';
import {
  type TriMesh,
  coverageMask,
  featureLines,
  loopArea,
  meshExtent,
  rasterize,
  simplify,
  simplifyLoop,
  traceContours,
  viewCoords,
  viewWindow,
} from '../src/lib/blueprint/geometry';
import { buildBlueprints, LODS } from '../src/lib/blueprint/build';
import { pathData } from '../src/lib/blueprint/svg';
import { loadHullMesh } from '../src/lib/blueprint/glb';

/** Axis-aligned box as 12 triangles (outward winding), glTF space. */
function box(min: [number, number, number], max: [number, number, number], base = 0): { p: number[]; i: number[] } {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const p = [
    x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
  ];
  const faces = [
    [0, 2, 1], [0, 3, 2], // -z
    [4, 5, 6], [4, 6, 7], // +z
    [0, 1, 5], [0, 5, 4], // -y
    [3, 7, 6], [3, 6, 2], // +y
    [0, 4, 7], [0, 7, 3], // -x
    [1, 2, 6], [1, 6, 5], // +x
  ];
  return { p, i: faces.flat().map((v) => v + base) };
}

function mesh(...boxes: [[number, number, number], [number, number, number]][]): TriMesh {
  const p: number[] = [];
  const i: number[] = [];
  for (const [min, max] of boxes) {
    const b = box(min, max, p.length / 3);
    p.push(...b.p);
    i.push(...b.i);
  }
  return { positions: Float32Array.from(p), indices: Uint32Array.from(i) };
}

const HULL = mesh([[-2, -1, -5], [2, 1, 5]]);
/** A 10 m hull with a 2 m deckhouse on top — the deckhouse edges are visible creases from above. */
const STEPPED = mesh([[-2, -1, -5], [2, 1, 5]], [[-1, 1, -2], [1, 2, 2]]);

describe('blueprint geometry', () => {
  it('maps model axes to drawing axes, nose (-z) to the right', () => {
    expect(viewCoords('top', 1, 2, -3)).toEqual([3, 1, 2]);
    expect(viewCoords('side', 1, 2, -3)).toEqual([3, -2, 1]);
  });

  it('rasterizes a box to its projected footprint', () => {
    const e = meshExtent(HULL)!;
    const win = viewWindow('top', e);
    expect(win.uSpan).toBe(10);
    expect(win.vSpan).toBe(4);
    const r = rasterize(HULL, win, 10);
    const covered = r.depth.reduce((n, d) => n + (d > -Infinity ? 1 : 0), 0);
    // 100 x 40 px, give or take the edge row/column.
    expect(covered).toBeGreaterThan(3900);
    expect(covered).toBeLessThan(4300);
    // Seen from above, the nearest surface is the top face (y = 1).
    expect(r.depth[(r.pad + 20) * r.w + r.pad + 50]).toBeCloseTo(1, 5);
  });

  it('traces one closed loop around a filled square, with the right area', () => {
    const w = 20;
    const h = 20;
    const m = new Uint8Array(w * h);
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) m[y * w + x] = 1;
    const loops = traceContours(m, w, h);
    expect(loops.length).toBe(1);
    // Marching squares over pixel centres: a 10x10 block traces ~ 9x9 + corners.
    expect(loopArea(loops[0]!)).toBeGreaterThan(80);
    expect(loopArea(loops[0]!)).toBeLessThan(100);
    const simple = simplifyLoop(loops[0]!, 0.75);
    expect(simple.length / 2).toBeLessThanOrEqual(8);
  });

  it('traces a hole as its own loop', () => {
    const w = 30;
    const m = new Uint8Array(w * w);
    for (let y = 3; y < 27; y++) for (let x = 3; x < 27; x++) m[y * w + x] = 1;
    for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) m[y * w + x] = 0;
    expect(traceContours(m, w, w).length).toBe(2);
  });

  it('simplify drops collinear points and keeps corners', () => {
    expect(simplify([0, 0, 1, 0, 2, 0, 3, 0, 3, 1, 3, 2], 0.1)).toEqual([0, 0, 3, 0, 3, 2]);
  });

  it('finds the deckhouse creases from above and hides nothing that is in plain view', () => {
    const e = meshExtent(STEPPED)!;
    const r = rasterize(STEPPED, viewWindow('top', e), 20);
    const lines = featureLines(STEPPED, r, coverageMask(r, 1));
    const major = lines.filter((l) => l.kind === 'major');
    // The deckhouse is 4 m x 2 m -> at 20 px/m its outline is ~240 px long.
    const total = major.reduce((n, l) => n + l.length, 0);
    expect(total).toBeGreaterThan(200);
    expect(total).toBeLessThan(280);
  });

  it('hides edges that a nearer surface covers', () => {
    // A small block UNDER a wide plate: invisible from above.
    const hidden = mesh([[-3, 0, -5], [3, 0.2, 5]], [[-1, -2, -2], [1, -0.5, 2]]);
    const e = meshExtent(hidden)!;
    const r = rasterize(hidden, viewWindow('top', e), 20);
    const lines = featureLines(hidden, r, coverageMask(r, 1));
    expect(lines.reduce((n, l) => n + l.length, 0)).toBeLessThan(5);
  });
});

describe('blueprint svg', () => {
  it('writes integer, relative path data', () => {
    expect(pathData([[1.2, 2.7, 4.4, 2.6, 4.4, 8.1]], false)).toBe('M1 3l3 0 0 5');
    expect(pathData([[0, 0, 5, 0, 5, 5]], true)).toBe('M0 0l5 0 0 5z');
    expect(pathData([[0, 0, 0.2, 0.1]], false)).toBe('');
  });

  it('builds a full (top + side) and an icon (top) drawing with working projections', () => {
    const res = buildBlueprints(STEPPED)!;
    expect(res.extentM).toEqual([10, 4, 3]);
    const full = res.full;
    expect(full).toContain('data-sc-blueprint="1"');
    expect(full).toContain('data-lod="full"');
    expect(full.match(/data-view="(top|side)"/g)).toEqual(['data-view="top"', 'data-view="side"']);
    expect(full).not.toMatch(/<script|on[a-z]+=|href/i);
    const proj = [...full.matchAll(/data-projection='([^']+)'/g)].map((m) => JSON.parse(m[1]!));
    const top = proj[0];
    const at = (m: number[][], x: number, y: number, z: number) => [
      m[0]![0]! * x + m[0]![1]! * y + m[0]![2]! * z + m[0]![3]!,
      m[1]![0]! * x + m[1]![1]! * y + m[1]![2]! * z + m[1]![3]!,
    ];
    // Nose tip (z = -5) on the starboard edge (x = 2) = right, bottom corner of the top box.
    const [bx, by, bw, bh] = top.box;
    const [nx, ny] = at(top.m, 2, 0, -5);
    expect(nx).toBeCloseTo(bx + bw, 0);
    expect(ny).toBeCloseTo(by + bh, 0);
    // Side view: the deckhouse roof (y = 2) is the top edge of the side box.
    const side = proj[1];
    expect(at(side.m, 0, 2, 0)[1]).toBeCloseTo(side.box[1], 0);
    // Long side = 1600 units at full detail.
    expect(bw).toBe(LODS.full.long);

    const icon = res.icon;
    expect(icon).toContain('data-lod="icon"');
    expect(icon.match(/data-view=/g)?.length).toBe(1);
    expect(icon).toContain('class="bp-hull"');
    expect(icon).not.toContain('bp-minor');
    expect(icon.length).toBeLessThan(full.length);
  });

  it('is deterministic', () => {
    expect(buildBlueprints(STEPPED)).toEqual(buildBlueprints(STEPPED));
  });

  it('refuses an empty or flat mesh', () => {
    expect(buildBlueprints({ positions: new Float32Array(), indices: new Uint32Array() })).toBeNull();
    expect(buildBlueprints(mesh([[0, 0, 0], [5, 0, 5]]))).toBeNull();
  });
});

describe('blueprint glb loader', () => {
  it('applies node transforms, dequantizes and welds across primitives', async () => {
    const doc = new Document();
    const buffer = doc.createBuffer();
    // Two triangles sharing an edge, in two primitives, quantized to int16 with a node scale.
    const q = (v: number) => Math.round(v * 32767);
    const posA = doc.createAccessor().setType('VEC3').setBuffer(buffer).setNormalized(true)
      .setArray(new Int16Array([q(0), q(0), q(0), q(1), q(0), q(0), q(0), q(0), q(1)]));
    const posB = doc.createAccessor().setType('VEC3').setBuffer(buffer).setNormalized(true)
      .setArray(new Int16Array([q(1), q(0), q(0), q(1), q(0), q(1), q(0), q(0), q(1)]));
    const m = doc.createMesh()
      .addPrimitive(doc.createPrimitive().setAttribute('POSITION', posA))
      .addPrimitive(doc.createPrimitive().setAttribute('POSITION', posB));
    const node = doc.createNode('Hull').setMesh(m).setScale([4, 4, 4]).setTranslation([10, 0, 0]);
    doc.createScene().addChild(node);
    const bytes = await new NodeIO().writeBinary(doc);
    const loaded = await loadHullMesh(bytes);
    expect(loaded.indices.length).toBe(6);
    // 4 distinct corners after welding (two are shared by both triangles).
    expect(loaded.positions.length / 3).toBe(4);
    const e = meshExtent(loaded)!;
    expect(e.min[0]).toBeCloseTo(10, 3);
    expect(e.max[0]).toBeCloseTo(14, 3);
    expect(e.max[2]).toBeCloseTo(4, 3);
  });
});
