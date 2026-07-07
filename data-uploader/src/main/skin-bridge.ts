/**
 * Skin-export bridge — spawns `sc_extract.skin_export_app` and streams its
 * JSON-line events (events.py contract, same shape the extract flow uses) to
 * the renderer. Also ensures the external cgf-converter build tool is present
 * (downloaded once into userData/tools — too large to bundle).
 *
 * The glTF optimizer (gltf-transform) runs through Electron's OWN Node via the
 * SC_GLTF_TRANSFORM_ARGV env var (consumed by hull3d._optimize) when a bundled
 * CLI is resolvable — so the packaged app needs no global npx. In dev, the env
 * is unset and the Python step falls back to `npx @gltf-transform/cli`.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { app } from 'electron';
import log from 'electron-log';
import { resolvePythonPaths, type PythonExtractEvent } from './python-bridge.js';

const CGF_CONVERTER_URL =
  'https://github.com/Markemp/Cryengine-Converter/releases/download/v2.0.0/cgf-converter.exe';
const CGF_CONVERTER_MIN_BYTES = 100_000_000; // ~117 MB self-contained .NET binary

export interface SkinExportRequest {
  p4kPath: string;
  outDir: string;
  /** "DRAK_Cutlass_Black" (known) or "id:MFR:Ship:SeriesToken". Optional when
   *  `manifest` drives the build (the normal extract → upload flow). */
  ships?: string[];
  /** Path to the extract's skins/_build_manifest.json — builds every ship the
   *  metadata extract flagged as having a buildable livery. */
  manifest?: string;
  /** Patch-version cache: skip ships already built into `outDir`. */
  skipExisting?: boolean;
  textureSize?: number;
  limitSkins?: number;
}

export interface SkinEntry {
  skin_id: string;
  name: string;
  description: string;
  source: string;
  name_verified: boolean;
  has_model: boolean;
  has_icon: boolean;
  model_bytes: number | null;
}

export interface SkinShipResult {
  ship_id: string;
  export_dir: string;
  skins: SkinEntry[];
  /** True when the build was skipped because the ship was already cached. */
  cached?: boolean;
}

export interface SkinExportFinal {
  ok: boolean;
  ships?: SkinShipResult[];
  error?: string;
}

export interface SkinExportHandle {
  promise: Promise<SkinExportFinal>;
  cancel: () => void;
}

/** Where the downloaded cgf-converter binary lives (per-user, not bundled). */
export function converterPath(): string {
  return resolve(app.getPath('userData'), 'tools', 'cgf-converter-2.exe');
}

/** Download cgf-converter to userData/tools on first use; no-op if present. */
export async function ensureConverter(onProgress: (pct: number) => void): Promise<string> {
  const dest = converterPath();
  if (existsSync(dest) && statSync(dest).size >= CGF_CONVERTER_MIN_BYTES) return dest;
  mkdirSync(resolve(dest, '..'), { recursive: true });

  const res = await fetch(CGF_CONVERTER_URL);
  if (!res.ok || !res.body) throw new Error(`cgf-converter download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  const tmp = `${dest}.part`;
  const out = createWriteStream(tmp);
  const reader = res.body.getReader();
  let got = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.byteLength;
      out.write(Buffer.from(value));
      if (total) onProgress(Math.round((got / total) * 100));
    }
  } finally {
    await new Promise<void>((r, j) => out.end((e?: Error | null) => (e ? j(e) : r())));
  }
  if (statSync(tmp).size < CGF_CONVERTER_MIN_BYTES) {
    throw new Error('cgf-converter download too small — aborted');
  }
  renameSync(tmp, dest);
  return dest;
}

/** Tell Python how to run the optimizer through Electron's bundled Node. */
function optimizerEnv(): Record<string, string> {
  if (process.env['SC_GLTF_TRANSFORM_ARGV']) return {}; // explicit override wins
  try {
    const req = createRequire(import.meta.url);
    // The package "exports" entry is the LIBRARY (dist/cli.esm.js) — importing it
    // does NOT run the CLI. The actual runnable is bin/cli.js (blocked from
    // direct subpath resolution by the exports map), so derive it from the
    // package root. Run it through Electron's own Node (hull3d sets
    // ELECTRON_RUN_AS_NODE) so the packaged app needs no global npx.
    const lib = req.resolve('@gltf-transform/cli'); // .../@gltf-transform/cli/dist/cli.esm.js
    const cli = resolve(dirname(lib), '..', 'bin', 'cli.js');
    if (!existsSync(cli)) return {}; // unknown layout → let Python fall back to npx
    return { SC_GLTF_TRANSFORM_ARGV: JSON.stringify([process.execPath, cli]) };
  } catch {
    return {};
  }
}

export function startSkinExport(
  req: SkinExportRequest,
  onEvent: (ev: PythonExtractEvent) => void,
): SkinExportHandle {
  const { interpreter, cwd, source } = resolvePythonPaths();
  log.info(`[skin-bridge] launching skin_export_app via ${source} interpreter=${interpreter}`);

  const args = [
    '-E', '-s', '-B', '-u',
    '-X', 'utf8', // force UTF-8 stdio — `-E` strips PYTHONUTF8/PYTHONIOENCODING, so without this
    //              the child's piped stdout is cp1252 on Windows and non-ASCII event lines crash
    //              / mangle (see python-bridge.ts + events.py for the full rationale).
    '-m', 'sc_extract.skin_export_app',
    '--p4k', req.p4kPath,
    '--out', req.outDir,
    '--converter', converterPath(),
    '--texture-size', String(req.textureSize ?? 1024),
  ];
  if (req.manifest) args.push('--manifest', req.manifest);
  for (const s of req.ships ?? []) args.push('--ship', s);
  if (req.skipExisting) args.push('--skip-existing');
  if (req.limitSkins) args.push('--limit-skins', String(req.limitSkins));

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(interpreter, args, {
      cwd,
      // PYTHONUNBUFFERED dropped — inert under `-E`. SC_GLTF_TRANSFORM_ARGV (not a
      // PYTHON* var) is still honored. Real-time output relies on `-u` + flush.
      env: { ...process.env, ...optimizerEnv() },
      windowsHide: true,
    });
  } catch (err) {
    return {
      promise: Promise.resolve({ ok: false, error: `spawn failed: ${(err as Error).message}` }),
      cancel: () => {},
    };
  }

  let ships: SkinShipResult[] | undefined;
  let lastError: string | undefined;
  let cancelled = false;

  const rl = createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let ev: PythonExtractEvent | null = null;
    try {
      ev = JSON.parse(trimmed) as PythonExtractEvent;
    } catch {
      log.warn('[skin-bridge] non-JSON stdout:', trimmed.slice(0, 200));
      return;
    }
    if (!ev || typeof ev.type !== 'string') return;
    if (ev.type === 'done') {
      const r = (ev as { result?: { ships?: SkinShipResult[] } }).result;
      if (r?.ships) ships = r.ships;
    }
    if (ev.type === 'error' && ev.message) lastError = ev.message;
    onEvent(ev);
  });

  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf-8').trim();
    if (!text) return;
    for (const line of text.split('\n')) {
      onEvent({ type: 'log', level: 'warn', message: `[py.stderr] ${line}` });
    }
  });

  const promise = new Promise<SkinExportFinal>((resolveP) => {
    child.on('error', (err) => resolveP({ ok: false, error: err.message }));
    child.on('exit', (code, signal) => {
      if (cancelled) return resolveP({ ok: false, error: 'cancelled' });
      if (code === 0 && ships) return resolveP({ ok: true, ships });
      return resolveP({
        ok: false,
        error:
          lastError ?? (signal ? `killed by signal ${signal}` : `python exited with code ${code}`),
      });
    });
  });

  return {
    promise,
    cancel: () => {
      cancelled = true;
      killProcessTree(child);
    },
  };
}

/** Kill the interpreter AND grandchildren (cgf-converter / node). */
function killProcessTree(child: ChildProcessWithoutNullStreams): void {
  if (child.killed || child.pid == null) return;
  if (process.platform === 'win32') {
    try {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        windowsHide: true,
        detached: true,
        stdio: 'ignore',
      });
      killer.unref();
    } catch {
      child.kill();
    }
  } else {
    child.kill('SIGTERM');
  }
}
