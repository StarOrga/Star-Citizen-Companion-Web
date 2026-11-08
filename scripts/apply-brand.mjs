#!/usr/bin/env node
/**
 * The product's display name lives in ONE place: src/brand.json. Components
 * read it through src/app/core/brand.ts; places that cannot import it (i18n
 * JSON, index.html, the web manifest, the browser extension, docs) hold a
 * literal copy, and this script keeps those copies in step.
 *
 *   node scripts/apply-brand.mjs "New Name"   rewrite every copy + brand.json
 *   node scripts/apply-brand.mjs --check      prebuild guard: the key copies
 *                                             carry the name from brand.json
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

const arg = process.argv[2];
if (!arg || arg === '--check') check();
else apply(arg);
