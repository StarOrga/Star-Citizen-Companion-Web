import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  buildCrashBody,
  signCrashRequest,
  normaliseOs,
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
