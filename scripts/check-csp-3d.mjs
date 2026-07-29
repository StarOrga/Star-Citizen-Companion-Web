/**
 * Guard: the deployed Content-Security-Policy must still permit the 3D viewer.
 *
 * Why this exists. The Codex 3D ship view (`<model-viewer>`, Draco-compressed
 * hull glbs) was silently dead in production from the day the CSP landed in
 * PR #200 until 2026-07-28. Nothing failed at build time, no test went red, and
 * the app degraded to a polite "3D-Modell konnte nicht geladen werden" — so the
 * only way to notice was to open the deployed site and look at a ship.
 *
 * The renderer needs four things the default-deny policy does not grant:
 *
 *   1. `img-src blob:`     — three.js decodes glb textures into blob: URLs and
 *                            loads them as images.
 *   2. `connect-src blob:` — and fetches some of them back.
 *   3. `worker-src blob:`  — the Draco decoder runs in a worker created from a
 *                            blob.
 *   4. `script-src 'wasm-unsafe-eval'` — instantiating the Draco WebAssembly
 *                            module. This is deliberately NOT 'unsafe-eval':
 *                            it permits WASM compilation only, not eval().
 *   5. `connect-src https://www.gstatic.com` — model-viewer fetches the Draco
 *                            decoder from Google's CDN. Self-hosting it via the
 *                            documented `dracoDecoderLocation` does NOT work:
 *                            model-viewer resets that static back to its own
 *                            default while loading (measured, not assumed).
 *                            Removing this entry therefore requires changing
 *                            the COMPRESSION in the uploader, not the CSP.
 *
 * The gstatic entry is TRANSITIONAL (#305). `hull3d.py` now emits meshopt, whose
 * decoder is served same-origin from `public/meshopt/`, and the viewer already
 * reads both formats. Once every hull in the bucket has been re-exported as
 * meshopt, drop `https://www.gstatic.com` from vercel.json AND from REQUIRED
 * below — but not before, or the Draco hulls still in the bucket go dark.
 *
 * This is a static check, and it is honest about that: it proves the policy
 * still contains what the renderer needs, not that the renderer works. The
 * end-to-end proof is a browser rendering the production build against this
 * exact policy — see the PR that introduced this file.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));

const csp = vercel.headers
  ?.flatMap((h) => h.headers ?? [])
  .find((h) => h.key === 'Content-Security-Policy')?.value;

if (!csp) {
  console.error('✗ No Content-Security-Policy found in vercel.json.');
  process.exit(1);
}

/** The policy split into `directive -> [sources]`. */
const directives = new Map(
  csp
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [name, ...sources] = part.split(/\s+/);
      return [name, sources];
    }),
);

/** [directive, required source, why it is needed] */
const REQUIRED = [
  ['img-src', 'blob:', 'three.js decodes glb textures into blob: images'],
  ['connect-src', 'blob:', 'those blob: textures are fetched back'],
  ['worker-src', 'blob:', 'the Draco decoder runs in a blob: worker'],
  ['script-src', "'wasm-unsafe-eval'", 'instantiating the Draco WebAssembly module'],
  ['connect-src', 'https://www.gstatic.com', "model-viewer's Draco decoder CDN"],
];

const missing = REQUIRED.filter(([directive, source]) => {
  const sources = directives.get(directive);
  // An absent directive falls back to default-src, which is 'self' here — so a
  // missing directive is just as broken as a directive without the source.
  return !sources || !sources.includes(source);
});

// The self-hosted meshopt decoder is a build ASSET, not a policy entry, but it
// fails the same way: silently, at runtime, on one route. model-viewer bundles
// the decoder yet only registers it once `meshoptDecoderLocation` resolves, so a
// missing file means every meshopt hull dies with "setMeshoptDecoder must be
// called before loading compressed files" — with a green build and green tests.
const MESHOPT_ASSETS = [
  // What `meshoptDecoderLocation` points at — must be a CLASSIC script.
  'public/meshopt/meshopt_decoder.loader.js',
  // The real decoder it dynamic-imports.
  'public/meshopt/meshopt_decoder.module.js',
];
const MESHOPT_DECODER = MESHOPT_ASSETS.find((f) => !existsSync(join(root, f)));
if (MESHOPT_DECODER) {
  console.error(`✗ ${MESHOPT_DECODER} is missing — meshopt-compressed hulls cannot be decoded.`);
  console.error('  It is served same-origin on purpose (no CDN); restore it with:');
  console.error('    cp node_modules/three/examples/jsm/libs/meshopt_decoder.module.js public/meshopt/');
  process.exit(1);
}

if (missing.length > 0) {
  console.error('✗ The Content-Security-Policy in vercel.json would break the Codex 3D ship view.\n');
  for (const [directive, source, why] of missing) {
    console.error(`  ${directive} is missing ${source}`);
    console.error(`    needed for: ${why}\n`);
  }
  console.error('  If this is intentional, the 3D viewer has to change too — do not just');
  console.error('  delete this check. See scripts/check-csp-3d.mjs for the full rationale.');
  process.exit(1);
}

console.log(`✓ CSP still permits the 3D viewer (${REQUIRED.length} required sources present).`);
