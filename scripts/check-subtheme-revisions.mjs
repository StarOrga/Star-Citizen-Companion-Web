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
// The same holds for the build recipes (data-uploader/src/lib/build-recipes.ts):
// a generated artifact (3D model, silhouette) is cached by its P4K bytes and its
// recipe, so a change that alters the artifacts without a recipe bump keeps
// serving the old ones. Acknowledged with `Recipe-Unchanged: model3d`.
//
// Usage: node scripts/check-subtheme-revisions.mjs [--base <ref>]
// Default base: origin/$GITHUB_BASE_REF, else origin/main. Needs full history
// (actions/checkout fetch-depth: 0). Node >= 22.18 (imports the .ts directly).

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const REGISTRIES = [
  { label: 'subtheme', path: 'data-uploader/src/lib/subthemes.ts', exportName: 'SUBTHEMES', trailer: 'Subtheme-Unchanged' },
  { label: 'build recipe', path: 'data-uploader/src/lib/build-recipes.ts', exportName: 'BUILD_RECIPES', trailer: 'Recipe-Unchanged' },
];

/**
 * `{ key: revision }` from a subthemes.ts / build-recipes.ts source text —
 * works on any revision of the file. `//` comment lines between `key` and
 * `revision` (the bump history) are skipped: without that, every commented
 * entry read as "new on this branch" and was never checked.
 */
export function parseRevisions(source) {
  const out = {};
  const re = /key:\s*'([a-z0-9_]+)',(?:\s*\/\/[^\n]*)*\s*revision:\s*(\d+)/g;
  for (const m of source.matchAll(re)) out[m[1]] = Number(m[2]);
  return out;
}

/** Keys acknowledged as unchanged by `<trailer>:` lines (default `Subtheme-Unchanged`); `all` = every key. */
export function parseAcks(commitBodies, allKeys, trailer = 'Subtheme-Unchanged') {
  const acked = new Set();
  for (const m of commitBodies.matchAll(new RegExp(`^${trailer}:\\s*(.+)$`, 'gim'))) {
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
  const bodies = git(['log', '--format=%B', `${mergeBase}..HEAD`]);

  for (const reg of REGISTRIES) {
    let oldSource = '';
    try {
      oldSource = git(['show', `${mergeBase}:${reg.path}`]);
    } catch {
      console.log(`${reg.label} revisions: ${reg.path} is new on this branch — nothing to compare.`);
      continue;
    }
    const entries = (await import(pathToFileURL(resolve(reg.path)).href))[reg.exportName];
    const acks = parseAcks(bodies, entries.map((s) => s.key), reg.trailer);
    const unbumped = findUnbumped({ changed, subthemes: entries, oldRevs: parseRevisions(oldSource), acks });
    if (!unbumped.length) {
      console.log(`${reg.label} revisions: ok`);
      continue;
    }
    console.error(`${reg.label} revision guard: these have changed sources but an unchanged revision.`);
    for (const u of unbumped) {
      console.error(`  - ${u.key} (revision ${u.revision}): ${u.files.slice(0, 5).join(', ')}${u.files.length > 5 ? ', …' : ''}`);
    }
    console.error(
      `\nBump its revision in ${reg.path} when the change alters what it produces,\n` +
        `or add a commit trailer when it does not:\n\n  ${reg.trailer}: ${unbumped.map((u) => u.key).join(', ')}\n`,
    );
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
