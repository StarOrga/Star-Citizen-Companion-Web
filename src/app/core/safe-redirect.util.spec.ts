import { safeRedirectTarget } from './safe-redirect.util';

// AUD-054/073: the one check both ?redirect= readers trust (login and
// publicOnlyGuard). Anything that is not a same-origin absolute path falls back.
describe('safeRedirectTarget', () => {
  it('falls back to /news for a missing value', () => {
    expect(safeRedirectTarget(null)).toBe('/verse/news');
    expect(safeRedirectTarget(undefined)).toBe('/verse/news');
    expect(safeRedirectTarget('')).toBe('/verse/news');
  });

  it('keeps a same-origin path with its query', () => {
    expect(safeRedirectTarget('/verse/news?item=1')).toBe('/verse/news?item=1');
    expect(safeRedirectTarget('/codex/ship/CNOU_Nomad')).toBe('/codex/ship/CNOU_Nomad');
  });

  it('rejects protocol-relative, backslash, absolute and script targets', () => {
    for (const raw of ['//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', 'news']) {
      expect(safeRedirectTarget(raw)).withContext(raw).toBe('/verse/news');
    }
  });

  it('uses the caller\'s own fallback', () => {
    expect(safeRedirectTarget('//evil.example', '/hq/hangar')).toBe('/hq/hangar');
    expect(safeRedirectTarget(null, '/hq/hangar')).toBe('/hq/hangar');
  });
});
