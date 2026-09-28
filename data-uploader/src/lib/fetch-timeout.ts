/**
 * Deadlines for the uploader's network calls.
 *
 * Pure (no Electron import) so Vitest loads it directly. Every request of the
 * upload and auth path goes through one of these helpers, so no call can hang
 * forever on a stalled connection (AUD-052).
 */

export const DEFAULT_FETCH_TIMEOUT_MS = 60_000;

/** A request that ran past its deadline — an Error, so every existing retry/catch path treats it as transient. */
export class FetchTimeoutError extends Error {
  override readonly name = 'FetchTimeoutError';
  constructor(
    readonly url: string,
    readonly ms: number,
  ) {
    super(`timeout after ${Math.round(ms / 1000)} s: ${url}`);
  }
}

/** A deadline hit — ours (FetchTimeoutError) or the platform's AbortSignal.timeout (DOMException 'TimeoutError'). */
export function isTimeout(err: unknown): boolean {
  if (err instanceof FetchTimeoutError) return true;
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'TimeoutError';
}

/**
 * fetch with a deadline that covers headers AND body; a caller's own signal
 * still wins (its abort reason comes through unchanged).
 *
 * `fetchImpl` defaults per call, so `vi.stubGlobal('fetch', …)` in specs keeps working.
 */
export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  ms: number = DEFAULT_FETCH_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const deadline = AbortSignal.timeout(ms);
  const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  const url = String(input);
  try {
    return await fetchImpl(input, { ...init, signal });
  } catch (err) {
    if (deadline.aborted && !init.signal?.aborted && isTimeout(err)) throw new FetchTimeoutError(url, ms);
    throw err;
  }
}

/** Deadline for a PUT of `bytes`: 60 s plus 1 s per 100 kB (≥ 100 kB/s uplink). */
export function putTimeoutMs(bytes: number): number {
  return DEFAULT_FETCH_TIMEOUT_MS + Math.ceil(Math.max(0, bytes) / 100_000) * 1000;
}

/** Read a body to the end; abort when no chunk arrives for `stallMs`. */
export async function readWithStallTimeout(
  body: ReadableStream<Uint8Array>,
  stallMs: number,
  onChunk: (chunk: Uint8Array) => void,
  url = 'response body',
): Promise<void> {
  const reader = body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    for (;;) {
      const stalled = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new FetchTimeoutError(url, stallMs)), stallMs);
      });
      const { done, value } = await Promise.race([reader.read(), stalled]);
      clearTimeout(timer);
      if (done) return;
      if (value) onChunk(value);
    }
  } catch (err) {
    clearTimeout(timer);
    await reader.cancel(err).catch(() => undefined);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
