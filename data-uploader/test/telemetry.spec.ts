import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  buildCrashBody,
  signCrashRequest,
  normaliseOs,
  toCrashInput,
  buildExtractAbort,
  classifyExtractAbort,
  EXTRACT_ABORT_ERROR_TYPE,
  EXTRACT_ABORT_NAME,
  PRODUCT,
  ROLE,
  type TelemetryMeta,
  type CrashInput,
} from '../src/lib/telemetry.js';

const meta: TelemetryMeta = {
  appVersion: '0.8.2',
  buildId: 'abcd1234',
  channel: 'stable',
  os: 'win',
  osRelease: '10.0.26200',
  arch: 'x64',
  installId: 'install-uuid',
  sessionId: 'session-uuid',
};

const crash: CrashInput = {
  errorType: 'uncaughtException',
  name: 'TypeError',
  message: 'cannot read property x of undefined',
  stack: 'TypeError: ...\n  at foo (a.js:1:1)',
};

// Real HMAC so the test pins the exact wire signature the edge function verifies.
const hmacHex = (key: string, msg: string): string =>
  createHmac('sha256', key).update(msg).digest('hex');

describe('toCrashInput', () => {
  it('extracts name/message/stack from a real Error', () => {
    const err = new TypeError('boom');
    const input = toCrashInput('extract-failed', err, { jobId: 'j1' });
    expect(input.errorType).toBe('extract-failed');
    expect(input.name).toBe('TypeError');
    expect(input.message).toBe('boom');
    expect(input.stack).toContain('boom');
    expect(input.extra).toEqual({ jobId: 'j1' });
  });

  it('treats a bare string error as the message (no name/stack)', () => {
    const input = toCrashInput('upload-failed', 'HTTP 500');
    expect(input.name).toBeNull();
    expect(input.message).toBe('HTTP 500');
    expect(input.stack).toBeNull();
    expect(input.extra).toBeNull();
  });

  it('coerces a null/undefined thrown value to an empty message', () => {
    expect(toCrashInput('x', null).message).toBe('');
    expect(toCrashInput('x', undefined).message).toBe('');
  });
});

describe('buildExtractAbort', () => {
  it('uses the dedicated extract-aborted bucket, not a generic crash type', () => {
    const ev = buildExtractAbort('cancelled', { jobId: 'j1' });
    expect(ev.errorType).toBe(EXTRACT_ABORT_ERROR_TYPE);
    expect(ev.errorType).toBe('extract-aborted');
    expect(ev.name).toBe(EXTRACT_ABORT_NAME);
    // Not a real crash — there is no stack to send.
    expect(ev.stack).toBeNull();
  });

  it('carries the reason plus how far the extraction got', () => {
    const ev = buildExtractAbort('quit', {
      jobId: 'j2',
      phase: 'extract',
      pct: 41.7,
      elapsedMs: 90_000,
    });
    expect(ev.extra).toEqual({
      reason: 'quit',
      jobId: 'j2',
      phase: 'extract',
      pct: 42, // rounded — fractional percent is noise
      elapsedMs: 90_000,
    });
    expect(ev.message).toBe('extraction aborted (quit)');
  });

  it('appends the underlying failure text only for reason "error"', () => {
    expect(
      buildExtractAbort('error', { jobId: 'j3', error: 'python exited with code 1' }).message,
    ).toBe('extraction aborted (error): python exited with code 1');
    // A cancel carries no error text even if one was passed along.
    expect(buildExtractAbort('cancelled', { jobId: 'j3', error: 'ignored' }).message).toBe(
      'extraction aborted (cancelled)',
    );
  });

  it('defaults the missing progress fields to null instead of dropping them', () => {
    expect(buildExtractAbort('error', { jobId: 'j4' }).extra).toEqual({
      reason: 'error',
      jobId: 'j4',
      phase: null,
      pct: null,
      elapsedMs: null,
    });
  });

  it('rejects non-finite progress numbers rather than shipping NaN', () => {
    const ev = buildExtractAbort('error', { jobId: 'j5', pct: NaN, elapsedMs: Infinity });
    expect((ev.extra as Record<string, unknown>).pct).toBeNull();
    expect((ev.extra as Record<string, unknown>).elapsedMs).toBeNull();
  });

  it('truncates an oversized failure text to the wire budget', () => {
    const ev = buildExtractAbort('error', { jobId: 'j6', error: 'x'.repeat(2000) });
    expect(ev.message.length).toBe(500);
  });

  it('survives the crash wire encoder as a normal event', () => {
    const body = JSON.parse(buildCrashBody(meta, [buildExtractAbort('cancelled', { jobId: 'j7' })]));
    expect(body.product).toBe('data-uploader');
    expect(body.events[0].errorType).toBe('extract-aborted');
    expect(body.events[0].extra.reason).toBe('cancelled');
  });
});

describe('classifyExtractAbort', () => {
  it('reports a self-terminating failure as reason "error"', () => {
    expect(classifyExtractAbort({ ok: false, error: 'python exited 2' }, null)).toBe('error');
  });

  it('stays silent for a successful extraction', () => {
    expect(classifyExtractAbort({ ok: true }, null)).toBeNull();
  });

  it('does not double-report an abort that was already sent at request time', () => {
    // The cancel/quit paths report immediately (the process may not survive to
    // the promise), so the resolution path must add nothing.
    expect(classifyExtractAbort({ ok: false, error: 'cancelled' }, 'cancelled')).toBeNull();
    expect(classifyExtractAbort({ ok: false, error: 'cancelled' }, 'quit')).toBeNull();
  });
});

describe('normaliseOs', () => {
  it('maps node platforms to the server vocabulary', () => {
    expect(normaliseOs('win32')).toBe('win');
    expect(normaliseOs('darwin')).toBe('mac');
    expect(normaliseOs('linux')).toBe('linux');
    expect(normaliseOs('freebsd')).toBe('freebsd'); // passthrough for the rest
  });
});

describe('buildCrashBody', () => {
  it('tags the payload with product + role and type=crash', () => {
    const body = JSON.parse(buildCrashBody(meta, [crash]));
    expect(body.type).toBe('crash');
    expect(body.product).toBe(PRODUCT);
    expect(body.product).toBe('data-uploader');
    expect(body.role).toBe(ROLE);
    expect(body.appVersion).toBe('0.8.2');
    expect(body.installId).toBe('install-uuid');
    expect(body.events).toHaveLength(1);
    expect(body.events[0]).toMatchObject({
      errorType: 'uncaughtException',
      name: 'TypeError',
      message: 'cannot read property x of undefined',
    });
  });

  it('truncates an oversized stack and message to the wire budgets', () => {
    const huge: CrashInput = {
      errorType: 'uncaughtException',
      name: 'X'.repeat(500),
      message: 'm'.repeat(2000),
      stack: 's'.repeat(20000),
    };
    const ev = JSON.parse(buildCrashBody(meta, [huge])).events[0];
    expect(ev.name.length).toBe(120);
    expect(ev.message.length).toBe(500);
    expect(ev.stack.length).toBe(8000);
  });

  it('coerces a null message to an empty string (server requires it)', () => {
    const ev = JSON.parse(
      buildCrashBody(meta, [{ ...crash, message: null as unknown as string }]),
    ).events[0];
    expect(ev.message).toBe('');
  });
});

describe('signCrashRequest', () => {
  it('targets the ingest-telemetry function and signs ts.body', () => {
    const nowMs = 1_700_000_000_000;
    const req = signCrashRequest(
      'https://proj.supabase.co',
      'test-key',
      '0.8.2',
      hmacHex,
      nowMs,
      meta,
      [crash],
    );
    expect(req.url).toBe('https://proj.supabase.co/functions/v1/ingest-telemetry');
    expect(req.headers['x-scc-timestamp']).toBe(String(nowMs));
    expect(req.headers['x-scc-version']).toBe('0.8.2');
    expect(req.headers['content-type']).toBe('application/json');

    // The signature MUST cover `${ts}.${rawBody}` with the exact bytes sent.
    const expected = hmacHex('test-key', `${nowMs}.${req.body}`);
    expect(req.headers['x-scc-signature']).toBe(expected);
  });

  it('strips a trailing slash from the api base (no double slash in the URL)', () => {
    const req = signCrashRequest(
      'https://proj.supabase.co/',
      'k',
      '1.0.0',
      hmacHex,
      1,
      meta,
      [crash],
    );
    expect(req.url).toBe('https://proj.supabase.co/functions/v1/ingest-telemetry');
  });

  it('is deterministic for a pinned clock (replayable signature)', () => {
    const a = signCrashRequest('https://x.co', 'k', '1', hmacHex, 42, meta, [crash]);
    const b = signCrashRequest('https://x.co', 'k', '1', hmacHex, 42, meta, [crash]);
    expect(a.headers['x-scc-signature']).toBe(b.headers['x-scc-signature']);
  });
});
