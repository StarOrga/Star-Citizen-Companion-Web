#!/usr/bin/env node
/**
 * The product's display name lives in ONE place: src/brand.json. Components
 * read it through src/app/core/brand.ts; places that cannot import it (i18n
 * JSON, index.html, the web manifest, the browser extension, docs) hold a
 * literal copy, and this script keeps those copies in step.
 *
 *   node scripts/apply-brand.mjs "New Name"   rewrite every copy + brand.json
 *   node scripts/apply-brand.mjs --host h     move the public host (canonical,
 *                                             sitemap, docs, links) to h; the old
 *                                             host joins legacyHosts
 *   node scripts/apply-brand.mjs --check      prebuild guard: the key copies
 *                                             carry the name and host from brand.json
 *
 * Rewritten forms of the current name "A B": "A B", "A-B" (German compounds
 * such as "A-B-Konto") and "A B" upper-cased (wordmarks). Historic files are
 * never touched: CHANGELOG.md, public/release-notes.json, docs/concepts/**,
 * docs/superpowers/**, supabase/migrations/**, lockfiles.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BRAND_FILE = resolve(ROOT, 'src/brand.json');
const brand = JSON.parse(readFileSync(BRAND_FILE, 'utf8'));
const current = brand.name;

const SKIP = [
  /^CHANGELOG\.md$/,
  /^public\/release-notes\.json$/,
  /^docs\/concepts\//,
  /^docs\/superpowers\//,
  /^supabase\/migrations\//,
  /package-lock\.json$/,
  /^src\/brand\.json$/,
  /^docs\/rename-verse-companion\.md$/, // names the rejected placeholder on purpose
];

const forms = (name) => {
  const hyphen = name.replace(/\s+/g, '-');
  const upper = name.toUpperCase();
  return [...new Set([name, hyphen, upper])];
};

/**
 * Files whose links point at THE public host. Origin allowlists (CORS, auth
 * redirects, extension host permissions, test hosts) are not here: they list
 * the host AND every legacy host, and are edited by hand when a host is added.
 */
const HOST_FILES = [
  /^src\/index\.html$/,
  /^public\/(sitemap\.xml|robots\.txt|humans\.txt|\.well-known\/security\.txt)$/,
  /^public\/i18n\/[a-z]+\.json$/,
  /^README\.md$/,
  /^docs\/readme-io\//,
  /^docs\/api\//,
  /^supabase\/functions\/api\/openapi\.ts$/,
  /^supabase\/functions\/invite-user\/index\.ts$/,
  /^supabase\/functions\/starscape-summary\/summary-svg\.ts$/,
  /^supabase\/functions\/translate-orchestrator\/(_outreach|_io)\.ts$/,
];

/** Files that must carry the name; `--check` fails when one does not. */
const REQUIRED = [
  ['src/index.html', (s, n) => s.includes(`<title>${n} –`) && s.includes(`"name": "${n}"`)],
  ['public/manifest.webmanifest', (s, n) => JSON.parse(s).name === n],
  ['public/i18n/en.json', (s, n) => JSON.parse(s).auth.landing.appName === n],
  ['public/i18n/de.json', (s, n) => JSON.parse(s).auth.landing.appName === n],
  ['browser-extension/_locales/en/messages.json', (s, n) => JSON.parse(s).bannerTitle.message === n],
  ['browser-extension/_locales/de/messages.json', (s, n) => JSON.parse(s).bannerTitle.message === n],
];

function check() {
  const drift = [];
  const html = readFileSync(resolve(ROOT, 'src/index.html'), 'utf8');
  if (!html.includes(`<link rel="canonical" href="https://${brand.host}/" />`)) drift.push(`src/index.html (canonical is not https://${brand.host}/)`);
  for (const [rel, ok] of REQUIRED) {
    const s = readFileSync(resolve(ROOT, rel), 'utf8');
    if (!ok(s, current)) drift.push(rel);
  }
  if (drift.length) {
    console.error(`✗ brand: these files do not carry "${current}" from src/brand.json:\n  ${drift.join('\n  ')}\n  Run: node scripts/apply-brand.mjs "${current}" after restoring the previous name, or fix them by hand.`);
    process.exitCode = 1;
    return;
  }
  console.log(`✓ brand: "${current}" in all ${REQUIRED.length} key files.`);
}

function apply(next) {
  if (!/^\S+\s\S+$/.test(next)) {
    console.error(`✗ brand: "${next}" must be two words (the UI shows it followed by the alpha badge).`);
    process.exitCode = 1;
    return;
  }
  const from = forms(current);
  const to = forms(next);
  const args = ['grep', '-lI', ...from.flatMap((f) => ['-e', f])];
  let files = [];
  try {
    files = execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch { /* git grep exits 1 when nothing matches */ }
  let changed = 0;
  for (const rel of files) {
    if (SKIP.some((r) => r.test(rel))) continue;
    const path = resolve(ROOT, rel);
    const src = readFileSync(path, 'utf8');
    let out = src;
    from.forEach((f, i) => { out = out.split(f).join(to[i]); });
    if (out !== src) { writeFileSync(path, out); changed++; }
  }
  brand.name = next;
  writeFileSync(BRAND_FILE, JSON.stringify(brand, null, 2) + '\n');
  console.log(`✓ brand: "${current}" → "${next}" in ${changed} files + src/brand.json. Review with git diff, then npm run build.`);
}

function applyHost(next) {
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(next)) {
    console.error(`✗ brand: "${next}" is not a bare host name (no scheme, no path).`);
    process.exitCode = 1;
    return;
  }
  const from = brand.host;
  let files = [];
  try {
    files = execFileSync('git', ['grep', '-lIF', from], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch { /* nothing matches */ }
  let changed = 0;
  for (const rel of files) {
    if (!HOST_FILES.some((r) => r.test(rel))) continue;
    const path = resolve(ROOT, rel);
    const src = readFileSync(path, 'utf8');
    const out = src.split(from).join(next);
    if (out !== src) { writeFileSync(path, out); changed++; }
  }
  brand.host = next;
  brand.legacyHosts = [...new Set([...(brand.legacyHosts ?? []), from])].filter((h) => h !== next);
  writeFileSync(BRAND_FILE, JSON.stringify(brand, null, 2) + '\n');
  console.log(`✓ brand: host ${from} → ${next} in ${changed} files + src/brand.json. Add ${next} to the origin allowlists by hand (see docs/rename-verse-companion.md).`);
}

const arg = process.argv[2];
if (!arg || arg === '--check') check();
else if (arg === '--host') applyHost(process.argv[3] ?? '');
else apply(arg);
