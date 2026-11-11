/** Messages between the page and `codex-swap.worker.ts`. */
export interface SwapWorkerRequest {
  id: number;
  /** Full RPC URL. */
  url: string;
  /** Publishable key (apikey + bearer: the lists are public catalog data). */
  key: string;
  args: Record<string, unknown>;
  timeoutMs: number;
}

export type SwapWorkerReply =
  | { id: number; kind: 'rows'; rows: unknown[] }
  | { id: number; kind: 'done' }
  | { id: number; kind: 'failed'; status: number; code: string | null };

/** Rows per message: a slice decodes on the page in a few ms. */
export const SWAP_WORKER_SLICE = 12;

/** Same deadline as every other PostgREST read (`core/deadline.ts`). */
export const SWAP_WORKER_TIMEOUT_MS = 20_000;

/** Outcome of a worker read: the rows, a PostgREST failure, or `null` = no worker (use the page's client). */
export type SwapWorkerResult = { rows: Record<string, unknown>[] } | { status: number; code: string | null } | null;

