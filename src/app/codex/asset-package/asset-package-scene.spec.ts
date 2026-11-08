import type * as THREE from 'three';
import { isSoftwareRenderer, startViewDir } from './asset-package-scene';

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
