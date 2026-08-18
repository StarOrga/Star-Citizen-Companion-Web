/**
 * Postbuild: stamp the release version into the built `index.html` and
 * re-hash it in `ngsw.json`.
 *
 * Why this exists. /ship's post-merge verification (`.claude/skills/ship/
 * reference.md` + the plugin's post-merge watcher) asserts that the version
 * users actually receive from https://sc-companion.vercel.app is the one that
 * was just shipped. Until this stamp existed the page exposed no version marker
 * at all (checked 2026-08-17): a green merge could still leave a stale deploy
 * live with nothing to notice it. The source template carries
 * `<meta name="app-version" content="dev">`; this script rewrites the value to
 * `v<package.json version>` in the BUILT artifact only — `ng serve` keeps
 * showing "dev", the deployed page carries the release.
 *
 * The `v` prefix is deliberate. The verifier's `$VERSION` placeholder expands
 * to either the bare semver (`0.65.0`, ship_version_bump.vNew) or the tag form
 * (`v0.65.0`), and the assertion is substring containment — `v0.65.0` contains
 * both spellings, a bare `0.65.0` would fail the tag form.
 *
 * Unlike `ngsw-worker.js` (unhashed, which is why stamp-ngsw-worker.mjs may
 * append to it freely), `/index.html` IS prefetch-hashed in ngsw.json's
 * hashTable. Rewriting it after `ng build` without updating that entry would
 * make the service worker's integrity check fail on every release — ngsw
 * fetches the new index, sees a foreign hash, discards the whole app version
 * and degrades SW clients to network-only. So this script also recomputes the
 * sha1 over the final bytes and patches the hashTable entry — after first
 * proving its hashing matches Angular's against the pre-rewrite bytes.
 *
 * Runs FIRST in `postbuild`, so check-index-csp.mjs validates the final HTML.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist', 'sc-companion', 'browser');
const indexPath = join(dist, 'index.html');
const ngswPath = join(dist, 'ngsw.json');

if (!existsSync(indexPath)) {
  console.error(`✗ ${indexPath} does not exist — build the app before stamping the version.`);
  process.exit(1);
}
if (!existsSync(ngswPath)) {
  console.error(`✗ ${ngswPath} does not exist — the production build emits it, and stamping`);
  console.error('  index.html without re-hashing it there would break SW integrity for every client.');
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const sha1 = (data) => createHash('sha1').update(data).digest('hex');

const html = readFileSync(indexPath);
const ngswRaw = readFileSync(ngswPath, 'utf8');
const ngsw = JSON.parse(ngswRaw);
const knownHash = ngsw.hashTable?.['/index.html'];

if (!knownHash) {
  console.error('✗ ngsw.json has no hashTable entry for /index.html — ngsw-config.json no longer');
  console.error('  prefetches it? Re-align this script before shipping.');
  process.exit(1);
}
// Prove our hashing still matches Angular's before rewriting anything. A
// mismatch means either the builder changed algorithms or something else
// already modified index.html — stamping on top would corrupt SW integrity.
if (knownHash !== sha1(html)) {
  console.error('✗ ngsw.json\'s /index.html hash does not match the file on disk — refusing to stamp.');
  process.exit(1);
}

const marker = /(<meta name="app-version" content=")([^"]*)(")/;
const source = html.toString('utf8');
const m = source.match(marker);
if (!m) {
  console.error('✗ No app-version meta tag in the built index.html — restore');
  console.error('  <meta name="app-version" content="dev"> in src/index.html.');
  process.exit(1);
}

if (m[2] === `v${version}`) {
  console.log(`✓ index.html already stamped with v${version} (ngsw hash consistent).`);
  process.exit(0);
}

const stamped = source.replace(marker, `$1v${version}$3`);
writeFileSync(indexPath, stamped);

// Patch the hash in the raw text instead of re-serializing, so ngsw.json keeps
// exactly the layout Angular emitted apart from the one value that changed.
const newHash = sha1(Buffer.from(stamped, 'utf8'));
const hashEntry = /("\/index\.html"\s*:\s*")([0-9a-f]{40})(")/;
if (!hashEntry.test(ngswRaw)) {
  console.error('✗ Could not locate the /index.html hash entry in ngsw.json text — refusing to stamp.');
  process.exit(1);
}
writeFileSync(ngswPath, ngswRaw.replace(hashEntry, `$1${newHash}$3`));

console.log(`✓ index.html stamped with app-version v${version}; ngsw.json /index.html hash updated.`);
