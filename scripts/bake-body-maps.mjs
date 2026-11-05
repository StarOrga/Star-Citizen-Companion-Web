#!/usr/bin/env node
/**
 * Bakes the Verse stage's small bodies' SVG maps (public/img/verse/maps/) into
 * lossless WebP under public/planet/bodies/, at both raster widths the page uses
 * (`bodyMapWidth`).
 *
 * Why: the maps' SVG filters run when the raster is read back, and only a document
 * can rasterise an SVG, so that cost ~1.4 s on the main thread in tasks of up to
 * ~0.55 s on every visit. A WebP decodes in the bodies' worker instead.
 *
 * The raster here is the page's own: same `<img>`, same `drawImage` into a canvas
 * of the same size. Every file is decoded again and compared with that canvas
 * before anything is written.
 *
 * Unlike the planet's, this bake runs on a real GPU, and refuses a software
 * renderer (`--allow-software` overrides). The SVG filters come out differently
 * on Skia's GPU and CPU backends: 75-85 % of a map's pixels differ, by 1-2 of 255
 * on average. Browsers with a GPU rastered these maps with theirs until now, so
 * the GPU's result is the picture to keep. The manifest names the renderer.
 *
 *     npm run gen:body-maps
 *     node scripts/bake-body-maps.mjs --check     (prebuild, needs no browser)
 *
 * `--check` hashes the SVGs and this script and fails when they changed since the
 * last bake. `--verify-only` re-rasterises and compares without writing.
 */

import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPlaywrightChromium } from './lib/playwright-chromium.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAPS = resolve(ROOT, 'public/img/verse/maps');
const OUT = resolve(ROOT, 'public/planet/bodies');
const MANIFEST = resolve(OUT, 'manifest.json');
/** Must match bodyMapWidth() in body-engine.ts. */
const WIDTHS = [512, 1024];

const mapNames = () => readdirSync(MAPS).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)).sort();
const fileOf = (name, width) => `${name}-${width}.webp`;

/** sha256 over the SVGs and this script, line endings normalised (Windows checkouts). */
export function sourceHash() {
  const h = createHash('sha256');
  const rels = [...mapNames().map((n) => `public/img/verse/maps/${n}.svg`), 'scripts/bake-body-maps.mjs'];
  for (const rel of rels) h.update(rel + '\0' + readFileSync(resolve(ROOT, rel), 'utf8').replace(/\r\n/g, '\n') + '\0');
  return h.digest('hex');
}

function check() {
  const missing = mapNames().flatMap((n) => WIDTHS.map((w) => fileOf(n, w))).filter((f) => !existsSync(resolve(OUT, f)));
  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch {
    /* reported below */
  }
  if (missing.length || !manifest || manifest.source !== sourceHash()) {
    console.error(
      '[bake-body-maps] public/planet/bodies/ is out of date with the SVG maps ' +
        (missing.length ? `(missing: ${missing.join(', ')})` : '(source hash changed)') +
        '.\nRun `npm run gen:body-maps` and commit public/planet/bodies/.',
    );
    process.exit(1);
  }
  console.log('[bake-body-maps] public/planet/bodies/ matches the SVG maps.');
}

function findChrome() {
  const env = process.env.CHROME_BIN || process.env.CHROME_PATH;
  if (env && existsSync(env)) return env;
  const pw = findPlaywrightChromium();
  if (pw) return pw;
  return ['/usr/bin/google-chrome', '/usr/bin/chromium', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p)) ?? null;
}

/** One page on a local server, driven over CDP with Node's built-in WebSocket. */
async function openPage(bin, url) {
  const profile = mkdtempSync(join(tmpdir(), 'bake-body-maps-'));
  const gpu = process.platform === 'win32' ? ['--use-angle=d3d11', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist'];
  const flags = ['--headless=new', ...gpu, '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'];
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
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', () => rej(new Error('Cannot connect to Chrome')));
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data));
    const p = msg.id !== undefined && pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message));
    else p.resolve(msg.result);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((res, rej) => {
      const n = ++id;
      pending.set(n, { resolve: res, reject: rej });
      ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  const { targetId } = await send('Target.createTarget', { url });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  // Target.createTarget answers before the navigation is through.
  for (let i = 0; i < 200 && !(await evaluate(`location.protocol === 'http:' && document.readyState === 'complete'`)); i++) await new Promise((r) => setTimeout(r, 50));
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

/** The in-page half. `raster` is body-engine.ts's rasterize(), line for line. */
const PAGE = `
const canvases = {};
/** What a texture holds after this bitmap's upload: the pixels the shader samples. */
const uploaded = (bmp, w) => {
  const gl = document.createElement('canvas').getContext('webgl');
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
  gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, gl.getParameter(gl.TEXTURE_BINDING_2D), 0);
  const d = new Uint8ClampedArray(w * (w / 2) * 4);
  gl.readPixels(0, 0, w, w / 2, gl.RGBA, gl.UNSIGNED_BYTE, d);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return d;
};
globalThis.__raster = async (name, w) => {
  const img = new Image();
  img.decoding = 'async';
  img.src = '/img/verse/maps/' + name + '.svg';
  await img.decode();
  const c = document.createElement('canvas');
  c.width = w;
  c.height = w / 2;
  c.getContext('2d').drawImage(img, 0, 0, w, w / 2);
  // Read back through the path the raster takes at runtime: bitmap, texture upload.
  const d = uploaded(await createImageBitmap(c, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }), w);
  let translucent = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) translucent++;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = w / 2;
  out.getContext('2d', { willReadFrequently: true }).putImageData(new ImageData(d, w, w / 2), 0, 0);
  canvases[name + '-' + w + '.webp'] = out;
  return { png: out.toDataURL('image/png'), translucent };
};
globalThis.__renderer = () => {
  const gl = document.createElement('canvas').getContext('webgl');
  const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'none';
};
globalThis.__chromeWebp = async (file) => {
  const blob = await new Promise((r) => canvases[file].toBlob(r, 'image/webp', 1));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
globalThis.__verify = async (file, b64) => {
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/webp' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const src = canvases[file];
  if (bmp.width !== src.width || bmp.height !== src.height) return [-1, 255];
  const a = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, src.width, src.height).data;
  const b = uploaded(bmp, src.width);
  let changed = 0, max = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d) { changed++; if (d > max) max = d; } }
  return [changed, max];
};
`;

function encodeLossless(png, file, workDir) {
  const src = join(workDir, file.replace('.webp', '.png'));
  const dst = join(workDir, file);
  writeFileSync(src, png);
  const cwebp = spawnSync('cwebp', ['-quiet', '-lossless', '-z', '9', '-exact', src, '-o', dst]);
  if (cwebp.status === 0 && existsSync(dst)) return { bytes: readFileSync(dst), encoder: 'cwebp -lossless -z 9' };
  for (const py of ['python3', 'python']) {
    const pil = spawnSync(py, ['-c', 'import sys\nfrom PIL import Image\nImage.open(sys.argv[1]).convert("RGB").save(sys.argv[2], "WEBP", lossless=True, quality=100, method=6)', src, dst]);
    if (pil.status === 0 && existsSync(dst)) return { bytes: readFileSync(dst), encoder: 'Pillow lossless method=6' };
  }
  return null;
}

async function bake(write) {
  const bin = findChrome();
  if (!bin) {
    console.error('[bake-body-maps] No Chrome/Chromium found — set CHROME_BIN.');
    process.exit(1);
  }
  const server = createServer((q, r) => {
    const m = /^\/img\/verse\/maps\/([a-z-]+\.svg)$/.exec(q.url);
    if (!m) return r.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html>');
    r.writeHead(200, { 'content-type': 'image/svg+xml' });
    r.end(readFileSync(join(MAPS, m[1])));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const page = await openPage(bin, `http://127.0.0.1:${server.address().port}/`);
  const work = mkdtempSync(join(tmpdir(), 'bake-body-maps-out-'));
  try {
    await page.evaluate(PAGE);
    const renderer = await page.evaluate('globalThis.__renderer()');
    if (/swiftshader|llvmpipe|basic render|^none$/i.test(renderer) && !process.argv.includes('--allow-software')) {
      throw new Error(`no GPU here (${renderer}): the maps would not match what browsers with a GPU rastered. --allow-software overrides.`);
    }
    console.log(`[bake-body-maps] raster on ${renderer}`);
    mkdirSync(OUT, { recursive: true });
    const files = {};
    for (const name of mapNames()) {
      for (const w of WIDTHS) {
        const file = fileOf(name, w);
        const { png, translucent } = await page.evaluate(`globalThis.__raster(${JSON.stringify(name)}, ${w})`);
        // Opaque, or a round trip through unpremultiplied alpha could not be exact.
        if (translucent) throw new Error(`${file}: ${translucent} translucent pixels`);
        let enc = encodeLossless(Buffer.from(png.split(',')[1], 'base64'), file, work);
        if (!enc) enc = { bytes: Buffer.from(await page.evaluate(`globalThis.__chromeWebp(${JSON.stringify(file)})`), 'base64'), encoder: 'Chromium lossless (quality 1)' };
        const fresh = await page.evaluate(`globalThis.__verify(${JSON.stringify(file)}, ${JSON.stringify(enc.bytes.toString('base64'))})`);
        if (fresh[0] !== 0) throw new Error(`${file}: encoded file is not pixel-identical (${fresh[0]} values differ, max ${fresh[1]})`);
        if (write) {
          writeFileSync(resolve(OUT, file), enc.bytes);
          files[file] = { bytes: enc.bytes.length, encoder: enc.encoder };
        }
        console.log(`[bake-body-maps] ${file}  ${(enc.bytes.length / 1024).toFixed(0)} kB  (${enc.encoder}, pixel-identical)`);
      }
    }
    if (write) writeFileSync(MANIFEST, JSON.stringify({ source: sourceHash(), renderer, widths: WIDTHS, files }, null, 2) + '\n');
  } finally {
    page.close();
    server.close();
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv.includes('--check')) check();
else await bake(!process.argv.includes('--verify-only'));
