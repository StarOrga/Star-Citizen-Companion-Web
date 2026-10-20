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
 * machine-wide RAM, this app's own memory and CPU, the GPU load and VRAM
 * (sysmon's PDH GPU counters, split by the uploader pid set main sends it —
 * see {@link syncSysmonPids}), and the run's share from the governors'
 * samples — the panel draws all of it. The
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
  appCpuPct,
  clampLimits,
  diskKindFrom,
  dumpWorkers,
  governorLimits,
  matchPreset,
  migrateLegacyGpu,
  pacingMs,
  parseSampleGpu,
  presetGpuPct,
  presetFromLegacyProfile,
  presetLimits,
  rangesFor,
  silhouetteWorkers,
  skinWorkers,
  type MachineInfo,
  type PresetId,
  type Range,
  type LimitKey,
  type ResourceLimits,
  type ResourceSample,
} from '../lib/resource-limits.js';
import {
  driveLetter,
  driveLoads,
  driveSlots,
  descendantPids,
  parseAppIo,
  parseGpuDetect,
  parseProcessTable,
  parseSysDrives,
  shortGpuName,
  type DriveSlot,
  type GpuInfo,
  type RunIo,
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
  /** Every limit's range, `gpuPct` included (0..100, step 1). */
  ranges: Record<LimitKey, Range>;
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

/** undefined = not detected yet; null = detected, none found. */
let gpuName: string | null | undefined = SUPPORTED ? undefined : null;
/** Dedicated VRAM of that adapter (registry), MB; null = unknown. */
let vramTotalMb: number | null = null;
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

/** GPU use follows the limit: on exactly while `gpuPct > 0` and a GPU path is available. */
function syncSidecarGpu(): void {
  setSidecarGpu(limits.gpuPct > 0 && gpuAvailable(), limits.gpuPct);
}

function kindOf(letter: string): MachineInfo['disk']['kind'] {
  return diskCache.get(letter)?.kind ?? 'unknown';
}

export function init(opts: {
  stored: StoredLimits | null | undefined;
  legacyProfile: unknown;
  persist: (s: StoredLimits) => void;
  /** Legacy settings `useGpu` (the removed switch) — only read to migrate a custom mix without `gpuPct`. */
  useGpu?: boolean;
}): void {
  persist = opts.persist;
  const { stored, migrated } = migrateLegacyGpu(opts.stored, opts.useGpu === true);
  if (stored && typeof stored === 'object') {
    preset = stored.preset && PRESET_IDS.includes(stored.preset) ? stored.preset : null;
    limits = preset ? presetLimits(preset, machine) : clampLimits(stored, machine);
  } else {
    // First launch after the profiles: the old pick maps onto the preset that means the same.
    preset = presetFromLegacyProfile(opts.legacyProfile);
    limits = presetLimits(preset, machine);
  }
  if (migrated) {
    log.info(`[resources] migrated legacy useGpu=${opts.useGpu === true} → gpuPct ${limits.gpuPct}`);
    persist({ ...limits, preset });
  }
  syncSidecarGpu();
}

export function view(): ResourceView {
  detectGpu();
  return {
    drives: driveSlots(gameLetter, workLetter, kindOf, sysDrives),
    gpu: {
      name: gpuName ?? null,
      shortName: shortGpuName(gpuName ?? null),
      enabled: limits.gpuPct > 0,
      available: gpuAvailable(),
      vramTotalMb,
    },
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

/**
 * The operator's own (persisted) limits while a run the uploader started
 * itself runs on its `autoRunPreset` ({@link applyAutoRunPreset}); null when no
 * such override is in effect.
 */
let operatorStored: StoredLimits | null = null;

/**
 * Persist + push + broadcast. `operator` = the change came from the dock: it
 * becomes the operator's pick and ends an auto-run override. A rescale while
 * an override is in effect (drive detection) is not persisted — the stored
 * limits stay the operator's.
 */
function changed(operator = true): ResourceView {
  if (operator) operatorStored = null;
  if (!operatorStored) persist({ ...limits, preset });
  syncSidecarGpu();
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
  return changed(true);
}

export function applyPreset(id: unknown): ResourceView {
  if (typeof id !== 'string' || !PRESET_IDS.includes(id as PresetId)) return view();
  preset = id as PresetId;
  limits = presetLimits(preset, machine);
  return changed(true);
}

/**
 * Start a run the uploader started itself on its own preset (the ⚙ sentence's
 * "mit … Leistung"), WITHOUT writing it over the dock's persisted limits. The
 * dock shows it and may change it while the run goes — such a change is an
 * ordinary operator pick from then on. {@link restoreOperatorLimits} undoes it.
 */
export function applyAutoRunPreset(id: unknown): ResourceView {
  if (typeof id !== 'string' || !PRESET_IDS.includes(id as PresetId)) return view();
  if (!operatorStored) operatorStored = { ...limits, preset };
  preset = id as PresetId;
  limits = presetLimits(preset, machine);
  return changed(false);
}

/** Back to the operator's own limits before a run they start themselves. */
export function restoreOperatorLimits(): ResourceView {
  const stored = operatorStored;
  if (!stored) return view();
  preset = stored.preset && PRESET_IDS.includes(stored.preset) ? stored.preset : null;
  limits = preset ? presetLimits(preset, machine) : clampLimits(stored, machine);
  return changed(true);
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
  return changed(false);
}

/** Push the view without touching the limits (drive layout, GPU). */
function notify(): void {
  broadcast('sc:resources:changed', view());
}

// ── GPU ─────────────────────────────────────────────────────────────────────

/**
 * One PowerShell call: every adapter name (`NAME|…`) and, per display-adapter
 * class key, `REG|<DriverDesc>|<HardwareInformation.qwMemorySize>` — REG_QWORD
 * as a decimal, REG_BINARY as `hex:<bytes>`. Win32_VideoController.AdapterRAM
 * is a uint32 (capped at 4 GB) and therefore NOT used. Parsed by
 * `parseGpuDetect` (lib/drive-load.ts).
 */
const GPU_DETECT_PS =
  `Get-CimInstance Win32_VideoController | ForEach-Object { 'NAME|' + $_.Name };` +
  `Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}' -ErrorAction SilentlyContinue | ForEach-Object {` +
  ` $p = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue;` +
  ` if ($p -and $p.DriverDesc) { $m = $p.'HardwareInformation.qwMemorySize';` +
  ` if ($m -is [byte[]]) { $m = 'hex:' + (($m | ForEach-Object { $_.ToString('x2') }) -join '') };` +
  ` if ($null -ne $m) { 'REG|' + $p.DriverDesc + '|' + $m } } }`;

/** Name + VRAM size of the primary GPU, once per session, only when someone looks (idle budget). */
function detectGpu(): void {
  if (gpuName !== undefined || gpuDetecting) return;
  gpuDetecting = true;
  const started = Date.now();
  void powershell(GPU_DETECT_PS, 30_000).then((out) => {
    gpuDetecting = false;
    const found = parseGpuDetect(out);
    gpuName = found.name;
    vramTotalMb = found.vramTotalMb;
    log.info(`[resources] gpu: ${JSON.stringify(gpuName)}, vram ${vramTotalMb ?? '?'} MB (${Date.now() - started} ms)`);
    syncSidecarGpu();
    notify();
    if (gpuName) probeGpuCapability();
  });
}

/**
 * Ask the sidecar whether its GPU path can really run here
 * (`python -m sc_extract.gpu_probe` → one JSON line `{available, name, reason}`).
 * No answer (module absent in this build, crash, timeout) leaves the
 * "a GPU name was detected" default in place.
 */
function probeGpuCapability(): void {
  const { interpreter, cwd } = resolvePythonPaths();
  let text = '';
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(interpreter, ['-E', '-s', '-B', '-u', '-X', 'utf8', '-m', 'sc_extract.gpu_probe'], {
      cwd,
      env: process.env,
      windowsHide: true,
    });
  } catch {
    return;
  }
  const timer = setTimeout(() => child.kill(), 30_000);
  timer.unref();
  child.stdin.end();
  child.stdout.on('data', (d: Buffer) => (text += d.toString('utf-8')));
  child.on('error', () => undefined);
  child.on('close', () => {
    clearTimeout(timer);
    try {
      const res = JSON.parse(text.trim().split(/\r?\n/).pop() ?? '') as { available?: unknown; reason?: unknown };
      if (typeof res.available !== 'boolean') return;
      log.info(`[resources] gpu probe: available=${res.available}${res.reason ? ` (${String(res.reason)})` : ''}`);
      setGpuAvailable(res.available);
    } catch {
      /* no probe in this build — keep the default */
    }
  });
}

/**
 * COMPAT SHIM for the removed "use GPU" switch — the GPU limit `gpuPct` is the
 * source now (`setLimits({ gpuPct })`). On: a GPU limit of 0 becomes the
 * balanced share (an existing share > 0 stays); off: `gpuPct` 0. Persisted
 * like any limit change; the settings key `useGpu` is no longer written.
 */
export function setUseGpu(on: unknown): ResourceView {
  if (on === true) return limits.gpuPct > 0 ? view() : setLimits({ gpuPct: presetGpuPct('balanced') });
  return setLimits({ gpuPct: 0 });
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
  /** The governed sidecar (root of its tree). */
  pid: number;
  /** Its job's pids when the governor reports them (`pids` in a sample); null = not reported. */
  jobPids: number[] | null;
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
  const g: Governor = { child, pid, jobPids: null, sample: null };
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
      // Forward-compatible: a governor that lists its job's pids saves the tree scan.
      if (Array.isArray(ev.pids)) g.jobPids = ev.pids.filter((n): n is number => Number.isInteger(n) && (n as number) > 0);
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
/** sysmon's raw `gpu` object of the last sample (bytes), null = absent / unmeasured. */
let sysGpuRaw: unknown = null;
/** sysmon's `ready.gpuCounters` — which PDH GPU sets exist; [] = the GPU cannot be measured. */
let sysGpuCounters: string[] | null = null;
/** sysmon's `appIo` — this main process's own file I/O; null = not measured. */
let sysAppIo: RunIo | null = null;

// ── Uploader pid set → sysmon ───────────────────────────────────────────────

/** Last pid set written to sysmon ('' = none yet for this sysmon process). */
let sentPidsKey = '';
/** Descendants of the governed sidecars from the last process-table scan. */
let treePids: number[] = [];
let treeScanAt = 0;
let treeScanning = false;
/** How often the sidecar trees are re-scanned while a run goes (one PowerShell call). */
const TREE_SCAN_MS = 5000;

/**
 * Every descendant of the governed sidecars (cgf-converter, workers …) from
 * one Win32_Process query — only while a job runs and the sampler ticks, and
 * only for governors that do not report their job pids themselves.
 */
function scanTrees(): void {
  const roots = [...governors.values()].filter((g) => !g.jobPids).map((g) => g.pid);
  if (roots.length === 0) {
    treePids = [];
    return;
  }
  if (treeScanning || Date.now() - treeScanAt < TREE_SCAN_MS) return;
  treeScanning = true;
  treeScanAt = Date.now();
  void powershell(
    `Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }`,
    15_000,
  ).then((out) => {
    treeScanning = false;
    const live = [...governors.values()].filter((g) => !g.jobPids).map((g) => g.pid);
    treePids = descendantPids(live, parseProcessTable(out));
  });
}

/**
 * Hand sysmon the uploader pid set (it splits GPU load / VRAM by it): the full
 * process tree of every governed sidecar plus the Electron app's own
 * processes. The stdin line `{"type":"pids","pids":[…],"ioPids":[…]}` REPLACES
 * the set, so it is re-sent whenever the set changes (and once per sysmon
 * start). `ioPids` is only this main process: its file I/O becomes `appIo`.
 * Renderer and GPU processes stay out — their IPC pipes count as I/O
 * (MB/s at idle) without touching a disk.
 */
function syncSysmonPids(appPids: readonly number[]): void {
  if (!sysmon) return;
  scanTrees();
  const set = new Set<number>(appPids);
  for (const g of governors.values()) {
    set.add(g.pid);
    for (const p of g.jobPids ?? []) set.add(p);
  }
  for (const p of treePids) set.add(p);
  const pids = [...set].filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  const ioPids = [process.pid];
  const key = `${pids.join(',')}|${ioPids.join(',')}`;
  if (key === sentPidsKey) return;
  try {
    sysmon.stdin.write(`${JSON.stringify({ type: 'pids', pids, ioPids })}\n`);
    sentPidsKey = key;
  } catch {
    /* sysmon gone — the next start re-sends */
  }
}

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
  sentPidsKey = '';
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
      sysGpuRaw = ev.gpu ?? null;
      sysAppIo = parseAppIo(ev.appIo);
    } else if (ev.type === 'ready') {
      sysGpuCounters = Array.isArray(ev.gpuCounters) ? ev.gpuCounters.map(String) : null;
      log.info(`[resources] sysmon ready, gpu counters: ${JSON.stringify(sysGpuCounters)}`);
    } else if (ev.type === 'error') {
      log.warn(`[resources] sysmon: ${String(ev.message)}`);
    }
  });
  child.on('exit', () => {
    if (sysmon === child) {
      sysmon = null;
      systemLoad = null;
      sysGpuRaw = null;
      sysAppIo = null;
    }
  });
}

function stopSysmon(): void {
  const child = sysmon;
  sysmon = null;
  systemLoad = null;
  sysGpuRaw = null;
  sysAppIo = null;
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
  const appCpu: number[] = [];
  const appPids: number[] = [];
  try {
    for (const m of app.getAppMetrics()) {
      ramAppMb += (m.memory?.workingSetSize ?? 0) / 1024;
      appCpu.push(m.cpu?.percentCPUUsage ?? 0);
      appPids.push(m.pid);
    }
  } catch {
    /* app not ready */
  }
  syncSysmonPids(appPids);
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
    cpuAppPct: appCpuPct(appCpu, machine.cores),
    ramUsedMb: Math.round((totalmem() - freemem()) / mb),
    ramAppMb: Math.round(ramAppMb),
    ramRunMb: run.memMb,
    readMBs: Math.round((run.readBps / mb) * 10) / 10,
    writeMBs: Math.round((run.writeBps / mb) * 10) / 10,
    iops: run.iops,
    sysReadMBs: sys ? Math.round((sys.readBps / mb) * 10) / 10 : null,
    sysWriteMBs: sys ? Math.round((sys.writeBps / mb) * 10) / 10 : null,
    sysIops: sys ? Math.round(sys.iops) : null,
    drives: driveLoads(driveSlots(gameLetter, workLetter, kindOf, sysDrives), sys ? sysDrives : null, run, sys ? sysAppIo ?? undefined : undefined),
    // sysmon reported no GPU counter set at all → stays null (unmeasurable).
    gpu: sys && (sysGpuCounters === null || sysGpuCounters.length > 0) ? parseSampleGpu(sysGpuRaw, vramTotalMb) : null,
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
