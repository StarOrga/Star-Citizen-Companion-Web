import {
  RSI_PLEDGE_SHIP_URL_RE,
  isValidRsiPledgeShipUrl,
  normalizeRsiPledgeShipUrl,
} from './rsi-pledge-link.util';

describe('rsi-pledge-link.util', () => {
  const CANONICAL = 'https://robertsspaceindustries.com/en/pledge/ships/nomad/Nomad';

  describe('accepts genuine RSI pledge-ship links', () => {
    const accepted: Array<[string, string]> = [
      ['canonical', CANONICAL],
      ['no locale segment', 'https://robertsspaceindustries.com/pledge/ships/nomad/Nomad'],
      ['other locale is canonicalized to /en', 'https://robertsspaceindustries.com/de/pledge/ships/nomad/Nomad'],
      ['trailing slash is dropped', 'https://robertsspaceindustries.com/en/pledge/ships/nomad/Nomad/'],
      ['surrounding whitespace is trimmed', `  ${CANONICAL}  `],
      ['uppercase host is lowercased', 'https://RobertsSpaceIndustries.com/en/pledge/ships/nomad/Nomad'],
    ];
    for (const [label, input] of accepted) {
      it(`${label}: ${input}`, () => {
        expect(normalizeRsiPledgeShipUrl(input)).toBe(CANONICAL);
        expect(isValidRsiPledgeShipUrl(input)).toBe(true);
      });
    }

    it('keeps hyphenated slug and variant name', () => {
      expect(normalizeRsiPledgeShipUrl('https://robertsspaceindustries.com/en/pledge/ships/drake-cutlass/Cutlass-Black'))
        .toBe('https://robertsspaceindustries.com/en/pledge/ships/drake-cutlass/Cutlass-Black');
    });
  });

  describe('rejects hostile input', () => {
    const rejected: Array<[string, string | null | undefined]> = [
      // ── dangerous schemes ────────────────────────────────────────────────
      ['javascript: scheme', 'javascript:alert(1)'],
      ['javascript: dressed as a path', 'javascript:/en/pledge/ships/nomad/Nomad'],
      ['data: scheme', 'data:text/html,<script>alert(1)</script>'],
      ['data: base64 html', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
      ['blob: scheme', 'blob:https://robertsspaceindustries.com/1234'],
      ['file: scheme', 'file:///etc/passwd'],
      ['plain http', 'http://robertsspaceindustries.com/en/pledge/ships/nomad/Nomad'],
      ['protocol-relative', '//robertsspaceindustries.com/en/pledge/ships/nomad/Nomad'],
      ['scheme-cased javascript', 'JaVaScRiPt:alert(1)'],

      // ── look-alike hosts (why host must be `===`, never endsWith) ────────
      ['evil suffix domain', 'https://robertsspaceindustries.com.evil.tld/en/pledge/ships/nomad/Nomad'],
      ['evil subdomain', 'https://evil.robertsspaceindustries.com/en/pledge/ships/nomad/Nomad'],
      ['host as a path prefix of the attacker domain', 'https://evil.tld/robertsspaceindustries.com/en/pledge/ships/nomad/Nomad'],
      ['hyphen look-alike', 'https://robertsspaceindustries-com.evil.tld/en/pledge/ships/nomad/Nomad'],
      ['unicode homoglyph host', 'https://robertsspaceindustriеs.com/en/pledge/ships/nomad/Nomad'],
      ['trailing-dot host', 'https://robertsspaceindustries.com./en/pledge/ships/nomad/Nomad'],

      // ── userinfo `@` tricks ──────────────────────────────────────────────
      ['host in userinfo, attacker host real', 'https://robertsspaceindustries.com@evil.tld/en/pledge/ships/nomad/Nomad'],
      ['credentials on the real host', 'https://user:pass@robertsspaceindustries.com/en/pledge/ships/nomad/Nomad'],
      ['empty-password userinfo', 'https://user@robertsspaceindustries.com/en/pledge/ships/nomad/Nomad'],
      ['backslash userinfo trick', 'https://robertsspaceindustries.com\\@evil.tld/en/pledge/ships/nomad/Nomad'],

      // ── query / fragment / port ──────────────────────────────────────────
      ['query string', `${CANONICAL}?utm_source=x`],
      ['bare question mark', `${CANONICAL}?`],
      ['fragment', `${CANONICAL}#top`],
      ['fragment with script payload', `${CANONICAL}#<img src=x onerror=alert(1)>`],
      ['non-standard port', 'https://robertsspaceindustries.com:8443/en/pledge/ships/nomad/Nomad'],

      // ── wrong path shape ─────────────────────────────────────────────────
      ['too few segments', 'https://robertsspaceindustries.com/en/pledge/ships/nomad'],
      ['too many segments', `${CANONICAL}/extra`],
      ['different RSI area', 'https://robertsspaceindustries.com/en/comm-link/transmission/19000-Foo'],
      ['ships listing, not a ship', 'https://robertsspaceindustries.com/en/pledge/ships'],
      ['path traversal', 'https://robertsspaceindustries.com/en/pledge/ships/../../account/settings/x'],
      ['encoded traversal', 'https://robertsspaceindustries.com/en/pledge/ships/%2e%2e/%2e%2e/x'],
      ['slug with uppercase', 'https://robertsspaceindustries.com/en/pledge/ships/Nomad/Nomad'],
      ['slug with underscore', 'https://robertsspaceindustries.com/en/pledge/ships/no_mad/Nomad'],
      ['name with space', 'https://robertsspaceindustries.com/en/pledge/ships/nomad/Nomad Two'],
      ['embedded newline', `${CANONICAL}\nhttps://evil.tld`],

      // ── empty / junk ─────────────────────────────────────────────────────
      ['empty string', ''],
      ['whitespace only', '   '],
      ['null', null],
      ['undefined', undefined],
      ['not a url', 'nomad'],
      ['unrelated https url', 'https://evil.tld/x'],
    ];
    for (const [label, input] of rejected) {
      it(`rejects ${label}`, () => {
        expect(normalizeRsiPledgeShipUrl(input)).toBeNull();
        expect(isValidRsiPledgeShipUrl(input)).toBe(false);
      });
    }

    it('rejects absurdly long input before parsing', () => {
      const long = `https://robertsspaceindustries.com/en/pledge/ships/${'a'.repeat(400)}/Nomad`;
      expect(normalizeRsiPledgeShipUrl(long)).toBeNull();
    });
  });

  describe('RSI_PLEDGE_SHIP_URL_RE', () => {
    it('matches the canonical url', () => {
      expect(RSI_PLEDGE_SHIP_URL_RE.test(CANONICAL)).toBe(true);
    });

    it('is anchored at both ends', () => {
      // A leading or trailing segment can never be absorbed. (Appending bare
      // `x` would merely extend the <Name> segment, so the trailing case uses
      // characters the pattern cannot contain.)
      expect(RSI_PLEDGE_SHIP_URL_RE.test(`x${CANONICAL}`)).toBe(false);
      expect(RSI_PLEDGE_SHIP_URL_RE.test(`https://evil.tld/${CANONICAL}`)).toBe(false);
      expect(RSI_PLEDGE_SHIP_URL_RE.test(`${CANONICAL}/x`)).toBe(false);
      expect(RSI_PLEDGE_SHIP_URL_RE.test(`${CANONICAL}?a=b`)).toBe(false);
      expect(RSI_PLEDGE_SHIP_URL_RE.test(`${CANONICAL}#x`)).toBe(false);
      expect(RSI_PLEDGE_SHIP_URL_RE.test(`${CANONICAL} evil`)).toBe(false);
    });

    it('every normalized output satisfies the storable pattern', () => {
      const out = normalizeRsiPledgeShipUrl('https://robertsspaceindustries.com/de/pledge/ships/anvil-carrack/Carrack/');
      expect(out).not.toBeNull();
      expect(RSI_PLEDGE_SHIP_URL_RE.test(out as string)).toBe(true);
    });
  });
});
