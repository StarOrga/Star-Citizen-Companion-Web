import { PLANETS, SUN_DIR, turnAt } from './body-engine';
import { PLANET_FS, PROMINENCES, SUN_FS } from './body-shaders';

describe('body engine', () => {
  it('turns with the wall clock and wraps every period', () => {
    expect(turnAt(100, 0)).toBe(0);
    expect(turnAt(100, 25_000)).toBeCloseTo(0.25, 6);
    expect(turnAt(100, 125_000)).toBeCloseTo(0.25, 6);
    expect(turnAt(0, 5_000)).toBe(0);
  });

  it('lights every body from the top right, towards the viewer', () => {
    const [x, y, z] = SUN_DIR;
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6);
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0);
    expect(z).toBeGreaterThan(0);
  });

  it('turns every planet slowly (one to four minutes) and names its maps', () => {
    for (const spec of Object.values(PLANETS)) {
      expect(spec.period).toBeGreaterThanOrEqual(60);
      expect(spec.period).toBeLessThanOrEqual(240);
      expect(spec.layers.day).toBeTruthy();
      expect(spec.layers.night).toBeTruthy();
    }
  });

  it('gives the prominences unrelated clocks, so the storms never fall into a beat', () => {
    const periods = PROMINENCES.map((p) => p[1]);
    expect(new Set(periods).size).toBe(periods.length);
    expect(PROMINENCES.some((p) => p[4] === 1)).toBeTrue();
  });

  it('compiles both shaders in this browser', () => {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return pending('no WebGL in this browser');
    const deriv = !!gl.getExtension('OES_standard_derivatives');
    for (const src of [PLANET_FS(deriv), SUN_FS]) {
      const s = gl.createShader(gl.FRAGMENT_SHADER)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      expect(gl.getShaderParameter(s, gl.COMPILE_STATUS)).withContext(gl.getShaderInfoLog(s) ?? '').toBeTrue();
    }
  });
});
