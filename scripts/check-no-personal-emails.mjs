#!/usr/bin/env node
// ============================================================
// check-no-personal-emails.mjs — keep personal addresses out of a PUBLIC repo
//
// WHY (admin_feedback #83, 2026-08-07)
// ------------------------------------
// StarOrga/Star-Citizen-Companion-Web is public. Every literal e-mail
// address committed here is a personal address published for good and
// scraped within hours. The founder-protection migrations used to pin the
// two founder accounts by their plain addresses; they now compare the
// SHA-256 of the lowercased address instead (see
// supabase/migrations/20260802080000_protected_admins.sql).
//
// That cleanup is a one-shot. THIS is the part that lasts: the check runs
// as part of `prebuild`, so `npm run build` — locally, in the routine's
// web gate, and in Vercel's PR preview build — fails the moment a new
// personal address is added.
//
// SCOPE, honestly stated
// ----------------------
// - It cannot un-publish anything. Addresses in earlier commits stay in
//   the git history and in GitHub's commit metadata forever; only a
//   history rewrite (force-push, breaks every clone/fork) would touch
//   those, and that is a human decision, not a build step.
// - A digest is anti-scraping, not secrecy: it confirms an address you
//   already guessed. It stops crawlers, not a targeted look-up.
//
// USAGE
//   node scripts/check-no-personal-emails.mjs            # scan tracked files
//   node scripts/check-no-personal-emails.mjs --selftest # verify the matcher
//
// To pin a new account by digest instead of address:
//   node -e "console.log(require('crypto').createHash('sha256').update('<addr>'.toLowerCase()).digest('hex'))"
// ============================================================

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Deliberately conservative: requires a real-looking TLD, so npm scopes
// ("@angular/core"), CSS at-rules ("@media") and versions ("pkg@1.2.3")
// never match.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Paths that may legitimately carry an address.
const ALLOWED_PATHS = [
  // Vendored third-party bundles ship their author's address in the
  // upstream copyright header — not ours to strip.
  /^public\/meshopt\//,
  // Lockfiles: machine-generated, sometimes carry maintainer addresses.
  /(^|\/)package-lock\.json$/,
  /(^|\/)Cargo\.lock$/,
  // This file: it documents the rule and carries the test fixtures.
  /^scripts\/check-no-personal-emails\.mjs$/,
];

// URLs are stripped before matching: `https://user:pass@host.com` and
// `https://real.host.com@evil.tld` both look like addresses to the regex,
// and the repo's RSI link-spoofing fixtures are full of them. `mailto:`
// has no `//`, so a mailto to a real person still gets caught.
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;

// Address shapes that are documentation, not a person.
const ALLOWED_ADDRESSES = [
  /@example\.(com|org|net)$/i,
  // RFC 2606 / RFC 6761 reserved TLDs + the obvious fakes used in specs.
  /\.(test|invalid|example|localhost|local|tld)$/i,
  /@(test|invalid|localhost|domain\.com|mail\.com)$/i,
  /@users\.noreply\.github\.com$/i,
  // Our own domains — a project mailbox is not a personal address.
  /@sc-companion\./i,
  /@starorga\./i,
  /^(no-?reply|noreply|do-?not-?reply|support|info|hello|contact|admin|webmaster|postmaster)@/i,
  /^(you|your|user|username|name|email|e-mail|mail|someone|somebody|first\.last|max\.mustermann|john\.doe|jane\.doe|foo|bar|test|dummy|sample|placeholder|dein|deine)@/i,
];

// A license/copyright line must keep its author's address to stay valid.
const LICENSE_LINE_RE = /copyright|\(c\)\s*\d{4}|©|SPDX-|@author|licen[sc]e/i;

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.pdf', '.zip',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp4', '.webm', '.wasm', '.exe',
  '.dll', '.bin', '.glb', '.gltf', '.dds', '.map',
]);

const MAX_BYTES = 4 * 1024 * 1024;

function isAllowedPath(rel) {
  return ALLOWED_PATHS.some((re) => re.test(rel));
}

function isAllowedAddress(addr) {
  return ALLOWED_ADDRESSES.some((re) => re.test(addr));
}

/** The single matcher both the scan and the selftest go through. */
export function findViolations(rel, content) {
  if (isAllowedPath(rel)) return [];
  const out = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (LICENSE_LINE_RE.test(line)) continue;
    // Blank out URLs first — their userinfo/host parts are not addresses.
    const scanned = line.replace(URL_RE, ' ');
    for (const match of scanned.matchAll(EMAIL_RE)) {
      const addr = match[0];
      if (isAllowedAddress(addr)) continue;
      out.push({ file: rel, line: i + 1, address: addr });
    }
  }
  return out;
}

function trackedFiles() {
  const raw = execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return raw.split('\0').filter(Boolean);
}

function scan() {
  const violations = [];
  for (const rel of trackedFiles()) {
    if (BINARY_EXT.has(path.extname(rel).toLowerCase())) continue;
    const abs = path.join(REPO_ROOT, rel);
    let size;
    try {
      size = statSync(abs).size;
    } catch {
      continue; // deleted-but-tracked during a rebase, etc.
    }
    if (size > MAX_BYTES) continue;
    let content;
    try {
      content = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (content.includes('\0')) continue; // binary without a known extension
    violations.push(...findViolations(rel, content));
  }
  return violations;
}

function selftest() {
  const cases = [
    // [relPath, content, expectedViolationCount, label]
    ['a.sql', "where email = 'real.person@gmail.com'", 1, 'plain address is caught'],
    ['a.sql', "= 'd6deeeba4dcdf15e121a7a1b0ce98f1c4c0330cd77d272d86f254c49ad12d687'", 0, 'sha256 digest is clean'],
    ['a.ts', "import { x } from '@angular/core';", 0, 'npm scope is not an address'],
    ['a.scss', '@media (min-width: 48rem) { }', 0, 'CSS at-rule is not an address'],
    ['a.json', '"pkg": "sc-companion@1.2.3"', 0, 'version spec is not an address'],
    ['a.md', 'mail an user@example.com schicken', 0, 'example.com is allowed'],
    ['a.yml', 'git config user.email "Someone@users.noreply.github.com"', 0, 'noreply is allowed'],
    ['a.ts', '// Copyright (C) 2016, by Someone (someone@vendor.com)', 0, 'license line is allowed'],
    ['public/meshopt/x.js', 'someone@vendor.com', 0, 'vendored path is allowed'],
    ['a.md', 'a@b.de and c@d.io', 2, 'counts every hit on a line'],
    ['a.spec.ts', "expect(f('https://real.host.com@evil.tld')).toBe(null);", 0, 'URL host-spoof fixture is not an address'],
    ['a.spec.ts', "const u = 'https://user:pass@real.host.com';", 0, 'URL userinfo is not an address'],
    ['a.spec.ts', "const m = 'a@b.test';", 0, 'reserved .test TLD is allowed'],
    ['a.md', 'testlocal@sc-companion.dev', 0, 'our own domain is allowed'],
    ['a.html', '<a href="mailto:real.person@gmail.com">', 1, 'mailto to a person is still caught'],
  ];

  let failed = 0;
  for (const [rel, content, expected, label] of cases) {
    const got = findViolations(rel, content).length;
    if (got !== expected) {
      failed++;
      console.error(`  ✗ ${label} — expected ${expected}, got ${got}`);
    } else {
      console.log(`  ✓ ${label}`);
    }
  }
  if (failed) {
    console.error(`\nselftest: ${failed} case(s) failed`);
    process.exit(1);
  }
  console.log(`\nselftest: ${cases.length}/${cases.length} passed`);
}

if (process.argv.includes('--selftest')) {
  selftest();
} else {
  const violations = scan();
  if (violations.length === 0) {
    console.log('✓ no personal e-mail addresses in tracked files');
  } else {
    console.error('\n✗ personal e-mail address(es) found in a PUBLIC repo:\n');
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  ${v.address}`);
    }
    console.error(`
Do not commit a personal address here. Options:

  1. Match by digest instead (what the founder-protection migrations do):
       node -e "console.log(require('crypto').createHash('sha256').update('<addr>'.toLowerCase()).digest('hex'))"
     then compare in SQL with
       encode(sha256(convert_to(lower(email), 'UTF8')), 'hex') = '<digest>'
  2. Use a placeholder (user@example.com) if it is only documentation.
  3. If the address is genuinely fine to publish (a vendored license
     header, a role address like support@…), add it to ALLOWED_PATHS /
     ALLOWED_ADDRESSES in ${path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).replace(/\\/g, '/')}.
`);
    process.exit(1);
  }
}
