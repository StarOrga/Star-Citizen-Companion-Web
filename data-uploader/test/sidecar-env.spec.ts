import { afterEach, describe, expect, it } from 'vitest';
import { setSidecarGpu, sidecarEnv } from '../src/main/sidecar-env.js';

describe('sidecar env', () => {
  afterEach(() => setSidecarGpu(false));

  it('always carries SC_USE_GPU, 0 by default', () => {
    expect(sidecarEnv().SC_USE_GPU).toBe('0');
    setSidecarGpu(true);
    expect(sidecarEnv().SC_USE_GPU).toBe('1');
  });

  it('keeps the parent env and extra vars, but SC_USE_GPU is not overridable', () => {
    const env = sidecarEnv({ SC_GLTF_TRANSFORM_ARGV: 'x', SC_USE_GPU: '1' });
    expect(env.SC_GLTF_TRANSFORM_ARGV).toBe('x');
    expect(env.SC_USE_GPU).toBe('0');
    expect(env.PATH ?? env.Path).toBe(process.env.PATH ?? process.env.Path);
  });
});
