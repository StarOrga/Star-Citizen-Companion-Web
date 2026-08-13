/**
 * Guard: every remote host the CSP grants to a subresource directive must ALSO
 * be granted in `connect-src`.
 *
 * Why this exists. With the Angular service worker in control, every
 * subresource request — images, fonts, stylesheets, scripts — is intercepted
 * and re-issued as a `fetch()` INSIDE the worker (ngsw's passthrough for
 * unmanaged urls). Per the Fetch/CSP specs that inner fetch is governed by the
 * WORKER SCRIPT's own CSP, and there only `connect-src` applies — the page's
 * `img-src`/`font-src` grants are irrelevant to it. A host that is listed in
 * `img-src` but missing from `connect-src` therefore works exactly once per
 * visitor: on the first, not-yet-controlled visit. From the second visit on,
 * ngsw's `safeFetch` catches the CSP rejection and synthesizes a bodyless
 * `504 Gateway Timeout` in ~1 ms — no build error, no test failure, and the
 * server-side urls all answer 200, so the breakage is invisible to curl.
 *
 * That is how the Starscape gallery shipped dead for every returning visitor
 * (every tile hotlinks media.robertsspaceindustries.com, which `connect-src`
 * did not carry — admin feedback 4e54ad2c and "Starscape Bilder sind kaputt",
 * 2026-08-13), with the Google-Fonts stylesheet quietly 504ing the same way.
 *
 * Scheme-only sources (data:, blob:) never reach the service worker and
 * keywords ('self', 'unsafe-*') are not remote hosts, so both are exempt.
 * Wildcard sources compare as strings — `https://*.supabase.co` in a
 * subresource directive is satisfied by the same wildcard in `connect-src`.
 *
 * Runs in `prebuild`, next to the 3D-viewer CSP guard, so a policy edit that
 * re-introduces the split fails before anything is deployed.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));

const csp = (vercel.headers ?? [])
  .flatMap((h) => h.headers ?? [])
  .find((h) => h.key.toLowerCase() === 'content-security-policy')?.value;

if (!csp) {
  console.error('✗ vercel.json defines no Content-Security-Policy header — nothing to verify.');
  process.exit(1);
}

const directives = new Map(
  csp.split(';').map((d) => {
    const [name, ...sources] = d.trim().split(/\s+/);
    return [name, sources];
  }),
);

// Subresource directives whose requests the service worker re-issues under its
// own connect-src. frame-src is exempt: frames are navigations, not fetches the
// worker re-issues this way.
const SUBRESOURCE_DIRECTIVES = ['script-src', 'style-src', 'font-src', 'img-src'];

const connect = new Set(directives.get('connect-src') ?? []);
const offenders = [];
for (const directive of SUBRESOURCE_DIRECTIVES) {
  for (const source of directives.get(directive) ?? []) {
    if (!source.startsWith('https://') && !source.startsWith('http://')) continue; // keywords + schemes
    if (!connect.has(source)) offenders.push({ directive, source });
  }
}

if (offenders.length > 0) {
  console.error('✗ CSP hosts reachable by the page but NOT by the service worker:\n');
  for (const { directive, source } of offenders) {
    console.error(`  ${source} is in ${directive} but missing from connect-src`);
  }
  console.error('\n  With ngsw in control these subresources are re-fetched INSIDE the worker,');
  console.error('  where only connect-src applies — the requests die as synthesized 504s for');
  console.error('  every returning visitor. Add the host(s) to connect-src as well; see');
  console.error('  scripts/check-csp-connect-src.mjs for the full rationale.');
  process.exit(1);
}

console.log('✓ CSP: every subresource host is also reachable from the service worker (connect-src).');
