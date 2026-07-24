// Hostile-input tests for the server-side allowlist. Run with:
//   deno test supabase/functions/ship-link/
// (Deno is not part of the npm test run; this mirrors
// src/app/core/rsi-pledge-link.util.spec.ts, which does run under `npm test`.)
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { normalizeRsiPledgeShipUrl, normalizeShipSlug } from './_rsi-url.ts';

const CANONICAL = 'https://robertsspaceindustries.com/en/pledge/ships/nomad/Nomad';

Deno.test('accepts and canonicalizes genuine pledge links', () => {
  for (
    const input of [
      CANONICAL,
      'https://robertsspaceindustries.com/pledge/ships/nomad/Nomad',
      'https://robertsspaceindustries.com/de/pledge/ships/nomad/Nomad',
      'https://robertsspaceindustries.com/en/pledge/ships/nomad/Nomad/',
      `  ${CANONICAL}  `,
      'https://RobertsSpaceIndustries.com/en/pledge/ships/nomad/Nomad',
    ]
  ) {
    assertEquals(normalizeRsiPledgeShipUrl(input), CANONICAL, input);
  }
});

Deno.test('rejects hostile input', () => {
  for (
    const input of [
      // dangerous schemes
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'blob:https://robertsspaceindustries.com/1234',
      'file:///etc/passwd',
      'http://robertsspaceindustries.com/en/pledge/ships/nomad/Nomad',
      '//robertsspaceindustries.com/en/pledge/ships/nomad/Nomad',
      // look-alike hosts — the reason the host is compared with ===
      'https://robertsspaceindustries.com.evil.tld/en/pledge/ships/nomad/Nomad',
      'https://evil.robertsspaceindustries.com/en/pledge/ships/nomad/Nomad',
      'https://robertsspaceindustries-com.evil.tld/en/pledge/ships/nomad/Nomad',
      'https://evil.tld/robertsspaceindustries.com/en/pledge/ships/nomad/Nomad',
      'https://robertsspaceindustries.com./en/pledge/ships/nomad/Nomad',
      // userinfo
      'https://robertsspaceindustries.com@evil.tld/en/pledge/ships/nomad/Nomad',
      'https://user:pass@robertsspaceindustries.com/en/pledge/ships/nomad/Nomad',
      'https://user@robertsspaceindustries.com/en/pledge/ships/nomad/Nomad',
      // query / fragment / port
      `${CANONICAL}?utm_source=x`,
      `${CANONICAL}?`,
      `${CANONICAL}#top`,
      'https://robertsspaceindustries.com:8443/en/pledge/ships/nomad/Nomad',
      // wrong path shape
      'https://robertsspaceindustries.com/en/pledge/ships/nomad',
      `${CANONICAL}/extra`,
      'https://robertsspaceindustries.com/en/comm-link/transmission/19000-Foo',
      'https://robertsspaceindustries.com/en/pledge/ships/../../account/settings/x',
      'https://robertsspaceindustries.com/en/pledge/ships/Nomad/Nomad',
      // junk + wrong types
      '',
      '   ',
      'nomad',
      null,
      undefined,
      42,
      { url: CANONICAL },
      [CANONICAL],
    ]
  ) {
    assertEquals(normalizeRsiPledgeShipUrl(input), null, JSON.stringify(input));
  }
});

Deno.test('rejects overlong input', () => {
  const long = `https://robertsspaceindustries.com/en/pledge/ships/${'a'.repeat(400)}/Nomad`;
  assertEquals(normalizeRsiPledgeShipUrl(long), null);
});

Deno.test('ship slug allowlist', () => {
  assertEquals(normalizeShipSlug('AEGS_Gladius'), 'AEGS_Gladius');
  assertEquals(normalizeShipSlug('  RSI_Polaris  '), 'RSI_Polaris');
  for (
    const bad of [
      '',
      'a/../b',
      'drop table x',
      '<script>',
      "a'--",
      'a'.repeat(121),
      null,
      7,
    ]
  ) {
    assertEquals(normalizeShipSlug(bad), null, JSON.stringify(bad));
  }
});
