/**
 * Turns a {@link RuntimeThrottle} into the OS command that applies it to an
 * ALREADY-RUNNING sidecar process.
 *
 * The heavy work of a run happens inside the Python sidecar, which is not our
 * loop: we cannot ask it to re-read a setting between files. What we *can* do
 * from the outside is change how the OS schedules it, and that lands within a
 * scheduler quantum without the process knowing — no cooperation needed, no
 * restart, and structurally incapable of corrupting a half-written file,
 * because it does not touch the job's logic at all.
 *
 * Windows gets both knobs (priority class + CPU affinity) in one PowerShell
 * call. POSIX gets `renice` only; lowering niceness back down needs root, so a
 * throttle-up there is best-effort and logged rather than promised.
 *
 * Pure string building — the caller executes it. That keeps the mask/priority
 * mapping unit-testable without spawning anything.
 */

import type { RuntimeThrottle } from './throttle-control.js';

/** .NET ProcessPriorityClass names, keyed by our profile vocabulary. */
const WIN_PRIORITY: Record<RuntimeThrottle['priority'], string> = {
  idle: 'Idle',
  below_normal: 'BelowNormal',
  normal: 'Normal',
  above_normal: 'AboveNormal',
  high: 'High',
};

/** `nice` values, keyed by our profile vocabulary (higher = friendlier). */
const POSIX_NICE: Record<RuntimeThrottle['priority'], number> = {
  idle: 19,
  below_normal: 10,
  normal: 0,
  above_normal: -5,
  high: -10,
};

/**
 * Affinity mask for `cores` out of `totalCores`, as a decimal string PowerShell
 * can convert to `[IntPtr]`.
 *
 * BigInt, not a JS bitwise op: `1 << 32` wraps to 1, which on a 32-thread
 * machine would pin "all cores" to core 0 — the exact inverse of what the
 * operator asked for, and invisible until someone profiled it.
 *
 * The result is emitted as a SIGNED 64-bit value. `[IntPtr]` converts via
 * Int64, so the unsigned 64-core mask (2^64-1 = 18446744073709551615) does not
 * parse at all — PowerShell raises "Value was either too large or too small for
 * an Int64", which `buildThrottleCommand`'s try/catch then swallows. The
 * observable damage is silent and one-directional: on a machine with >= 64
 * logical processors the mask is only ever APPLIED successfully when it is
 * narrow (throttling down to `minimal`), and the restore to all cores fails —
 * so the sidecar stays pinned to core 0 for the rest of the job while the UI
 * reports the switch as applied. Two's complement keeps the same bit pattern
 * (2^64-1 -> -1) and parses, so both directions work.
 */
export function affinityMask(cores: number | 'auto', totalCores: number): string {
  // 64 is not an arbitrary cap: .NET's ProcessorAffinity addresses a single
  // Windows processor group, and a group holds at most 64 logical processors.
  const total = Math.max(1, Math.min(64, Math.floor(totalCores)));
  const n = cores === 'auto' ? total : Math.max(1, Math.min(total, Math.floor(cores)));
  const mask = (1n << BigInt(n)) - 1n;
  const SIGNED = mask > 0x7fff_ffff_ffff_ffffn ? mask - (1n << 64n) : mask;
  return SIGNED.toString();
}

export interface ThrottleCommand {
  command: string;
  args: string[];
}

/**
 * Build the command that applies `rt` to `pid`, or null when the platform has
 * no supported mechanism (the caller then leaves the process alone rather than
 * pretending the switch worked).
 */
export function buildThrottleCommand(
  platform: NodeJS.Platform,
  pid: number,
  rt: RuntimeThrottle,
  totalCores: number,
): ThrottleCommand | null {
  // A non-integer / non-positive pid is the one way user-adjacent data could
  // reach a shell here — refuse rather than interpolate it.
  if (!Number.isInteger(pid) || pid <= 0) return null;

  if (platform === 'win32') {
    const priority = WIN_PRIORITY[rt.priority];
    const mask = affinityMask(rt.cores, totalCores);
    // The WHOLE TREE, not just `pid`. The sidecar is rarely the process burning
    // the CPU: the record dump runs in worker processes, and the skin pipeline
    // shells out to cgf-converter / gltf-transform. Steering only the parent
    // means an operator who throttles down to play a game watches the actual
    // hogs keep a core each — while the UI reports the switch as applied.
    //
    // Inheritance does not save us either, and it is asymmetric: a child picks
    // up the parent's class only when that class is Idle or BelowNormal (this
    // is CreateProcess's documented default, measured to hold on Win11 —
    // AboveNormal and High are NOT inherited, children start at Normal).
    // So throttling DOWN would half-work by accident and throttling UP would
    // not work at all. Walking the tree makes both directions explicit.
    //
    // -NoProfile: a user's PowerShell profile can print banners or take seconds.
    // Each process is handled in its own try: one exited or locked-down pid must
    // not cost the others their change. Affinity gets a nested try for the same
    // reason — losing it must not lose the priority change.
    const script =
      `$ErrorActionPreference='Stop';` +
      `$ids=New-Object System.Collections.Generic.List[int];` +
      `$q=New-Object System.Collections.Queue;$q.Enqueue(${pid});` +
      // Breadth-first over ParentProcessId. Capped so a pid-reuse cycle or a
      // runaway spawner can never turn this into an unbounded loop.
      `while($q.Count -gt 0 -and $ids.Count -lt 256){` +
      `$id=[int]$q.Dequeue();if($ids.Contains($id)){continue};$ids.Add($id);` +
      `try{Get-CimInstance Win32_Process -Filter "ParentProcessId=$id" -ErrorAction Stop|` +
      `ForEach-Object{$q.Enqueue([int]$_.ProcessId)}}catch{}};` +
      `foreach($id in $ids){try{$p=Get-Process -Id $id -ErrorAction Stop;` +
      `$p.PriorityClass=[System.Diagnostics.ProcessPriorityClass]::${priority};` +
      `try{$p.ProcessorAffinity=[IntPtr]${mask}}catch{}}catch{}}`;
    return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', script] };
  }

  if (platform === 'linux' || platform === 'darwin') {
    // No affinity: taskset is Linux-only and absent on macOS, and a partial
    // application is worse than an honest single knob.
    return { command: 'renice', args: ['-n', String(POSIX_NICE[rt.priority]), '-p', String(pid)] };
  }

  return null;
}

/** Human-readable one-liner for the log — what we asked the OS for, and for whom. */
export function describeThrottle(rt: RuntimeThrottle, totalCores: number): string {
  const cores = rt.cores === 'auto' ? `${totalCores} (all)` : String(rt.cores);
  return `priority=${rt.priority} cores=${cores} pacing=${rt.pacingMs}ms`;
}
