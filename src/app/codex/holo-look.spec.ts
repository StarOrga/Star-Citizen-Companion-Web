import * as THREE from 'three';
import {
  FULL_DETAIL,
  HOLO_CREASE_DEG,
  HOLO_CREASE_DEG_MAX,
  HOLO_SCANLINES,
  HOLO_SWEEP,
  HoloLook,
  countTriangles,
  edgeDetail,
} from './holo-look';

const BASE = [82, 193, 230] as const;
const DRAKE = [255, 176, 46] as const;

function box(w = 2, h = 1, d = 4): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial());
}

function edgeChild(mesh: THREE.Object3D): THREE.LineSegments | undefined {
  return mesh.children.find((c) => c.userData['holoEdges']) as THREE.LineSegments | undefined;
}

const rgbOf = (c: THREE.Color) => [c.r, c.g, c.b].map((v) => Math.round(v * 255));

describe('edgeDetail (line thinning by hull size)', () => {
  it('keeps every crease line on a fighter', () => {
    const d = edgeDetail(22, 80_000);
    expect(d.thinning).toBe(0);
    expect(d.creaseDeg).toBe(HOLO_CREASE_DEG);
    expect(d.minSegment).toBe(0);
  });

  it('thins a capital hull to its coarse character edges', () => {
    const d = edgeDetail(155, 900_000);
    expect(d.thinning).toBe(1);
    expect(d.creaseDeg).toBe(HOLO_CREASE_DEG_MAX);
    expect(d.minSegment).toBeCloseTo(155 * 0.006, 5);
  });

  it('grows monotonically with size and with triangle count', () => {
    const small = edgeDetail(60, 50_000);
    const big = edgeDetail(110, 50_000);
    expect(big.creaseDeg).toBeGreaterThan(small.creaseDeg);
    const dense = edgeDetail(25, 1_000_000);
    expect(dense.thinning).toBeGreaterThan(0);
    expect(dense.thinning).toBeLessThanOrEqual(1);
  });
});

describe('HoloLook', () => {
  let look: HoloLook;
  afterEach(() => look?.dispose());

  it('is one look: body in the base colour, accents in the manufacturer colour', () => {
    look = new HoloLook(BASE, DRAKE, false);
    const fill = look.fill('hull');
    expect(fill.defines?.['VARIANT']).toBeUndefined();
    expect(rgbOf(fill.uniforms['uTint'].value)).toEqual([...BASE]);
    expect(rgbOf(fill.uniforms['uAccent'].value)).toEqual([...DRAKE]);
    expect(rgbOf(look.line('focus').uniforms['uAccent'].value)).toEqual([...DRAKE]);
    expect(rgbOf(look.accent)).toEqual([...DRAKE]);
    expect(look.line('hull').blending).toBe(THREE.AdditiveBlending);
    expect(fill.transparent).toBeFalse();
  });

  it('draws subtler scanlines and sweep than the concept study', () => {
    look = new HoloLook(BASE, BASE, false);
    expect(HOLO_SCANLINES).toBeLessThan(0.05);
    expect(HOLO_SWEEP).toBeLessThan(0.32);
    expect(look.fill('hull').uniforms['uLines'].value).toBe(HOLO_SCANLINES);
    expect(look.fill('hull').uniforms['uSweep'].value).toBe(HOLO_SWEEP);
  });

  it('computes crease edges once per geometry and shares them between meshes', () => {
    look = new HoloLook(BASE, BASE, false);
    const a = box();
    const b = new THREE.Mesh(a.geometry, new THREE.MeshStandardMaterial());
    const root = new THREE.Group().add(a, b);
    look.dress(root, 'hull');
    look.dress(root, 'hull'); // re-dress: no second edge child, no recompute
    expect(look.edgeCacheSize).toBe(1);
    expect(a.children.filter((c) => c.userData['holoEdges']).length).toBe(1);
    expect(edgeChild(a)!.geometry).toBe(edgeChild(b)!.geometry);
    expect(a.material).toBe(look.fill('hull'));
    expect(edgeChild(a)!.material).toBe(look.line('hull'));
  });

  it('fit() thins the hull lines of a big ship and leaves parts at full detail', () => {
    look = new HoloLook(BASE, BASE, false);
    look.fit(new THREE.Box3(new THREE.Vector3(-80, -15, -20), new THREE.Vector3(80, 15, 20)), 900_000);
    expect(look.detail.thinning).toBe(1);
    // The minimum segment is 160 m * 0.006 = 0.96 m: a hull panel keeps all 12 edges.
    const hull = box(40, 10, 60);
    const greeble = box(0.4, 0.4, 0.4);
    look.dress(new THREE.Group().add(hull, greeble), 'hull');
    expect(edgeChild(hull)!.geometry.getAttribute('position').count).toBe(24);
    // Every edge of the 0.4 m greeble is shorter than the minimum segment: no lines.
    expect(edgeChild(greeble)!.geometry.getAttribute('position').count).toBe(0);
    const part = box(0.4, 0.4, 0.4);
    look.dress(part, 'part');
    expect(edgeChild(part)!.geometry.getAttribute('position').count).toBe(24);
    expect(FULL_DETAIL.minSegment).toBe(0);
  });

  it('counts triangles of every mesh', () => {
    expect(countTriangles(new THREE.Group().add(box(), box()))).toBe(24);
  });

  it('keeps meshes the filter rejects untouched', () => {
    look = new HoloLook(BASE, BASE, false);
    const keep = box();
    const original = keep.material;
    look.dress(new THREE.Group().add(keep), 'hull', () => false);
    expect(keep.material).toBe(original);
    expect(edgeChild(keep)).toBeUndefined();
  });

  it('disposes its edge geometry and materials on teardown', () => {
    look = new HoloLook(BASE, BASE, false);
    const mesh = box();
    look.dress(mesh, 'hull');
    const edges = edgeChild(mesh)!.geometry;
    const fill = look.fill('hull');
    spyOn(edges, 'dispose').and.callThrough();
    spyOn(fill, 'dispose').and.callThrough();
    look.dispose();
    expect(edges.dispose).toHaveBeenCalled();
    expect(fill.dispose).toHaveBeenCalled();
    expect(look.edgeCacheSize).toBe(0);
  });

  it('highlight: dims the hull, lights the focused component as a model in the transparent pass', () => {
    look = new HoloLook(BASE, DRAKE, false);
    const part = box();
    look.dress(part, 'part');
    look.setRole(part, 'focus', 10);
    look.setDim(true);
    look.setFocusPoints([new THREE.Vector3(1, 2, 3)]);
    expect(look.fill('hull').uniforms['uDim'].value).toBe(1);
    expect(look.line('hull').uniforms['uDim'].value).toBe(1);
    expect(part.material).toBe(look.fill('focus'));
    expect(look.fill('focus').uniforms['uGlow'].value).toBe(1);
    // Drawn after the glow halo (transparent pass) but still writing depth.
    expect(look.fill('focus').transparent).toBeTrue();
    expect(look.fill('focus').depthWrite).toBeTrue();
    expect(look.fill('hull').uniforms['uGlow'].value).toBe(0);
    expect(look.focusCount).toBe(1);
    expect(part.renderOrder).toBe(10);
    expect(edgeChild(part)!.renderOrder).toBe(11);
    look.setDim(false);
    look.setFocusPoints([]);
    expect(look.dimmed).toBeFalse();
    expect(look.focusCount).toBe(0);
  });

  it('x-ray opacity turns the hull transparent and keeps a line floor', () => {
    look = new HoloLook(BASE, BASE, false);
    look.setOpacity('hull', 0.1);
    expect(look.fill('hull').transparent).toBeTrue();
    expect(look.fill('hull').uniforms['uOpacity'].value).toBe(0.1);
    expect(look.line('hull').uniforms['uOpacity'].value).toBeGreaterThan(0.15);
    look.setOpacity('hull', 1);
    expect(look.fill('hull').transparent).toBeFalse();
  });

  it('fit() scales the glow cloud to the hull', () => {
    look = new HoloLook(BASE, BASE, false);
    look.fit(new THREE.Box3(new THREE.Vector3(-10, -2, -5), new THREE.Vector3(10, 2, 5)));
    expect(look.focusRadius).toBeCloseTo(20 * 0.07, 5);
  });

  it('reduced motion stops the scan', () => {
    look = new HoloLook(BASE, BASE, true);
    expect(look.animated).toBeFalse();
    expect(look.fill('hull').uniforms['uScan'].value).toBe(0);
    look.tick(12);
    expect(look.fill('hull').uniforms['uTime'].value).toBe(0);
    look.dispose();
    look = new HoloLook(BASE, BASE, false);
    expect(look.animated).toBeTrue();
    expect(look.fill('hull').uniforms['uScan'].value).toBe(1);
    look.tick(3);
    expect(look.fill('hull').uniforms['uTime'].value).toBe(3);
  });
});
