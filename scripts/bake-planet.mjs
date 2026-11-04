#!/usr/bin/env node
/**
 * Bakes the Verse hub planet (concept 2026-10-29 "Verse-Planet Nachtseite")
 * into static assets under `public/planet/`.
 *
 * Why: the planet is the same world for everybody — one fixed seed. Generating
 * it in the browser (height field, rail network, a 4096 px night texture) cost
 * ~1.1 s of main-thread CPU on a fast desktop and several seconds on a phone,
 * on every page load, and the page's intro waited for it (or gave up after
 * 3 s and swapped the planet in mid-intro). Baked once, the browser downloads
 * ~0.4–0.7 MB a single time (cached by the service worker afterwards) and
 * decodes it off the main thread.
 *
 * Nothing about the planet changes: the textures are LOSSLESS WebP, and every
 * file is decoded again here and compared pixel for pixel with the canvas it
 * came from before anything is written. The world data carries the cities'
 * exact coordinates, so the rail network rebuilds bit-identically
 * (`worldFromBake`, covered by planet-assets.spec.ts).
 *
 *     npm run gen:planet            bake (needs Chrome/Chromium)
 *     node scripts/bake-planet.mjs --check
 *
 * `--check` (prebuild) needs no browser: it hashes the generator sources and
 * fails when they changed since the last bake, so a stale planet can't ship.
 *
 * Encoder: `cwebp` when on PATH, else Python + Pillow, else Chromium's own
 * lossless WebP (bigger files, same pixels). All three are lossless; the
 * verification step below holds any of them to that.
 */

import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPlaywrightChromium } from './lib/playwright-chromium.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public/planet');
const MANIFEST = resolve(OUT, 'manifest.json');
const SOURCES = [
  'src/app/verse/pages/briefing/planet/planet-world.ts',
  'src/app/verse/pages/briefing/planet/planet-textures.ts',
  'scripts/bake-planet.mjs',
];
/** Must match planet-assets.ts. */
const SEED = 1337;
const NIGHT_SIZES = [2048, 4096];
const FILES = ['day.webp', 'cloud.webp', 'night-2048.webp', 'night-4096.webp', 'world.json'];

/** sha256 over the generator sources, line endings normalised (Windows checkouts). */
export function sourceHash(root = ROOT) {
  const h = createHash('sha256');
  for (const rel of SOURCES) h.update(rel + '\0' + readFileSync(resolve(root, rel), 'utf8').replace(/\r\n/g, '\n') + '\0');
  return h.digest('hex');
}

function check() {
  const missing = FILES.filter((f) => !existsSync(resolve(OUT, f)));
  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch {
    /* reported below */
  }
  const want = sourceHash();
  if (missing.length || !manifest || manifest.source !== want) {
    console.error(
      '[bake-planet] public/planet/ is out of date with the planet generator ' +
        (missing.length ? `(missing: ${missing.join(', ')})` : '(source hash changed)') +
        '.\nRun `npm run gen:planet` and commit public/planet/.',
    );
    process.exit(1);
  }
  console.log('[bake-planet] public/planet/ matches the generator.');
}

function findChrome() {
  const env = process.env.CHROME_BIN || process.env.CHROME_PATH;
  if (env && existsSync(env)) return env;
  const pw = findPlaywrightChromium();
  if (pw) return pw;
  const sys = [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return sys.find((p) => existsSync(p)) ?? null;
}

/** Minimal CDP client over Node's built-in WebSocket (like scripts/mobile-gate.mjs). */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      const p = msg.id !== undefined && this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
    });
  }
  static connect(url) {
    return new Promise((res, rej) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => res(new Cdp(ws)));
      ws.addEventListener('error', () => rej(new Error(`Cannot connect to ${url}`)));
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}

async function launch(bin) {
  const profile = mkdtempSync(join(tmpdir(), 'bake-planet-'));
  // CPU raster (no GPU): the canvas output must not depend on the machine's graphics driver.
  const flags = ['--headless=new', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'];
  if (process.platform === 'linux' && process.getuid?.() === 0) flags.unshift('--no-sandbox');
  const proc = spawn(bin, flags, { stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.resume();
  const port = await new Promise((res, rej) => {
    const until = Date.now() + 20000;
    const poll = () => {
      try {
        const [p] = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n');
        if (p) return res(p.trim());
      } catch {
        /* not yet */
      }
      if (Date.now() > until) return rej(new Error('Chrome did not start'));
      setTimeout(poll, 100);
    };
    poll();
  });
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const cdp = await Cdp.connect(version.webSocketDebuggerUrl);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const close = () => {
    proc.kill();
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* Chrome may still hold files on Windows */
    }
  };
  return { evaluate, close };
}

/** The in-page half: generates the world, paints every texture, returns PNG data URLs. */
const ENTRY = `
import { generateWorld } from './src/app/verse/pages/briefing/planet/planet-world';
import { paintDay, paintNight } from './src/app/verse/pages/briefing/planet/planet-textures';
const run = (g) => { for (;;) { const r = g.next(); if (r.done) return r.value; } };
const canvases = {};
globalThis.__bake = () => {
  const world = run(generateWorld(${SEED}));
  const { day, cloud } = paintDay(world);
  canvases['day.webp'] = day;
  canvases['cloud.webp'] = cloud;
  for (const size of ${JSON.stringify(NIGHT_SIZES)}) canvases['night-' + size + '.webp'] = run(paintNight(world, size));
  const png = {};
  for (const [name, c] of Object.entries(canvases)) png[name] = c.toDataURL('image/png');
  return {
    png,
    world: {
      v: 1,
      seed: ${SEED},
      cities: world.cities.map((c) => [c.lat, c.lon, c.size]),
      edges: world.edges.map((e) => [e.a, e.b]),
    },
  };
};
/** Chromium's own lossless WebP (quality 1), the last-resort encoder. */
globalThis.__chromeWebp = async (name) => {
  const blob = await new Promise((r) => canvases[name].toBlob(r, 'image/webp', 1));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
/** Decodes an encoded file and compares it with the canvas it came from: [changed pixels, max error]. */
globalThis.__verify = async (name, b64) => {
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/webp' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const src = canvases[name];
  if (bmp.width !== src.width || bmp.height !== src.height) return [-1, 255];
  const k = document.createElement('canvas'); k.width = src.width; k.height = src.height;
  const x = k.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
  const a = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, src.width, src.height).data;
  const b = x.getImageData(0, 0, src.width, src.height).data;
  let changed = 0, max = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d) { changed++; if (d > max) max = d; } }
  return [changed, max];
};
`;

function encodeLossless(png, name, workDir) {
  const src = join(workDir, name.replace('.webp', '.png'));
  const dst = join(workDir, name);
  writeFileSync(src, png);
  const cwebp = spawnSync('cwebp', ['-quiet', '-lossless', '-z', '9', '-exact', src, '-o', dst]);
  if (cwebp.status === 0 && existsSync(dst)) return { bytes: readFileSync(dst), encoder: 'cwebp -lossless -z 9' };
  for (const py of ['python3', 'python']) {
    const pil = spawnSync(py, [
      '-c',
      'import sys\nfrom PIL import Image\nImage.open(sys.argv[1]).convert("RGB").save(sys.argv[2], "WEBP", lossless=True, quality=100, method=6)',
      src,
      dst,
    ]);
    if (pil.status === 0 && existsSync(dst)) return { bytes: readFileSync(dst), encoder: 'Pillow lossless method=6' };
  }
  return null;
}

async function bake() {
  const bin = findChrome();
  if (!bin) {
    console.error('[bake-planet] No Chrome/Chromium found — set CHROME_BIN.');
    process.exit(1);
  }
  const { build } = await import('esbuild');
  const bundle = await build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: 'ts', sourcefile: 'bake-entry.ts' },
    bundle: true,
    format: 'iife',
    write: false,
    logLevel: 'error',
  });
  const browser = await launch(bin);
  const work = mkdtempSync(join(tmpdir(), 'bake-planet-out-'));
  try {
    await browser.evaluate(bundle.outputFiles[0].text);
    const { png, world } = await browser.evaluate('globalThis.__bake()');
    mkdirSync(OUT, { recursive: true });
    const files = {};
    for (const [name, dataUrl] of Object.entries(png)) {
      const raw = Buffer.from(dataUrl.split(',')[1], 'base64');
      let enc = encodeLossless(raw, name, work);
      if (!enc) enc = { bytes: Buffer.from(await browser.evaluate(`globalThis.__chromeWebp(${JSON.stringify(name)})`), 'base64'), encoder: 'Chromium lossless (quality 1)' };
      const [changed, max] = await browser.evaluate(`globalThis.__verify(${JSON.stringify(name)}, ${JSON.stringify(enc.bytes.toString('base64'))})`);
      if (changed !== 0) throw new Error(`${name}: encoded file is not pixel-identical (${changed} values differ, max ${max})`);
      writeFileSync(resolve(OUT, name), enc.bytes);
      files[name] = { bytes: enc.bytes.length, encoder: enc.encoder };
      console.log(`[bake-planet] ${name}  ${(enc.bytes.length / 1024).toFixed(0)} kB  (${enc.encoder}, pixel-identical)`);
    }
    const worldJson = JSON.stringify(world);
    writeFileSync(resolve(OUT, 'world.json'), worldJson + '\n');
    files['world.json'] = { bytes: worldJson.length + 1, cities: world.cities.length, edges: world.edges.length };
    console.log(`[bake-planet] world.json  ${(worldJson.length / 1024).toFixed(0)} kB  (${world.cities.length} cities, ${world.edges.length} edges)`);
    writeFileSync(MANIFEST, JSON.stringify({ source: sourceHash(), seed: SEED, files }, null, 2) + '\n');
  } finally {
    browser.close();
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv.includes('--check')) check();
else await bake();
