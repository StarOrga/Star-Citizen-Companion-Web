import * as THREE from 'three';
import { HoloLook } from './holo-look';
import { DEFAULT_HOLO_VARIANT, holoVariantFrom } from './holo-variant';

const ACCENT = [82, 193, 230] as const;

function box(): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(2, 1, 4), new THREE.MeshStandardMaterial());
}

function edgeChild(mesh: THREE.Object3D): THREE.LineSegments | undefined {
  return mesh.children.find((c) => c.userData['holoEdges']) as THREE.LineSegments | undefined;
}

describe('holoVariantFrom', () => {
  it('reads ?holo=a|b|c, case-insensitive', () => {
    expect(holoVariantFrom('?holo=a')).toBe('a');
    expect(holoVariantFrom('?x=1&holo=B')).toBe('b');
    expect(holoVariantFrom('?holo=c')).toBe('c');
  });

  it('falls back to the default for a missing or unknown value', () => {
    expect(holoVariantFrom('')).toBe(DEFAULT_HOLO_VARIANT);
    expect(holoVariantFrom(null)).toBe(DEFAULT_HOLO_VARIANT);
    expect(holoVariantFrom('?holo=z')).toBe(DEFAULT_HOLO_VARIANT);
  });
});

describe('HoloLook', () => {
  let look: HoloLook;
  afterEach(() => look?.dispose());

  it('compiles the chosen variant into the shared shader', () => {
    look = new HoloLook('b', ACCENT, false);
    expect(look.fill('hull').defines['VARIANT']).toBe(1);
    expect(look.line('hull').blending).toBe(THREE.NormalBlending);
    look.dispose();
    look = new HoloLook('a', ACCENT, false);
    expect(look.fill('hull').defines['VARIANT']).toBe(0);
    expect(look.line('hull').blending).toBe(THREE.AdditiveBlending);
    expect(look.fill('hull').transparent).toBeFalse();
  });

  it('computes crease edges once per geometry and shares them between meshes', () => {
    look = new HoloLook('a', ACCENT, false);
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

  it('keeps meshes the filter rejects untouched', () => {
    look = new HoloLook('c', ACCENT, false);
    const keep = box();
    const original = keep.material;
    look.dress(new THREE.Group().add(keep), 'hull', () => false);
    expect(keep.material).toBe(original);
    expect(edgeChild(keep)).toBeUndefined();
  });

  it('disposes its edge geometry and materials on teardown', () => {
    look = new HoloLook('a', ACCENT, false);
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

  it('highlight: dims the hull and lights the focused component', () => {
    look = new HoloLook('b', ACCENT, false);
    const part = box();
    look.dress(part, 'part');
    look.setRole(part, 'focus', 10);
    look.setDim(true);
    look.setFocusPoints([new THREE.Vector3(1, 2, 3)]);
    expect(look.fill('hull').uniforms['uDim'].value).toBe(1);
    expect(look.line('hull').uniforms['uDim'].value).toBe(1);
    expect(part.material).toBe(look.fill('focus'));
    expect(look.fill('focus').uniforms['uGlow'].value).toBe(1);
    expect(look.fill('hull').uniforms['uGlow'].value).toBe(0);
    expect(look.focusCount).toBe(1);
    expect(part.renderOrder).toBe(10);
    look.setDim(false);
    look.setFocusPoints([]);
    expect(look.dimmed).toBeFalse();
    expect(look.focusCount).toBe(0);
  });

  it('x-ray opacity turns an opaque variant transparent and keeps a line floor', () => {
    look = new HoloLook('c', ACCENT, false);
    look.setOpacity('hull', 0.1);
    expect(look.fill('hull').transparent).toBeTrue();
    expect(look.fill('hull').uniforms['uOpacity'].value).toBe(0.1);
    expect(look.line('hull').uniforms['uOpacity'].value).toBeGreaterThan(0.3);
    look.setOpacity('hull', 1);
    expect(look.fill('hull').transparent).toBeFalse();
  });

  it('reduced motion stops the scan', () => {
    look = new HoloLook('a', ACCENT, true);
    expect(look.animated).toBeFalse();
    expect(look.fill('hull').uniforms['uScan'].value).toBe(0);
    look.tick(12);
    expect(look.fill('hull').uniforms['uTime'].value).toBe(0);
    look.dispose();
    look = new HoloLook('a', ACCENT, false);
    expect(look.animated).toBeTrue();
    expect(look.fill('hull').uniforms['uScan'].value).toBe(1);
    look.tick(3);
    expect(look.fill('hull').uniforms['uTime'].value).toBe(3);
  });

  it('only the concept holo animates', () => {
    look = new HoloLook('b', ACCENT, false);
    expect(look.animated).toBeFalse();
  });
});
