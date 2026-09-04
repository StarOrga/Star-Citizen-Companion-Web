import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadWithRetry } from '../scripts/fetch-embedded-python.js';

const URL = 'https://example.invalid/cpython.tar.gz';

function okResponse(body = 'archive-bytes'): Response {
  return new Response(body, { status: 200, statusText: 'OK' });
}

function statusResponse(status: number, statusText: string): Response {
  return new Response(null, { status, statusText });
}

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'fetch-python-spec-'));
  const dest = join(dir, 'cpython.tar.gz');
  const sleep = vi.fn(async (_ms: number) => {});
  const log = vi.fn((_msg: string) => {});
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  return { dest, sleep, log, cleanup };
}

describe('downloadWithRetry', () => {
  it('succeeds first try without sleeping and writes the archive', async () => {
    const h = harness();
    try {
      const fetchImpl = vi.fn(async () => okResponse('hello'));
      await downloadWithRetry(URL, h.dest, { fetchImpl, sleep: h.sleep, log: h.log });

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(fetchImpl).toHaveBeenCalledWith(URL, { redirect: 'follow' });
      expect(h.sleep).not.toHaveBeenCalled();
      expect(readFileSync(h.dest, 'utf8')).toBe('hello');
      expect(h.log).toHaveBeenCalledWith('download attempt 1/4');
    } finally {
      h.cleanup();
    }
  });

  it('retries a network error with exponential backoff 2s/4s/8s and then succeeds', async () => {
    const h = harness();
    try {
      const fetchImpl = vi
        .fn<() => Promise<Response>>()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(okResponse('finally'));

      await downloadWithRetry(URL, h.dest, { fetchImpl, sleep: h.sleep, log: h.log });

      expect(fetchImpl).toHaveBeenCalledTimes(4);
      expect(h.sleep.mock.calls.map((c) => c[0])).toEqual([2000, 4000, 8000]);
      expect(readFileSync(h.dest, 'utf8')).toBe('finally');
      expect(h.log).toHaveBeenCalledWith('download attempt 1/4 failed: fetch failed — retrying in 2s');
      expect(h.log).toHaveBeenCalledWith('download attempt 2/4 failed: fetch failed — retrying in 4s');
      expect(h.log).toHaveBeenCalledWith('download attempt 3/4 failed: fetch failed — retrying in 8s');
      expect(h.log).toHaveBeenCalledWith('download attempt 4/4');
    } finally {
      h.cleanup();
    }
  });

  it('retries a 5xx response', async () => {
    const h = harness();
    try {
      const fetchImpl = vi
        .fn<() => Promise<Response>>()
        .mockResolvedValueOnce(statusResponse(503, 'Service Unavailable'))
        .mockResolvedValueOnce(okResponse('ok-after-503'));

      await downloadWithRetry(URL, h.dest, { fetchImpl, sleep: h.sleep, log: h.log });

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(h.sleep).toHaveBeenCalledTimes(1);
      expect(readFileSync(h.dest, 'utf8')).toBe('ok-after-503');
      expect(h.log).toHaveBeenCalledWith(
        'download attempt 1/4 failed: HTTP 503 Service Unavailable — retrying in 2s',
      );
    } finally {
      h.cleanup();
    }
  });

  it('does NOT retry a 404 and fails immediately', async () => {
    const h = harness();
    try {
      const fetchImpl = vi.fn(async () => statusResponse(404, 'Not Found'));

      await expect(
        downloadWithRetry(URL, h.dest, { fetchImpl, sleep: h.sleep, log: h.log }),
      ).rejects.toThrow('download failed: HTTP 404 Not Found');

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(h.sleep).not.toHaveBeenCalled();
      expect(existsSync(h.dest)).toBe(false);
    } finally {
      h.cleanup();
    }
  });

  it('gives up after 4 attempts and reports the last error', async () => {
    const h = harness();
    try {
      const fetchImpl = vi.fn(async () => {
        throw new TypeError('fetch failed');
      });

      await expect(
        downloadWithRetry(URL, h.dest, { fetchImpl, sleep: h.sleep, log: h.log }),
      ).rejects.toThrow('download failed after 4 attempts: fetch failed');

      expect(fetchImpl).toHaveBeenCalledTimes(4);
      expect(h.sleep.mock.calls.map((c) => c[0])).toEqual([2000, 4000, 8000]);
      expect(existsSync(h.dest)).toBe(false);
    } finally {
      h.cleanup();
    }
  });

  it('retries when the body stream breaks mid-download and discards the partial file', async () => {
    const h = harness();
    try {
      const broken = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('partial-'));
          controller.error(new Error('ECONNRESET'));
        },
      });
      const fetchImpl = vi
        .fn<() => Promise<Response>>()
        .mockResolvedValueOnce(new Response(broken, { status: 200, statusText: 'OK' }))
        .mockResolvedValueOnce(okResponse('complete'));

      await downloadWithRetry(URL, h.dest, { fetchImpl, sleep: h.sleep, log: h.log });

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(readFileSync(h.dest, 'utf8')).toBe('complete');
      expect(h.log).toHaveBeenCalledWith('download attempt 1/4 failed: ECONNRESET — retrying in 2s');
    } finally {
      h.cleanup();
    }
  });
});
