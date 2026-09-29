#!/usr/bin/env node
// ============================================================
// check-raw-errors.mjs — no raw backend/transport text in the UI
//
// WHY (audit 2026-09-26, plan D05)
// --------------------------------
// Error cards used to print whatever the backend said: "Failed to fetch",
// "canceling statement due to statement timeout", "Invalid login
// credentials", "Edge Function returned a non-2xx status code". D05 moved
// every UI error signal onto i18n keys from toErrorKey()
// (src/app/core/describe-error.ts) and every console write onto
// logWarn/logError (src/app/core/log.ts). This guard runs in `prebuild`, so
// a new `error.set(err.message)` fails `npm run build` — locally, in the
// routine's web gate and in Vercel's PR preview build.
//
// SCOPE
// -----
// - Every src/app/**/*.ts except *.spec.ts.
// - Comments are blanked first (they often quote the old, wrong pattern);
//   line numbers survive. String literals are kept.
// - Deliberately NOT flagged: `throw new Error(error.message)` (it reaches the
//   UI only through toErrorKey) and code comparisons such as
//   `msg.includes('username_taken')`.
//
// USAGE
//   node scripts/check-raw-errors.mjs            # scan src/app
//   node scripts/check-raw-errors.mjs --selftest # verify the matchers
// ============================================================

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_ROOT = path.join(REPO_ROOT, 'src', 'app');
const LOGGER = 'src/app/core/log.ts';
const HINT = 'use toErrorKey() from src/app/core/describe-error.ts (raw text only via logWarn)';

/** Line patterns. `skip(rel)` exempts a file from one pattern. */
export const PATTERNS = [
  {
    id: 'set-message',
    // Any .set(…) on one line that mentions .message — catches noteErr.message,
    // (err as Error).message ?? …, error?.message ?? 'adopt_failed' and
    // set({ kind: 'error', text: error.message }) alike.
    re: /\.set\([^;]*\.message\b/,
    hint: HINT,
  },
  {
    id: 'literal-message',
    // Raw text in an object literal: { kind: 'error', message: error.message },
    // error: (e as Error).message. Only error-ish identifiers, so an
    // application text like message: input.message stays allowed.
    re: /\b(error|text|message):\s*\(?(\w*[eE]rr\w*|e)(\s+as\s+Error\))?\??\.message\b/,
    hint: HINT,
  },
  {
    id: 'unknown-error',
    re: /\?\?\s*'Unknown error'/,
    hint: HINT,
  },
  {
    id: 'payload-message',
    re: /payload\.message\s*\?\?/,
    hint: 'edge envelopes: read the code with readEdgeErrorCode() (src/app/core/edge-error.ts) and map it to a key',
  },
  {
    id: 'console',
    re: /\bconsole\.(warn|error|log)\(/,
    hint: 'use logWarn/logError from src/app/core/log.ts',
    skip: (rel) => rel === LOGGER,
  },
];

/** Replace a comment with spaces, keeping its newlines. */
function blank(text) {
  return text.replace(/[^\n]/g, ' ');
}

/**
 * Blank out HTML comments and JS line/block comments; keep string and
 * template literals (a `//` inside 'https://…' is not a comment). Same
 * tokeniser as check-native-ui.mjs.
 */
export function stripComments(src) {
  const noHtml = src.replace(/<!--[\s\S]*?-->/g, blank);
  let out = '';
  let i = 0;
  const n = noHtml.length;
  while (i < n) {
    const c = noHtml[i];
    const next = noHtml[i + 1];
    if (c === '/' && next === '/') {
      const end = noHtml.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out += blank(noHtml.slice(i, stop));
      i = stop;
    } else if (c === '/' && next === '*') {
      const end = noHtml.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += blank(noHtml.slice(i, stop));
      i = stop;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n && noHtml[j] !== c) {
        if (noHtml[j] === '\\') j++;
        else if (c !== '`' && noHtml[j] === '\n') break;
        j++;
      }
      out += noHtml.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** All findings in one file's text: [{ line, id, match, hint }]. */
export function findRawErrors(text, rel = 'src/app/x.ts') {
  const lines = stripComments(text).split('\n');
  const hits = [];
  lines.forEach((content, idx) => {
    for (const { id, re, hint, skip } of PATTERNS) {
      if (skip && skip(rel)) continue;
      const m = re.exec(content);
      if (m) hits.push({ line: idx + 1, id, match: content.trim().slice(0, 140), hint });
    }
  });
  return hits;
}

function listSources(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listSources(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) files.push(full);
  }
  return files;
}

function scan() {
  const findings = [];
  for (const file of listSources(SCAN_ROOT)) {
    const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
    for (const hit of findRawErrors(readFileSync(file, 'utf8'), rel)) findings.push({ rel, ...hit });
  }
  if (findings.length === 0) {
    console.log('check-raw-errors: no raw error text in UI signals, no stray console calls in src/app.');
    return;
  }
  console.error('check-raw-errors: raw error text or console calls found:\n');
  for (const f of findings) console.error(`  ${f.rel}:${f.line}  [${f.id}]  ${f.match}\n      → ${f.hint}`);
  console.error(`\n${findings.length} finding(s).`);
  process.exitCode = 1;
}

function selftest() {
  /** [source, file, expected pattern ids] */
  const cases = [
    // set-message
    ['this.error.set(err.message);', 'src/app/a.ts', ['set-message']],
    ['this.errorMsg.set(noteErr.message);', 'src/app/a.ts', ['set-message']],
    ["this.error.set((err as Error).message ?? 'x');", 'src/app/a.ts', ['set-message']],
    ["this.error.set(error?.message ?? 'adopt_failed');", 'src/app/a.ts', ['set-message']],
    ["this.promoteMsg.set({ kind: 'error', text: error.message });", 'src/app/a.ts', ['set-message', 'literal-message']],
    ["this.error.set(toErrorKey('codex', 'list', err));", 'src/app/a.ts', []],
    ['this.messages.set(list);', 'src/app/a.ts', []],
    // literal-message
    ["return { kind: 'error', message: error.message };", 'src/app/a.ts', ['literal-message']],
    ['error: (e as Error).message,', 'src/app/a.ts', ['literal-message']],
    ['message: input.message?.trim() || null,', 'src/app/a.ts', []],
    ['text: decideErr.message', 'src/app/a.ts', ['literal-message']],
    // unknown-error / payload-message
    ["const m = x ?? 'Unknown error';", 'src/app/a.ts', ['unknown-error']],
    ['const t = payload.message ?? code;', 'src/app/a.ts', ['payload-message']],
    // allowed: throw with the raw text, code comparisons
    ['if (error) throw new Error(error.message);', 'src/app/a.ts', []],
    ["if (msg.includes('username_taken')) return;", 'src/app/a.ts', []],
    // console
    ["console.warn('[x] y', e);", 'src/app/a.ts', ['console']],
    ['console.error(err);', 'src/app/a.ts', ['console']],
    ["console.warn(`[${scope}] ${msg}`);", 'src/app/core/log.ts', []],
    ["logWarn('x', 'y failed', e);", 'src/app/a.ts', []],
    // comments are ignored
    ['// this.error.set(err.message) was the old way', 'src/app/a.ts', []],
    ['/* console.warn(x) */ foo();', 'src/app/a.ts', []],
  ];
  let failed = 0;
  for (const [src, rel, expected] of cases) {
    const got = findRawErrors(src, rel).map((h) => h.id);
    const ok = JSON.stringify(got) === JSON.stringify(expected);
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${JSON.stringify(src)} → ${JSON.stringify(got)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
  }
  if (failed) {
    console.error(`\nselftest: ${failed} case(s) failed`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nselftest: ${cases.length}/${cases.length} passed`);
}

if (process.argv.includes('--selftest')) selftest();
else scan();
