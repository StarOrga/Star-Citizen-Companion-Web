#!/usr/bin/env node
/**
 * Idle-I/O gate for the packaged uploader (Windows only).
 *
 * Launches the app the way the autostart login item does (`--hidden`), lets it
 * settle, then samples `Win32_Process` I/O counters of every uploader process
 * plus the size of `logs/main.log`, and exits 1 when the idle budget is blown:
 *
 *   - < 50 write operations per 30 s, summed over all uploader processes
 *   - < 10 KB/s written bytes, summed over all uploader processes
 *   - main.log grows by 0 bytes over the measurement window
 *
 * Note the counters include pipe/IPC traffic, not only disk: the 0.35.1 idle
 * "disk writes" were renderer↔GPU frame traffic of a never-shown window (see
 * src/lib/window-visibility.ts). The budget deliberately measures the same
 * counters the field report used.
 *
 * Usage (from data-uploader/):
 *   node scripts/idle-io-probe.js                       # installed app, 5 min warm-up, 5 min window
 *   node scripts/idle-io-probe.js --exe <path.exe>      # a specific build (e.g. dist/win-unpacked)
 *   node scripts/idle-io-probe.js --attach              # measure the instance that is already running
 *   node scripts/idle-io-probe.js --warmup 60 --window 60
 *   node scripts/idle-io-probe.js --exe node_modules/electron/dist/electron.exe --app .   # unpackaged out/ build
 *
 * Without --attach, any running uploader is stopped first (single-instance lock)
 * and the launched one is stopped again afterwards.
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const IDLE_BUDGET = Object.freeze({
  /** Write operations per 30 s, summed over all uploader processes. */
  maxWritesPer30s: 50,
  /** Written bytes per second, summed over all uploader processes. */
  maxBytesPerSec: 10 * 1024,
  /** Growth of logs/main.log over the window. */
  maxLogGrowthBytes: 0,
});

/**
 * Compare two counter snapshots (`{ [pid]: { writes, writeBytes } }`) against
 * the budget. Processes that appear or vanish between snapshots count from 0 /
 * are ignored respectively — a process that exits takes its counters with it.
 */
export function evaluateIdleBudget({ before, after, seconds, logGrowthBytes }, budget = IDLE_BUDGET) {
  if (!(seconds > 0)) throw new Error('seconds must be > 0');
  let writes = 0;
  let writeBytes = 0;
  for (const [pid, b] of Object.entries(after)) {
    const a = before[pid] ?? { writes: 0, writeBytes: 0 };
    writes += Math.max(0, b.writes - a.writes);
    writeBytes += Math.max(0, b.writeBytes - a.writeBytes);
  }
  const writesPer30s = (writes * 30) / seconds;
  const bytesPerSec = writeBytes / seconds;
  const breaches = [];
  if (writesPer30s >= budget.maxWritesPer30s) {
    breaches.push(`writes ${writesPer30s.toFixed(1)}/30s ≥ ${budget.maxWritesPer30s}`);
  }
  if (bytesPerSec >= budget.maxBytesPerSec) {
    breaches.push(`written ${(bytesPerSec / 1024).toFixed(2)} KB/s ≥ ${budget.maxBytesPerSec / 1024} KB/s`);
  }
  if (logGrowthBytes > budget.maxLogGrowthBytes) {
    breaches.push(`main.log grew ${logGrowthBytes} B > ${budget.maxLogGrowthBytes} B`);
  }
  return { ok: breaches.length === 0, writes, writeBytes, writesPer30s, bytesPerSec, logGrowthBytes, breaches };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const DEFAULT_EXE =
  'C:\\Program Files\\Star Citizen Companion - Data Uploader\\Star Citizen Companion - Data Uploader.exe';

function parseArgs(argv) {
  const opts = { exe: DEFAULT_EXE, app: null, attach: false, warmup: 300, window: 300 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--attach') opts.attach = true;
    else if (a === '--exe') opts.exe = resolve(argv[++i]);
    else if (a === '--app') opts.app = resolve(argv[++i]);
    else if (a === '--warmup') opts.warmup = Number(argv[++i]);
    else if (a === '--window') opts.window = Number(argv[++i]);
    else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

function powershell(command) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8',
  });
}

/** WQL filter matching every process of the given executable (main + helpers). */
function processFilter(exe) {
  return `Name='${basename(exe).replace(/'/g, "''")}'`;
}

/** `{ [pid]: { writes, writeBytes, type } }` for every running uploader process. */
function snapshot(filter) {
  const out = powershell(
    `Get-CimInstance Win32_Process -Filter "${filter}" | ` +
      `Select-Object ProcessId,WriteOperationCount,WriteTransferCount,CommandLine | ConvertTo-Json -Compress`,
  ).trim();
  if (!out) return {};
  const rows = [].concat(JSON.parse(out));
  const snap = {};
  for (const r of rows) {
    const type = /--type=([\w-]+)/.exec(r.CommandLine ?? '')?.[1] ?? 'main';
    snap[String(r.ProcessId)] = {
      writes: Number(r.WriteOperationCount),
      writeBytes: Number(r.WriteTransferCount),
      type,
    };
  }
  return snap;
}

function stopUploader(filter) {
  powershell(`Get-CimInstance Win32_Process -Filter "${filter}" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`);
}

function mainLogPath() {
  // productName-independent: electron uses the package name for userData.
  return join(process.env.APPDATA ?? '', '@sc-companion', 'data-uploader', 'logs', 'main.log');
}

function logSize(path) {
  return existsSync(path) ? statSync(path).size : 0;
}

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

async function main() {
  if (process.platform !== 'win32') {
    console.error('[idle-io-probe] Windows only (Win32_Process counters).');
    process.exitCode = 2;
    return;
  }
  const opts = parseArgs(process.argv.slice(2));
  const filter = processFilter(opts.exe);
  let launched = false;
  if (!opts.attach) {
    if (!existsSync(opts.exe)) throw new Error(`exe not found: ${opts.exe}`);
    // The installed app and the unpackaged build share userData and the
    // single-instance lock — stop both before launching.
    stopUploader(processFilter(DEFAULT_EXE));
    stopUploader(filter);
    await sleep(3);
    const args = opts.app ? [opts.app, '--hidden'] : ['--hidden'];
    spawn(opts.exe, args, { detached: true, stdio: 'ignore', cwd: opts.app ?? undefined }).unref();
    launched = true;
    console.log(`[idle-io-probe] launched ${opts.exe} --hidden; warming up ${opts.warmup}s`);
    await sleep(opts.warmup);
  }
  if (Object.keys(snapshot(filter)).length === 0) throw new Error('no uploader process running');

  const logPath = mainLogPath();
  const log0 = logSize(logPath);
  const before = snapshot(filter);
  console.log(`[idle-io-probe] measuring ${opts.window}s over ${Object.keys(before).length} processes`);
  await sleep(opts.window);
  const after = snapshot(filter);
  const result = evaluateIdleBudget({ before, after, seconds: opts.window, logGrowthBytes: logSize(logPath) - log0 });

  for (const [pid, b] of Object.entries(after)) {
    const a = before[pid] ?? { writes: 0, writeBytes: 0 };
    console.log(`  ${pid} ${b.type.padEnd(12)} ${b.writes - a.writes} writes, ${((b.writeBytes - a.writeBytes) / 1024).toFixed(1)} KB`);
  }
  console.log(
    `[idle-io-probe] total: ${result.writesPer30s.toFixed(1)} writes/30s, ` +
      `${(result.bytesPerSec / 1024).toFixed(2)} KB/s, main.log +${result.logGrowthBytes} B`,
  );
  if (launched) stopUploader(filter);
  if (result.ok) {
    console.log('[idle-io-probe] PASS');
  } else {
    console.error(`[idle-io-probe] FAIL — ${result.breaches.join('; ')}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`[idle-io-probe] ${err?.message ?? err}`);
    process.exitCode = 2;
  });
}
