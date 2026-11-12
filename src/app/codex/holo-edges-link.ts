import { HoloEdgeJob, creaseEdgeArray } from './holo-edges';

/** Computes crease edges somewhere — the worker where there is one. */
export type HoloEdgeCompute = (job: HoloEdgeJob) => Promise<Float32Array | null>;

let worker: Worker | null | undefined;
let nextId = 1;
const pending = new Map<number, (edges: Float32Array | null) => void>();

function spawn(): Worker | null {
  if (worker !== undefined) return worker;
  worker = null;
  if (typeof Worker !== 'function') return null;
  try {
    worker = new Worker(new URL('./holo-edges.worker', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; edges: Float32Array | null }>) => {
      const done = pending.get(e.data.id);
      pending.delete(e.data.id);
      done?.(e.data.edges);
    };
    worker.onerror = () => {
      // A worker that cannot start (CSP, an old browser) leaves every open job to the page.
      worker?.terminate();
      worker = null;
      for (const done of pending.values()) done(undefined as unknown as null);
      pending.clear();
    };
  } catch {
    worker = null;
  }
  return worker;
}

/**
 * Crease edges off the main thread: a hull's edges once took 250 ms in the frame the model
 * loaded — in the middle of the camera flight to the Codex (Wave 2d trace). The job's arrays
 * are copies of the geometry; without a worker the page computes them itself in
 * a later task.
 */
export const workerEdgeCompute: HoloEdgeCompute = (job) => {
  const w = spawn();
  if (!w) return new Promise((resolve) => setTimeout(() => resolve(creaseEdgeArray(job)), 0));
  return new Promise((resolve) => {
    const id = nextId++;
    // `undefined` from onerror = the worker died: compute here instead.
    pending.set(id, (edges) => resolve(edges === undefined ? creaseEdgeArray(job) : edges));
    // Cloned, not transferred (a typed-array clone is a plain copy): the page keeps its job for
    // the fallback when the worker dies on the way.
    w.postMessage({ id, job });
  });
};
