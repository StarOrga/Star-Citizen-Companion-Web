#!/usr/bin/env node
// ============================================================
// check-native-ui.mjs — no native browser UI where the app has its own
//
// WHY (audit 2026-09-26, plan D03)
// --------------------------------
// window.confirm / window.prompt / window.alert render the browser's own
// grey box: unstyled, untranslatable buttons, no focus return, blocked by
// some embedders, and it freezes the page. The app has ScConfirmService
// (src/app/shared/dialog/) for exactly that. Ten native calls were replaced
// in one go; this guard runs in `prebuild` so a new one fails
// `npm run build` — locally, in the routine's web gate and in Vercel's PR
// preview build — instead of slipping back in unnoticed.
//
// SCOPE
// -----
// - Every src/app/**/*.ts except *.spec.ts (specs may spy on window APIs).
// - Only the qualified forms `window.x(` / `globalThis.x(`: a bare
//   `confirm(` would hit password-form.component.ts, where confirm() is a
//   signal.
// - HTML and JS comments are blanked before matching (comments often
//   explain why something is NOT used); line numbers stay correct because
//   every removed comment keeps its newlines. String literals are kept.
// - PATTERNS is a list on purpose. A pattern that needs to see across
//   lines can use the m flag; the scan runs over the whole file text.
//
// NATIVE TOOLTIPS AND SELECTS (audit plan D08)
// --------------------------------------------
// A native title tooltip is the browser's own box: no app look, a fixed
// delay, nothing on touch and nothing on keyboard focus. The app has
// ScTooltipDirective (src/app/shared/tooltip/) with an Info and a Label
// tier. `[attr.title]=` and an SVG `<title>` child are flagged. A plain
// `[title]=` is NOT: in this code base it is a component input
// (sc-app-download-panel) or the a11y name of an iframe, neither of which
// becomes a tooltip.
// A native <select> opens a list the operating system draws (a full-screen
// wheel on Android) — the app has ScSelectComponent. The pattern ends in
// (\s|$) with the m flag because several templates break the line right
// after "<select"; a comment like "native <select>" never matches, because
// ">" follows the tag name there (and comments are blanked anyway).
//
// USAGE
//   node scripts/check-native-ui.mjs            # scan src/app
//   node scripts/check-native-ui.mjs --selftest # verify the matchers
// ============================================================

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_ROOT = path.join(REPO_ROOT, 'src', 'app');

/** Each entry: a global regex and the app replacement to point at. */
export const PATTERNS = [
  {
    id: 'native-dialog',
    re: /\b(?:window|globalThis)\.(?:confirm|prompt|alert)\s*\(/g,
    hint: 'use ScConfirmService (src/app/shared/dialog/sc-confirm.service.ts)',
  },
  {
    id: 'native-title',
    re: /\[attr\.title\]\s*=/g,
    hint: 'use [scTooltip] (src/app/shared/tooltip/sc-tooltip.directive.ts)',
  },
  {
    id: 'svg-title',
    re: /<title>/g,
    hint: 'use [scTooltip] plus an aria-label on the element',
  },
  {
    id: 'native-select',
    re: /<select(?:\s|$)/gm,
    hint: 'use <sc-select> (src/app/shared/sc-select.component.ts)',
  },
];

/** Replace a comment with spaces, keeping its newlines. */
function blank(text) {
  return text.replace(/[^\n]/g, ' ');
}

/**
 * Blank out HTML comments and JS line/block comments; keep string and
 * template literals untouched (a `//` inside 'https://…' is not a comment).
 * Regex literals are not tokenised — a regex containing a quote could in
 * theory hide the rest of a line, an accepted edge case for this guard.
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
export function findNativeUi(text) {
  const clean = stripComments(text);
  const hits = [];
  for (const { id, re, hint } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(clean)) !== null) {
      const line = clean.slice(0, m.index).split('\n').length;
      hits.push({ line, id, match: m[0].trim(), hint });
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return hits.sort((a, b) => a.line - b.line);
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
    for (const hit of findNativeUi(readFileSync(file, 'utf8'))) findings.push({ rel, ...hit });
  }
  if (findings.length === 0) {
    console.log('check-native-ui: no native browser dialogs, title tooltips or selects in src/app.');
    return;
  }
  console.error('check-native-ui: native browser UI found — the app has its own component for this:\n');
  for (const f of findings) console.error(`  ${f.rel}:${f.line}  ${f.match}  → ${f.hint}`);
  console.error(`\n${findings.length} finding(s).`);
  process.exitCode = 1;
}

function selftest() {
  const cases = [
    ['if (!window.confirm(msg)) return;', [1]],
    ['const r = window.prompt("x", "");', [1]],
    ['globalThis.alert ("hi");', [1]],
    ['window.alert(\n"x")', [1]],
    // Not a native dialog: a signal named confirm, an own method.
    ['if (this.confirm()) {}', []],
    ['await this.dialog.confirm({ titleKey: "t" });', []],
    ['const confirm = signal(false); confirm();', []],
    // Comments are ignored, line numbers survive them.
    ['// never window.confirm(x) here\nfoo();', []],
    ['/* window.prompt(\n  x) */\nwindow.confirm(y);', [3]],
    ['<!-- window.alert(1) -->\n<p></p>', []],
    // A URL in a string is not a comment start.
    ["const u = 'https://example.com'; window.confirm(u);", [1]],
    // Strings are kept: a native call in a template string still counts.
    ['const t = `\n${window.confirm("x")}`;', [2]],
    // Native title tooltip: the attribute binding counts, a component input does not.
    ['<span [attr.title]="hint">x</span>', [1]],
    ['<sc-app-download-panel [title]="appTitle" />', []],
    ['<!-- no [attr.title]="x" here -->', []],
    // SVG title child.
    ['<g class="mk">\n  <title>{{ tip(m) }}</title>\n</g>', [2]],
    ['<!-- an SVG <title> is not enough -->', []],
    ['const pageTitle = "x";', []],
    // Native select, also when the tag name ends the line.
    ['<select class="x" [value]="v">', [1]],
    ['<label>\n  <select\n    class="x">', [2]],
    ['<sc-select [options]="o" />', []],
    ['// A native <select> would open the OS list.\nfoo();', []],
    ['<!-- not a native <select\n here -->', []],
  ];
  let failed = 0;
  for (const [src, expected] of cases) {
    const got = findNativeUi(src).map((h) => h.line);
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
