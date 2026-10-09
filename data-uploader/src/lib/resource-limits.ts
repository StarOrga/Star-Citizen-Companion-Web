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
 *
 * Pure data + pure functions — no Node, no Electron — so main, renderer and the
 * tests share one definition.
 */

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
}

export type ResourceKey = keyof ResourceLimits;
export const RESOURCE_KEYS: readonly ResourceKey[] = ['cpuPct', 'ramMb', 'readMBs', 'writeMBs', 'iops'];

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

/** Per-preset share of each scale (CPU in percent points, the rest as a fraction of the top). */
const PRESET_SHARE: Record<PresetId, { cpuPct: number; ram: number; disk: number }> = {
  // Playing alongside: a sliver of everything, so the game never notices.
  gaming: { cpuPct: 15, ram: 0.15, disk: 0.15 },
  balanced: { cpuPct: 45, ram: 0.3, disk: 0.4 },
  full: { cpuPct: 85, ram: 0.6, disk: 0.85 },
};

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
export function rangesFor(machine: MachineInfo): Record<ResourceKey, Range> {
  const d = machine.disk;
  return {
    cpuPct: { min: CPU_MIN_PCT, max: CPU_MAX_PCT, step: 1 },
    ramMb: { min: RAM_MIN_MB, max: ramScaleMb(machine), step: 256 },
    readMBs: { min: READ_MIN_MBS, max: Math.max(READ_MIN_MBS, d.readMBs), step: 5 },
    writeMBs: { min: WRITE_MIN_MBS, max: Math.max(WRITE_MIN_MBS, d.writeMBs), step: 5 },
    iops: { min: IOPS_MIN, max: Math.max(IOPS_MIN, d.iops), step: d.iops > 1000 ? 100 : 5 },
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
  };
}

/** Bring every value into this machine's range (a settings file from another PC, a bad IPC payload). */
export function clampLimits(input: Partial<Record<ResourceKey, unknown>> | null | undefined, machine: MachineInfo, fallback?: ResourceLimits): ResourceLimits {
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
  /** The run (sidecar tree) — percent of the whole machine. */
  cpuRunPct: number;
  /** RAM in use by everything, MB. */
  ramUsedMb: number;
  /** The uploader app itself (Electron processes), MB. */
  ramAppMb: number;
  /** The run (sidecar tree), MB. */
  ramRunMb: number;
  readMBs: number;
  writeMBs: number;
  iops: number;
  /** Share of the last second the governor held the run back for a disk budget, 0..1. */
  heldBack: number;
  /** True while a sidecar is running under the governor. */
  running: boolean;
  /** False when the CPU hard cap could not be applied (no Job Object). */
  hardCap: boolean;
}

/** RAM in use by other programs = everything − this app − the run. */
export function ramOthersMb(s: Pick<ResourceSample, 'ramUsedMb' | 'ramAppMb' | 'ramRunMb'>): number {
  return Math.max(0, s.ramUsedMb - s.ramAppMb - s.ramRunMb);
}
