#!/usr/bin/env node
// scripts/changed-edge-functions.mjs
// -----------------------------------------------------------------------
// Lists the edge-function slugs a git range touched, so CI can deploy exactly
// those and nothing else.
//
// Why this exists: merging a PR does NOT deploy an edge function — the deploy
// is a separate manual `supabase functions deploy`. On 2026-07-31 that gap cost
// two days of a broken feature: PR #309 hardened `starscape-summary` against
// oversized images, was merged, and never deployed. Prod kept serving v13 until
// a comm-link shipped a 7680x3292 image and every request died with
// `546 Memory limit exceeded`. The repo looked correct the whole time, and so
// did every local test, because both ran the code that was NOT in production.
//
// A slug is reported when either
//   1. a file under `supabase/functions/<slug>/` changed, or
//   2. that function's `[functions.<slug>]` block in `supabase/config.toml`
//      changed — `verify_jwt` lives there and only takes effect on deploy.
//
// Deleted functions are skipped (nothing to deploy), as is the `_shared`
// convention directory should one ever appear.
//
// Usage:
//   node scripts/changed-edge-functions.mjs --base <sha> [--head <sha>] [--json]
//   node scripts/changed-edge-functions.mjs --all        # every function
//   node scripts/changed-edge-functions.mjs --selftest   # verify the parsing
// -----------------------------------------------------------------------

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FUNCTIONS_DIR = 'supabase/functions';
const CONFIG_PATH = 'supabase/config.toml';
// Not a function: a shared-code convention directory, should one be introduced.
const NOT_A_FUNCTION = new Set(['_shared']);

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

/** `git show <ref>:<path>`, or '' when the path did not exist at that ref. */
function fileAtRef(ref, path) {
  try {
    return git(['show', `${ref}:${path}`]);
  } catch {
    return '';
  }
}

// ---- pure helpers (covered by --selftest) --------------------------------

/** Slugs owning any of `paths`, e.g. `supabase/functions/api/index.ts` -> `api`. */
export function slugsFromPaths(paths) {
  const re = new RegExp(`^${FUNCTIONS_DIR}/([^/]+)/`);
  const out = new Set();
  for (const p of paths) {
    const m = re.exec(p);
    if (m && !NOT_A_FUNCTION.has(m[1])) out.add(m[1]);
  }
  return out;
}

/**
 * Split a config.toml into `[functions.<slug>]` blocks. Everything outside such
 * a block is irrelevant here — a change to `[db]` or `[auth]` deploys nothing.
 */
export function functionBlocks(toml) {
  const blocks = new Map();
  let current = null;
  const buf = [];
  const flush = () => {
    if (current) blocks.set(current, buf.join('\n').trim());
    buf.length = 0;
  };
  for (const rawLine of toml.split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(rawLine);
    if (header) {
      flush();
      const m = /^functions\.([A-Za-z0-9_-]+)$/.exec(header[1].trim());
      current = m ? m[1] : null;
      continue;
    }
    if (current) buf.push(rawLine);
  }
  flush();
  return blocks;
}

/** Slugs whose `[functions.<slug>]` block differs between two config.toml texts. */
export function changedConfigSlugs(beforeToml, afterToml) {
  const before = functionBlocks(beforeToml);
  const after = functionBlocks(afterToml);
  const changed = new Set();
  for (const [slug, body] of after) {
    if (before.get(slug) !== body) changed.add(slug);
  }
  // A block removed from config.toml leaves the function deployed as-is; there
  // is nothing to push for it, so removals are deliberately ignored.
  return changed;
}

// ---- git-backed entry points ---------------------------------------------

/** Every function currently present in the working tree. */
function allSlugs() {
  if (!existsSync(FUNCTIONS_DIR)) return [];
  return readdirSync(FUNCTIONS_DIR)
    .filter((name) => !NOT_A_FUNCTION.has(name))
    .filter((name) => statSync(join(FUNCTIONS_DIR, name)).isDirectory())
    .sort();
}

function changedSlugs(base, head) {
  const changedPaths = git(['diff', '--name-only', base, head]).split(/\r?\n/).filter(Boolean);
  const found = slugsFromPaths(changedPaths);
  if (changedPaths.includes(CONFIG_PATH)) {
    for (const slug of changedConfigSlugs(fileAtRef(base, CONFIG_PATH), fileAtRef(head, CONFIG_PATH))) {
      found.add(slug);
    }
  }
  // Only deploy what still exists — a deleted function has nothing to push.
  return [...found].filter((s) => existsSync(join(FUNCTIONS_DIR, s))).sort();
}

// ---- selftest -------------------------------------------------------------

function runSelfTest() {
  let failures = 0;
  const check = (name, actual, expected) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
      console.log(`  ok   ${name}`);
    } else {
      console.error(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`);
      failures++;
    }
  };
  const sorted = (set) => [...set].sort();

  // --- path -> slug ---
  check('path: a function file maps to its slug',
    sorted(slugsFromPaths([`${FUNCTIONS_DIR}/starscape-summary/index.ts`])), ['starscape-summary']);
  check('path: nested files still map to the slug',
    sorted(slugsFromPaths([`${FUNCTIONS_DIR}/starscape-summary/fonts/Orbitron.ttf`])), ['starscape-summary']);
  check('path: several functions dedupe',
    sorted(slugsFromPaths([
      `${FUNCTIONS_DIR}/api/index.ts`,
      `${FUNCTIONS_DIR}/api/util.ts`,
      `${FUNCTIONS_DIR}/uex-proxy/index.ts`,
    ])), ['api', 'uex-proxy']);
  check('path: non-function paths are ignored',
    sorted(slugsFromPaths(['src/app/app.ts', 'supabase/migrations/001.sql', 'README.md'])), []);
  check('path: _shared is not a function',
    sorted(slugsFromPaths([`${FUNCTIONS_DIR}/_shared/cors.ts`])), []);
  check('path: a bare file directly under functions/ is not a slug',
    sorted(slugsFromPaths([`${FUNCTIONS_DIR}/deno.json`])), []);

  // --- config.toml block diffing ---
  const cfg = (body) => `
[db]
port = 54322

[functions.alpha]
verify_jwt = ${body.alpha}

[functions.beta]
verify_jwt = ${body.beta}
`;
  check('config: no change yields nothing',
    sorted(changedConfigSlugs(cfg({ alpha: 'true', beta: 'true' }), cfg({ alpha: 'true', beta: 'true' }))), []);
  check('config: only the edited block is reported',
    sorted(changedConfigSlugs(cfg({ alpha: 'true', beta: 'true' }), cfg({ alpha: 'false', beta: 'true' }))), ['alpha']);
  check('config: a newly added block is reported',
    sorted(changedConfigSlugs('[functions.alpha]\nverify_jwt = true\n',
      '[functions.alpha]\nverify_jwt = true\n\n[functions.gamma]\nverify_jwt = false\n')), ['gamma']);
  check('config: a removed block deploys nothing',
    sorted(changedConfigSlugs('[functions.alpha]\nverify_jwt = true\n\n[functions.gone]\nverify_jwt = true\n',
      '[functions.alpha]\nverify_jwt = true\n')), []);
  check('config: changes outside [functions.*] are ignored',
    sorted(changedConfigSlugs('[db]\nport = 1\n\n[functions.alpha]\nverify_jwt = true\n',
      '[db]\nport = 2\n\n[functions.alpha]\nverify_jwt = true\n')), []);
  check('config: comments inside a block count as a change',
    sorted(changedConfigSlugs('[functions.alpha]\nverify_jwt = true\n',
      '[functions.alpha]\n# public endpoint\nverify_jwt = true\n')), ['alpha']);
  check('config: CRLF parses like LF',
    sorted(changedConfigSlugs('[functions.alpha]\r\nverify_jwt = true\r\n',
      '[functions.alpha]\nverify_jwt = true\n')), []);
  check('config: the real repo config exposes known slugs',
    functionBlocks(existsSync(CONFIG_PATH) ? git(['show', `HEAD:${CONFIG_PATH}`]) : '').has('starscape-summary'), true);

  console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
  return failures === 0 ? 0 : 1;
}

// ---- cli ------------------------------------------------------------------

function parseArgs(argv) {
  const out = { json: false, all: false, selftest: false, base: '', head: 'HEAD' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--all') out.all = true;
    else if (a === '--selftest') out.selftest = true;
    else if (a === '--base') out.base = argv[++i] ?? '';
    else if (a === '--head') out.head = argv[++i] ?? 'HEAD';
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.selftest) {
    process.exit(runSelfTest());
  }

  let slugs;
  if (args.all) {
    slugs = allSlugs();
  } else {
    if (!args.base) {
      console.error('changed-edge-functions: --base <sha> is required (or pass --all / --selftest)');
      process.exit(2);
    }
    slugs = changedSlugs(args.base, args.head);
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(slugs) + '\n');
  } else {
    for (const s of slugs) process.stdout.write(s + '\n');
  }
}

main();
