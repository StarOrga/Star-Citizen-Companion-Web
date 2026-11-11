import * as THREE from 'three';
import { PackageScene, isSoftwareRenderer, startViewDir } from './asset-package-scene';

/** A renderer whose GL context reports `name` as its unmasked renderer string. */
function rendererNamed(name: string | null, withDebugInfo = true): THREE.WebGLRenderer {
  const gl = {
    RENDERER: 0x1f01,
    getExtension: (ext: string) => (withDebugInfo && ext === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null),
    getParameter: () => name,
  };
  return { getContext: () => gl } as unknown as THREE.WebGLRenderer;
}

describe('isSoftwareRenderer', () => {
  it('flags CPU WebGL, where the animated loop would freeze the page', () => {
    expect(isSoftwareRenderer(rendererNamed('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'))).toBe(true);
    expect(isSoftwareRenderer(rendererNamed('llvmpipe (LLVM 15.0.7, 256 bits)'))).toBe(true);
    expect(isSoftwareRenderer(rendererNamed('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)'))).toBe(true);
  });

  it('keeps real GPUs animated, and falls back to the plain renderer name', () => {
    expect(isSoftwareRenderer(rendererNamed('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)'))).toBe(false);
    expect(isSoftwareRenderer(rendererNamed('Apple GPU', false))).toBe(false);
    expect(isSoftwareRenderer(rendererNamed(null))).toBe(false);
  });
});

describe('startViewDir', () => {
  it('keeps the side quarter by default and turns half round for the nose view', () => {
    const side = startViewDir('side');
    const nose = startViewDir('nose');
    expect(side).toEqual([1, 0.55, 1.25]);
    // Same height, opposite horizontal side: the camera sits off the -Z (nose) end.
    expect(nose[1]).toBe(side[1]);
    expect(nose[0]).toBe(-side[0]);
    expect(nose[2]).toBeLessThan(0);
  });
});

interface SceneInternals {
  camera: THREE.PerspectiveCamera;
  controls: { target: THREE.Vector3; update(): void };
  keepFit(): void;
}

describe('PackageScene camera distance', () => {
  let scene: PackageScene;
  let internals: SceneInternals;

  beforeEach(() => {
    const canvas = document.createElement('canvas');
    scene = new PackageScene(canvas, [0.2, 0.6, 0.8], [0.9, 0.5, 0.2], true, () => undefined);
    internals = scene as unknown as SceneInternals;
    scene.resize(1200, 700);
    scene.setSafeArea({ left: 120, right: 120, top: 80, bottom: 80 });
    // A long, flat hull: its fit differs a lot between side and nose views.
    scene.frame({ min: [-20, -2, -5], max: [20, 2, 5] }, 'side');
  });

  afterEach(() => scene.dispose());

  const distance = (): number => internals.camera.position.distanceTo(internals.controls.target);

  /** What OrbitControls does when dragged: swing the camera on a sphere round the target. */
  function orbitTo(azimuth: number, polar: number): void {
    const d = distance();
    const p = new THREE.Vector3().setFromSphericalCoords(d, polar, azimuth);
    internals.camera.position.copy(internals.controls.target).add(p);
    internals.camera.lookAt(internals.controls.target);
    internals.keepFit();
  }

  it('keeps the distance constant while rotating from side to nose to top', () => {
    const start = distance();
    for (const [az, polar] of [[0, 1.2], [Math.PI / 2, 1.4], [Math.PI, 1.1], [1, 0.4], [2, 2.4]]) {
      orbitTo(az, polar);
      expect(distance()).toBeCloseTo(start, 6);
    }
  });

  it('still zooms with the wheel and carries the zoom through a rotation', () => {
    const start = distance();
    scene.zoomBy(-200);
    const zoomed = distance();
    expect(zoomed).toBeLessThan(start);
    orbitTo(Math.PI / 2, 1.3);
    expect(distance()).toBeCloseTo(zoomed, 6);
  });

  it('re-solves on a viewport change and on re-framing', () => {
    const start = distance();
    scene.resize(500, 700);
    expect(distance()).not.toBeCloseTo(start, 3);
    scene.frame({ min: [-20, -2, -5], max: [20, 2, 5] }, 'side');
    scene.resize(1200, 700);
    expect(distance()).toBeCloseTo(start, 3);
  });
});
