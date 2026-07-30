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
 * Affinity mask for `cores` out of `totalCores`, as a decimal string.
 *
 * BigInt, not a JS bitwise op: `1 << 32` wraps to 1, which on a 32-thread
 * machine would pin "all cores" to core 0 — the exact inverse of what the
 * operator asked for, and invisible until someone profiled it.
 */
export function affinityMask(cores: number | 'auto', totalCores: number): string {
  const total = Math.max(1, Math.min(64, Math.floor(totalCores)));
  const n = cores === 'auto' ? total : Math.max(1, Math.min(total, Math.floor(cores)));
  return (((1n << BigInt(n)) - 1n)).toString();
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
    // -NoProfile: a user's PowerShell profile can print banners or take seconds.
    // Affinity is set inside its own try: on a single-core box or a locked-down
    // process it can throw, and losing affinity must not lose the priority change.
    const script =
      `$ErrorActionPreference='Stop';` +
      `$p=Get-Process -Id ${pid};` +
      `$p.PriorityClass=[System.Diagnostics.ProcessPriorityClass]::${priority};` +
      `try{$p.ProcessorAffinity=[IntPtr]${mask}}catch{}`;
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
