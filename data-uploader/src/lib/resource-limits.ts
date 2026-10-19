/**
 * Resource limits — what the operator allows a run to take from the PC.
 *
 * Replaces the three speed profiles (minimal / standard / maximum). Those only
 * moved the worker count and the priority class, and neither of those knobs
 * touches what actually froze machines: the disk. A run on "Minimal" still
 * read the P4K and wrote its output as fast as the drive allowed, so the disk
 * sat at 100 % and Windows stalled with it.
 *
 * Now every resource has its own ceiling, set on a scale derived from the
 * machine (cores, RAM, drive type):
 *
 *  - `cpuPct`   share of the WHOLE machine's CPU. Enforced as a hard cap by a
 *               Windows Job Object around the sidecar tree (`governor.py`), so
 *               workers and the converter tools it spawns are inside it too.
 *               Never above {@link CPU_MAX_PCT}: even "full power" leaves the
 *               desktop room to breathe.
 *  - `ramMb`    memory budget for the sidecar tree. Sizes how many workers a
 *               stage starts (the honest lever — a hard commit limit would make
 *               allocations fail and crash the run); the live use is shown next
 *               to it.
 *  - `readMBs` / `writeMBs` / `iops`
 *               disk budgets. Enforced by the governor: when the tree went over
 *               a budget it is paused for exactly as long as the budget needs to
 *               catch up (a duty cycle at quarter-second resolution), and every
 *               process in it runs at very-low I/O priority, so a game's own
 *               reads always go first.
 *  - `gpuPct`   share of the GPU the run may load, 0..100. 0 = "do not use the
 *               GPU" (sidecars get `SC_USE_GPU=0`); above 0 — and only while a
 *               GPU path is available — `SC_USE_GPU=1` plus `SC_GPU_SHARE=<gpuPct>`
 *               (`main/sidecar-env.ts`). Windows cannot hard-cap a GPU, so this
 *               is a SOFT lever: the GPU stages (silhouettes / 3D) read the share
 *               and pace themselves; the measured load may briefly exceed it. Not
 *               part of {@link GovernorLimits} — the governor has nothing to
 *               enforce it with. Replaces the old operator switch "use GPU"
 *               (settings `useGpu`, migrated by {@link migrateLegacyGpu}).
 *
 * Pure data + pure functions — no Node, no Electron — so main, renderer and the
 * tests share one definition.
 */

import type { DriveLoad } from './drive-load.js';

export type DiskKind = 'nvme' | 'ssd' | 'hdd' | 'unknown';

/** Nominal capability of a drive class — the top of the disk scales. */
export interface DiskCaps {
  kind: DiskKind;
  readMBs: number;
  writeMBs: number;
  iops: number;
}

/**
 * Deliberately conservative nominal values: the top of a slider should be
 * what the drive class sustains for a mixed read/write workload, not the
 * sequential number on the box.
 */
export const DISK_CAPS: Record<DiskKind, DiskCaps> = {
  nvme: { kind: 'nvme', readMBs: 2000, writeMBs: 1500, iops: 50_000 },
  ssd: { kind: 'ssd', readMBs: 500, writeMBs: 450, iops: 20_000 },
  hdd: { kind: 'hdd', readMBs: 150, writeMBs: 130, iops: 150 },
  unknown: { kind: 'unknown', readMBs: 500, writeMBs: 400, iops: 5_000 },
};

export interface MachineInfo {
  /** Logical processors. */
  cores: number;
  totalRamMb: number;
  /** The drive the selected Data.p4k lives on (the run reads and writes there). */
  disk: DiskCaps;
}

export interface ResourceLimits {
  /** Percent of the whole machine's CPU (all cores = 100). */
  cpuPct: number;
  /** Memory budget for the sidecar tree, MB. */
  ramMb: number;
  /** Disk read budget, MB/s. */
  readMBs: number;
  /** Disk write budget, MB/s. */
  writeMBs: number;
  /** Disk operations per second (read + write). */
  iops: number;
  /** Share of the GPU the run may load, 0..100; 0 = GPU off (soft lever, see the header). */
  gpuPct: number;
}

/** Every limit, including the GPU share. Ranges, clamping and preset matching are keyed by it. */
export type LimitKey = keyof ResourceLimits;
/**
 * The limits the dock's dial machinery handles today (no `gpuPct` yet — its
 * exhaustive `unit()` / `num()` switches would not compile with it). A GPU
 * tempomat dial: widen the renderer's keys to {@link LimitKey} (or this alias
 * to `LimitKey`) and add the `gpuPct` cases ('%', integer) — `ranges.gpuPct`
 * is already in every view.
 */
export type ResourceKey = Exclude<LimitKey, 'gpuPct'>;
export const RESOURCE_KEYS: readonly LimitKey[] = ['cpuPct', 'ramMb', 'readMBs', 'writeMBs', 'iops', 'gpuPct'];

export type PresetId = 'gaming' | 'balanced' | 'full';
export const PRESET_IDS: readonly PresetId[] = ['gaming', 'balanced', 'full'];
export const DEFAULT_PRESET: PresetId = 'balanced';

/** "Maximum" may take 80-90 % of the machine — never all of it. */
export const CPU_MAX_PCT = 90;
export const CPU_MIN_PCT = 5;
/** Below this a stage cannot even hold the parsed DataCore. */
export const RAM_MIN_MB = 1024;
/** Kept free for Windows itself when the scale is derived from total RAM. */
export const RAM_OS_RESERVE_MB = 2048;
export const READ_MIN_MBS = 5;
export const WRITE_MIN_MBS = 5;
export const IOPS_MIN = 20;
/** 0 is a valid limit: the GPU is not used at all. */
export const GPU_MIN_PCT = 0;
export const GPU_MAX_PCT = 100;

/** Per-preset share of each scale (CPU in percent points, the rest as a fraction of the top). */
const PRESET_SHARE: Record<PresetId, { cpuPct: number; ram: number; disk: number; gpuPct: number }> = {
  // Playing alongside: a sliver of everything, so the game never notices — and
  // the GPU stays the game's alone.
  gaming: { cpuPct: 15, ram: 0.15, disk: 0.15, gpuPct: 0 },
  balanced: { cpuPct: 45, ram: 0.3, disk: 0.4, gpuPct: 80 },
  full: { cpuPct: 85, ram: 0.6, disk: 0.85, gpuPct: 100 },
};

/** The GPU share a preset carries (gaming 0 = off, balanced 80, full 100). */
export function presetGpuPct(id: PresetId): number {
  return PRESET_SHARE[id].gpuPct;
}

export interface Range {
  min: number;
  max: number;
  step: number;
}

/** Top of the RAM scale: everything but what Windows needs for itself. */
export function ramScaleMb(machine: MachineInfo): number {
  return Math.max(RAM_MIN_MB, machine.totalRamMb - RAM_OS_RESERVE_MB);
}

/** The slider range of every resource on this machine. */
export function rangesFor(machine: MachineInfo): Record<LimitKey, Range> {
  const d = machine.disk;
  return {
    cpuPct: { min: CPU_MIN_PCT, max: CPU_MAX_PCT, step: 1 },
    ramMb: { min: RAM_MIN_MB, max: ramScaleMb(machine), step: 256 },
    readMBs: { min: READ_MIN_MBS, max: Math.max(READ_MIN_MBS, d.readMBs), step: 5 },
    writeMBs: { min: WRITE_MIN_MBS, max: Math.max(WRITE_MIN_MBS, d.writeMBs), step: 5 },
    iops: { min: IOPS_MIN, max: Math.max(IOPS_MIN, d.iops), step: d.iops > 1000 ? 100 : 5 },
    gpuPct: { min: GPU_MIN_PCT, max: GPU_MAX_PCT, step: 1 },
  };
}

function snap(value: number, r: Range): number {
  const v = Math.min(r.max, Math.max(r.min, value));
  const snapped = Math.round(v / r.step) * r.step;
  return Math.min(r.max, Math.max(r.min, snapped));
}

export function presetLimits(id: PresetId, machine: MachineInfo): ResourceLimits {
  const share = PRESET_SHARE[id];
  const r = rangesFor(machine);
  // At least one core's worth: on a 4-core box 15 % would be less than a core,
  // and a single worker throttled below one core only stretches the run.
  const oneCore = Math.ceil(100 / Math.max(1, machine.cores));
  return {
    cpuPct: snap(Math.max(share.cpuPct, Math.min(oneCore, CPU_MAX_PCT)), r.cpuPct),
    ramMb: snap(Math.max(1536, ramScaleMb(machine) * share.ram), r.ramMb),
    readMBs: snap(r.readMBs.max * share.disk, r.readMBs),
    writeMBs: snap(r.writeMBs.max * share.disk, r.writeMBs),
    iops: snap(r.iops.max * share.disk, r.iops),
    gpuPct: snap(share.gpuPct, r.gpuPct),
  };
}

/** Bring every value into this machine's range (a settings file from another PC, a bad IPC payload). */
export function clampLimits(input: Partial<Record<LimitKey, unknown>> | null | undefined, machine: MachineInfo, fallback?: ResourceLimits): ResourceLimits {
  const base = fallback ?? presetLimits(DEFAULT_PRESET, machine);
  const r = rangesFor(machine);
  const out = { ...base };
  for (const key of RESOURCE_KEYS) {
    const raw = input?.[key];
    const n = typeof raw === 'number' && Number.isFinite(raw) ? raw : base[key];
    out[key] = snap(n, r[key]);
  }
  return out;
}

/** The preset these limits equal, or null for a custom mix. */
export function matchPreset(limits: ResourceLimits, machine: MachineInfo): PresetId | null {
  for (const id of PRESET_IDS) {
    const p = presetLimits(id, machine);
    if (RESOURCE_KEYS.every((k) => p[k] === limits[k])) return id;
  }
  return null;
}

/**
 * Settings written before `gpuPct` existed carry the operator switch `useGpu`
 * instead. Least surprising mapping:
 *  - a PRESET pick (or no stored limits at all) carries its own value — the
 *    preset is what the operator chose, and it now includes the GPU share
 *    (gaming 0, balanced 80, full 100); the old switch does not override it;
 *  - a CUSTOM mix keeps the old switch's meaning: `useGpu` false → 0 (GPU off),
 *    true → the balanced share (80).
 * Stored limits that already have a numeric `gpuPct` pass through unchanged,
 * so the migration runs at most once in effect. `migrated` says whether the
 * caller should persist the result.
 */
export function migrateLegacyGpu<T extends { gpuPct?: unknown; preset?: PresetId | null }>(
  stored: T | null | undefined,
  useGpu: boolean,
): { stored: T | null | undefined; migrated: boolean } {
  if (!stored || typeof stored !== 'object') return { stored, migrated: false };
  if (typeof stored.gpuPct === 'number' && Number.isFinite(stored.gpuPct)) return { stored, migrated: false };
  if (stored.preset && PRESET_IDS.includes(stored.preset)) return { stored, migrated: false };
  return { stored: { ...stored, gpuPct: useGpu ? presetGpuPct('balanced') : 0 }, migrated: true };
}

/** The old speed profile a settings file may still carry → the preset that means the same. */
export function presetFromLegacyProfile(profile: unknown): PresetId {
  switch (profile) {
    case 'minimal':
      return 'gaming';
    case 'maximum':
      return 'full';
    default:
      return 'balanced';
  }
}

/**
 * Record-dump worker processes. As many as the CPU share covers whole cores —
 * more would only queue behind the hard cap, at the memory cost of a full
 * DataCore parse each. The sidecar clamps it by `ramMb` again (`--mem-cap-mb`).
 */
export function dumpWorkers(limits: ResourceLimits, cores: number): number {
  const total = Math.max(1, Math.floor(cores));
  return Math.max(1, Math.min(total - 1 || 1, Math.floor((total * limits.cpuPct) / 100)));
}

/** Rough resident size of one 3D-export worker (own P4K index + DataCore). */
export const SKIN_WORKER_MB = 3072;

/** Ships the 3D export builds at once — a ship keeps ~2 cores busy, capped at 4 and by RAM. */
export function skinWorkers(limits: ResourceLimits, cores: number): number {
  const byCpu = Math.floor(dumpWorkers(limits, cores) / 2);
  const byRam = Math.floor(limits.ramMb / SKIN_WORKER_MB);
  return Math.max(1, Math.min(4, byCpu, byRam));
}

/**
 * Meshes the silhouette step converts at once. One conversion is one
 * cgf-converter process plus a numpy raster — about a core and a few hundred
 * MB — so the CPU share decides, capped at 8 (beyond that the single P4K
 * reader feeding them is the bottleneck).
 */
export function silhouetteWorkers(limits: ResourceLimits, cores: number): number {
  const byRam = Math.floor(limits.ramMb / 512);
  return Math.max(1, Math.min(8, dumpWorkers(limits, cores), byRam));
}

export type PriorityClass = 'idle' | 'below_normal';

/** What the governor process is told — bytes, not MB, and the priorities to use. */
export interface GovernorLimits {
  cpuPct: number;
  readBps: number;
  writeBps: number;
  iops: number;
  ramMb: number;
  priority: PriorityClass;
}

/** `gpuPct` is deliberately absent: the governor cannot cap a GPU (see the header). */
export function governorLimits(limits: ResourceLimits): GovernorLimits {
  return {
    cpuPct: limits.cpuPct,
    readBps: Math.round(limits.readMBs * 1024 * 1024),
    writeBps: Math.round(limits.writeMBs * 1024 * 1024),
    iops: Math.round(limits.iops),
    ramMb: Math.round(limits.ramMb),
    // A small CPU share is the "I am playing" case: Idle loses every scheduling
    // contest against a foreground app. Above that BelowNormal — never Normal,
    // the run is always the background job.
    priority: limits.cpuPct <= 30 ? 'idle' : 'below_normal',
  };
}

/**
 * Pause between upload work units (catalog chunks, livery PUTs). Those run in
 * this process, not the sidecar, so the governor does not reach them; a low CPU
 * share yields a little between requests.
 */
export function pacingMs(limits: ResourceLimits): number {
  return limits.cpuPct <= 25 ? 150 : 0;
}

/** Map the drive's reported media/bus type (PowerShell Get-PhysicalDisk) onto a class. */
export function diskKindFrom(mediaType: string | null | undefined, busType: string | null | undefined): DiskKind {
  const bus = String(busType ?? '').toLowerCase();
  const media = String(mediaType ?? '').toLowerCase();
  if (bus === 'nvme' || bus === '17') return 'nvme';
  if (media === 'hdd' || media === '3') return 'hdd';
  if (media === 'ssd' || media === '4') return 'ssd';
  return 'unknown';
}

/** Live snapshot the panel draws — machine-wide use and the run's own share. */
export interface ResourceSample {
  t: number;
  /** Whole-machine CPU use, percent. */
  cpuTotalPct: number;
  /**
   * The run (sidecar tree) — percent of the whole machine. The CPU limit applies
   * to this alone.
   */
  cpuRunPct: number;
  /**
   * The uploader app itself (Electron processes: `app.getAppMetrics()`
   * `cpu.percentCPUUsage`, normalised by {@link appCpuPct}) — percent of the
   * whole machine (all logical cores = 100). The dock's "Uploader" share is
   * `cpuRunPct + cpuAppPct` (and RAM `ramRunMb + ramAppMb`); the tooltip
   * explains that the limits cover the run only, so the blue share may exceed
   * a limit by the app's part. Optional only so older payloads still
   * type-check; main always sets it.
   */
  cpuAppPct?: number;
  /** RAM in use by everything, MB. */
  ramUsedMb: number;
  /** The uploader app itself (Electron processes), MB. */
  ramAppMb: number;
  /** The run (sidecar tree), MB. */
  ramRunMb: number;
  readMBs: number;
  writeMBs: number;
  iops: number;
  /** The whole PC's disk load (Task Manager), null until the monitor reports. */
  sysReadMBs: number | null;
  sysWriteMBs: number | null;
  sysIops: number | null;
  /**
   * Per physical disk the run touches (game / work / both) — see
   * `lib/drive-load.ts` for the contract. Empty until an install is selected.
   */
  drives: DriveLoad[];
  /** Share of the last second the governor held the run back for a disk budget, 0..1. */
  heldBack: number;
  /**
   * GPU load, null until the whole-PC monitor measured one (no GPU, no PDH GPU
   * counters, non-Windows, first second) — see {@link SampleGpu}. Optional only
   * so older payloads still type-check; main always sets it (null or a value).
   */
  gpu?: SampleGpu | null;
  /** True while a sidecar is running under the governor. */
  running: boolean;
  /** False when the CPU hard cap could not be applied (no Job Object). */
  hardCap: boolean;
}

/**
 * GPU numbers of one sample (`python/sc_extract/sysmon.py`, PDH counters,
 * Task Manager semantics). "Uploader" = the pid set main hands to sysmon: the
 * governed sidecars AND the Electron app's own processes.
 */
export interface SampleGpu {
  /** Whole-GPU load, 0..100: per engine type the sum over all processes, overall = the busiest engine type. */
  loadPct: number;
  /** The uploader's share of that load (same engine-type rule over its pids only), 0..100. */
  runLoadPct: number;
  /** Dedicated VRAM in use on the adapter, everything included, MB. */
  vramUsedMb: number;
  /** Dedicated VRAM held by the uploader's processes, MB. */
  vramRunMb: number;
  /**
   * Size of the adapter's dedicated VRAM, MB — from the registry
   * (`HardwareInformation.qwMemorySize`, read with the GPU detection), NOT
   * Win32_VideoController.AdapterRAM (capped at 4 GB). null when unknown.
   */
  vramTotalMb: number | null;
}

/**
 * The sysmon sample's optional `gpu` object (bytes) → {@link SampleGpu} (MB).
 * Absent / malformed (no numeric `loadPct`) → null = unmeasured. Shares are
 * clamped to 0..100 and never above the whole-GPU value.
 */
export function parseSampleGpu(raw: unknown, vramTotalMb: number | null): SampleGpu | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  if (typeof g.loadPct !== 'number' || !Number.isFinite(g.loadPct)) return null;
  const MB = 1024 * 1024;
  const r1 = (v: number): number => Math.round(v * 10) / 10;
  const loadPct = r1(Math.min(100, num(g.loadPct)));
  const vramUsedMb = Math.round(num(g.vramUsedBytes) / MB);
  return {
    loadPct,
    runLoadPct: r1(Math.min(loadPct, num(g.runLoadPct))),
    vramUsedMb,
    vramRunMb: Math.min(vramUsedMb, Math.round(num(g.vramRunBytes) / MB)),
    vramTotalMb: typeof vramTotalMb === 'number' && vramTotalMb > 0 ? Math.round(vramTotalMb) : null,
  };
}

/**
 * The Electron app's CPU as a share of the WHOLE machine. `percentCPUUsage` of
 * `app.getAppMetrics()` is per process and relative to one core (a busy
 * renderer may read 150), so the sum is divided by the logical core count.
 */
export function appCpuPct(perProcess: readonly (number | null | undefined)[], cores: number): number {
  let sum = 0;
  for (const p of perProcess) if (typeof p === 'number' && Number.isFinite(p) && p > 0) sum += p;
  const pct = sum / Math.max(1, Math.floor(cores) || 1);
  return Math.round(Math.min(100, pct) * 10) / 10;
}

/** Room above the limit on a measured scale, so the handle never sits pinned at its end. */
export const MEASURED_SCALE_HEADROOM = 1.5;

/** Round up to 1 / 2 / 2.5 / 5 × 10ⁿ — a scale top that reads as a number. */
export function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (v <= m * pow * (1 + 1e-9)) return m * pow;
  }
  return 10 * pow;
}

/**
 * Top of a disk scale when the drive type is unknown: no nominal class to draw
 * against, so the highest load measured on this PC is the scale — it grows as
 * the drive shows what it can do. Never so low that the limit handle sits at
 * the very end (it could not be dragged further up).
 */
export function measuredScaleTop(peak: number, limit: number, floor: number): number {
  return niceCeil(Math.max(peak, limit * MEASURED_SCALE_HEADROOM, floor));
}

/**
 * Top of a disk scale for EVERY drive kind (decision: the scale follows the
 * highest value measured so far, not the nominal class): the measured `peak`
 * (the renderer's persisted, grow-only `diskPeak`), the limit with headroom —
 * that headroom never past `nominalMax` (the limit range's top: no room is
 * drawn that the knob cannot reach) — and `rangeMin` as the floor. A measured
 * peak above the nominal class still grows the scale. `prevTop` makes it
 * grow-only: lowering the limit never shrinks a scale already drawn (no decay).
 */
export function diskScaleTop(peak: number, limit: number, rangeMin: number, nominalMax: number, prevTop = 0): number {
  const fin = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0);
  const headroom = Math.min(fin(limit) * MEASURED_SCALE_HEADROOM, Math.max(fin(nominalMax), fin(limit)));
  const top = niceCeil(Math.max(fin(peak), headroom, fin(limit), fin(rangeMin)));
  return Math.max(top, fin(prevTop));
}

/** RAM in use by other programs = everything − this app − the run. */
export function ramOthersMb(s: Pick<ResourceSample, 'ramUsedMb' | 'ramAppMb' | 'ramRunMb'>): number {
  return Math.max(0, s.ramUsedMb - s.ramAppMb - s.ramRunMb);
}
