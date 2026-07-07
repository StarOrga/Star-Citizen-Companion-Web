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
 *   - Dev: <repo>/data-uploader/python                   (editable, not installed)
 *
 * The subprocess emits JSON-lines (one object per line) on stdout per the
 * contract in data-uploader/python/sc_extract/events.py.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';
import log from 'electron-log';
import { packagedPythonMissing, pythonSpawnEnoentMessage } from '../lib/python-locate.js';

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
  type: 'phase' | 'progress' | 'file' | 'count' | 'log' | 'warning' | 'done' | 'error';
  phase?: 'discover' | 'plan' | 'extract' | 'validate' | 'bundle';
  pct?: number;
  // 'progress' event — live position within a phase ("how many of how many").
  // `total` is absent for unquantifiable phases (open P4K / decompress); the
  // renderer then shows a running count + indeterminate bar.
  stage?: string;
  current?: number;
  total?: number;
  detail?: string;
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

  // Dev: source lives at <repo>/data-uploader/python relative to out/main/.
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

  // A packaged build that fell back to the bare-`python` dev path means the
  // embedded interpreter is missing — fail fast with an actionable message
  // instead of a cryptic `spawn python ENOENT`.
  const missing = packagedPythonMissing(source, app.isPackaged);
  if (missing) {
    log.error('[python-bridge]', missing);
    return { promise: Promise.resolve({ ok: false, error: missing }), cancel: () => {} };
  }

  const args = [
    '-E', // ignore PYTHON* env vars — no env-driven sys.path manipulation at startup
    '-s', // skip the user site-packages dir — fewer path stats (embedded Lib/site-packages still loads)
    '-B', // don't write .pyc — avoids disk writes into the (possibly TEMP-extracted) tree
    '-u', // unbuffered stdio — events must arrive in real time
    '-X', 'utf8', // FORCE UTF-8 stdio. `-E` strips PYTHONUTF8/PYTHONIOENCODING, so without
    //              this the child's piped stdout is the legacy code page (cp1252 on German
    //              Windows) and any non-ASCII event line (ship/loc names, "→", paths) raises
    //              UnicodeEncodeError → run dies / 'done' line dropped. `-X` is a CLI flag, NOT
    //              suppressed by `-E`. Belt-and-suspenders with events.py's stdout.reconfigure.
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
      // No PYTHONUNBUFFERED here: it's inert under `-E` (all PYTHON* env vars are
      // ignored). Real-time output relies on `-u` + the explicit flush in events.py.
      env: process.env,
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
  let parseFailures = 0;
  const stderrTail: string[] = []; // last few stderr lines, surfaced if the run dies opaquely

  const rl = createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let ev: PythonExtractEvent | null = null;
    try {
      ev = JSON.parse(trimmed) as PythonExtractEvent;
    } catch (err) {
      // A corrupted / non-UTF-8 stdout line (e.g. a pre-fix cp1252 mangle) must
      // not vanish silently — a dropped 'done' line would otherwise look like a
      // clean exit with no result. Count it and leave a visible renderer trace.
      parseFailures += 1;
      log.warn('[python-bridge] non-JSON line on stdout:', trimmed.slice(0, 200));
      onEvent({ type: 'log', level: 'warn', message: `[py.stdout!] non-JSON line dropped: ${trimmed.slice(0, 160)}` });
      return;
    }
    if (!ev || typeof ev.type !== 'string') return;
    if (ev.type === 'done' && ev.result) finalResult = ev.result;
    if (ev.type === 'error' && ev.message) lastError = ev.message;
    onEvent(ev);
  });

  child.stderr.on('data', (chunk: Buffer) => {
    // scdatatools / pip are chatty on stderr, but a real Traceback / import /
    // encoding error must NOT masquerade as a benign warning. Classify the
    // load-bearing failure signatures as 'error' and keep a tail the exit
    // handler can surface when the run dies without a structured error event.
    const text = chunk.toString('utf-8').trim();
    if (!text) return;
    const FATAL = /Traceback|Error:|Exception|ModuleNotFoundError|ImportError|UnicodeEncodeError|SyntaxError/;
    for (const line of text.split('\n')) {
      const level: NonNullable<PythonExtractEvent['level']> = FATAL.test(line) ? 'error' : 'info';
      stderrTail.push(line);
      if (stderrTail.length > 12) stderrTail.shift();
      onEvent({ type: 'log', level, message: `[py.stderr] ${line}` });
    }
  });

  const promise = new Promise<ExtractFinal>((resolveP) => {
    child.on('error', (err) => {
      const msg =
        (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? pythonSpawnEnoentMessage(interpreter, app.isPackaged)
          : err.message;
      lastError = msg;
      resolveP({ ok: false, error: msg });
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
      const tail = stderrTail.length ? ` — stderr: ${stderrTail.join(' / ')}` : '';
      let msg: string;
      if (lastError) {
        msg = lastError;
      } else if (signal) {
        msg = `killed by signal ${signal}`;
      } else if (code === 0 && !finalResult) {
        // Exited cleanly but never emitted a parseable 'done'. Almost always a
        // stdout encoding / JSON-parse drop (see parseFailures), NOT a real
        // success — say so instead of the self-contradictory "exited with code 0".
        msg = `python exited 0 but emitted no 'done' event${
          parseFailures ? ` (${parseFailures} stdout line(s) failed to parse — likely an encoding/JSON drop)` : ''
        }${tail}`;
      } else {
        msg = `python exited with code ${code}${tail}`;
      }
      resolveP({ ok: false, error: msg });
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

/** Kill the interpreter AND any grandchildren it spawned. On Windows
 *  child.kill() (SIGTERM → TerminateProcess) only ends python.exe itself, so a
 *  hung/long extraction can leave processes behind in Task Manager when the app
 *  closes. `taskkill /T` tears down the whole tree; we detach + unref the killer
 *  so it still completes even when the app is mid-quit. */
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

function scopeToString(scope: ExtractRequest['scope']): string {
  const parts: string[] = [];
  if (scope.hdIcons) parts.push('hd_icons');
  if (scope.renderPngs) parts.push('render_pngs');
  if (scope.componentTree) parts.push('component_tree');
  return parts.join(',') || 'none';
}
