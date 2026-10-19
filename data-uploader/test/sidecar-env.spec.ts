import { afterEach, describe, expect, it } from 'vitest';
import { setSidecarGpu, sidecarEnv } from '../src/main/sidecar-env.js';

describe('sidecar env', () => {
  afterEach(() => setSidecarGpu(false));

  it('always carries SC_USE_GPU and SC_GPU_SHARE, off by default', () => {
    expect(sidecarEnv().SC_USE_GPU).toBe('0');
    expect(sidecarEnv().SC_GPU_SHARE).toBe('0');
    setSidecarGpu(true);
    expect(sidecarEnv().SC_USE_GPU).toBe('1');
    expect(sidecarEnv().SC_GPU_SHARE).toBe('100');
  });

  it('passes the GPU limit as an integer share, and a share of 0 means GPU off', () => {
    setSidecarGpu(true, 80);
    expect(sidecarEnv()).toMatchObject({ SC_USE_GPU: '1', SC_GPU_SHARE: '80' });
    setSidecarGpu(true, 33.6);
    expect(sidecarEnv().SC_GPU_SHARE).toBe('34');
    setSidecarGpu(true, 0);
    expect(sidecarEnv()).toMatchObject({ SC_USE_GPU: '0', SC_GPU_SHARE: '0' });
    setSidecarGpu(false, 80);
    expect(sidecarEnv()).toMatchObject({ SC_USE_GPU: '0', SC_GPU_SHARE: '0' });
    setSidecarGpu(true, 250);
    expect(sidecarEnv().SC_GPU_SHARE).toBe('100');
    setSidecarGpu(true, Number.NaN);
    expect(sidecarEnv().SC_USE_GPU).toBe('0');
  });

  it('keeps the parent env and extra vars, but the GPU vars are not overridable', () => {
    const env = sidecarEnv({ SC_GLTF_TRANSFORM_ARGV: 'x', SC_USE_GPU: '1', SC_GPU_SHARE: '100' });
    expect(env.SC_GLTF_TRANSFORM_ARGV).toBe('x');
    expect(env.SC_USE_GPU).toBe('0');
    expect(env.SC_GPU_SHARE).toBe('0');
    expect(env.PATH ?? env.Path).toBe(process.env.PATH ?? process.env.Path);
  });
});
