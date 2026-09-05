/**
 * Type surface of `fetch-embedded-python.js` for the vitest suite
 * (`test/fetch-embedded-python.spec.ts`). The script stays plain JS because it
 * runs under bare `node` in CI before any build step; keep this in sync.
 */
export interface DownloadWithRetryOptions {
  /** Total attempts, default 4. */
  attempts?: number;
  /** First backoff in ms, doubled per attempt. Default 2000 (2s → 4s → 8s). */
  baseDelayMs?: number;
  fetchImpl?: (url: string, init: { redirect: 'follow' }) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

export function downloadWithRetry(
  url: string,
  dest: string,
  opts?: DownloadWithRetryOptions,
): Promise<void>;
