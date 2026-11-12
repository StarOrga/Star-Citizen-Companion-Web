import { SWAP_WORKER_TIMEOUT_MS, SwapWorkerReply, SwapWorkerRequest, SwapWorkerResult } from './codex-swap-worker-protocol';

let worker: Worker | null | undefined;
let nextId = 1;
const open = new Map<number, { rows: Record<string, unknown>[]; done: (r: SwapWorkerResult) => void }>();

function spawn(): Worker | null {
  if (worker !== undefined) return worker;
  worker = null;
  if (typeof Worker !== 'function') return null;
  try {
    const w = new Worker(new URL('./codex-swap.worker', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<SwapWorkerReply>) => {
      const m = e.data;
      const job = open.get(m.id);
      if (!job) return;
      if (m.kind === 'rows') {
        for (const r of m.rows) job.rows.push(r as Record<string, unknown>);
        return;
      }
      open.delete(m.id);
      job.done(m.kind === 'done' ? { rows: job.rows } : { status: m.status, code: m.code });
    };
    w.onerror = () => {
      // A worker that cannot start (CSP, an old engine): every open and later read goes back to the page.
      w.terminate();
      worker = null;
      for (const job of open.values()) job.done(null);
      open.clear();
    };
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

/** One RPC read through the swap worker; resolves `null` when there is no worker to ask. */
export function readRpcInWorker(base: string, key: string, fn: string, args: Record<string, unknown>): Promise<SwapWorkerResult> {
  const w = spawn();
  if (!w) return Promise.resolve(null);
  return new Promise((done) => {
    const id = nextId++;
    open.set(id, { rows: [], done });
    const req: SwapWorkerRequest = { id, url: `${base}rpc/${fn}`, key, args, timeoutMs: SWAP_WORKER_TIMEOUT_MS };
    w.postMessage(req);
  });
}
