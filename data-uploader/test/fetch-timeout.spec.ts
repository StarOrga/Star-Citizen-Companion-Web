import { describe, it, expect } from 'vitest';
import {
  FetchTimeoutError,
  fetchWithTimeout,
  isTimeout,
  putTimeoutMs,
  readWithStallTimeout,
} from '../src/lib/fetch-timeout.js';

/** Never answers, but rejects on abort with the signal's reason — like the real fetch. */
const hangingFetch = ((_url: string, init: RequestInit) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  })) as unknown as typeof fetch;

describe('fetchWithTimeout', () => {
  it('returns the response when it arrives in time', async () => {
    const res = new Response('ok');
    const r = await fetchWithTimeout('https://x.test', {}, 1000, (async () => res) as unknown as typeof fetch);
    expect(r).toBe(res);
  });

  it('turns a missed deadline into a FetchTimeoutError', async () => {
    const err = await fetchWithTimeout('https://x.test/slow', {}, 20, hangingFetch).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FetchTimeoutError);
    expect((err as FetchTimeoutError).url).toBe('https://x.test/slow');
    expect(isTimeout(err)).toBe(true);
  });

  it("passes the caller's own abort through unchanged", async () => {
    const ctrl = new AbortController();
    const reason = new Error('user cancelled');
    const p = fetchWithTimeout('https://x.test', { signal: ctrl.signal }, 5000, hangingFetch).catch((e: unknown) => e);
    ctrl.abort(reason);
    const err = await p;
    expect(err).toBe(reason);
    expect(err).not.toBeInstanceOf(FetchTimeoutError);
  });
});

describe('isTimeout', () => {
  it('knows our and the platform timeout, nothing else', () => {
    expect(isTimeout(new FetchTimeoutError('u', 1))).toBe(true);
    expect(isTimeout(new DOMException('x', 'TimeoutError'))).toBe(true);
    expect(isTimeout(new SyntaxError('bad json'))).toBe(false);
    expect(isTimeout(null)).toBe(false);
  });
});

describe('putTimeoutMs', () => {
  it('is 60 s plus 1 s per 100 kB', () => {
    expect(putTimeoutMs(0)).toBe(60_000);
    expect(putTimeoutMs(30e6)).toBe(360_000);
  });
});

describe('readWithStallTimeout', () => {
  it('rejects a stream that stops sending', async () => {
    const stalled = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([1]));
        // never closes, never sends again
      },
    });
    const chunks: Uint8Array[] = [];
    const err = await readWithStallTimeout(stalled, 20, (c) => chunks.push(c), 'https://x.test/big').catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(FetchTimeoutError);
    expect(chunks.length).toBe(1);
  });

  it('lets a slow but steady stream finish', async () => {
    let n = 0;
    const trickle = new ReadableStream<Uint8Array>({
      async pull(c) {
        await new Promise((r) => setTimeout(r, 5));
        if (n++ < 8) c.enqueue(new Uint8Array([n]));
        else c.close();
      },
    });
    let got = 0;
    await readWithStallTimeout(trickle, 30, (c) => (got += c.byteLength));
    expect(got).toBe(8);
  });
});
