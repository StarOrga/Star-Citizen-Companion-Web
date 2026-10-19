/**
 * The environment every Python sidecar is spawned with.
 *
 * Carries two variables, both decided by `main/resources.ts` (which calls
 * {@link setSidecarGpu}) from the operator's GPU limit `gpuPct`:
 *  - `SC_USE_GPU=1|0` — '1' exactly when `gpuPct > 0` AND a GPU path is
 *    available. A sidecar decides GPU vs CPU only from this variable; when its
 *    GPU init fails anyway it falls back to CPU on its own.
 *  - `SC_GPU_SHARE=<0..100>` — the share of the GPU the run may load (string
 *    int; '0' whenever `SC_USE_GPU=0`). Windows cannot hard-cap a GPU, so this
 *    is the soft lever a GPU stage may pace itself by (fewer GPU workers, a
 *    pause between batches). A sidecar that ignores it simply runs at full
 *    share.
 *
 * Neither is overridable through `extra`. Its own module (no Electron import)
 * so every bridge can use it without pulling `resources.ts` — which imports
 * `python-bridge.ts` — into a cycle.
 */

let useGpu = false;
let gpuShare = 0;

/** `on` = use the GPU; `share` = the GPU limit 0..100 (ignored, forced 0, while off). */
export function setSidecarGpu(on: boolean, share = 100): void {
  const s = Number.isFinite(share) ? Math.round(Math.min(100, Math.max(0, share))) : 0;
  useGpu = on && s > 0;
  gpuShare = useGpu ? s : 0;
}

export function sidecarEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { ...process.env, ...extra, SC_USE_GPU: useGpu ? '1' : '0', SC_GPU_SHARE: String(gpuShare) };
}
