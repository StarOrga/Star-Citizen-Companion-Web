#!/usr/bin/env node
/**
 * Fetch python-build-standalone for embedded use, install our sidecar requirements,
 * and produce a slim resources/python/ tree that electron-builder bundles into
 * the packaged app. Run before `electron-builder` whenever we want to ship a
 * build with an embedded interpreter.
 *
 * Output layout (Windows, x64):
 *   resources/python/
 *     python.exe
 *     python313.dll
 *     Lib/site-packages/<scdatatools, Pillow, imageio, …>
 *     sc_extract/                ← copied from desktop-tool/python/sc_extract
 *
 * The main process spawns:
 *   resources/python/python.exe -m sc_extract.extract --p4k <…> --out <…>
 *
 * python-build-standalone (Astral, BSD-3) ships a fully-relocatable Python
 * with no system dependency, which is the standard pattern for sidecar-style
 * Electron tools (e.g. Cursor, GitHub-Desktop's git2-rs sidecars).
 *
 * Versions pinned for reproducibility — bump deliberately. The release-asset
 * filename pattern Astral publishes for each tag is `cpython-{version}+{date}-{triple}-{flavor}.tar.zst`.
 */

import { createWriteStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
// Pinned to 3.10 because scdatatools 1.0.0 declares `numpy~=1.21.5`
// (range `>=1.21.5, <1.22`). Every numpy 1.21.x wheel declares
// `Requires-Python: >=3.7, <3.11` — STRICT upper bound, so 3.11+ also
// fails (originally tried 3.13 → fail; then 3.11.10 → fail with the same
// error). 3.10 is the latest Python that pip-installs scdatatools 1.0.0
// cleanly. To lift this, bump scdatatools to 2.x (which supports modern
// numpy) before bumping Python. Full rationale:
// `.claude/deep-knowledge/desktop-tool-python.md`.
const PYTHON_VERSION = '3.10.15';
// Bump this whenever python-build-standalone publishes a new release for
// the chosen Python version. See https://github.com/astral-sh/python-build-standalone/releases.
const PBS_RELEASE = '20241016';
const ASSET = `cpython-${PYTHON_VERSION}+${PBS_RELEASE}-x86_64-pc-windows-msvc-install_only.tar.gz`;
const URL = `https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_RELEASE}/${ASSET}`;

const OUT_DIR = resolve(ROOT, 'resources/python');
const DOWNLOADS = resolve(ROOT, '.cache/python-downloads');
const ARCHIVE = resolve(DOWNLOADS, ASSET);
const SIDECAR_SRC = resolve(ROOT, 'python');
const SIDECAR_DEST = resolve(OUT_DIR, 'sc_extract');
const REQUIREMENTS = resolve(SIDECAR_SRC, 'requirements.txt');

function log(msg) {
  process.stdout.write(`[fetch-python] ${msg}\n`);
}

async function downloadIfMissing() {
  if (existsSync(ARCHIVE) && statSync(ARCHIVE).size > 1_000_000) {
    log(`archive cached: ${ARCHIVE}`);
    return;
  }
  mkdirSync(DOWNLOADS, { recursive: true });
  log(`downloading ${URL}`);
  const res = await fetch(URL, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`download failed: HTTP ${res.status} ${res.statusText}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(ARCHIVE));
  log(`saved ${ARCHIVE} (${(statSync(ARCHIVE).size / 1024 / 1024).toFixed(1)} MB)`);
}

async function extract() {
  if (existsSync(OUT_DIR)) {
    log(`cleaning ${OUT_DIR}`);
    rmSync(OUT_DIR, { recursive: true, force: true });
  }
  mkdirSync(OUT_DIR, { recursive: true });
  // python-build-standalone packs everything under a top-level `python/` dir.
  // tar's --strip-components=1 unpacks directly into OUT_DIR.
  log(`extracting → ${OUT_DIR}`);
  await spawnP('tar', ['-xzf', ARCHIVE, '-C', OUT_DIR, '--strip-components=1']);
}

async function installRequirements() {
  if (!existsSync(REQUIREMENTS)) {
    log(`no requirements.txt — skipping pip install`);
    return;
  }
  const exe = resolve(OUT_DIR, 'python.exe');
  if (!existsSync(exe)) throw new Error(`python.exe not found at ${exe}`);
  log(`installing requirements via embedded pip`);
  await spawnP(exe, ['-m', 'pip', 'install', '--no-warn-script-location', '-r', REQUIREMENTS]);
}

async function copySidecar() {
  if (!existsSync(SIDECAR_SRC)) {
    throw new Error(`sidecar source not found at ${SIDECAR_SRC}`);
  }
  // robocopy on Windows / cp -r elsewhere. Use platform-agnostic node API.
  const { cpSync } = await import('node:fs');
  if (existsSync(SIDECAR_DEST)) rmSync(SIDECAR_DEST, { recursive: true, force: true });
  log(`copying sc_extract → ${SIDECAR_DEST}`);
  cpSync(resolve(SIDECAR_SRC, 'sc_extract'), SIDECAR_DEST, { recursive: true });
}

function spawnP(cmd, args) {
  return new Promise((resolveP, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolveP() : reject(new Error(`${cmd} exited ${code}`))));
    child.on('error', reject);
  });
}

async function main() {
  if (process.platform !== 'win32' && !process.env.SC_FETCH_PYTHON_FORCE) {
    log(`platform=${process.platform} — skipping (Windows-only build for now). Set SC_FETCH_PYTHON_FORCE=1 to force.`);
    return;
  }
  await downloadIfMissing();
  await extract();
  await installRequirements();
  await copySidecar();
  log(`done. resources/python/ ready for electron-builder.`);
}

main().catch((err) => {
  process.stderr.write(`[fetch-python] FAILED: ${err.message}\n`);
  process.exit(1);
});
