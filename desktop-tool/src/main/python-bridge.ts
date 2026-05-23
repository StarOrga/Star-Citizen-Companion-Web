/**
 * Python-Bridge — spawns `sc_extract.extract` as a subprocess and streams
 * its JSON-line stdout into structured events for the renderer.
 *
 * Locating the interpreter (in order):
 *   1. SC_EXTRACT_PYTHON env var       — overrides everything (test/CI)
 *   2. Packaged: process.resourcesPath/python/python.exe   (electron-builder extraResources)
 *   3. Dev: `python` (or `python3`) on PATH               (developer setup)
 *
 * Locating the sidecar source (sc_extract package):
 *   - Packaged: process.resourcesPath/python              (next to the interpreter)
 *   - Dev: <repo>/desktop-tool/python                    (editable, not installed)
 *
 * The subprocess emits JSON-lines (one object per line) on stdout per the
 * contract in desktop-tool/python/sc_extract/events.py.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';
import log from 'electron-log';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ExtractRequest {
  p4kPath: string;
  outDir: string;
  channel: 'LIVE' | 'PTU' | 'EPTU' | 'TECH-PREVIEW';
  patchVersion: string;
  buildNumber: string;
  scope: {
    hdIcons: boolean;
    renderPngs: boolean;
    componentTree: boolean;
  };
  toolVersion: string;
}

/** Event shape emitted by the Python subprocess (see sc_extract/events.py).
 *  Kept in lockstep with the existing ExtractorEvent in lib/extractor.ts so
 *  the renderer doesn't need a second adapter. */
export interface PythonExtractEvent {
  type: 'phase' | 'file' | 'count' | 'log' | 'warning' | 'done' | 'error';
  phase?: 'discover' | 'plan' | 'extract' | 'validate' | 'bundle';
  pct?: number;
  fileName?: string;
  bytesProcessed?: number;
  bytesTotal?: number;
  counter?: { key: string; value: number };
  level?: 'info' | 'warn' | 'error';
  message?: string;
  // 'done' event includes a result payload
  result?: {
    channel: string;
    patch_version: string;
    build_number: string;
    schema_version: number;
    quality_score: number;
    entity_counts: Record<string, number>;
    manifest_path: string;
    output_dir: string;
    tool_version: string;
  };
  // 'error' event includes error_type
  error_type?: string;
}

export interface ExtractFinal {
  ok: boolean;
  result?: NonNullable<PythonExtractEvent['result']>;
  error?: string;
}

interface PythonPaths {
  interpreter: string;
  cwd: string;
  source: 'env' | 'packaged' | 'dev-path';
}

export function resolvePythonPaths(): PythonPaths {
  const override = process.env['SC_EXTRACT_PYTHON'];
  if (override && existsSync(override)) {
    return { interpreter: override, cwd: resolve(override, '..'), source: 'env' };
  }

  if (app.isPackaged) {
    const resourcesRoot = resolve(process.resourcesPath, 'python');
    const exe = resolve(resourcesRoot, process.platform === 'win32' ? 'python.exe' : 'bin/python3');
    if (existsSync(exe)) {
      return { interpreter: exe, cwd: resourcesRoot, source: 'packaged' };
    }
    log.warn('[python-bridge] packaged python not found at', exe, '— falling back to PATH');
  }

  // Dev: source lives at <repo>/desktop-tool/python relative to out/main/.
  const devSource = resolve(__dirname, '../../python');
  const candidate = process.platform === 'win32' ? 'python' : 'python3';
  return { interpreter: candidate, cwd: devSource, source: 'dev-path' };
}

export interface ExtractHandle {
  promise: Promise<ExtractFinal>;
  cancel: () => void;
}

export function startExtraction(
  req: ExtractRequest,
  onEvent: (ev: PythonExtractEvent) => void,
): ExtractHandle {
  const { interpreter, cwd, source } = resolvePythonPaths();
  log.info(`[python-bridge] launching sc_extract via ${source} interpreter=${interpreter} cwd=${cwd}`);

  const args = [
    '-u', // unbuffered stdio — events must arrive in real time
    '-m', 'sc_extract.extract',
    '--p4k', req.p4kPath,
    '--out', req.outDir,
    '--channel', req.channel,
    '--patch', req.patchVersion,
    '--build', req.buildNumber,
    '--scope', scopeToString(req.scope),
    '--tool-version', req.toolVersion,
  ];

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(interpreter, args, {
      cwd,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      windowsHide: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      promise: Promise.resolve({ ok: false, error: `spawn failed: ${message}` }),
      cancel: () => {},
    };
  }

  let finalResult: NonNullable<PythonExtractEvent['result']> | undefined;
  let lastError: string | undefined;
  let cancelled = false;

  const rl = createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let ev: PythonExtractEvent | null = null;
    try {
      ev = JSON.parse(trimmed) as PythonExtractEvent;
    } catch (err) {
      log.warn('[python-bridge] non-JSON line on stdout:', trimmed.slice(0, 200));
      return;
    }
    if (!ev || typeof ev.type !== 'string') return;
    if (ev.type === 'done' && ev.result) finalResult = ev.result;
    if (ev.type === 'error' && ev.message) lastError = ev.message;
    onEvent(ev);
  });

  child.stderr.on('data', (chunk: Buffer) => {
    // scdatatools / pip can be chatty on stderr — surface as info-level logs
    // so the user sees them in the renderer without flagging them as errors.
    const text = chunk.toString('utf-8').trim();
    if (!text) return;
    for (const line of text.split('\n')) {
      onEvent({ type: 'log', level: 'warn', message: `[py.stderr] ${line}` });
    }
  });

  const promise = new Promise<ExtractFinal>((resolveP) => {
    child.on('error', (err) => {
      lastError = err.message;
      resolveP({ ok: false, error: err.message });
    });
    child.on('exit', (code, signal) => {
      if (cancelled) {
        resolveP({ ok: false, error: 'cancelled' });
        return;
      }
      if (code === 0 && finalResult) {
        resolveP({ ok: true, result: finalResult });
        return;
      }
      const msg =
        lastError ?? (signal ? `killed by signal ${signal}` : `python exited with code ${code}`);
      resolveP({ ok: false, error: msg });
    });
  });

  return {
    promise,
    cancel: () => {
      cancelled = true;
      if (!child.killed) child.kill();
    },
  };
}

function scopeToString(scope: ExtractRequest['scope']): string {
  const parts: string[] = [];
  if (scope.hdIcons) parts.push('hd_icons');
  if (scope.renderPngs) parts.push('render_pngs');
  if (scope.componentTree) parts.push('component_tree');
  return parts.join(',') || 'none';
}
