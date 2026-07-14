import { isLoopbackCallback } from './loopback.util';

describe('isLoopbackCallback', () => {
  it('accepts an OS-assigned ephemeral port (the real-world case the app uses)', () => {
    // Regression: the previous implementation restricted the port to 46800–46899
    // and rejected the ephemeral port produced by the app's `listen(0)` bind,
    // which made the /desktop/connect page fail with "bad callback".
    expect(isLoopbackCallback('http://127.0.0.1:51234/scc/callback')).toBe(true);
    expect(isLoopbackCallback('http://127.0.0.1:60999/scc/callback')).toBe(true);
    expect(isLoopbackCallback('http://127.0.0.1:1024/oauth/callback')).toBe(true);
  });

  it('still accepts ports in the legacy 46800–46899 range', () => {
    expect(isLoopbackCallback('http://127.0.0.1:46820/scc/callback')).toBe(true);
    expect(isLoopbackCallback('http://127.0.0.1:46899/scc/callback')).toBe(true);
  });

  it('accepts the boundary ports 1 and 65535', () => {
    expect(isLoopbackCallback('http://127.0.0.1:1/scc/callback')).toBe(true);
    expect(isLoopbackCallback('http://127.0.0.1:65535/scc/callback')).toBe(true);
  });

  it('rejects a non-loopback host', () => {
    expect(isLoopbackCallback('http://127.0.0.2:51234/scc/callback')).toBe(false);
    expect(isLoopbackCallback('http://localhost:51234/scc/callback')).toBe(false);
    expect(isLoopbackCallback('http://evil.example.com:51234/scc/callback')).toBe(false);
    expect(isLoopbackCallback('http://10.0.0.5:51234/scc/callback')).toBe(false);
  });

  it('rejects non-http(s→) schemes and https (loopback handoff is plain http)', () => {
    expect(isLoopbackCallback('https://127.0.0.1:51234/scc/callback')).toBe(false);
    expect(isLoopbackCallback('file:///127.0.0.1')).toBe(false);
    expect(isLoopbackCallback('javascript:alert(1)')).toBe(false);
  });

  it('rejects a missing or invalid port', () => {
    expect(isLoopbackCallback('http://127.0.0.1/scc/callback')).toBe(false); // no port
    expect(isLoopbackCallback('http://127.0.0.1:0/scc/callback')).toBe(false); // port 0
  });

  it('rejects malformed input', () => {
    expect(isLoopbackCallback('')).toBe(false);
    expect(isLoopbackCallback('not a url')).toBe(false);
    expect(isLoopbackCallback('127.0.0.1:51234')).toBe(false); // no scheme → parsed oddly
  });
});
