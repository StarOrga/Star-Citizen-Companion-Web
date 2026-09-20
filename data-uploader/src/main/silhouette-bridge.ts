/**
 * Silhouette-build bridge — spawns `sc_extract.silhouette_build_app` and
 * streams its JSON-line events (events.py contract, same shape
 * `skin-bridge.ts` already consumes) to the renderer.
 *
 * Reuses the SAME cgf-converter binary the 3D-skin build downloads
 * (`skin-bridge.ts` `converterPath()`/`ensureConverter()` — the renderer's
 * silhouette step calls `window.sc.skin.ensureTools()` before this, so by the
 * time this spawns the binary is already on disk; there is no second
 * download). The silhouette build needs no `gltf-transform` optimizer step
 * (a silhouette reads geometry only, never textures), so unlike
 * `skin-bridge.ts` this spawn carries no `SC_GLTF_TRANSFORM_ARGV`.
 *
 * The pure argv-building/request-shaping this module wraps around
 * `resolvePythonPaths` + `spawn` lives in `../lib/silhouette-bridge-args.ts`,
 * kept free of `electron`/`node:child_process` imports so it is unit-testable
 * without a running Electron process — see that module's tests.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { app } from 'electron';
import log from 'electron-log';
import { resolvePythonPaths, type PythonExtractEvent } from './python-bridge.js';
import { packagedPythonMissing, pythonSpawnEnoentMessage } from '../lib/python-locate.js';
import { silhouetteBuildArgs, type SilhouetteBuildRequest } from '../lib/silhouette-bridge-args.js';

export type { SilhouetteBuildRequest };

export interface SilhouetteBuildResult {
  written: number;
  skipped: number;
  cached: number;
}

export interface SilhouetteBuildFinal {
  ok: boolean;
  result?: SilhouetteBuildResult;
  error?: string;
}

export interface SilhouetteBuildHandle {
  promise: Promise<SilhouetteBuildFinal>;
  cancel: () => void;
  /** Sidecar pid, so the live performance switch can re-prioritise it mid-run. */
  pid: number | null;
}

export function startSilhouetteBuild(
  req: SilhouetteBuildRequest,
  onEvent: (ev: PythonExtractEvent) => void,
): SilhouetteBuildHandle {
  const { interpreter, cwd, source } = resolvePythonPaths();
  log.info(`[silhouette-bridge] launching silhouette_build_app via ${source} interpreter=${interpreter}`);

  const missing = packagedPythonMissing(source, app.isPackaged);
  if (missing) {
    log.error('[silhouette-bridge]', missing);
    return { promise: Promise.resolve({ ok: false, error: missing }), cancel: () => {}, pid: null };
  }

  const args = silhouetteBuildArgs(req);

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(interpreter, args, { cwd, env: process.env, windowsHide: true });
  } catch (err) {
    return {
      promise: Promise.resolve({ ok: false, error: `spawn failed: ${(err as Error).message}` }),
      cancel: () => {},
      pid: null,
    };
  }

  let result: SilhouetteBuildResult | undefined;
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
      log.warn('[silhouette-bridge] non-JSON stdout:', trimmed.slice(0, 200));
      return;
    }
    if (!ev || typeof ev.type !== 'string') return;
    if (ev.type === 'done') {
      const r = (ev as { result?: SilhouetteBuildResult }).result;
      if (r) result = r;
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

  const promise = new Promise<SilhouetteBuildFinal>((resolveP) => {
    child.on('error', (err) =>
      resolveP({
        ok: false,
        error:
          (err as NodeJS.ErrnoException).code === 'ENOENT'
            ? pythonSpawnEnoentMessage(interpreter, app.isPackaged)
            : err.message,
      }),
    );
    child.on('exit', (code, signal) => {
      if (cancelled) return resolveP({ ok: false, error: 'cancelled' });
      if (code === 0 && result) return resolveP({ ok: true, result });
      return resolveP({
        ok: false,
        error:
          lastError ?? (signal ? `killed by signal ${signal}` : `python exited with code ${code}`),
      });
    });
  });

  return {
    promise,
    pid: child.pid ?? null,
    cancel: () => {
      cancelled = true;
      killProcessTree(child);
    },
  };
}

/** Kill the interpreter AND grandchildren (cgf-converter). Same shape as
 * `skin-bridge.ts`'s helper of the same name — not shared cross-module since
 * neither carries any Electron/spawn-independent logic worth extracting. */
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
