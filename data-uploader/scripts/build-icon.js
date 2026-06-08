#!/usr/bin/env node
/**
 * Generate the data-uploader app icons from the SINGLE brand source
 * `public/icons/scc-favicon.svg` — the same SCC monogram the web app shows in
 * its header/favicon. One logo for web + tool; no separate uploader artwork.
 *
 * Emits:
 *   - `build/icon.ico` — electron-builder's Windows taskbar / exe icon.
 *   - `build/icon.png` — the runtime BrowserWindow icon (main/index.ts).
 *
 * Pipeline: resvg-js renders the SVG at multiple resolutions → png-to-ico packs
 * them into a single multi-resolution .ico. Sizes follow Windows conventions
 * (16, 24, 32, 48, 64, 128, 256) so Explorer + Taskbar + Start menu all
 * pick the crispest match. resvg loads system fonts, so the monogram's
 * `Orbitron, 'Segoe UI', sans-serif` falls back to Segoe UI on the build host.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SVG_PATH = resolve(ROOT, '../public/icons/scc-favicon.svg');
const OUT_DIR = resolve(ROOT, 'build');
const OUT_ICO = resolve(OUT_DIR, 'icon.ico');
const OUT_PNG = resolve(OUT_DIR, 'icon.png');

const SIZES = [16, 24, 32, 48, 64, 128, 256];

function renderPng(svg, size) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'transparent',
  });
  return r.render().asPng();
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const svg = readFileSync(SVG_PATH, 'utf-8');

  const pngs = SIZES.map((s) => renderPng(svg, s));
  console.log(`rendered ${pngs.length} PNGs from ${SVG_PATH}`);

  const ico = await pngToIco(pngs);
  writeFileSync(OUT_ICO, ico);
  console.log(`wrote ${OUT_ICO} (${ico.length} bytes, sizes: ${SIZES.join(', ')})`);

  // 256px PNG for the BrowserWindow runtime icon (titlebar / alt-tab).
  writeFileSync(OUT_PNG, pngs[pngs.length - 1]);
  console.log(`wrote ${OUT_PNG} (${pngs[pngs.length - 1].length} bytes, 256px)`);
}

main().catch((err) => {
  console.error('icon build failed:', err);
  process.exit(1);
});
