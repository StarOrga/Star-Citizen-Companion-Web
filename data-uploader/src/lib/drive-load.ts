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
 *    `run` is the uploader's share of it: the run plus the app's main
 *    process (sysmon `appIo`). That I/O is measured per process, NOT per
 *    drive, so it is attributed (see {@link driveLoads}):
 *    `runAttribution` says how. `runSharePct` = run bytes ÷ drive bytes, null
 *    when the drive moved (almost) nothing.
 *
 *  `ResourceView.gpu: GpuInfo` — `name` of the primary GPU (null = none found
 *    or not detected yet / non-Windows), `shortName` the same without the
 *    vendor prefix for the card header (`RTX 2080 SUPER`), `available` =
 *    whether a GPU path can run, `enabled` = `limits.gpuPct > 0` (derived —
 *    there is no separate switch any more; the GPU limit `gpuPct` replaced the
 *    old "use GPU" switch, see `resource-limits.ts`). Every sidecar gets env
 *    `SC_USE_GPU=1` exactly when `enabled && available`, else `SC_USE_GPU=0`,
 *    plus `SC_GPU_SHARE=<gpuPct>` ('0' when off); a Python GPU path decides
 *    only by `SC_USE_GPU` and must still fall back to CPU when its own device
 *    init fails. `vramTotalMb` = dedicated VRAM of that adapter from the
 *    registry (`HardwareInformation.qwMemorySize`; null = unknown).
 *
 *  `ResourceSample.gpu: SampleGpu | null` — live GPU load + VRAM (whole PC and
 *    the uploader's share = run + app pids), null until measured. Contract in
 *    `resource-limits.ts` ({@link parseSampleGpu}).
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
  /** Full adapter name (Win32_VideoController), null = none / not detected yet. */
  name: string | null;
  /** `name` without the vendor prefix ({@link shortGpuName}), null with it. */
  shortName: string | null;
  /** Derived: `limits.gpuPct > 0` (kept for older renderers; the limit is the source). */
  enabled: boolean;
  /** Whether a GPU path can run here (detected GPU, sidecar probe). */
  available: boolean;
  /** Dedicated VRAM of the adapter, MB (registry); null = unknown. */
  vramTotalMb: number | null;
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

export const NO_IO: RunIo = { readBps: 0, writeBps: 0, iops: 0 };

/**
 * Defensive parse of sysmon's `appIo` (the Electron main process's file I/O,
 * bytes/s) — null when absent or malformed, so a missing reading never
 * pretends the app did nothing.
 */
export function parseAppIo(raw: unknown): RunIo | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  const readBps = num(o.readBps);
  const writeBps = num(o.writeBps);
  const iops = num(o.iops);
  if (readBps === null || writeBps === null || iops === null) return null;
  return { readBps, writeBps, iops };
}

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
 *
 * `app` is the uploader app's own file I/O (the Electron main process: the
 * upload reading extracted files, caches, logs). It joins the run's figures
 * so `run` is the whole uploader's share, as for CPU and RAM — on one disk
 * all of it, on two disks all of it on the work drive (that is where the
 * extracted output it uploads lives; also an assumption).
 */
export function driveLoads(slots: DriveSlot[], sys: SysDrive[] | null, run: RunIo, app: RunIo = NO_IO): DriveLoad[] {
  const two = slots.length > 1;
  const totalBytes = run.readBps + run.writeBps;
  return slots.map((s) => {
    const d = diskOf(s.letter, sys);
    const readMBs = d?.readBps !== undefined ? r1(d.readBps / MB) : null;
    const writeMBs = d?.writeBps !== undefined ? r1(d.writeBps / MB) : null;
    const iops = d?.iops !== undefined ? Math.round(d.iops) : null;
    let rr = run.readBps + app.readBps;
    let rw = run.writeBps + app.writeBps;
    let ri = run.iops + app.iops;
    if (two) {
      const readShare = totalBytes > 0 ? run.readBps / totalBytes : 1;
      if (s.role === 'game') {
        rr = run.readBps;
        rw = 0;
        ri = run.iops * readShare;
      } else {
        rr = app.readBps;
        rw = run.writeBps + app.writeBps;
        ri = run.iops * (1 - readShare) + app.iops;
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

/**
 * The adapter name without its vendor prefix and trademark marks, for the GPU
 * card header: "NVIDIA GeForce RTX 2080 SUPER" → "RTX 2080 SUPER",
 * "AMD Radeon RX 7900 XTX" → "RX 7900 XTX", "Intel(R) Arc(TM) A770 Graphics"
 * → "Arc A770 Graphics". A brand word stays when nothing model-like follows
 * ("AMD Radeon(TM) Graphics" → "Radeon Graphics").
 */
export function shortGpuName(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null;
  let s = name.replace(/\((?:R|TM|C)\)|[®™©]/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  s = s.replace(/^(?:NVIDIA|AMD|ATI|Intel|Advanced Micro Devices,? Inc\.?)\s+/i, '');
  s = s.replace(/^GeForce\s+(?=(?:RTX|GTX|GT|MX)\b)/i, '');
  s = s.replace(/^Radeon\s+(?=(?:RX|Pro|VII|R\d)\b)/i, '');
  return s.trim() || name.trim();
}

/**
 * Output of the one-shot GPU detection PowerShell call (`main/resources.ts`):
 * lines `NAME|<Win32_VideoController.Name>` and
 * `REG|<DriverDesc>|<HardwareInformation.qwMemorySize>` (one per display
 * adapter class key; the size as a decimal REG_QWORD or `hex:<bytes>` for a
 * REG_BINARY, little-endian). Picks the primary GPU ({@link pickPrimaryGpu})
 * and the VRAM size of the adapter whose DriverDesc matches its name — or, when
 * no description matches, of the only adapter with a size. Pure.
 */
export function parseGpuDetect(out: string): { name: string | null; vramTotalMb: number | null } {
  const names: string[] = [];
  const sizes: { desc: string; bytes: number }[] = [];
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('NAME|')) names.push(line.slice(5));
    else if (line.startsWith('REG|')) {
      const rest = line.slice(4);
      const cut = rest.lastIndexOf('|');
      if (cut < 0) continue;
      const bytes = parseVramBytes(rest.slice(cut + 1));
      if (bytes !== null) sizes.push({ desc: rest.slice(0, cut).trim(), bytes });
    }
  }
  const name = pickPrimaryGpu(names);
  if (!name) return { name: null, vramTotalMb: null };
  const want = name.trim().toLowerCase();
  const hit = sizes.find((x) => x.desc.toLowerCase() === want) ?? (sizes.length === 1 ? sizes[0] : undefined);
  return { name, vramTotalMb: hit ? Math.round(hit.bytes / (1024 * 1024)) : null };
}

/**
 * `HardwareInformation.qwMemorySize` as PowerShell prints it: a decimal
 * (REG_QWORD) or `hex:` + the bytes of a REG_BINARY (little-endian, up to 8).
 * null for anything else or a size of 0.
 */
export function parseVramBytes(text: string): number | null {
  const t = text.trim();
  let v: number;
  if (/^hex:[0-9a-f]+$/i.test(t)) {
    const hex = t.slice(4);
    if (hex.length % 2 !== 0) return null;
    v = 0;
    const bytes = Math.min(8, hex.length / 2);
    for (let i = bytes - 1; i >= 0; i--) v = v * 256 + parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  } else if (/^\d+$/.test(t)) {
    v = Number(t);
  } else {
    return null;
  }
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** `"<pid> <parentPid>"` lines (one Win32_Process query) → [pid, parent] pairs. Pure. */
export function parseProcessTable(out: string): [number, number][] {
  const rows: [number, number][] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (m) rows.push([Number(m[1]), Number(m[2])]);
  }
  return rows;
}

/**
 * Every descendant of `roots` in a process table (roots excluded). A pid that
 * is its own parent (pid 0 / the System idle entry) never loops. Pure.
 */
export function descendantPids(roots: readonly number[], table: readonly [number, number][]): number[] {
  const children = new Map<number, number[]>();
  for (const [pid, parent] of table) {
    if (pid === parent) continue;
    const list = children.get(parent);
    if (list) list.push(pid);
    else children.set(parent, [pid]);
  }
  const seen = new Set<number>(roots);
  const out: number[] = [];
  const queue = [...roots];
  while (queue.length > 0) {
    const next = queue.shift() as number;
    for (const c of children.get(next) ?? []) {
      if (seen.has(c)) continue;
      seen.add(c);
      out.push(c);
      queue.push(c);
    }
  }
  return out;
}
