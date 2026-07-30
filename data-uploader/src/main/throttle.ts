/**
 * Main-process owner of the LIVE performance profile.
 *
 * Main owns it (not the renderer) for the same reason it owns the upload job:
 * the things that must survive a renderer reload live here, and the sidecar
 * PIDs the switch has to act on are only knowable here.
 *
 * Two effects hang off one switch:
 *  1. every registered sidecar PID is re-prioritised immediately (see
 *     `lib/process-throttle`), and
 *  2. the upload stages pick the new pacing up at their next work-unit
 *     boundary via `control().pace()`.
 *
 * Registration is strictly scoped to a live job: a PID is deregistered the
 * moment its job ends, so a switch can never re-prioritise a recycled PID that
 * now belongs to some unrelated process.
 */

import { spawn } from 'node:child_process';
import { cpus } from 'node:os';
import log from 'electron-log';
import {
  createThrottleControl,
  isLiveProfileId,
  runtimeFor,
  type LiveProfileId,
  type RuntimeThrottle,
  type ThrottleControl,
} from '../lib/throttle-control.js';
import { buildThrottleCommand, describeThrottle } from '../lib/process-throttle.js';
import { DEFAULT_PROFILE } from '../lib/performance.js';

const _control: ThrottleControl = createThrottleControl(DEFAULT_PROFILE as LiveProfileId);

/** jobId → sidecar pid, for jobs that are running right now. */
const livePids = new Map<string, number>();

export function control(): ThrottleControl {
  return _control;
}

function totalCores(): number {
  const n = cpus().length;
  return n > 0 ? n : 4;
}

/**
 * Dispatch the current throttle to one process.
 *
 * Deliberately fire-and-forget: awaiting PowerShell would put a few hundred ms
 * of latency on a UI click and let a wedged shell hang the IPC reply, and a
 * failed re-prioritisation is not worth failing a multi-hour job over. The
 * return value therefore means "the command was launched", not "the OS applied
 * it" — the outcome lands in the log.
 */
function applyTo(pid: number, rt: RuntimeThrottle): boolean {
  const cmd = buildThrottleCommand(process.platform, pid, rt, totalCores());
  if (!cmd) {
    log.info(`[throttle] no mechanism on ${process.platform} — pid ${pid} left as-is`);
    return false;
  }
  try {
    const child = spawn(cmd.command, cmd.args, { windowsHide: true, stdio: 'ignore', detached: false });
    child.on('error', (err) => log.warn(`[throttle] apply failed for pid ${pid}:`, err.message));
    child.on('exit', (code) => {
      // A non-zero exit means the process was already gone or refused the
      // change; the run continues either way, just not at the new priority.
      if (code !== 0) log.warn(`[throttle] apply to pid ${pid} exited ${code}`);
    });
    return true;
  } catch (err) {
    log.warn('[throttle] apply threw:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** Re-apply the current profile to every live sidecar. Returns how many it reached
 *  with a launched command (see {@link applyTo} on why that is not a confirmation). */
function applyToAll(): number {
  const rt = _control.runtime();
  let n = 0;
  for (const pid of livePids.values()) {
    if (applyTo(pid, rt)) n += 1;
  }
  return n;
}

/** Sidecars the most recent switch actually reached — reported back to the UI. */
let lastApplied = 0;

// A switch is only useful if the ALREADY-RUNNING sidecars follow it, so the
// re-apply is wired to the control itself rather than to any one call site.
// Doing it here (and not in `set`) means any future caller that flips the
// control gets the re-apply for free instead of inventing a second mechanism.
_control.onChange((profile, rt) => {
  log.info(`[throttle] profile → ${profile} (${describeThrottle(rt, totalCores())})`);
  lastApplied = applyToAll();
});

/**
 * Register a freshly spawned sidecar and give it the profile in effect NOW —
 * which may already differ from the one the operator picked on the Configure
 * screen (e.g. an auto-run that started while they were mid-game).
 */
export function registerJob(jobId: string, pid: number | null | undefined): void {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return;
  livePids.set(jobId, pid);
  log.info(`[throttle] job ${jobId} pid ${pid} → ${_control.profile()}`);
  applyTo(pid, _control.runtime());
}

/** Drop a finished job BEFORE its pid can be recycled by the OS. */
export function unregisterJob(jobId: string): void {
  livePids.delete(jobId);
}

export interface ThrottleView {
  profile: LiveProfileId;
  runtime: RuntimeThrottle;
  /** Sidecars the switch is currently able to steer (0 = nothing running). */
  liveJobs: number;
  /** False on platforms with no priority mechanism — the UI says so instead of lying. */
  supported: boolean;
}

export function view(): ThrottleView {
  return {
    profile: _control.profile(),
    runtime: _control.runtime(),
    liveJobs: livePids.size,
    supported: buildThrottleCommand(process.platform, 1, _control.runtime(), totalCores()) !== null,
  };
}

export interface ThrottleSetResult extends ThrottleView {
  /** False when the requested profile was unknown or already active. */
  changed: boolean;
  /** How many running sidecars the new profile was pushed to. */
  applied: number;
}

/** Switch profiles mid-run. Safe to call when nothing is running. */
export function set(next: unknown): ThrottleSetResult {
  if (!isLiveProfileId(next)) {
    log.warn('[throttle] ignoring unknown profile id', next);
    return { ...view(), changed: false, applied: 0 };
  }
  lastApplied = 0;
  const changed = _control.set(next); // fires onChange → applies + sets lastApplied
  // Even an unchanged request re-asserts the profile on live sidecars: it is
  // the cheap way to recover from an apply that failed when the job started.
  const applied = changed ? lastApplied : applyToAll();
  return { ...view(), changed, applied };
}

export { runtimeFor };
