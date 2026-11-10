/// <reference lib="webworker" />
import { SWAP_WORKER_SLICE, SwapWorkerReply, SwapWorkerRequest } from './codex-swap-worker-protocol';

/**
 * Reads one `codex_swap_candidates` list and parses it here: a list is up to ~1 MB of JSON,
 * 100–300 ms of `JSON.parse` that used to land in the frame the picker opened. The rows go
 * back in small slices, so the page's share (structured-clone decode) stays a few ms a task.
 */
addEventListener('message', (e: MessageEvent<SwapWorkerRequest>) => void run(e.data));

async function run({ id, url, key, args, timeoutMs }: SwapWorkerRequest): Promise<void> {
  const reply = (m: SwapWorkerReply) => postMessage(m);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(args),
      signal: abort.signal,
    });
    if (!res.ok) {
      let code: string | null = null;
      try {
        code = ((await res.json()) as { code?: string } | null)?.code ?? null;
      } catch {
        // No JSON body: the status alone decides.
      }
      reply({ id, kind: 'failed', status: res.status, code });
      return;
    }
    const rows = (await res.json()) as unknown[];
    for (let i = 0; i < rows.length; i += SWAP_WORKER_SLICE) reply({ id, kind: 'rows', rows: rows.slice(i, i + SWAP_WORKER_SLICE) });
    reply({ id, kind: 'done' });
  } catch {
    reply({ id, kind: 'failed', status: 0, code: null });
  } finally {
    clearTimeout(timer);
  }
}
