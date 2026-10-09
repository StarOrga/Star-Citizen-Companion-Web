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
 * It also measures: machine-wide CPU and RAM, this app's own memory, and the
 * run's share from the governors' samples — the panel draws all of it. The
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
  skinWorkers,
  type MachineInfo,
  type PresetId,
  type Range,
  type ResourceKey,
  type ResourceLimits,
  type ResourceSample,
} from '../lib/resource-limits.js';

/** What settings persist: the values, and the preset they came from (null = custom). */
export interface StoredLimits extends Partial<ResourceLimits> {
  preset?: PresetId | null;
}

export interface ResourceView {
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

export function init(opts: { stored: StoredLimits | null | undefined; legacyProfile: unknown; persist: (s: StoredLimits) => void }): void {
  persist = opts.persist;
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
  return {
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
export function workers(): { dump: number; skin: number; memCapMb: number } {
  return {
    dump: dumpWorkers(limits, machine.cores),
    skin: skinWorkers(limits, machine.cores),
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

/**
 * Find out what kind of drive `path` lives on, so the disk scales fit it (an
 * HDD tops out around 150 MB/s and a few hundred operations; an NVMe drive at
 * thousands). One PowerShell query per drive letter, cached for the session.
 */
export async function detectDisk(path: unknown): Promise<ResourceView> {
  if (!SUPPORTED || typeof path !== 'string') return view();
  const letter = /^([A-Za-z]):/.exec(path)?.[1]?.toUpperCase();
  if (!letter) return view();
  let caps = diskCache.get(letter);
  if (!caps) {
    const script =
      `$ErrorActionPreference='Stop';` +
      `$n=(Get-Partition -DriveLetter ${letter}).DiskNumber;` +
      `$p=Get-PhysicalDisk | Where-Object { $_.DeviceId -eq "$n" } | Select-Object -First 1;` +
      `Write-Output "$($p.MediaType)|$($p.BusType)"`;
    const out = await new Promise<string>((resolve) => {
      let text = '';
      try {
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
          windowsHide: true,
        });
        child.stdout.on('data', (d: Buffer) => (text += d.toString('utf-8')));
        child.on('error', () => resolve(''));
        child.on('exit', () => resolve(text.trim()));
        setTimeout(() => {
          child.kill();
          resolve(text.trim());
        }, 15_000).unref();
      } catch {
        resolve('');
      }
    });
    const [media, bus] = out.split('|');
    caps = DISK_CAPS[diskKindFrom(media, bus)];
    diskCache.set(letter, caps);
    log.info(`[resources] drive ${letter}: "${out}" → ${caps.kind}`);
  }
  if (caps.kind === machine.disk.kind) return view();
  machine.disk = caps;
  // A preset follows the new scale; a custom mix keeps its values, clamped.
  limits = preset ? presetLimits(preset, machine) : clampLimits(limits, machine, limits);
  return changed();
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
  sampler = setInterval(tick, 1000);
}

function stopSampler(): void {
  if (sampler) clearInterval(sampler);
  sampler = null;
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
