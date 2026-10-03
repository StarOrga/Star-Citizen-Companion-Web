/**
 * Draw blueprints for hull GLBs on disk (docs/blueprint.md § Samples).
 *
 *   npx esbuild scripts/blueprint-from-glb.ts --bundle --platform=node --format=esm \
 *     --outfile=<tmp>/bp.mjs && node <tmp>/bp.mjs <out-dir> <name>=<hull.glb> [...]
 *
 * Writes <out-dir>/<name>.full.svg and <name>.icon.svg plus a timing line per hull.
 * The uploader runs the same code (src/main/blueprint-ingest.ts); this is for
 * samples and for checking a generator change against real hulls.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadHullMesh } from '../src/lib/blueprint/glb.js';
import { buildBlueprints } from '../src/lib/blueprint/build.js';

const [outDir, ...pairs] = process.argv.slice(2);
if (!outDir || !pairs.length) {
  console.error('usage: bp.mjs <out-dir> <name>=<hull.glb> [...]');
  process.exitCode = 2;
} else {
  mkdirSync(outDir, { recursive: true });
  for (const pair of pairs) {
    const [name, file] = pair.split('=');
    if (!name || !file) continue;
    const t0 = performance.now();
    const mesh = await loadHullMesh(readFileSync(file));
    const t1 = performance.now();
    const res = buildBlueprints(mesh);
    const t2 = performance.now();
    if (!res) {
      console.log(`${name}: nothing drawable`);
      continue;
    }
    writeFileSync(resolve(outDir, `${name}.full.svg`), res.full);
    writeFileSync(resolve(outDir, `${name}.icon.svg`), res.icon);
    console.log(
      `${name}: ${mesh.indices.length / 3} tris, ${mesh.positions.length / 3} verts, ` +
        `extent ${res.extentM.map((v) => v.toFixed(1)).join(' x ')} m, ` +
        `load ${(t1 - t0).toFixed(0)} ms, draw ${(t2 - t1).toFixed(0)} ms, ` +
        `full ${(res.full.length / 1024).toFixed(1)} kB, icon ${(res.icon.length / 1024).toFixed(1)} kB`,
    );
  }
}
