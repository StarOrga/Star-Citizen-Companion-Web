/**
 * Live performance-profile switch for a run that is ALREADY in flight.
 *
 * The Configure screen has always promised "switchable live — change it
 * mid-run", but the profile used to be a start-time snapshot: it seeded the
 * extract scope and was never looked at again. The operator's actual need is
 * the opposite of a snapshot — "I'm about to play, throttle down; I'm away for
 * half an hour, throttle up" — and cancelling a multi-hour extract to change a
 * setting is not an answer.
 *
 * So the profile lives here, in ONE mutable holder that every consumer re-reads
 * instead of copying. Two kinds of consumer exist, and they differ in *when*
 * the change lands:
 *
 *  - The Python sidecar (the CPU/disk hog) is not our loop — we cannot make it
 *    consult anything. `onChange` therefore drives an OS-level re-apply of the
 *    process priority + CPU affinity, which takes effect immediately and, since
 *    it never touches the job's own logic, cannot corrupt a half-written file.
 *  - The upload stages (catalog chunks, skin PUTs) ARE our loop, so they call
 *    {@link ThrottleControl.pace} at the same safe boundaries that already carry
 *    `PauseControl.checkpoint()`. `pace()` re-reads the CURRENT profile on every
 *    call, so a change is observed by the next work unit and never mid-request.
 *
 * What deliberately does NOT change live is the extract *scope* (HD icons,
 * render PNGs, component tree): those decide WHICH files the sidecar walks, and
 * it has already planned its work. Scope stays pinned for the run; only the
 * resource knobs move. See `SCOPE_IS_PINNED` below.
 *
 * Pure and Electron-free, mirroring `pause-control.ts`, so the live re-read is
 * unit-testable without an app instance.
 */

import { PROFILES, DEFAULT_PROFILE, type ProfileId, type PerformanceProfile } from './performance.js';

/** Profiles the operator can actually pick (excludes the internal 'custom'). */
export type LiveProfileId = Exclude<ProfileId, 'custom'>;

export function isLiveProfileId(value: unknown): value is LiveProfileId {
  return typeof value === 'string' && value in PROFILES;
}

/**
 * The subset of a {@link PerformanceProfile} that can be re-applied to a job
 * that is already running. Everything else in a profile (scope, ETA) is a
 * start-time decision.
 */
export interface RuntimeThrottle {
  /** OS scheduling priority for the extract/skin sidecar process. */
  priority: PerformanceProfile['workerProcessPriority'];
  /** Logical cores the sidecar may be scheduled on; 'auto' = all of them. */
  cores: number | 'auto';
  /**
   * Cooperative sleep inserted BETWEEN upload work units (never inside one).
   * Only the throttled profile pays it — it is what makes "minimal impact"
   * mean something for the network/disk stages, which no priority class helps.
   */
  pacingMs: number;
}

/**
 * Inter-work-unit pacing per profile. Kept here rather than in `PROFILES`
 * because it describes OUR upload loop, not the sidecar's resource budget.
 * `minimal` is the only profile that yields on purpose; at ~150 ms and a few
 * hundred chunks that costs well under a minute on a job measured in hours.
 */
const PACING_MS: Record<LiveProfileId, number> = {
  minimal: 150,
  standard: 0,
  maximum: 0,
  auto: 0,
};

/** Extract scope is fixed once the sidecar has planned its work — see module doc. */
export const SCOPE_IS_PINNED = true;

/**
 * CPU affinity is used ONLY as the throttle-DOWN knob, never as a cap.
 *
 * `PROFILES.standard.cpuThreads` is "half the cores", but no code has ever
 * applied it — so today every profile de facto runs on all cores, and the skin
 * pipeline's grandchildren (cgf-converter, gltf-transform) inherit that mask on
 * Windows. Narrowing `standard` to half the cores would therefore *halve* an
 * existing pipeline that nobody asked us to slow down. So: `minimal` gets the
 * single core its own description promises ("1 worker + 1 IO"), and every other
 * profile restores the full mask — which is also what makes throttling back up
 * actually give the cores back. Priority still follows each profile's declared
 * `workerProcessPriority` exactly.
 */
export function runtimeFor(profile: LiveProfileId): RuntimeThrottle {
  const p = PROFILES[profile];
  return {
    priority: p.workerProcessPriority,
    cores: profile === 'minimal' ? p.cpuThreads : 'auto',
    pacingMs: PACING_MS[profile],
  };
}

export type ThrottleListener = (profile: LiveProfileId, runtime: RuntimeThrottle) => void;

export interface ThrottleControl {
  /** The profile in effect RIGHT NOW — never a start-time copy. */
  profile(): LiveProfileId;
  /** Resource knobs for the profile in effect right now. */
  runtime(): RuntimeThrottle;
  /** Switch profiles; returns true when this actually changed something. */
  set(next: LiveProfileId): boolean;
  /** Subscribe to switches (used to re-apply OS priority); returns unsubscribe. */
  onChange(cb: ThrottleListener): () => void;
  /**
   * Await at a safe boundary (between chunks / files — never mid-request).
   * Re-reads the current profile on every call, so a switch made while the
   * previous unit was in flight is honoured by the next one.
   */
  pace(): Promise<void>;
}

/** Injectable so tests don't have to burn real wall-clock time. */
export type Sleeper = (ms: number) => Promise<void>;

const realSleep: Sleeper = (ms) => new Promise((r) => setTimeout(r, ms));

export function createThrottleControl(
  initial: LiveProfileId = DEFAULT_PROFILE as LiveProfileId,
  sleep: Sleeper = realSleep,
): ThrottleControl {
  let current: LiveProfileId = isLiveProfileId(initial) ? initial : (DEFAULT_PROFILE as LiveProfileId);
  const listeners = new Set<ThrottleListener>();

  return {
    profile: () => current,
    runtime: () => runtimeFor(current),
    set: (next) => {
      // An unknown id must never blank the profile — a bad IPC payload would
      // otherwise silently un-throttle a job the operator just throttled.
      if (!isLiveProfileId(next) || next === current) return false;
      current = next;
      const rt = runtimeFor(current);
      for (const cb of listeners) {
        try {
          cb(current, rt);
        } catch {
          /* a bad listener must never break job control */
        }
      }
      return true;
    },
    onChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    pace: async () => {
      const ms = runtimeFor(current).pacingMs;
      if (ms > 0) await sleep(ms);
    },
  };
}
