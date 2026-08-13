/**
 * Postbuild: append a version stamp to the built `ngsw-worker.js`.
 *
 * Why this exists. A service worker's OWN response headers — including its
 * Content-Security-Policy — are captured when the browser installs the script
 * and are kept for the registration's whole life. The update algorithm
 * re-fetches the script on navigation, but when the fetched bytes are
 * byte-for-byte identical it aborts the update and DISCARDS the fresh response,
 * headers and all (Service Workers spec, "Update" step 7). `ngsw-worker.js` is
 * the stock Angular worker, so its bytes only ever change on an Angular
 * upgrade — which means a header-only fix (like widening `connect-src` in
 * vercel.json) would never reach existing installs: their workers would keep
 * enforcing the OLD policy indefinitely.
 *
 * That is not hypothetical: the ngsw passthrough fetch runs under the WORKER's
 * `connect-src` (not the page's `img-src`), and until the stamp existed every
 * SW-controlled visitor kept a worker whose policy blocked the RSI image CDN —
 * every Starscape tile and RSI-hosted news thumb died as a synthesized 504
 * ("Gateway Timeout" out of `safeFetch`) while curl against the same urls
 * returned 200 (admin feedback 4e54ad2c, feedback "Starscape Bilder sind
 * kaputt", 2026-08-13).
 *
 * Appending the app version as a trailing comment makes the worker's bytes
 * change once per release, so every release re-installs the worker and with it
 * the CURRENT response headers. A reinstall is cheap: ngsw persists its state
 * in Cache Storage/IndexedDB keyed by the manifest, not by the worker instance.
 *
 * Runs after `check-index-csp.mjs` in `postbuild`, so it stamps the real
 * artifact Vercel serves. `ngsw.json` does not hash the worker script itself,
 * so the appended comment cannot break integrity checks.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const worker = join(root, 'dist', 'sc-companion', 'browser', 'ngsw-worker.js');

if (!existsSync(worker)) {
  console.error(`✗ ${worker} does not exist — build the app before stamping the worker.`);
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
// The header hash makes the stamp track the POLICY, not just the release: a
// header-only change deployed under an unchanged app version would otherwise
// produce a byte-identical worker again — the exact staleness this script
// exists to prevent.
const headerHash = createHash('sha256')
  .update(JSON.stringify(JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')).headers ?? []))
  .digest('hex')
  .slice(0, 12);
const stamp = `\n// sc-companion v${version}+h.${headerHash} — byte-stamp so header-only changes (CSP!) reach installed workers; see scripts/stamp-ngsw-worker.mjs\n`;

const source = readFileSync(worker, 'utf8');
if (source.includes(stamp)) {
  console.log(`✓ ngsw-worker.js already stamped for v${version}.`);
} else {
  writeFileSync(worker, source + stamp);
  console.log(`✓ ngsw-worker.js stamped for v${version} (forces worker re-install on update).`);
}
