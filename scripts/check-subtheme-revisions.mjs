#!/usr/bin/env node
// Subtheme revision guard (data-uploader/src/lib/subthemes.ts).
//
// The Data Uploader skips a subtheme when the server already holds it for the
// same game build at the uploader's current revision for it. A change that
// alters what a subtheme uploads therefore MUST bump that revision — otherwise
// the server keeps the old output forever. This guard fails a branch that
// touches a subtheme's `sources` without bumping its revision, unless a commit
// on the branch acknowledges it with a trailer:
//
//   Subtheme-Unchanged: ships, items      (or: Subtheme-Unchanged: all)
//
// Usage: node scripts/check-subtheme-revisions.mjs [--base <ref>]
// Default base: origin/$GITHUB_BASE_REF, else origin/main. Needs full history
// (actions/checkout fetch-depth: 0). Node >= 22.18 (imports the .ts directly).

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const SUBTHEMES_PATH = 'data-uploader/src/lib/subthemes.ts';

/** `{ key: revision }` from a subthemes.ts source text — works on any revision of the file. */
export function parseRevisions(source) {
  const out = {};
  for (const m of source.matchAll(/key:\s*'([a-z_]+)',\s*revision:\s*(\d+)/g)) out[m[1]] = Number(m[2]);
  return out;
}

/** Subtheme keys acknowledged as unchanged by `Subtheme-Unchanged:` trailers; `all` = every key. */
export function parseAcks(commitBodies, allKeys) {
  const acked = new Set();
  for (const m of commitBodies.matchAll(/^Subtheme-Unchanged:\s*(.+)$/gim)) {
    for (const raw of m[1].split(',')) {
      const k = raw.trim().toLowerCase();
      if (k === 'all') allKeys.forEach((x) => acked.add(x));
      else if (k) acked.add(k);
    }
  }
  return acked;
}

/**
 * Subthemes whose sources changed but whose revision did not go up and that no
 * trailer acknowledges. A subtheme absent from the base file is new — its first
 * revision needs no bump.
 */
export function findUnbumped({ changed, subthemes, oldRevs, acks }) {
  const out = [];
  for (const s of subthemes) {
    const hits = changed.filter((f) => s.sources.some((src) => f === src || f.startsWith(src)));
    if (!hits.length) continue;
    if (!(s.key in oldRevs)) continue;
    if (s.revision > oldRevs[s.key]) continue;
    if (acks.has(s.key)) continue;
    out.push({ key: s.key, revision: s.revision, files: hits });
  }
  return out;
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

async function main() {
  const i = process.argv.indexOf('--base');
  const base =
    i > -1 ? process.argv[i + 1] : process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main';
  const mergeBase = git(['merge-base', base, 'HEAD']);
  const changed = git(['diff', '--name-only', `${mergeBase}...HEAD`]).split('\n').filter(Boolean);

  let oldSource = '';
  try {
    oldSource = git(['show', `${mergeBase}:${SUBTHEMES_PATH}`]);
  } catch {
    console.log('subtheme revisions: subthemes.ts is new on this branch — nothing to compare.');
    return;
  }
  const { SUBTHEMES } = await import(pathToFileURL(resolve(SUBTHEMES_PATH)).href);
  const acks = parseAcks(
    git(['log', '--format=%B', `${mergeBase}..HEAD`]),
    SUBTHEMES.map((s) => s.key),
  );
  const unbumped = findUnbumped({ changed, subthemes: SUBTHEMES, oldRevs: parseRevisions(oldSource), acks });
  if (!unbumped.length) {
    console.log('subtheme revisions: ok');
    return;
  }
  console.error('Subtheme revision guard: these subthemes have changed sources but an unchanged revision.');
  for (const u of unbumped) {
    console.error(`  - ${u.key} (revision ${u.revision}): ${u.files.slice(0, 5).join(', ')}${u.files.length > 5 ? ', …' : ''}`);
  }
  console.error(
    `\nBump its revision in ${SUBTHEMES_PATH} when the change alters what the subtheme uploads,\n` +
      `or add a commit trailer when it does not:\n\n  Subtheme-Unchanged: ${unbumped.map((u) => u.key).join(', ')}\n`,
  );
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
