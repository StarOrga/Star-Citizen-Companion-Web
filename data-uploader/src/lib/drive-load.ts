/**
 * Per-drive load and GPU info for the performance dock — the contract between
 * main (`main/resources.ts`, which fills it) and the renderer (which draws it).
 *
 * CONTRACT (UI builds on exactly these fields):
 *
 *  `ResourceView.drives: DriveSlot[]` — the layout, known before any sample:
 *    one slot per PHYSICAL disk the run touches. Order: game first, then work.
 *    `role` is 'both' when the game drive and the work drive are the same
 *    physical disk (then there is exactly one slot → the dock shows 3 cells
 *    instead of 4). Empty until the renderer reported the selected install
 *    (`resources.detectDisk(path)`).
 *
 *  `ResourceSample.drives: DriveLoad[]` — the same slots with live numbers,
 *    raw 1 s values, no averaging (the 60-sample ring buffer is the renderer's).
 *    Whole-PC numbers (`activePct`, `responseMs`, `readMBs`, `writeMBs`,
 *    `iops`) are Task Manager's for that physical disk, everything included;
 *    null while the whole-PC monitor has not reported that disk (non-Windows,
 *    counter missing, first second).
 *    `run` is the uploader run's share of it. The run's I/O is measured per
 *    process tree, NOT per drive, so it is attributed (see {@link driveLoads}):
 *    `runAttribution` says how. `runSharePct` = run bytes ÷ drive bytes, null
 *    when the drive moved (almost) nothing.
 *
 *  `ResourceView.gpu: GpuInfo` — `name` of the primary GPU (null = none found
 *    or not detected yet / non-Windows), `enabled` = the operator's persisted
 *    "use GPU" switch (`resources.setUseGpu`), `available` = whether a GPU
 *    path can run. Every sidecar gets env `SC_USE_GPU=1` exactly when
 *    `enabled && available`, else `SC_USE_GPU=0`; a Python GPU path reads
 *    only that variable and must still fall back to CPU when its own device
 *    init fails.
 *
 * Disk LIMITS are unchanged: one read / write / iops budget for the run (see
 * `resource-limits.ts`), the scales follow the game drive (`machine.disk`).
 *
 * Pure data + pure functions — no Node, no Electron.
 */

import type { DiskKind } from './resource-limits.js';

export type DriveRole = 'game' | 'work' | 'both';

/** One physical disk the run touches, as laid out in the dock. */
export interface DriveSlot {
  /** The letter the dock labels it with: the game drive's or the work drive's. */
  letter: string;
  /** Every letter on that physical disk (from the monitor; just `[letter]` until it reports). */
  letters: string[];
  role: DriveRole;
  kind: DiskKind;
}

/** How the run's I/O was split onto this drive. */
export type RunAttribution =
  /** Game and work drive are one disk: all of the run's I/O lands here. */
  | 'all'
  /** Two disks: run reads → game drive, run writes → work drive, ops split by bytes. */
  | 'assumed';

export interface DriveLoad extends DriveSlot {
  /** Task Manager's "Active time", 0..100. */
  activePct: number | null;
  /** Average time per transfer, ms. */
  responseMs: number | null;
  /** Whole PC on this disk, MB/s (MiB). */
  readMBs: number | null;
  writeMBs: number | null;
  /** Whole PC on this disk, operations/s. */
  iops: number | null;
  /** The run's share of this disk (attributed, never above the whole-PC value when that is known). */
  run: { readMBs: number; writeMBs: number; iops: number };
  runAttribution: RunAttribution;
  /** Run bytes ÷ drive bytes, 0..100; null when the drive moved under 0.05 MB/s or is unmeasured. */
  runSharePct: number | null;
}

export interface GpuInfo {
  name: string | null;
  enabled: boolean;
  available: boolean;
}

/** One physical disk as `python/sc_extract/sysmon.py` reports it (bytes, not MB). */
export interface SysDrive {
  instance: string;
  letters: string[];
  activePct?: number;
  responseMs?: number;
  readBps?: number;
  writeBps?: number;
  iops?: number;
}

/** The run's whole-tree I/O (governors' samples), bytes per second. */
export interface RunIo {
  readBps: number;
  writeBps: number;
  iops: number;
}

const MB = 1024 * 1024;

/** Drive letter of a Windows path (`D:\…` → 'D'), null for anything else. */
export function driveLetter(path: unknown): string | null {
  if (typeof path !== 'string') return null;
  return /^([A-Za-z]):/.exec(path)?.[1]?.toUpperCase() ?? null;
}

/** Defensive parse of a sysmon `drives` array — malformed entries are dropped. */
export function parseSysDrives(raw: unknown): SysDrive[] | null {
  if (!Array.isArray(raw)) return null;
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
  const out: SysDrive[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    if (typeof o.instance !== 'string') continue;
    const letters = Array.isArray(o.letters)
      ? o.letters.filter((l): l is string => typeof l === 'string' && /^[A-Za-z]$/.test(l)).map((l) => l.toUpperCase())
      : [];
    out.push({
      instance: o.instance,
      letters,
      activePct: num(o.activePct),
      responseMs: num(o.responseMs),
      readBps: num(o.readBps),
      writeBps: num(o.writeBps),
      iops: num(o.iops),
    });
  }
  return out;
}

function diskOf(letter: string, sys: SysDrive[] | null): SysDrive | null {
  return sys?.find((d) => d.letters.includes(letter)) ?? null;
}

/**
 * The dock's layout: game drive and work drive, merged into one 'both' slot
 * when they are the same physical disk (same letter, or both letters on one
 * monitor instance).
 */
export function driveSlots(
  gameLetter: string | null,
  workLetter: string | null,
  kindOf: (letter: string) => DiskKind,
  sys: SysDrive[] | null,
): DriveSlot[] {
  const slot = (letter: string, role: DriveRole): DriveSlot => ({
    letter,
    letters: diskOf(letter, sys)?.letters ?? [letter],
    role,
    kind: kindOf(letter),
  });
  const game = gameLetter;
  const work = workLetter ?? gameLetter;
  if (!game) return work ? [slot(work, 'work')] : [];
  if (!work || work === game) return [slot(game, 'both')];
  const g = diskOf(game, sys);
  if (g && g === diskOf(work, sys)) return [slot(game, 'both')];
  return [slot(game, 'game'), slot(work, 'work')];
}

const r1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * Live numbers for every slot.
 *
 * Run attribution — the governor measures the run's I/O per process tree
 * (Job Object / process I/O counters), which carry no drive. So:
 *  - one 'both' slot: all of the run's I/O is on it ('all');
 *  - two slots: run reads → game drive, run writes → work drive, and the run's
 *    operations split in proportion to those bytes ('assumed'). That is the
 *    run's shape — it reads the Data.p4k and writes its extraction output —
 *    but it is an assumption, not a measurement: a read of the work cache or a
 *    write next to the game would be booked to the other disk.
 * Either way a run figure never exceeds the disk's whole-PC figure when that
 * is known: process counters also count reads the file cache served, which
 * never reached the disk.
 */
export function driveLoads(slots: DriveSlot[], sys: SysDrive[] | null, run: RunIo): DriveLoad[] {
  const two = slots.length > 1;
  const totalBytes = run.readBps + run.writeBps;
  return slots.map((s) => {
    const d = diskOf(s.letter, sys);
    const readMBs = d?.readBps !== undefined ? r1(d.readBps / MB) : null;
    const writeMBs = d?.writeBps !== undefined ? r1(d.writeBps / MB) : null;
    const iops = d?.iops !== undefined ? Math.round(d.iops) : null;
    let rr = run.readBps;
    let rw = run.writeBps;
    let ri = run.iops;
    if (two) {
      const readShare = totalBytes > 0 ? run.readBps / totalBytes : 1;
      if (s.role === 'game') {
        rw = 0;
        ri = run.iops * readShare;
      } else {
        rr = 0;
        ri = run.iops * (1 - readShare);
      }
    }
    const cap = (v: number, top: number | undefined): number => (top === undefined ? v : Math.min(v, top));
    rr = cap(rr, d?.readBps);
    rw = cap(rw, d?.writeBps);
    ri = cap(ri, d?.iops);
    const driveBytes = d && d.readBps !== undefined && d.writeBps !== undefined ? d.readBps + d.writeBps : null;
    const runSharePct =
      driveBytes !== null && driveBytes >= 0.05 * MB ? r1(Math.min(100, ((rr + rw) / driveBytes) * 100)) : null;
    return {
      ...s,
      activePct: d?.activePct ?? null,
      responseMs: d?.responseMs ?? null,
      readMBs,
      writeMBs,
      iops,
      run: { readMBs: r1(rr / MB), writeMBs: r1(rw / MB), iops: Math.round(ri) },
      runAttribution: two ? 'assumed' : 'all',
      runSharePct,
    };
  });
}

/** Adapters that are not a real GPU (remote sessions, virtual displays, the fallback driver). */
const NOT_A_GPU = /microsoft basic|remote display|virtual|parsec|meta virtual|citrix|vmware|hyper-v|displaylink|idd/i;
/** Discrete GPUs win over an integrated one on the same machine. */
const DISCRETE = /nvidia|geforce|quadro|rtx|gtx|radeon rx|radeon pro|amd radeon\(tm\) rx|intel\(r\) arc|\barc a\d/i;

/** The primary GPU from Win32_VideoController names: first discrete one, else first real one. */
export function pickPrimaryGpu(names: readonly string[]): string | null {
  const real = names.map((n) => n.trim()).filter((n) => n.length > 0 && !NOT_A_GPU.test(n));
  return real.find((n) => DISCRETE.test(n)) ?? real[0] ?? null;
}
