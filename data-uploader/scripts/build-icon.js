#!/usr/bin/env node
/**
 * Generate `data-uploader/build/icon.ico` from `public/icons/verse-compass.svg`.
 * electron-builder picks this up for the Windows taskbar / exe icon.
 *
 * Pipeline: resvg-js renders the SVG at multiple resolutions → png-to-ico packs
 * them into a single multi-resolution .ico. Sizes follow Windows conventions
 * (16, 24, 32, 48, 64, 128, 256) so Explorer + Taskbar + Start menu all
 * pick the crispest match.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SVG_PATH = resolve(ROOT, '../public/icons/verse-compass.svg');
const OUT_DIR = resolve(ROOT, 'build');
const OUT_ICO = resolve(OUT_DIR, 'icon.ico');

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
}

main().catch((err) => {
  console.error('icon build failed:', err);
  process.exit(1);
});
