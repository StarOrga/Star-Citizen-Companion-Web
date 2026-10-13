/**
 * Main-process owner of the operator's resource limits (replaces the speed
 * profiles of `throttle.ts`).
 *
 * Main owns them for the same reason it owned the profile: the sidecars they
 * have to reach are spawned here, survive a renderer reload, and only main
 * knows their pids.
 *
 * Three effects hang off the limits:
 *  1. every running sidecar has a governor process next to it
 *     (`python/sc_extract/governor.py`) that receives each change as a JSON
 *     line on stdin and enforces it on the whole process tree at once — hard
 *     CPU cap, disk budgets, background priorities;
 *  2. the worker count of the NEXT stage is sized from them ({@link workers});
 *  3. the upload loops pace themselves at their work-unit boundaries.
 *
 * It also measures: the whole PC's CPU and disk load the way Task Manager
 * shows it (`python/sc_extract/sysmon.py`, Windows performance counters),
 * machine-wide RAM, this app's own memory, and the run's share from the
 * governors' samples — the panel draws all of it. The
 * sampler only ticks while a job runs or a visible window watches, so the idle
 * tray budget (README "Idle behaviour") stays at zero periodic work.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { cpus, freemem, totalmem } from 'node:os';
import { createInterface } from 'node:readline';
import { app, BrowserWindow } from 'electron';
import log from 'electron-log';
import { resolvePythonPaths } from './python-bridge.js';
import {
  DEFAULT_PRESET,
  DISK_CAPS,
  PRESET_IDS,
  clampLimits,
  diskKindFrom,
  dumpWorkers,
  governorLimits,
  matchPreset,
  pacingMs,
  presetFromLegacyProfile,
  presetLimits,
  rangesFor,
  silhouetteWorkers,
  skinWorkers,
  type MachineInfo,
  type PresetId,
  type Range,
  type ResourceKey,
  type ResourceLimits,
  type ResourceSample,
} from '../lib/resource-limits.js';
import {
  driveLetter,
  driveLoads,
  driveSlots,
  parseSysDrives,
  pickPrimaryGpu,
  type DriveSlot,
  type GpuInfo,
  type SysDrive,
} from '../lib/drive-load.js';
import { setSidecarGpu } from './sidecar-env.js';

/** What settings persist: the values, and the preset they came from (null = custom). */
export interface StoredLimits extends Partial<ResourceLimits> {
  preset?: PresetId | null;
}

/**
 * What the performance dock reads. Beyond the limits: `machine.cores` is the
 * logical processor count (the "12 Threads" label), `machine.totalRamMb` and
 * `sample.ramUsedMb` the RAM box, `drives` / `sample.drives` the per-drive
 * boxes and `gpu` the GPU box — field contract in `lib/drive-load.ts`. All
 * sample values are raw 1 s readings; averaging is the renderer's job.
 */
export interface ResourceView {
  /** Layout of the drive boxes: game + work, or one 'both'. */
  drives: DriveSlot[];
  gpu: GpuInfo;
  machine: MachineInfo;
  limits: ResourceLimits;
  ranges: Record<ResourceKey, Range>;
  /** The preset the limits equal, or null for a custom mix. */
  preset: PresetId | null;
  /** False where no governor can run (non-Windows) — the UI says so. */
  supported: boolean;
  /** Sidecars currently governed. */
  liveJobs: number;
  sample: ResourceSample | null;
}

function totalCores(): number {
  const n = cpus().length;
  return n > 0 ? n : 4;
}

const machine: MachineInfo = {
  cores: totalCores(),
  totalRamMb: Math.round(totalmem() / (1024 * 1024)),
  disk: DISK_CAPS.unknown,
};
let limits: ResourceLimits = presetLimits(DEFAULT_PRESET, machine);
let preset: PresetId | null = DEFAULT_PRESET;
let persist: (stored: StoredLimits) => void = () => {};

const SUPPORTED = process.platform === 'win32';

// ── Drives + GPU state ──────────────────────────────────────────────────────

/** Drive of the selected install — the run reads the Data.p4k there. */
let gameLetter: string | null = null;
/**
 * Drive the run writes to. The extraction output and every cache live under
 * `<install>/.sc-companion-extracts/` (renderer `main.ts`, `cleanup.ts`), so
 * by default this is the game drive; `detectDisk(path, workPath)` takes an
 * explicit work path for when the output moves elsewhere.
 */
let workLetter: string | null = null;
/** Last per-disk report of the whole-PC monitor (null = none yet / not Windows). */
let sysDrives: SysDrive[] | null = null;

let useGpu = false;
let persistUseGpu: (on: boolean) => void = () => {};
/** undefined = not detected yet; null = detected, none found. */
let gpuName: string | null | undefined = SUPPORTED ? undefined : null;
let gpuDetecting = false;
/**
 * Capability override from a sidecar probe ({@link setGpuAvailable}); null =
 * no probe yet, then a detected GPU counts as available.
 */
let gpuProbe: boolean | null = null;

function gpuAvailable(): boolean {
  if (gpuProbe !== null) return gpuProbe;
  // Not detected yet: do not hold the switch back — a sidecar whose GPU init
  // fails falls back to CPU on its own (contract in lib/drive-load.ts).
  if (gpuName === undefined) return true;
  return gpuName !== null;
}

function syncSidecarGpu(): void {
  setSidecarGpu(useGpu && gpuAvailable());
}

function kindOf(letter: string): MachineInfo['disk']['kind'] {
  return diskCache.get(letter)?.kind ?? 'unknown';
}

export function init(opts: {
  stored: StoredLimits | null | undefined;
  legacyProfile: unknown;
  persist: (s: StoredLimits) => void;
  useGpu?: boolean;
  persistUseGpu?: (on: boolean) => void;
}): void {
  persist = opts.persist;
  useGpu = opts.useGpu === true;
  if (opts.persistUseGpu) persistUseGpu = opts.persistUseGpu;
  syncSidecarGpu();
  const stored = opts.stored;
  if (stored && typeof stored === 'object') {
    preset = stored.preset && PRESET_IDS.includes(stored.preset) ? stored.preset : null;
    limits = preset ? presetLimits(preset, machine) : clampLimits(stored, machine);
  } else {
    // First launch after the profiles: the old pick maps onto the preset that means the same.
    preset = presetFromLegacyProfile(opts.legacyProfile);
    limits = presetLimits(preset, machine);
  }
}

export function view(): ResourceView {
  detectGpu();
  return {
    drives: driveSlots(gameLetter, workLetter, kindOf, sysDrives),
    gpu: { name: gpuName ?? null, enabled: useGpu, available: gpuAvailable() },
    machine,
    limits,
    ranges: rangesFor(machine),
    preset,
    supported: SUPPORTED,
    liveJobs: governors.size,
    sample: lastSample,
  };
}

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

function changed(): ResourceView {
  persist({ ...limits, preset });
  pushToGovernors();
  const v = view();
  broadcast('sc:resources:changed', v);
  return v;
}

/** Set one or more limits (the panel's dials). Values are clamped to this machine. */
export function setLimits(partial: unknown): ResourceView {
  const next = clampLimits({ ...limits, ...(partial && typeof partial === 'object' ? partial : {}) }, machine, limits);
  limits = next;
  preset = matchPreset(limits, machine);
  return changed();
}

export function applyPreset(id: unknown): ResourceView {
  if (typeof id !== 'string' || !PRESET_IDS.includes(id as PresetId)) return view();
  preset = id as PresetId;
  limits = presetLimits(preset, machine);
  return changed();
}

/** Worker counts for a stage starting NOW, from the limits in effect now. */
export function workers(): { dump: number; skin: number; silhouette: number; memCapMb: number } {
  return {
    dump: dumpWorkers(limits, machine.cores),
    skin: skinWorkers(limits, machine.cores),
    silhouette: silhouetteWorkers(limits, machine.cores),
    memCapMb: limits.ramMb,
  };
}

/** The upload stages' pacing hook — re-reads the limits on every call. */
export function pacer(): { pace(): Promise<void> } {
  return {
    pace: async () => {
      const ms = pacingMs(limits);
      if (ms > 0) await new Promise((r) => setTimeout(r, ms));
    },
  };
}

// ── Drive detection ─────────────────────────────────────────────────────────

const diskCache = new Map<string, MachineInfo['disk']>();

/** Run one PowerShell command, resolve its trimmed stdout ('' on any failure). */
function powershell(script: string, timeoutMs: number): Promise<string> {
  return new Promise<string>((resolve) => {
    let text = '';
    try {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true,
      });
      child.stdout.on('data', (d: Buffer) => (text += d.toString('utf-8')));
      child.on('error', () => resolve(''));
      // 'close', not 'exit': 'exit' can fire before stdout is drained, which
      // read as "" and left every drive "unknown".
      child.on('close', () => resolve(text.trim()));
      setTimeout(() => {
        child.kill();
        resolve(text.trim());
      }, timeoutMs).unref();
    } catch {
      resolve('');
    }
  });
}

/**
 * Find out what kind of drive `letter` is, so the disk scales fit it (an
 * HDD tops out around 150 MB/s and a few hundred operations; an NVMe drive at
 * thousands). One PowerShell query per drive letter, cached for the session.
 */
async function probeDisk(letter: string): Promise<MachineInfo['disk']> {
  const cached = diskCache.get(letter);
  if (cached) return cached;
  const script =
    `$ErrorActionPreference='Stop';` +
    `$n=(Get-Partition -DriveLetter ${letter}).DiskNumber;` +
    `$p=Get-PhysicalDisk | Where-Object { $_.DeviceId -eq "$n" } | Select-Object -First 1;` +
    `Write-Output "$($p.MediaType)|$($p.BusType)"`;
  const started = Date.now();
  // The Storage WMI provider loads cold on the first query; right after app
  // start on a busy PC that took longer than 15 s and the drive stayed
  // "unknown" for the whole session.
  const out = await powershell(script, 60_000);
  const [media, bus] = out.split('|');
  const caps = DISK_CAPS[diskKindFrom(media, bus)];
  // A failed query is not cached — the next selection of that drive asks again.
  if (out) diskCache.set(letter, caps);
  log.info(`[resources] drive ${letter}: "${out}" → ${caps.kind} (${Date.now() - started} ms)`);
  return caps;
}

/**
 * The selected install (`path`, the game drive) and where the run writes
 * (`workPath`, the work drive; default: the install — the output lives in
 * `<install>/.sc-companion-extracts`). Classifies both drives; the disk scales
 * and limits follow the GAME drive, as before.
 */
export async function detectDisk(path: unknown, workPath?: unknown): Promise<ResourceView> {
  const letter = driveLetter(path);
  if (!SUPPORTED || !letter) return view();
  const work = driveLetter(workPath) ?? letter;
  const layoutChanged = letter !== gameLetter || work !== workLetter;
  gameLetter = letter;
  workLetter = work;
  const [caps] = await Promise.all([probeDisk(letter), work !== letter ? probeDisk(work) : null]);
  if (caps.kind === machine.disk.kind) {
    if (layoutChanged) notify();
    return view();
  }
  machine.disk = caps;
  // A preset follows the new scale; a custom mix keeps its values, clamped.
  limits = preset ? presetLimits(preset, machine) : clampLimits(limits, machine, limits);
  return changed();
}

/** Push the view without touching the limits (drive layout, GPU). */
function notify(): void {
  broadcast('sc:resources:changed', view());
}

// ── GPU ─────────────────────────────────────────────────────────────────────

/** Name of the primary GPU, once per session, only when someone looks (idle budget). */
function detectGpu(): void {
  if (gpuName !== undefined || gpuDetecting) return;
  gpuDetecting = true;
  const started = Date.now();
  void powershell('Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }', 30_000).then((out) => {
    gpuDetecting = false;
    gpuName = pickPrimaryGpu(out.split(/\r?\n/));
    log.info(`[resources] gpu: ${JSON.stringify(gpuName)} (${Date.now() - started} ms)`);
    syncSidecarGpu();
    notify();
  });
}

/** The operator's persisted "use GPU" switch. Reaches sidecars started from now on. */
export function setUseGpu(on: unknown): ResourceView {
  useGpu = on === true;
  persistUseGpu(useGpu);
  syncSidecarGpu();
  const v = view();
  broadcast('sc:resources:changed', v);
  return v;
}

/**
 * Hook for a sidecar GPU capability probe: true / false overrides the
 * "a GPU name was detected" default, null drops the override.
 */
export function setGpuAvailable(available: boolean | null): void {
  gpuProbe = available;
  syncSidecarGpu();
  notify();
}

// ── Governors ───────────────────────────────────────────────────────────────

interface Governor {
  child: ChildProcessWithoutNullStreams;
  sample: { cpuPct: number; memMb: number; readBps: number; writeBps: number; iops: number; heldBack: number; hardCap: boolean } | null;
}

/** jobId → governor of a sidecar that is running right now. */
const governors = new Map<string, Governor>();

function limitsLine(): string {
  return `${JSON.stringify(governorLimits(limits))}\n`;
}

function pushToGovernors(): void {
  const line = limitsLine();
  for (const g of governors.values()) {
    try {
      g.child.stdin.write(line);
    } catch {
      /* governor already gone — its job is ending */
    }
  }
}

/**
 * Put a freshly spawned sidecar under a governor. Windows only; elsewhere the
 * worker count is the only lever and the panel says so.
 */
export function registerJob(jobId: string, pid: number | null | undefined): void {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return;
  if (!SUPPORTED) {
    log.info(`[resources] job ${jobId} pid ${pid}: no governor on ${process.platform}`);
    return;
  }
  const { interpreter, cwd } = resolvePythonPaths();
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(
      interpreter,
      ['-E', '-s', '-B', '-u', '-X', 'utf8', '-m', 'sc_extract.governor', '--pid', String(pid), '--cores', String(machine.cores)],
      { cwd, env: process.env, windowsHide: true },
    );
  } catch (err) {
    log.warn('[resources] governor spawn failed:', err instanceof Error ? err.message : String(err));
    return;
  }
  const g: Governor = { child, sample: null };
  governors.set(jobId, g);
  child.on('error', (err) => log.warn(`[resources] governor for ${jobId}:`, err.message));
  child.stderr.on('data', (d: Buffer) => log.warn(`[resources] governor ${jobId} stderr: ${d.toString('utf-8').trim().slice(0, 300)}`));
  createInterface({ input: child.stdout }).on('line', (line) => {
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (ev.type === 'sample') {
      g.sample = {
        cpuPct: Number(ev.cpuPct) || 0,
        memMb: Number(ev.memMb) || 0,
        readBps: Number(ev.readBps) || 0,
        writeBps: Number(ev.writeBps) || 0,
        iops: Number(ev.iops) || 0,
        heldBack: Number(ev.heldBack) || 0,
        hardCap: ev.hardCap === true,
      };
    } else if (ev.type === 'ready') {
      log.info(`[resources] governor for ${jobId} (pid ${pid}) ready, job object: ${String(ev.job)}`);
    } else if (ev.type === 'error') {
      log.warn(`[resources] governor for ${jobId}: ${String(ev.message)}`);
    }
  });
  child.on('exit', () => {
    if (governors.get(jobId) === g) governors.delete(jobId);
  });
  child.stdin.on('error', () => undefined);
  child.stdin.write(limitsLine());
  log.info(`[resources] job ${jobId} pid ${pid} governed: ${JSON.stringify(governorLimits(limits))}`);
  ensureSampler();
}

/** The sidecar ended: closing stdin makes the governor release everything and exit. */
export function unregisterJob(jobId: string): void {
  const g = governors.get(jobId);
  if (!g) return;
  governors.delete(jobId);
  try {
    g.child.stdin.end();
  } catch {
    /* already closed */
  }
  setTimeout(() => {
    if (g.child.exitCode === null) g.child.kill();
  }, 3000).unref();
}

// ── Sampling ────────────────────────────────────────────────────────────────

let lastSample: ResourceSample | null = null;
let sampler: NodeJS.Timeout | null = null;
let watchers = 0;
let prevCpu: { idle: number; total: number } | null = null;

// ── Whole-PC monitor ────────────────────────────────────────────────────────

interface SystemLoad {
  drives: SysDrive[] | null;
  cpuPct: number;
  readBps: number;
  writeBps: number;
  iops: number;
}

let sysmon: ChildProcessWithoutNullStreams | null = null;
let systemLoad: SystemLoad | null = null;

/** Task Manager's numbers for the whole PC; runs exactly as long as the sampler. */
function startSysmon(): void {
  if (sysmon || !SUPPORTED) return;
  const { interpreter, cwd } = resolvePythonPaths();
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(interpreter, ['-E', '-s', '-B', '-u', '-X', 'utf8', '-m', 'sc_extract.sysmon'], {
      cwd,
      env: process.env,
      windowsHide: true,
    });
  } catch (err) {
    log.warn('[resources] sysmon spawn failed:', err instanceof Error ? err.message : String(err));
    return;
  }
  sysmon = child;
  child.on('error', (err) => log.warn('[resources] sysmon:', err.message));
  child.stderr.on('data', (d: Buffer) => log.warn(`[resources] sysmon stderr: ${d.toString('utf-8').trim().slice(0, 300)}`));
  child.stdin.on('error', () => undefined);
  createInterface({ input: child.stdout }).on('line', (line) => {
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (ev.type === 'sample') {
      sysDrives = parseSysDrives(ev.drives);
      systemLoad = {
        drives: sysDrives,
        cpuPct: Number(ev.cpuPct) || 0,
        readBps: Number(ev.readBps) || 0,
        writeBps: Number(ev.writeBps) || 0,
        iops: Number(ev.iops) || 0,
      };
    } else if (ev.type === 'error') {
      log.warn(`[resources] sysmon: ${String(ev.message)}`);
    }
  });
  child.on('exit', () => {
    if (sysmon === child) {
      sysmon = null;
      systemLoad = null;
    }
  });
}

function stopSysmon(): void {
  const child = sysmon;
  sysmon = null;
  systemLoad = null;
  if (!child) return;
  try {
    child.stdin.end();
  } catch {
    /* already closed */
  }
  setTimeout(() => {
    if (child.exitCode === null) child.kill();
  }, 3000).unref();
}

function cpuTimes(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const c of cpus()) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.irq + c.times.idle;
  }
  return { idle, total };
}

function takeSample(): ResourceSample {
  const now = cpuTimes();
  let cpuTotalPct = 0;
  if (prevCpu && now.total > prevCpu.total) {
    cpuTotalPct = (1 - (now.idle - prevCpu.idle) / (now.total - prevCpu.total)) * 100;
  }
  prevCpu = now;
  let ramAppMb = 0;
  try {
    for (const m of app.getAppMetrics()) ramAppMb += (m.memory?.workingSetSize ?? 0) / 1024;
  } catch {
    /* app not ready */
  }
  const run = { cpuPct: 0, memMb: 0, readBps: 0, writeBps: 0, iops: 0, heldBack: 0 };
  let hardCap = governors.size > 0;
  for (const g of governors.values()) {
    if (!g.sample) continue;
    run.cpuPct += g.sample.cpuPct;
    run.memMb += g.sample.memMb;
    run.readBps += g.sample.readBps;
    run.writeBps += g.sample.writeBps;
    run.iops += g.sample.iops;
    run.heldBack = Math.max(run.heldBack, g.sample.heldBack);
    hardCap = hardCap && g.sample.hardCap;
  }
  const mb = 1024 * 1024;
  const sys = systemLoad;
  // Task Manager's value when the monitor runs; the idle-time estimate until then.
  if (sys) cpuTotalPct = sys.cpuPct;
  return {
    t: Date.now(),
    cpuTotalPct: Math.round(Math.max(0, Math.min(100, cpuTotalPct)) * 10) / 10,
    cpuRunPct: run.cpuPct,
    ramUsedMb: Math.round((totalmem() - freemem()) / mb),
    ramAppMb: Math.round(ramAppMb),
    ramRunMb: run.memMb,
    readMBs: Math.round((run.readBps / mb) * 10) / 10,
    writeMBs: Math.round((run.writeBps / mb) * 10) / 10,
    iops: run.iops,
    sysReadMBs: sys ? Math.round((sys.readBps / mb) * 10) / 10 : null,
    sysWriteMBs: sys ? Math.round((sys.writeBps / mb) * 10) / 10 : null,
    sysIops: sys ? Math.round(sys.iops) : null,
    drives: driveLoads(driveSlots(gameLetter, workLetter, kindOf, sysDrives), sys ? sysDrives : null, run),
    heldBack: run.heldBack,
    running: governors.size > 0,
    hardCap,
  };
}

function tick(): void {
  lastSample = takeSample();
  broadcast('sc:resources:sample', lastSample);
  if (watchers === 0 && governors.size === 0) stopSampler();
}

function ensureSampler(): void {
  if (sampler) return;
  prevCpu = cpuTimes();
  startSysmon();
  sampler = setInterval(tick, 1000);
}

function stopSampler(): void {
  if (sampler) clearInterval(sampler);
  sampler = null;
  stopSysmon();
}

/** A visible window wants live numbers (true) or stopped looking (false). */
export function watch(on: boolean): void {
  watchers = on ? 1 : 0;
  if (on) ensureSampler();
}

/** App quit: no governor may outlive us holding a suspended tree. */
export function shutdown(): void {
  for (const id of [...governors.keys()]) unregisterJob(id);
  stopSampler();
}
