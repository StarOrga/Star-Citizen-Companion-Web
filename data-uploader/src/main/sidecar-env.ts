/**
 * The environment every Python sidecar is spawned with.
 *
 * Carries `SC_USE_GPU=1|0` — '1' exactly when the operator switched "use GPU"
 * on AND a GPU path is available (`main/resources.ts` decides and calls
 * {@link setSidecarGpu}). A sidecar reads only this variable; when its GPU
 * init fails anyway it falls back to CPU on its own.
 *
 * Its own module (no Electron import) so every bridge can use it without
 * pulling `resources.ts` — which imports `python-bridge.ts` — into a cycle.
 */

let useGpu = false;

export function setSidecarGpu(on: boolean): void {
  useGpu = on;
}

export function sidecarEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...process.env, ...extra, SC_USE_GPU: useGpu ? '1' : '0' };
}
